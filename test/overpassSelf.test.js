import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HTTP_USER_AGENT = 'test-agent/1.0';
process.env.OVERPASS_URLS = 'https://pub.example/api/interpreter';
process.env.OVERPASS_SELF_URL = 'https://self.example/api/interpreter';
process.env.OVERPASS_SELF_KEY = 'secret';
const { overpass } = await import('../src/providers/overpass.js');

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

test('your own server is tried first with the X-Api-Key header; a failure falls back to a public mirror without the key', async () => {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, key: init.headers['x-api-key'] });
    return url.startsWith('https://self.example') ? new Response('Unauthorized', { status: 401 }) : json({ elements: [{ id: 2 }] });
  };
  try {
    const data = await overpass('[out:json];node(1);out;');
    assert.equal(data.elements[0].id, 2);
  } finally { globalThis.fetch = real; }
  assert.equal(calls[0].url, 'https://self.example/api/interpreter');
  assert.equal(calls[0].key, 'secret');
  assert.equal(calls[1].url, 'https://pub.example/api/interpreter');
  assert.equal(calls[1].key, undefined);
});
