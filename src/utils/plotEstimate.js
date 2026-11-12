import { pointInRing, ringAreaM2 } from './geo.js';
import { open, pointSegDist, polyArea } from './polygons.js';

/**
 * Estimated plot outline ("the red line" round the house, drive and garden).
 *
 * Used when the HM Land Registry title polygon is missing or does not match the house. It is computed ONLY from open data we
 * already hold (OSM buildings + roads), never from imagery:
 *   - sides / rear : the line half way between this house and the neighbouring dwellings (a Voronoi cell),
 *   - front        : the back of the pavement (road centreline + half the carriageway + a footway allowance),
 *   - nothing there: a sensible default reach (sideMaxM / rearMaxM / frontMaxNoRoadM).
 * The work is done on a raster in the house's own frame (s = across the plot, d = beyond the rear wall) so edges come out
 * straight for a typical rectangular plot; the outline is then traced and simplified to a handful of corners.
 * It is an ESTIMATE: it is drawn and labelled as one and the rules never treat it as a legal boundary.
 */
export const PLOT_LIMITS = {
  stepM: 0.5,            // raster cell size
  sideMaxM: 8,           // furthest a plot reaches past the side walls when nothing bounds it
  rearMaxM: 25,          // furthest it reaches behind the rear wall when nothing bounds it
  frontMaxM: 30,         // furthest it reaches in front when a road is mapped (the road stops it earlier)
  frontMaxNoRoadM: 8,    // ... and when no road is mapped
  footwayM: 2,           // pavement allowance added to half the carriageway width
  minNeighbourM2: 25,    // smaller buildings (sheds, garages) are not treated as neighbouring homes
  simplifyM: 0.6,        // outline simplification tolerance
  roadSearchM: 40,       // a road further than this from the front wall does not count as "the road"
  snapM: 3,              // an estimated edge is moved onto a mapped fence / wall / hedge running alongside it within this distance
  snapMinOverlapM: 4,    // ... when the barrier runs along at least this much of the edge (or 35% of it, whichever is larger)
  snapAngleDeg: 15,      // ... and is parallel to it within this angle
};

/** OSM building values that are outbuildings, not homes: they must not carve up a garden. */
const ANCILLARY = new Set(['shed', 'garage', 'garages', 'carport', 'greenhouse', 'roof', 'outbuilding', 'hut', 'cabin', 'kiosk', 'service', 'barn', 'stable', 'static_caravan', 'container', 'allotment_house', 'toilets', 'bin_store', 'bicycle_parking']);

const edgesOf = (pts) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
const bboxOf = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const bboxGap = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));

function distToEdges(pt, edges, best = Infinity) {
  for (const [a, b] of edges) { const d = pointSegDist(pt, a, b); if (d < best) best = d; }
  return best;
}

