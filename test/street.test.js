import test from 'node:test';
import assert from 'node:assert/strict';
import { pathFromElement, obstacleFromElement, roadFromElement } from '../src/utils/osmTags.js';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { streetCheck } from '../src/services/frontSpace.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { buildBlockPlan } from '../src/services/blockPlan.js';
import { publicStrips } from '../src/services/publicStrip.js';
import { createOsmBuildings } from '../src/providers/osmBuildings.js';
import { makeView, project } from '../src/utils/mercator.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([x, y]) => { const [lon, lat] = ll([x, y]); return { lat, lon }; }) });
const node = (id, tags, [x, y]) => { const [lon, lat] = ll([x, y]); return { type: 'node', id, lat, lon, tags }; };

test('OSM tags: pavements, paths and public rights of way', () => {
  const side = pathFromElement(way(1, { highway: 'footway', footway: 'sidewalk' }, [[0, 0], [10, 0]]));
  assert.equal(side.kind, 'pavement'); assert.equal(side.widthM, 2); assert.equal(side.widthSource, 'assumed'); assert.equal(side.row, false);
  const row = pathFromElement(way(2, { highway: 'footway', designation: 'public_footpath', width: '1.2' }, [[0, 0], [10, 0]]));
  assert.equal(row.row, true); assert.equal(row.widthM, 1.2); assert.equal(row.widthSource, 'osm'); assert.equal(row.kind, 'path');
  assert.equal(pathFromElement(way(3, { highway: 'footway', footway: 'crossing' }, [[0, 0], [3, 0]])).kind, 'crossing');
  assert.equal(pathFromElement(way(4, { highway: 'residential' }, [[0, 0], [3, 0]])), null);
  assert.equal(pathFromElement(way(5, { highway: 'footway' }, [[0, 0]])), null);
  assert.equal(roadFromElement(way(6, { highway: 'residential', sidewalk: 'both' }, [[0, 0], [10, 0]])).sidewalk, 'both');
});

test('OSM tags: post boxes, poles, lamps, cabinets; a dropped kerb is not an obstruction', () => {
  const k = (tags) => obstacleFromElement(node(1, tags, [0, 0]));
  assert.equal(k({ amenity: 'post_box' }).label, 'Post box');
  assert.equal(k({ power: 'pole', height: '9' }).heightM, 9);
  assert.equal(k({ highway: 'street_lamp' }).kind, 'lamp');
  assert.equal(k({ man_made: 'street_cabinet' }).kind, 'cabinet');
  const dk = k({ barrier: 'kerb', kerb: 'lowered' });
  assert.equal(dk.kind, 'dropped_kerb'); assert.equal(dk.blocks, false);
  assert.equal(k({ barrier: 'kerb', kerb: 'raised' }), null);
  assert.equal(k({ natural: 'tree' }), null);
  assert.equal(obstacleFromElement(way(2, { amenity: 'post_box' }, [[0, 0], [1, 1]])), null);
});

test('OSM site: the same request also asks for pavements, paths and street furniture, and returns them', async () => {
  const body = { elements: [
    way(1, { building: 'house' }, [[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]]),
    way(2, { highway: 'footway', footway: 'sidewalk' }, [[8, -10], [8, 10]]),
    node(3, { amenity: 'post_box' }, [9, 2]), node(4, { power: 'pole' }, [9, -4]), node(5, { highway: 'street_lamp' }, [9, 6]),
  ] };
  const real = globalThis.fetch; let query = '';
  globalThis.fetch = async (url, init) => { query = decodeURIComponent(String(init.body)); return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const site = await createOsmBuildings().findSite({ lat: LAT, lng: LNG });
    for (const re of [/"amenity"="post_box"/, /"power"~"\^\(pole\|tower\)\$"/, /street_lamp/, /"highway"~"\^\(footway\|path\|steps\|cycleway\|bridleway\)\$"/]) assert.match(query, re);
    assert.equal(site.pathways.length, 1); assert.deepEqual(site.obstacles.map((o) => o.kind).sort(), ['lamp', 'pole', 'post_box']);
    globalThis.fetch = async () => new Response(JSON.stringify({ elements: body.elements.filter((e) => e.id !== 1) }), { status: 200, headers: { 'content-type': 'application/json' } });
    const none = await createOsmBuildings().findSite({ lat: LAT + 0.5, lng: LNG });
    assert.equal(none.pathways.length, 1); assert.equal(none.obstacles.length, 3);   // no building: street features still returned
  } finally { globalThis.fetch = real; }
});

