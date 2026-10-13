import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { parseWktPolygons } from '../src/providers/titleBoundary.js';

// local metres (x east, y north) -> [lng, lat] around a London point, so tests read in metres
const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };

const house = rect(0, 0, 5, 9);                       // 5 m wide, 9 m deep
const run = (o) => runSiteChecks({ proposalRing: rect(0, 9, 5, 13), houseRing: house, neighbours: [], ...o }); // 4 m rear extension
const statusOf = (r, i = 0) => r.neighbours[i].status;
const fails = (r) => r.items.filter((i) => i.status === 'fail');

test('neighbour: overlap = fail (with direction), adjoining = info, close = warn, far = clear', () => {
  let r = run({ proposalRing: rect(0, 9, 6, 13), neighbours: [{ id: 'n', ring: rect(5, 0, 10, 13) }] }); // extension runs 1 m onto the east neighbour's land
  assert.equal(statusOf(r), 'overlap');
  assert.equal(r.neighbours[0].direction, 'east');
  assert.equal(r.neighbours[0].overlapM2, 4);
  assert.match(fails(r)[0].message, /Overlaps the neighbouring building to the east by about 4 m²/);

  r = run({ neighbours: [{ id: 'n', ring: rect(5, 9, 10, 13) }] });             // sharing the party wall only
  assert.equal(statusOf(r), 'adjoining'); assert.equal(fails(r).length, 0);
  assert.ok(r.items.some((i) => i.status === 'info' && /party wall/.test(i.message)));

  r = run({ neighbours: [{ id: 'n', ring: rect(5.6, 9, 10, 13) }] });           // 0.6 m away
  assert.equal(statusOf(r), 'close'); assert.ok(r.items.some((i) => i.status === 'warn'));

  r = run({ neighbours: [{ id: 'n', ring: rect(8, 9, 12, 13) }] });             // 3 m away
  assert.equal(statusOf(r), 'clear');
  assert.ok(r.items.some((i) => i.status === 'pass' && /No overlap/.test(i.message)));
});

test('a duplicate of the house itself, or a tiny jitter overlap, is not a conflict', () => {
  assert.equal(statusOf(run({ neighbours: [{ id: 'd', ring: rect(0.2, 0.2, 4.8, 8.8) }] })), 'ignored');
  const r = run({ neighbours: [{ id: 'n', ring: rect(4.9, 9, 10, 13) }] });     // 0.1 m of overlap = coordinate noise
  assert.notEqual(statusOf(r), 'overlap'); assert.equal(fails(r).length, 0);
});

test('roof-level work and missing outlines skip the footprint checks', () => {
  const roof = run({ footprintWork: false, neighbours: [{ id: 'n', ring: rect(4, 8, 9, 14) }] });
  assert.equal(roof.items.length, 1); assert.match(roof.items[0].message, /Roof-level work/); assert.equal(statusOf(roof), 'clear');
  const synth = run({ houseIndicative: true, neighbours: [{ id: 'n', ring: rect(4, 8, 9, 14) }] });
  assert.match(synth.items[0].message, /No building outline/);
  const none = runSiteChecks({ proposalRing: null, houseRing: house, neighbours: [{ id: 'n', ring: rect(8, 0, 12, 9) }] });
  assert.deepEqual(none.items, []);
});

test('title boundary: inside = pass, beyond = fail with the depth, jitter ignored, wrong title skipped, none = info', () => {
  const plot = { ring: rect(-1, -2, 6, 20), areaM2: 154 };
  let r = run({ plot });
  assert.equal(r.boundary.status, 'inside'); assert.ok(r.items.some((i) => i.status === 'pass' && /Inside the registered title boundary/.test(i.message)));

  r = run({ plot: { ring: rect(-1, -2, 6, 11), areaM2: 100 } });                // plot ends 2 m into the 4 m extension
  assert.equal(r.boundary.status, 'crosses');
  assert.ok(Math.abs(r.boundary.maxOutsideM - 2) < 0.2, String(r.boundary.maxOutsideM));
  assert.match(fails(r)[0].message, /beyond the registered title boundary/);

  r = run({ plot: { ring: rect(-1, -2, 6, 12.7), areaM2: 100 } });              // only 0.3 m over = within data accuracy
  assert.equal(r.boundary.status, 'inside');

  r = run({ plot: { ring: rect(50, 50, 60, 60), areaM2: 100 } });               // title elsewhere: don't cry wolf
  assert.equal(r.boundary.status, 'unreliable'); assert.equal(fails(r).length, 0);

  r = run({ plot: null });
  assert.equal(r.boundary.status, 'unavailable'); assert.ok(r.items.some((i) => /No registered title boundary/.test(i.message)));
});

test('WKT parsing: MULTIPOLYGON, POLYGON with a hole, garbage', () => {
  const m = parseWktPolygons('MULTIPOLYGON (((-0.49084 51.528436, -0.490752 51.528495, -0.491372 51.528856, -0.491462 51.528792, -0.49084 51.528436)))');
  assert.equal(m.length, 1); assert.deepEqual(m[0][0], [-0.49084, 51.528436]); assert.equal(m[0].length, 5);
  const p = parseWktPolygons('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))');
  assert.equal(p.length, 1); assert.equal(p[0].length, 5);                       // hole ignored, ring closed
  assert.equal(parseWktPolygons('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))').length, 2);
  assert.deepEqual(parseWktPolygons(''), []); assert.deepEqual(parseWktPolygons(null), []); assert.deepEqual(parseWktPolygons('POINT (1 2)'), []);
});