/** Perpendicular distance from p to the chord a-b (or to a when a = b). */
function chordDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  return len ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
}
function dpOpen(pts, tol) {
  if (pts.length < 3) return pts;
  let idx = -1, far = tol;
  for (let i = 1; i < pts.length - 1; i++) { const d = chordDist(pts[i], pts[0], pts.at(-1)); if (d > far) { far = d; idx = i; } }
  if (idx < 0) return [pts[0], pts.at(-1)];
  return [...dpOpen(pts.slice(0, idx + 1), tol).slice(0, -1), ...dpOpen(pts.slice(idx), tol)];
}
/** Douglas-Peucker for a closed ring (open form, no repeated closing vertex). */
function simplifyClosed(pts, tol) {
  if (pts.length <= 4) return pts;
  let k = 0, far = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > far) { far = d; k = i; } }
  const a = dpOpen(pts.slice(0, k + 1), tol), b = dpOpen([...pts.slice(k), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
const dropCollinear = (pts) => pts.filter((p, i) => {
  const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
  return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
});

/** Tests whether an OSM neighbour is a real home worth bounding the plot with. */
function isDwelling(n, nLocal, houseLocal) {
  if (ANCILLARY.has(String(n.buildingType ?? '').toLowerCase())) return false;
  if (polyArea(nLocal) < PLOT_LIMITS.minNeighbourM2) return false;
  const c = [nLocal.reduce((s, p) => s + p[0], 0) / nLocal.length, nLocal.reduce((s, p) => s + p[1], 0) / nLocal.length];
  const hc = [houseLocal.reduce((s, p) => s + p[0], 0) / houseLocal.length, houseLocal.reduce((s, p) => s + p[1], 0) / houseLocal.length];
  return !(pointInRing(c, houseLocal) || pointInRing(hc, nLocal)); // a duplicate / part-of-house outline is not a neighbour
}

/**
 * @param frame        result of buildFrame() (has toLocal, toLngLat, P, W, D, synthetic)
 * @param houseRing    [[lng,lat],...] the house outline
 * @param neighbours   [{ ring, buildingType }]
 * @param roadDetails  [{ widthM, ignore, line: [[lng,lat],...] }]
 * @param barriers     [{ kind: 'fence'|'wall'|'hedge'|..., line: [[lng,lat],...] }]  mapped boundaries; edges are snapped to the ones that run alongside them
 * @returns { ring, rings, areaM2, confidence, basis, ... } or null when there is no real outline to start from
 */
export function estimatePlot({ frame, houseRing, neighbours = [], roadDetails = [], barriers = [], limits = {} }) {
  if (!frame || frame.synthetic || !houseRing || houseRing.length < 4) return null;
  const L = { ...PLOT_LIMITS, ...limits };
  const xy = (ring) => open(ring.map(([lng, lat]) => frame.toLocal(lng, lat)));
  const house = xy(houseRing), houseEdges = edgesOf(house), houseBox = bboxOf(house);

  const nbs = neighbours.map((n) => ({ n, pts: xy(n.ring) }))
    .filter(({ n, pts }) => pts.length >= 3 && isDwelling(n, pts, house))
    .map(({ n, pts }) => ({ ring: n.ring, pts, edges: edgesOf(pts), box: bboxOf(pts) }))
    .filter((n) => bboxGap([(houseBox[0] + houseBox[2]) / 2, (houseBox[1] + houseBox[3]) / 2], n.box) < 70);

  // roads that actually bound a plot: the carriageway plus a pavement. Private drives / service=driveway are ignored.
  const roads = roadDetails.filter((r) => !r.ignore && r.line?.length >= 2).map((r) => {
    const line = r.line.map(([lng, lat]) => frame.toLocal(lng, lat));
    return { half: (r.widthM ?? 5) / 2 + L.footwayM, edges: line.slice(0, -1).map((p, i) => [p, line[i + 1]]) };
  });
  const frontMid = frame.P(0, -frame.D);
  const roadNear = roads.some((r) => distToEdges(frontMid, r.edges) - r.half <= L.roadSearchM);

  // raster in the house frame
  const step = L.stepM;
  const s0 = -frame.W / 2 - L.sideMaxM, s1 = frame.W / 2 + L.sideMaxM;
  const d0 = -frame.D - (roadNear ? L.frontMaxM : L.frontMaxNoRoadM), d1 = L.rearMaxM;
  const nx = Math.ceil((s1 - s0) / step), ny = Math.ceil((d1 - d0) / step);
  const idx = (i, j) => j * nx + i;
  const own = new Uint8Array(nx * ny), inHouse = new Uint8Array(nx * ny);
  const why = new Uint8Array(nx * ny); // 0 none, 1 neighbour, 2 road, 3 default limit  (why a cell is NOT part of the plot)
  const NB = 1, RD = 2, CAP = 3;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const pt = frame.P(s0 + (i + 0.5) * step, d0 + (j + 0.5) * step);
      const k = idx(i, j);
      if (pointInRing(pt, house)) { own[k] = inHouse[k] = 1; continue; }
      if (roads.some((r) => distToEdges(pt, r.edges) < r.half)) { why[k] = RD; continue; }
      let dNb = Infinity, blocked = false;
      for (const n of nbs) {
        if (bboxGap(pt, n.box) >= dNb) continue;
        if (pointInRing(pt, n.pts)) { blocked = true; break; }
        dNb = Math.min(dNb, distToEdges(pt, n.edges, dNb));
      }
      if (blocked) { why[k] = NB; continue; }
      if (dNb === Infinity) { own[k] = 1; continue; }
      if (distToEdges(pt, houseEdges) <= dNb) own[k] = 1; else why[k] = NB;
    }
  }

  const flood = (seedTest, passTest) => {
    const seen = new Uint8Array(nx * ny), q = [];
    for (let k = 0; k < nx * ny; k++) if (seedTest(k)) { seen[k] = 1; q.push(k); }
    while (q.length) {
      const k = q.pop(), i = k % nx, j = (k / nx) | 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const m = idx(a, b);
        if (!seen[m] && passTest(m)) { seen[m] = 1; q.push(m); }
      }
    }
    return seen;
  };

  let region = flood((k) => inHouse[k], (k) => own[k]);                  // only what is connected to the house
  const at = (a, i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? a[idx(i, j)] : 0);
  const eroded = new Uint8Array(nx * ny);                                   // opening (erode + dilate) removes thin spurs
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let all = 1;
    for (let dj = -1; dj <= 1 && all; dj++) for (let di = -1; di <= 1; di++) if (!at(region, i + di, j + dj)) { all = 0; break; }
    eroded[idx(i, j)] = all;
  }
  const opened = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let any = 0;
    for (let dj = -1; dj <= 1 && !any; dj++) for (let di = -1; di <= 1; di++) if (at(eroded, i + di, j + dj)) { any = 1; break; }
    opened[idx(i, j)] = (any || inHouse[idx(i, j)]) && region[idx(i, j)] ? 1 : 0;
  }
  region = flood((k) => inHouse[k], (k) => opened[k]);
  const outside = flood((k) => { const i = k % nx, j = (k / nx) | 0; return !region[k] && (i === 0 || j === 0 || i === nx - 1 || j === ny - 1); }, (k) => !region[k]);
  for (let k = 0; k < nx * ny; k++) if (!region[k] && !outside[k]) region[k] = 1; // fill holes

  // trace the outer boundary: directed edges with the plot on the left
  const next = new Map(), key = (x, y) => `${x},${y}`;
  const add = (x1, y1, x2, y2) => { const k = key(x1, y1); (next.get(k) ?? next.set(k, []).get(k)).push([x2, y2]); };
  const sides = { front: { [NB]: 0, [RD]: 0, [CAP]: 0 }, rear: { [NB]: 0, [RD]: 0, [CAP]: 0 }, left: { [NB]: 0, [RD]: 0, [CAP]: 0 }, right: { [NB]: 0, [RD]: 0, [CAP]: 0 } };
  const tally = (side, i, j) => { // cell (i,j) lies just outside the plot: remember WHY it does (off the raster = default limit)
    const w = i < 0 || j < 0 || i >= nx || j >= ny ? CAP : why[idx(i, j)] || CAP;
    sides[side][w]++;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!region[idx(i, j)]) continue;
    if (!at(region, i, j - 1)) { add(i, j, i + 1, j); tally('front', i, j - 1); }
    if (!at(region, i + 1, j)) { add(i + 1, j, i + 1, j + 1); tally('right', i + 1, j); }
    if (!at(region, i, j + 1)) { add(i + 1, j + 1, i, j + 1); tally('rear', i, j + 1); }
    if (!at(region, i - 1, j)) { add(i, j + 1, i, j); tally('left', i - 1, j); }
  }
  let best = null;
  for (const [startKey, outs] of next) {
    while (outs.length) {
      const [sx, sy] = startKey.split(',').map(Number), loop = [[sx, sy]];
      let [cx, cy] = outs.pop();
      while (!(cx === sx && cy === sy)) {
        loop.push([cx, cy]);
        const o = next.get(key(cx, cy));
        if (!o?.length) break;
        [cx, cy] = o.pop();
      }
      const a = polyArea(loop);
      if (!best || a > best.a) best = { loop, a };
    }
  }
  if (!best || best.loop.length < 4) return null;

  const toSD = ([x, y]) => [s0 + x * step, d0 + y * step];
  const sdLoop = best.loop.map(toSD);
  const houseSD = house.map((p) => frame.toSD(...frame.toLngLat(p[0], p[1])));
  const inside = (poly, p, tol) => pointInRing(p, poly) || distToEdges(p, edgesOf(poly)) <= tol;
  let poly = null;
  for (const tol of [L.simplifyM, L.simplifyM / 2, 0.15]) {         // never let simplification cut into the house
    const cand = dropCollinear(simplifyClosed(dropCollinear(sdLoop), tol));
    if (cand.length >= 3 && houseSD.every((p) => inside(cand, p, 0.3))) { poly = cand; break; }
  }
  poly ??= dropCollinear(sdLoop);

  // snap straight edges onto mapped fences / walls / hedges that run alongside them (the estimate then follows the real boundary)
  const snap = barriers.length
    ? snapToBarriers({ poly, barriers: barriers.map((b) => ({ kind: b.kind, pts: b.line.map(([lng, lat]) => frame.toSD(lng, lat)) })), houseSD, nbSD: nbs.map((n) => n.ring.map(([lng, lat]) => frame.toSD(lng, lat))), L })
    : { poly, snapped: [] };
  poly = snap.poly;

  const ring = poly.map(([s, d]) => frame.toLngLat(...frame.P(s, d)));
  ring.push(ring[0]);

  const dominant = (t) => { const total = t[NB] + t[RD] + t[CAP]; if (!total) return 'default'; const [w] = [NB, RD, CAP].map((c) => [c, t[c]]).sort((a, b) => b[1] - a[1])[0]; return w === NB ? 'neighbour' : w === RD ? 'road' : 'default'; };
  const basis = { front: dominant(sides.front), rear: dominant(sides.rear), left: dominant(sides.left), right: dominant(sides.right) };
  for (const sn of snap.snapped) basis[sn.side] = 'fence';
  const bounded = Object.values(basis).filter((b) => b !== 'default').length;
  const areaM2 = Math.round(ringAreaM2(ring));
  const houseM2 = ringAreaM2(houseRing);
  const confidence = bounded >= 3 && areaM2 >= houseM2 * 1.3 ? (bounded === 4 && snap.snapped.length >= 2 ? 'high' : 'medium') : 'low';

  return {
    source: 'estimated', estimated: true, reference: null, quality: confidence, confidence, basis,
    ring, rings: [ring], areaM2, snapped: snap.snapped,
    attribution: `Red plot outline is an estimate drawn from OpenStreetMap buildings, roads${snap.snapped.length ? ' and mapped fences/walls/hedges' : ''} (not a legal boundary).`,
  };
}

