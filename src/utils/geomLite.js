/** Small planar helpers (metres), self-contained so the site-data modules can be tested on their own. Rings are arrays of [x, y]. */
export const openRing = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

/** [lng, lat] -> local metres around (lat0, lng0). Same flat-earth approximation the rest of the engine uses. */
export function localProjector(lat0, lng0) {
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), my = 111320;
  return ([lng, lat]) => [(lng - lng0) * mx, (lat - lat0) * my];
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the nearest edge of a ring (open or closed). */
export function ringEdgeDistance(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

/** q-th quantile (0..1) of a numeric array, linear interpolation. NaN for an empty array. */
export function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
