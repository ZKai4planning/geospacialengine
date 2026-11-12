import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLpa } from '../src/services/lpaPolicy.js';
import { lpaFor, lpaKey } from '../src/data/lpaRules.js';
import { outsidePlotCheck } from '../src/services/frontSpace.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';

const base = { authorityName: 'Waltham Forest', plotAreaM2: 181.6, houseFootprintM2: 74.4, proposalAreaM2: 72.3, existingDepthM: 0 };

test('authority names are matched loosely', () => {
  assert.equal(lpaKey('London Borough of Waltham Forest'), 'waltham forest');
  assert.ok(lpaFor('Waltham Forest'));
  assert.equal(lpaFor('Nowhere'), null);
});

test('a 7 m rear extension on a 182 m² plot: depth and garden both flagged, outlook at risk, areas measured', () => {
  const l = assessLpa({ ...base, verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 7, widthM: 7.8, storeys: 1 } });
  assert.equal(l.outlook, 'at_risk');
  assert.equal(l.measured.remainingGardenM2, 34.9);
  assert.equal(l.measured.coveragePct, 81);
  const depth = l.checks.find((c) => /Rear depth/.test(c.message));
  assert.equal(depth.status, 'warn'); assert.match(depth.message, /more than double/);
  assert.ok(l.checks.some((c) => c.status === 'warn' && /habitable room/.test(c.message)));
});

test('within the 3 m guide and plenty of garden = likely_ok; permitted development = not_needed', () => {
  const ok = assessLpa({ ...base, verdict: 'planning_permission', plotAreaM2: 400, proposalAreaM2: 15, proposal: { type: 'rear_extension', depthM: 3, storeys: 1 } });
  assert.equal(ok.outlook, 'likely_ok');
  assert.equal(assessLpa({ ...base, verdict: 'permitted_development', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 } }).outlook, 'not_needed');
});

test('building outside the title or on public land = unlikely, whatever the design', () => {
  const l = assessLpa({ ...base, verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 2, storeys: 1 }, outsidePlot: { level: 'certain' } });
  assert.equal(l.outlook, 'unlikely');
});

test('an authority with no rules loaded says so instead of guessing', () => {
  const l = assessLpa({ ...base, authorityName: 'Nowhere', verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 5 } });
  assert.equal(l.available, false); assert.match(l.headline, /No local rules loaded/);
});

test('work outside the registered title decides the verdict (planning permission), outline estimate only warns', () => {
  const sure = outsidePlotCheck({ proposal: { type: 'rear_extension' }, siteChecks: { boundary: { status: 'crosses', estimated: false, outsideM2: 4.8, maxOutsideM: 4.3 } } });
  assert.equal(sure.level, 'certain');
  const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', depthM: 2, widthM: 3, heightM: 3, storeys: 1 }, existingExtensionDepthM: 0, outsidePlot: sure });
  assert.equal(a.verdict, 'planning_permission'); assert.equal(a.blocker.id, 'outside-plot');
  const est = outsidePlotCheck({ proposal: { type: 'rear_extension' }, siteChecks: { boundary: { status: 'crosses', estimated: true, outsideM2: 4.8, maxOutsideM: 4.3 } } });
  assert.equal(est.level, 'likely');
  assert.equal(outsidePlotCheck({ proposal: { type: 'rear_extension' }, siteChecks: { boundary: { status: 'inside' } } }), null);
});

import { buildAreas } from '../src/services/lpaPolicy.js';
test('area breakdown: plot, house, extension, left over and coverage, each with how it was worked out', () => {
  const a = buildAreas({ plotAreaM2: 181.6, plotKind: 'title', houseFootprintM2: 74.4, extensionAreaM2: 72.3, extensionDims: '7.8 × 12.1 m' });
  const by = Object.fromEntries(a.rows.map((r) => [r.label, r]));
  assert.equal(by['Plot (land) area'].value, '181.6 m²'); assert.match(by['Plot (land) area'].how, /Land Registry/);
  assert.equal(by['House + extension'].value, '146.7 m²');
  assert.equal(by['Left over (garden, indicative)'].value, '34.9 m²');
  assert.equal(by['Plot covered'].value, '81%');
  assert.ok(a.rows.every((r) => r.how));
});
test('area breakdown still shows plot and house when there is no proposal or no plot', () => {
  const a = buildAreas({ plotAreaM2: 120, plotKind: 'estimate', houseFootprintM2: 50 });
  assert.equal(a.rows.find((r) => r.label === 'Plot (land) area').how.includes('estimated'), true);
  assert.ok(!a.rows.some((r) => r.label === 'Proposed extension'));
  assert.equal(buildAreas({}).rows.find((r) => r.label === 'Plot (land) area').value, null);
});
test('council names from different sources all match', () => {
  for (const n of ['Waltham Forest', 'London Borough of Waltham Forest', 'Waltham Forest Council', 'waltham forest']) assert.ok(lpaFor(n), n);
});

