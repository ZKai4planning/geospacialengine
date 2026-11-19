import { logger } from '../utils/logger.js';
import { wgs84ToBng } from '../utils/bngForward.js';

/**
 * OPEN ENVIRONMENT AGENCY FLOOD DATA for one point. All three are Open Government Licence; the services are on the Defra Data Services Platform
 * (https://environment.data.gov.uk). Each part fails on its own: one unreachable service never blanks the others.
 *
 *   surfaceWater  Risk of Flooding from Surface Water (NaFRA2, 2 m grid): WMS GetFeatureInfo on layer rofsw_4band, attribute risk_band
 *                 (high >= 3.3% a year, medium 1-3.3%, low 0.1-1%, very low < 0.1%). Outside the mapped extent counts as very low.
 *   recorded      Recorded Flood Outlines (every record of past flooding: rivers, sea, groundwater, surface water): OGC API Features
 *   reservoir     Reservoir Flood Extents, wet-day scenario (National): OGC API Features
 *
 * WHAT THE EA SAYS ABOUT THESE: surface water risk is a screening map "not to be used at property level"; a recorded outline "does not
 * necessarily indicate that properties were flooded internally". Report them as indicators, never as a verdict on one house.
 *
 * NOT YET CONFIRMED AGAINST THE LIVE SERVICES from the build machine: the GetFeatureInfo reply format and the OGC property names. The parsers
 * are deliberately forgiving and answer 'unavailable' rather than guess. Run `npm run verify:open-data` where the network is open to check.
 */
export const BANDS = { very_low: 0, low: 1, medium: 2, high: 3 };
export const BAND_TEXT = { high: 'High (3.3% or more a year, 1 in 30)', medium: 'Medium (1% to 3.3% a year)', low: 'Low (0.1% to 1% a year)', very_low: 'Very low (under 0.1% a year, or outside the mapped extent)' };

const bandOf = (s) => { const t = String(s ?? '').toLowerCase().replace(/[_-]/g, ' '); return /very\s*low/.test(t) ? 'very_low' : /\bhigh\b/.test(t) ? 'high' : /\bmedium\b/.test(t) ? 'medium' : /\blow\b/.test(t) ? 'low' : null; };
const keyOf = (o, ...names) => { const k = Object.keys(o ?? {}).find((x) => names.includes(x.toLowerCase())); return k ? o[k] : undefined; };

/** Read a GetFeatureInfo reply of unknown format. { ok:false } = could not understand it; { ok:true, bands:[] } = understood, nothing mapped here. */
export function parseFeatureInfo(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false };
  if (/ServiceException|ExceptionReport|<ows:Exception/i.test(s)) return { ok: false };
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const j = JSON.parse(s);
      const feats = Array.isArray(j?.features) ? j.features : null;
      if (!feats) return { ok: false };
      return { ok: true, bands: feats.map((f) => bandOf(keyOf(f?.properties ?? f?.attributes ?? {}, 'risk_band', 'riskband', 'band'))).filter(Boolean) };
    } catch { return { ok: false }; }
  }
  const found = [...s.matchAll(/risk_band\W{1,12}([A-Za-z][A-Za-z _-]{2,10})/gi)].map((m) => bandOf(m[1])).filter(Boolean);
  if (found.length) return { ok: true, bands: found };
  if (/no features were found|<\/?FeatureCollection|msGMLOutput|<GetFeatureInfoResponse\s*\/>|^<\?xml[^>]*\?>\s*<[^>]+\/>$/i.test(s) && !/risk_band/i.test(s)) return { ok: true, bands: [] };
  return { ok: false };
}

/**
 * Layer names listed in a WMS GetCapabilities answer: [{ name, title }]. The Defra platform publishes layers under a generated workspace
 * (e.g. `dataset-<uuid>:<layer>`), so the bare name `rofsw_4band` is not always the real one: ask the service instead of assuming.
 */
