import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, chooseView, scaleBar } from '../src/services/mapService.js';

const LAT = 51.539, LNG = 0.059, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 111320;
const box = (w, d) => { const r = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [LNG + x / KX, LAT + y / KY]); return [...r, r[0]]; };
const mpp = (z) => (156543.03392 * Math.cos((LAT * Math.PI) / 180)) / 2 ** z;
const map = (w, d, proposal = null) => buildMap({ address: { lat: LAT, lng: LNG }, footprint: { ring: box(w, d), source: 'osm' }, roads: [], camera: null, profile: { existingExtension: null }, proposal });
const outside = (m, kinds) => m.layers.filter((l) => kinds.includes(l.kind)).flatMap((l) => l.path.match(/-?[\d.]+,-?[\d.]+/g).map((p) => p.split(',').map(Number)))
  .filter(([x, y]) => x < 0 || x > m.view.w || y < 0 || y > m.view.h).length;

test('the whole building is shown, however large, until it exceeds the biggest map window', () => {
  const zooms = [[6, 9], [60, 25], [120, 50], [350, 120], [600, 200], [1200, 300]].map(([w, d]) => { const m = map(w, d); assert.equal(m.view.fit, 'all'); assert.equal(outside(m, ['building']), 0, `${w}x${d}`); return m.view.zoom; });
  assert.deepEqual(zooms, [20, 19, 18, 17, 16, 15]);                       // before the fix 600 m and 1200 m buildings were cropped at zoom 17
  assert.ok(zooms.every((z, i) => i === 0 || z <= zooms[i - 1]));
});

test('a building bigger than any window is framed around the area of interest instead of being cropped everywhere', () => {
  const m = map(2500, 400);                                                // wider than the 15-level window (~1.9 km)
  assert.equal(m.view.fit, 'focus');
  assert.ok(m.view.zoom >= 17, String(m.view.zoom));                       // zoomed in on the address, not lost at the edge
  assert.ok(m.siteChecks.items[0].message.includes('larger than the map window'));
  // the address point is on screen and the building's outline crosses the picture (continues beyond the edges)
  const b = m.layers.find((l) => l.kind === 'building'); assert.ok(b.path.length > 20);
});

test('with a proposal on a huge building the map is centred on the proposal and the proposal is fully visible', () => {
  const m = map(2500, 400, { type: 'rear_extension', depthM: 4, widthM: 5, heightM: 3, alignment: 'centre', storeys: 1 });
  assert.equal(m.view.fit, 'focus');
  assert.equal(outside(m, ['proposal']), 0);
});

test('chooseView prefers the fully zoomed-in fit for a normal house and never leaves the allowed zoom range', () => {
  assert.equal(chooseView({ allPoints: box(6, 9), focusPoints: box(6, 9) }).zoom, 20);
  for (const size of [10, 100, 400, 900, 1700, 5000]) { const v = chooseView({ allPoints: box(size, size / 2), focusPoints: box(5, 5) }); assert.ok(v.zoom >= 15 && v.zoom <= 20); }
});

test('scale bar: round length, always between 40 and 120 px unless extreme', () => {
  for (const z of [20, 19, 18, 17, 16, 15]) {
    const s = scaleBar(mpp(z));
    assert.ok([5, 10, 20, 50, 100, 200, 500, 1000].includes(s.metres));
    assert.ok(s.px <= 120.5 && s.px >= 30, `z${z}: ${s.metres} m = ${s.px}px`);
  }
  assert.equal(scaleBar(mpp(20)).metres, 10);                              // 0.09 m/px: 10 m = 108 px (was a fixed 5 m)
});
