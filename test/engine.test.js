import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';   // must be set before anything that reads the config is imported
const { runSiteChecks } = await import('../src/services/siteChecks.js');
const { registerRule, SITE_RULES } = await import('../src/services/rules/index.js');
const { decisionPath, buildRulebook } = await import('../src/services/engineTrace.js');
const { createApp } = await import('../src/app.js');

const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const house = rect(0, 0, 5, 9), ext = rect(0, 9, 5, 13);

test('the trace records every rule in order, with what it measured and what it said', () => {
  const r = runSiteChecks({ proposalRing: ext, houseRing: house, neighbours: [{ id: 'n1', ring: rect(5, 0, 10, 12) }] });
  assert.equal(r.trace.ran, true);
  assert.deepEqual(r.trace.rules.map((x) => x.id), SITE_RULES.map((x) => x.id));
  const nbr = r.trace.rules.find((x) => x.id === 'neighbours');
  assert.equal(nbr.title, 'Neighbouring buildings');
  assert.ok(nbr.thresholds.some((t) => t.key === 'closeM' && t.value === 1), 'the thresholds used are listed with their values');
  assert.ok(nbr.measures.length === 1 && nbr.measures[0].ref.kind === 'neighbour');
  const walls = r.trace.rules.find((x) => x.id === 'wall-safety');
  assert.ok(walls.added.some((i) => i.status === 'warn'), 'what the rule added is attributed to it');
  assert.ok(walls.measures.some((m) => /TOUCHES a neighbour/.test(m.value) && m.ref.kind === 'wall'));
  assert.equal(walls.affectsVerdict, false);
  assert.ok(r.trace.geometry.proposal.length === 4 && r.trace.geometry.neighbours.length === 1, 'the plan geometry is included, in metres');
});

test('every item in Map checks is attributed to exactly one rule in the trace', () => {
  const r = runSiteChecks({ proposalRing: ext, houseRing: house, neighbours: [{ id: 'n1', ring: rect(5.6, 0, 10, 13) }] });
  const traced = r.trace.rules.flatMap((x) => x.added.map((i) => i.message)).filter((m) => r.items.some((i) => i.message === m));
  assert.equal(traced.length, r.items.length);
});

test('a rule that throws is reported in the trace and does not stop the others; a custom rule is traced too', () => {
  const undo = [registerRule({ id: 'boom', run() { throw new Error('bad rule'); } }), registerRule({ id: 'mine', run(_, res) { res.items.push({ status: 'warn', message: 'custom said so' }); } })];
  try {
    const r = runSiteChecks({ proposalRing: ext, houseRing: house });
    const boom = r.trace.rules.find((x) => x.id === 'boom'), mine = r.trace.rules.find((x) => x.id === 'mine');
    assert.equal(boom.error, 'bad rule');
    assert.equal(mine.added[0].message, 'custom said so');
    assert.equal(mine.title, 'mine');
  } finally { undo.forEach((u) => u()); }
});

test('skipped runs say why instead of showing an empty list', () => {
  assert.equal(runSiteChecks({ proposalRing: null }).trace.skipped.reason, 'no-proposal');
  assert.equal(runSiteChecks({ proposalRing: ext, houseRing: house, footprintWork: false }).trace.skipped.reason, 'roof-level');
  assert.equal(runSiteChecks({ proposalRing: ext, houseRing: house, houseIndicative: true }).trace.skipped.reason, 'no-outline');
});

test('decision path: gate stop, limits not met, prior approval, permitted development', () => {
  const mk = (verdict, checks, o = {}) => ({ verdict, label: verdict, summary: 's', confidence: 'high', checks, ...o });
  assert.equal(decisionPath(mk('listed_building_consent', [{ id: 'listed', status: 'fail', message: 'listed' }]))[0].outcome, 'stopped');
  const lim = decisionPath(mk('planning_permission', [{ id: 'rear-depth', status: 'fail', message: 'x' }]));
  assert.match(lim[1].outcome, /1 limit not met/); assert.equal(lim.at(-1).outcome, 'Planning permission needed');
  assert.equal(decisionPath(mk('prior_approval', [{ id: 'rear-depth', status: 'warn', message: 'x' }])).find((s) => s.label === 'Special routes').status, 'warn');
  assert.equal(decisionPath(mk('permitted_development', [{ id: 'height', status: 'pass', message: 'x' }])).at(-1).status, 'ok');
});

test('rulebook lists every site rule with its numbers, and the GPDO limits', () => {
  const rb = buildRulebook();
  assert.ok(rb.siteRules.find((r) => r.id === 'wall-safety').thresholds.some((t) => t.key === 'wallFireM' && t.value === 1));
  assert.equal(rb.gpdo.limits.rearDepthM.attached, 3);
  assert.ok(rb.gpdo.classes.some((c) => c.class === 'A' && c.provisions.length > 5));
});

test('API (mock mode): the engine room follows the whole pipeline for a real draft', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();
  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  assert.equal(app.engine.stages.find((s) => s.id === 'proposal').status, 'pending');
  const done = await j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'rear_extension', depthM: 4, heightM: 3 }) });
  const ids = done.engine.stages.map((s) => s.id);
  assert.deepEqual(ids, ['data', 'frame', 'proposal', 'site', 'checks', 'gpdo', 'decision', 'council']);
  const site = done.engine.stages.find((s) => s.id === 'site');
  assert.ok(site.rules.length >= 10 && site.rules.some((r) => r.id === 'wall-safety'));
  assert.ok(done.engine.geometry.proposal.length >= 3 && done.engine.walls.length >= 3);
  assert.equal(done.engine.stages.find((s) => s.id === 'decision').verdict.verdict, done.assessment.verdict);
  const again = await j(`/api/applications/${app.id}/engine`);
  assert.deepEqual(again.stages.map((s) => s.id), ids);
  const rb = await j('/api/engine/rules');
  assert.ok(rb.siteRules.length >= 11);
});
