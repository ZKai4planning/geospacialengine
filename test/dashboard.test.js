import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, PLACEHOLDERS } from '../src/services/dashboard.js';
import { publicStrips } from '../src/services/publicStrip.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const pt = (kind, label, [x, y], id) => { const [lng, lat] = ll([x, y]); return { id, kind, label, lng, lat }; };

const plot = ring(box(0, -24, 5, 0)), house = ring(box(0, -10, 5, -2)), work = ring(box(1, -16, 4, -10));
const road = { id: 'r', name: 'Manor Road', widthM: 5, widthSource: 'assumed', ignore: false, classLabel: 'B road (B112)', line: [[-20, 8], [30, 8]].map(ll) };
const pave = { id: 'p1', kind: 'pavement', label: 'Pavement', widthM: 2, widthSource: 'assumed', line: [[-20, 3], [30, 3]].map(ll) };
const base = {
  subjectRing: house, subjectKind: 'house', houseRing: house, plotRings: [plot], frontBearingDeg: 0, roads: [road], strips: publicStrips({ plotRings: [plot], roads: [road] }),
  pathways: [pave, { id: 'p2', kind: 'crossing', label: 'Crossing', widthM: 3, line: [[10, 0], [10, 6]].map(ll) }],
  obstacles: [{ ...pt('post_box', 'Post box', [8, 4], 'o1') }, pt('post_box', 'Post box', [20, 4], 'o2'), pt('lamp', 'Street lamp', [9, 1], 'o3'), pt('pole', 'Electricity / telephone pole', [6, 3], 'o4'), pt('dropped_kerb', 'Dropped kerb', [2, 2], 'o5')],
  powerLines: [{ id: 'l1', kind: 'minor_line', label: 'Overhead power line', voltage: '11000', line: [[-20, 6], [30, 6]].map(ll) }],
  trees: [pt('tree', 'Tree', [12, -5], 't1')], protectedTreeCount: 1, tpoZoneCount: 0,
  neighbours: [{ ring: ring(box(5, -10, 10, -2)) }, { ring: ring(box(60, -10, 70, -2)) }], outbuildings: [{ ring: ring(box(1, -20, 3, -18)), areaM2: 4 }], areas: [], siteChecks: null,
};
const tiles = (d) => Object.fromEntries(d.sections.flatMap((s) => s.tiles).map((t) => [t.id, t]));

test('dashboard: road, public strip, frontage, pavement and crossings are measured and labelled with their source', () => {
  const d = buildDashboard(base), t = tiles(d);
  assert.deepEqual([t.road.value, t.road.sub], ['Manor Road', 'B road (B112)']);
  assert.equal(t['road-width'].value, '5 m'); assert.match(t['road-width'].sub, /assumed/);
  assert.equal(t['road-dist'].value, '7.5 m'); assert.match(t['road-dist'].label, /from the house/);          // house wall y=-2 to the carriageway edge y=5.5
  assert.equal(t.strip.value, '5.5 m'); assert.equal(t.frontage.value, '5 m');
  assert.equal(t.pavement.value, '2 m wide'); assert.match(t.pavement.sub, /Nearest is 4 m from the house; assumed/);
  assert.equal(t.crossings.value, '1'); assert.equal(t.dropped.value, '1');
});

test('dashboard: street furniture counted with the nearest distance; cables and poles; "none" is info, never a pass', () => {
  const t = tiles(buildDashboard(base));
  assert.equal(t.post_box.value, '2'); assert.match(t.post_box.sub, /Nearest 6\.0 m from the house|Nearest [\d.]+ m from the house/);
  assert.equal(t.lamp.value, '1'); assert.equal(t.pole.value, '1');
  assert.equal(t.cables.value, '1 line'); assert.match(t.cables.sub, /overhead power line \(11000 V\)/); assert.match(t.cables.sub, /network operator/);
  assert.equal(t.poles.value, '1');
  assert.ok(!('hydrant' in t) && !('bollard' in t) && !('pylon' in t), 'rare kinds are listed only when present');
  const none = tiles(buildDashboard({ ...base, obstacles: [], powerLines: [], pathways: [] }));
  assert.equal(none.post_box.value, '0'); assert.equal(none.post_box.status, 'info'); assert.match(none.post_box.sub, /coverage is incomplete/);
  assert.equal(none.cables.value, 'None mapped'); assert.equal(none.cables.status, 'info'); assert.equal(none.pavement.value, 'None mapped');
});

