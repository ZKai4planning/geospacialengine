import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createContainer } = await import('../src/container.js');
const { createMockProviders } = await import('../src/providers/mock.js');

const build = (patch = {}) => {
  const providers = { ...createMockProviders(), streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null, ...patch };
  return createContainer({ providers, db: null }).applicationService;
};

test('mock flow: a TPO zone at the bottom of the garden is drawn and warns only when the work reaches it', async () => {
  const svc = build();
  const app = await svc.create({ id: '1234567890' });
  assert.ok(app.map.layers.some((l) => l.kind === 'tpo_zone'));
  assert.equal(app.protectedTrees.zones.length, 1);

  let a = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 4, heightM: 3 });
  assert.equal(a.map.layers.find((l) => l.kind === 'tpo_zone').status, 'clear');
  assert.ok(!a.map.siteChecks.items.some((i) => /preservation zone/.test(i.message)));

  a = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 8, heightM: 3 });
  assert.equal(a.map.layers.find((l) => l.kind === 'tpo_zone').status, 'inside');
  assert.ok(a.map.siteChecks.items.some((i) => i.status === 'warn' && /inside a group tree preservation zone/.test(i.message)));
  assert.ok(a.map.siteChecks.attribution.some((t) => /Tree preservation data/.test(t)));
  assert.ok(a.map.layers.every((l) => typeof l.path === 'string' && !l.path.includes('NaN')));
});

test('protected trees are merged with OSM trees: a duplicate within 3 m is dropped, the protected one is kept and drawn as such', async () => {
  const base = createMockProviders();
  const addr = await base.address.byId('1234567892');                                 // each test uses its own house: lookups are cached per address id
  const osm = (await base.buildings.findSite(addr)).trees[0];                                                          // the OSM tree behind the house
  const svc = build({ protectedTrees: { name: 't', async findNear() {
    return { zones: [], trees: [
      { id: 'tpo-tree-1', reference: 'T1', order: 'TPO9', lng: osm.lng + 0.000005, lat: osm.lat, trunkDiameterM: null, crownDiameterM: 10, protected: true },   // ~0.4 m from the OSM tree
      { id: 'tpo-tree-2', reference: 'T2', order: 'TPO9', lng: osm.lng + 0.0001, lat: osm.lat, trunkDiameterM: null, crownDiameterM: null, protected: true },
    ] };
  } } });
  const app = await svc.create({ id: '1234567892' });
  const trees = app.map.layers.filter((l) => l.kind === 'tree');
  assert.equal(trees.length, 2);                                                       // 2 protected; the OSM duplicate is gone
  assert.ok(trees.every((l) => l.protected === true));
  assert.equal(app.map.siteChecks.trees.length, 2);
});

test('title lookup retries at the middle of the building when the address point hits no title; failures do not break the flow', async () => {
  const base = createMockProviders();
  const calls = [];
  const real = base.titles.findTitle;
  const svc = build({ titles: { name: 't', async findTitle(p) { calls.push(p); return calls.length === 1 ? null : real(p); } } });
  const app = await svc.create({ id: '1234567894' });
  assert.equal(calls.length, 2);
  assert.ok(app.plot?.ring);
  assert.ok(app.map.layers.some((l) => l.kind === 'plot'));

  const broken = build({ titles: { name: 't', async findTitle() { throw new Error('down'); } }, protectedTrees: { name: 't', async findNear() { throw new Error('down'); } } });
  const app2 = await broken.create({ id: '1234567896' });
  assert.ok(app2.warnings.includes('Plot boundary is temporarily unavailable.'));
  assert.ok(app2.warnings.includes('Protected trees is temporarily unavailable.'));
  assert.ok(!app2.map.layers.some((l) => l.kind === 'tpo_zone'));
  const plot2 = app2.map.layers.find((l) => l.kind === 'plot');   // no title -> an ESTIMATED outline from the neighbours and road is shown instead
  assert.ok(plot2?.estimated);
  assert.ok(app2.warnings.some((w) => /estimated plot outline/.test(w)));
});
