import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyApplication, addressMatch, parsePlanit, splitHistory, outcomeOf, createPlanit } from '../src/providers/planit.js';
import { summariseHistory } from '../src/services/planningHistory.js';
import { assessLpa } from '../src/services/lpaPolicy.js';

const NOW = new Date('2026-10-24');

test('application descriptions are classified by the kind of work', () => {
  const k = (d, t) => classifyApplication(d, t).kind;
  assert.equal(k('Erection of a single storey rear extension'), 'rear');
  assert.equal(k('Two storey side extension'), 'side');
  assert.equal(k('Single storey rear and side wraparound extension'), 'wraparound');
  assert.equal(k('Rear extension and side extension'), 'wraparound');
  assert.equal(k('Erection of front porch'), 'porch');
  assert.equal(k('Rear dormer and loft conversion'), 'dormer');
  assert.equal(k('Erection of a garden room outbuilding'), 'outbuilding');
  assert.equal(k('Construction of an additional storey'), 'storey');
  assert.equal(k('Extension to dwelling'), 'extension');
  assert.equal(k('Replacement windows'), null);
  assert.equal(classifyApplication('Certificate of lawfulness for a proposed rear extension').lawful, true);
  assert.equal(classifyApplication('Larger home extension prior approval notification').prior, true);
  assert.equal(classifyApplication('Conversion of house into 2 self-contained flats').flats, true);
  assert.equal(classifyApplication('Erection of 4 dwellings with associated parking').newDwelling, true);
  assert.equal(classifyApplication('Single storey rear extension and erection of garage').newDwelling, false);
  assert.deepEqual(['Permitted', 'Conditions', 'Rejected', 'Withdrawn', 'Undecided', 'Mystery'].map(outcomeOf), ['approved', 'approved', 'refused', 'withdrawn', 'pending', 'unknown']);
});

test('address matching: the same house (abbreviations too), never 22 for 2, flats in the building kept apart', () => {
  assert.equal(addressMatch('223 Capworth Street, Leyton, London E10 7AA', '223 Capworth Street'), 'house');
  assert.equal(addressMatch('223 Capworth St, London', '223 Capworth Street'), 'house');
  assert.equal(addressMatch('22 Capworth Street, London', '2 Capworth Street'), null);
  assert.equal(addressMatch('2 Capworth Street, London', '22 Capworth Street'), null);
  assert.equal(addressMatch('Flat 2, 223 Capworth Street, London', '223 Capworth Street'), 'building');
  assert.equal(addressMatch('Ground Floor Flat, 223 Capworth Street', '223 Capworth Street'), 'building');
  assert.equal(addressMatch(null, '223 Capworth Street'), null); assert.equal(addressMatch('223 Capworth Street', ''), null);
});

test('PlanIt JSON and GeoJSON both parse; field names are read tolerantly', () => {
  const rec = { uid: '2021/0123/HH', area_name: 'Waltham Forest', address: '223 Capworth Street', description: 'Single storey rear extension', app_type: 'Full', app_state: 'Permitted', start_date: '2021-02-03', decided_date: '2021-04-05', lat: 51.57, lng: -0.01, url: 'https://c.example/1', link: 'https://www.planit.org.uk/x' };
  const a = parsePlanit({ records: [rec] })[0];
  assert.equal(a.ref, '2021/0123/HH'); assert.equal(a.outcome, 'approved'); assert.equal(a.kind, 'rear'); assert.equal(a.decidedOn, '2021-04-05'); assert.equal(a.councilUrl, 'https://c.example/1');
  const g = parsePlanit({ features: [{ properties: { ...rec, lat: undefined, lng: undefined }, geometry: { coordinates: [-0.01, 51.57] } }] })[0];
  assert.equal(g.lat, 51.57); assert.equal(g.lng, -0.01);
  assert.deepEqual(parsePlanit({}), []);
});

