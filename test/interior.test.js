import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterior } from '../src/services/interior/index.js';
import { buildLayout, loftHeadroom, polyArea, headAt } from '../src/services/interior/layout.js';
import { interiorChecks } from '../src/services/interior/checks.js';

// a terrace 5.5 m wide, 9 m deep, two storeys, pitched roof
const base = { W: 5.5, D: 9, storeys: 2, roofType: 'Pitched', form: 'terraced' };
const frameOf = (W = 5.5, D = 9) => ({ W, D, synthetic: false, toSD: (lng, lat) => [lng, lat] });
const profile = (o = {}) => ({ storeys: { value: 2 }, roofType: { value: 'Pitched' }, existingExtension: { present: false }, ...o });
const byId = (m, id) => m.rooms.find((r) => r.id === id);

test('the existing house gets a typical two-storey plan, flagged as assumed, and checks never judge it', () => {
  const m = buildLayout(base);
  assert.equal(m.nStoreys, 2);
  assert.ok(m.rooms.every((r) => r.assumed && !r.isNew));
  assert.ok(m.rooms.some((r) => r.type === 'bedroom'));
  assert.ok(m.assumptions.some((a) => /typical layout/.test(a)));
  assert.deepEqual(interiorChecks(m), []);
});

test('rooms on one storey do not overlap and stay inside the block', () => {
  const m = buildLayout(base);
  for (const s of [0, 1]) {
    const rs = m.rooms.filter((r) => r.storey === s);
    const total = rs.reduce((a, r) => a + polyArea(r.poly), 0);
    assert.ok(total <= 5.5 * 9 + 0.01, `storey ${s} area ${total}`);
    for (const r of rs) for (const [x, y] of r.poly) { assert.ok(x >= -0.01 && x <= 5.51); assert.ok(y >= -0.01 && y <= 9.01); }
  }
  // ground floor is fully covered
  assert.ok(Math.abs(m.rooms.filter((r) => r.storey === 0).reduce((a, r) => a + polyArea(r.poly), 0) - 5.5 * 9) < 0.05);
});

test('storeys unknown: two are assumed and said so; user setup wins', () => {
  assert.ok(buildLayout({ ...base, storeys: null }).assumptions.some((a) => /two assumed/.test(a)));
  assert.equal(buildLayout({ ...base, storeys: null, setup: { storeys: 3 } }).nStoreys, 3);
});

test('rear extension: new room sits beyond the rear wall with the typed size', () => {
  const m = buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 1, depthM: 4, heightM: 3, widthM: null } });
  const r = byId(m, 'new-ext-0');
  assert.equal(r.isNew, true);
  assert.equal(r.areaM2, 22);                  // 5.5 x 4
  assert.ok(r.poly.every(([, y]) => y >= 9));
  assert.ok(r.ceilingM > 2.5 && r.ceilingM < 2.7);   // 3 m overall minus roof build-up
});

test('existing extension outside the outline pushes the new work further back', () => {
  const m = buildLayout({ ...base, existing: { present: true, depthM: 2, inOutline: false }, proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 } });
  assert.ok(byId(m, 'new-ext-0').poly.every(([, y]) => y >= 11));
  assert.equal(m.shell.exOutsideDepthM, 2);
});

test('existing extension inside the outline shrinks the first floor above it', () => {
  const m = buildLayout({ ...base, existing: { present: true, depthM: 3, inOutline: true } });
  assert.ok(byId(m, 'ex-g-ext'));
  const upper = m.rooms.filter((r) => r.storey === 1);
  assert.ok(Math.max(...upper.flatMap((r) => r.poly.map((p) => p[1]))) <= 6.01);
});

test('two-storey extension: the first-floor room is a bedroom and the checks measure it', () => {
  const m = buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 2, depthM: 3, heightM: 5.6, widthM: 2.5, alignment: 'center' } });
  const up = byId(m, 'new-ext-1');
  assert.equal(up.type, 'bedroom'); assert.equal(up.storey, 1);
  assert.equal(up.areaM2, 7.5);
  const c = interiorChecks(m);
  assert.ok(c.some((x) => x.id === 'bed-size-new-ext-1' && x.status === 'info'), 'exactly 7.5 m2 and 2.5 m wide: single, not double');
  assert.ok(c.some((x) => x.id === 'escape-window'));
});