export function wmsLayers(xml) {
  return [...String(xml ?? '').matchAll(/<Layer\b[^>]*>\s*<Name>\s*([^<]+?)\s*<\/Name>(?:\s*<Title>\s*([^<]*?)\s*<\/Title>)?/gi)].map((m) => ({ name: m[1], title: m[2] ?? '' }));
}
/** Best-first list of the 4-band surface water risk layers among `layers` (not depth / speed / climate-change variants). */
export function rankSurfaceWaterLayers(layers) {
  const text = (l) => `${l.name} ${l.title}`;
  const score = (l) => (/rofsw.*4.?band/i.test(text(l)) ? 3 : /4.?band/i.test(text(l)) ? 2 : /rofsw|surface.?water/i.test(text(l)) ? 1 : 0);
  return (layers ?? []).filter((l) => !/depth|speed|velocity|hazard|climate|extent|1.?in|percent|%/i.test(text(l))).map((l) => [score(l), l.name]).filter(([sc]) => sc > 0).sort((a, b) => b[0] - a[0]).map(([, n]) => n);
}

// ------------------------------------------------------------------------------------------------ geometry for OGC answers (GeoJSON, lng/lat)
const metresFrom = (lat0, lng0) => { const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540; return ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]; };
const inRing = (ring, p) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; return c; };
const dSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); };
/** 0 when the point is inside a Polygon / MultiPolygon (holes respected), else the metres to its nearest edge. Infinity if the geometry is unusable. */
export function distanceToGeometryM(geom, lat, lng) {
  const m = metresFrom(lat, lng), o = [0, 0];
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
  let best = Infinity;
  for (const poly of polys) {
    const rings = (poly ?? []).map((r) => (r ?? []).map(m));
    if (!rings.length || rings[0].length < 3) continue;
    if (inRing(rings[0], o) && !rings.slice(1).some((h) => inRing(h, o))) return 0;
    for (const r of rings) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, dSeg(o, r[i], r[i + 1]));
  }
  return best;
}