const ll = { lat: 51.57, lng: -0.01 };
const at = (dLat) => ({ lat: ll.lat + dLat, lng: ll.lng });
const rec = (o) => ({ ref: 'r', address: '1 Other Road', description: 'Single storey rear extension', state: 'Permitted', outcome: 'approved', receivedOn: '2022-01-01', decidedOn: '2022-03-01', ...at(0.0003), ...classifyApplication(o.description ?? 'Single storey rear extension'), ...o });

test('history is split into this house, the same building and similar work within 150 m', () => {
  const s = splitHistory([
    rec({ address: '223 Capworth Street', description: 'Rear dormer', ...at(0) }),
    rec({ address: 'Flat 1, 223 Capworth Street', description: 'Replacement windows', ...at(0) }),
    rec({ address: '9 Near Road', ...at(0.0005) }),                       // ~55 m
    rec({ address: '90 Far Road', ...at(0.003) }),                        // ~330 m: out
    rec({ address: '10 Near Road', description: 'Replacement windows', ...at(0.0005) }),   // nothing relevant: not kept
  ], { ...ll, line1: '223 Capworth Street' });
  assert.equal(s.here.length, 1); assert.equal(s.building.length, 1);
  assert.deepEqual(s.nearby.map((r) => r.address), ['9 Near Road']);
  assert.ok(s.nearby[0].distanceM > 40 && s.nearby[0].distanceM < 70);
});

const hist = (here, nearby) => ({ here, building: [], nearby, radiusM: 150, years: 10 });
test('this house: earlier extension, flats conversion, new-build permission, refusal and lawful certificate each raise the right note', () => {
  const h = hist([
    rec({ description: 'Single storey rear extension', decidedOn: '2014-05-05' }),
    rec({ description: 'Conversion of house into 2 flats', decidedOn: '2009-05-05' }),
    rec({ description: 'Erection of 12 dwellings', decidedOn: '2003-01-01' }),
    rec({ description: 'Two storey side extension', outcome: 'refused', state: 'Rejected', decidedOn: '2018-01-01' }),
    rec({ description: 'Certificate of lawfulness for a rear extension', decidedOn: '2020-01-01' }),
  ], []);
  const s = summariseHistory(h, { type: 'side_extension', now: NOW });
  const ids = s.checks.map((c) => c.id);
  for (const id of ['history-extension', 'history-flats', 'history-new-dwelling', 'history-refused']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('history-lawful'), 'the lawful certificate was for a rear extension, not the side extension being asked about');
  assert.equal(s.checks.find((c) => c.id === 'history-flats').status, 'warn');
  assert.match(s.checks.find((c) => c.id === 'history-new-dwelling').message, /decision notice/);
  assert.ok(summariseHistory(h, { type: 'rear_extension', now: NOW }).checks.some((c) => c.id === 'history-lawful'));
  assert.ok(!summariseHistory(h, { type: 'rear_extension', existingExtensionKnown: true, now: NOW }).checks.some((c) => c.id === 'history-extension'), 'not asked twice if the applicant already said');
});

test('nearby precedent: counts approved / refused of the same kind in the last 10 years; lawful certificates, prior approvals and old decisions are not counted', () => {
  const nearby = [
    rec({ decidedOn: '2023-01-01' }), rec({ decidedOn: '2022-01-01' }), rec({ decidedOn: '2021-01-01' }),
    rec({ outcome: 'refused', state: 'Rejected', decidedOn: '2020-01-01' }),
    rec({ decidedOn: '2008-01-01' }),                                                    // older than 10 years
    rec({ description: 'Certificate of lawfulness for rear extension', decidedOn: '2023-01-01' }),
    rec({ description: 'Larger home extension prior approval', decidedOn: '2023-01-01' }),
    rec({ description: 'Erection of front porch', decidedOn: '2023-01-01' }),             // different kind
  ];
  const s = summariseHistory(hist([], nearby), { type: 'rear_extension', now: NOW });
  assert.equal(s.precedent.approved, 3); assert.equal(s.precedent.refused, 1); assert.equal(s.precedent.decided, 4); assert.equal(s.precedent.approvalRate, 0.75);
  assert.equal(s.precedent.lawfulNearby, 1); assert.equal(s.precedent.examples.length, 4);
  assert.match(s.checks.find((c) => c.id === 'history-precedent').message, /3 approved, 1 refused \(75% approved\)/);
  assert.equal(summariseHistory(hist([], nearby.slice(0, 2)), { type: 'rear_extension', now: NOW }).precedent.approvalRate, null, 'fewer than 3 decided: no percentage');
  assert.equal(summariseHistory(hist([], nearby), { type: 'front_porch', now: NOW }).precedent.approved, 1);
  assert.equal(summariseHistory(null, { type: 'rear_extension' }), null);
});