// ---- site rule ----
const plot = { ring: ring([[0, -12], [5, -12], [5, 0], [0, 0]]), areaM2: 60, estimated: false };
const house = ring([[0, -10], [5, -10], [5, -2], [0, -2]]);
const run = (proposal, extra) => runSiteChecks({ proposalRing: ring(proposal), houseRing: house, plot, proposalAbsolute: true, ...extra });
const prop = [[0.5, -4], [4.5, -4], [4.5, -0.5], [0.5, -0.5]];
const P = (id, tags, xy) => ({ ...obstacleFromElement(node(id, tags, xy)), id: `o${id}` });

test('street rule: an obstruction in the way, one to keep clear, and one only listed; poles warn about cables', () => {
  const r = run(prop, { obstacles: [P(1, { amenity: 'post_box' }, [2, -2]), P(2, { power: 'pole' }, [5.8, -2]), P(3, { highway: 'street_lamp' }, [9, -2])] });
  const by = Object.fromEntries(r.street.obstacles.map((o) => [o.kind, o]));
  assert.equal(by.post_box.status, 'blocked'); assert.equal(by.pole.status, 'near'); assert.equal(by.lamp.status, 'clear');
  assert.equal(by.post_box.inPlot, true); assert.equal(by.lamp.inPlot, false);
  assert.ok(r.items.some((i) => i.status === 'warn' && /post box is mapped where the work would stand/.test(i.message)));
  assert.ok(r.items.some((i) => i.status === 'warn' && /pole/.test(i.message) && /cables/.test(i.message)));
  assert.ok(r.items.some((i) => i.status === 'info' && /street lamp/.test(i.message) && /Street features nearby/.test(i.message)));
});

test('street rule: a public right of way under the footprint is certain; a plain path only likely; a pavement edge is measured', () => {
  const mk = (tags, line) => ({ ...pathFromElement(way(9, tags, line)), id: 'p1' });
  const row = run(prop, { pathways: [mk({ highway: 'footway', designation: 'public_footpath' }, [[2, -8], [2, 3]])] });
  assert.equal(row.street.crossesRow, true); assert.ok(row.items.some((i) => i.status === 'fail' && /public right of way/.test(i.message)));
  assert.equal(streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: row }).level, 'certain');
  const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', depthM: 2, widthM: 3, heightM: 3, storeys: 1 }, existingExtensionDepthM: 0, street: streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: row }) });
  assert.equal(a.verdict, 'planning_permission'); assert.match(a.summary, /public right of way/);

  const plain = run(prop, { pathways: [mk({ highway: 'footway' }, [[2, -8], [2, 3]])] });
  assert.equal(streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: plain }).level, 'likely');

  const pave = run(prop, { pathways: [mk({ highway: 'footway', footway: 'sidewalk' }, [[8, -10], [8, 10]])] });
  assert.equal(pave.street.pathways[0].status, 'clear'); assert.equal(pave.street.pathways[0].distanceM, 2.5);   // 8 - 2.5 (edge at 7) - 4.5 (footprint edge)... centre 3.5 m, minus half width 1 m
  assert.ok(pave.items.some((i) => /Nearest pavement: 2.5 m/.test(i.message)));
  assert.equal(streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: pave }), null);
});

test('street rule: nothing mapped is an info note, never a pass', () => {
  const r = run(prop, {});
  assert.ok(r.items.some((i) => i.status === 'info' && /No post boxes, poles/.test(i.message)));
  assert.ok(!r.items.some((i) => i.status === 'pass' && /street (features|furniture)|post box|lamp/i.test(i.message)));
});

