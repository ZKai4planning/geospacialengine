import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HTTP_USER_AGENT = 'test-agent/1.0';
process.env.OVERPASS_URLS = 'https://a.example/api';
const { buildFrame } = await import('../src/services/proposalGeometry.js');
const { estimatePlot, snapToBarriers } = await import('../src/utils/plotEstimate.js');
const { createOsmBuildings } = await import('../src/providers/osmBuildings.js');
const { barrierFromElement } = await import('../src/utils/osmTags.js');

const LAT = 52.76, LNG = -0.68, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG + x / KX, LAT + y / KY];
const toXY = ([lng, lat]) => [(lng - LNG) * KX, (lat - LAT) * KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const line = (kind, ...pts) => ({ kind, line: pts.map(ll) });
const HOUSE = rect(0, 0, 8, 9);
const roads = [{ widthM: 5.5, ignore: false, line: [[-60, -12], [60, -12]].map(ll) }];
const neighbours = [
  { ring: rect(-8, 0, 0, 9), buildingType: 'house' }, { ring: rect(12, 0, 20, 9), buildingType: 'house' },
  { ring: rect(-4, 36, 4, 44), buildingType: 'house' }, { ring: rect(4, 36, 12, 44), buildingType: 'house' },
];
const frame = buildFrame({ address: { lat: LAT + 4.5 / KY, lng: LNG + 4 / KX }, footprint: { ring: HOUSE }, roads: roads.map((r) => r.line) });
const plotWith = (barriers) => estimatePlot({ frame, houseRing: HOUSE, neighbours, roadDetails: roads, barriers });
const box = (p) => { const q = p.ring.map(toXY); return { x0: Math.min(...q.map((a) => a[0])), x1: Math.max(...q.map((a) => a[0])), y0: Math.min(...q.map((a) => a[1])), y1: Math.max(...q.map((a) => a[1])) }; };
const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('without barriers the right edge is half way across the gap; a fence along it moves the edge onto the fence', () => {
  const base = plotWith([]);
  near(box(base).x1, 10); assert.deepEqual(base.snapped, []);
  const snapped = plotWith([line('fence', [8.9, -2], [8.9, 22])]);                  // a fence 1.1 m inside the mid-gap line, running the length of the plot
  near(box(snapped).x1, 8.9, 0.3);
  assert.equal(snapped.basis.right, 'fence'); assert.equal(snapped.snapped[0].side, 'right'); assert.equal(snapped.snapped[0].kind, 'fence');
  near(box(snapped).x0, 0); near(box(snapped).y1, 22.5);                           // other edges unchanged
  assert.match(snapped.attribution, /fences\/walls\/hedges/);
});

test('several sides snap, a back-garden wall and a front hedge included; confidence rises when two or more sides follow real barriers', () => {
  const p = plotWith([
    line('fence', [9.2, -3], [9.2, 21]),
    line('wall', [-1, 20.5], [9.2, 20.5]),            // rear boundary, 2 m inside the mid-way line
    line('hedge', [-1, -8.6], [9.2, -8.6]),           // front hedge, 1.3 m outside the back-of-pavement line
  ]);
  const b = box(p);
  near(b.x1, 9.2, 0.3); near(b.y1, 20.5, 0.3); near(b.y0, -8.6, 0.3);
  assert.deepEqual(p.snapped.map((s) => s.side).sort(), ['front', 'rear', 'right']);
  assert.equal(p.confidence, 'high'); assert.equal(p.ring.length - 1, 4);
});

test('barriers that are not a boundary are ignored: mid-garden fences, short bits, wrong direction, far away', () => {
  const p = plotWith([
    line('fence', [4, 12], [4, 21]),                  // a fence inside the garden (more than 3 m from any edge direction it runs along)
    line('hedge', [9.5, 3], [9.5, 4.5]),              // a 1.5 m scrap
    line('fence', [3, 14], [9, 18]),                  // diagonal
    line('wall', [15, -5], [15, 25]),                 // beyond the neighbour gap and the 3 m reach
  ]);
  near(box(p).x1, 10); near(box(p).y1, 22.5); assert.deepEqual(p.snapped, []);
});

test('a snap that would cut into the house or push into a neighbour is refused, the rest still applies', () => {
  const cutsHouse = plotWith([line('fence', [7, -2], [7, 22])]);                    // 3 m inside the right edge: the house (x up to 8) would be outside
  near(box(cutsHouse).x1, 10); assert.deepEqual(cutsHouse.snapped, []);
  const poly = [[0, -7], [10, -7], [10, 22], [0, 22]];
  const intoNeighbour = snapToBarriers({ poly, barriers: [{ kind: 'fence', pts: [[12.5, -7], [12.5, 22]] }], houseSD: [], nbSD: [[[11, 0], [20, 0], [20, 9], [11, 9], [11, 0]]] });
  assert.deepEqual(intoNeighbour.snapped, []);                                       // 12.5 is outside the 3 m reach anyway; and would swallow the neighbour's corner
  const both = snapToBarriers({ poly, barriers: [{ kind: 'fence', pts: [[11.8, -7], [11.8, 22]] }, { kind: 'wall', pts: [[0, 20.8], [10, 20.8]] }], houseSD: [[0, 0], [8, 0], [8, 9], [0, 9]], nbSD: [[[11, 0], [20, 0], [20, 9], [11, 9], [11, 0]]] });
  assert.deepEqual(both.snapped.map((s) => s.side), ['rear']);                       // the side fence would take in a neighbour's corner and is dropped; the wall is kept
});

test('barrier parsing: only boundary barriers are kept (fence, wall, hedge, retaining wall)', () => {
  const way = (tags, n = 3) => ({ type: 'way', id: 1, tags, geometry: Array.from({ length: n }, (_, i) => ({ lat: LAT, lon: LNG + i * 1e-5 })) });
  assert.equal(barrierFromElement(way({ barrier: 'fence' })).kind, 'fence');
  assert.equal(barrierFromElement(way({ barrier: 'retaining_wall' })).kind, 'wall');
  for (const bad of [way({ barrier: 'kerb' }), way({ barrier: 'bollard' }), way({ highway: 'residential' }), way({ barrier: 'fence' }, 1), { type: 'node', tags: { barrier: 'fence' } }]) assert.equal(barrierFromElement(bad), null);
});

test('OSM site: the same Overpass request also asks for fences / walls / hedges and returns them', async () => {
  const w = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([lon, lat]) => ({ lat, lon })) });
  const body = { elements: [
    w(1, { building: 'house' }, [[LNG - 0.00004, LAT - 0.00004], [LNG + 0.00004, LAT - 0.00004], [LNG + 0.00004, LAT + 0.00004], [LNG - 0.00004, LAT + 0.00004], [LNG - 0.00004, LAT - 0.00004]]),
    w(2, { barrier: 'fence' }, [[LNG + 0.0001, LAT - 0.0001], [LNG + 0.0001, LAT + 0.0001]]),
    w(3, { barrier: 'hedge' }, [[LNG - 0.0001, LAT + 0.0001], [LNG + 0.0001, LAT + 0.0001]]),
    w(4, { barrier: 'bollard' }, [[LNG, LAT], [LNG + 0.00001, LAT]]),
  ] };
  const real = globalThis.fetch; let query = '';
  globalThis.fetch = async (url, init) => { query = decodeURIComponent(String(init.body)); return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const site = await createOsmBuildings().findSite({ lat: LAT, lng: LNG });
    assert.match(query, /way\(around:40,[^)]*\)\["barrier"~"\^\(fence\|wall\|hedge\|retaining_wall\)\$"\]/);
    assert.deepEqual(site.barriers.map((b) => b.kind), ['fence', 'hedge']);
    assert.equal(site.footprint.osmId, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ elements: body.elements.filter((e) => e.id !== 1) }), { status: 200, headers: { 'content-type': 'application/json' } });
    assert.equal((await createOsmBuildings().findSite({ lat: LAT + 0.5, lng: LNG })).barriers.length, 2);   // no building: barriers still returned
  } finally { globalThis.fetch = real; }
});
