import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgStore } from '../src/store/pgStore.js';
import { pgConfig } from '../src/utils/pgConfig.js';
import { createFakeDb } from './helpers/fakeDb.js';

const ID = '11111111-2222-3333-4444-555555555555';

test('create / get / update behave like the in-memory store', async () => {
  const store = createPgStore({ db: createFakeDb() });
  const app = { id: ID, status: 'draft', proposal: null, address: { postcode: 'E6 2AA' } };

  assert.equal(await store.get(ID), null);
  assert.deepEqual(await store.create(app), app);
  assert.deepEqual(await store.get(ID), app);

  const next = await store.update(ID, { proposal: { type: 'rear_extension' } });
  assert.equal(next.proposal.type, 'rear_extension');
  assert.equal(next.address.postcode, 'E6 2AA');          // untouched keys survive (shallow merge)
  assert.ok(Date.parse(next.updatedAt));                  // updatedAt is stamped
  assert.equal((await store.get(ID)).proposal.type, 'rear_extension');

  assert.equal(await store.update('99999999-9999-9999-9999-999999999999', { x: 1 }), null);
});

test('database errors surface as a 502 AppError; an invalid uuid reads as "not found"', async () => {
  const down = createPgStore({ db: { query: async () => { throw Object.assign(new Error('down'), { code: '57P01' }); } } });
  await assert.rejects(() => down.get(ID), (e) => e.status === 502 && e.code === 'UPSTREAM_ERROR');
  await assert.rejects(() => down.create({ id: ID }), (e) => e.status === 502);

  const store = createPgStore({ db: createFakeDb() });
  assert.equal(await store.get('not-a-valid-uuid-but-36-chars-long!'), null);
  assert.equal(await store.update('not-a-valid-uuid-but-36-chars-long!', {}), null);
});

test('pgConfig strips sslmode (it would override our ssl option) and handles ssl modes', () => {
  const url = 'postgresql://doadmin:p%40ss@host.db.ondigitalocean.com:25061/pool?sslmode=require&application_name=x';
  const c = pgConfig(url);
  assert.ok(!c.connectionString.includes('sslmode'));
  assert.ok(c.connectionString.includes('application_name=x') && c.connectionString.includes('p%40ss'));
  assert.deepEqual(c.ssl, { rejectUnauthorized: false });
  assert.deepEqual(pgConfig(url, { ca: 'PEM' }).ssl, { ca: 'PEM', rejectUnauthorized: true });
  assert.equal(pgConfig(url, { ssl: 'disable' }).ssl, false);
});
