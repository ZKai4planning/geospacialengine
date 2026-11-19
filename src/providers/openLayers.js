import { logger } from '../utils/logger.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';
import { wgs84ToBng } from '../utils/bngForward.js';
import { distanceToGeometryM } from './floodSources.js';
import { decodeTiff, exportUrl } from './lidarHeights.js';

/**
 * MORE OPEN DATA, READ LIVE (no loading, no key). Each part fails on its own: one unreachable service never blanks the others.
 *
 *   aqma         Air Quality Management Areas      planning.data.gov.uk dataset `air-quality-management-area` (Defra, Open Government Licence v3).
 *                                                  The same entity.json point query the engine already uses for conservation areas etc.
 *   defences     Spatial Flood Defences            Environment Agency, OGC API - Features (the same service type as the recorded-flood data).
 *   mainRiver    Statutory Main River Map          Environment Agency, OGC API - Features. This is the real DESIGNATION, unlike the OpenStreetMap rivers.
 *   noise        Strategic noise, road, Lden       Defra Round 4 (2022). Published as a RASTER (WCS), not as vectors: read as a single-cell GeoTIFF sample.
 *
 * WHAT IS CONFIRMED AND WHAT IS NOT. Confirmed from the publishers' own catalogue pages: the dataset name and service address of each, the licence (OGL), and
 * (aqma) the field names. NOT confirmed from the build machine (no open network): the property names inside the flood-defence and main-river features, the
 * WCS coverage id and axis labels for noise, and what the noise raster holds for a quiet place. The readers are therefore forgiving and answer
 * 'unavailable' instead of guessing; `npm run verify:open-data` prints what the live services really return.
 *
 * Honesty rules: "not in the dataset" is never "none exists"; a noise value that is not a plausible decibel figure is "no reading", never "quiet".
 */
export const OPEN_LAYER_DEFAULTS = {
  aqmaDataset: 'air-quality-management-area',
  defencesUrl: 'https://environment.data.gov.uk/spatialdata/spatial-flood-defences-including-standardised-attributes/ogc/features/v1',
  mainRiverUrl: 'https://environment.data.gov.uk/spatialdata/statutory-main-river-map/ogc/features/v1',
  noiseRoadWcsUrl: 'https://environment.data.gov.uk/spatialdata/road-noise-all-metrics-england-round-4/wcs',
  noiseRailWcsUrl: null, // address not confirmed: set NOISE_RAIL_WCS_URL once `npm run verify:open-data` has found it
  noiseAxes: ['E', 'N'],
};
const OGL_NOTE = 'Open Government Licence v3';
const keyOf = (o, ...names) => { const k = Object.keys(o ?? {}).find((x) => names.includes(x.toLowerCase())); return k ? o[k] : undefined; };
const val = (p, ...k) => { const x = keyOf(p, ...k); return x == null || x === '' ? null : String(x).slice(0, 80); };

// ------------------------------------------------------------------------------------------------ geometry: any GeoJSON type -> metres from the point
const metresFrom = (lat0, lng0) => { const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540; return ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]; };
const dSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); };
/** Metres from (lat, lng) to a Point, MultiPoint, LineString, MultiLineString, Polygon or MultiPolygon (0 when inside a polygon). Infinity when unusable. */
export function distanceToAnyM(geom, lat, lng) {
  const m = metresFrom(lat, lng), o = [0, 0];
  const t = geom?.type, c = geom?.coordinates;
  if (t === 'Point') return Array.isArray(c) ? Math.hypot(...m(c)) : Infinity;
  if (t === 'MultiPoint') return Math.min(Infinity, ...(c ?? []).map((q) => Math.hypot(...m(q))));
  if (t === 'LineString' || t === 'MultiLineString') {
    const lines = t === 'LineString' ? [c] : c ?? [];
    let best = Infinity;
    for (const l of lines) { const pts = (l ?? []).map(m); if (pts.length === 1) best = Math.min(best, Math.hypot(pts[0][0], pts[0][1])); for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, dSeg(o, pts[i], pts[i + 1])); }
    return best;
  }
  if (t === 'GeometryCollection') return Math.min(Infinity, ...(geom.geometries ?? []).map((g) => distanceToAnyM(g, lat, lng)));
  return distanceToGeometryM(geom, lat, lng);
}