export function createFloodSources({ fetchJson, fetchText, surfaceWaterUrl, surfaceWaterLayer = null, recordedUrl, reservoirUrl, nearM = 250 } = {}) {
  const warned = new Set();
  const warn = (what, e) => { if (!warned.has(what)) { warned.add(what); logger.warn({ err: e.message }, `${what} lookup failed`); } };
  const SW_FORMATS = ['application/json', 'text/xml', 'application/vnd.ogc.gml', 'text/plain', 'text/html'];

  let swLayer = surfaceWaterLayer || null;   // the layer that last answered (or the one set in SURFACE_WATER_WMS_LAYER)
  async function swCandidates() {
    if (swLayer) return [swLayer];
    const out = [];
    try { out.push(...rankSurfaceWaterLayers(wmsLayers(await fetchText(`${surfaceWaterUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`, { timeoutMs: 12000, retries: 0 })))); } catch { /* fall back to the documented name */ }
    if (!out.includes('rofsw_4band')) out.push('rofsw_4band');
    return out.slice(0, 4);
  }

  async function surfaceWater({ lat, lng }) {
    const source = 'Environment Agency, Risk of Flooding from Surface Water (© Environment Agency copyright and/or database right 2025. All rights reserved. Open Government Licence)';
    try {
      const { e, n } = wgs84ToBng(lat, lng);
      const bbox = [e - 50, n - 50, e + 50, n + 50].map((v) => v.toFixed(1)).join(',');
      for (const layer of await swCandidates()) {
        const base = `${surfaceWaterUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${encodeURIComponent(layer)}&QUERY_LAYERS=${encodeURIComponent(layer)}&STYLES=&SRS=EPSG:27700&WIDTH=101&HEIGHT=101&X=50&Y=50&FEATURE_COUNT=5&BBOX=${bbox}`;
        for (const fmt of SW_FORMATS) {
          let txt;
          try { txt = await fetchText(`${base}&INFO_FORMAT=${encodeURIComponent(fmt)}`, { timeoutMs: 9000, retries: 0 }); } catch { continue; }
          if (/LayerNotDefined/i.test(String(txt))) break;          // wrong layer name: no point trying the other formats on it
          const r = parseFeatureInfo(txt);
          if (!r.ok) continue;
          swLayer = layer;
          const band = r.bands.length ? r.bands.reduce((a, b) => (BANDS[b] > BANDS[a] ? b : a)) : 'very_low';
          return { status: 'ok', band, mapped: r.bands.length > 0, text: BAND_TEXT[band], source };
        }
      }
      return { status: 'unavailable', reason: 'The surface water map did not return a reading I could understand.' };
    } catch (e) { warn('surface water', e); return { status: 'unavailable', reason: 'The surface water map could not be read.' }; }
  }

  function ogc(label, baseUrl, sourceText) {
    let collection = null;
    const pickProps = (p = {}) => {
      const v = (...k) => { const x = keyOf(p, ...k); return x == null || x === '' ? null : String(x).slice(0, 80); };
      return { name: v('flood_event_name', 'name', 'flood_name', 'event_name', 'reservoir', 'reservoir_name'), source: v('flood_source', 'source', 'flood_src'), cause: v('flood_cause', 'cause'), start: (v('start_date', 'startdate', 'start', 'flood_start_date') ?? '').slice(0, 10) || null };
    };
    return async ({ lat, lng }) => {
      try {
        if (!collection) {
          const cols = await fetchJson(`${baseUrl}/collections`, { timeoutMs: 9000, retries: 0 });
          const list = cols?.collections ?? [];
          collection = (list.find((c) => /flood|outline|extent|reservoir/i.test(`${c.id} ${c.title}`)) ?? list[0])?.id ?? null;
          if (!collection) throw new Error('no collections');
        }
        const dLat = nearM / 110540, dLng = nearM / (111320 * Math.cos((lat * Math.PI) / 180));
        const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(6)).join(',');
        const fc = await fetchJson(`${baseUrl}/collections/${encodeURIComponent(collection)}/items?limit=50&bbox=${bbox}`, { timeoutMs: 12000, retries: 0, headers: { accept: 'application/geo+json, application/json' } });
        if (!Array.isArray(fc?.features)) throw new Error('not a feature collection');
        const hits = fc.features.map((f) => ({ d: distanceToGeometryM(f.geometry, lat, lng), p: pickProps(f.properties) })).filter((x) => x.d <= nearM).sort((a, b) => a.d - b.d);
        const events = hits.slice(0, 5).map((h) => h.p);
        if (hits.length && hits[0].d === 0) return { status: 'inside', events, nearM, source: sourceText };
        if (hits.length) return { status: 'near', events, nearestM: Math.round(hits[0].d), nearM, source: sourceText };
        return { status: 'outside', events: [], nearM, source: sourceText };
      } catch (e) { collection = null; warn(label, e); return { status: 'unavailable', reason: `The ${label} data could not be read.` }; }
    };
  }
  const recorded = ogc('recorded flood outlines', recordedUrl, 'Environment Agency, Recorded Flood Outlines (© Environment Agency copyright and/or database right 2025. All rights reserved. Open Government Licence)');
  const reservoir = ogc('reservoir flood extents', reservoirUrl, 'Environment Agency, Reservoir Flood Extents - Wet Day (National) (© Environment Agency copyright and/or database right. Open Government Licence)');

  return {
    name: 'ea-open-flood-data',
    async check({ lat, lng }) {
      if (lat == null || lng == null) return { surfaceWater: { status: 'unavailable', reason: 'No location.' }, recorded: { status: 'unavailable', reason: 'No location.' }, reservoir: { status: 'unavailable', reason: 'No location.' } };
      const [sw, rec, res] = await Promise.all([surfaceWater({ lat, lng }), recorded({ lat, lng }), reservoir({ lat, lng })]);
      return { surfaceWater: sw, recorded: rec, reservoir: res, checkedAt: new Date().toISOString() };
    },
  };
}
