import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createContainer } = await import('../src/container.js');
const { createMockProviders } = await import('../src/providers/mock.js');
const { ringAreaM2 } = await import('../src/utils/geo.js');

const base = createMockProviders();
const build = (patch = {}) => createContainer({ providers: { ...base, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null, ...patch }, db: null }).applicationService;

// mock house: 5 m wide x 9 m deep centred on the address point, terraced neighbours either side, road 11 m in front (south)
const at = async (id) => { const a = await base.address.byId(id); const kx = 111320 * Math.cos((a.lat * Math.PI) / 180); return { a, ll: ([x, y]) => [a.lng + x / kx, a.lat + y / 111320], rect(x0, y0, x1, y1) { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(this.ll); return [...r, r[0]]; } }; };

test('flow: no title -> the estimate is used and a mapped rear fence pulls its back edge onto the fence', async () => {
  const g = await at('1234567890');
  const withFence = { ...base.buildings, async findSite(a) { const s = await base.buildings.findSite(a); return { ...s, barriers: [{ kind: 'fence', line: [[-3, 28], [3, 28]].map(g.ll) }] }; } };
  const app = await build({ titles: { name: 't', async findTitle() { return null; } }, buildings: withFence }).create({ id: '1234567890' });
  assert.equal(app.plot.estimated, true);
  assert.equal(app.plot.basis.rear, 'fence'); assert.equal(app.plot.snapped[0].side, 'rear');
  assert.equal(app.barriers.length, 1);                                              // kept on the draft so a front/back swap can redraw it
  assert.ok(app.map.layers.find((l) => l.kind === 'plot').estimated);
  assert.match(app.map.siteChecks.items[0].message, /a mapped fence, wall or hedge/);
  assert.ok(app.warnings.some((w) => /estimated plot outline/.test(w)));
});

test('flow: a local parcel that is a few metres out is aligned to the house, flagged approximate, and checks say so', async () => {
  const g = await at('1234567892');
  const shifted = g.rect(0.5, -5.5, 5.5, 15.5);                                      // the real parcel (-2.5..2.5 x -6.5..14.5) moved 3 m east and 1 m north
  const titles = { name: 'local', async findTitle() { return { source: 'hmlr-inspire-local', reference: 'P1', ring: shifted, rings: [shifted], areaM2: Math.round(ringAreaM2(shifted)), approxM: 5, attribution: 'HMLR' }; } };
  const svc = build({ titles });
  let app = await svc.create({ id: '1234567892' });
  assert.equal(app.plot.source, 'hmlr-inspire-local'); assert.ok(app.plot.alignedByM > 0, 'parcel should have been aligned');
  assert.equal(app.titlePlot.alignedByM, undefined);                                 // the raw lookup is kept untouched
  assert.ok(!app.warnings.some((w) => /estimated plot outline/.test(w)));
  assert.equal(app.map.view.fit, 'plot');
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 14, heightM: 3 });
  const b = app.map.siteChecks.boundary;
  assert.equal(b.approxM, 5);
  assert.ok(app.map.siteChecks.items.some((i) => /accurate to about 5 m/.test(i.message)));
  app = await svc.updateProfile(app.id, { frontBearingDeg: 0 });                     // swapping front/back keeps a matching parcel
  assert.equal(app.plot.source, 'hmlr-inspire-local');
});

test('flow: a bad local parcel (wrong place) falls back to the estimate with an explanation', async () => {
  const g = await at('1234567894');
  const far = g.rect(80, 80, 92, 108);
  const titles = { name: 'local', async findTitle() { return { source: 'hmlr-inspire-local', reference: 'P9', ring: far, rings: [far], areaM2: 336, approxM: 5 }; } };
  const app = await build({ titles }).create({ id: '1234567894' });
  assert.equal(app.plot.estimated, true);
  assert.ok(app.warnings.some((w) => /does not match the house/.test(w)));
});