// ------------------------------------------------------------------------------------------------ planning.data.gov.uk: Air Quality Management Areas
/** Entities from a planning.data.gov.uk answer -> the fields the register shows. */
export function parseAqma(data) {
  return (data?.entities ?? []).filter((e) => isCurrent(e)).map((e) => ({
    name: e.name ?? null, reference: e.reference ?? null, localAuthorityCode: e.notes ?? null,
    url: e['documentation-url'] || (e.entity ? `https://www.planning.data.gov.uk/entity/${e.entity}` : null),
  }));
}

// ------------------------------------------------------------------------------------------------ EA OGC API - Features (lines / points)
const pickDefence = (p = {}) => ({
  type: val(p, 'asset_type', 'type', 'defence_type', 'asset_sub_type', 'structure_type', 'description', 'asset_description'),
  condition: val(p, 'condition', 'asset_condition', 'condition_grade', 'condition_rating', 'current_condition'),
  standardOfProtection: val(p, 'standard_of_protection', 'sop', 'design_standard', 'current_sop', 'asset_standard_of_protection'),
});
const pickRiver = (p = {}) => ({ name: val(p, 'name', 'river_name', 'watercourse_name', 'main_river_name', 'rivername'), tidal: /^(true|yes|y|1|tidal)$/i.test(String(keyOf(p, 'tidal', 'is_tidal') ?? '')) || /tidal/i.test(String(keyOf(p, 'type', 'watercourse_type') ?? '')) });

/** Finds the features within nearM of the point across every collection of an OGC API - Features service (capped). Throws on anything unexpected. */
async function ogcNear({ fetchJson, baseUrl, lat, lng, nearM, cache, maxCollections = 6 }) {
  if (!cache.ids) {
    const cols = await fetchJson(`${baseUrl}/collections`, { timeoutMs: 9000, retries: 0 });
    const ids = (cols?.collections ?? []).map((c) => c.id).filter(Boolean).slice(0, maxCollections);
    if (!ids.length) throw new Error('no collections');
    cache.ids = ids;
  }
  const dLat = nearM / 110540, dLng = nearM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(6)).join(',');
  const out = [];
  for (const id of cache.ids) {
    const fc = await fetchJson(`${baseUrl}/collections/${encodeURIComponent(id)}/items?limit=50&bbox=${bbox}`, { timeoutMs: 12000, retries: 0, headers: { accept: 'application/geo+json, application/json' } });
    if (!Array.isArray(fc?.features)) throw new Error('not a feature collection');
    for (const f of fc.features) { const d = distanceToAnyM(f.geometry, lat, lng); if (d <= nearM) out.push({ d, p: f.properties ?? {} }); }
  }
  return out.sort((a, b) => a.d - b.d);
}

// ------------------------------------------------------------------------------------------------ Defra strategic noise (raster, WCS 2.0.1)
const NOISE_MIN_DB = 20, NOISE_MAX_DB = 120;
/** Coverage ids listed in a WCS GetCapabilities answer. */
export const coverageIds = (xml) => [...String(xml ?? '').matchAll(/CoverageId>\s*([^<\s]+)\s*</gi)].map((m) => m[1]);
/** The Lden coverage (not Lnight, not octave bands) among those ids, or null. */
export const pickLdenCoverage = (ids) => ids.find((i) => /lden/i.test(i) && !/night|octave|lden_?[a-z]*band/i.test(i)) ?? null;
/** Highest plausible decibel value in a decoded raster, or null. Anything outside 20-120 (no-data markers, zero, negatives) is NOT a reading. */
export function plausibleDb(values) {
  const ok = [...(values ?? [])].filter((v) => Number.isFinite(v) && v >= NOISE_MIN_DB && v <= NOISE_MAX_DB);
  return ok.length ? Math.max(...ok) : null;
}

