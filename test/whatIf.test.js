import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { findLimits, sliderFields } = await import('../src/services/whatIf.js');
const { assessProposal } = await import('../src/services/permittedDevelopment.js');
const { createApp } = await import('../src/app.js');

// a pure evaluator for the finder: terraced house, no site data, so only the depth/height limits matter
const evaluate = async (proposal) => { const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal, existingExtensionDepthM: 0, plotAreaM2: 100 }); return { verdict: a.verdict, label: a.label, checks: a.checks }; };
const base = { type: 'rear_extension', storeys: 1, depthM: 2, heightM: 3, widthM: 4, eavesHeightM: 2.8, distanceToSideBoundaryM: 3, additionsAreaM2: 15 };

test('findLimits: finds the exact depths where a terraced rear extension changes route (3 m and 6 m)', async () => {
  const r = await findLimits({ proposal: base, field: 'depthM', evaluate });
  assert.deepEqual(r.flips.map((f) => [f.before, f.at, f.from, f.to]), [[3, 3.1, 'permitted_development', 'prior_approval'], [6, 6.1, 'prior_approval', 'planning_permission']]);
  assert.deepEqual(r.ranges.map((x) => x.verdict), ['permitted_development', 'prior_approval', 'planning_permission']);
  assert.ok(r.flips[0].because.some((b) => b.id === 'rear-depth' && b.to === 'warn'));
  assert.ok(r.flips[1].because.some((b) => b.id === 'rear-depth' && b.to === 'fail'));
  assert.equal(r.currentVerdict, 'permitted_development');
  assert.ok(r.runs <= 110, `used ${r.runs} engine runs`);
});

test('findLimits: height has one limit (4 m for a single storey)', async () => {
  const r = await findLimits({ proposal: base, field: 'heightM', evaluate });
  assert.equal(r.flips.length, 1);
  assert.equal(r.flips[0].before, 4); assert.equal(r.flips[0].to, 'planning_permission');
  assert.ok(r.flips[0].because.some((b) => b.id === 'height'));
});

test('findLimits: a field that changes nothing reports no flips; an unknown field is refused', async () => {
  const r = await findLimits({ proposal: base, field: 'widthM', evaluate });
  assert.deepEqual(r.flips, []); assert.equal(r.ranges.length, 1);
  await assert.rejects(() => findLimits({ proposal: base, field: 'storeys', evaluate }), /cannot be moved|not a number/);
  assert.ok(sliderFields(base).some((f) => f.name === 'depthM') && !sliderFields(base).some((f) => f.name === 'storeys'));
  assert.deepEqual(sliderFields({ type: 'custom_polygon', treatAs: 'rear_extension' }).map((f) => f.name).includes('depthM'), false);
});

test('API: what-if answers for a changed proposal and does NOT save it', async (t) => {
  const server = createApp().listen(0); t.after(() => server.close());
  const base_ = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o) => { const r = await fetch(base_ + p, { headers: { 'content-type': 'application/json' }, ...o }); return { status: r.status, body: await r.json() }; };
  const app = (await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) })).body;
  const saved = (await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 2.5, heightM: 3 }) })).body;
  assert.equal(saved.assessment.verdict, 'permitted_development');

  const w = await j(`/api/applications/${app.id}/what-if`, { method: 'POST', body: JSON.stringify({ proposal: { type: 'rear_extension', depthM: 5, heightM: 3 } }) });
  assert.equal(w.status, 200);
  assert.equal(w.body.verdict, 'prior_approval');
  assert.ok(w.body.checks.some((c) => c.id === 'rear-depth' && c.status === 'warn'));
  assert.ok(w.body.geometry.proposal.length >= 3 && w.body.walls.length >= 3, 'plan geometry and wall statuses come back for the live plan');

  const after = (await j(`/api/applications/${app.id}`)).body;
  assert.equal(after.proposal.depthM, 2.5, 'the saved proposal is untouched');
  assert.equal(after.assessment.verdict, 'permitted_development');

  const bad = await j(`/api/applications/${app.id}/what-if`, { method: 'POST', body: JSON.stringify({ proposal: { type: 'rear_extension', depthM: 99, heightM: 3 } }) });
  assert.equal(bad.status, 400, 'the same validation as saving');

  const lim = await j(`/api/applications/${app.id}/what-if/limits`, { method: 'POST', body: JSON.stringify({ proposal: { type: 'rear_extension', depthM: 2.5, heightM: 3 }, field: 'depthM' }) });
  assert.equal(lim.status, 200);
  assert.ok(lim.body.flips.length >= 1 && lim.body.flips[0].before === 3, JSON.stringify(lim.body.flips));
  assert.equal((await j(`/api/applications/${app.id}/what-if/limits`, { method: 'POST', body: JSON.stringify({ proposal: { type: 'rear_extension', depthM: 2.5, heightM: 3 }, field: 'nope' }) })).status, 400);
});
