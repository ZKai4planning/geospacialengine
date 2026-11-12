import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { wallContacts } from '../src/utils/polygons.js';

// local metres (x east, y north) -> [lng, lat], so the scenarios read in metres
const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const house = rect(0, 0, 5, 9);
const ext = rect(0, 9, 5, 13);                          // 4 m rear extension, same width as the house
const nb = (x0, y0, x1, y1, id = 'n1') => ({ id, ring: rect(x0, y0, x1, y1) });
const title = (x0, y0, x1, y1) => ({ ring: rect(x0, y0, x1, y1), rings: [rect(x0, y0, x1, y1)], areaM2: (x1 - x0) * (y1 - y0), estimated: false });
const run = (o = {}) => runSiteChecks({ proposalRing: ext, houseRing: house, ...o });
const wall = (r, facing) => r.walls.find((w) => w.facing === facing && w.kind === 'external');

test('wallContacts: contact length and nearest distance per wall', () => {
  const P = [[0, 0], [4, 0], [4, 3], [0, 3]], N = [[4, 1], [8, 1], [8, 6], [4, 6]];   // shares x = 4 from y = 1 to 3
  const w = wallContacts(P, [N]);
  const east = w.find((x) => x.from[0] === 4 && x.to[0] === 4);
  assert.ok(Math.abs(east.contactM - 2) < 0.7, `contact ${east.contactM}`);   // the 0.3 m map tolerance can add up to 0.3 m at each end
  assert.ok(east.nearestM < 0.1);
  assert.ok(w.find((x) => x.from[0] === 0 && x.to[0] === 0).nearestM > 3.9);          // the far (west) wall is nowhere near
});

test('wall touching a neighbour: the east wall is flagged with how much of it touches', () => {
  const r = run({ neighbours: [nb(5, 0, 10, 12)] });                                   // neighbour has its own extension reaching 3 m along ours
  const e = wall(r, 'east');
  assert.equal(e.status, 'touches_neighbour');
  assert.ok(Math.abs(e.neighbour.contactM - 3) < 0.7, `contact ${e.neighbour.contactM}`);
  assert.ok(r.items.some((i) => i.status === 'warn' && /Wall safety.*east wall.*hard against the neighbouring building/.test(i.message)));
  assert.equal(r.wallSafety.status, 'attention');
  assert.equal(wall(r, 'west').status, 'clear');
});

test('the wall that joins the existing house is internal, never reported', () => {
  const r = run({ neighbours: [nb(5, 0, 10, 12)] });
  const s = r.walls.find((w) => w.facing === 'south');
  assert.equal(s.kind, 'internal');
  assert.equal(s.status, 'internal');
});

test('a narrow gap (0.6 m) to a neighbour is a close-wall warning, not a touch', () => {
  const r = run({ neighbours: [nb(5.6, 0, 10, 13)] });
  const e = wall(r, 'east');
  assert.equal(e.status, 'close_neighbour');
  assert.ok(e.neighbour.distanceM > 0.3 && e.neighbour.distanceM < 1);
  assert.ok(r.items.some((i) => i.status === 'warn' && /too narrow to maintain/.test(i.message)));
});

test('a gap of 2 m is fine: pass, and no wall is flagged', () => {
  const r = run({ neighbours: [nb(7, 0, 12, 13)] });
  assert.ok(r.walls.every((w) => !['touches_neighbour', 'close_neighbour', 'on_boundary', 'within_1m'].includes(w.status)));
  assert.ok(r.items.some((i) => i.status === 'pass' && /Wall safety/.test(i.message)));
  assert.equal(r.wallSafety.status, 'ok');
});

test('registered boundary: a wall on the line is flagged as on the boundary; 0.7 m from it is within 1 m', () => {
  const on = run({ plot: title(-3, -10, 5, 25) });
  assert.equal(wall(on, 'east').status, 'on_boundary');
  assert.ok(on.items.some((i) => /sits on the registered boundary line/.test(i.message) && /fire-resistant/.test(i.message)));
  const near = run({ plot: title(-3, -10, 5.7, 25) });
  assert.equal(wall(near, 'east').status, 'within_1m');
  assert.ok(near.items.some((i) => /within 1 m of the boundary/.test(i.message)));
  assert.equal(run({ plot: title(-3, -10, 9, 25) }).wallSafety.status, 'ok');
});

test('an ESTIMATED plot outline is never used as a boundary for wall safety', () => {
  const est = { ...title(-3, -10, 5, 25), estimated: true };
  const r = run({ plot: est });
  assert.equal(r.wallSafety.boundaryUsed, false);
  assert.ok(r.walls.every((w) => w.status !== 'on_boundary'));
  assert.ok(r.items.some((i) => /not checked/.test(i.message)), 'with nothing to compare against it says so instead of passing');
});

test('a wall running into a neighbour is an overlap (fail), not a touch', () => {
  const r = run({ proposalRing: rect(0, 9, 7, 13), neighbours: [nb(5, 0, 10, 13)] });
  assert.ok(r.walls.some((w) => w.status === 'overlaps_neighbour'));
  assert.ok(r.items.some((i) => i.status === 'fail' && /Wall safety.*runs into the neighbouring building/.test(i.message)));
  assert.equal(r.wallSafety.status, 'blocked');
});

test('wall safety never fails the request: no neighbours and no title = not checked (info), roof-level work skips it', () => {
  const r = run();
  assert.equal(r.wallSafety.status, 'unchecked');
  assert.ok(!r.items.some((i) => i.status === 'pass' && /Wall safety/.test(i.message)), 'no data must never read as a pass');
  const roof = runSiteChecks({ proposalRing: ext, houseRing: house, footprintWork: false });
  assert.deepEqual(roof.walls, []);
});

test('a wall that only meets the boundary at its two corners is not "on the boundary"', () => {
  // title exactly as wide as the extension: the north wall's ends touch the side boundaries, but the north boundary is far away
  const r = run({ plot: title(0, -10, 5, 25) });
  assert.equal(wall(r, 'north').status, 'clear');
  assert.equal(wall(r, 'east').status, 'on_boundary');
  assert.equal(wall(r, 'west').status, 'on_boundary');
});
