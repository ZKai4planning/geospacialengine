import test from 'node:test';
import assert from 'node:assert/strict';
import { polyArea, overlapArea, edgeDistance, polyDistance, outsideStats, segmentsIntersect, open } from '../src/utils/polygons.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('area, closing vertex, segment intersection', () => {
  assert.equal(polyArea(rect(0, 0, 2, 3)), 6);
  assert.equal(open([[0, 0], [1, 0], [1, 1], [0, 0]]).length, 3);
  assert.ok(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]));
  assert.ok(!segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1]));
});

test('overlapArea: partial overlap, touching only, and L-shaped (concave) polygons', () => {
  near(overlapArea(rect(0, 0, 4, 4), rect(2, 2, 6, 6)), 4, 0.2);
  assert.ok(overlapArea(rect(0, 0, 4, 4), rect(4, 0, 8, 4)) < 0.05); // sharing a wall = no overlap
  const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
  near(overlapArea(L, rect(1, 1, 5, 5)), 4 + 2 + 2 - 1 /* corner counted once */ - 0, 1.1);
  near(overlapArea(L, rect(3, 3, 5, 5)), 0, 0.05); // sits in the notch
});

test('distances', () => {
  near(edgeDistance(rect(0, 0, 2, 2), rect(5, 0, 7, 2)), 3, 1e-9);
  assert.equal(edgeDistance(rect(0, 0, 2, 2), rect(1, 1, 3, 3)), 0);
  assert.equal(polyDistance(rect(0, 0, 10, 10), rect(4, 4, 5, 5)), 0); // containment
  near(polyDistance(rect(0, 0, 1, 1), rect(4, 5, 5, 6)), 5, 1e-9);
});

test('outsideStats ignores the data-accuracy tolerance and measures the real excursion', () => {
  const plot = rect(0, 0, 4, 3);
  const small = outsideStats(rect(0, 0, 4, 3.3), plot, 0.5);   // 0.3 m over: within tolerance
  assert.equal(small.areaM2, 0);
  const big = outsideStats(rect(0, 0, 4, 5), plot, 0.5);       // 2 m over
  near(big.areaM2, 4 * 1.5, 0.3);                               // only the part beyond the 0.5 m tolerance counts
  near(big.maxDepthM, 2, 0.15);
});
