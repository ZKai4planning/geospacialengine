// Small planar-geometry helpers in LOCAL METRES (x = east, y = north). Rings are arrays of [x, y]; closed or open both work.
import { pointInRing } from './geo.js';

const M_PER_DEG = 111320;
const rad = (d) => (d * Math.PI) / 180;

/** lng/lat -> local metres around (lat0, lng0). Fine at building / plot scale. */
export function projector(lat0, lng0) {
  const kx = M_PER_DEG * Math.cos(rad(lat0));
  return ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG];
}

/** Drops a repeated closing vertex. */
export function open(ring) {
  const n = ring.length;
  return n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? ring.slice(0, -1) : ring;
}

export const pointInPoly = pointInRing;

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

export const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSeg = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(p3, p4, p1)) || (d2 === 0 && onSeg(p3, p4, p2)) || (d3 === 0 && onSeg(p1, p2, p3)) || (d4 === 0 && onSeg(p1, p2, p4));
}

export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const edges = (pts) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);

/** Shortest distance between the OUTLINES of two polygons (0 if they cross or touch). */
export function edgeDistance(A, B) {
  let best = Infinity;
  const eb = edges(B);
  for (const [a1, a2] of edges(A)) {
    for (const [b1, b2] of eb) {
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
      best = Math.min(best, pointSegDist(a1, b1, b2), pointSegDist(a2, b1, b2), pointSegDist(b1, a1, a2), pointSegDist(b2, a1, a2));
    }
  }
  return best;
}

/** Distance between two filled polygons (0 if they overlap, touch, or one contains the other). */
export function polyDistance(A, B) {
  if (pointInPoly(A[0], B) || pointInPoly(B[0], A)) return 0;
  return edgeDistance(A, B);
}

const bbox = (pts) => ({ minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) });

/** Area (m²) shared by polygons A and B, by sampling a grid (works for any simple polygons, concave too). */
export function overlapArea(A, B, step = 0.1) {
  const a = bbox(A), b = bbox(B);
  const x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX), y0 = Math.max(a.minY, b.minY), y1 = Math.min(a.maxY, b.maxY);
  if (x0 >= x1 || y0 >= y1) return 0;
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPoly([x, y], A) && pointInPoly([x, y], B)) n++;
  return n * step * step;
}

/**
 * How much of polygon P lies OUTSIDE `container`, ignoring anything within `tol` metres of the container's outline
 * (map data is only accurate to about that). Returns { areaM2, maxDepthM }.
 */
export function outsideStats(P, container, tol = 0.5, step = 0.1) {
  const bb = bbox(P), ec = edges(container);
  let n = 0, maxD = 0;
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const pt = [x, y];
      if (!pointInPoly(pt, P) || pointInPoly(pt, container)) continue;
      const d = Math.min(...ec.map(([a, b]) => pointSegDist(pt, a, b)));
      if (d <= tol) continue;
      n++; maxD = Math.max(maxD, d);
    }
  }
  return { areaM2: n * step * step, maxDepthM: maxD };
}
