import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

test('mock flow: neighbours + title boundary are drawn, and the right proposals are flagged', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts })).json();

  const app = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  assert.equal(app.map.layers[0].kind, 'building');                                  // existing contract unchanged
  assert.equal(app.map.layers.filter((l) => l.kind === 'neighbour').length, 2);
  assert.ok(app.map.layers.some((l) => l.kind === 'plot'));
  assert.deepEqual(app.map.siteChecks.items, []);                                    // nothing to check before a proposal
  const put = (body) => j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify(body) });

  // modest rear extension: inside the garden, no overlap
  let r = await put({ type: 'rear_extension', depthM: 4, heightM: 3 });
  assert.equal(r.map.siteChecks.boundary.status, 'inside');
  assert.equal(r.map.siteChecks.items.filter((i) => i.status === 'fail').length, 0);
  assert.ok(r.map.layers.filter((l) => l.kind === 'neighbour').every((l) => l.status !== 'overlap'));

  // a 14 m deep rear extension runs past a 10 m garden: crosses the title boundary
  r = await put({ type: 'rear_extension', depthM: 14, heightM: 3 });
  assert.equal(r.map.siteChecks.boundary.status, 'crosses');
  assert.equal(r.map.layers.find((l) => l.kind === 'plot').status, 'crosses');
  assert.ok(r.map.siteChecks.items.some((i) => i.status === 'fail' && /title boundary/.test(i.message)));

  // a 2.5 m side extension is built on top of the neighbouring house
  r = await put({ type: 'side_extension', side: 'right', widthM: 2.5, heightM: 3, storeys: 1 });
  const hit = r.map.layers.filter((l) => l.kind === 'neighbour' && l.status === 'overlap');
  assert.equal(hit.length, 1);
  assert.match(hit[0].label, /Overlaps neighbour/);
  assert.ok(r.map.siteChecks.items.some((i) => i.status === 'fail' && /Overlaps the neighbouring building/.test(i.message)));
  assert.ok(r.map.siteChecks.attribution.length >= 1 && r.map.siteChecks.disclaimer);

  // roof work doesn't touch the footprint
  r = await put({ type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 });
  assert.match(r.map.siteChecks.items[0].message, /Roof-level work/);
});
