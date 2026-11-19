import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, DOMAINS } from '../src/data/intelligenceRegister.js';
import { COVERAGE_ROWS, ROUTE_BY_ID } from '../src/data/intelligenceCoverage.js';
import { buildCatalogue, buildLiveRegister, capabilities, summarise } from '../src/services/intelligenceRegister.js';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

test('the register holds all 228 checks across 17 domains, with unique ids', () => {
  assert.equal(CHECKS.length, 228);
  assert.equal(DOMAINS.length, 17);
  assert.equal(new Set(CHECKS.map((c) => c.id)).size, 228);
  for (const c of CHECKS) assert.match(c.id, /^PI-\d\d-\d\d$/);
  for (const d of DOMAINS) assert.equal(CHECKS.filter((c) => c.domain === d.no).length, CHECKS.filter((c) => c.id.startsWith(`PI-${d.no}-`)).length);
});

test('every check has exactly one coverage row, and the counts add up', () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  assert.equal(COVERAGE_ROWS.length, 228);
  for (const [id, status] of COVERAGE_ROWS) { assert.ok(ids.has(id), `${id} is not in the register`); assert.ok(['have', 'partial', 'missing'].includes(status), id); }
  const s = buildCatalogue({}).summary;
  assert.equal(s.have + s.partial + s.missing, 228);
  assert.equal(s.built, s.have + s.partial);
});

test('a missing check explains what it needs; a built check names its engine modules', () => {
  for (const [id, status, , modules, note] of COVERAGE_ROWS) {
    assert.ok(note && note.length > 5, `${id} needs a note`);
    if (status !== 'missing') assert.ok(modules, `${id} is built, so it must name its modules`);
  }
});

test('every missing check has a suggested route to close, and no built check does', () => {
  const rows = buildCatalogue({}).checks;
  for (const c of rows) assert.equal(!!c.route, c.status === 'missing', c.id);
  const s = summarise(rows);
  assert.equal(Object.values(s.routes).reduce((a, b) => a + b, 0), s.missing);
  // the baseline audit still records a route for each of the 95 checks the register module has since built (history, and what the module was built from)
  const baseline = COVERAGE_ROWS.filter((r) => r[1] === 'missing').map((r) => r[0]);
  assert.equal(baseline.length, 95);
  for (const id of baseline) assert.ok(ROUTE_BY_ID[id], `${id} has no recorded route`);
});

test('switches: a built check that needs a switch that is off is reported as off', () => {
  const off = buildCatalogue({ lidarEnabled: false, planningHistoryEnabled: false, coalEnabled: false, landfillEnabled: false }).checks;
  const on = buildCatalogue({ lidarEnabled: true, planningHistoryEnabled: true, coalEnabled: true, landfillEnabled: true, databaseUrl: 'x', osKey: 'k', epcToken: 't' }).checks;
  assert.equal(off.find((c) => c.id === 'PI-04-01').runtime, 'off');
  assert.equal(on.find((c) => c.id === 'PI-04-01').runtime, 'on');
  assert.equal(off.find((c) => c.id === 'PI-17-11').runtime, 'off');   // needs REVIEWER_TOKEN
  assert.equal(buildCatalogue({ reviewerToken: 't' }).checks.find((c) => c.id === 'PI-17-11').runtime, 'on');
  assert.equal(capabilities({}).osm, true);
});

test('live register on an empty application never throws and never claims a pass it cannot back', () => {
  const doc = buildLiveRegister({}, {});
  assert.equal(doc.checks.length, 228);
  assert.equal(doc.live.not_built, doc.coverage.missing);
  assert.equal(doc.live.pass, 0);
  for (const c of doc.checks) assert.equal(c.live.signOff, null);
});

test('GET /api/intelligence and /api/applications/:id/intelligence (mock mode)', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();

  const cat = await j('/api/intelligence');
  assert.equal(cat.summary.total, 228);
  assert.equal(cat.domains.length, 17);
  const csv = await (await fetch(`${base}/api/intelligence?format=csv`)).text();
  assert.equal(csv.trim().split('\r\n').length, 229);
  const html = await (await fetch(`${base}/api/intelligence?format=html`)).text();
  assert.ok(html.includes('228-parameter'));

  const pc = await j('/api/address/search?q=E6%202AA');
  const home = pc.suggestions.find((s) => s.fullAddress.startsWith('22 Example Road'));
  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: home.id }) });
  await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });
  const live = await j(`/api/applications/${app.id}/intelligence`);
  assert.equal(live.checks.length, 228);
  assert.equal(live.live.pass + live.live.issue + live.live.info + live.live.awaiting + live.live.not_built, 228);
  assert.ok(live.checks.find((c) => c.id === 'PI-05-18').live.state === 'info');
  assert.ok(live.checks.find((c) => c.id === 'PI-05-04').live.state !== 'not_built');
  // register workflow: readiness gate, evidence, reviewer sign-off (closed without REVIEWER_TOKEN), officer queue (closed too)
  const gate = await j(`/api/applications/${app.id}/readiness`);
  assert.equal(gate.state, 'held');
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const evRes = await post(`/api/applications/${app.id}/evidence/PI-02-05`, { kind: 'declaration', source: 'client', recordedBy: 'Ada Client', summary: 'No covenants declared by the client', values: { present: false } });
  assert.equal(evRes.status, 201);
  assert.equal((await post(`/api/applications/${app.id}/evidence/PI-99-99`, { kind: 'declaration' })).status, 404);
  assert.equal((await post(`/api/applications/${app.id}/sign-off/PI-02-05`, { decision: 'accepted', reviewer: 'Dr R. Singh', role: 'Conveyancer' })).status, 403);
  assert.equal((await fetch(`${base}/api/review-queue`)).status, 403);
  const after = await j(`/api/applications/${app.id}/intelligence`);
  assert.equal(after.checks.find((c) => c.id === 'PI-02-05').evidenceCount, 1);
  const lcsv = await (await fetch(`${base}/api/applications/${app.id}/intelligence?format=csv`)).text();
  assert.equal(lcsv.trim().split('\r\n').length > 228, true);
});
