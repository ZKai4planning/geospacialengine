/**
 * Block plan: the numbers behind the picture.
 *
 * The aerial view shows the outlines on a photo; the block plan shows the SAME outlines on a plain drawing, with the measurements
 * written on it, so every distance can be checked by eye and with a tape measure. Everything here is computed in metres on a local
 * flat grid around the site (1° lat = 111 320 m, 1° lng = 111 320 · cos(lat) m - accurate to a few mm over a plot), then projected back
 * into the SAME pixel space as the map layers so the dimension lines land exactly on the outlines.
 *
 * Output (all pixel positions are in the map's viewBox):
 *   dims     : dimension lines { id, kind, a:[x,y], b:[x,y], metres, label }   (work to boundary / road edge / neighbour / post box, pole, lamp / pavement, path)
 *   facts    : measurements that are not lines on the plan { text, label }       (carriageway width, pavement width, public strip, plot frontage)
 *   edges    : length of each boundary side { x, y, angle, metres }
 *   vertices : boundary corner points [[x,y]]
 *   areas    : { plotM2, houseM2, proposalM2 }
 */
import { ringAreaM2, pointInRing } from '../utils/geo.js';

const r1 = (n) => Math.round(n * 10) / 10;
const MAX_EDGES = 16, MIN_EDGE_M = 1.5, MAX_DIM_M = 60;

