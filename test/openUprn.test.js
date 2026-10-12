import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenUprn } from '../src/providers/openUprn.js';
import { createUprnMatcher } from '../src/services/uprnMatcher.js';
import { createFakeDb } from './helpers/fakeDb.js';

const points = [
  { uprn: 1001, lat: 51.539, lng: 0.059 },
  { uprn: 1002, lat: 51.539, lng: 0.059072 },   // ~5 m east of 1001 (next terrace)
  { uprn: 1003, lat: 51.5393, lng: 0.059 },     // ~33 m north
  { uprn: 1004, lat: 51.55, lng: 0.059 },       // ~1.2 km away
  { uprn: 1005, lat: 52.5, lng: -1.5 },         // other part of the country
];

test('nearest / within / byUprn map the database rows correctly', async () => {
  const u = createOpenUprn({ db: createFakeDb({ uprns: points }) });
  const near = await u.nearest(51.539, 0.059, { maxM: 40 });
  assert.deepEqual(near.map((n) => n.uprn), ['1001', '1002', '1003']);
  assert.ok(near[0].distM < 0.5);
  assert.ok(near[1].distM > 4 && near[1].distM < 6);
  assert.deepEqual((await u.nearest(51.539, 0.059, { maxM: 2 })).map((n) => n.uprn), ['1001']);
  assert.equal((await u.byUprn(1005)).lat, 52.5);
  assert.equal(await u.byUprn(999), null);
});

test('nearestMany answers many points in one round-trip and keeps results aligned', async () => {
  const fake = createFakeDb({ uprns: points });
  const u = createOpenUprn({ db: fake });
  const res = await u.nearestMany([{ lat: 52.5, lng: -1.5 }, { lat: 40, lng: 0 }, { lat: 51.539, lng: 0.059 }], { maxM: 15 });
  assert.deepEqual(res.map((r) => r.map((n) => n.uprn)), [['1005'], [], ['1001', '1002']]);
  assert.equal(fake.calls.filter((c) => c === 'uprn_nearest_batch').length, 1);
});

test('stats reads uprn_meta', async () => {
  const fake = createFakeDb();
  fake.tables.uprn_meta.push({ key: 'rows', value: '41676575' }, { key: 'source', value: 'osopenuprn_202609.csv' });
  assert.equal((await createOpenUprn({ db: fake }).stats()).rows, 41676575);
  assert.equal(await createOpenUprn({ db: createFakeDb() }).stats(), null);
});

test('database errors are harmless: lookups return nothing instead of throwing', async () => {
  const broken = { query: async () => { throw new Error('connection refused'); } };
  const u = createOpenUprn({ db: broken });
  assert.deepEqual(await u.nearest(51.5, 0, {}), []);
  assert.deepEqual(await u.nearestMany([{ lat: 1, lng: 1 }]), [[]]);
  assert.equal(await u.byUprn(1), null);
  assert.equal(await u.stats(), null);
});

test('matcher: clear winner = high, stacked flats = low, never overrides a real UPRN', async () => {
  const flats = createFakeDb({ uprns: [
    { uprn: 2001, lat: 51.6, lng: 0.1 }, { uprn: 2002, lat: 51.6, lng: 0.1003 }, { uprn: 2003, lat: 51.6, lng: 0.1003 },
  ] });
  const m = createUprnMatcher({ openUprn: createOpenUprn({ db: flats }), maxM: 15 });

  const house = await m.enrich({ lat: 51.6, lng: 0.100003, fullAddress: '1 A Road' });
  assert.equal(house.uprn, '2001');
  assert.equal(house.uprnMatch.confidence, 'high');

  const block = await m.enrich({ lat: 51.6, lng: 0.1003, fullAddress: 'Flat block' });
  assert.equal(block.uprnMatch.confidence, 'low');
  assert.equal(block.uprnMatch.candidates.length, 2);

  assert.equal((await m.enrich({ lat: 51.6, lng: 0.1, uprn: '999' })).uprn, '999');
  assert.equal((await m.enrich({ lat: 51.6, lng: 0.1, approximate: true })).uprn, undefined);
  assert.equal((await m.enrich({ lat: 40, lng: 0 })).uprn, undefined);
});

test('matcher.enrichMany == enrich per address, in ONE batch call, skipping ineligible addresses', async () => {
  const fake = createFakeDb({ uprns: [{ uprn: 2001, lat: 51.6, lng: 0.1 }, { uprn: 3001, lat: 51.7, lng: 0.2 }] });
  const m = createUprnMatcher({ openUprn: createOpenUprn({ db: fake }), maxM: 15 });
  const list = [
    { id: 'a', lat: 51.6, lng: 0.1 },
    { id: 'b', lat: 51.6, lng: 0.1, uprn: '999' },        // already has one
    { id: 'c', lat: 51.6, lng: 0.1, approximate: true },  // postcode centre only
    { id: 'd', lat: 51.7, lng: 0.2 },
    { id: 'e', lat: 40, lng: 0 },                         // nothing nearby
  ];
  const out = await m.enrichMany(list);
  assert.deepEqual(out.map((a) => a.uprn), ['2001', '999', undefined, '3001', undefined]);
  assert.deepEqual(out.map((a) => a.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(fake.calls.length, 1);
  assert.equal((await createUprnMatcher({ openUprn: null }).enrichMany(list)), list);
});
