import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame } from '../src/services/proposalGeometry.js';
import { buildMap } from '../src/services/mapService.js';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { estimatePlot, titleMatchesHouse, choosePlot } from '../src/utils/plotEstimate.js';
import { ringAreaM2, pointInRing } from '../src/utils/geo.js';

// local metres (x east, y north) -> lng/lat; the street runs east-west SOUTH of the house, so the house faces south
const LAT = 52.76, LNG = -0.68, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG + x / KX, LAT + y / KY];
const toXY = ([lng, lat]) => [(lng - LNG) * KX, (lat - LAT) * KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const road = (y, widthM = 5.5, extra = {}) => ({ widthM, ignore: false, line: [[-60, y], [60, y]].map(ll), ...extra });
const HOUSE = rect(0, 0, 8, 9);
const frameFor = (roads, house = HOUSE) => buildFrame({ address: { lat: LAT + 4.5 / KY, lng: LNG + 4 / KX }, footprint: { ring: house }, roads: roads.map((r) => r.line) });
const bounds = (plot) => { const p = plot.ring.map(toXY); return { x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) }; };
const near = (a, b, tol = 0.8) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const STREET = {
  roads: [road(-12)],
  neighbours: [
    { ring: rect(-8, 0, 0, 9), buildingType: 'house' },     // semi: shares the left party wall
    { ring: rect(12, 0, 20, 9), buildingType: 'house' },    // detached neighbour, 4 m gap on the right
    { ring: rect(-4, 36, 4, 44), buildingType: 'house' },   // back-to-back houses on the next street
    { ring: rect(4, 36, 12, 44), buildingType: 'house' },
    { ring: rect(2, 3, 4, 5), buildingType: 'shed' },       // a shed in the garden must not carve the plot
  ],
};

test('plot: party wall at the side, half way to the detached neighbour, back of the pavement in front, half way to the back houses', () => {
  const plot = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  const b = bounds(plot);
  near(b.x0, 0); near(b.x1, 10);                            // left = party wall, right = middle of the 4 m gap
  near(b.y0, -12 + 2.75 + 2, 0.8);                          // road centreline + half carriageway + footway
  near(b.y1, 22.5);                                         // between the rear wall (9) and the back houses (36)
  assert.equal(plot.ring.length - 1, 4);                    // a clean four-cornered outline, not a pixel staircase
  assert.equal(plot.estimated, true); assert.equal(plot.confidence, 'medium');
  assert.deepEqual(plot.basis, { front: 'road', rear: 'neighbour', left: 'neighbour', right: 'neighbour' });
  assert.ok(Math.abs(plot.areaM2 - ringAreaM2(plot.ring)) <= 1);
});

