import test from 'node:test';
import assert from 'node:assert/strict';
import { splitOutbuildings, boundaryDistances, curtilageCover, autoFacts } from '../src/services/siteFacts.js';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { classifyProject } from '../src/services/projectClassifier.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { buildMap } from '../src/services/mapService.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
// plot 5 m wide, 24 m deep: front (road side) at y=0 facing NORTH (bearing 0), rear boundary at y=-24
const plot = ring([[0, -24], [5, -24], [5, 0], [0, 0]]);
const house = ring([[0, -10], [5, -10], [5, -2], [0, -2]]);
const shed = ring([[1, -20], [3, -20], [3, -18], [1, -18]]);              // 4 m² shed in the garden
const neighbour = ring([[6, -10], [11, -10], [11, -2], [6, -2]]);        // next door, outside the plot

test('buildings inside a registered plot are the owner\'s outbuildings; next door stays a neighbour', () => {
  const { own, others } = splitOutbuildings({ plotRings: [plot], neighbours: [{ ring: shed }, { ring: neighbour }] });
  assert.equal(own.length, 1); assert.equal(own[0].areaM2, 4); assert.equal(others.length, 1);
  assert.equal(splitOutbuildings({ plotRings: null, neighbours: [{ ring: shed }] }).others.length, 1, 'no registered plot = nothing is reclassified');
});

test('distance to the rear / side / front boundary depends on which way each boundary faces', () => {
  const work = ring([[1, -14], [4, -14], [4, -10], [1, -10]]);                  // rear extension behind the house
  const d = boundaryDistances({ plotRings: [plot], proposalRing: work, frontBearingDeg: 0 });
  assert.equal(d.rearM, 10);                                                    // -14 to -24
  assert.equal(d.sideM, 1);                                                     // 1 m from the west boundary
  assert.equal(d.frontM, 10);                                                   // -10 to 0
  assert.equal(d.nearestM, 1);
  // an ASYMMETRIC case, so front and rear cannot be swapped without a test failing: work near the rear boundary, far from the front
  const deep = ring([[1, -20], [4, -20], [4, -12], [1, -12]]);
  const a = boundaryDistances({ plotRings: [plot], proposalRing: deep, frontBearingDeg: 0 });                 // house faces north: front boundary y=0, rear y=-24
  assert.deepEqual([a.rearM, a.frontM, a.sideM], [4, 12, 1]);
  const b = boundaryDistances({ plotRings: [plot], proposalRing: deep, frontBearingDeg: 180 });               // house faces south: the roles swap
  assert.deepEqual([b.rearM, b.frontM], [12, 4]);
  const e = boundaryDistances({ plotRings: [plot], proposalRing: ring([[1, -20], [4, -20], [4, -12], [1, -12]].map(([x, y]) => [x, y])), frontBearingDeg: 90 });   // house faces east: the x=5 boundary is the front
  assert.deepEqual([e.frontM, e.rearM], [1, 1]);
  const flipped = boundaryDistances({ plotRings: [plot], proposalRing: work, frontBearingDeg: 180 });
  assert.equal(flipped.rearM, 10); assert.equal(flipped.frontM, 10);            // front/back swapped, symmetric here
  assert.equal(boundaryDistances({ plotRings: [plot], proposalRing: work, frontBearingDeg: null }).rearM, null, 'no front bearing = no rear/side split');
  assert.equal(boundaryDistances({ plotRings: [plot], proposalRing: ring([[4, -14], [8, -14], [8, -10], [4, -10]]), frontBearingDeg: 0 }), null, 'work outside the plot: the boundary rule reports it');
});

test('curtilage cover follows the GPDO definition (everything except the original house)', () => {
  assert.deepEqual(curtilageCover({ plotAreaM2: 120, houseM2: 40, outbuildingsM2: 10, proposalM2: 30 }), { additionsM2: 40, curtilageM2: 80, pct: 50 });
  assert.equal(curtilageCover({ plotAreaM2: null, houseM2: 40 }), null);
});

test('autoFacts fills only EMPTY fields, only from a registered title, and says what it filled', () => {
  const b = { rearM: 10, sideM: 1, frontM: 10, nearestM: 1 };
  const a = autoFacts({ type: 'rear_extension' }, { boundary: b, additionsAreaM2: 22 }, { registered: true });
  assert.deepEqual(a.fields, { distanceToSideBoundaryM: 1, distanceToRearBoundaryM: 10, additionsAreaM2: 22 });
  assert.deepEqual(autoFacts({ type: 'rear_extension', distanceToSideBoundaryM: 3 }, { boundary: b }, { registered: true }).fields, { distanceToRearBoundaryM: 10 }, 'the applicant\'s own answer wins');
  assert.deepEqual(autoFacts({ type: 'rear_extension' }, { boundary: b, additionsAreaM2: 22 }, { registered: false }).names, [], 'an estimated outline never produces a number');
  assert.equal(autoFacts({ type: 'outbuilding' }, { boundary: b }, { registered: true }).fields.distanceToBoundaryM, 1);
});

