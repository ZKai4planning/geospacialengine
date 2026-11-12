/**
 * British National Grid (EPSG:27700) -> WGS84 lng/lat, no dependencies.
 *
 *   1. inverse Transverse Mercator on the Airy 1830 ellipsoid (OS "A guide to coordinate systems in Great Britain"),
 *   2. the OSGB36 -> WGS84 7-parameter Helmert transformation.
 *
 * ACCURACY: the Helmert step is good to roughly 2-5 m (it cannot model the real distortions of the national grid; OS's
 * OSTN15 grid does, to a few centimetres, but it is a large licensed data file). That is plenty to find which parcel a house
 * is in, and the app aligns a parcel to the house outline (see alignTitleToHouse in plotEstimate.js). If you need sub-metre
 * positions, convert with GDAL instead (ogr2ogr -t_srs EPSG:4326 -f GeoJSONSeq ...; PROJ uses OSTN15 when its grid is installed)
 * and import the GeoJSON - scripts/import-inspire.js accepts it.
 */
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

const AIRY = { a: 6377563.396, b: 6356256.909 };
const WGS84 = { a: 6378137, b: 6356752.314245 };
const TM = { F0: 0.9996012717, lat0: rad(49), lon0: rad(-2), N0: -100000, E0: 400000 };
const HELMERT = { tx: 446.448, ty: -125.157, tz: 542.06, s: -20.4894e-6, rx: rad(0.1502 / 3600), ry: rad(0.247 / 3600), rz: rad(0.8421 / 3600) };

/** easting, northing (metres) -> OSGB36 latitude/longitude in radians */
export function gridToOsgb36(E, N) {
  const { a, b } = AIRY, { F0, lat0, lon0, N0, E0 } = TM;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;
  let phi = lat0, M = 0;
  do {
    phi = (N - N0 - M) / (a * F0) + phi;
    const dp = phi - lat0, sp = phi + lat0;
    M = b * F0 * ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dp
      - (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dp) * Math.cos(sp)
      + ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dp) * Math.cos(2 * sp)
      - (35 / 24) * n3 * Math.sin(3 * dp) * Math.cos(3 * sp));
  } while (Math.abs(N - N0 - M) >= 1e-5);
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi), sec = 1 / cos;
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1, t2 = tan * tan, t4 = t2 * t2, t6 = t4 * t2;
  const VII = tan / (2 * rho * nu);
  const VIII = (tan / (24 * rho * nu ** 3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = (tan / (720 * rho * nu ** 5)) * (61 + 90 * t2 + 45 * t4);
  const X = sec / nu;
  const XI = (sec / (6 * nu ** 3)) * (nu / rho + 2 * t2);
  const XII = (sec / (120 * nu ** 5)) * (5 + 28 * t2 + 24 * t4);
  const XIIA = (sec / (5040 * nu ** 7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
  const dE = E - E0;
  return {
    lat: phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6,
    lon: lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7,
  };
}

/** OSGB36 lat/lon (radians) -> WGS84 lat/lon (radians) */
function osgb36ToWgs84({ lat, lon }) {
  const { a, b } = AIRY, e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const x = nu * Math.cos(lat) * Math.cos(lon), y = nu * Math.cos(lat) * Math.sin(lon), z = (1 - e2) * nu * Math.sin(lat);
  const { tx, ty, tz, s, rx, ry, rz } = HELMERT;
  const x2 = tx + x * (1 + s) - y * rz + z * ry;
  const y2 = ty + x * rz + y * (1 + s) - z * rx;
  const z2 = tz - x * ry + y * rx + z * (1 + s);
  const { a: A, b: B } = WGS84, E2 = 1 - (B * B) / (A * A), p = Math.hypot(x2, y2);
  let phi = Math.atan2(z2, p * (1 - E2)), prev;
  do { prev = phi; const NU = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2); phi = Math.atan2(z2 + E2 * NU * Math.sin(phi), p); } while (Math.abs(phi - prev) > 1e-12);
  return { lat: phi, lon: Math.atan2(y2, x2) };
}

/** [easting, northing] -> [lng, lat] in degrees (WGS84) */
export function bngToWgs84(E, N) {
  const w = osgb36ToWgs84(gridToOsgb36(E, N));
  return [deg(w.lon), deg(w.lat)];
}

/** Rough "is this inside the British National Grid" test (also tells BNG metres apart from degrees). */
export const looksLikeBng = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 700000 && y >= 0 && y <= 1300000 && (Math.abs(x) > 180 || Math.abs(y) > 90);