test('a small first-floor extension bedroom is flagged against the single bedroom size', () => {
  const m = buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 2, depthM: 2, heightM: 5.6, widthM: 2 } });
  const c = interiorChecks(m).find((x) => x.id === 'bed-size-new-ext-1');
  assert.equal(c.status, 'warn');
});

test('a low extension warns about ceiling height; a tall one does not', () => {
  const low = interiorChecks(buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 2.6 } }));
  assert.ok(low.some((x) => /ceiling-new-ext-0/.test(x.id) && x.status === 'warn'));
  const ok = interiorChecks(buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3.2 } }));
  assert.ok(!ok.some((x) => /ceiling-/.test(x.id)));
});

test('head height under a pitched roof follows the slope; areas are counted from 1.5 m', () => {
  assert.ok(Math.abs(headAt(1, 9, 45) - 1) < 1e-9);
  assert.ok(Math.abs(headAt(8, 9, 45) - 1) < 1e-9);
  const hr = loftHeadroom({ W: 5.5, D: 9, pitchDeg: 45 });
  // band with head >= 1.5 m is y in [1.5, 7.5]: 6 m x 5.5 m = 33 m2
  assert.ok(Math.abs(hr.over1_5 - 33) < 0.6, String(hr.over1_5));
  assert.ok(hr.over2_0 < hr.over1_5 && hr.over2_3 < hr.over2_0);
});

test('a dormer raises the head height over its footprint, so the usable loft area grows', () => {
  const plain = loftHeadroom({ W: 5.5, D: 9, pitchDeg: 35 });
  const withDormer = loftHeadroom({ W: 5.5, D: 9, pitchDeg: 35, dormer: { x0: 1, x1: 4.5, y0: 6.5, heightM: 2.3 } });
  assert.ok(withDormer.over2_2 > plain.over2_2 + 3);
});

test('loft dormer: room is created at the top, floor is above 4.5 m so the protected stairway warning shows', () => {
  const m = buildLayout({ ...base, proposal: { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 } });
  const loft = byId(m, 'new-loft');
  assert.ok(loft && loft.isNew && loft.slopedCeiling);
  assert.equal(loft.storey, 2);
  assert.equal(m.storeys.at(-1).label, 'Loft');
  const c = interiorChecks(m);
  const fire = c.find((x) => x.id === 'fire-protected-stair');
  assert.equal(fire.status, 'warn'); assert.match(fire.message, /protected stairway/);
  assert.ok(c.some((x) => x.id === 'loft-stair'));
  assert.ok(c.some((x) => /^head-/.test(x.id)));
});

test('dormer on a flat roof: no loft is drawn and the reason is given', () => {
  const m = buildLayout({ ...base, roofType: 'Flat', proposal: { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 } });
  assert.ok(!byId(m, 'new-loft'));
  assert.ok(m.assumptions.some((a) => /flat or unknown/.test(a)));
});

test('LiDAR roof heights set the pitch; without them the pitch is assumed and said so', () => {
  const lidar = { status: 'ok', roofShape: 'pitched', eavesM: 5.2, ridgeM: 7.2 };
  const withL = buildLayout({ ...base, lidar });
  assert.equal(withL.roof.source, 'lidar');
  assert.ok(Math.abs(withL.roof.pitchDeg - (Math.atan(2 / 4.5) * 180) / Math.PI) < 0.2);
  const without = buildLayout(base);
  assert.equal(without.roof.source, 'assumed');
  assert.ok(without.assumptions.some((a) => /pitch assumed/.test(a)));
});

test('additional storey: new rooms on the next floor, roof raised by one storey height', () => {
  const plain = buildLayout(base);
  const m = buildLayout({ ...base, proposal: { type: 'additional_storey' } });
  assert.ok(m.rooms.filter((r) => r.isNew).every((r) => r.storey === 2));
  assert.ok(Math.abs(m.roof.eavesM - plain.roof.eavesM - 2.65) < 0.01);
  assert.ok(interiorChecks(m).some((x) => x.id === 'storey-structure'));
});

