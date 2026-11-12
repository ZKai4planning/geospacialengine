import { buildFrame, buildLayers, measureDrawn } from './proposalGeometry.js';
import { makeView, project } from '../utils/mercator.js';
import { runSiteChecks } from './siteChecks.js';
import { buildBlockPlan } from './blockPlan.js';
import { publicStrips } from './publicStrip.js';
import { splitOutbuildings, boundaryDistances, curtilageCover } from './siteFacts.js';
import { buildDashboard } from './dashboard.js';
import { OBSTACLE_KINDS } from '../utils/osmTags.js';
import { ringAreaM2, haversine } from '../utils/geo.js';
import { THRESHOLDS as T } from './rules/thresholds.js';
import { config } from '../config.js';

const VIEW_W = 640, VIEW_H = 400, PAD = 44;
// Map zoom limits. 20 = a house; 15 = a window about 1.9 km wide, enough for the largest single buildings (factories, hospitals, estates).
const MAX_ZOOM = 20, MIN_ZOOM = 15, FOCUS_ZOOM = 18, FOCUS_HALF_M = 30;

const PLOT_PAD = 26;          // tighter margin when the plot outline is what we are framing (it should fill the picture)
const PLOT_MAX_DIAG_M = 170; // a plot bigger than this (farm, estate) is not used for framing: the house would become a speck
const fitsView = (view, points, pad = PAD) => points.every(([lng, lat]) => {
  const [x, y] = project(view, lng, lat);
  return x >= pad && x <= VIEW_W - pad && y >= pad && y <= VIEW_H - pad;
});
const midOf = (points) => {
  const lngs = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
};

/** A round scale-bar length (5 m ... 1 km) that draws between about 40 and 120 px at this zoom (a fixed 5 m bar would be a sliver on a big building). */
export function scaleBar(groundMPerPx) {
  const steps = [5, 10, 20, 50, 100, 200, 500, 1000];
  const metres = [...steps].reverse().find((m) => m / groundMPerPx <= 120) ?? steps[0];
  return { metres, px: Math.round((metres / groundMPerPx) * 10) / 10 };
}

/** The most zoomed-in view (MAX_ZOOM down to MIN_ZOOM) in which every point sits inside the padded window, or null if even MIN_ZOOM is too small. */
function fitView(points, { pad = PAD, fractional = false } = {}) {
  const centre = midOf(points);
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const view = makeView({ ...centre, zoom: z, w: VIEW_W, h: VIEW_H });
    if (!fitsView(view, points, pad)) continue;
    if (fractional) { // zoom in a little further (quarter levels) so the outline fills the picture instead of leaving a wide margin
      for (const dz of [0.75, 0.5, 0.25]) {
        if (z + dz > MAX_ZOOM) continue;
        const finer = makeView({ ...centre, zoom: z + dz, w: VIEW_W, h: VIEW_H });
        if (fitsView(finer, points, pad)) return finer;
      }
    }
    return view;
  }
  return null;
}

/**
 * Chooses the map window.
 *  - 'all'   : the whole building (and the proposal) fits: use the most zoomed-in view that shows all of it.
 *  - 'focus' : the building is bigger than the largest window, so showing "all" would crop its outline at every edge and
 *              leave a zoomed-in map with only a border line crossing it. Frame the part that matters instead: the proposal if there
 *              is one, otherwise the area around the address. The outline simply continues beyond the edges, and the UI says so.
 */
export function chooseView({ allPoints, focusPoints, plotPoints = null, fractional = false }) {
  if (plotPoints) { // the plot outline (with the house and proposal) fills the picture, like a surveyor's site plan
    const framed = fitView([...allPoints, ...plotPoints], { pad: PLOT_PAD, fractional });
    if (framed) return { ...framed, fit: 'plot' };
  }
  const whole = fitView(allPoints);
  if (whole) return { ...whole, fit: 'all' };
  const focus = fitView(focusPoints) ?? makeView({ ...midOf(focusPoints), zoom: FOCUS_ZOOM, w: VIEW_W, h: VIEW_H });
  return { ...focus, fit: 'focus' };
}