const signedArea = (p) => p.reduce((a, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x1 * y2 - x2 * y1); }, 0) / 2;
const lineX = (p, u, q, v) => { // intersection of the lines p + t*u and q + r*v (null when parallel)
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + t * u[0], p[1] + t * u[1]];
};
const segsCross = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
const isSimplePoly = (P) => { for (let i = 0; i < P.length; i++) for (let j = i + 2; j < P.length; j++) { if (i === 0 && j === P.length - 1) continue; if (segsCross(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length])) return false; } return true; };

/**
 * Moves each straight edge of an estimated outline (in the house frame: s across, d beyond the rear wall) onto a mapped fence / wall / hedge
 * that runs alongside it. A barrier is used only when it is parallel (snapAngleDeg), within snapM of the edge and covers a good part of it,
 * so a fence in the middle of the garden or a hedge round a vegetable patch is ignored. A snap that would cut into the house, push the outline
 * into a neighbouring home or make it self-crossing is undone. Returns { poly, snapped: [{ side, offsetM, kind, coverM }] }.
 */
export function snapToBarriers({ poly, barriers, houseSD = [], nbSD = [], L = PLOT_LIMITS }) {
  const P = signedArea(poly) < 0 ? [...poly].reverse() : poly;          // counter-clockwise: the outside is on the right of each edge
  const n = P.length;
  const sinMax = Math.sin((L.snapAngleDeg * Math.PI) / 180);
  const edges = P.map((a, i) => {
    const b = P[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9, u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return { a, b, len, u, nrm: [u[1], -u[0]] };
  });

  const cand = edges.map((e) => {
    const hits = [];
    for (const bar of barriers) for (let k = 0; k < bar.pts.length - 1; k++) {
      const c = bar.pts[k], d = bar.pts[k + 1], vl = Math.hypot(d[0] - c[0], d[1] - c[1]);
      if (vl < 1.5) continue;
      const v = [(d[0] - c[0]) / vl, (d[1] - c[1]) / vl];
      if (Math.abs(e.u[0] * v[1] - e.u[1] * v[0]) > sinMax) continue;     // not parallel
      const oc = (c[0] - e.a[0]) * e.nrm[0] + (c[1] - e.a[1]) * e.nrm[1], od = (d[0] - e.a[0]) * e.nrm[0] + (d[1] - e.a[1]) * e.nrm[1];
      if (Math.abs(oc - od) > 1 || Math.abs((oc + od) / 2) > L.snapM) continue;
      const tc = (c[0] - e.a[0]) * e.u[0] + (c[1] - e.a[1]) * e.u[1], td = (d[0] - e.a[0]) * e.u[0] + (d[1] - e.a[1]) * e.u[1];
      const cover = Math.min(Math.max(tc, td), e.len) - Math.max(Math.min(tc, td), 0);
      if (cover > 0.5) hits.push({ off: (oc + od) / 2, w: cover, kind: bar.kind });
    }
    if (!hits.length) return null;
    // the offset (0.5 m bins) with the most barrier alongside it; ties prefer the smaller move
    const bins = new Map();
    for (const h of hits) { const k = Math.round(h.off / 0.5); const b = bins.get(k) ?? { w: 0, sum: 0, kinds: new Map() }; b.w += h.w; b.sum += h.off * h.w; b.kinds.set(h.kind, (b.kinds.get(h.kind) ?? 0) + h.w); bins.set(k, b); }
    const [bk, best] = [...bins].sort((x, y) => y[1].w - x[1].w || Math.abs(x[0]) - Math.abs(y[0]))[0];
    if (best.w < Math.max(L.snapMinOverlapM, 0.35 * e.len)) return null;
    const kind = [...best.kinds].sort((x, y) => y[1] - x[1])[0][0];
    return { off: best.sum / best.w, cover: best.w, kind };
  });

  const build = (use) => P.map((v, i) => {
    const prev = (i - 1 + n) % n, eP = edges[prev], eN = edges[i];
    const oP = use[prev] ? cand[prev].off : 0, oN = use[i] ? cand[i].off : 0;
    if (!use[prev] && !use[i]) return v;
    const pA = [eP.a[0] + eP.nrm[0] * oP, eP.a[1] + eP.nrm[1] * oP], pB = [eN.a[0] + eN.nrm[0] * oN, eN.a[1] + eN.nrm[1] * oN];
    const x = lineX(pA, eP.u, pB, eN.u);
    if (x && Math.hypot(x[0] - v[0], x[1] - v[1]) <= 8) return x;
    const o = use[i] ? oN : oP, nr = use[i] ? eN.nrm : eP.nrm;      // (nearly) straight corner: just slide it
    return [v[0] + nr[0] * o, v[1] + nr[1] * o];
  });

  const insideOrNear = (poly2, pt, tol) => pointInRing(pt, poly2) || distToEdges(pt, edgesOf(poly2)) <= tol;
  const valid = (Q) => isSimplePoly(Q)
    && houseSD.every((p) => insideOrNear(Q, p, 0.3))
    && nbSD.every((nb) => nb.slice(0, -1).every((p) => !pointInRing(p, Q) || distToEdges(p, edgesOf(Q)) <= 0.3));

  // keep only the snaps that are fine on their own, then add them (strongest first) while the outline stays valid
  const idxs = cand.map((c, i) => (c ? i : -1)).filter((i) => i >= 0).sort((x, y) => cand[y].cover - cand[x].cover);
  const only = (i) => cand.map((_, k) => k === i);
  let use = cand.map(() => false), Q = P;
  for (const i of idxs) {
    if (!valid(build(only(i)))) continue;
    const trial = use.map((u, k) => u || k === i), T = build(trial);
    if (valid(T)) { use = trial; Q = T; }
  }
  if (!use.some(Boolean)) return { poly, snapped: [] };

  const side = ({ nrm: [x, y] }) => (Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'front' : 'rear') : (x < 0 ? 'left' : 'right'));
  return {
    poly: dropCollinear(Q),
    snapped: edges.map((e, i) => (use[i] ? { side: side(e), offsetM: Math.round(cand[i].off * 10) / 10, kind: cand[i].kind, coverM: Math.round(cand[i].cover) } : null)).filter(Boolean),
  };
}

