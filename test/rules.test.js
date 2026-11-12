import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { registerRule } from '../src/services/rules/index.js';
import { parseMetres, trunkDiameterM, roadFromElement, treeFromElement } from '../src/utils/osmTags.js';
import { protectionRadius } from '../src/utils/trees.js';
import { isSimple, pointPolyDistance, polyToLineDistance } from '../src/utils/polygons.js';
import { standardiseDrawn } from '../src/services/customProposal.js';

// local metres (x east, y north) -> [lng, lat], so tests read in metres
const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const house = rect(0, 0, 5, 9);
const ext = rect(0, 9, 5, 13);                                           // 4 m rear extension
const road = (y, o = {}) => ({ id: 'r', name: 'High Street', widthM: 6, ignore: false, line: [[-20, y], [30, y]].map(ll), ...o });
const tree = (x, y, o = {}) => ({ id: 't', ...Object.fromEntries([['lng', ll([x, y])[0]], ['lat', ll([x, y])[1]]]), trunkDiameterM: 0.5, ...o });
const run = (o) => runSiteChecks({ proposalRing: ext, houseRing: house, ...o });
const has = (r, status, re) => r.items.some((i) => i.status === status && re.test(i.message));

test('OSM tag parsing: units, circumference, driveways', () => {
  assert.equal(parseMetres('50 cm'), 0.5);
  assert.equal(parseMetres('0.45'), 0.45);
  assert.equal(parseMetres('45', { cmAbove: 3 }), 0.45);   // bare 45 on a trunk can only be centimetres
  assert.equal(parseMetres('lots'), null);
  assert.ok(Math.abs(trunkDiameterM({ circumference: '1.5' }) - 0.477) < 0.01);
  assert.equal(treeFromElement({ type: 'node', id: 1, lat: 51, lon: 0, tags: { natural: 'tree', diameter: '60 cm', species: 'Quercus robur' } }).trunkDiameterM, 0.6);
  assert.equal(treeFromElement({ type: 'way', id: 1, tags: { natural: 'tree' } }), null);
  const mk = (tags) => roadFromElement({ id: 1, tags, geometry: [{ lat: 51, lon: 0 }, { lat: 51, lon: 0.001 }] });
  assert.equal(mk({ highway: 'residential' }).widthM, 5.5);
  assert.equal(mk({ highway: 'residential', width: '7' }).widthM, 7);
  assert.equal(mk({ highway: 'residential', width: '700' }).widthM, 5.5);         // nonsense tag falls back
  assert.equal(mk({ highway: 'service', service: 'driveway' }).ignore, true);
  assert.equal(mk({ highway: 'service' }).ignore, false);
});

test('tree root zone: 12 x trunk diameter, clamped, with a stated source', () => {
  assert.deepEqual(protectionRadius({ trunkDiameterM: 0.5 }), { radiusM: 6, source: 'trunk' });
  assert.deepEqual(protectionRadius({ trunkDiameterM: 3 }), { radiusM: 15, source: 'trunk' });
  assert.deepEqual(protectionRadius({ trunkDiameterM: 0.05 }), { radiusM: 2, source: 'trunk' });
  assert.deepEqual(protectionRadius({ crownDiameterM: 8 }), { radiusM: 4, source: 'crown' });
  assert.deepEqual(protectionRadius({}), { radiusM: 5, source: 'assumed' });
});

test('polygon helpers: bow-tie detection, point/line distances', () => {
  assert.equal(isSimple([[0, 0], [4, 0], [4, 4], [0, 4]]), true);
  assert.equal(isSimple([[0, 0], [4, 4], [4, 0], [0, 4]]), false);
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(pointPolyDistance([2, 2], sq), 0);
  assert.equal(pointPolyDistance([7, 2], sq), 3);
  assert.equal(polyToLineDistance(sq, [[-5, 6], [10, 6]]), 2);        // line passes 2 m above
  assert.equal(polyToLineDistance(sq, [[-5, 2], [10, 2]]), 0);        // line crosses it
  assert.equal(polyToLineDistance(sq, [[1, 1], [2, 2]]), 0);          // line inside it
});

test('roads: onto the carriageway = fail, within 1 m = warn, clear = pass, own driveway ignored', () => {
  // extension spans y 9..13; road centreline 6 m wide
  let r = run({ roads: [road(14)] });                     // edge of road at y 11 -> 2 m INTO the extension
  assert.equal(r.roads[0].status, 'overlap');
  assert.ok(has(r, 'fail', /Reaches about 2 m onto the road \(High Street\)/));

  r = run({ roads: [road(16.5)] });                       // edge at y 13.5 -> 0.5 m clear
  assert.equal(r.roads[0].status, 'close');
  assert.ok(has(r, 'warn', /Within about 0\.5 m of the edge of the road/));

  r = run({ roads: [road(20)] });                         // edge at 17 -> 4 m clear
  assert.equal(r.roads[0].status, 'clear');
  assert.ok(has(r, 'pass', /Clear of mapped roads/));

  r = run({ roads: [road(14, { ignore: true })] });       // a private drive across the plot
  assert.equal(r.roads[0].status, 'ignored');
  assert.ok(!r.items.some((i) => i.status === 'fail'));

  r = run({ roads: [road(10.2)] });                       // centreline touching the footprint still counts
  assert.equal(r.roads[0].status, 'overlap');
});

