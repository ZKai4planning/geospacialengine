import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HTTP_USER_AGENT = 'test-agent/1.0';
process.env.OVERPASS_URLS = 'https://a.example/api';
const { createOsmBuildings } = await import('../src/providers/osmBuildings.js');

const LAT = 51.5, LNG = 0.05;
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([lon, lat]) => ({ lat, lon })) });
const response = {
  elements: [
    way(1, { building: 'terrace' }, [[LNG - 0.00004, LAT - 0.00004], [LNG + 0.00004, LAT - 0.00004], [LNG + 0.00004, LAT + 0.00004], [LNG - 0.00004, LAT + 0.00004], [LNG - 0.00004, LAT - 0.00004]]),
    way(2, { highway: 'residential', name: 'Elm Road', width: '7' }, [[LNG - 0.001, LAT - 0.0002], [LNG + 0.001, LAT - 0.0002]]),
    way(3, { highway: 'service', service: 'driveway' }, [[LNG, LAT - 0.0001], [LNG, LAT - 0.0002]]),
    { type: 'node', id: 10, lat: LAT + 0.00008, lon: LNG, tags: { natural: 'tree', species: 'Quercus robur', circumference: '1.9' } },
    { type: 'node', id: 11, lat: LAT + 0.0001, lon: LNG + 0.00003, tags: { natural: 'tree' } },
    { type: 'node', id: 12, lat: LAT, lon: LNG, tags: { amenity: 'bench' } },              // not a tree
  ],
};

test('OSM site: one request returns building, roads with widths, driveways flagged, and individual trees', async () => {
  const real = globalThis.fetch;
  let query = '';
  globalThis.fetch = async (url, init) => { query = String(init.body); return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const site = await createOsmBuildings().findSite({ lat: LAT, lng: LNG });
    assert.match(decodeURIComponent(query), /node\(around:60,51\.5,0\.05\)\["natural"="tree"\]/);   // trees asked for in the same query
    assert.equal(site.footprint.osmId, 1);
    assert.equal(site.roads.length, 2);                                                            // old shape still there (front-of-house detection)
    assert.equal(site.roadDetails.length, 2);
    assert.deepEqual(site.roadDetails.map((r) => [r.name, r.widthM, r.ignore]), [['Elm Road', 7, false], [null, 3.5, true]]);
    assert.equal(site.trees.length, 2);
    assert.equal(site.trees[0].species, 'Quercus robur');
    assert.ok(Math.abs(site.trees[0].trunkDiameterM - 0.605) < 0.01);                              // 1.9 m circumference -> 0.6 m trunk
    assert.equal(site.trees[1].trunkDiameterM, null);
  } finally { globalThis.fetch = real; }
});

test('OSM site: no building found still returns roads and trees (the checks work on a drawn shape)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ elements: response.elements.filter((e) => e.id !== 1) }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const site = await createOsmBuildings().findSite({ lat: LAT, lng: LNG });
    assert.equal(site.footprint, null); assert.equal(site.roadDetails.length, 2); assert.equal(site.trees.length, 2);
  } finally { globalThis.fetch = real; }
});