/**
 * Registered parcels converted with the built-in grid conversion can be a few metres out. When the house is not inside the parcel, try
 * shifting the parcel (up to `maxShiftM`, 0.5 m steps) to where the house fits, preferring the smallest move. A parcel that already
 * contains the house is left exactly as it is. Returns the title unchanged when no shift makes it fit.
 */
export function alignTitleToHouse(title, houseRing, maxShiftM = 8) {
  if (!title?.ring || !houseRing || houseRing.length < 4) return title;
  const open_ = houseRing.slice(0, -1);
  const kx = 111320 * Math.cos((open_[0][1] * Math.PI) / 180), ky = 111320, [lng0, lat0] = open_[0];
  const loc = ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky];
  const back = ([x, y]) => [lng0 + x / kx, lat0 + y / ky];
  const rings = (title.rings ?? [title.ring]).map((r) => open(r.map(loc)));
  const probes = [...open_, [open_.reduce((a, p) => a + p[0], 0) / open_.length, open_.reduce((a, p) => a + p[1], 0) / open_.length]].map(loc);
  const violation = (dx, dy) => probes.reduce((sum, p) => {
    const q = [p[0] - dx, p[1] - dy];                                  // shifting the parcel by (dx,dy) = shifting the house by the opposite
    if (rings.some((r) => pointInRing(q, r))) return sum;
    return sum + Math.min(...rings.map((r) => distToEdges(q, edgesOf(r))));
  }, 0);
  const tol = 0.3 * probes.length * 0.5;
  if (violation(0, 0) <= tol) return title;
  let best = { v: violation(0, 0), dx: 0, dy: 0 };
  for (let dx = -maxShiftM; dx <= maxShiftM; dx += 0.5) for (let dy = -maxShiftM; dy <= maxShiftM; dy += 0.5) {
    const v = violation(dx, dy), m = Math.hypot(dx, dy);
    if (v < best.v - 1e-9 || (Math.abs(v - best.v) <= 1e-9 && m < Math.hypot(best.dx, best.dy))) best = { v, dx, dy };
  }
  if (best.v > tol || (best.dx === 0 && best.dy === 0)) return title;
  const shift = (r) => r.map(([lng, lat]) => { const [x, y] = loc([lng, lat]); return back([x + best.dx, y + best.dy]); });
  const shifted = (title.rings ?? [title.ring]).map(shift);
  const ring = shifted.find((r) => pointInRing(back([0, 0]), r)) ?? shifted[0];
  return { ...title, ring, rings: shifted, alignedByM: Math.round(Math.hypot(best.dx, best.dy) * 10) / 10 };
}

