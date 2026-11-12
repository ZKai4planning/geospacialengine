import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteChecks } from '../src/services/siteChecks.js';

// local metres (x east, y north) -> [lng, lat], so tests read in metres
const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const house = rect(0, 0, 5, 9), ext = rect(0, 9, 5, 13);        // 4 m rear extension
const run = (o) => runSiteChecks({ proposalRing: ext, houseRing: house, ...o });
const has = (r, status, re) => r.items.some((i) => i.status === status && re.test(i.message));
const zone = (rings, o = {}) => ({ id: 'z', type: 'group', order: 'TPO7', rings, ...o });
const ptree = (x, y, o = {}) => { const [lng, lat] = ll([x, y]); return { id: 't', lng, lat, trunkDiameterM: 0.5, protected: true, order: 'TPO7', ...o }; };

test('tree preservation zone: inside = warn (not fail), close = info, far = silent; generic TPO note not repeated', () => {
  let r = run({ zones: [zone([rect(1, 10, 4, 12)])], flags: { tpo: true } });
  assert.equal(r.zones[0].status, 'inside');
  assert.ok(has(r, 'warn', /inside a group tree preservation zone \(order TPO7\).*consent/));
  assert.ok(!r.items.some((i) => /A tree preservation order applies in this area/.test(i.message)));
  assert.ok(!r.items.some((i) => i.status === 'fail'));

  r = run({ zones: [zone([rect(1, 15, 4, 17)])] });                // 2 m beyond the end of the extension
  assert.equal(r.zones[0].status, 'near'); assert.ok(has(r, 'info', /About 2 m from a group tree preservation zone/));

  r = run({ zones: [zone([rect(1, 30, 4, 32)])] });
  assert.equal(r.zones[0].status, 'clear'); assert.ok(!r.items.some((i) => /preservation zone/.test(i.message)));

  r = run({ zones: [], flags: { tpo: true } });                    // flag but no outline available: keep the general note
  assert.ok(has(r, 'info', /A tree preservation order applies in this area/));
});

test('a zone made of several pieces is judged on the nearest piece', () => {
  const r = run({ zones: [zone([rect(40, 40, 45, 45), rect(1, 11, 4, 12)])] });
  assert.equal(r.zones[0].status, 'inside');
});

test('protected tree: on the footprint = fail, inside root zone = warn mentioning consent; wording says "protected"', () => {
  let r = run({ trees: [ptree(2.5, 11)] });                        // trunk inside the extension
  assert.equal(r.trees[0].status, 'blocked'); assert.equal(r.trees[0].protected, true);
  assert.ok(has(r, 'fail', /covers or touches a protected tree \(TPO TPO7\)/));

  r = run({ trees: [ptree(2.5, 17)] });                            // 4 m from the extension, root radius 6 m
  assert.equal(r.trees[0].status, 'near');
  assert.ok(has(r, 'warn', /protected tree \(TPO TPO7\).*consent for any work affecting a protected tree/));

  r = run({ trees: [ptree(2.5, 11, { protected: false, order: null })] });  // an ordinary OSM tree keeps the old wording
  assert.ok(has(r, 'fail', /covers or touches a mapped tree/));
});

test('title made of two pieces: reaching the second piece is inside; with only the first it would cross', () => {
  const main = rect(-1, -2, 6, 12), garage = rect(-1, 12, 6, 16);   // extension (y 9-13) runs from the house piece into the garage piece
  let r = run({ plot: { ring: main, rings: [main, garage], areaM2: 150 } });
  assert.equal(r.boundary.status, 'inside');
  r = run({ plot: { ring: main, areaM2: 100 } });                    // legacy shape: no `rings`
  assert.equal(r.boundary.status, 'crosses');
  assert.ok(Math.abs(r.boundary.maxOutsideM - 1) < 0.2, String(r.boundary.maxOutsideM));
});
