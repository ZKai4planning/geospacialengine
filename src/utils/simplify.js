/**
 * Ramer-Douglas-Peucker simplification for [lng, lat] rings, tolerance in metres, with a hard cap on the number of points
 * (a conservation area outline can have thousands of vertices; the map only needs its shape).
 */
export function simplifyRing(ring, { tolM = 2, maxPts = 300 } = {}) {
  if (!ring || ring.length <= 4) return ring ?? [];
  const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const P = ring.slice(0, -1).map(([x, y]) => [x * kx, y * ky]);
  const keep = (tol) => {
    const flags = new Array(P.length).fill(false); flags[0] = flags[P.length - 1] = true;
    const stack = [[0, P.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let dmax = 0, idx = -1;
      const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const t = l2 ? Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / l2)) : 0;
        const d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > tol && idx > 0) { flags[idx] = true; stack.push([a, idx], [idx, b]); }
    }
    return flags;
  };
  let tol = tolM, flags = keep(tol);
  while (flags.filter(Boolean).length > maxPts && tol < 500) { tol *= 1.6; flags = keep(tol); }   // still too many: loosen until it fits
  const out = ring.slice(0, -1).filter((_, i) => flags[i]);
  return out.length >= 3 ? [...out, out[0]] : ring;
}