test('the classifier treats auto-measured facts as known, not as questions', () => {
  const profile = { originalDwelling: { value: null }, existingExtension: { present: null } };
  const p = { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3, distanceToSideBoundaryM: 1, _auto: ['distanceToSideBoundaryM'] };
  const q = classifyProject({ proposal: p, profile }).questions.find((x) => x.fact === 'eavesHeightM');
  assert.equal(q.status, 'needed');                                             // 1 m from a boundary: eaves ARE needed now
  const known = classifyProject({ proposal: p, profile }).questions.find((x) => x.fact === 'distanceToSideBoundaryM');
  assert.equal(known?.status ?? 'known', 'known');
});

test('regulatory reminders: building regs always; party wall within 3 m / on the boundary; fire within 1 m; CIL at 100 m²; sewer not checked', () => {
  const run = (prop, neigh = [], proposalInfo = {}) => runSiteChecks({ proposalRing: ring(prop), houseRing: house, plot: { ring: plot, areaM2: 120, estimated: false }, neighbours: neigh.map((r, i) => ({ id: `n${i}`, ring: r })), proposalAbsolute: true, proposalInfo });
  const base = run([[1.5, -16], [3.5, -16], [3.5, -12], [1.5, -12]]);
  assert.deepEqual(base.regulatory.map((r) => r.id), ['building-regs', 'sewer']);
  const near = run([[1.5, -16], [3.5, -16], [3.5, -12], [1.5, -12]], [ring([[5.8, -16], [9, -16], [9, -12], [5.8, -12]])]);
  assert.ok(near.regulatory.some((r) => r.id === 'party-wall' && /within 3 m|About 2\.3 m/.test(r.message)));
  const edge = run([[0, -16], [3.5, -16], [3.5, -12], [0, -12]]);
  assert.ok(edge.regulatory.some((r) => r.id === 'party-wall' && /boundary/.test(r.message)) && edge.regulatory.some((r) => r.id === 'fire-boundary' && /fire-resistant/.test(r.message)));
  const close = run([[0.6, -16], [3.5, -16], [3.5, -12], [0.6, -12]]);
  assert.ok(close.regulatory.some((r) => r.id === 'fire-boundary' && /0\.6 m from the boundary/.test(r.message)));
  const big = runSiteChecks({ proposalRing: ring([[0.5, -24], [4.5, -24], [4.5, -2], [0.5, -2]].map(([x, y]) => [x, y])), houseRing: house, plot: { ring: plot, areaM2: 120, estimated: false }, proposalAbsolute: true, proposalInfo: { storeys: 2 } });
  assert.ok(big.regulatory.some((r) => r.id === 'cil'));
  assert.ok(!base.regulatory.some((r) => r.id === 'cil'));
});

test('buildMap: outbuildings in a registered plot are drawn as the owner\'s, not flagged as a neighbour, and counted in the plot cover', () => {
  const m = buildMap({
    address: { lat: LAT, lng: LNG }, footprint: { ring: house, source: 'osm', areaM2: 40 }, plot: { ring: plot, areaM2: 120, estimated: false },
    neighbours: [{ ring: shed }, { ring: neighbour }], camera: null, profile: { existingExtension: null },
    roads: [[[-20, 8], [30, 8]].map(ll)], roadDetails: [{ name: 'Example Road', widthM: 5, widthSource: 'assumed', ignore: false, line: [[-20, 8], [30, 8]].map(ll) }],
    proposal: { type: 'rear_extension', widthM: 3, depthM: 3, heightM: 3, storeys: 1 },
  });
  assert.equal(m.layers.filter((l) => l.kind === 'outbuilding').length, 1);
  assert.equal(m.layers.filter((l) => l.kind === 'neighbour').length, 1);
  assert.equal(m.siteFacts.outbuildingsM2, 4);
  assert.ok(m.siteFacts.curtilage.additionsM2 >= 4 + 8);                           // shed + the extension
  assert.equal(m.frame.frontBearingDeg, 0);                                       // the road is north, so the garden is behind
  assert.ok(m.siteFacts.boundary && m.siteFacts.boundary.rearM > 5 && m.siteFacts.boundary.sideM === 1);   // 3 m wide extension centred in a 5 m plot
  assert.ok(m.siteChecks.regulatory.some((r) => r.id === 'building-regs'));
});

