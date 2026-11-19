import { bngToWgs84, looksLikeBng } from '../utils/bng.js';
import { bboxOf, normPostcode } from './geo.js';

/**
 * Turns a file you exported from GIS (GeoJSON, GeoJSON-lines or CSV) into rows for geo_features.
 *
 *   options.crs          'auto' (default: British National Grid metres are detected), '4326' or '27700'
 *   options.nameField / refField / keyField / ratingField    which source column feeds name / ref / key / the dataset's rating property
 *   options.keep         list of source columns to keep as props (default: all, capped); numbers and true/false are converted
 *
 * Big national files: export as GeoJSON-lines (ogr2ogr -f GeoJSONSeq ...) so the importer can stream them; a single FeatureCollection is read whole.
 */
const GEOMS = new Set(['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'Point', 'MultiPoint']);
const MAX_PROPS = 40, MAX_TEXT = 400;

const num = (v) => (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);
const clean = (v) => { const n = num(v); if (typeof n === 'string') { const t = n.trim(); if (/^(true|yes)$/i.test(t)) return true; if (/^(false|no)$/i.test(t)) return false; return t.slice(0, MAX_TEXT); } return n; };

function reprojectCoords(c, toWgs) {
  if (typeof c?.[0] === 'number') return toWgs(c[0], c[1]);
  return Array.isArray(c) ? c.map((x) => reprojectCoords(x, toWgs)) : c;
}
function firstCoord(c) { while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; return c; }

/** One GeoJSON feature -> a row, or null when it has no usable geometry. */
export function rowFromFeature(f, options = {}) {
  const g = f?.geometry;
  if (!g || !GEOMS.has(g.type)) return null;
  const crs = String(options.crs ?? 'auto');
  const probe = firstCoord(g.coordinates);
  const isBng = crs === '27700' || (crs === 'auto' && looksLikeBng(probe?.[0], probe?.[1]));
  const geom = isBng ? { type: g.type, coordinates: reprojectCoords(g.coordinates, (e, n) => bngToWgs84(e, n)) } : g;
  const bb = bboxOf(geom);
  if (!bb || bb[0] < -9 || bb[2] > 3 || bb[1] < 49 || bb[3] > 61) return null;   // not in the UK: wrong CRS or a stray feature
  const src = f.properties ?? {};
  const pick = (k) => (k && src[k] != null && src[k] !== '' ? String(src[k]).slice(0, MAX_TEXT) : null);
  const props = {};
  for (const k of (options.keep ?? Object.keys(src)).slice(0, MAX_PROPS)) if (src[k] != null && src[k] !== '') props[k] = clean(src[k]);
  if (options.ratingField && src[options.ratingField] != null) props[options.ratingProp ?? 'rating'] = String(src[options.ratingField]);
  const keyRaw = pick(options.keyField);
  return {
    ref: pick(options.refField), name: pick(options.nameField), key: keyRaw ? (options.keyKind === 'uprn' ? keyRaw : normPostcode(keyRaw)) : null,
    props, geom, bbox: bb,
  };
}

/** CSV text -> GeoJSON-like features. Needs lat/lng (or lat,lon) or easting/northing columns, or only a key column for purely keyed datasets. */
export function featuresFromCsv(text, options = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const split = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  const head = split(lines[0]).map((h) => h.trim()), low = head.map((h) => h.toLowerCase());
  const col = (...n) => low.findIndex((h) => n.includes(h));
  const iLat = col('lat', 'latitude'), iLng = col('lng', 'lon', 'long', 'longitude'), iE = col('easting', 'x'), iN = col('northing', 'y');
  return lines.slice(1).map((l) => {
    const c = split(l), properties = Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
    let geometry = null;
    if (iLat >= 0 && iLng >= 0 && c[iLat] !== '' && c[iLng] !== '') geometry = { type: 'Point', coordinates: [Number(c[iLng]), Number(c[iLat])] };
    else if (iE >= 0 && iN >= 0 && c[iE] !== '' && c[iN] !== '') geometry = { type: 'Point', coordinates: [Number(c[iE]), Number(c[iN])] };
    return { type: 'Feature', properties, geometry };
  });
}

/** File text -> features: FeatureCollection, a single Feature, GeoJSON-lines, or CSV. */
export function parseGeoFile(text, { format } = {}) {
  const t = text.trimStart();
  const fmt = format ?? (/^\s*\{/.test(t) ? (t.slice(0, 400).includes('"FeatureCollection"') ? 'geojson' : /^\{[^\n]*\}\s*\n\s*\{/.test(t) ? 'jsonl' : 'geojson') : 'csv');
  if (fmt === 'csv') return featuresFromCsv(text);
  if (fmt === 'jsonl') return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((f) => f?.type === 'Feature');
  const doc = JSON.parse(text);
  return doc.type === 'FeatureCollection' ? doc.features : doc.type === 'Feature' ? [doc] : [];
}

/** Rows ready for the database, plus how many were skipped and the bounding box of what was kept (stored as the dataset's coverage when you load an extract). */
export function buildRows(features, options = {}) {
  const rows = [];
  let skipped = 0;
  const cov = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    const r = rowFromFeature(f, options);
    if (!r) { skipped++; continue; }
    rows.push(r);
    cov[0] = Math.min(cov[0], r.bbox[0]); cov[1] = Math.min(cov[1], r.bbox[1]); cov[2] = Math.max(cov[2], r.bbox[2]); cov[3] = Math.max(cov[3], r.bbox[3]);
  }
  return { rows, skipped, coverage: rows.length ? cov.map((n) => Math.round(n * 1e5) / 1e5) : null };
}