/** A circle of radius `rM` metres around a point, as a closed lng/lat ring. */
function circleRing(lng, lat, rM, n = 28) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
  const ring = Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [lng + (rM * Math.sin(a)) / kx, lat + (rM * Math.cos(a)) / ky]; });
  return [...ring, ring[0]];
}

/**
 * Builds everything the UI needs to draw the proposal on the aerial photo:
 * layers (lng/lat + SVG path in the view's pixel space), labels, scale bar and GeoJSON.
 * The aerial image and the overlay share the same `view`, so they line up exactly.
 */
export function buildMap({ address, footprint, roads, roadDetails = [], trees = [], pathways = [], obstacles = [], powerLines = [], areas = [], lidar = null, coal = null, landfill = null, protectedTrees = { zones: [], trees: [] }, flags = {}, camera, profile, proposal, neighbours = [], plot = null, fractionalZoom = config.fractionalZoom }) {
  const frame = buildFrame({ address, footprint, roads, camera, frontBearingDeg: profile.frontBearingDeg?.value ?? null });
  const layers = buildLayers({ frame, footprint, existing: profile.existingExtension, proposal });

  const all = layers.flatMap((l) => l.ring);
  const centre = midOf(all); // trees/roads further than a set distance from the site are not drawn
  const propLayer = layers.find((l) => l.kind === 'proposal');
  const focusPoints = propLayer ? propLayer.ring : (() => { // no proposal yet: a small square around the address
    const d = FOCUS_HALF_M / 111320, dl = d / Math.cos((address.lat * Math.PI) / 180);
    return [[address.lng - dl, address.lat - d], [address.lng + dl, address.lat + d]];
  })();
  // frame the plot outline too (when it is a normal garden-sized plot), so the picture is the property, not just the house
  const plotPoints = (() => {
    const pts = plot ? (plot.rings ?? [plot.ring]).flatMap((r) => r.slice(0, -1)) : [];
    if (pts.length < 3) return null;
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    const diag = haversine({ lat: Math.min(...lats), lng: Math.min(...lngs) }, { lat: Math.max(...lats), lng: Math.max(...lngs) });
    return diag <= PLOT_MAX_DIAG_M ? pts : null;
  })();
  const view = chooseView({ allPoints: all, focusPoints, plotPoints, fractional: fractionalZoom });

  const r1 = (n) => Math.round(n * 10) / 10;

  // Neighbouring buildings + title boundary: checked against the proposal, drawn for context, but they never change the zoom/centre.
  // buildings inside a REGISTERED plot are the owner's own sheds / garages / earlier extensions, not neighbours
  const registeredRings = plot && !plot.estimated ? plot.rings ?? [plot.ring] : null;
  const { own: ownBuildings, others } = splitOutbuildings({ plotRings: registeredRings, neighbours });
  const nbs = others.map((n, i) => ({ id: `neighbour-${i}`, ring: n.ring }));
  const house = layers.find((l) => l.kind === 'building'), prop = layers.find((l) => l.kind === 'proposal');
  const roadIn = roadDetails.map((r, i) => ({ id: `road-${i}`, name: r.name, widthM: r.widthM, widthSource: r.widthSource, ignore: r.ignore, classified: r.classified, classLabel: r.classLabel, line: r.line }));
  const lineIn = powerLines.map((l, i) => ({ ...l, id: `powerline-${i}` })), areaIn = areas.map((a, i) => ({ ...a, id: a.id ?? `area-${i}` }));
  const pathIn = pathways.map((p, i) => ({ ...p, id: `path-${i}` })), obsIn = obstacles.map((o, i) => ({ ...o, id: `obstacle-${i}` }));
  // council-protected trees come first; an OSM tree within 3 m of one is the same tree, so drop the duplicate
  const prot = protectedTrees?.trees ?? [], zonesIn = protectedTrees?.zones ?? [];
  const allTrees = [...prot, ...trees.filter((t) => !prot.some((p) => haversine({ lat: p.lat, lng: p.lng }, { lat: t.lat, lng: t.lng }) <= 3))];
  const treeIn = allTrees.map((t, i) => ({ ...t, id: `tree-${i}` }));
  const win = profile?.neighbourWindow?.value ?? null;      // the neighbour's window the applicant marked (45-degree test)
  const siteChecks = runSiteChecks({
    proposalRing: prop?.ring ?? null, houseRing: house?.ring ?? null, houseIndicative: frame.synthetic,
    footprintWork: prop ? prop.style !== 'roof' : true, neighbours: nbs, plot,
    roads: roadIn, trees: treeIn, zones: zonesIn, pathways: pathIn, obstacles: obsIn, powerLines: lineIn, areas: areaIn, proposalInfo: { storeys: proposal?.storeys ?? 1 }, flags,
    fortyFive: win && frame.frontBearingDeg != null ? { lng: win.lng, lat: win.lat, rearBearingDeg: (frame.frontBearingDeg + 180) % 360 } : null, proposalAbsolute: !!prop?.absolute,
  });
  if (plot?.estimated) {
    const b = plot.basis ?? {}, say = (v) => (v === 'road' ? 'the road' : v === 'neighbour' ? 'the neighbouring buildings' : v === 'fence' ? 'a mapped fence, wall or hedge' : 'a default distance');
    siteChecks.items.unshift({ status: 'info', message: `The red plot outline is an estimate, not a legal boundary: the front follows ${say(b.front)}, the sides ${b.left === b.right ? say(b.left) : `${say(b.left)} and ${say(b.right)}`}, and the back ${say(b.rear)}. Please check it against your title plan or the fences on site.` });
  }
  if (view.fit === 'focus') siteChecks.items.unshift({ status: 'info', message: 'This building is larger than the map window, so the map is centred on your proposal. The outline continues beyond the edges of the picture.' });
  const drawn = prop?.absolute ? measureDrawn(prop.ring.slice(0, -1), frame) : null;
  if (drawn && frame.synthetic) siteChecks.items.push({ status: 'info', message: 'No building outline was found, so measurements (depth beyond the rear wall) and the permitted-development screening are not available for a drawn shape.' });

  const out = layers.map((l) => {
    const px = l.ring.map(([lng, lat]) => project(view, lng, lat));
    const c = px.slice(0, -1).reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((v) => v / (px.length - 1));
    return {
      id: l.id, kind: l.kind, label: l.label, workType: l.workType ?? null, style: l.style ?? 'solid',
      indicative: !!l.indicative, areaM2: l.areaM2, dims: l.dims ?? null,
      path: `M${px.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L')} Z`,
      labelAt: { x: r1(c[0]), y: r1(c[1]) },
      dimsText: l.dims ? `${r1(l.dims.widthM)} × ${r1(l.dims.depthM)} m` : null,
      ring: l.ring,
    };
  });

  // keep labels from overlapping when outlines sit on top of each other (e.g. dormer over an existing extension)
  const labelled = out.filter((l) => l.kind !== 'building').sort((a, b) => a.labelAt.y - b.labelAt.y);
  for (let i = 1; i < labelled.length; i++) {
    const gap = labelled[i].labelAt.y - labelled[i - 1].labelAt.y;
    if (gap < 34) labelled[i].labelAt.y = r1(labelled[i - 1].labelAt.y + 34);
  }

  const toPath = (ring) => `M${ring.map(([lng, lat]) => project(view, lng, lat).map(r1).join(',')).join(' L')} Z`;
  const centreOf = (ring) => { const px = ring.slice(0, -1).map(([lng, lat]) => project(view, lng, lat)); return { x: r1(px.reduce((a, p) => a + p[0], 0) / px.length), y: r1(px.reduce((a, p) => a + p[1], 0) / px.length) }; };
  const NB_LABEL = { overlap: 'Overlaps neighbour', close: 'Very close to neighbour' };
  const extras = [];
  const plotRings = plot ? plot.rings ?? [plot.ring] : [];
  if (plot) extras.push({ id: 'plot', kind: 'plot', status: siteChecks.boundary.status, label: plot.estimated ? 'Estimated plot outline' : 'Registered title boundary (indicative)', style: 'solid', indicative: true, estimated: !!plot.estimated, confidence: plot.confidence ?? null, basis: plot.basis ?? null, areaM2: plot.areaM2, dims: null, path: plotRings.map(toPath).join(' '), labelAt: { x: 0, y: 0 }, dimsText: null, workType: null, ring: plot.ring, rings: plotRings });
  // the land between the plot and the road is public (pavement / highway): drawn so it is obvious where nothing can be built
  const strips = plot ? publicStrips({ plotRings, roads: roadIn }) : [];
  if (plot) {
    const onPublic = siteChecks.publicLand?.status === 'on_public_land';
    strips.forEach((sp, i) => {
      extras.push({
        id: `public-land-${i}`, kind: 'public_land', status: onPublic ? 'on_public_land' : 'clear', label: onPublic ? 'Public land – no building' : '', style: 'solid', indicative: true, estimated: !!plot.estimated,
        areaM2: sp.areaM2, dims: null, path: toPath(sp.ring), labelAt: centreOf(sp.ring), dimsText: null, workType: null, ring: sp.ring, gapM: sp.gapM, name: sp.roadName,
      });
    });
  }
  zonesIn.forEach((z, i) => {
    const st = siteChecks.zones[i];
    extras.push({
      id: z.id, kind: 'tpo_zone', status: st.status, label: st.status === 'inside' ? 'Tree preservation zone' : '', style: 'solid', indicative: true,
      areaM2: Math.round(z.rings.reduce((a, r) => a + ringAreaM2(r), 0)), dims: null, path: z.rings.map(toPath).join(' '), labelAt: centreOf(z.rings[0]), dimsText: null, workType: null,
      ring: z.rings[0], rings: z.rings, zoneType: z.type, order: z.order,
    });
  });
  nbs.forEach((n, i) => {
    const st = siteChecks.neighbours[i];
    extras.push({ id: n.id, kind: 'neighbour', status: st.status, label: NB_LABEL[st.status] ?? '', style: 'solid', indicative: true, areaM2: Math.round(ringAreaM2(n.ring)), dims: null, path: toPath(n.ring), labelAt: centreOf(n.ring), dimsText: null, workType: null, ring: n.ring });
  });

  ownBuildings.forEach((b, i) => {
    extras.push({ id: `outbuilding-${i}`, kind: 'outbuilding', status: 'clear', label: b.areaM2 >= 4 ? `Existing outbuilding ${b.areaM2} m²` : '', style: 'solid', indicative: true, areaM2: b.areaM2, dims: null, path: toPath(b.ring), labelAt: centreOf(b.ring), dimsText: null, workType: null, ring: b.ring });
  });

  // Roads and trees near the site: drawn for context (and coloured when the checks flag them). They never change zoom/centre.
  const near = (lng, lat) => haversine({ lat: centre.lat, lng: centre.lng }, { lat, lng });
  const px1 = ([lng, lat]) => project(view, lng, lat).map(r1).join(',');
  roadDetails.forEach((rd, i) => {
    const st = siteChecks.roads[i];
    const segs = [];
    let mid = null, midD = Infinity; // label the drawn segment nearest the site
    for (let k = 0; k < rd.line.length - 1; k++) {
      const [a, b] = [rd.line[k], rd.line[k + 1]];
      const d = Math.min(near(...a), near(...b));
      if (d > T.roadDrawM) continue;
      segs.push(`M${px1(a)} L${px1(b)}`);
      if (d < midD) { midD = d; const [pa, pb] = [project(view, ...a), project(view, ...b)]; mid = { x: r1((pa[0] + pb[0]) / 2), y: r1((pa[1] + pb[1]) / 2) }; }
    }
    if (!segs.length) return;
    extras.push({
      id: st.id, kind: 'road', status: st.status, label: st.status === 'overlap' ? 'On the road' : st.status === 'close' ? 'Very close to road' : '', style: 'solid',
      indicative: true, areaM2: 0, dims: null, path: segs.join(' '), strokePx: r1(Math.max(2, rd.widthM / view.groundMPerPx)),
      labelAt: mid, dimsText: null, workType: null, name: rd.name, line: rd.line,
    });
  });
  // constraint outlines (conservation area, flood zone, Article 4, SSSI, scheduled monument ...), drawn underneath everything else
  areaIn.forEach((a, i) => {
    const st = siteChecks.areas[i], c = centreOf(a.rings[0]), inView = c.x > 20 && c.x < view.w - 20 && c.y > 14 && c.y < view.h - 14;
    extras.push({
      id: a.id, kind: 'constraint', dataset: a.dataset, datasetLabel: a.label, status: st.status, label: st.status === 'inside' && inView ? a.label : '', style: 'solid', indicative: true,
      areaM2: Math.round(a.rings.reduce((t, r) => t + ringAreaM2(r), 0)), dims: null, path: a.rings.map(toPath).join(' '), labelAt: c, dimsText: null, workType: null,
      ring: a.rings[0], rings: a.rings, name: a.name, reference: a.reference, url: a.url,
    });
  });
  // overhead power lines
  lineIn.forEach((l, i) => {
    const st = siteChecks.street.powerLines[i], segs = [];
    for (let k = 0; k < l.line.length - 1; k++) { const [a, b] = [l.line[k], l.line[k + 1]]; if (Math.min(near(...a), near(...b)) <= T.roadDrawM * 2) segs.push(`M${px1(a)} L${px1(b)}`); }
    if (!segs.length) return;
    extras.push({ id: st.id, kind: 'powerline', status: st.status, label: '', style: 'solid', indicative: true, areaM2: 0, dims: null, path: segs.join(' '), strokePx: 2, labelAt: { x: 0, y: 0 }, dimsText: null, workType: null, line: l.line, voltage: l.voltage });
  });
  // pavements / paths (drawn like roads, in their own colours) and street furniture (small markers, labelled when near the work)
  pathIn.forEach((pt, i) => {
    const st = siteChecks.street.pathways[i], segs = [];
    for (let k = 0; k < pt.line.length - 1; k++) { const [a, b] = [pt.line[k], pt.line[k + 1]]; if (Math.min(near(...a), near(...b)) <= T.roadDrawM) segs.push(`M${px1(a)} L${px1(b)}`); }
    if (!segs.length) return;
    extras.push({
      id: st.id, kind: 'pathway', pathKind: pt.kind, row: !!pt.row, status: st.status, label: '', style: 'solid', indicative: true, areaM2: 0, dims: null, path: segs.join(' '),
      strokePx: r1(Math.max(1.5, pt.widthM / view.groundMPerPx)), labelAt: { x: 0, y: 0 }, dimsText: null, workType: null, name: pt.name, widthM: pt.widthM, line: pt.line,
    });
  });
  const obsDrawn = obsIn.map((o, i) => ({ o, st: siteChecks.street.obstacles[i], d: near(o.lng, o.lat) })).filter((x) => x.d <= T.obstacleDrawM).sort((a, b) => a.d - b.d);
  obsDrawn.forEach(({ o, st }, k) => {
    const rM = Math.max(o.kind ? (OBSTACLE_KINDS[o.kind]?.radiusM ?? 0.3) : 0.3, 4.5 * view.groundMPerPx), [cx, cy] = project(view, o.lng, o.lat);
    extras.push({
      id: st.id, kind: 'obstacle', obstacleKind: o.kind, status: st.status, label: k < 6 || st.status !== 'clear' ? o.label : '', style: 'solid', indicative: true, areaM2: 0, dims: null,
      path: toPath(circleRing(o.lng, o.lat, rM, 12)), labelAt: { x: r1(cx), y: r1(cy - 8) }, dimsText: null, workType: null, ring: circleRing(o.lng, o.lat, rM, 12), centre: [o.lng, o.lat], ref: o.ref, heightM: o.heightM,
    });
  });
  // wall safety: each outside wall of the new work that the rule flagged is drawn as a thick coloured line along that wall (clear walls are not drawn, to keep the plan quiet)
  const WALL_FLAGGED = ['overlaps_neighbour', 'touches_neighbour', 'on_boundary', 'within_1m', 'close_neighbour'];
  if (prop?.ring) {
    for (const w of siteChecks.walls ?? []) {
      const a = prop.ring[w.index], b = prop.ring[w.index + 1];
      if (w.kind !== 'external' || !WALL_FLAGGED.includes(w.status) || !a || !b) continue;
      extras.push({ id: `wall-${w.index}`, kind: 'wall', status: w.status, label: '', style: 'solid', indicative: true, areaM2: 0, dims: null, path: `M${px1(a)} L${px1(b)}`, strokePx: 6, labelAt: { x: 0, y: 0 }, dimsText: null, workType: null, line: [a, b], wallLengthM: w.lengthM, facing: w.facing });
    }
  }
  if (win) { // the marked window, and the 45-degree line drawn from it when the test could run
    const [wx, wy] = project(view, win.lng, win.lat), ff = siteChecks.fortyFive, state = ff.status === 'breach' ? 'breach' : ff.status === 'clear' ? 'clear' : 'unavailable';
    extras.push({ id: 'window45', kind: 'window45', status: state, label: 'Neighbour window', style: 'solid', indicative: true, areaM2: 0, dims: null, path: toPath(circleRing(win.lng, win.lat, Math.max(0.25, 5 * view.groundMPerPx), 12)), labelAt: { x: r1(wx), y: r1(wy - 9) }, dimsText: null, workType: null, ring: circleRing(win.lng, win.lat, 0.3, 8), centre: [win.lng, win.lat] });
    if (ff.dir) {
      const kx = 111320 * Math.cos((win.lat * Math.PI) / 180), ky = 111320, end = [win.lng + (ff.dir[0] * 14) / kx, win.lat + (ff.dir[1] * 14) / ky];
      extras.push({ id: 'window45-line', kind: 'window45line', status: state, label: '', style: 'solid', indicative: true, areaM2: 0, dims: null, path: `M${px1([win.lng, win.lat])} L${px1(end)}`, strokePx: 2, labelAt: { x: 0, y: 0 }, dimsText: null, workType: null, line: [[win.lng, win.lat], end] });
    }
  }
  allTrees.forEach((t, i) => {
    if (near(t.lng, t.lat) > T.treeDrawM) return;
    const st = siteChecks.trees[i];
    const ring = circleRing(t.lng, t.lat, st.radiusM);
    const [cx, cy] = project(view, t.lng, t.lat);
    extras.push({
      id: st.id, kind: 'tree', status: st.status, label: st.status === 'blocked' ? (t.protected ? 'On a protected tree' : 'On a tree') : st.status === 'near' ? (t.protected ? 'Protected tree root zone' : 'Tree root zone') : '', style: 'solid', indicative: true,
      areaM2: Math.round(Math.PI * st.radiusM ** 2), dims: null, path: toPath(ring), labelAt: { x: r1(cx), y: r1(cy + 4) }, dimsText: null, workType: null,
      ring, centre: [t.lng, t.lat], radiusM: st.radiusM, radiusSource: st.radiusSource, species: t.species, protected: !!t.protected, order: t.order ?? null,
    });
  });
  out.push(...extras);

  const blockPlan = buildBlockPlan({
    view, project, houseRing: house?.ring ?? null, proposalRing: prop?.ring ?? null, houseIndicative: frame.synthetic,
    plotRings, plotEstimated: !!plot?.estimated, neighbours: nbs, roads: roadIn, pathways: pathIn, obstacles: obsIn, strips,
  });

  const outbuildingsM2 = Math.round(ownBuildings.reduce((a, b) => a + b.areaM2, 0) * 10) / 10;
  const proposalM2 = prop && prop.style !== 'roof' ? prop.areaM2 ?? 0 : 0;
  const siteFacts = {
    registered: !!registeredRings, outbuildings: ownBuildings.map((b) => ({ areaM2: b.areaM2, ring: b.ring })), outbuildingsM2,
    boundary: registeredRings && prop && prop.style !== 'roof' ? boundaryDistances({ plotRings: registeredRings, proposalRing: prop.ring, frontBearingDeg: frame.frontBearingDeg ?? null }) : null,
    curtilage: curtilageCover({ plotAreaM2: plot?.areaM2 ?? null, houseM2: house ? ringAreaM2(house.ring) : null, outbuildingsM2, proposalM2 }),
    additionsAreaM2: registeredRings && prop ? Math.round((outbuildingsM2 + proposalM2) * 10) / 10 : null,
  };

  const dashboard = buildDashboard({
    subjectRing: prop && prop.style !== 'roof' ? prop.ring : house?.ring ?? null, subjectKind: prop && prop.style !== 'roof' ? 'proposal' : 'house', houseRing: house?.ring ?? null,
    plotRings, plotEstimated: !!plot?.estimated, frontBearingDeg: frame.frontBearingDeg ?? null,
    roads: roadIn, pathways: pathIn, obstacles: obsIn, powerLines: lineIn, trees: treeIn, protectedTreeCount: prot.length, tpoZoneCount: zonesIn.length,
    neighbours: nbs, outbuildings: ownBuildings, areas: areaIn, siteChecks, strips, lidar, coal, landfill,
  });

  return {
    dashboard,
    siteFacts,
    blockPlan,
    siteChecks: { ...siteChecks, attribution: ['© OpenStreetMap contributors (building outlines, roads, trees)', plot?.attribution, (zonesIn.length || prot.length) ? 'Tree preservation data from the councils that publish it, via planning.data.gov.uk (Open Government Licence v3.0).' : null, lidar?.status === 'ok' ? 'Roof heights: Environment Agency LiDAR composite (check the dataset page for the current licence and attribution wording).' : null, coal?.status && coal.status !== 'unavailable' ? `Coal mining: ${coal.source}.` : null, landfill?.status && landfill.status !== 'unavailable' ? `Historic landfill: ${landfill.source}.` : null].filter(Boolean) },
    frame: { frontBearingDeg: frame.frontBearingDeg, frontSource: frame.frontSource, corner: !!frame.corner, houseWidthM: r1(frame.W), houseDepthM: r1(frame.D), indicative: frame.synthetic },
    view: { lat: view.lat, lng: view.lng, zoom: view.zoom, w: view.w, h: view.h, fit: view.fit },
    scale: scaleBar(view.groundMPerPx),
    layers: out,
    drawn: drawn ? { ...Object.fromEntries(Object.entries(drawn).map(([k, v]) => [k, r1(v)])) } : null,
    geojson: {
      type: 'FeatureCollection',
      features: out.map((l) => ({
        type: 'Feature', properties: { id: l.id, kind: l.kind, label: l.label, areaM2: l.areaM2, status: l.status ?? null, radiusM: l.radiusM ?? null, protected: l.protected ?? null },
        geometry: l.kind === 'road' || l.kind === 'pathway' || l.kind === 'powerline' || l.kind === 'window45line' || l.kind === 'wall' ? { type: 'LineString', coordinates: l.line } : l.kind === 'tree' || l.kind === 'obstacle' || l.kind === 'window45' ? { type: 'Point', coordinates: l.centre } : l.rings?.length > 1 ? { type: 'MultiPolygon', coordinates: l.rings.map((r) => [r]) } : { type: 'Polygon', coordinates: [l.ring] },
      })),
    },
  };
}