export function createOpenLayers({ fetchJson, fetchText, fetchImpl = globalThis.fetch, decode = decodeTiff, cfg = {}, userAgent = 'uk-planning-engine', timeoutMs = 12000 } = {}) {
  const c = { ...OPEN_LAYER_DEFAULTS, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v != null && v !== '')) };
  const warned = new Set();
  const warn = (what, e) => { if (!warned.has(what)) { warned.add(what); logger.warn({ err: e.message }, `${what} lookup failed`); } };
  const caches = { defences: {}, mainRiver: {} };
  const noiseCov = {}, noiseWorks = {};

  async function aqma({ lat, lng }) {
    const source = `Defra via planning.data.gov.uk, Air quality management area (${OGL_NOTE}; © Crown copyright and database rights, Defra PSMA licence)`;
    try {
      const data = await fetchJson(entityUrl([['longitude', lng], ['latitude', lat], ['dataset', c.aqmaDataset], ['limit', 20], ['exclude_field', 'geometry'], ['exclude_field', 'point']]), { timeoutMs: 10000, retries: 0 });
      if (!data || !Array.isArray(data.entities)) throw new Error('unexpected answer');
      const areas = parseAqma(data);
      return { status: areas.length ? 'inside' : 'outside', areas, source };
    } catch (e) { warn('air quality management areas', e); return { status: 'unavailable', reason: 'The air quality management area data could not be read.' }; }
  }

  async function defences({ lat, lng }) {
    const nearM = 250, source = `Environment Agency, Spatial Flood Defences (including standardised attributes) (${OGL_NOTE})`;
    try {
      const hits = await ogcNear({ fetchJson, baseUrl: c.defencesUrl, lat, lng, nearM, cache: caches.defences });
      const assets = hits.slice(0, 8).map((h) => ({ distanceM: Math.round(h.d), ...pickDefence(h.p) }));
      return { status: assets.length ? 'near' : 'outside', assets, count: hits.length, nearM, source };
    } catch (e) { caches.defences = {}; warn('flood defences', e); return { status: 'unavailable', reason: 'The flood defence data could not be read.' }; }
  }

  async function mainRiver({ lat, lng }) {
    const nearM = 50, source = `Environment Agency, Statutory Main River Map (${OGL_NOTE})`;
    try {
      const hits = await ogcNear({ fetchJson, baseUrl: c.mainRiverUrl, lat, lng, nearM, cache: caches.mainRiver });
      const rivers = hits.slice(0, 5).map((h) => ({ distanceM: Math.round(h.d), ...pickRiver(h.p) }));
      return { status: rivers.length ? 'near' : 'outside', rivers, nearM, source };
    } catch (e) { caches.mainRiver = {}; warn('main river', e); return { status: 'unavailable', reason: 'The main river map could not be read.' }; }
  }

  /** The human-readable part of an OGC exception document (ExceptionText / ServiceException), or the first 200 characters of whatever came back. */
  const exceptionText = (body) => { const m = /<(?:ows:)?ExceptionText[^>]*>([\s\S]*?)<\/(?:ows:)?ExceptionText>|<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/i.exec(body ?? ''); return String(m?.[1] ?? m?.[2] ?? body ?? '').replace(/\s+/g, ' ').trim().slice(0, 240); };

  /** One WCS request; any failure carries the service's own explanation, so the log says WHY. */
  async function wcsFetch(url) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers?.get?.('content-type') ?? '';
    if (!res.ok || /json|html|text|xml/i.test(type)) {
      const body = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      throw new Error(`HTTP ${res.status}${body ? `: ${exceptionText(body)}` : ' (not a raster)'}`);
    }
    return decode(await res.arrayBuffer());
  }

  const bareId = (id) => id.replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}__/i, '');
  const CELL = 10; // Defra noise grid: 10 m cells
  /** Highest plausible dB in the 3x3 cells around the point, from a decoded raster covering the window `g` (row 0 = northern edge). */
  function valueAt(t, g, e, n) {
    const col = Math.floor((e - g.x0) / CELL), row = t.height - 1 - Math.floor((n - g.y0) / CELL), out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r = row + dr, cc = col + dc; if (r >= 0 && r < t.height && cc >= 0 && cc < t.width) out.push(t.values[r * t.width + cc]); }
    return plausibleDb(out);
  }
  /**
   * Defra's GeoServer refuses requests whose estimated read is over 10 GB, and for a handful-of-cells window it estimated the WHOLE country (14 GB), so
   * ask for a window of a few hundred metres (the reference clients use 20 km tiles without trouble) and pick the cell at the point ourselves.
   * Dialects tried in turn, the working one remembered: WCS 2.0.1 (prefixed id, E/N axes) with and without scaleFactor=1, then WCS 1.0.0 (bare id).
   * If all fail, the error lists what each one said.
   */
  async function sampleNoise(url, key, { lat, lng }) {
    const { e, n } = wgs84ToBng(lat, lng);
    const errors = [];
    if (!noiseCov[key]) {
      try { noiseCov[key] = pickLdenCoverage(coverageIds(await fetchText(`${url}?service=WCS&version=2.0.1&request=GetCapabilities`, { timeoutMs: 15000, retries: 0 }))); }
      catch (err) { errors.push(`capabilities: ${err.message}`); }
    }
    const id2 = noiseCov[key] ?? null;
    const id1 = id2 ? bareId(id2) : `${key === 'rail' ? 'Rail' : 'Road'}_Noise_Lden_England_Round_4_All`;
    const win = (m) => ({ x0: Math.floor(e / CELL) * CELL - m / 2, y0: Math.floor(n / CELL) * CELL - m / 2, nx: m, ny: m });
    const v1 = (g) => `${url}?${new URLSearchParams({ service: 'WCS', version: '1.0.0', request: 'GetCoverage', coverage: id1, CRS: 'EPSG:27700', BBOX: `${g.x0},${g.y0},${g.x0 + g.nx},${g.y0 + g.ny}`, width: String(g.nx / CELL), height: String(g.ny / CELL), format: 'GeoTIFF' })}`;
    const attempts = [];
    for (const m of [200, 1000]) {
      const g = win(m);
      if (id2) for (const sf of [1, 0]) attempts.push([`2.0.1 ${m}m${sf ? ' scale1' : ''}`, g, () => wcsFetch(exportUrl({ url, coverage: id2, axes: c.noiseAxes, scaleFactor: sf || undefined }, g))]);
      attempts.push([`1.0.0 ${m}m`, g, () => wcsFetch(v1(g))]);
    }
    const order = noiseWorks[key] ? [...attempts.filter(([l]) => l === noiseWorks[key]), ...attempts.filter(([l]) => l !== noiseWorks[key])] : attempts;
    for (const [label, g, run] of order) {
      try {
        const t = await run();
        const full = t.width === g.nx / CELL && t.height === g.ny / CELL;
        if (!full && t.width * t.height > 100) throw new Error(`raster is ${t.width}x${t.height}, expected ${g.nx / CELL}x${g.ny / CELL}`);
        noiseWorks[key] = label; return full ? valueAt(t, g, e, n) : plausibleDb(t.values);   // a small patch (a few cells) is read whole
      } catch (err) { errors.push(`${label}: ${err.message}`); }
    }
    noiseCov[key] = null;
    throw new Error(errors.join(' | '));
  }

  async function noise(at) {
    const source = `Defra, Strategic noise mapping 2022 (round 4), Lden, road${c.noiseRailWcsUrl ? ' and rail' : ''} (${OGL_NOTE})`;
    const parts = [['road', c.noiseRoadWcsUrl], ['rail', c.noiseRailWcsUrl]].filter(([, u]) => u);
    if (!parts.length) return { status: 'unavailable', reason: 'No noise service is configured.' };
    try {
      const got = [];
      for (const [k, u] of parts) { try { got.push([k, await sampleNoise(u, k, at)]); } catch (e) { noiseCov[k] = null; warn(`noise (${k})`, e); } }
      if (!got.length) return { status: 'unavailable', reason: 'The noise map could not be read.' };
      const levels = got.filter(([, v]) => v != null);
      if (!levels.length) return { status: 'no_value', reason: 'The noise map returned no decibel value here (outside the modelled area, or below its lowest reporting band: the two cannot be told apart).', source };
      const [topSource, lden] = levels.sort((a, b) => b[1] - a[1])[0];
      return { status: 'ok', lden: Math.round(lden * 10) / 10, source: topSource, sources: levels.map(([k, v]) => ({ source: k, lden: Math.round(v * 10) / 10 })), cellM: CELL, text: source };
    } catch (e) { warn('noise', e); return { status: 'unavailable', reason: 'The noise map could not be read.' }; }
  }

  return {
    name: 'open-layers',
    async check({ lat, lng }) {
      if (lat == null || lng == null) { const u = { status: 'unavailable', reason: 'No location.' }; return { aqma: u, defences: u, mainRiver: u, noise: u }; }
      const at = { lat, lng };
      const [a, d, m, nz] = await Promise.all([aqma(at), defences(at), mainRiver(at), noise(at)]);
      return { aqma: a, defences: d, mainRiver: m, noise: nz, checkedAt: new Date().toISOString() };
    },
  };
}
