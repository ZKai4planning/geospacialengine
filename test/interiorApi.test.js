import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

test('API: the 3D interior is in the summary, readable, editable, and survives export / import', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();

  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  assert.equal(app.interior.available, true, 'summary carries the interior model');
  assert.ok(app.interior.rooms.length > 0);

  const proposed = await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });
  assert.ok(proposed.interior.rooms.some((r) => r.isNew), 'the new extension appears as a room');

  const got = await j(`/api/applications/${app.id}/interior`);
  assert.equal(got.interior.available, true);

  const patched = await j(`/api/applications/${app.id}/interior`, { method: 'PATCH', body: JSON.stringify({ ceilingM: 2.7 }) });
  assert.equal(patched.interiorSetup.ceilingM, 2.7);
  assert.equal(patched.interior.ceilingM, 2.7);

  const bad = await fetch(`${base}/api/applications/${app.id}/interior`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ceilingM: 99 }) });
  assert.equal(bad.status, 400);

  const exported = await j(`/api/applications/${app.id}/export.json`);
  assert.equal(exported.inputs.interior.ceilingM, 2.7);

  const imported = await fetch(`${base}/api/applications/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exported) });
  assert.equal(imported.status, 201);
  const copy = await imported.json();
  assert.equal(copy.interiorSetup.ceilingM, 2.7, 'the edit is replayed on import');
});

test('API: the summary says where every piece of data came from', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await (await fetch(`${base}/api/applications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '1234567890' }) })).json();
  const by = Object.fromEntries(app.sources.map((r) => [r.topic, r]));
  assert.equal(by['Planning authority (council)'].kind, 'estimated');
  assert.match(by['Planning authority (council)'].source, /postcode/i);
  assert.equal(by['Roof ridge and eaves height'].kind, 'measured');
  assert.equal(by['Rooms inside the 3D view'].kind, 'assumed');
  assert.match(by['Rooms inside the 3D view'].source, /not from the council/i);
  assert.ok(app.sources.every((r) => r.topic && r.kind && r.source), 'no row without a source');
});

test('API: roof type set by the applicant is used by the 3D model', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();
  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  const after = await j(`/api/applications/${app.id}/profile`, { method: 'PATCH', body: JSON.stringify({ roofType: 'Hipped', storeys: 3 }) });
  assert.equal(after.profile.roofType.value, 'Hipped');
  assert.equal(after.profile.roofType.source, 'user');
  assert.equal(after.interior.roof.type, 'hipped');
  assert.equal(after.interior.nStoreys, 3);
});