test('end to end: boundary distance measured from the plan reaches the PD rule (eaves within 2 m of a boundary need a height)', () => {
  const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', storeys: 1, depthM: 2, widthM: 3, heightM: 3, distanceToSideBoundaryM: 1, _auto: ['distanceToSideBoundaryM'] }, existingExtensionDepthM: 0, plotAreaM2: 120 });
  assert.ok(a.checks.some((c) => c.id === 'eaves'), 'the eaves rule ran because the distance was known');
});

// ---- 45-degree rule ----
import { fortyFiveTest } from '../src/services/fortyFive.js';
import { assessLpa } from '../src/services/lpaPolicy.js';

test('45-degree test: depth allowed grows with the sideways distance from the window', () => {
  // garden lies SOUTH (rear bearing 180). Neighbour window at the origin, on the back wall plane (y = 0). Extension to the EAST of it.
  const box = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const ok = fortyFiveTest({ P: box(3, 6, 0, -2.5), window: [0, 0], rearBearingDeg: 180 });
  assert.equal(ok.status, 'clear');                                       // 2.5 m deep, starts 3 m away: inside the line
  const bad = fortyFiveTest({ P: box(1, 4, 0, -4), window: [0, 0], rearBearingDeg: 180 });
  assert.equal(bad.status, 'breach'); assert.equal(bad.excessM, 3);        // corner at u=1 may go 1 m; goes 4 m
  assert.equal(fortyFiveTest({ P: box(-1, 2, 0, -1), window: [0, 0], rearBearingDeg: 180 }).status, 'breach', 'directly in front of the window nothing is allowed');
  const west = fortyFiveTest({ P: box(-6, -3, 0, -2.5), window: [0, 0], rearBearingDeg: 180 });
  assert.equal(west.status, 'clear'); assert.ok(west.dir[0] < 0 && west.dir[1] < 0, 'the line points towards the proposal, down the garden');
  assert.equal(fortyFiveTest({ P: box(1, 4, 3, 0), window: [0, 0], rearBearingDeg: 180 }).status, 'clear', 'work level with or behind the wall plane on the other side is not "beyond" it');
});

test('45-degree result reaches the site checks, and the council layer uses it instead of the generic note', () => {
  const plotR = ring([[0, -24], [5, -24], [5, 0], [0, 0]]);
  const r = runSiteChecks({
    proposalRing: ring([[1, -16], [4, -16], [4, -6], [1, -6]]), houseRing: ring([[0, -10], [5, -10], [5, -2], [0, -2]]), plot: { ring: plotR, areaM2: 120, estimated: false }, proposalAbsolute: true,
    fortyFive: { ...(() => { const [lng, lat] = ll([6, -10]); return { lng, lat }; })(), rearBearingDeg: 180 },   // neighbour's back-wall window, level with the back of the house (y = -10)
  });
  assert.equal(r.fortyFive.status, 'breach'); assert.equal(r.fortyFive.excessM, 4);   // 6 m beyond the wall at a corner 2 m from the window
  assert.ok(r.items.some((i) => i.status === 'warn' && /45-degree line/.test(i.message)));
  const none = runSiteChecks({ proposalRing: ring([[1, -16], [4, -16], [4, -6], [1, -6]]), houseRing: ring([[0, -10], [5, -10], [5, -2], [0, -2]]), plot: { ring: plotR, areaM2: 120, estimated: false }, proposalAbsolute: true });
  assert.equal(none.fortyFive.status, 'unavailable');
  const l = assessLpa({ authorityName: 'Waltham Forest', verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, plotAreaM2: 300, houseFootprintM2: 40, proposalAreaM2: 10, fortyFive: r.fortyFive });
  assert.ok(l.checks.some((c) => c.status === 'warn' && /45-degree line/.test(c.message)));
  assert.ok(!l.checks.some((c) => /45 degree rule/.test(c.message)), 'the generic "check it yourself" note is replaced');
  assert.equal(l.outlook, 'at_risk');
  const gen = assessLpa({ authorityName: 'Waltham Forest', verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, plotAreaM2: 300, houseFootprintM2: 40, proposalAreaM2: 10, fortyFive: { status: 'unavailable' } });
  assert.ok(gen.checks.some((c) => /45 degree rule/.test(c.message)));
});

test('a wall on the boundary line (terrace) still gets boundary distances, and one outside the line does not', () => {
  const onLine = ring([[0, -10], [5, -10], [5, -2], [0, -2]]);                       // west and east walls exactly on the plot sides
  const d = boundaryDistances({ plotRings: [plot], proposalRing: onLine, frontBearingDeg: 0 });
  assert.deepEqual([d.sideM, d.rearM, d.frontM], [0, 14, 2]);
  assert.equal(boundaryDistances({ plotRings: [plot], proposalRing: ring([[-1, -10], [5, -10], [5, -2], [-1, -2]]), frontBearingDeg: 0 }), null);
});
