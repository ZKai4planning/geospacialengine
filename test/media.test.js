import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaService } from '../src/services/mediaService.js';
import { createOsmMap } from '../src/providers/osmMap.js';

const app = { address: { lat: 51.5, lng: 0, fullAddress: 'x' }, map: { view: { lat: 51.5, lng: 0, zoom: 20, w: 640, h: 400 } }, media: { streetView: { available: true, panoId: '1', heading: 0 } } };
const boom = async () => { throw new Error('network down'); };
const failing = { aerial: { name: 'a', renderAerial: boom }, streetView: { name: 's', renderStreetView: boom } };

test('with no fallback map, failures return a placeholder image instead of throwing', async () => {
  const media = createMediaService({ providers: failing });
  const a = await media.aerialImage(app);
  assert.equal(a.contentType, 'image/svg+xml');
  assert.match(a.buffer.toString(), /Aerial photo unavailable/);
  assert.match((await media.streetViewImage(app, { w: 640, h: 400 })).buffer.toString(), /Street photo unavailable/);
});

test('aerial failure falls back to the OSM map for the same view', async () => {
  const calls = [];
  const osmMap = { attribution: '© OSM', render: async (o) => { calls.push(o); return { buffer: Buffer.from('<svg/>'), contentType: 'image/svg+xml' }; } };
  const media = createMediaService({ providers: failing, osmMap });
  await media.aerialImage(app);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].view.zoom, 20); // same view => outlines still line up
  assert.equal(calls[0].pin, undefined);
});

test('no street photo (no coverage / provider not set up / photo fails) shows a pinned map', async () => {
  const calls = [];
  const osmMap = { render: async (o) => { calls.push(o); return { buffer: Buffer.from('<svg/>'), contentType: 'image/svg+xml' }; } };
  const noCoverage = { ...app, media: { streetView: { available: false } } };
  await createMediaService({ providers: failing, osmMap }).streetViewImage(noCoverage, { w: 640, h: 400 });
  await createMediaService({ providers: { ...failing, streetView: { name: 'placeholder' } }, osmMap }).streetViewImage(app, { w: 640, h: 400 });
  await createMediaService({ providers: failing, osmMap }).streetViewImage(app, { w: 640, h: 400 });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.pin === true && c.view.zoom === 19));
  assert.match(calls[0].caption, /No street photo/);
  assert.match(calls[1].caption, /not set up/);
  assert.match(calls[2].caption, /could not be loaded/);
});

test('if the fallback map itself fails, the placeholder is returned', async () => {
  const osmMap = { render: boom };
  const media = createMediaService({ providers: failing, osmMap });
  assert.match((await media.aerialImage(app)).buffer.toString(), /Aerial photo unavailable/);
});

test('OSM map renders tiles + pin + attribution into one SVG', async () => {
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response(Buffer.alloc(5000, 2), { status: 200, headers: { 'content-type': 'image/png' } }); };
  try {
    const { makeView } = await import('../src/utils/mercator.js');
    const map = createOsmMap({ tileUrl: 'https://t.example/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 });
    const img = await map.render({ view: makeView({ lat: 51.5, lng: 0, zoom: 20, w: 640, h: 400 }), pin: true, caption: 'hello <b>' });
    const svg = img.buffer.toString();
    assert.ok(urls.length >= 2 && urls.every((u) => /^https:\/\/t\.example\/19\/\d+\/\d+\.png$/.test(u)));
    assert.match(svg, /data:image\/png;base64/);
    assert.match(svg, /© OpenStreetMap contributors/);
    assert.match(svg, /hello &lt;b&gt;/); // caption is escaped
    assert.match(svg, /fill="#d93025"/); // pin
  } finally { globalThis.fetch = real; }
});
