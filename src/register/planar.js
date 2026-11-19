import { localProjector, pointInRing, ringEdgeDistance, segDist, openRing } from '../utils/geomLite.js';

/** Small planar geometry helpers for the register's own checks. Rings / lines are arrays of [x, y] in METRES unless a function says [lng, lat]. */
export { localProjector, pointInRing, ringEdgeDistance, segDist, openRing };

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
export function segsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Shortest distance between two closed rings (0 when they touch, cross or one contains the other). */
export function ringDistance(A, B) {
  if (A.some((p) => pointInRing(p, B)) || B.some((p) => pointInRing(p, A))) return 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segsIntersect(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return 0;
  return Math.min(...A.map((p) => ringEdgeDistance(p, B)), ...B.map((p) => ringEdgeDistance(p, A)));
}

/** Shortest distance from a closed ring to an open polyline (0 when the line enters or crosses the ring). */
export function ringToLineDistance(R, line) {
  if (line.some((p) => pointInRing(p, R))) return 0;
  for (let i = 0; i + 1 < line.length; i++) for (let j = 0; j < R.length; j++) if (segsIntersect(line[i], line[i + 1], R[j], R[(j + 1) % R.length])) return 0;
  let best = Infinity;
  for (const p of line) best = Math.min(best, ringEdgeDistance(p, R));
  for (const p of R) for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, segDist(p, line[i], line[i + 1]));
  return best;
}

export const inTriangle = (p, a, b, c) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };

/** Does a polyline or ring touch a triangle? (any vertex inside it, or any edge crossing one of its edges) */
export function touchesTriangle(pts, tri, closed = false) {
  if (pts.some((p) => inTriangle(p, ...tri))) return true;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) if (segsIntersect(pts[i], pts[(i + 1) % pts.length], tri[k], tri[(k + 1) % 3])) return true;
  return false;
}

/** The closest point of an open polyline to p, with the unit direction of that segment. */
export function nearestOnLine(p, line) {
  let best = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const q = [ax + t * dx, ay + t * dy], d = Math.hypot(p[0] - q[0], p[1] - q[1]), len = Math.sqrt(l2) || 1;
    if (!best || d < best.d) best = { q, d, dir: [dx / len, dy / len] };
  }
  return best;
}
