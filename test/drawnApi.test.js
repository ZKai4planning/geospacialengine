import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

// Mock house: 5 m wide x 9 m deep, rear (north) wall at y = +4.5 m from its centre; a tree 6 m behind it (6 m root zone);
// street along the south side; terraced neighbours either side.
const LAT = 51.539, LNG = 0.059, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG + x / KX, LAT + y / KY];

async function setup(t) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opts) => { const r = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts }); return { status: r.status, body: await r.json() }; };
  const { body: app } = await j('/api/applications', { method: 'POST', body: JSON.stringify({ id: '1234567890' }) });
  const draw = (corners, extra = {}) => j(`/api/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify({ type: 'custom_polygon', heightM: 3, ring: corners.map(ll), ...extra }) });
  return { app, j, draw };
}
const msgs = (r) => r.body.map.siteChecks.items.map((i) => `${i.status}: ${i.message}`).join('\n');

test('trees and roads are drawn and exposed (layers + GeoJSON) before any proposal', async (t) => {
  const { app } = await setup(t);
  const tree = app.map.layers.find((l) => l.kind === 'tree'), road = app.map.layers.find((l) => l.kind === 'road');
  assert.equal(tree.radiusM, 6); assert.equal(tree.radiusSource, 'trunk'); assert.equal(tree.species, 'Silver birch');
  assert.ok(road.strokePx > 20 && road.path.startsWith('M'));
  assert.equal(app.map.layers[0].kind, 'building');                                   // existing contract unchanged
  const types = Object.fromEntries(app.map.geojson.features.map((f) => [f.properties.kind, f.geometry.type]));
  assert.equal(types.tree, 'Point'); assert.equal(types.road, 'LineString'); assert.equal(types.building, 'Polygon');
  assert.deepEqual(app.map.siteChecks.items, []);
});

test('drawn rear extension: measured, checked against the tree, screened for permitted development', async (t) => {
  const { draw } = await setup(t);
  const r = await draw([[-2.5, 4.5], [2.5, 4.5], [2.5, 8.5], [-2.5, 8.5]]);
  assert.equal(r.status, 200);
  assert.equal(r.body.map.drawn.beyondRearM, 4); assert.equal(r.body.map.drawn.areaM2, 20);
  assert.match(msgs(r), /warn: About 2 m from a mapped tree \(Silver birch\), inside its estimated root protection area/);
  assert.equal(r.body.map.layers.find((l) => l.kind === 'tree').status, 'near');
  assert.equal(r.body.map.layers.find((l) => l.kind === 'proposal').label, 'Your drawn area');
  assert.equal(r.body.assessment.verdict, 'prior_approval');                          // 4 m on a terrace: over 3 m, within 6 m
  assert.match(r.body.assessment.checks[0].message, /Measured as a rear extension reaching 4 m/);
});

test('drawn shape on the tree trunk, onto the road, over a neighbour, or past the plot is flagged', async (t) => {
  const { draw } = await setup(t);
  let r = await draw([[-2, 8], [2, 8], [2, 12], [-2, 12]]);
  assert.match(msgs(r), /fail: The footprint covers or touches a mapped tree/);
  assert.equal(r.body.map.layers.find((l) => l.kind === 'tree').status, 'blocked');

  r = await draw([[-1, -4.5], [1, -4.5], [1, -10], [-1, -10]]);                      // runs out of the front door onto the street
  assert.match(msgs(r), /fail: Reaches about [\d.]+ m onto the road \(Example Road\)/);
  assert.equal(r.body.map.layers.find((l) => l.kind === 'road').status, 'overlap');
  assert.match(msgs(r), /fail: Extends about [\d.]+ m beyond the registered title boundary/);

  r = await draw([[2, 4.5], [5, 4.5], [5, 7], [2, 7]]);                              // 0.5 m onto the east neighbour's land
  assert.ok(r.body.map.layers.filter((l) => l.kind === 'neighbour').some((l) => l.status === 'adjoining' || l.status === 'overlap' || l.status === 'close'));
  assert.match(msgs(r), /fail: Extends about [\d.]+ m beyond the registered title boundary/);
});

test('a shape that does not match "screen it as" is not given a permitted-development verdict', async (t) => {
  const { draw } = await setup(t);
  const r = await draw([[-1, -4.5], [1, -4.5], [1, -6], [-1, -6]]);                  // in FRONT of the house, screened as a rear extension
  assert.equal(r.body.assessment.confidence, 'needs_confirmation');
  assert.match(r.body.assessment.label, /Check the shape/);
  assert.ok(r.body.assessment.checks.some((c) => c.id === 'drawn-warning'));
});

test('outbuilding: size and set-back are measured; boundary distance comes from the title', async (t) => {
  const { draw } = await setup(t);
  const r = await draw([[-1.5, 8], [1.5, 8], [1.5, 10], [-1.5, 10]], { treatAs: 'outbuilding', roof: 'pitched', heightM: 2.4 });
  assert.equal(r.status, 200);
  assert.match(r.body.assessment.checks[0].message, /Measured as an outbuilding 3 m × 2 m/);
  assert.equal(r.body.assessment.workType, 'outbuilding');
});

test('bad drawings are rejected with a message the applicant can act on', async (t) => {
  const { draw } = await setup(t);
  let r = await draw([[-1, 5], [1, 7], [1, 5], [-1, 7]]);                            // bow-tie
  assert.equal(r.status, 400); assert.match(r.body.error.details[0].message, /crosses itself/);
  r = await draw([[-1, 5], [1, 5]]);
  assert.equal(r.status, 400); assert.match(r.body.error.details[0].message, /at least 3 corners/);
  r = await draw([[-1, 5], [-0.99, 5], [-1, 5.01]]);
  assert.match(r.body.error.details[0].message, /too small/);
  r = await draw([[0, 0], [60, 0], [60, 60], [0, 60]]);
  assert.match(r.body.error.details[0].message, /too large/);
  r = await draw([[200, 4.5], [205, 4.5], [205, 8.5], [200, 8.5]]);                  // somewhere else entirely
  assert.equal(r.status, 400); assert.match(r.body.error.message, /on or very close to the property/);
  r = await draw([[-1, 5], [1, 5], [1, 7]].map(([x, y]) => [x, y]), { ring: undefined });
  assert.equal(r.status, 400);
});

test('work types advertise the polygon field and which fields apply to which kind of work', async (t) => {
  const { j } = await setup(t);
  const { body } = await j('/api/work-types');
  const c = body.types.find((x) => x.type === 'custom_polygon');
  assert.equal(c.fields.find((f) => f.name === 'ring').kind, 'polygon');
  assert.deepEqual(c.fields.find((f) => f.name === 'roof').onlyFor, ['outbuilding']);
});
