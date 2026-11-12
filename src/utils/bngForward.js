/**
 * WGS84 / ETRS89 latitude, longitude  ->  British National Grid (EPSG:27700) eastings / northings.
 *
 * Method: 7-parameter Helmert shift WGS84 -> OSGB36 (OS "A guide to coordinate systems in Great Britain", annexe C),
 * then the Transverse Mercator projection on the Airy 1830 ellipsoid. Good to about 2-5 m. Sub-metre needs OSTN15 (a grid file).
 * Callers that need to line something up with a building (LiDAR) must therefore allow for a few metres of shift.
 */
const rad = (d) => (d * Math.PI) / 180;
const AS = Math.PI / (180 * 3600);                         // one arc-second in radians

const WGS84 = { a: 6378137.0, b: 6356752.3141 };
const AIRY = { a: 6377563.396, b: 6356256.909 };
// OSGB36 -> WGS84 parameters; WGS84 -> OSGB36 is the same set with every sign flipped
const H = { tx: -446.448, ty: 125.157, tz: -542.06, s: 20.4894, rx: -0.1502, ry: -0.247, rz: -0.8421 };

function toCartesian(latR, lonR, { a, b }) {
  const e2 = 1 - (b * b) / (a * a), nu = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  return [nu * Math.cos(latR) * Math.cos(lonR), nu * Math.cos(latR) * Math.sin(lonR), nu * (1 - e2) * Math.sin(latR)];
}
function toGeodetic([x, y, z], { a, b }) {
  const e2 = 1 - (b * b) / (a * a), p = Math.hypot(x, y), lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2), next = Math.atan2(z + e2 * nu * Math.sin(lat), p);
    if (Math.abs(next - lat) < 1e-12) { lat = next; break; }
    lat = next;
  }
  return [lat, lon];
}

/** WGS84 degrees -> OSGB36 degrees (Airy 1830). */
export function wgs84ToOsgb36(latDeg, lonDeg) {
  const [x, y, z] = toCartesian(rad(latDeg), rad(lonDeg), WGS84);
  const tx = -H.tx, ty = -H.ty, tz = -H.tz, s = -H.s / 1e6 + 1, rx = -H.rx * AS, ry = -H.ry * AS, rz = -H.rz * AS;
  const p = [tx + x * s - y * rz + z * ry, ty + x * rz + y * s - z * rx, tz - x * ry + y * rx + z * s];
  const [lat, lon] = toGeodetic(p, AIRY);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** OSGB36 degrees -> National Grid metres (OS guide, annexe C, Transverse Mercator forward). */
export function osgb36ToBng(latDeg, lonDeg) {
  const { a, b } = AIRY, F0 = 0.9996012717, lat0 = rad(49), lon0 = rad(-2), N0 = -100000, E0 = 400000;
  const phi = rad(latDeg), lam = rad(lonDeg), e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin), rho = (a * F0 * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5, eta2 = nu / rho - 1;
  const dphi = phi - lat0, sphi = phi + lat0;
  const M = b * F0 * ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * dphi
    - (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(dphi) * Math.cos(sphi)
    + ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * dphi) * Math.cos(2 * sphi)
    - (35 / 24) * n ** 3 * Math.sin(3 * dphi) * Math.cos(3 * sphi));
  const I = M + N0, II = (nu / 2) * sin * cos, III = (nu / 24) * sin * cos ** 3 * (5 - tan ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sin * cos ** 5 * (61 - 58 * tan ** 2 + tan ** 4);
  const IV = nu * cos, V = (nu / 6) * cos ** 3 * (nu / rho - tan ** 2), VI = (nu / 120) * cos ** 5 * (5 - 18 * tan ** 2 + tan ** 4 + 14 * eta2 - 58 * tan ** 2 * eta2);
  const d = lam - lon0;
  return { e: E0 + IV * d + V * d ** 3 + VI * d ** 5, n: I + II * d ** 2 + III * d ** 4 + IIIA * d ** 6 };
}

/** WGS84 lat/lng degrees -> { e, n } on the National Grid. */
export function wgs84ToBng(lat, lng) {
  const o = wgs84ToOsgb36(lat, lng);
  return osgb36ToBng(o.lat, o.lon);
}