// ---- block plan dimensions ----
test('block plan: distances to the nearest post box / pole and pavement, plus carriageway width, public strip and frontage as facts', () => {
  const view = makeView({ lat: LAT, lng: LNG, zoom: 20, w: 640, h: 400 });
  const roads = [{ id: 'r', name: 'Manor Road', widthM: 5, widthSource: 'assumed', ignore: false, line: [[-20, 7.5], [30, 7.5]].map(ll) }];
  const strips = publicStrips({ plotRings: [plot.ring], roads });
  assert.equal(strips[0].frontageM, 5);
  const bp = buildBlockPlan({
    view, project, houseRing: house, proposalRing: ring(prop), plotRings: [plot.ring], roads, strips,
    pathways: [{ ...pathFromElement(way(9, { highway: 'footway', footway: 'sidewalk' }, [[-10, 4], [20, 4]])) }],
    obstacles: [obstacleFromElement(node(1, { amenity: 'post_box' }, [7, 1])), obstacleFromElement(node(2, { barrier: 'kerb', kerb: 'lowered' }, [3, 3]))],
  });
  const by = Object.fromEntries(bp.dims.map((d) => [d.text, d]));
  assert.ok(by['To post box']); assert.ok(by['To pavement']);
  assert.ok(!bp.dims.some((d) => /dropped kerb/i.test(d.text)), 'a dropped kerb is not measured as an obstruction');
  const f = Object.fromEntries(bp.facts.map((x) => [x.text, x.label]));
  assert.equal(f['Plot frontage facing the road'], '5 m');
  assert.equal(f['Public strip: plot boundary to carriageway edge (Manor Road)'], '5 m');
  assert.ok(Object.keys(f).some((k) => /^Carriageway width \(Manor Road, assumed\)/.test(k)) && Object.keys(f).some((k) => /^Pavement width \(assumed\)/.test(k)));
});

// ---- end to end through buildMap ----
import { buildMap } from '../src/services/mapService.js';
test('buildMap: pavements, paths and street furniture become layers with statuses; dims and facts reach the block plan', () => {
  const box = (w, d, [cx, cy] = [0, 0]) => ring([[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]]);
  const m = buildMap({
    address: { lat: LAT, lng: LNG }, footprint: { ring: box(5, 8, [2.5, -6]), source: 'osm' }, plot: { ring: plot.ring, areaM2: 60, estimated: false },
    roads: [], roadDetails: [{ name: 'Manor Road', widthM: 5, widthSource: 'assumed', ignore: false, line: [[-20, 7.5], [30, 7.5]].map(ll) }],
    pathways: [pathFromElement(way(9, { highway: 'footway', footway: 'sidewalk' }, [[-10, 3], [20, 3]]))],
    obstacles: [obstacleFromElement(node(1, { amenity: 'post_box' }, [8, 1])), obstacleFromElement(node(2, { power: 'pole' }, [-3, 2]))],
    camera: null, profile: { existingExtension: null }, proposal: null,
  });
  const kinds = (k) => m.layers.filter((l) => l.kind === k);
  assert.equal(kinds('pathway').length, 1); assert.equal(kinds('pathway')[0].pathKind, 'pavement'); assert.ok(kinds('pathway')[0].strokePx >= 1.5);
  assert.deepEqual(kinds('obstacle').map((l) => l.obstacleKind).sort(), ['pole', 'post_box']);
  assert.ok(kinds('obstacle').every((l) => l.label && /^M/.test(l.path)));
  assert.equal(m.siteChecks.street.obstacles.length, 2);
  assert.ok(m.geojson.features.some((f) => f.properties.kind === 'obstacle' && f.geometry.type === 'Point'));
  assert.ok(m.geojson.features.some((f) => f.properties.kind === 'pathway' && f.geometry.type === 'LineString'));
  const f = Object.fromEntries(m.blockPlan.facts.map((x) => [x.text, x.label]));
  assert.equal(f['Plot frontage facing the road'], '5 m');
  assert.ok(Object.keys(f).some((k) => /^Carriageway width \(Manor Road, assumed\)/.test(k)));
  assert.ok(Object.keys(f).some((k) => /^Pavement width/.test(k)));
});
