import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

async function setup(t) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();
  return { base, j };
}

test('export the filled-in application as JSON, then import it into a new draft', async (t) => {
  const { base, j } = await setup(t);
  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  await j(`/api/applications/${app.id}/profile`, { method: 'PATCH', body: JSON.stringify({ roofType: 'Pitched', storeys: 2, existingExtension: { depthM: 2.8 } }) });
  await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });

  const res = await fetch(`${base}/api/applications/${app.id}/export.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="PA-\d{4}-\d+\.json"/);
  const doc = await res.json();
  assert.equal(doc.schema, 'uk-planning-engine/application');
  assert.equal(doc.inputs.address.id, '1234567890');
  assert.equal(doc.inputs.profile.roofType, 'Pitched');
  assert.equal(doc.inputs.profile.existingExtension.depthM, 2.8);
  assert.equal(doc.inputs.proposal.type, 'rear_extension');
  assert.equal(doc.results.assessment.verdict, 'planning_permission');
  assert.ok(JSON.stringify(doc).length < 250_000, 'export stays well inside the request limit');

  // attach it to the next one: a new draft with the same answers, and the same verdict re-derived
  const next = await j('/api/applications/import', { method: 'POST', body: JSON.stringify(doc) });
  assert.notEqual(next.id, app.id);
  assert.equal(next.address.fullAddress, app.address.fullAddress);
  assert.equal(next.profile.roofType.value, 'Pitched');
  assert.equal(next.profile.existingExtension.depthM, 2.8);
  assert.equal(next.proposal.type, 'rear_extension');
  assert.equal(next.assessment.verdict, 'planning_permission');
});

test('import ignores a doctored `results` section and rejects bad files', async (t) => {
  const { base, j } = await setup(t);
  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  const done = await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });
  const doc = await (await fetch(`${base}/api/applications/${app.id}/export.json`)).json();
  const forged = done.assessment.verdict === 'permitted_development' ? 'planning_permission' : 'permitted_development';
  doc.results.assessment.verdict = forged;
  const next = await j('/api/applications/import', { method: 'POST', body: JSON.stringify(doc) });
  assert.equal(next.assessment.verdict, done.assessment.verdict);
  assert.notEqual(next.assessment.verdict, forged);

  const post = (body) => fetch(`${base}/api/applications/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ hello: 'world' })).status, 400);
  assert.equal((await post({ ...doc, version: 99 })).status, 400);
  assert.equal((await post({ ...doc, inputs: { ...doc.inputs, address: {} } })).status, 400);
  assert.equal((await post({ ...doc, inputs: { ...doc.inputs, proposal: { type: 'rear_extension', depthM: 99, heightM: 3 } } })).status, 400);
});
