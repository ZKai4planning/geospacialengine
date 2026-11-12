import { projector, open, centroid } from '../utils/polygons.js';
import { protectionRadius } from '../utils/trees.js';
import { THRESHOLDS } from './rules/thresholds.js';
import { SITE_RULES, runRules } from './rules/index.js';

export { THRESHOLDS };

const r2 = (n) => Math.round(n * 100) / 100, pts = (ring) => ring.map(([x, y]) => [r2(x), r2(y)]);
/** What the rules were looking at, in local metres (x east, y north), for the engine-room plan. Kept small: only what is near the work. */
function traceGeometry({ P, H, neighbours, plot, roads, trees, T }) {
  const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
  const near = (ring, m) => ring.some(([x, y]) => Math.hypot(x - c[0], y - c[1]) <= m);
  return {
    proposal: pts(P), house: H ? pts(H) : null,
    neighbours: neighbours.filter((n) => near(n.local, T.rangeM + 12)).map((n) => ({ id: n.id, ring: pts(n.local) })),
    plot: plot ? { estimated: plot.estimated, parts: plot.parts.map(pts) } : null,
    roads: roads.filter((r) => !r.ignore && near(r.local, T.roadDrawM)).map((r) => ({ id: r.id, name: r.name, widthM: r.widthM, line: pts(r.local) })),
    trees: trees.filter((t) => Math.hypot(t.xy[0] - c[0], t.xy[1] - c[1]) <= T.treeDrawM).map((t) => ({ id: t.id, xy: [r2(t.xy[0]), r2(t.xy[1])], radiusM: t.radiusM, protected: !!t.protected })),
  };
}

export const DISCLAIMER =
  'Indicative only: based on OpenStreetMap building, road and tree data, council tree-preservation data and HM Land Registry title boundaries. Positions can be a metre or more out, '
  + 'trees and road widths are estimates, and a title boundary is not the legal boundary. Please check on site.';

/**
 * Checks the proposal footprint against neighbouring buildings, the registered title boundary, roads, public land, pavements / paths, street furniture (post boxes, poles, lamps) and trees,
 * then any custom rules (src/services/rules/custom.js). All input rings/points are [lng, lat].
 *
 *   roads : [{ id, name, widthM, ignore, line: [[lng,lat],...] }]
 *   trees : [{ id, lng, lat, trunkDiameterM, crownDiameterM, species, protected?, order? }]   (OSM trees + council protected trees)
 *   zones : [{ id, type, order, rings: [ring, ...] }]                                          (council tree preservation zones)
 *   proposalAbsolute : true when the applicant drew the shape on the map (it is a real position, so the checks are
 *                      meaningful even when the house outline is only indicative)
 *
 * Returns per-feature status (for map colouring) plus human-readable `items`.
 */
