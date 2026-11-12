import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPostcode, parseSales, salesOfAddress, priceStats, typeKey, formFromPpd, postcodeQuery, streetQuery, createLandRegistry } from '../src/providers/landRegistry.js';
import { ppdSignals, formatStreetStats } from '../src/services/ppdSignals.js';

const row = (o) => Object.fromEntries(Object.entries({ tid: 't1', amount: '450000', date: '2021-06-18Z', ptype: 'terraced', estate: 'freehold', new: 'false', paon: '223', street: 'CAPWORTH STREET', town: 'LONDON', postcode: 'E10 7AA', ...o }).filter(([, v]) => v != null).map(([k, v]) => [k, { value: v }]));
const json = (...rows) => ({ results: { bindings: rows } });

test('postcodes are validated and normalised before anything reaches a query', () => {
  assert.equal(cleanPostcode('e102aa'), 'E10 2AA'); assert.equal(cleanPostcode(' E6  2AA '), 'E6 2AA');
  assert.equal(cleanPostcode('E6 2AA" } DROP'), null); assert.equal(cleanPostcode('hello'), null);
  assert.match(postcodeQuery('E6 2AA'), /lrcommon:postcode "E6 2AA"\^\^xsd:string/);
  assert.match(streetQuery({ street: 'Capworth Street"; }', town: 'London', since: '2021-10-24' }), /"CAPWORTH STREET"\^\^xsd:string/, 'quotes and braces are stripped from street names');
  assert.ok(!streetQuery({ street: 'A" } #', town: 'B', since: '2021-01-01' }).includes('} #'));
});

test('sale records: type, tenure, new build parsed; duplicate transaction ids collapse; newest first', () => {
  const s = parseSales(json(row({ tid: 'a', date: '2019-01-02', ptype: 'flat-maisonette', estate: 'leasehold', new: 'true' }), row({ tid: 'b', date: '2023-05-05' }), row({ tid: 'b', date: '2023-05-05' }), row({ tid: 'c', amount: 'x' })));
  assert.deepEqual(s.map((x) => x.transactionId), ['b', 'a']);
  assert.equal(s[1].propertyType, 'flat'); assert.equal(s[1].tenure, 'leasehold'); assert.equal(s[1].newBuild, true); assert.equal(s[0].date, '2023-05-05');
  assert.deepEqual(['detached', 'Semi-detached', 'terraced', 'flat-maisonette', 'otherPropertyType'].map(typeKey), ['detached', 'semi_detached', 'terraced', 'flat', 'other']);
  assert.deepEqual([formFromPpd('semi_detached'), formFromPpd('flat'), formFromPpd('terraced')], ['semi', null, 'terraced']);
});

test('only THIS home\'s sales: number 2 is not 22, and the flat upstairs is not the house', () => {
  const sales = parseSales(json(row({ tid: '1', paon: '223' }), row({ tid: '2', paon: '22' }), row({ tid: '3', paon: '223', saon: 'FLAT 2' }), row({ tid: '4', paon: '2' })));
  assert.deepEqual(salesOfAddress(sales, '223 Capworth Street').map((s) => s.transactionId), ['1']);
  assert.deepEqual(salesOfAddress(sales, '2 Capworth Street').map((s) => s.transactionId), ['4']);
  assert.deepEqual(salesOfAddress(sales, ''), []);
});

test('price statistics: median and percentiles by interpolation', () => {
  const mk = (...p) => p.map((priceGbp) => ({ priceGbp }));
  assert.deepEqual(priceStats(mk(100, 200, 300, 400, 500)), { count: 5, medianGbp: 300, p25Gbp: 200, p75Gbp: 400, minGbp: 100, maxGbp: 500 });
  assert.equal(priceStats(mk(100, 200)).medianGbp, 150);
  assert.equal(priceStats([]), null);
});

test('signals: flat sale = warning; leasehold house; new build; mismatch with the energy certificate; no sales = nothing', () => {
  const sale = (o) => ({ date: '2021-06-18', priceGbp: 1, propertyType: 'terraced', tenure: 'freehold', newBuild: false, ...o });
  const ids = (ppd, epc) => ppdSignals({ ppd, epc }).checks.map((c) => c.id);
  assert.deepEqual(ids({ sales: [sale({ propertyType: 'flat', tenure: 'leasehold' })] }), ['ppd-flat']);
  assert.deepEqual(ids({ sales: [sale({ tenure: 'leasehold' })] }), ['ppd-leasehold']);
  assert.deepEqual(ids({ sales: [sale({}), sale({ newBuild: true, date: '2004-01-01' })] }), ['ppd-newbuild']);
  assert.deepEqual(ids({ sales: [sale({})] }, { builtForm: 'Detached' }), ['ppd-epc-mismatch']);
  assert.deepEqual(ids({ sales: [sale({})] }, { builtForm: 'Mid-Terrace' }), []);
  assert.deepEqual(ppdSignals({ ppd: { sales: [] } }), { checks: [], formHint: null });
  assert.equal(ppdSignals({ ppd: { sales: [sale({ propertyType: 'semi_detached' })] } }).formHint, 'semi');
  assert.match(formatStreetStats({ name: 'CAPWORTH STREET', years: 5, type: 'terraced', stats: { count: 12, medianGbp: 465000, p25Gbp: 440000, p75Gbp: 490000 } }), /12 terraced sales on CAPWORTH STREET.*£465,000.*£440,000–£490,000/);
});

