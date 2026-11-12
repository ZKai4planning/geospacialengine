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

const isMulti = (c) => Array.isArray(c[0]?.[0]);   // a list of rings rather than a single ring
const asParts = (c) => (isMulti(c) ? c : [c]);

/** True if the point is inside any of the rings (a single ring or a list of rings). */
export const pointInAny = (pt, container) => asParts(container).some((r) => pointInPoly(pt, r));

/** Shortest outline-to-outline distance from polygon A to any ring in `container`. */
export const edgeDistanceAny = (A, container) => Math.min(...asParts(container).map((r) => edgeDistance(A, r)));

/**
 * How much of polygon P lies OUTSIDE `container`, ignoring anything within `tol` metres of the container's outline
 * (map data is only accurate to about that). `container` may be one ring or several parts of the same title
 * (a title can be made of separate pieces, e.g. house + detached garage). Returns { areaM2, maxDepthM }.
 */
export function outsideStats(P, container, tol = 0.5, step = 0.1) {
  const parts = asParts(container);
  const bb = bbox(P), ec = parts.flatMap(edges);
  let n = 0, maxD = 0;
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const pt = [x, y];
      if (!pointInPoly(pt, P) || parts.some((r) => pointInPoly(pt, r))) continue;
      const d = Math.min(...ec.map(([a, b]) => pointSegDist(pt, a, b)));
      if (d <= tol) continue;
      n++; maxD = Math.max(maxD, d);
    }
  }
  return { areaM2: n * step * step, maxDepthM: maxD };
}

export function pointPolyDistance(pt, poly) {
  if (pointInPoly(pt, poly)) return 0;
  return Math.min(...edges(poly).map(([a, b]) => pointSegDist(pt, a, b)));
}

/** Distance from a filled polygon to an open polyline (0 if the line touches, crosses or lies inside the polygon). */
export function polyToLineDistance(P, line) {
  if (!line || line.length < 2) return Infinity;
  if (line.some((pt) => pointInPoly(pt, P))) return 0;
  const eP = edges(P);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    for (const [p1, p2] of eP) {
      if (segmentsIntersect(a, b, p1, p2)) return 0;
      best = Math.min(best, pointSegDist(a, p1, p2), pointSegDist(b, p1, p2), pointSegDist(p1, a, b), pointSegDist(p2, a, b));
    }
  }
  return best;
}

/** True if no two NON-adjacent edges of the ring cross (a "simple" polygon: no bow-ties). */
export function isSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a vertex
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Nearest point to `p` on segment a-b. */
export function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Wall-by-wall contact between polygon P (the new work) and the OUTLINE of each ring in `targets`.
 * For every wall (edge) of P it walks along the wall in `step` metre samples and reports
 *   nearestM   the closest the wall gets to the target outline (samples inside the target count as 0),
 *   contactM   how much of the wall's length lies within `touchM` of the outline (a wall built against it),
 *   nearM      how much lies within `nearM` metres,
 *   insideM    how much lies INSIDE the target (an overlap, not just a touch),
 *   pair       [point on the wall, point on the outline] at the closest sample, for drawing a measuring line.
 * `solid: false` is for a container such as the title boundary, where standing inside it is normal and only the distance to its outline matters.
 * Returns one record per wall, in the order of P's edges.
 */
export function wallContacts(P, targets, { touchM = 0.3, nearM = 1, step = 0.1, solid = true } = {}) {
  const tEdges = targets.flatMap(edges);
  return edges(P).map(([a, b], i) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    let nearest = Infinity, pair = null, touch = 0, near = 0, inside = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, s = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let d = Infinity, hit = null;
      for (const [c, e] of tEdges) { const q = closestOnSeg(s, c, e), dd = Math.hypot(s[0] - q[0], s[1] - q[1]); if (dd < d) { d = dd; hit = q; } }
      // a sample clearly INSIDE a solid target (a building) is an overlap; for a container (the title boundary) being inside is the normal case, so only the outline distance counts
      if (solid && d > touchM && targets.some((r) => pointInPoly(s, r))) { d = 0; inside++; }
      if (d < nearest) { nearest = d; pair = [s, hit]; }
      if (d <= touchM) touch++;
      if (d <= nearM) near++;
    }
    return { index: i, from: a, to: b, lengthM: len, nearestM: nearest, contactM: (touch / n) * len, nearM: (near / n) * len, insideM: (inside / n) * len, pair };
  });
}
