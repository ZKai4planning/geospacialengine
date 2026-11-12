import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createLandfill } = await import('../src/providers/landfill.js');
const { landfillTile } = await import('../src/services/siteExtras.js');

const hit = (attrs) => ({ features: [{ attributes: attrs }] });

test('landfill: inside is found by the point query alone; near needs the ring query; outside is not "unavailable"', async () => {
  const calls = [];
  const mk = (inside, near) => createLandfill({ url: 'https://x.test/FeatureServer/0', fetchJson: async (u) => { calls.push(u); return /distance=/.test(u) ? near : inside; } });
  const empty = { features: [] };

  calls.length = 0;
  let r = await mk(hit({ SITE_NAME: 'Old Clay Pit', HOUSEHOLD: 'Y', INERT: 'Y', LIC_SURREN: Date.UTC(1999, 5, 1), GASCONTROL: 'Y' }), empty).check({ lat: 53, lng: -1 });
  assert.equal(r.status, 'inside'); assert.equal(calls.length, 1, 'no second query when already inside');
  assert.deepEqual(r.sites[0].waste, ['inert', 'household']); assert.equal(r.sites[0].surrendered, '1999-06-01'); assert.equal(r.sites[0].gasControl, true);

  r = await mk(empty, hit({ site_name: 'Brickworks tip' })).check({ lat: 53, lng: -1 });
  assert.equal(r.status, 'near'); assert.equal(r.sites[0].name, 'Brickworks tip');

  r = await mk(empty, empty).check({ lat: 53, lng: -1 });
  assert.equal(r.status, 'outside');

  r = await createLandfill({ url: 'https://x.test/0', fetchJson: async () => ({ error: { message: 'nope' } }) }).check({ lat: 53, lng: -1 });
  assert.equal(r.status, 'unavailable');
});

test('landfill tile: check when on or near a site, info when none, nothing when the check did not run', () => {
  assert.equal(landfillTile(null), null);
  assert.equal(landfillTile({ status: 'unavailable' }), null);
  const inside = landfillTile({ status: 'inside', nearM: 250, sites: [{ name: 'Old Clay Pit', waste: ['inert'] }], source: 'EA' });
  assert.equal(inside.status, 'check'); assert.match(inside.sub, /Old Clay Pit \(inert waste\)/);
  assert.equal(landfillTile({ status: 'near', nearM: 250, sites: [], source: 'EA' }).status, 'check');
  const out = landfillTile({ status: 'outside', nearM: 250, sites: [], source: 'EA' });
  assert.equal(out.status, 'info'); assert.match(out.sub, /not a ground investigation/);
});

test('landfill: an address on a recorded site gets a tile on the dashboard and a row in "where this data comes from"', async () => {
  const { createContainer } = await import('../src/container.js');
  const { createProviders } = await import('../src/providers/index.js');
  const providers = createProviders({ db: null });
  providers.landfill = { async check() { return { status: 'inside', nearM: 250, sites: [{ name: 'Old Clay Pit', waste: ['inert'] }], source: 'Environment Agency, Historic Landfill Sites' }; } };
  const { createApp } = await import('../src/app.js');
  const server = createApp(createContainer({ providers })).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let app;
  try { app = await (await fetch(`${base}/api/applications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '1234567890' }) })).json(); }
  finally { server.close(); }
  const flat = JSON.stringify(app);
  assert.match(flat, /Made ground \(historic landfill\)/, 'tile present');
  assert.match(flat, /On a recorded landfill site/);
  assert.ok(app.sources.some((r) => r.topic.startsWith('Historic landfill')), 'listed under where the data comes from');
});