export function runSiteChecks({
  proposalRing, houseRing, houseIndicative = false, footprintWork = true, neighbours = [], plot = null,
  roads = [], trees = [], zones = [], pathways = [], obstacles = [], powerLines = [], areas = [], proposalInfo = {}, fortyFive = null, flags = {}, proposalAbsolute = false, rules = SITE_RULES,
}) {
  const treeInfo = trees.map((t) => { const { radiusM, source } = protectionRadius(t); return { id: t.id, radiusM, radiusSource: source, species: t.species ?? null, protected: !!t.protected, order: t.order ?? null }; });
  const result = {
    neighbours: neighbours.map((n) => ({ id: n.id, status: 'clear', overlapM2: 0, distanceM: null, direction: null })),
    roads: roads.map((r) => ({ id: r.id, status: 'clear', distanceM: null, name: r.name ?? null, widthM: r.widthM })),
    trees: treeInfo.map((t) => ({ ...t, status: 'clear', distanceM: null })),
    zones: zones.map((z) => ({ id: z.id, type: z.type ?? null, order: z.order ?? null, status: 'clear', distanceM: null })),
    boundary: { status: plot ? 'idle' : 'unavailable', estimated: !!plot?.estimated, approxM: plot?.approxM ?? 0, areaM2: plot?.areaM2 ?? null, outsideM2: 0, maxOutsideM: 0, minDistanceM: null },
    publicLand: { status: 'unavailable', estimated: !!plot?.estimated, areaM2: 0, maxIntoM: 0, gapM: null, roadName: null },
    street: {
      pathways: pathways.map((p) => ({ id: p.id, kind: p.kind, label: p.label, name: p.name ?? null, widthM: p.widthM, widthSource: p.widthSource, row: !!p.row, private: !!p.private, status: 'clear', distanceM: null })),
      obstacles: obstacles.map((o) => ({ id: o.id, kind: o.kind, label: o.label, blocks: o.blocks !== false, status: 'clear', distanceM: null, inPlot: null })),
      powerLines: powerLines.map((l) => ({ id: l.id, kind: l.kind, label: l.label, voltage: l.voltage ?? null, status: 'clear', distanceM: null })),
      crossesRow: false,
    },
    areas: areas.map((a) => ({ id: a.id, dataset: a.dataset, label: a.label, status: 'clear', distanceM: null })),
    regulatory: [],
    walls: [], wallSafety: { status: 'unavailable' },
    fortyFive: { status: 'unavailable' },
    items: [], disclaimer: DISCLAIMER,
    trace: { ran: false, skipped: null, rules: [], geometry: null },
  };
  if (!proposalRing) { result.trace.skipped = { reason: 'no-proposal', message: 'No work has been chosen yet, so there is nothing to check.' }; return result; }

  if (!footprintWork) {
    result.trace.skipped = { reason: 'roof-level', message: 'Roof-level work does not extend the footprint, so the footprint rules (neighbours, boundary, walls, roads, trees) are not run.' };
    result.items.push({ status: 'info', message: 'Roof-level work does not extend the building footprint, so overlap, boundary, road and tree checks do not apply.' });
    return result;
  }
  if (houseIndicative && !proposalAbsolute) {
    result.trace.skipped = { reason: 'no-outline', message: 'No real building outline was found (the house shown is indicative), so there is no true position to check against.' };
    result.items.push({ status: 'info', message: 'No building outline was found, so neighbour, boundary, road and tree checks were skipped.' });
    return result;
  }

  const c = ((r) => ({ lng: r.reduce((s, p) => s + p[0], 0) / r.length, lat: r.reduce((s, p) => s + p[1], 0) / r.length }))(proposalRing);
  const proj = projector(c.lat, c.lng);
  const local = (ring) => open(ring.map(proj));
  const P = local(proposalRing);
  const H = houseRing && !houseIndicative ? local(houseRing) : null; // an indicative house is not a real position
  const from = H ? centroid(H) : centroid(P);                          // compass direction is measured from the middle of the house

  const ctx = {
    P, H, from, T: THRESHOLDS, proposalInfo,
    fortyFive: fortyFive ? { xy: proj([fortyFive.lng, fortyFive.lat]), rearBearingDeg: fortyFive.rearBearingDeg } : null, flags: flags ?? {}, local,
    neighbours: neighbours.map((n) => ({ id: n.id, local: local(n.ring) })),
    plot: plot ? { local: local(plot.ring), parts: (plot.rings ?? [plot.ring]).map(local), areaM2: plot.areaM2, estimated: !!plot.estimated, approxM: plot.approxM ?? 0 } : null,
    zones: zones.map((z) => ({ id: z.id, type: z.type ?? null, order: z.order ?? null, parts: z.rings.map(local) })),
    roads: roads.map((r) => ({ id: r.id, name: r.name ?? null, widthM: r.widthM, ignore: !!r.ignore, classified: !!r.classified, classLabel: r.classLabel ?? null, local: r.line.map(proj) })),
    trees: trees.map((t, i) => ({ ...treeInfo[i], xy: proj([t.lng, t.lat]) })),
    pathways: pathways.map((p) => ({ ...p, local: p.line.map(proj) })),
    obstacles: obstacles.map((o) => ({ ...o, xy: proj([o.lng, o.lat]) })),
    powerLines: powerLines.map((l) => ({ ...l, local: l.line.map(proj) })),
    areas: areas.map((a) => ({ ...a, parts: a.rings.map((r) => r.slice(0, -1).map(proj)) })),
  };

  result.trace.ran = true;
  result.trace.geometry = traceGeometry(ctx);
  runRules(ctx, result, rules);
  return result;
}