export function buildBlockPlan({ view, project, houseRing = null, proposalRing = null, houseIndicative = false, plotRings = [], plotEstimated = false, neighbours = [], roads = [], pathways = [], obstacles = [], strips = [] }) {
  const lat0 = view.lat, lng0 = view.lng, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const loc = ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky];
  const back = ([x, y]) => [lng0 + x / kx, lat0 + y / ky];
  const px = (m) => project(view, ...back(m)).map(r1);

  /** nearest points between two vertex lists (closed rings or open lines), in metres: { d, pa (on A), pb (on B) } */
  const nearest = (A, B) => {
    let best = { d: Infinity, pa: null, pb: null };
    const consider = (p, S, flip) => {
      for (let i = 0; i < S.length - 1; i++) {
        const [ax, ay] = S[i], [bx, by] = S[i + 1], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
        const q = [ax + t * dx, ay + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best.d) best = flip ? { d, pa: q, pb: p } : { d, pa: p, pb: q };
      }
    };
    for (const p of A) consider(p, B, false);
    for (const p of B) consider(p, A, true);
    return best;
  };

  const house = houseRing?.map(loc) ?? null, prop = proposalRing?.map(loc) ?? null;
  const plots = plotRings.filter((r) => r?.length > 3);
  const plotsLoc = plots.map((r) => r.map(loc));
  const insideAPlot = (ring) => ring.slice(0, -1).every((pt) => plots.some((pl) => pointInRing(pt, pl)));

  const dims = [], facts = [];
  const add = (id, kind, a, b, metres, text) => {
    if (!(metres >= 0) || metres > MAX_DIM_M) return;
    dims.push({ id, kind, a: px(a), b: px(b), metres: r1(metres), label: `${r1(metres)} m`, text });
  };

  // work -> boundary: only when the work is wholly inside the plot (when it is not, the boundary check already says so)
  const toBoundary = (id, kind, ring, refLng, text) => {
    if (!ring || !plotsLoc.length || !insideAPlot(refLng)) return;
    const best = plotsLoc.map((pl) => nearest(ring, pl)).sort((a, z) => a.d - z.d)[0];
    add(id, kind, best.pa, best.pb, best.d, text);
  };
  toBoundary('prop-boundary', 'boundary', prop, proposalRing, 'Proposal to boundary');
  toBoundary('house-boundary', 'boundary', house, houseRing, 'House to boundary');

  const subject = prop ?? house;
  if (subject) {
    // nearest road EDGE (centre line minus half the road width); roads marked "ignore" (private drives) are skipped
    let road = null;
    for (const rd of roads.filter((r) => !r.ignore && r.line?.length > 1)) {
      const n = nearest(subject, rd.line.map(loc)), half = (rd.widthM ?? 6) / 2, gap = n.d - half;
      if (gap >= 0 && (!road || gap < road.gap)) road = { n, half, gap, name: rd.name, widthM: rd.widthM ?? 6, src: rd.widthSource, classLabel: rd.classLabel ?? null };
    }
    if (road && road.gap <= 40) {
      const { pa, pb } = road.n, len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1, u = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len];
      add('road-edge', 'road', pa, [pb[0] - u[0] * road.half, pb[1] - u[1] * road.half], road.gap, `To edge of ${road.name || 'the road'}`);
      facts.push({ text: `Carriageway width (${road.name || 'the road'}${road.classLabel ? `, ${road.classLabel}` : ''}, ${road.src === 'osm' ? 'as mapped' : 'assumed'})`, label: `${r1(road.widthM)} m` });
    }
    // street features: the nearest obstructions (post box, pole, lamp...) and the nearest pavement / path, each with its distance
    obstacles.filter((o) => o.blocks !== false).map((o) => { const pt = loc([o.lng, o.lat]); return { o, n: nearest(subject, [pt, pt]) }; })
      .filter(({ n }) => n.d > 0 && n.d <= 12).sort((a, z) => a.n.d - z.n.d).slice(0, 4)
      .forEach(({ o, n }, i) => add(`obstacle-${i}`, 'obstacle', n.pa, n.pb, n.d, `To ${o.label.toLowerCase()}`));
    const paths = pathways.filter((p) => p.kind !== 'crossing' && p.line?.length > 1).map((p) => { const n = nearest(subject, p.line.map(loc)); return { p, n, gap: n.d - p.widthM / 2 }; })
      .filter((x) => x.gap >= 0 && x.gap <= 15).sort((a, z) => a.gap - z.gap);
    const seen = new Set();
    for (const x of paths) {
      if (seen.has(x.p.kind === 'pavement')) continue; seen.add(x.p.kind === 'pavement');            // nearest pavement, and nearest other path
      const len = Math.hypot(x.n.pb[0] - x.n.pa[0], x.n.pb[1] - x.n.pa[1]) || 1, u = [(x.n.pb[0] - x.n.pa[0]) / len, (x.n.pb[1] - x.n.pa[1]) / len];
      add(`path-${x.p.kind}`, 'path', x.n.pa, [x.n.pb[0] - u[0] * x.p.widthM / 2, x.n.pb[1] - u[1] * x.p.widthM / 2], x.gap, `To ${x.p.label.toLowerCase()}`);
      facts.push({ text: `${x.p.label} width (${x.p.widthSource === 'osm' ? 'as mapped' : 'assumed'})`, label: `${r1(x.p.widthM)} m` });
    }
    // nearest neighbouring building
    const nb = neighbours.map((n) => nearest(subject, n.ring.map(loc))).sort((a, z) => a.d - z.d)[0];
    if (nb && nb.d > 0 && nb.d <= 25) add('neighbour', 'neighbour', nb.pa, nb.pb, nb.d, 'To neighbouring building');
  }

  // boundary geometry: side lengths + corner points (longest sides first when the outline has many)
  const edges = [], vertices = [];
  plotsLoc.forEach((pl) => {
    const list = [];
    for (let i = 0; i < pl.length - 1; i++) {
      const len = Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
      if (len >= MIN_EDGE_M) list.push({ i, len });
      if (vertices.length < 120) vertices.push(px(pl[i]));
    }
    list.sort((a, z) => z.len - a.len).slice(0, MAX_EDGES).forEach(({ i, len }) => {
      const a = px(pl[i]), b = px(pl[i + 1]);
      edges.push({ x: r1((a[0] + b[0]) / 2), y: r1((a[1] + b[1]) / 2), angle: r1((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI), metres: r1(len) });
    });
  });

  // the public strip between the plot and the road, and how much plot faces it
  if (strips[0]) {
    facts.push({ text: `Public strip: plot boundary to carriageway edge${strips[0].roadName ? ` (${strips[0].roadName})` : ''}`, label: `${r1(strips[0].gapM)} m` });
    if (strips[0].frontageM) facts.push({ text: 'Plot frontage facing the road', label: `${r1(strips[0].frontageM)} m` });
  }

  const area = (ring) => (ring ? r1(ringAreaM2(ring)) : null); // 0.1 m² - a porch is only a couple of square metres
  return {
    mPerPx: Math.round(view.groundMPerPx * 10000) / 10000, subject: prop ? 'proposal' : house ? 'house' : null,
    dims, facts, edges, vertices, houseIndicative: !!houseIndicative, plotEstimated: !!plotEstimated,
    areas: { plotM2: plots.length ? r1(plots.reduce((a, r) => a + ringAreaM2(r), 0)) : null, houseM2: area(houseRing), proposalM2: area(proposalRing) },
  };
}
