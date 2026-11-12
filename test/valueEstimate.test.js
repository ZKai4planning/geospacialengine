import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUplift } from '../src/services/valueEstimate.js';

const stats = { count: 12, medianGbp: 465000, p25Gbp: 440000, p75Gbp: 490000 };
const ppd = { street: { name: 'EXAMPLE ROAD', years: 5, type: 'terraced', stats }, sales: [{ date: '2024-03-01', priceGbp: 450000, propertyType: 'terraced' }] };
const epc = { floorAreaM2: 86 };
const base = { ppd, epc, type: 'rear_extension', extensionFootprintM2: 12, storeys: 1, verdict: 'permitted_development', now: new Date('2026-10-24') };

test('uplift is street price per m² x new floor area, as a range from the street\'s own percentiles, rounded to £1,000', () => {
  const v = estimateUplift(base);
  assert.equal(v.available, true); assert.equal(v.addedFloorM2, 12); assert.equal(v.growthPct, 14);
  assert.deepEqual([v.lowGbp, v.midGbp, v.highGbp], [61000, 65000, 68000]);        // 440000/86*12, 465000/86*12, 490000/86*12
  assert.deepEqual(v.pricePerM2, { lowGbp: 5116, midGbp: 5407, highGbp: 5698 });
  assert.equal(v.basis.comps, 12); assert.match(v.method, /25th and 75th percentile/);
  assert.deepEqual(v.caution, []);
});

test('two storeys count twice; a large extension and a not-yet-approved one carry caveats', () => {
  const two = estimateUplift({ ...base, storeys: 2 });
  assert.equal(two.addedFloorM2, 24); assert.equal(two.midGbp, 130000);
  const big = estimateUplift({ ...base, extensionFootprintM2: 50, verdict: 'planning_permission' });
  assert.ok(big.caution.some((c) => /ceiling/.test(c)) && big.caution.some((c) => /assumes the work is approved/.test(c)));
  assert.ok(estimateUplift({ ...base, extensionFootprintM2: 30 }).caution.some((c) => /high side/.test(c)));
});

test('a recent sale of the home itself gives a second view; an old one, or a flat, does not', () => {
  const v = estimateUplift(base);
  assert.equal(v.ownSale.year, '2024'); assert.equal(v.ownSale.midGbp, 63000); assert.match(v.ownSale.note, /Not adjusted/);
  assert.equal(estimateUplift({ ...base, ppd: { ...ppd, sales: [{ date: '2015-03-01', priceGbp: 300000, propertyType: 'terraced' }] } }).ownSale, null);
  assert.equal(estimateUplift({ ...base, ppd: { ...ppd, sales: [{ date: '2024-03-01', priceGbp: 300000, propertyType: 'flat' }] } }).ownSale, null);
});

test('no estimate without a floor area or enough comparables; none for porches, outbuildings or roof work; none without a size', () => {
  assert.match(estimateUplift({ ...base, epc: null }).reason, /floor area from its energy certificate/);
  assert.match(estimateUplift({ ...base, epc: { floorAreaM2: 5 } }).reason, /floor area/);
  assert.match(estimateUplift({ ...base, ppd: { ...ppd, street: { ...ppd.street, stats: { ...stats, count: 3 } } } }).reason, /at least 5 recent sales.*only 3 found/);
  assert.match(estimateUplift({ ...base, ppd: null }).reason, /at least 5/);
  for (const type of ['front_porch', 'outbuilding', 'rear_dormer', 'additional_storey']) assert.equal(estimateUplift({ ...base, type }).available, false, type);
  assert.match(estimateUplift({ ...base, extensionFootprintM2: null }).reason, /size/);
});

test('flow: the estimate is part of the assessment, from the energy certificate and the street sales', async () => {
  process.env.MOCK_PROVIDERS = 'true';
  const { createContainer } = await import('../src/container.js');
  const { createMockProviders } = await import('../src/providers/mock.js');
  const b = createMockProviders();
  const svc = createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null }, db: null }).applicationService;
  let app = await svc.create({ id: '1234567888' });
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.equal(app.assessment.value.available, true);
  assert.ok(app.assessment.value.midGbp > 20000 && app.assessment.value.midGbp < 150000);
  assert.equal(app.assessment.value.homeFloorM2, 86);                                   // from the mock energy certificate
  app = await svc.setProposal(app.id, { type: 'front_porch', widthM: 1.5, depthM: 1.2, heightM: 2.6 });
  assert.equal(app.assessment.value.available, false);
});
