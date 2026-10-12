import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

test('postcode -> confirm -> choose work -> map + assessment (mock mode)', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();

  const types = await j('/api/work-types');
  assert.ok(types.types.some((x) => x.type === 'rear_dormer'));

  const pc = await j('/api/address/search?q=E6%202AA');
  assert.equal(pc.type, 'postcode');
  const home = pc.suggestions.find((s) => s.fullAddress.startsWith('22 Example Road'));
  assert.equal(home.id, '1234567890');

  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: home.id }) });
  assert.equal(app.cards.property.title, '22 Example Road');
  assert.equal(app.address.postcode, 'E6 2AA');
  assert.equal(app.map.layers[0].kind, 'building');

  await j(`/api/applications/${app.id}/profile`, { method: 'PATCH', body: JSON.stringify({ existingExtension: { depthM: 2.8 } }) });
  const done = await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });
  assert.equal(done.assessment.verdict, 'planning_permission');
  assert.ok(done.map.layers.some((l) => l.id === 'proposal'));

  const bad = await fetch(`${base}/api/applications/${app.id}/proposal`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'rear_extension', depthM: 99, heightM: 3 }) });
  assert.equal(bad.status, 400);
});
