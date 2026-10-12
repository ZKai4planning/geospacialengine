import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HTTP_USER_AGENT = 'test-agent/1.0';
process.env.OVERPASS_URLS = 'https://a.example/api,https://b.example/api';
const { overpass } = await import('../src/providers/overpass.js');
const { createOsmAddress } = await import('../src/providers/osmAddress.js');

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('a 406 from one mirror fails over to the next immediately, with a User-Agent', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ ua: init.headers['user-agent'], accept: init.headers.accept });
    return url.startsWith('https://a.example') ? new Response('nope', { status: 406 }) : json({ elements: [{ id: 1 }] });
  }, async () => {
    const data = await overpass('[out:json];node(1);out;');
    assert.equal(data.elements[0].id, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.ua === 'test-agent/1.0' && c.accept === '*/*'));
  });
});

test('a slow mirror is hedged by the next one and then cancelled', async () => {
  let aborted = false;
  await withFetch((url, init) => {
    if (url.startsWith('https://a.example')) {
      return new Promise((_, rej) => init.signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); }));
    }
    return Promise.resolve(json({ elements: [{ id: 2 }] }));
  }, async () => {
    const data = await overpass('q', { hedgeMs: 20 });
    assert.equal(data.elements[0].id, 2);
    assert.ok(aborted);
  });
});

test('postcode lookup searches a small circle and keeps exact + untagged-nearby addresses', async () => {
  const centre = { lat: 51.5, lng: 0.1 };
  const el = (id, tags, dLat = 0) => ({ type: 'way', id, tags, center: { lat: centre.lat + dLat, lon: centre.lng } });
  let query = '';
  await withFetch(async (url, init) => {
    query = init.body.get('data');
    return json({ elements: [
      el(1, { 'addr:housenumber': '1', 'addr:street': 'High Road', 'addr:postcode': 'IG6 2JE' }),
      el(2, { 'addr:housenumber': '2', 'addr:street': 'High Road' }, 0.0003),          // untagged, ~33 m -> inferred
      el(3, { 'addr:housenumber': '3', 'addr:street': 'High Road', 'addr:postcode': 'IG6 9ZZ' }), // other postcode -> dropped
      el(4, { 'addr:housenumber': '4', 'addr:street': 'High Road' }, 0.002),           // untagged, ~220 m -> dropped
    ] });
  }, async () => {
    const osm = createOsmAddress({ postcodes: { lookup: async () => ({ ...centre }) } });
    const list = await osm.byPostcode('IG6 2JE');
    assert.deepEqual(list.map((a) => a.buildingNumber).sort(), ['1', '2']);
    assert.ok(list.every((a) => a.postcode === 'IG6 2JE'));
    assert.match(query, /around:\d+,51\.5,0\.1/);
    assert.ok(!/addr:postcode"~/.test(query)); // no country-wide regex scan
  });
});
