import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockProviders } from '../src/providers/mock.js';
import { buildMap } from '../src/services/mapService.js';

const m = createMockProviders();
const addr = await m.address.byId('1234567890');
const site = await m.buildings.findSite(addr);
const profile = (o = {}) => ({ existingExtension: { present: false, depthM: 0, inOutline: true }, frontBearingDeg: { value: null }, ...o });
const run = (proposal, p = profile()) => buildMap({ address: addr, footprint: site.footprint, roads: site.roads, camera: null, profile: p, proposal });
const maxLat = (l) => Math.max(...l.ring.map((r) => r[1]));
const minLat = (l) => Math.min(...l.ring.map((r) => r[1]));

test('front is detected from the road; rear extension is drawn on the far side', () => {
  const map = run({ type: 'rear_extension', storeys: 1, depthM: 4, heightM: 3 });
  const house = map.layers.find((l) => l.id === 'building'), ext = map.layers.find((l) => l.id === 'proposal');
  assert.equal(map.frame.frontSource, 'road');
  assert.equal(map.frame.frontBearingDeg, 180); // road is to the south
  assert.ok(minLat(ext) >= maxLat(house) - 1e-9); // extension is north of the house
  assert.ok(Math.abs(ext.dims.depthM - 4) < 0.01);
});

test('user can swap front/back', () => {
  const map = run({ type: 'rear_extension', storeys: 1, depthM: 4, heightM: 3 }, profile({ frontBearingDeg: { value: 0 } }));
  const house = map.layers.find((l) => l.id === 'building'), ext = map.layers.find((l) => l.id === 'proposal');
  assert.equal(map.frame.frontSource, 'user');
  assert.ok(maxLat(ext) <= minLat(house) + 1e-9);
});

test('every work type produces a proposal polygon that fits the view', () => {
  const types = [
    { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 },
    { type: 'side_extension', side: 'left', storeys: 1, widthM: 2.5, heightM: 3 },
    { type: 'wraparound_extension', side: 'right', depthM: 3, widthM: 2.5, heightM: 3 },
    { type: 'front_porch', widthM: 1.6, depthM: 1.5, heightM: 2.8 },
    { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 },
    { type: 'additional_storey', storeys: 1, heightM: 2.7 },
    { type: 'outbuilding', widthM: 3, depthM: 4, heightM: 2.5, setbackM: 5 },
  ];
  for (const t of types) {
    const map = run(t);
    const p = map.layers.find((l) => l.id === 'proposal');
    assert.ok(p && p.areaM2 > 0, t.type);
    assert.match(p.path, /^M[\d.,\- L]+Z$/);
  }
});

test('existing extension outside the outline pushes new rear work back', () => {
  const inside = run({ type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, profile({ existingExtension: { present: true, depthM: 2.8, inOutline: true } }));
  const outside = run({ type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, profile({ existingExtension: { present: true, depthM: 2.8, inOutline: false } }));
  const north = (m) => maxLat(m.layers.find((l) => l.id === 'proposal'));
  assert.ok(north(outside) > north(inside));
});

test('no outline and no road -> indicative house, flagged', () => {
  const map = buildMap({ address: addr, footprint: null, roads: [], camera: null, profile: profile(), proposal: null });
  assert.equal(map.frame.indicative, true);
  assert.equal(map.frame.frontSource, 'assumed');
});

test('labels never overlap', () => {
  const map = run({ type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3 }, profile({ existingExtension: { present: true, depthM: 2.8, inOutline: true } }));
  const ys = map.layers.filter((l) => l.kind !== 'building').map((l) => l.labelAt.y).sort((a, b) => a - b);
  assert.ok(ys[1] - ys[0] >= 34);
});
