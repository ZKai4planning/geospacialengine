// npm run verify:open-data [lat] [lng]
// Checks the REAL Environment Agency services and prints what they actually return, so you can see that the parsers fit.
// Run it where the network is open (not inside a locked-down sandbox). Default point: central Hull, a place with recorded flooding.
import { config } from '../src/config.js';
import { fetchJson, fetchText } from '../src/utils/http.js';
import { wgs84ToBng } from '../src/utils/bngForward.js';
import { parseFeatureInfo, createFloodSources, wmsLayers, rankSurfaceWaterLayers } from '../src/providers/floodSources.js';
import { createOsmInfra } from '../src/providers/osmInfra.js';
import { createOpenLayers, OPEN_LAYER_DEFAULTS, coverageIds, pickLdenCoverage } from '../src/providers/openLayers.js';

const lat = Number(process.argv[2] ?? 53.7457), lng = Number(process.argv[3] ?? -0.3367);
const show = (s, n = 500) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
let bad = 0;
const line = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'OK   ' : 'CHECK'} ${msg}`); };
console.log(`Point ${lat}, ${lng}\n`);

console.log('1. Surface water (WMS GetFeatureInfo)');
const { e, n } = wgs84ToBng(lat, lng);
let layerName = config.surfaceWaterLayer || null;
if (!layerName) {
  try {
    const all = wmsLayers(await fetchText(`${config.surfaceWaterUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`, { timeoutMs: 15000, retries: 0 }));
    console.log(`   layers on the service (${all.length}): ${all.slice(0, 25).map((l) => `${l.name}${l.title ? ` [${l.title}]` : ''}`).join('; ') || 'none read'}`);
    layerName = rankSurfaceWaterLayers(all)[0] ?? null;
  } catch (err) { console.log(`   GetCapabilities failed (${err.message})`); }
}
layerName ??= 'rofsw_4band';
console.log(`   using layer: ${layerName}   (override with SURFACE_WATER_WMS_LAYER in .env)`);
const base = `${config.surfaceWaterUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${encodeURIComponent(layerName)}&QUERY_LAYERS=${encodeURIComponent(layerName)}&STYLES=&SRS=EPSG:27700&WIDTH=101&HEIGHT=101&X=50&Y=50&FEATURE_COUNT=5&BBOX=${[e - 50, n - 50, e + 50, n + 50].map((v) => v.toFixed(1)).join(',')}`;
let understood = false;
for (const fmt of ['application/json', 'text/xml', 'application/vnd.ogc.gml', 'text/plain', 'text/html']) {
  try {
    const t = await fetchText(`${base}&INFO_FORMAT=${encodeURIComponent(fmt)}`, { timeoutMs: 12000, retries: 0 });
    const p = parseFeatureInfo(t);
    console.log(`   ${fmt}: ${p.ok ? `understood, bands = [${p.bands}]` : 'NOT understood'}\n   raw: ${show(t)}`);
    understood ||= p.ok;
    if (p.ok) break;
  } catch (err) { console.log(`   ${fmt}: request failed (${err.message})`); }
}
line(understood, 'at least one GetFeatureInfo format was understood');

for (const [label, url] of [['2. Recorded Flood Outlines (OGC API Features)', config.recordedFloodUrl], ['3. Reservoir Flood Extents, wet day (OGC API Features)', config.reservoirFloodUrl]]) {
  console.log(`\n${label}`);
  try {
    const cols = await fetchJson(`${url}/collections`, { timeoutMs: 12000, retries: 0 });
    const list = cols?.collections ?? [];
    console.log(`   collections: ${list.map((c) => c.id).join(', ') || 'none'}`);
    line(list.length > 0, 'a collection was found');
    const id = (list.find((c) => /flood|outline|extent|reservoir/i.test(`${c.id} ${c.title}`)) ?? list[0])?.id;
    if (id) {
      const d = 0.01, items = await fetchJson(`${url}/collections/${encodeURIComponent(id)}/items?limit=3&bbox=${lng - d},${lat - d},${lng + d},${lat + d}`, { timeoutMs: 15000, retries: 0, headers: { accept: 'application/geo+json, application/json' } });
      const f = items?.features?.[0];
      line(Array.isArray(items?.features), `items query answered (${items?.features?.length ?? 0} feature(s) in a 2 km box)`);
      if (f) console.log(`   geometry: ${f.geometry?.type}; property names: ${Object.keys(f.properties ?? {}).join(', ')}`);
    }
  } catch (err) { line(false, `request failed (${err.message})`); }
}

console.log('\n4. The same three through the provider the app uses');
const out = await createFloodSources({ fetchJson, fetchText, surfaceWaterUrl: config.surfaceWaterUrl, surfaceWaterLayer: config.surfaceWaterLayer, recordedUrl: config.recordedFloodUrl, reservoirUrl: config.reservoirFloodUrl }).check({ lat, lng });
for (const [k, v] of Object.entries(out)) if (k !== 'checkedAt') line(v.status !== 'unavailable', `${k}: ${v.status}${v.band ? ` (${v.band})` : ''}${v.reason ? ` - ${v.reason}` : ''}`);

console.log('\n5. OpenStreetMap watercourses, substations, traffic signals');
try { const r = await createOsmInfra().check({ lat, lng }); line(true, `watercourses ${r.watercourses.length}, substations ${r.substations.length}, signals ${r.signals.length}`); } catch (err) { line(false, `Overpass failed (${err.message})`); }

console.log('\n6. Air quality areas, flood defences, main river (planning.data.gov.uk and EA OGC API)');
for (const [label, url] of [['flood defences', config.openLayers?.defencesUrl ?? OPEN_LAYER_DEFAULTS.defencesUrl], ['main river', config.openLayers?.mainRiverUrl ?? OPEN_LAYER_DEFAULTS.mainRiverUrl]]) {
  try {
    const cols = await fetchJson(`${url}/collections`, { timeoutMs: 12000, retries: 0 });
    const list = cols?.collections ?? [];
    console.log(`   ${label}: collections ${list.map((c) => c.id).join(', ') || 'none'}`);
    line(list.length > 0, `${label}: a collection was found`);
    const d = 0.02;
    for (const c of list.slice(0, 3)) {
      const items = await fetchJson(`${url}/collections/${encodeURIComponent(c.id)}/items?limit=2&bbox=${lng - d},${lat - d},${lng + d},${lat + d}`, { timeoutMs: 15000, retries: 0, headers: { accept: 'application/geo+json, application/json' } });
      const f = items?.features?.[0];
      line(Array.isArray(items?.features), `${label}/${c.id}: items query answered (${items?.features?.length ?? 0} in a 4 km box)`);
      if (f) console.log(`   geometry ${f.geometry?.type}; property names: ${Object.keys(f.properties ?? {}).join(', ')}`);
    }
  } catch (err) { line(false, `${label}: request failed (${err.message})`); }
}

console.log('\n7. Road noise (Defra round 4, WCS raster)');
try {
  const url = config.openLayers?.noiseRoadWcsUrl ?? OPEN_LAYER_DEFAULTS.noiseRoadWcsUrl;
  const caps = await fetchText(`${url}?service=WCS&version=2.0.1&request=GetCapabilities`, { timeoutMs: 20000, retries: 0 });
  const ids = coverageIds(caps);
  console.log(`   coverages: ${ids.slice(0, 12).join(', ') || 'none found'}${ids.length > 12 ? ` ... (${ids.length})` : ''}`);
  line(!!pickLdenCoverage(ids), `an Lden coverage was found: ${pickLdenCoverage(ids) ?? 'NONE - set NOISE_ROAD_WCS_URL to the right service'}`);
  const id2 = pickLdenCoverage(ids), id1 = (id2 ?? '').replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}__/i, '');
  const { e: ne, n: nn } = wgs84ToBng(lat, lng);
  const x0 = Math.floor(ne / 10) * 10 - 10, y0 = Math.floor(nn / 10) * 10 - 10, crs = 'subsettingCrs=http%3A%2F%2Fwww.opengis.net%2Fdef%2Fcrs%2FEPSG%2F0%2F27700';
  const v2 = (m, sf) => `${url}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id2}&format=image%2Ftiff&subset=E(${x0 - m / 2 + 10},${x0 + m / 2 + 10})&subset=N(${y0 - m / 2 + 10},${y0 + m / 2 + 10})${sf ? '&scaleFactor=1' : ''}&${crs}`;
  const v1 = (m) => `${url}?service=WCS&version=1.0.0&request=GetCoverage&coverage=${id1}&CRS=EPSG:27700&BBOX=${x0 - m / 2 + 10},${y0 - m / 2 + 10},${x0 + m / 2 + 10},${y0 + m / 2 + 10}&width=${m / 10}&height=${m / 10}&format=GeoTIFF`;
  const tries = [];
  for (const m of [30, 200, 1000, 5000]) tries.push([`WCS 2.0.1 ${m} m`, v2(m, false)], [`WCS 2.0.1 ${m} m scaleFactor=1`, v2(m, true)], [`WCS 1.0.0 ${m} m`, v1(m)]);
  for (const [label, u] of tries) {
    const r = await fetch(u, { headers: { 'User-Agent': config.userAgent ?? 'uk-planning-engine' } }).catch((err) => ({ ok: false, status: 'network', text: async () => err.message, headers: new Headers() }));
    const type = r.headers.get('content-type') ?? '';
    const good = r.ok && /tiff/i.test(type);
    const body = good ? '' : String(await r.text()).replace(/\s+/g, ' ');
    const msg = /ExceptionText[^>]*>([^<]*)|ServiceException[^>]*>([^<]*)/i.exec(body);
    console.log(`   ${label}: HTTP ${r.status}, ${type || 'no content-type'}${good ? ' (RASTER: this one works)' : `, says: ${(msg?.[1] ?? msg?.[2] ?? body).trim().slice(0, 300)}`}`);
  }
} catch (err) { line(false, `noise GetCapabilities failed (${err.message}); if the address is wrong set NOISE_ROAD_WCS_URL (and NOISE_WCS_AXES if the axis labels are not E,N)`); }

console.log('\n8. All four through the provider the app uses');
const ol = await createOpenLayers({ fetchJson, fetchText, cfg: config.openLayers }).check({ lat, lng });
for (const [k, v] of Object.entries(ol)) if (k !== 'checkedAt') line(v.status !== 'unavailable', `${k}: ${v.status}${v.lden != null ? ` (${v.lden} dB Lden)` : ''}${v.reason ? ` - ${v.reason}` : ''}`);
console.log('   (a noise status of no_value is not a failure: the raster held no decibel figure at this point)');

console.log(bad ? `\n${bad} item(s) to look at. Send me this output and I will adjust the parsers.\n` : '\nAll good: the parsers fit the live services.\n');
process.exitCode = bad ? 1 : 0;