test('porch, side extension, wraparound and outbuilding all produce one new room with the right area', () => {
  const porch = buildLayout({ ...base, proposal: { type: 'front_porch', widthM: 1.6, depthM: 1.5, heightM: 2.8 } });
  assert.equal(byId(porch, 'new-porch').areaM2, 2.4);
  assert.ok(byId(porch, 'new-porch').poly.every(([, y]) => y <= 0));
  const side = buildLayout({ ...base, form: 'semi', proposal: { type: 'side_extension', side: 'right', widthM: 2.5, heightM: 3, storeys: 1 } });
  assert.equal(byId(side, 'new-side-0').areaM2, 22.5);   // 2.5 x 9
  assert.ok(byId(side, 'new-side-0').poly.every(([x]) => x >= 5.5));
  const wrap = buildLayout({ ...base, proposal: { type: 'wraparound_extension', side: 'right', depthM: 3, widthM: 2.5, heightM: 3 } });
  assert.equal(byId(wrap, 'new-wrap-0').poly.length, 6);
  const out = buildLayout({ ...base, proposal: { type: 'outbuilding', widthM: 3, depthM: 4, heightM: 2.5, setbackM: 5 } });
  assert.equal(byId(out, 'new-outbuilding').areaM2, 12);
  assert.ok(interiorChecks(out).some((x) => x.id === 'outbuilding-use'));
});

test('drawn shape is converted through the frame and placed in house coordinates', () => {
  const ring = [[-1, 0], [1, 0], [1, 3], [-1, 3]];       // s,d directly (test frame is identity)
  const m = buildLayout({ ...base, ringToSD: (r) => r, proposal: { type: 'custom_polygon', ring, treatAs: 'rear_extension', heightM: 3 } });
  const r = byId(m, 'new-drawn');
  assert.equal(r.areaM2, 6);
  assert.ok(r.poly.every(([, y]) => y >= 9 && y <= 12));
});

test('applicant edits: rename / retype a room, hall on the right mirrors the plan, loft use', () => {
  const m = buildLayout({ ...base, setup: { hallSide: 'right', rooms: { 'ex-1-bed2': { name: 'Nursery' }, 'ex-g-dining': { type: 'study' } } } });
  assert.equal(byId(m, 'ex-1-bed2').name, 'Nursery');
  assert.equal(byId(m, 'ex-g-dining').type, 'study');
  assert.ok(byId(m, 'ex-g-hall').poly.every(([x]) => x >= 5.5 - 0.96));
  const l = buildLayout({ ...base, setup: { loftUse: 'storage' }, proposal: { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 } });
  assert.equal(byId(l, 'new-loft').type, 'storage');
  assert.ok(!interiorChecks(l).some((x) => /^bed-size/.test(x.id)));
});

test('buildInterior: wraps layout, converts the plot and neighbours, and fails soft', () => {
  const ok = buildInterior({
    frame: frameOf(), profile: profile(), proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, form: 'terraced',
    plotRings: [[[-3, -4], [3, -4], [3, 20], [-3, 20], [-3, -4]]],
    neighbours: [{ ring: [[3, 0], [8, 0], [8, 9], [3, 9], [3, 0]] }, { ring: [[500, 500], [510, 500], [510, 510], [500, 510], [500, 500]] }],
  });
  assert.equal(ok.available, true);
  assert.equal(ok.context.plot.length, 1);
  assert.equal(ok.context.neighbours.length, 1, 'a far-away building is dropped');
  assert.ok(ok.totals.newFloorM2 > 0 && ok.disclaimer);
  // plot corner (-3,-4) in (s,d) -> x = s + W/2 = -0.25, y = d + D = 5
  assert.deepEqual(ok.context.plot[0][0], [-0.25, 5]);

  assert.equal(buildInterior({ frame: { ...frameOf(), synthetic: true }, profile: profile(), proposal: null }).available, false);
  assert.equal(buildInterior({ frame: null, profile: profile(), proposal: null }).available, false);
  assert.equal(buildInterior({ frame: frameOf(), profile: profile(), proposal: { type: 'rear_extension', depthM: 3 }, setup: { rooms: 5 } }).available, true);
});

