/**
 * Reads the Development High Risk Area polygons from GeoJSON (one FeatureCollection) or GeoJSON lines (one Feature per line).
 * Coordinates must already be WGS84 longitude / latitude. Convert the shapefile first (it is in National Grid):
 *     ogr2ogr -f GeoJSONSeq dhra.geojsonl -t_srs EPSG:4326 DevelopmentHighRiskArea.shp
 * Returns [{ ref, name, parts, bbox: [minLng, minLat, maxLng, maxLat] }].
 */
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const GB = { minLng: -9.5, maxLng: 2.5, minLat: 49.5, maxLat: 61.5 };
const FIX = 'Convert it first: ogr2ogr -f GeoJSONSeq out.geojsonl -t_srs EPSG:4326 <file>';

function ringOf(coords) {
  const ring = coords.map(([x, y]) => {
    if (!(x >= GB.minLng && x <= GB.maxLng && y >= GB.minLat && y <= GB.maxLat)) throw new Error(`Coordinate ${x}, ${y} is not WGS84 longitude/latitude in Great Britain. ${FIX}`);
    return [r6(x), r6(y)];
  });
  if (ring.length < 4) throw new Error('A ring needs at least 4 points.');
  return ring;
}

function featureOf(f, i) {
  const g = f?.geometry;
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const parts = polys.map((p) => p.map(ringOf));
  const all = parts.flat(2);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]), pr = f.properties ?? {};
  return {
    ref: String(pr.GLOBALID ?? pr.OBJECTID ?? pr.FID ?? pr.id ?? i), name: pr.CLASS_NAME ?? pr.ADVICETYPE ?? pr.ADVICE_TYPE ?? pr.name ?? null,
    parts, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

export function parseCoalGeoJson(text) {
  const t = String(text).trim();
  let feats;
  if (t.startsWith('{') && /"FeatureCollection"/.test(t.slice(0, 200))) feats = JSON.parse(t).features ?? [];
  else feats = t.split(/\r?\n/).map((l) => l.trim().replace(/^\x1e/, '')).filter(Boolean).map((l) => JSON.parse(l));   // GeoJSONSeq may start lines with RS (0x1e)
  const out = feats.map(featureOf).filter(Boolean);
  if (!out.length) throw new Error('No polygons found in the file.');
  return out;
}

/** Postgres box literal: (maxX,maxY),(minX,minY). */
export const boxLiteral = ([x0, y0, x1, y1]) => `(${x1},${y1}),(${x0},${y0})`;
