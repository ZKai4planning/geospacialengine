import readline from 'node:readline';
import { bngToWgs84, looksLikeBng } from './bng.js';
import { ringAreaM2 } from './geo.js';

/**
 * Readers for HM Land Registry INSPIRE Index Polygons (the free "cadastral parcels" download, one GML file per council,
 * coordinates in British National Grid) and for GeoJSON / GeoJSON-lines (what `ogr2ogr -t_srs EPSG:4326` produces).
 *
 * Every reader yields features of the shape  { inspireId, rings: [[lng, lat], ...][] }   (WGS84, closed outer rings; holes are dropped).
 * The GML reader is deliberately tolerant (any namespace prefix, <gml:coordinates> or <gml:posList>, Polygon or MultiSurface)
 * because the exact flavour of the file can differ between downloads.
 */

const tag = (name) => `(?:[A-Za-z0-9_]+:)?${name}`;
const BLOCK = new RegExp(`<${tag('(featureMember|PREDEFINED)')}\\b[\\s\\S]*?<\\/${tag('\\1')}>`, 'g');
const POLY = new RegExp(`<${tag('Polygon')}\\b[^>]*>([\\s\\S]*?)<\\/${tag('Polygon')}>`, 'g');
const EXTERIOR = new RegExp(`<${tag('(?:exterior|outerBoundaryIs)')}\\b[^>]*>([\\s\\S]*?)<\\/${tag('(?:exterior|outerBoundaryIs)')}>`);
const COORDS = new RegExp(`<${tag('(?:coordinates|posList)')}\\b[^>]*>([^<]+)<\\/${tag('(?:coordinates|posList)')}>`);
const INSPIRE_ID = new RegExp(`<${tag('(?:INSPIREID|inspireId|INSPIRE_ID)')}\\b[^>]*>([^<]+)<\\/`, 'i');
const SRS = /srsName="([^"]+)"/;

/** "x,y x,y ..." (gml:coordinates) or "x y x y ..." (gml:posList) -> [[x, y], ...] */
export function parseCoordList(text) {
  const t = text.trim();
  const nums = t.includes(',') ? t.split(/\s+/).flatMap((p) => p.split(',')) : t.split(/\s+/);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]), y = Number(nums[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** Projected / geographic pair -> [lng, lat]. `crs`: 'bng' | 'wgs84' | 'auto' (decided from the numbers). */
export const conversionStats = { bng: 0 }; // how many coordinates went through the built-in (approximate) grid conversion
export function toLngLat([x, y], crs = 'auto') {
  if (crs === 'bng' || (crs === 'auto' && looksLikeBng(x, y))) { conversionStats.bng++; return bngToWgs84(x, y); }
  return [x, y];
}

const round7 = (n) => Math.round(n * 1e7) / 1e7;
function cleanRing(pts) {
  const r = [];
  for (const p of pts) { const q = [round7(p[0]), round7(p[1])]; if (!r.length || r.at(-1)[0] !== q[0] || r.at(-1)[1] !== q[1]) r.push(q); }
  if (r.length && (r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1])) r.push(r[0]);
  return r.length >= 4 ? r : null;
}

/** One <featureMember>/<PREDEFINED> block -> feature (or null). */
export function parseGmlFeature(block, { crs = 'auto' } = {}) {
  const srs = SRS.exec(block)?.[1] ?? '';
  const effective = crs !== 'auto' ? crs : /27700/.test(srs) ? 'bng' : /4326|4258|CRS84/i.test(srs) ? 'wgs84-unsupported' : 'auto';
  if (effective === 'wgs84-unsupported') throw new Error(`GML in ${srs} is not supported (axis order differs between files). Convert it with: ogr2ogr -t_srs EPSG:4326 -f GeoJSONSeq out.geojsonl in.gml`);
  const rings = [];
  for (const m of block.matchAll(POLY)) {
    const outer = EXTERIOR.exec(m[1])?.[1] ?? m[1];
    const list = COORDS.exec(outer)?.[1];
    if (!list) continue;
    const ring = cleanRing(parseCoordList(list).map((p) => toLngLat(p, effective)));
    if (ring) rings.push(ring);
  }
  if (!rings.length) return null;
  const id = INSPIRE_ID.exec(block)?.[1]?.trim() ?? /gml:id="([^"]+)"/.exec(block)?.[1] ?? null;
  return { inspireId: id, rings };
}

/** Streams a GML file (any size) and yields one feature per feature member. */
export async function* parseGmlStream(readable, opts = {}) {
  let buf = '';
  for await (const chunk of readable) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let end = 0;
    BLOCK.lastIndex = 0;
    for (let m; (m = BLOCK.exec(buf)); end = BLOCK.lastIndex) {
      const f = parseGmlFeature(m[0], opts);
      if (f) yield f;
    }
    buf = buf.slice(end);
    if (buf.length > 50_000_000) buf = buf.slice(-1_000_000); // safety: never grow without bound on a malformed file
  }
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}
function featureFromGeoJson(f, { crs = 'auto' } = {}) {
  const rings = polygonsOf(f?.geometry).map((p) => cleanRing((p[0] ?? []).map((c) => toLngLat(c, crs)))).filter(Boolean);
  if (!rings.length) return null;
  const p = f.properties ?? {};
  const id = p.INSPIREID ?? p.inspireid ?? p.inspire_id ?? p.INSPIRE_ID ?? p.id ?? f.id ?? null;
  return { inspireId: id == null ? null : String(id), rings };
}

/** GeoJSON-lines (one Feature per line, optional RS prefix) or a single FeatureCollection. */
export async function* parseGeoJsonStream(readable, opts = {}) {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let whole = null;
  for await (const raw of rl) {
    const line = raw.replace(/^\u001e/, '').trim();
    if (!line) continue;
    if (whole !== null) { whole += line; continue; }
    if (line.startsWith('{') && line.endsWith('}') && /"type"\s*:\s*"Feature"/.test(line) && !/"FeatureCollection"/.test(line.slice(0, 60))) {
      try { const f = featureFromGeoJson(JSON.parse(line), opts); if (f) yield f; continue; } catch { /* fall through: pretty-printed JSON */ }
    }
    whole = line;
  }
  if (whole) {
    const doc = JSON.parse(whole);
    for (const f of doc.type === 'FeatureCollection' ? doc.features ?? [] : [doc]) { const g = featureFromGeoJson(f, opts); if (g) yield g; }
  }
}

/** Parcel area in square metres. */
export const parcelAreaM2 = (ring) => Math.round(ringAreaM2(ring) * 10) / 10;

/** feature -> one row per polygon, in the shape of the `inspire_parcels` table. */
export function featureRows(feature, council) {
  return feature.rings.map((ring) => {
    const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    return {
      inspireId: feature.inspireId, council, parts: Math.min(feature.rings.length, 32000), areaM2: parcelAreaM2(ring),
      bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      flat: ring.flatMap(([lng, lat]) => [Math.round(lng * 1e7), Math.round(lat * 1e7)]),
    };
  });
}

const copyText = (v) => (v == null ? '\\N' : String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r'));

/** One line of `COPY inspire_parcels (inspire_id, council, parts, area_m2, bbox, ring_e7) FROM STDIN` (tab-separated text format). */
export function copyLine(r) {
  const [x0, y0, x1, y1] = r.bbox;
  return [copyText(r.inspireId), copyText(r.council), r.parts, r.areaM2, `(${x1},${y1}),(${x0},${y0})`, `{${r.flat.join(',')}}`].join('\t') + '\n';
}
