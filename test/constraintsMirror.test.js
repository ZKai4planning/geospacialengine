import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConstraintsClient, createHybridPlanningData, createTitleMirror, MIRRORED_DATASETS } from '../src/providers/constraintsMirror.js';
import { createProtectedTrees } from '../src/providers/protectedTrees.js';
import { createTitleChain } from '../src/providers/inspireLocal.js';

const BASE = 'https://constraints.example';
const SQUARE = 'MULTIPOLYGON (((-0.1280 51.5030,-0.1270 51.5030,-0.1270 51.5040,-0.1280 51.5040,-0.1280 51.5030)))';
const mk = (handler) => createConstraintsClient({ url: BASE, key: 'k', fetchJson: async (u, o) => handler(new URL(u), o) });
const ok = (results) => ({ status: 'ok', source: 'local_mirror', count: results.length, results });

test('client is off without a url and key', () => {
  assert.equal(createConstraintsClient({ url: null, key: 'k' }), null);
  assert.equal(createConstraintsClient({ url: BASE, key: null }), null);
});

test('client sends the key header and the point, and understands outside_coverage', async () => {
  let seen;
  const c = mk((u, o) => { seen = { u, o }; return u.pathname === '/title-boundary' ? { status: 'outside_coverage' } : ok([]); });
  assert.deepEqual(await c.query('title-boundary', { lat: 53.4, lng: -2.2 }), { outside: true });
  assert.equal(seen.o.headers['x-api-key'], 'k');
  const r = await c.query('conservation-area', { lat: 51.5, lng: -0.12, geometry: true });
  assert.deepEqual(r, { rows: [] });
  assert.equal(seen.u.searchParams.get('geometry'), '1');
  assert.equal(seen.u.searchParams.get('lon'), '-0.12');
});

test('client throws (never an empty list) on a malformed or failed answer', async () => {
  await assert.rejects(mk(() => ({ status: 'weird' })).query('conservation-area', { lat: 51.5, lng: -0.1 }));
  await assert.rejects(mk(() => null).query('conservation-area', { lat: 51.5, lng: -0.1 }));
  await assert.rejects(mk(() => { throw new Error('Upstream returned 500'); }).query('conservation-area', { lat: 51.5, lng: -0.1 }));
});

test('hybrid: mirrored datasets from the mirror, the rest from the live service', async () => {
  const liveCalls = [];
  const live = { name: 'live', async entitiesAt(a) { liveCalls.push(a.datasets); return [{ dataset: 'green-belt', entity: '9', reference: null, name: null, url: 'u' }]; } };
  const c = mk((u) => ok(u.pathname === '/conservation-area' ? [{ entity: '44002874', name: 'Whitehall', reference: 'CONARA/1340' }] : []));
  const out = await createHybridPlanningData({ live, client: c }).entitiesAt({ lat: 51.5, lng: -0.12 });
  assert.deepEqual(out.map((e) => e.dataset).sort(), ['conservation-area', 'green-belt']);
  assert.equal(liveCalls.length, 1);
  assert.ok(!liveCalls[0].some((d) => MIRRORED_DATASETS.includes(d)));
});

test('hybrid: a mirror failure falls back to the live service for the mirrored datasets', async () => {
  const liveCalls = [];
  const live = { name: 'live', async entitiesAt(a) { liveCalls.push(a.datasets); return [{ dataset: a.datasets[0], entity: '1', reference: null, name: null, url: 'u' }]; } };
  const c = mk(() => { throw new Error('Upstream returned 500'); });
  const out = await createHybridPlanningData({ live, client: c }).entitiesAt({ lat: 51.5, lng: -0.12 });
  assert.equal(liveCalls.length, 2);
  assert.deepEqual(liveCalls[1], MIRRORED_DATASETS);
  assert.equal(out.length, 2);
});

test('hybrid: if the live service also fails the check fails, it does not report "no constraints"', async () => {
  const live = { name: 'live', async entitiesAt() { throw new Error('HTTP 503'); } };
  await assert.rejects(createHybridPlanningData({ live, client: mk(() => ok([])) }).entitiesAt({ lat: 51.5, lng: -0.12 }));
});

test('title mirror: returns the parcel containing the point; outside coverage and no hit are null', async () => {
  const hit = createTitleMirror({ client: mk(() => ok([{ entity: '120', reference: '555', geometry: SQUARE }])) });
  const t = await hit.findTitle({ lat: 51.5035, lng: -0.1275 });
  assert.equal(t.source, 'hmlr-title-mirror');
  assert.equal(t.reference, '555');
  assert.ok(t.areaM2 > 1000 && t.rings.length === 1);
  assert.equal(await hit.findTitle({ lat: 51.6, lng: -0.1275 }), null);                                  // parcel returned but point not inside it
  assert.equal(await createTitleMirror({ client: mk(() => ({ status: 'outside_coverage' })) }).findTitle({ lat: 53.4, lng: -2.2 }), null);
});

test('title chain: a partial source saying "not here" does not hide a failure of the next source', async () => {
  const partial = { name: 'p', partial: true, async findTitle() { return null; } };
  const broken = { name: 'b', async findTitle() { throw new Error('down'); } };
  await assert.rejects(createTitleChain([partial, broken]).findTitle({ lat: 1, lng: 1 }));
  assert.equal(await createTitleChain([partial]).findTitle({ lat: 1, lng: 1 }), null);
  const good = { name: 'g', async findTitle() { return { ring: [] }; } };
  assert.deepEqual(await createTitleChain([partial, good]).findTitle({ lat: 1, lng: 1 }), { ring: [] });
});

test('tree zones: from the mirror with geometry; fall back to live when the mirror fails', async () => {
  const liveUrls = [];
  const fetchJson = async (u) => { liveUrls.push(String(u)); return { entities: [] }; };
  const m = createProtectedTrees({ fetchJson, mirror: mk(() => ok([{ entity: '7', name: 'TPO 1', reference: 'R', geometry: SQUARE }])) });
  const a = await m.findNear({ lat: 51.5035, lng: -0.1275 });
  assert.equal(a.zones.length, 1);
  assert.equal(a.zones[0].entity, '7');
  assert.ok(!liveUrls.some((u) => u.includes('tree-preservation-zone')));   // live was only asked for individual trees
  const f = createProtectedTrees({ fetchJson, mirror: mk(() => { throw new Error('down'); }) });
  await f.findNear({ lat: 51.5035, lng: -0.1275 });
  assert.ok(liveUrls.some((u) => u.includes('tree-preservation-zone')));
});
