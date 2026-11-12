import test from 'node:test';
import assert from 'node:assert/strict';
import { publicStrips } from '../src/services/publicStrip.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const plot = ring([[0, -12], [5, -12], [5, 0], [0, 0]]);
const back = (r) => r.map(([lng, lat]) => [(lng - LNG) * MX, (lat - LAT) * MY]);

test('road across the front: the strip is the plot front edge up to the carriageway edge', () => {
  const [s] = publicStrips({ plotRings: [plot], roads: [{ name: 'Manor Road', widthM: 5, line: [[-20, 7.5], [30, 7.5]].map(ll) }] });
  assert.equal(s.gapM, 5); assert.equal(s.roadName, 'Manor Road');
  assert.ok(s.areaM2 > 20 && s.areaM2 < 30, `area ${s.areaM2}`);        // 5 m wide x 5 m deep
  const ys = back(s.ring).map((p) => p[1]);
  assert.ok(Math.max(...ys) < 5.1 && Math.min(...ys) > -0.1);           // never behind the plot front or onto the carriageway
});

test('road running diagonally alongside the plot: the strip follows the plot side that faces it', () => {
  const [s] = publicStrips({ plotRings: [plot], roads: [{ widthM: 5, line: [[8, -30], [14, 20]].map(ll) }] });
  assert.ok(s, 'a strip is found');
  const xs = back(s.ring).map((p) => p[0]);
  assert.ok(Math.min(...xs) > 4.9, 'strip lies on the road side of the plot (east)');
  assert.ok(s.gapM > 2 && s.gapM < 6);
});

test('ignored roads (private drives) and far-away roads give no strip', () => {
  assert.equal(publicStrips({ plotRings: [plot], roads: [{ widthM: 5, ignore: true, line: [[-20, 7.5], [30, 7.5]].map(ll) }] }).length, 0);
  assert.equal(publicStrips({ plotRings: [plot], roads: [{ widthM: 5, line: [[-20, 90], [30, 90]].map(ll) }] }).length, 0);
  assert.equal(publicStrips({ plotRings: [], roads: [] }).length, 0);
});
