import { projector, open, pointSegDist, segmentsIntersect } from '../utils/polygons.js';

/**
 * The public strip drawn on the map: the land between the plot's road-facing boundary and the road's carriageway edge
 * (pavement / verge / highway). Same idea as rules/publicLand.js: a plot corner "faces the road" when the straight line
 * from it to the nearest point of the road does not cross the plot. The corners that face the road, plus their points on
 * the carriageway edge, enclose the strip. Works for a road at any angle to the plot.
 *
 *   plotRings : [[lng,lat],...]   (closed or open rings; the parts of one title)
 *   roads     : [{ name, widthM, ignore, line: [[lng,lat],...] }]
 * Returns [{ ring (closed lng/lat), gapM, areaM2, frontageM (length of plot boundary facing the road), roadName }]  - one per road that has a visible strip.
 */
const MIN_AREA_M2 = 1, RANGE_M = 30;
const r1 = (n) => Math.round(n * 10) / 10;

export function publicStrips({ plotRings, roads }) {
  const rings = (plotRings ?? []).filter((r) => r?.length > 3);
  if (!rings.length || !roads?.length) return [];
  const all = rings.flat();
  const c = [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
  const proj = projector(c[1], c[0]);
  const kx = 111320 * Math.cos((c[1] * Math.PI) / 180), ky = 111320;
  const back = ([x, y]) => [c[0] + x / kx, c[1] + y / ky];
  const parts = rings.map((r) => open(r.map(proj)));
  const edges = parts.flatMap((p, pi) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length], pi, i })));

  const out = [];
  for (const road of roads) {
    if (road.ignore || !road.line || road.line.length < 2) continue;
    const line = road.line.map(proj), half = (road.widthM ?? 5) / 2;
    const nearest = (pt) => {
      let best = { d: Infinity, p: null };
      for (let i = 0; i < line.length - 1; i++) {
        const [a, b] = [line[i], line[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2)) : 0;
        const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
        if (d < best.d) best = { d, p: q };
      }
      return best;
    };

    for (const part of parts) {
      const n = part.length;
      let sa = 0;
      for (let i = 0; i < n; i++) { const [x1, y1] = part[i], [x2, y2] = part[(i + 1) % n]; sa += x1 * y2 - x2 * y1; }
      const ccw = sa > 0;
      // an EDGE faces the road when its outward normal points towards the road and the line from its middle to the road does not cross the plot
      const facing = part.map((p, i) => {
        const q = part[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
        if (len < 0.5) return false;
        const nrm = ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], nr = nearest(mid);
        if (nr.d <= half || nr.d - half > RANGE_M) return false;
        const dir = [(nr.p[0] - mid[0]) / nr.d, (nr.p[1] - mid[1]) / nr.d];
        if (nrm[0] * dir[0] + nrm[1] * dir[1] < 0.3) return false;
        return !edges.some((e) => !(e.a === p && e.b === q) && segmentsIntersect(mid, nr.p, e.a, e.b));
      });
      // longest run of consecutive facing edges (the ring wraps around)
      let best = [], run = [];
      const start = facing.findIndex((f) => !f);
      if (start < 0) continue;
      for (let k = 1; k <= n; k++) {
        const i = (start + k) % n;
        if (facing[i]) run.push(i); else { if (run.length > best.length) best = run; run = []; }
      }
      if (run.length > best.length) best = run;
      if (!best.length) continue;
      const idx = [...best.map((i) => i), (best[best.length - 1] + 1) % n];
      const pts = idx.map((i) => {
        const v = part[i], nr = nearest(v);
        if (nr.d <= half) return { v, edge: v, gap: 0 };            // the corner is already on the carriageway
        const u = [(v[0] - nr.p[0]) / nr.d, (v[1] - nr.p[1]) / nr.d];
        return { v, edge: [nr.p[0] + u[0] * half, nr.p[1] + u[1] * half], gap: nr.d - half };
      });
      const poly = [...pts.map((x) => x.v), ...pts.map((x) => x.edge).reverse()];
      let a = 0;
      for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
      const area = Math.abs(a / 2), gap = Math.min(...pts.map((x) => x.gap));
      const frontage = best.reduce((sum, i) => sum + Math.hypot(part[(i + 1) % n][0] - part[i][0], part[(i + 1) % n][1] - part[i][1]), 0);
      if (area < MIN_AREA_M2) continue;
      const ring = poly.map(back); ring.push(ring[0]);
      out.push({ ring, gapM: r1(gap), areaM2: r1(area), frontageM: r1(frontage), roadName: road.name ?? null });
    }
  }
  return out;
}