test('provider: queries by postcode, matches the address, adds street comparables, survives a failed comparables query', async () => {
  const real = globalThis.fetch, urls = [];
  const bind = (rows) => new Response(JSON.stringify(json(...rows)), { status: 200, headers: { 'content-type': 'application/json' } });
  let n = 0;
  globalThis.fetch = async (url) => {
    urls.push(decodeURIComponent(String(url))); n++;
    if (n === 1) return bind([row({ tid: '1', amount: '500000' }), row({ tid: '2', paon: '225', amount: '400000' })]);
    return bind([row({ tid: '1', amount: '500000' }), row({ tid: '5', paon: '200', amount: '420000' }), row({ tid: '6', paon: '210', amount: '440000' }), row({ tid: '7', paon: '230', amount: '600000', ptype: 'flat-maisonette', saon: 'FLAT 1' })]);
  };
  try {
    const lr = createLandRegistry({ url: 'https://lr.test/query' });
    const r = await lr.findSales({ postcode: 'e10 7aa', line1: '223 Capworth Street', now: new Date('2026-10-24') });
    assert.equal(r.sales.length, 1); assert.equal(r.sales[0].priceGbp, 500000);
    assert.match(urls[0], /lrcommon:postcode "E10 7AA"/); assert.match(urls[0], /output=json/);
    assert.match(urls[1], /"CAPWORTH STREET"\^\^xsd:string/); assert.match(urls[1], /\?date >= "2021-10-2/);
    assert.equal(r.street.type, 'terraced'); assert.equal(r.street.stats.count, 3);          // flats are excluded from the house comparables
    assert.equal(r.street.stats.medianGbp, 440000);
    assert.match(r.attribution, /Open Government Licence/);
    n = 0; globalThis.fetch = async () => { n++; if (n === 1) return bind([row({ tid: '1' })]); throw new Error('boom'); };
    const r2 = await lr.findSales({ postcode: 'E10 7AA', line1: '223 Capworth Street' });
    assert.equal(r2.sales.length, 1); assert.equal(r2.street, null);
    assert.equal(await lr.findSales({ postcode: 'nonsense', line1: '1 X' }), null);
  } finally { globalThis.fetch = real; }
});

// ---- through the real application flow (mock providers) ----
process.env.MOCK_PROVIDERS = 'true';
const { createContainer } = await import('../src/container.js');
const { createMockProviders } = await import('../src/providers/mock.js');
const baseP = createMockProviders();
const mk = (patch = {}) => createContainer({ providers: { ...baseP, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null, ...patch }, db: null }).applicationService;

test('flow: sale records are stored with the application, shown in the summary, and flats raise a warning in the checks', async () => {
  const svc = mk();
  let app = await svc.create({ id: '1234567890' });
  assert.equal(app.ppd.sales[0].priceGbp, 425000); assert.equal(app.ppd.street.stats.medianGbp, 465000);
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.ok(!app.assessment.checks.some((c) => /^ppd-/.test(c.id)), 'a freehold terraced house with no new-build flag raises nothing');

  const flat = mk({ landRegistry: { name: 'x', async findSales() { return { sales: [{ date: '2020-02-02', priceGbp: 300000, propertyType: 'flat', tenure: 'leasehold', newBuild: false }], street: null, attribution: 'x' }; } } });
  let f = await flat.create({ id: '1234567894' });
  f = await flat.setProposal(f.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.ok(f.assessment.checks.some((c) => c.id === 'ppd-flat' && c.status === 'warn'));
  assert.equal(f.ppd.sales[0].propertyType, 'flat');

  const down = mk({ landRegistry: { name: 'x', async findSales() { throw new Error('SPARQL unavailable'); } } });
  const d = await down.create({ id: '1234567896' });
  assert.equal(d.ppd, null); assert.ok(d.warnings.some((w) => /Land Registry sales/i.test(w)), 'a failed lookup is reported, not fatal');
});