test('plot: always contains the whole house', () => {
  const plot = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  const p = plot.ring.map(toXY);
  const inside = ([x, y]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  assert.ok(HOUSE.slice(0, -1).map(toXY).every(([x, y]) => inside([x === 0 ? 0.2 : x - 0.2, y === 0 ? 0.2 : y - 0.2])));
});

test('plot: outbuildings and duplicate outlines are not neighbours; with nothing mapped a default plot is used and flagged low confidence', () => {
  const roads = [];
  const lone = estimatePlot({ frame: frameFor(roads), houseRing: HOUSE, neighbours: [{ ring: rect(2, 12, 5, 14), buildingType: 'garage' }, { ring: rect(1, 1, 7, 8), buildingType: 'house' }], roadDetails: roads });
  const b = bounds(lone);
  near(b.x0, -8); near(b.x1, 16);                           // 8 m past each side wall
  near(b.y1, 9 + 25);                                      // 25 m behind the rear wall (rear wall is at y = 9)
  assert.equal(lone.confidence, 'low');
  assert.deepEqual(Object.values(lone.basis), ['default', 'default', 'default', 'default']);
});

test('plot: a private drive (ignore) does not stop the plot, a real road does; the picture follows the front/back the applicant chose', () => {
  const drive = [road(-6, 3, { ignore: true }), road(-12)];
  near(bounds(estimatePlot({ frame: frameFor(drive), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: drive })).y0, -7.25, 0.8);
  // swap front and back: the "road" side is now treated as the rear, so the plot no longer stops at the pavement
  const swapped = buildFrame({ address: { lat: LAT + 4.5 / KY, lng: LNG + 4 / KX }, footprint: { ring: HOUSE }, roads: STREET.roads.map((r) => r.line), frontBearingDeg: 0 });
  const plot = estimatePlot({ frame: swapped, houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  assert.ok(plot);                                          // still a sensible outline, built from the other orientation
  assert.ok(plot.areaM2 > 60);
});

test('plot: no outline to start from -> null, never a made-up plot', () => {
  const synthetic = buildFrame({ address: { lat: LAT, lng: LNG }, footprint: null, roads: [] });
  assert.equal(estimatePlot({ frame: synthetic, houseRing: null }), null);
});

test('plot: a long terrace is bounded by the two party walls', () => {
  const nb = [-24, -16, -8, 8, 16, 24].map((x) => ({ ring: rect(x, 0, x + 8, 9), buildingType: 'terrace' }));
  const plot = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: nb, roadDetails: STREET.roads });
  const b = bounds(plot);
  near(b.x0, 0); near(b.x1, 8);
});

test('title: used when it matches the house; an unrelated / tiny / shifted title falls back to the estimate', () => {
  const estimate = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  const good = { ring: rect(-1, -6, 11, 22), areaM2: 12 * 28 };
  const elsewhere = { ring: rect(40, -6, 52, 22), areaM2: 12 * 28 };
  const justHouse = { ring: rect(0, 0, 8, 9), areaM2: 72 };
  const shifted = { ring: rect(6, -6, 18, 22), areaM2: 12 * 28 };           // overlaps only a sliver of the house
  assert.equal(titleMatchesHouse(good, HOUSE), true);
  for (const bad of [elsewhere, justHouse, shifted, null]) assert.equal(titleMatchesHouse(bad, HOUSE), false);

  // house walls sitting exactly ON the title line (terraces) or up to ~1 m out (OSM vs Land Registry offset) must still match
  assert.equal(titleMatchesHouse({ ring: rect(0, 0, 8, 28), areaM2: 8 * 28 }, HOUSE), true);
  assert.equal(titleMatchesHouse({ ring: rect(0.6, 0.5, 8.6, 28), areaM2: 8 * 27.5 }, HOUSE), true);

  assert.equal(choosePlot({ title: good, estimate, houseRing: HOUSE }).plot, good);
  let r = choosePlot({ title: elsewhere, estimate, houseRing: HOUSE });
  assert.equal(r.plot, estimate); assert.match(r.note, /does not match the house/);
  r = choosePlot({ title: null, estimate, houseRing: HOUSE });
  assert.equal(r.plot, estimate); assert.match(r.note, /No registered title boundary/);
  assert.equal(choosePlot({ title: good, estimate, houseRing: HOUSE, mode: 'estimate' }).plot, estimate);
  assert.equal(choosePlot({ title: elsewhere, estimate, houseRing: HOUSE, mode: 'title' }).plot, elsewhere);
  assert.equal(choosePlot({ title: null, estimate: null, houseRing: HOUSE }).plot, null);
});

const mapWith = (plot, extra = {}) => buildMap({ address: { lat: LAT + 4.5 / KY, lng: LNG + 4 / KX }, footprint: { ring: HOUSE, source: 'osm' }, roads: STREET.roads.map((r) => r.line), roadDetails: [], camera: null, profile: { existingExtension: null }, proposal: null, plot, ...extra });

test('map: the whole plot fills the picture (more zoomed-in than the house alone) and every corner is visible', () => {
  const estimate = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  const without = mapWith(null), withPlot = mapWith(estimate, { fractionalZoom: true });
  assert.equal(withPlot.view.fit, 'plot');
  const layer = withPlot.layers.find((l) => l.kind === 'plot');
  const pts = layer.path.match(/-?[\d.]+,-?[\d.]+/g).map((p) => p.split(',').map(Number));
  assert.ok(pts.every(([x, y]) => x >= 0 && x <= withPlot.view.w && y >= 0 && y <= withPlot.view.h), 'a plot corner is cropped');
  assert.ok(withPlot.view.zoom <= 20 && withPlot.view.zoom >= 15);
  assert.ok(withPlot.view.zoom <= without.view.zoom);        // the plot is bigger than the house, so we zoom out enough to show all of it
  // the plot fills most of the picture: bounding box covers over half the width or height
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  assert.ok((Math.max(...xs) - Math.min(...xs)) / withPlot.view.w > 0.5 || (Math.max(...ys) - Math.min(...ys)) / withPlot.view.h > 0.5);
  assert.equal(layer.estimated, true); assert.equal(layer.label, 'Estimated plot outline');
  assert.ok(withPlot.siteChecks.items[0].message.includes('estimate, not a legal boundary'));
  assert.ok(withPlot.siteChecks.attribution.some((a) => /estimate/.test(a)));
});

test('map: integer zoom only when the aerial source cannot draw fractional zoom (Google); a giant title is ignored for framing', () => {
  const estimate = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  assert.equal(Number.isInteger(mapWith(estimate, { fractionalZoom: false }).view.zoom), true);
  const farm = { ring: rect(-300, -300, 300, 300), areaM2: 360000, source: 'hmlr-title-boundary' };
  const m = mapWith(farm, { fractionalZoom: true });
  assert.notEqual(m.view.fit, 'plot');                       // would shrink the house to a speck, so the house is framed as before
  assert.equal(m.view.zoom, 20);
});

test('boundary rule: an estimated plot outline only ever warns or informs, never fails, and gives no boundary distance', () => {
  const estimate = estimatePlot({ frame: frameFor(STREET.roads), houseRing: HOUSE, neighbours: STREET.neighbours, roadDetails: STREET.roads });
  const run = (proposalRing) => runSiteChecks({ proposalRing, houseRing: HOUSE, plot: estimate });
  let r = run(rect(1, 9, 7, 12));                                              // inside the estimate
  assert.equal(r.boundary.status, 'inside'); assert.equal(r.boundary.estimated, true);
  assert.ok(r.items.some((i) => i.status === 'info' && /estimated plot outline/.test(i.message)));
  assert.ok(!r.items.some((i) => /plot outline|boundary/i.test(i.message) && (i.status === 'fail' || i.status === 'pass')));
  r = run(rect(1, 9, 7, 28));                                                  // runs well past the estimated rear line
  assert.equal(r.boundary.status, 'crosses');
  assert.ok(r.items.some((i) => i.status === 'warn' && /beyond the estimated plot outline/.test(i.message)));
  assert.ok(!r.items.some((i) => i.status === 'fail' && /boundary/.test(i.message)));
});