import { layoutProblems, selfIntersects } from '../src/services/interior/geometry.js';
const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const drawnLayout = {
  storeys: [
    { index: 0, rooms: [{ id: 'u-0-1', name: 'Lounge', type: 'living', poly: R(0, 0, 5.5, 4) }, { id: 'u-0-2', name: 'Kitchen', type: 'kitchen', poly: R(0, 4, 5.5, 9) }] },
    { index: 1, rooms: [{ id: 'u-1-1', name: 'Big bedroom', type: 'bedroom', poly: R(0, 0, 5.5, 9) }] },
  ],
};

test('geometry: bow-tie shapes, tiny rooms and rooms outside the outline are reported in plain words', () => {
  assert.equal(selfIntersects(R(0, 0, 2, 2)), false);
  assert.equal(selfIntersects([[0, 0], [2, 2], [2, 0], [0, 2]]), true);
  assert.deepEqual(layoutProblems(drawnLayout, 5.5, 9), []);
  const bad = { storeys: [{ index: 0, rooms: [
    { id: 'a-1', name: 'Bow', type: 'other', poly: [[0, 0], [2, 2], [2, 0], [0, 2]] },
    { id: 'b-2', name: 'Tiny', type: 'other', poly: R(0, 0, 0.5, 0.5) },
    { id: 'c-3', name: 'Away', type: 'other', poly: R(10, 10, 12, 12) },
  ] }] };
  const p = layoutProblems(bad, 5.5, 9).join(' ');
  assert.match(p, /Bow: its walls cross/); assert.match(p, /Tiny: smaller/); assert.match(p, /Away: reaches outside/);
});

test('a drawn layout replaces the typical one: rooms are not assumed, storeys follow the drawing, checks still judge only new rooms', () => {
  const m = buildLayout({ ...base, storeys: 3, setup: { layout: drawnLayout } });
  assert.equal(m.nStoreys, 2);
  assert.ok(m.rooms.every((r) => !r.assumed && r.userDrawn));
  assert.equal(byId(m, 'u-1-1').name, 'Big bedroom');
  assert.ok(m.assumptions.some((a) => /as you drew them/.test(a)));
  assert.deepEqual(interiorChecks(m), []);
});

test('drawn layout + extra storey copies the top floor; + dormer sits on top of the drawn floors', () => {
  const up = buildLayout({ ...base, setup: { layout: drawnLayout }, proposal: { type: 'additional_storey' } });
  assert.deepEqual(up.rooms.filter((r) => r.isNew).map((r) => [r.storey, r.areaM2]), [[2, 49.5]]);
  const loft = buildLayout({ ...base, setup: { layout: drawnLayout }, proposal: { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 } });
  assert.equal(byId(loft, 'new-loft').storey, 2);
});

test('buildInterior passes the drawn layout through', () => {
  const r = buildInterior({ frame: frameOf(), profile: profile(), proposal: null, setup: { layout: drawnLayout } });
  assert.equal(r.available, true); assert.equal(r.rooms.length, 3);
});

import { overlapM2 } from '../src/services/interior/geometry.js';
const withFeatures = (floor1 = {}, floor0 = {}) => ({
  storeys: [
    { ...drawnLayout.storeys[0], ...floor0 },
    { ...drawnLayout.storeys[1], ...floor1 },
  ],
});
const win = (id, a, b, o = {}) => ({ id, kind: 'window', a, b, ...o });
const door = (id, a, b) => ({ id, kind: 'door', a, b });
const status = (checks, id) => checks.find((c) => c.id === id)?.status;

