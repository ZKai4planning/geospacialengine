import test from 'node:test';
import assert from 'node:assert/strict';
import { heightTiles, coalTile, boundaryOverhang } from '../src/services/siteExtras.js';
import { buildDashboard } from '../src/services/dashboard.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const plot = ring(box(0, -24, 5, 0)), house = ring(box(0, -10, 5, -2));
const base = { subjectRing: house, subjectKind: 'house', houseRing: house, plotRings: [plot], frontBearingDeg: 0 };
const tiles = (d) => Object.fromEntries(d.sections.flatMap((s) => s.tiles).map((t) => [t.id, t]));
const ok = { status: 'ok', roofShape: 'pitched', eavesM: 4.9, ridgeM: 7.4, groundFallM: 0.5, shiftM: 2.2, confidence: 'high' };

test('boundary: work that sticks out says by how much instead of just "not wholly inside"', () => {
  const work = ring(box(1, -30, 4, -20));                                         // reaches 6 m past the rear boundary at y = -24
  const o = boundaryOverhang({ plotRings: [plot], proposalRing: work });
  assert.equal(o.corners, 2); assert.ok(Math.abs(o.maxOutsideM - 6) < 0.1);
  const t = tiles(buildDashboard({ ...base, subjectRing: work, subjectKind: 'proposal' }));
  assert.equal(t.boundary.status, 'check'); assert.match(t.boundary.value, /Goes up to 6 m beyond the title/); assert.match(t.boundary.sub, /proposed work/);
  assert.ok(!t.rear);
});

test('boundary: inside work still gets rear / side / front distances; a wall on the line counts as inside; an estimate gets nothing', () => {
  const work = ring(box(1, -16, 4, -10));
  assert.equal(boundaryOverhang({ plotRings: [plot], proposalRing: work }), null);
  assert.equal(boundaryOverhang({ plotRings: [plot], proposalRing: ring(box(0, -10, 5, -2)) }), null);   // walls exactly on the side boundaries
  const t = tiles(buildDashboard({ ...base, subjectRing: work, subjectKind: 'proposal' }));
  assert.equal(t.rear.value, '8 m'); assert.ok(!t.boundary);
  const est = tiles(buildDashboard({ ...base, subjectRing: ring(box(1, -30, 4, -20)), subjectKind: 'proposal', plotEstimated: true }));
  assert.match(est.boundary.sub, /only an estimate/);
});

test('roof height tile: eaves and ridge with the caveats; low confidence is info, not ok; flat roof; unclear; unavailable keeps the placeholder', () => {
  const [t, fall] = heightTiles(ok);
  assert.equal(t.value, 'Eaves about 4.9 m, ridge about 7.4 m'); assert.equal(t.status, 'ok'); assert.match(t.sub, /\+-0\.5 m/); assert.match(t.sub, /moved 2\.2 m/); assert.match(t.sub, /too close to call/);
  assert.equal(fall.id, 'ground-fall'); assert.equal(fall.value, 'Falls 0.5 m');
  assert.equal(heightTiles({ ...ok, confidence: 'low' })[0].status, 'info');
  assert.equal(heightTiles({ ...ok, groundFallM: 0.1, shiftM: 0 }).length, 1);
  assert.equal(heightTiles({ ...ok, roofShape: 'flat', eavesM: 5.5, ridgeM: 5.5 })[0].value, 'Flat roof about 5.5 m');
  assert.equal(heightTiles({ status: 'unclear', reason: 'No clear building.' })[0].status, 'info');
  for (const bad of [null, undefined, { status: 'unavailable', reason: 'The LiDAR service could not be read.' }]) { const [p] = heightTiles(bad); assert.equal(p.status, 'na'); assert.equal(p.id, 'roof-height'); }
});

test('coal tile: inside is a check, near and outside are info (absence is never a pass), unavailable stays a placeholder with the licence warning', () => {
  assert.equal(coalTile({ status: 'inside', source: 'MRA' }).status, 'check');
  assert.match(coalTile({ status: 'inside' }).sub, /Coal Mining Risk Assessment/);
  assert.match(coalTile({ status: 'near', distanceM: 80 }).value, /80 m from a high-risk area/);
  const out = coalTile({ status: 'outside' }); assert.equal(out.status, 'info'); assert.match(out.sub, /not a Mining Report/);
  for (const bad of [null, { status: 'unavailable', reason: 'Coal mining data is not set up.' }]) { const t = coalTile(bad); assert.equal(t.status, 'na'); assert.match(t.sub, /licence/); }
});

test('dashboard: with data the roof and coal tiles move into the site section and out of "not available yet"; without it nothing changes', () => {
  const none = buildDashboard(base), laterNone = none.sections.find((s) => s.id === 'later').tiles.map((t) => t.id);
  assert.deepEqual(laterNone, ['sewers', 'roof-height', 'ground', 'coal', 'floor-plans']);
  const d = buildDashboard({ ...base, lidar: ok, coal: { status: 'outside', source: 'MRA' } });
  const site = d.sections.find((s) => s.id === 'site').tiles.map((t) => t.id), later = d.sections.find((s) => s.id === 'later').tiles.map((t) => t.id);
  assert.ok(site.includes('roof-height') && site.includes('ground-fall') && site.includes('coal'));
  assert.deepEqual(later, ['sewers', 'ground', 'floor-plans']);
  const half = buildDashboard({ ...base, lidar: ok });                            // heights known, coal not set up
  assert.deepEqual(half.sections.find((s) => s.id === 'later').tiles.map((t) => t.id), ['sewers', 'ground', 'coal', 'floor-plans']);
});
