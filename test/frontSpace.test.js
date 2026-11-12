import test from 'node:test';
import assert from 'node:assert/strict';
import { frontSpaceCheck, NO_FRONT_SPACE } from '../src/services/frontSpace.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';

const porch = { type: 'front_porch', widthM: 1.6, depthM: 1.5, heightM: 2.8 };
const sc = (o = {}) => ({ boundary: { status: 'inside', estimated: false, maxOutsideM: 0, outsideM2: 0 }, roads: [], ...o });
const base = { houseForm: 'terraced', existingExtensionDepthM: 0 };

test('only front porches are checked, and only when site checks exist', () => {
  assert.equal(frontSpaceCheck({ proposal: { type: 'rear_extension', widthM: 3, depthM: 3 }, siteChecks: sc({ roads: [{ status: 'overlap', intoM: 1 }] }) }), null);
  assert.equal(frontSpaceCheck({ proposal: porch, siteChecks: null }), null);
});

test('a porch with room in front of the door raises nothing', () => {
  assert.equal(frontSpaceCheck({ proposal: porch, siteChecks: sc({ roads: [{ status: 'clear', distanceM: 6 }] }) }), null);
});

test('porch reaching onto the mapped road = certain', () => {
  const r = frontSpaceCheck({ proposal: porch, siteChecks: sc({ roads: [{ status: 'overlap', intoM: 1.5, name: 'Manor Road' }] }) });
  assert.equal(r.level, 'certain'); assert.equal(r.basis, 'road'); assert.equal(r.headline, NO_FRONT_SPACE);
  assert.match(r.reason, /1\.5 m onto the road \(Manor Road\)/);
});

test('registered title on the front wall, porch wholly outside it = certain; only a sliver outside = nothing', () => {
  const out = frontSpaceCheck({ proposal: porch, siteChecks: sc({ boundary: { status: 'crosses', estimated: false, maxOutsideM: 1.5, outsideM2: 2.4 } }) });
  assert.equal(out.level, 'certain'); assert.equal(out.basis, 'title');
  assert.equal(frontSpaceCheck({ proposal: porch, siteChecks: sc({ boundary: { status: 'crosses', estimated: false, maxOutsideM: 0.6, outsideM2: 0.7 } }) }), null);
});

test('an ESTIMATED plot or a porch near the kerb is only "likely" (never a verdict)', () => {
  const est = frontSpaceCheck({ proposal: porch, siteChecks: sc({ boundary: { status: 'crosses', estimated: true, maxOutsideM: 1.5, outsideM2: 2.4 } }) });
  assert.equal(est.level, 'likely');
  const near = frontSpaceCheck({ proposal: porch, siteChecks: sc({ roads: [{ status: 'close', distanceM: 0.6 }] }) });
  assert.equal(near.level, 'likely'); assert.equal(near.basis, 'near-road');
});

test('assessment: certain = planning permission with the plain message first; likely = warning only; none = unchanged', () => {
  const withPorch = (frontSpace) => assessProposal({ ...base, proposal: { ...porch, distanceToHighwayM: 3 }, frontSpace });
  const certain = withPorch(frontSpaceCheck({ proposal: porch, siteChecks: sc({ roads: [{ status: 'overlap', intoM: 1.5 }] }) }));
  assert.equal(certain.verdict, 'planning_permission');
  assert.equal(certain.blocker.level, 'certain');
  assert.ok(certain.summary.startsWith(NO_FRONT_SPACE));
  assert.ok(!certain.checks.some((c) => c.id === 'porch-highway'), 'the generic highway check is replaced');

  const likely = withPorch(frontSpaceCheck({ proposal: porch, siteChecks: sc({ roads: [{ status: 'close', distanceM: 0.6 }] }) }));
  assert.equal(likely.verdict, 'permitted_development'); assert.equal(likely.confidence, 'needs_confirmation');
  assert.equal(likely.blocker.level, 'likely');

  const none = withPorch(null);
  assert.equal(none.verdict, 'permitted_development'); assert.equal(none.blocker, undefined);
});

// ---- public land: the strip between the plot and the road ----
import { runSiteChecks } from '../src/services/siteChecks.js';
import { publicLandCheck, PUBLIC_LAND } from '../src/services/frontSpace.js';

// Local square grid near (lat 51.5, lng -0.1). Plot front edge at y = 0 (metres), road centreline 7.5 m further north (5 m of pavement + 2.5 m half-carriageway).
const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const plotRing = ring([[0, -12], [5, -12], [5, 0], [0, 0]]);
const road = { id: 'r1', name: 'Manor Road', widthM: 5, ignore: false, line: [[-20, 7.5], [30, 7.5]].map(ll) };
const check = (proposal, plot = { ring: plotRing, areaM2: 60, estimated: false }) => runSiteChecks({
  proposalRing: ring(proposal), houseRing: ring([[0, -10], [5, -10], [5, -2], [0, -2]]), plot, roads: [road], proposalAbsolute: true,
});