test('overlap: rooms that share a wall do not overlap; rooms on top of each other do', () => {
  assert.equal(overlapM2(R(0, 0, 2, 2), R(2, 0, 4, 2)), 0);
  assert.ok(Math.abs(overlapM2(R(0, 0, 2, 2), R(1, 1, 3, 3)) - 1) < 0.05);
  assert.equal(overlapM2(R(0, 0, 1, 1), R(5, 5, 6, 6)), 0);
});

test('validation: overlapping rooms, openings off a wall and stairs outside the house are named', () => {
  const lay = { storeys: [{ index: 0, rooms: [
    { id: 'u-0-1', name: 'Lounge', type: 'living', poly: R(0, 0, 3, 4) },
    { id: 'u-0-2', name: 'Den', type: 'study', poly: R(2, 0, 5, 4) },
  ], openings: [win('w-1', [1, 2], [2, 2])], stairs: [{ id: 's-1', dir: '+y', poly: R(5, 8, 7, 11) }] }] };
  const p = layoutProblems(lay, 5.5, 9).join(' ');
  assert.match(p, /Lounge and Den overlap by 4 m²/);
  assert.match(p, /window on floor 0 is not on a wall/);
  assert.match(p, /stair on floor 0 reaches outside/);
  assert.deepEqual(layoutProblems(withFeatures({}, { openings: [win('w-1', [1, 0], [2.2, 0])] }), 5.5, 9), []);
});

test('openings attach to the rooms on their wall; one that lost its wall is dropped and said so', () => {
  const m = buildLayout({ ...base, setup: { layout: withFeatures({}, { openings: [door('d-1', [2, 4], [2.9, 4]), win('w-1', [1, 0], [2.2, 0]), win('w-2', [1, 20], [2, 20])] }) } });
  assert.equal(m.openings.length, 2);
  const d = m.openings.find((o) => o.id === 'd-1');
  assert.deepEqual(d.roomIds.sort(), ['u-0-1', 'u-0-2'], 'a door between two rooms belongs to both');
  assert.equal(m.openings.find((o) => o.id === 'w-1').headM, 2.1);
  assert.ok(m.assumptions.some((a) => /no longer sit on a wall/.test(a)));
});

test('stairs: step count, going and pitch follow the floor-to-floor height', () => {
  const ok = buildLayout({ ...base, setup: { layout: withFeatures({}, { stairs: [{ id: 's-1', dir: '+y', poly: R(0, 0, 0.9, 3) }] }) } }).stairs[0];
  assert.equal(ok.steps, 13); assert.equal(ok.goingM, 0.25); assert.ok(ok.pitchDeg < 42);
  const steep = buildLayout({ ...base, setup: { layout: withFeatures({}, { stairs: [{ id: 's-1', dir: '+y', poly: R(0, 0, 0.9, 2) }] }) } }).stairs[0];
  assert.ok(steep.goingM < 0.22 && steep.pitchDeg > 42);
  const side = buildLayout({ ...base, setup: { layout: withFeatures({}, { stairs: [{ id: 's-1', dir: '-x', poly: R(0, 0, 3, 0.9) }] }) } }).stairs[0];
  assert.equal(side.lengthM, 3); assert.equal(side.widthM, 0.9);
});

test('checks: a stair that is too steep warns; one with room passes; the floor above covering the stair warns about head height', () => {
  const prop = { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 };
  const mk = (stair) => interiorChecks(buildLayout({ ...base, proposal: prop, setup: { layout: withFeatures({}, { stairs: [stair] }) } }));
  assert.equal(status(mk({ id: 's-1', dir: '+y', poly: R(0, 0, 0.9, 2) }), 'stair-s-1'), 'warn');
  const good = mk({ id: 's-1', dir: '+y', poly: R(0, 0, 0.9, 3) });
  assert.equal(status(good, 'stair-s-1'), 'pass');
  assert.equal(status(good, 'stair-head-s-1'), 'warn', 'the drawn first-floor bedroom covers the whole stair');
  // leave a stairwell: first floor drawn around it
  const around = interiorChecks(buildLayout({ ...base, proposal: prop, setup: { layout: { storeys: [
    { ...drawnLayout.storeys[0], stairs: [{ id: 's-1', dir: '+y', poly: R(0, 0, 0.9, 3) }] },
    { index: 1, rooms: [{ id: 'u-1-1', name: 'Bedroom', type: 'bedroom', poly: R(0.9, 0, 5.5, 9) }, { id: 'u-1-2', name: 'Landing', type: 'landing', poly: R(0, 3.2, 0.9, 9) }] },
  ] } } }));
  assert.equal(status(around, 'stair-head-s-1'), undefined);
});

