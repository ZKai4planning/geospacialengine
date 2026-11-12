import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HTTP_USER_AGENT = 'test-agent/1.0';
process.env.OVERPASS_URLS = 'https://a.example/api';
process.env.OVERPASS_TIMEOUT_MS = '200';
const { createOsmBuildings } = await import('../src/providers/osmBuildings.js');
const { createOsmAddress } = await import('../src/providers/osmAddress.js');

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
async function withFetch(impl, fn) { const real = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = real; } }
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
const sq = [[0.05, 51.5], [0.0501, 51.5], [0.0501, 51.5001], [0.05, 51.5001], [0.05, 51.5]];

test('Overpass silent -> the house outline still comes from Nominatim (3D keeps working)', async () => {
  const urls = [];
  await withFetch((url, init) => {
    urls.push(String(url));
    if (!url.includes('nominatim')) return hang(init);   // every Overpass mirror stays silent
    return Promise.resolve(json([{ osm_id: 77, category: 'building', type: 'terrace', geojson: { type: 'Polygon', coordinates: [sq] }, extratags: { 'building:levels': '2', 'roof:shape': 'gabled' } }]));
  }, async () => {
    const site = await createOsmBuildings().findSite({ id: 'osm:way:77', lat: 51.50005, lng: 0.05005 });
    assert.equal(site.footprint.osmId, 77);
    assert.equal(site.footprint.levels, 2);
    assert.equal(site.footprint.buildingType, 'terrace');
    assert.ok(site.footprint.areaM2 > 50 && site.footprint.ring.length === 5);
    assert.ok(urls.some((u) => u.includes('/lookup') && u.includes('W77')));
  });
});

test('Overpass silent + a UPRN address -> outline by reverse geocoding the point; non-buildings are ignored', async () => {
  await withFetch((url, init) => (!url.includes('nominatim') ? hang(init) : Promise.resolve(json({ osm_id: 5, category: 'leisure', type: 'park', geojson: { type: 'Polygon', coordinates: [sq] } }))), async () => {
    await assert.rejects(createOsmBuildings().findSite({ id: '100023336956', lat: 51.5, lng: 0.05 }));
  });
});

test('postcode list falls back to Photon when Overpass is silent', async () => {
  const svc = createOsmAddress({ postcodes: { lookup: async () => ({ lat: 51.5, lng: 0.05 }) } });
  await withFetch((url, init) => {
    if (!url.includes('photon')) return hang(init);
    return Promise.resolve(json({ features: [
      { geometry: { coordinates: [0.05, 51.5] }, properties: { countrycode: 'GB', housenumber: '1', street: 'High Road', postcode: 'E6 2AA', city: 'London', osm_type: 'W', osm_id: 1 } },
      { geometry: { coordinates: [0.05, 51.5] }, properties: { countrycode: 'GB', housenumber: '9', street: 'Other Road', postcode: 'E6 9ZZ', osm_type: 'N', osm_id: 2 } },
    ] }));
  }, async () => {
    const list = await svc.byPostcode('E6 2AA');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'osm:way:1');
    assert.match(list[0].fullAddress, /1 High Road/);
  });
});
