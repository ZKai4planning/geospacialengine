import test from 'node:test';
import assert from 'node:assert/strict';
import { createEsriAerial } from '../src/providers/esriAerial.js';
import { makeView, project, toMerc } from '../src/utils/mercator.js';

test('falls back to stitched tiles, positioned so a known point lands on the right pixel', async () => {
  const real = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/export')) throw new Error('timeout');
    requested.push(u);
    return new Response(Buffer.alloc(8000, 1), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const view = makeView({ lat: 51.5772, lng: 0.0803, zoom: 20, w: 640, h: 400 });
    const img = await createEsriAerial().renderAerial({ view });
    assert.equal(img.contentType, 'image/svg+xml');
    const svg = img.buffer.toString();
    const tiles = [...svg.matchAll(/<image x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
    assert.ok(tiles.length >= 4 && tiles.length === requested.length);
    assert.ok(requested.every((u) => /\/tile\/19\/\d+\/\d+$/.test(u))); // capped at zoom 19
    // together the tiles must cover the whole view
    assert.ok(Math.min(...tiles.map((t) => t[0])) <= 0 && Math.min(...tiles.map((t) => t[1])) <= 0);
    assert.ok(Math.max(...tiles.map((t) => t[0] + t[2])) >= 640 && Math.max(...tiles.map((t) => t[1] + t[2])) >= 400);
    // tile edges are contiguous (one tile = same width, neighbours abut)
    const w = tiles[0][2];
    assert.ok(tiles.every((t) => Math.abs(t[2] - w) < 1e-6));
    // projecting the view centre lands in the middle of the picture
    const [cx, cy] = project(view, view.lng, view.lat);
    assert.deepEqual([cx, cy], [320, 200]);
    void toMerc;
  } finally { globalThis.fetch = real; }
});