import { normaliseEpcRow, pickEpc, formFromEpc, createEpc } from '../src/providers/epc.js';
test('EPC rows: both field-naming styles read; the right house is picked, never a different one', () => {
  const kebab = { 'number-habitable-rooms': '5', 'built-form': 'Mid-Terrace', 'property-type': 'House', 'total-floor-area': '86.5', 'construction-age-band': 'England and Wales: 1900-1929', 'extension-count': '1', 'lodgement-date': '2021-05-01', address: '22 Example Road', uprn: '100' };
  const camel = { numberHabitableRooms: 4, builtForm: 'Detached', totalFloorArea: 120, address1: '24 Example Road', lodgementDate: '2019-01-01', uprn: '101' };
  assert.deepEqual([normaliseEpcRow(kebab).habitableRooms, normaliseEpcRow(kebab).floorAreaM2, normaliseEpcRow(kebab).extensionCount], [5, 86.5, 1]);
  assert.equal(normaliseEpcRow(camel).habitableRooms, 4); assert.equal(normaliseEpcRow(camel).address, '24 Example Road');
  assert.equal(pickEpc([kebab, camel], { uprn: '101' }).builtForm, 'Detached');
  assert.equal(pickEpc([kebab, camel], { line1: '22 Example Road' }).matchedBy, 'address');
  assert.equal(pickEpc([kebab, camel], { line1: '2 Example Road' }), null, '2 must not match 22 or 24');
  const older = { ...kebab, 'lodgement-date': '2015-01-01', 'number-habitable-rooms': '3' };
  assert.equal(pickEpc([older, kebab], { uprn: '100' }).habitableRooms, 5, 'the newest certificate wins');
  assert.deepEqual(['Detached', 'Semi-Detached', 'End-Terrace', 'Enclosed Mid-Terrace', 'Mystery'].map(formFromEpc), ['detached', 'semi', 'terraced', 'terraced', null]);
});

test('EPC provider is off without a key, and sends basic auth when configured', async () => {
  assert.equal(await createEpc({ url: 'https://x', email: null, key: null }).findByAddress({ postcode: 'E6 2AA', line1: '22 Example Road' }), null);
  const real = globalThis.fetch; let seen = {};
  globalThis.fetch = async (url, init) => { seen = { url: String(url), auth: init.headers.authorization }; return new Response(JSON.stringify({ rows: [{ 'number-habitable-rooms': '6', address: '22 Example Road', 'lodgement-date': '2020-01-01' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const r = await createEpc({ url: 'https://epc.test/search', email: 'a@b.c', key: 'k' }).findByAddress({ postcode: 'E6 2AA', line1: '22 Example Road' });
    assert.equal(r.habitableRooms, 6); assert.equal(r.source, 'epc'); assert.match(seen.url, /postcode=E6%202AA/); assert.equal(seen.auth, `Basic ${Buffer.from('a@b.c:k').toString('base64')}`);
  } finally { globalThis.fetch = real; }
});

test('LPA garden test uses the real room count from the energy certificate', () => {
  const l = assessLpa({ ...base, verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, habitableRooms: 5 });
  const g = l.checks.find((c) => /energy certificate records 5 habitable rooms/.test(c.message));
  assert.ok(g); assert.equal(g.status, 'warn'); assert.equal(l.measured.gardenNeededM2, 75);
  const ok = assessLpa({ ...base, plotAreaM2: 400, proposalAreaM2: 20, verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, habitableRooms: 5 });
  assert.equal(ok.checks.find((c) => /habitable rooms/.test(c.message)).status, 'pass');
});