test('trees: on the trunk = fail, inside root zone = warn, outside = pass, none mapped = info, TPO noted', () => {
  let r = run({ trees: [tree(2.5, 11)] });                // trunk inside the extension
  assert.equal(r.trees[0].status, 'blocked');
  assert.ok(has(r, 'fail', /covers or touches a mapped tree/));

  r = run({ trees: [tree(2.5, 16)] });                    // 3 m from the wall, 6 m root zone
  assert.equal(r.trees[0].status, 'near'); assert.equal(r.trees[0].distanceM, 3);
  assert.ok(has(r, 'warn', /About 3 m from a mapped tree, inside its estimated root protection area \(radius 6 m, from its trunk size\)/));
  assert.ok(!r.items.some((i) => i.status === 'fail'));   // inside a root zone is a warning, not a verdict

  r = run({ trees: [tree(2.5, 25)] });                    // 12 m away
  assert.equal(r.trees[0].status, 'clear'); assert.ok(has(r, 'pass', /No mapped trees found within/));

  r = run({ trees: [] });
  assert.ok(has(r, 'info', /No trees are mapped here.*does not mean there are none/)); assert.ok(!has(r, 'pass', /trees/));

  r = run({ trees: [tree(2.5, 16, { trunkDiameterM: null })] });   // no trunk size -> cautious 5 m, and says so
  assert.equal(r.trees[0].radiusM, 5); assert.match(r.items.find((i) => /mapped tree/.test(i.message)).message, /assumed/);

  r = run({ trees: [tree(2.5, 16)], flags: { tpo: true } });
  assert.ok(has(r, 'info', /tree preservation order/));
});

test('roof work and indicative outlines skip roads/trees, but a DRAWN shape is checked even with an indicative outline', () => {
  const o = { roads: [road(14)], trees: [tree(2.5, 11)] };
  assert.match(run({ ...o, footprintWork: false }).items[0].message, /Roof-level work/);
  assert.match(run({ ...o, houseIndicative: true }).items[0].message, /No building outline/);
  const drawn = run({ ...o, houseIndicative: true, proposalAbsolute: true });
  assert.equal(drawn.roads[0].status, 'overlap'); assert.equal(drawn.trees[0].status, 'blocked');
});

test('custom rules: registered rules run in order after the built-in ones; a broken rule is contained', () => {
  const off = registerRule({ id: 'mine', run: ({ P }, result) => result.items.push({ status: 'warn', message: `custom saw ${P.length} corners` }) });
  const off2 = registerRule({ id: 'broken', run: () => { throw new Error('boom'); } });
  try {
    const r = run({ trees: [] });
    assert.equal(r.items.at(-2).message, 'custom saw 4 corners');
    assert.match(r.items.at(-1).message, /"broken" check could not be completed/);
  } finally { off(); off2(); }
  assert.ok(!run({}).items.some((i) => /custom saw/.test(i.message)));
  assert.throws(() => registerRule({ id: 'x' }), /needs an id and a run/);
});

test('drawn shape -> standard proposal: depth counts from the ORIGINAL rear wall in both existing-extension cases', () => {
  const m = { sMin: -2.5, sMax: 2.5, dMin: 0, dMax: 4, widthM: 5, lengthM: 4 };
  const p = { type: 'custom_polygon', treatAs: 'rear_extension', heightM: 3 };
  // no existing extension: new depth = 4
  assert.equal(standardiseDrawn(p, m, { houseWidthM: 5 }).proposal.depthM, 4);
  // 2 m existing extension INSIDE the outline: the engine will add 2 m itself, so only the 4 m beyond the outline is new
  assert.equal(standardiseDrawn(p, m, { houseWidthM: 5, existingDepthM: 2, existingBeyondOutline: false }).proposal.depthM, 4);
  // 2 m existing extension BEYOND the outline: the drawn 4 m already contains it, so only 2 m is new
  assert.equal(standardiseDrawn(p, m, { houseWidthM: 5, existingDepthM: 2, existingBeyondOutline: true }).proposal.depthM, 2);
  // not behind the house -> warning
  assert.ok(standardiseDrawn(p, { ...m, dMax: -1 }, { houseWidthM: 5 }).notes.some((n) => n.id === 'drawn-warning'));
  // boundary distance measured from the title, unless the applicant overrides it
  assert.equal(standardiseDrawn(p, m, { houseWidthM: 5, boundaryM: 0.4 }).proposal.distanceToSideBoundaryM, 0.4);
  assert.equal(standardiseDrawn({ ...p, distanceToSideBoundaryM: 3 }, m, { houseWidthM: 5, boundaryM: 0.4 }).proposal.distanceToSideBoundaryM, 3);
  // side extension: width beyond the wall, on the correct side
  const side = standardiseDrawn({ ...p, treatAs: 'side_extension' }, { ...m, sMin: 2.5, sMax: 4.5, dMin: -4, dMax: 3, widthM: 2, lengthM: 7 }, { houseWidthM: 5 }).proposal;
  assert.equal(side.side, 'right'); assert.equal(side.widthM, 2);
  // outbuilding: bounding-box size and set-back
  const ob = standardiseDrawn({ ...p, treatAs: 'outbuilding', roof: 'pitched' }, { ...m, dMin: 6, dMax: 9, widthM: 3, lengthM: 3 }, { houseWidthM: 5 }).proposal;
  assert.deepEqual([ob.type, ob.widthM, ob.depthM, ob.setbackM, ob.roof], ['outbuilding', 3, 3, 6, 'pitched']);
});