test('anything past the front of the plot, towards the road, is public land (registered title = fail)', () => {
  const r = check([[0.5, -2], [4.5, -2], [4.5, 2], [0.5, 2]]);
  assert.equal(r.publicLand.status, 'on_public_land');
  assert.ok(r.publicLand.maxIntoM >= 1.5 && r.publicLand.maxIntoM <= 2.1);
  assert.equal(r.publicLand.gapM, 5);
  assert.ok(r.items.some((i) => i.status === 'fail' && /public land/.test(i.message)));
});

test('rear work and work wholly inside the plot never touch the public land rule', () => {
  assert.equal(check([[0.5, -12], [4.5, -12], [4.5, -9], [0.5, -9]]).publicLand.status, 'clear');
  assert.equal(check([[0.5, -4], [4.5, -4], [4.5, -0.2], [0.5, -0.2]]).publicLand.status, 'clear');
});

test('an ESTIMATED plot only warns, and a non-porch extension gets a general public-land verdict', () => {
  const est = check([[0.5, -2], [4.5, -2], [4.5, 2], [0.5, 2]], { ring: plotRing, areaM2: 60, estimated: true });
  assert.equal(est.publicLand.status, 'on_public_land');
  assert.ok(est.items.some((i) => i.status === 'warn' && /public land/.test(i.message)));
  assert.ok(!est.items.some((i) => i.status === 'fail' && /public land/.test(i.message)));

  const ext = { type: 'side_extension', widthM: 2, heightM: 3, side: 'right' };
  const sure = publicLandCheck({ proposal: ext, siteChecks: check([[0.5, -2], [4.5, -2], [4.5, 2], [0.5, 2]]) });
  assert.equal(sure.level, 'certain');
  const a = assessProposal({ ...base, proposal: ext, publicLand: sure });
  assert.equal(a.verdict, 'planning_permission'); assert.equal(a.blocker.id, 'public-land');
  assert.ok(a.summary.startsWith(PUBLIC_LAND));
  assert.equal(publicLandCheck({ proposal: porch, siteChecks: check([[0.5, -2], [4.5, -2], [4.5, 2], [0.5, 2]]) }), null, 'porches use frontSpaceCheck');
});

test('a porch stepping into the strip between a registered title and the road = certain, even if the road itself is not reached', () => {
  const r = frontSpaceCheck({ proposal: porch, siteChecks: check([[1, -0.5], [2.6, -0.5], [2.6, 1], [1, 1]]) });
  assert.equal(r.level, 'certain'); assert.equal(r.basis, 'public-land');
});

// ---- a road running diagonally ALONGSIDE the plot (the strip is not a constant band), and a parcel only accurate to ~5 m ----
const sideRoad = { id: 'r2', name: 'Manor Road', widthM: 5, ignore: false, line: [[8, -30], [14, 20]].map(ll) };
const checkSide = (proposal, plot) => runSiteChecks({
  proposalRing: ring(proposal), houseRing: ring([[0, -10], [4, -10], [4, -2], [0, -2]]), plot: plot ?? { ring: plotRing, areaM2: 60, estimated: false, approxM: 5 },
  roads: [sideRoad], proposalAbsolute: true,
});

test('a porch on the road side of a plot, beside a diagonal road, is on public land even when the parcel is only accurate to 5 m', () => {
  const r = checkSide([[5, -6], [6.6, -6], [6.6, -4.5], [5, -4.5]]);
  assert.equal(r.publicLand.status, 'on_public_land');
  assert.ok(r.items.some((i) => i.status === 'fail' && /public land/.test(i.message) && /accurate to about 5 m/.test(i.message)));
  assert.equal(frontSpaceCheck({ proposal: porch, siteChecks: r }).level, 'certain');
});

test('diagonal road: rear work and work on the far side of the plot are not public land; a clear plot still reports the public gap', () => {
  assert.equal(checkSide([[0.5, -15], [4.5, -15], [4.5, -12], [0.5, -12]]).publicLand.status, 'clear');
  assert.equal(checkSide([[-3, -8], [0, -8], [0, -4], [-3, -4]]).publicLand.status, 'clear');
  const r = checkSide([[0.5, -6], [4.5, -6], [4.5, -3], [0.5, -3]]);
  assert.equal(r.publicLand.status, 'clear');
  assert.ok(r.publicLand.gapM > 0);
  assert.ok(r.items.some((i) => i.status === 'info' && /public land/.test(i.message)));
});
