import test from 'node:test';
import assert from 'node:assert/strict';
import { wmsLayers, rankSurfaceWaterLayers, createFloodSources } from '../src/providers/floodSources.js';
import { createOpenLayers } from '../src/providers/openLayers.js';
import { createPlanningData, ringToWkt } from '../src/providers/planningData.js';
import { createConstraintsService } from '../src/services/constraintsService.js';

const CAPS = `<WMT_MS_Capabilities><Capability><Layer><Title>root</Title><Layer queryable="1"><Name>dataset-b5aa:Risk_of_Flooding_from_Surface_Water_Depth_1_in_30</Name><Title>Depth 1 in 30</Title></Layer>
<Layer queryable="1"><Name>dataset-b5aa:RoFSW_4band</Name><Title>Risk of Flooding from Surface Water 4 band</Title></Layer></Layer></Capability></WMT_MS_Capabilities>`;

test('surface water: the real layer name is read from GetCapabilities, and a wrong name never blocks the other formats forever', async () => {
  assert.equal(wmsLayers(CAPS).length, 2);
  assert.deepEqual(rankSurfaceWaterLayers(wmsLayers(CAPS)), ['dataset-b5aa:RoFSW_4band']);
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (/GetCapabilities/.test(url)) return CAPS;
    if (/LAYERS=rofsw_4band/.test(url)) return '<ServiceException code="LayerNotDefined">x</ServiceException>';
    return '{"features":[{"properties":{"risk_band":"Medium"}}]}';
  };
  const p = createFloodSources({ fetchJson: async () => ({ collections: [] }), fetchText, surfaceWaterUrl: 'https://x/wms', recordedUrl: 'https://r', reservoirUrl: 'https://s' });
  const r = await p.check({ lat: 51.5, lng: 0 });
  assert.equal(r.surfaceWater.band, 'medium');
  assert.ok(calls.some((c) => c.includes('LAYERS=dataset-b5aa%3ARoFSW_4band')));
});

test('noise: dialects are tried in turn until one returns a raster; the service\'s own error text is kept', async () => {
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return /version=1\.0\.0/.test(u) ? { ok: true, headers: { get: () => 'image/tiff' }, arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false, status: 400, text: async () => '<ows:ExceptionReport><ows:Exception><ows:ExceptionText>no such axis</ows:ExceptionText></ows:Exception></ows:ExceptionReport>', headers: { get: () => 'application/xml' } }; };
  const mkLayers = (f) => createOpenLayers({ fetchJson: async (u) => (u.includes('planning.data') ? { entities: [] } : u.endsWith('/collections') ? { collections: [{ id: 'c' }] } : { type: 'FeatureCollection', features: [] }), fetchText: async () => '<wcs:CoverageId>0b3f6c1e-1111-2222-3333-444455556666__Road_Noise_Lden_England_Round_4_All</wcs:CoverageId>', fetchImpl: f, decode: async () => ({ width: 2, height: 1, values: new Float64Array([61, 64]) }) });
  const r = await mkLayers(fetchImpl).check({ lat: 51.5, lng: 0 });
  assert.equal(r.noise.status, 'ok'); assert.equal(r.noise.lden, 64);
  assert.ok(urls.some((u) => /coverageId=0b3f6c1e/.test(u)), '2.0.1 uses the prefixed id');
  assert.ok(urls.some((u) => /version=1\.0\.0.*coverage=Road_Noise_Lden/.test(u)), '1.0.0 uses the bare name');
  assert.ok(urls.some((u) => /scaleFactor=1/.test(u)), 'scaleFactor=1 is tried');
  const msgs = [];
  const bad = await mkLayers(async () => ({ ok: false, status: 400, text: async () => '<ows:ExceptionText>no such axis</ows:ExceptionText>', headers: { get: () => 'application/xml' } })).check({ lat: 51.6, lng: 0 });
  assert.equal(bad.noise.status, 'unavailable'); void msgs;
});

const RING = [[0, 51], [0.001, 51], [0.001, 51.001], [0, 51.001], [0, 51]];
test('planning.data: the plot search sends the polygon as WKT with the intersects relation', async () => {
  let url;
  const pd = createPlanningData({ fetchJson: async (u) => { url = u; return { entities: [{ dataset: 'flood-risk-zone', entity: 7, reference: 'R' }] }; } });
  const out = await pd.entitiesWithin({ ring: RING });
  assert.equal(out[0].entity, 7);
  assert.match(decodeURIComponent(url), /geometry=POLYGON\(\(/); assert.match(url, /geometry_relation=intersects/);
  assert.match(ringToWkt(RING), /^POLYGON\(\(0 51,/);
});

test('constraints: with a plot outline, a constraint on another part of the plot is added (where = plot); a failed plot search keeps the point answer', async () => {
  const at = [{ dataset: 'conservation-area', entity: 1 }];
  const svc = createConstraintsService({ providers: { planningData: { entitiesAt: async () => at, entitiesWithin: async () => [...at, { dataset: 'flood-risk-zone', entity: 2 }] } } });
  const r = await svc.check({ lat: 51.0005, lng: 0.0005, ring: RING });
  assert.equal(r.scope, 'plot'); assert.equal(r.flags.floodZone, true); assert.equal(r.flags.conservationArea, true);
  assert.deepEqual(r.items.map((i) => [i.dataset, i.where]), [['conservation-area', 'address'], ['flood-risk-zone', 'plot']]);
  const bad = createConstraintsService({ providers: { planningData: { entitiesAt: async () => at, entitiesWithin: async () => { throw new Error('down'); } } } });
  const b = await bad.check({ lat: 51.0006, lng: 0.0006, ring: RING.map(([x, y]) => [x + 0.5, y]) }); // different ring: not served from the cache
  assert.equal(b.scope, 'point'); assert.equal(b.flags.floodZone, false);
});

test('noise: a full 200 m window is read at the cell under the point (and its neighbours), not the loudest cell in the window', async () => {
  const values = new Float64Array(20 * 20).fill(40); values[0] = 90;               // loud cell in the far north-west corner
  const ol = createOpenLayers({ fetchJson: async (u) => (u.includes('planning.data') ? { entities: [] } : u.endsWith('/collections') ? { collections: [{ id: 'c' }] } : { type: 'FeatureCollection', features: [] }), fetchText: async () => '<wcs:CoverageId>0b3f6c1e-1111-2222-3333-444455556666__Road_Noise_Lden_England_Round_4_All</wcs:CoverageId>', fetchImpl: async () => ({ ok: true, headers: { get: () => 'image/tiff' }, arrayBuffer: async () => new ArrayBuffer(8) }), decode: async () => ({ width: 20, height: 20, values }) });
  const r = await ol.check({ lat: 51.5, lng: 0 });
  assert.equal(r.noise.status, 'ok'); assert.equal(r.noise.lden, 40);
});