test('dashboard: things in the way are flagged "check" using the site checks', () => {
  const siteChecks = { publicLand: { status: 'on_public_land' }, street: { crossesRow: false, obstacles: [{ id: 'o1', status: 'blocked' }, { id: 'o3', status: 'clear' }, { id: 'o4', status: 'near' }], powerLines: [{ id: 'l1', status: 'over' }] }, areas: [] };
  const t = tiles(buildDashboard({ ...base, siteChecks }));
  assert.equal(t.post_box.status, 'check'); assert.equal(t.lamp.status, 'ok'); assert.equal(t.pole.status, 'check'); assert.equal(t.cables.status, 'check'); assert.equal(t.strip.status, 'check');
});

test('dashboard: boundaries measured from the work when there is one; no numbers from an estimated outline', () => {
  const d = buildDashboard({ ...base, subjectRing: work, subjectKind: 'proposal' }), t = tiles(d);
  assert.equal(d.subjectKind, 'proposal'); assert.match(t.rear.label, /from the proposed work/);
  assert.equal(t.rear.value, '8 m'); assert.equal(t.side.value, '1 m'); assert.equal(t.front.value, '10 m');
  const est = tiles(buildDashboard({ ...base, plotEstimated: true }));
  assert.equal(est.boundary.status, 'na'); assert.match(est.boundary.sub, /only an estimate/); assert.ok(!est.rear);
  const noFront = tiles(buildDashboard({ ...base, frontBearingDeg: null }));
  assert.equal(noFront.rear.value, 'Not available'); assert.match(noFront.rear.sub, /direction the house faces/);
});

test('dashboard: neighbours, outbuildings, trees and constraint outlines', () => {
  const t = tiles(buildDashboard({ ...base, areas: [{ id: 'a1', label: 'Conservation area' }, { id: 'a2', label: 'Flood zone 2' }], siteChecks: { areas: [{ id: 'a1', status: 'inside' }, { id: 'a2', status: 'near' }] } }));
  assert.equal(t.neighbours.value, '1'); assert.match(t.neighbours.sub, /touching: party wall/); assert.equal(t.neighbours.status, 'check');
  assert.equal(t.outbuildings.value, '1'); assert.match(t.outbuildings.sub, /4 m²/);
  assert.equal(t.trees.value, '1'); assert.match(t.trees.sub, /1 protected tree/); assert.equal(t.trees.status, 'check');
  assert.equal(t.constraints.value, '1 inside, 1 within 100 m'); assert.match(t.constraints.sub, /Inside: Conservation area\. Near: Flood zone 2/); assert.equal(t.constraints.status, 'check');
});

test('dashboard: placeholders for what cannot be had yet say what data they need; no house = placeholders only', () => {
  const d = buildDashboard(base), later = d.sections.find((s) => s.id === 'later');
  assert.deepEqual(later.tiles.map((t) => t.id), ['sewers', 'roof-height', 'ground', 'coal', 'floor-plans']);
  assert.ok(later.tiles.every((t) => t.status === 'na' && t.value === 'Not available yet' && t.sub.length > 20));
  assert.equal(tiles(d)['underground'].status, 'na');                                         // also placed with the cables
  const empty = buildDashboard({ subjectRing: null });
  assert.deepEqual(empty.sections.map((s) => s.id), ['later']); assert.equal(empty.sections[0].tiles.length, PLACEHOLDERS.length);
});

test('flow: the dashboard is part of the map from the first look, measured from the house, then from the work', async () => {
  process.env.MOCK_PROVIDERS = 'true';
  const { createContainer } = await import('../src/container.js');
  const { createMockProviders } = await import('../src/providers/mock.js');
  const b = createMockProviders(), svc = createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null }, db: null }).applicationService;
  let app = await svc.create({ id: '1234567890' });
  assert.equal(app.map.dashboard.subjectKind, 'house');
  assert.deepEqual(app.map.dashboard.sections.map((s) => s.id), ['road', 'paths', 'furniture', 'cables', 'site', 'later']);
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.equal(app.map.dashboard.subjectKind, 'proposal');
  const t = tiles(app.map.dashboard);
  assert.ok(t.neighbours && t.trees && t.constraints && t.cables && t.post_box && t.pavement && t.road);
  assert.match(t.constraints.sub, /Conservation area|Article 4/);                              // the mock site sits inside the mock outlines
  assert.ok(app.map.dashboard.sections.flatMap((s) => s.tiles).every((x) => x.label && x.value != null && x.sub && ['ok', 'check', 'info', 'na'].includes(x.status)));
});