test('checks: escape window, ventilation and doors on a new first-floor bedroom', () => {
  const prop = { type: 'rear_extension', storeys: 2, depthM: 3.5, heightM: 5.6, widthM: 3, alignment: 'center' };   // bedroom x 1.25..4.25, y 9..12.5
  const run = (openings) => interiorChecks(buildLayout({ ...base, proposal: prop, setup: { layout: withFeatures({ openings }) } }));
  const none = run([win('w-0', [0.5, 0], [1.7, 0])]);
  assert.equal(status(none, 'door-new-ext-1'), 'warn');
  assert.equal(status(none, 'escape-new-ext-1'), 'warn');
  assert.match(none.find((c) => c.id === 'escape-new-ext-1').message, /no window drawn/);
  const good = run([door('d-1', [2, 9], [2.9, 9]), win('w-1', [1.5, 12.5], [2.9, 12.5], { sillM: 0.9, heightM: 1.2 })]);
  assert.equal(status(good, 'escape-new-ext-1'), 'pass');
  assert.equal(status(good, 'door-new-ext-1'), undefined);
  assert.equal(status(good, 'vent-new-ext-1'), 'pass');
  const high = run([door('d-1', [2, 9], [2.9, 9]), win('w-1', [1.5, 12.5], [2.9, 12.5], { sillM: 1.4, heightM: 1.0 })]);
  assert.match(high.find((c) => c.id === 'escape-new-ext-1').message, /none of its windows/);
  const fixed = run([door('d-1', [2, 9], [2.9, 9]), win('w-1', [1.5, 12.5], [2.9, 12.5], { fixed: true })]);
  assert.equal(status(fixed, 'escape-new-ext-1'), 'warn');
  assert.equal(status(fixed, 'vent-new-ext-1'), 'warn');
});

test('checks: without any drawn openings the old reminders stay, and nothing claims a door or window is missing', () => {
  const c = interiorChecks(buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 2, depthM: 3.5, heightM: 5.6, widthM: 3 } }));
  assert.ok(c.some((x) => x.id === 'escape-window'));
  assert.ok(!c.some((x) => /^(door|vent)-|^escape-new/.test(x.id)));
});

test('checks: loft stair head height, and a missing loft stair when other stairs are drawn', () => {
  const dormer = { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 };
  const mk = (stairs1, stairs0 = []) => interiorChecks(buildLayout({ ...base, proposal: dormer, setup: { layout: withFeatures({ stairs: stairs1 }, { stairs: stairs0 }) } }));
  assert.equal(status(mk([{ id: 's-1', dir: '+y', poly: R(0, 2, 0.9, 5) }]), 'loft-stair-head-s-1'), 'pass');
  assert.equal(status(mk([{ id: 's-1', dir: '+y', poly: R(0, 4, 0.9, 7) }]), 'loft-stair-head-s-1'), 'warn');
  assert.equal(status(mk([], [{ id: 's-0', dir: '+y', poly: R(0, 0, 0.9, 3) }]), 'stair-missing'), 'warn');
  assert.ok(mk([]).some((x) => x.id === 'loft-stair'), 'no stairs drawn at all: still the reminder');
});

test('checks: a drawn room overlapping the proposal is flagged', () => {
  const lay = { storeys: [{ index: 0, rooms: [{ id: 'u-0-1', name: 'Kitchen', type: 'kitchen', poly: R(0, 0, 5.5, 10) }] }] };
  const c = interiorChecks(buildLayout({ ...base, proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, setup: { layout: lay } }));
  assert.ok(c.some((x) => /^overlap-/.test(x.id) && x.status === 'warn'));
});