/**
 * Is the registered title polygon good enough to show instead of an estimate?
 * It must contain (nearly all of) the house and not be smaller than the house; otherwise it is a different / partial title.
 * House walls very often sit ON the title line (terraces, party walls) and OSM and Land Registry data differ by up to about a metre,
 * so a house corner within `TITLE_TOLERANCE_M` of the title's edge counts as inside.
 */
export const TITLE_TOLERANCE_M = 1.0;
export function titleMatchesHouse(title, houseRing) {
  if (!title?.ring) return false;
  if (!houseRing || houseRing.length < 4) return true; // nothing to compare against
  const rings = title.rings ?? [title.ring];
  const open_ = houseRing.slice(0, -1);
  const kx = 111320 * Math.cos((open_[0][1] * Math.PI) / 180), ky = 111320, [lng0, lat0] = open_[0];
  const local = ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky];
  const parts = rings.map((r) => open(r.map(local)));
  const probes = [...open_, [open_.reduce((a, p) => a + p[0], 0) / open_.length, open_.reduce((a, p) => a + p[1], 0) / open_.length]].map(local);
  const ok = (pt) => parts.some((r) => pointInRing(pt, r) || distToEdges(pt, edgesOf(r)) <= TITLE_TOLERANCE_M);
  const share = probes.filter(ok).length / probes.length;
  const area = title.areaM2 ?? rings.reduce((a, r) => a + ringAreaM2(r), 0);
  return share >= 0.75 && area >= ringAreaM2(houseRing) * 1.05; // a title no bigger than the house is the house alone, not a plot
}

/**
 * Picks the plot outline to show. `mode`: 'auto' (title when it matches the house, else the estimate), 'title' (title only), 'estimate' (always estimate).
 * Returns { plot, note } where `note` explains a fallback to the applicant.
 */
export function choosePlot({ title: rawTitle, estimate, houseRing, mode = 'auto' }) {
  const title = rawTitle?.approxM > 1 ? alignTitleToHouse(rawTitle, houseRing, Math.min(8, rawTitle.approxM * 1.5 + 0.5)) : rawTitle; // a few metres of conversion error must not make a real parcel look wrong
  if (mode === 'estimate') return { plot: estimate ?? null, note: estimate ? null : 'A plot outline could not be estimated for this property.' };
  const good = titleMatchesHouse(title, houseRing);
  if (good) return { plot: title, note: null };
  if (mode === 'title') return { plot: title ?? null, note: null };
  if (estimate) {
    return { plot: estimate, note: title ? 'The registered title boundary found does not match the house, so an estimated plot outline (from neighbouring buildings and roads) is shown instead – please check it.' : 'No registered title boundary was found, so an estimated plot outline (from neighbouring buildings and roads) is shown – please check it.' };
  }
  return { plot: null, note: null };
}
