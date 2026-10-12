const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial compass bearing (0-360) from `from` to `to`. Used to point Street View at the property. */
export function bearing(from, to) {
  const p1 = rad(from.lat), p2 = rad(to.lat), dl = rad(to.lng - from.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Area (m²) of a [lng,lat] ring using a local equirectangular projection (fine at building scale). */
export function ringAreaM2(ring) {
  const lat0 = rad(ring.reduce((s, p) => s + p[1], 0) / ring.length);
  const pts = ring.map(([lng, lat]) => [R * rad(lng) * Math.cos(lat0), R * rad(lat)]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const ringCentroid = (ring) => ({
  lng: ring.reduce((s, p) => s + p[0], 0) / ring.length,
  lat: ring.reduce((s, p) => s + p[1], 0) / ring.length,
});