test('council layer: strong precedent supports, weak precedent warns, only when permission is needed', () => {
  const base = { authorityName: 'Waltham Forest', verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, plotAreaM2: 300, houseFootprintM2: 40, proposalAreaM2: 10 };
  const mk = (approved, refused) => ({ decided: approved + refused, approved, refused, approvalRate: Math.round((approved / (approved + refused)) * 100) / 100, radiusM: 150, years: 10 });
  assert.ok(assessLpa({ ...base, precedent: mk(5, 1) }).checks.some((c) => c.status === 'pass' && /usually been accepted/.test(c.message)));
  assert.ok(assessLpa({ ...base, precedent: mk(1, 4) }).checks.some((c) => c.status === 'warn' && /often been refused/.test(c.message)));
  assert.ok(assessLpa({ ...base, precedent: mk(2, 2) }).checks.some((c) => c.status === 'info' && /mixed record/.test(c.message)));
  assert.ok(!assessLpa({ ...base, verdict: 'permitted_development', precedent: mk(1, 4) }).checks.some((c) => /refused here/.test(c.message)));
});

test('provider is OFF by default; when on it asks PlanIt for a 150 m radius and 10 years and returns the split history', async () => {
  assert.equal(await createPlanit({ url: 'https://p.test/api', enabled: false }).findHistory({ ...ll, line1: '1 X' }), null);
  const real = globalThis.fetch; let seen = '', ua = '';
  globalThis.fetch = async (url, init) => { seen = String(url); ua = init.headers['user-agent']; return new Response(JSON.stringify({ records: [{ uid: 'a', address: '223 Capworth Street', description: 'Rear dormer', app_state: 'Permitted', start_date: '2020-01-01', lat: ll.lat, lng: ll.lng }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const r = await createPlanit({ url: 'https://p.test/api', enabled: true }).findHistory({ ...ll, line1: '223 Capworth Street', now: NOW });
    assert.match(seen, /lat=51\.57/); assert.match(seen, /krad=0\.15/); assert.match(seen, /start_date=2016-10-2/); assert.match(ua, /planning-screening/);
    assert.equal(r.here.length, 1); assert.equal(r.here[0].kind, 'dormer'); assert.match(r.attribution, /PlanIt/);
  } finally { globalThis.fetch = real; }
});

test('flow: history is stored, summarised in the assessment, and a failing provider is reported, not fatal', async () => {
  process.env.MOCK_PROVIDERS = 'true';
  const { createContainer } = await import('../src/container.js');
  const { createMockProviders } = await import('../src/providers/mock.js');
  const b = createMockProviders(), mk = (p = {}) => createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null, ...p }, db: null }).applicationService;
  const svc = mk();
  let app = await svc.create({ id: '1234567886' });
  assert.equal(app.history.here.length, 1);
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.equal(app.assessment.precedent.approved, 3); assert.equal(app.assessment.precedent.refused, 1);
  const ids = app.assessment.checks.map((c) => c.id);
  assert.ok(ids.includes('history-extension') && ids.includes('history-precedent'));
  const off = mk({ planning: { name: 'x', async findHistory() { return null; } } });
  const o = await off.create({ id: '1234567888' });
  assert.equal(o.history, null);
  const down = mk({ planning: { name: 'x', async findHistory() { throw new Error('PlanIt unavailable'); } } });
  const d = await down.create({ id: '1234567890' });
  assert.equal(d.history, null); assert.ok(d.warnings.some((w) => /Planning history/i.test(w)));
});
