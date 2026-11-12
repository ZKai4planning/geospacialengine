import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoalGeoJson, boxLiteral } from '../src/utils/coalParse.js';
import { createCoalRisk } from '../src/providers/coalRisk.js';

const LAT = 53.0, LNG = -1.3, DLNG = (m) => m / (111320 * Math.cos((LAT * Math.PI) / 180)), DLAT = (m) => m / 111320;
const square = (cx, cy, half) => [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]
  .map(([x, y]) => [LNG + DLNG(x), LAT + DLAT(y)]);
const fc = (...rings) => JSON.stringify({ type: 'FeatureCollection', features: rings.map((c, i) => ({ type: 'Feature', properties: { OBJECTID: i + 1, CLASS_NAME: 'Development High Risk Area' }, geometry: { type: 'Polygon', coordinates: c } })) });

/** Fake pool that behaves like the two queries the provider makes. */
function fakeDb(features, loaded = true) {
  const rows = parseCoalGeoJson(features);
  return { calls: [], async query(sql, p) {
    this.calls.push(sql);
    if (/coal_risk_meta/.test(sql)) return { rows: loaded ? [{ features: rows.length, source: 'test', loaded_at: '2026-07-01T00:00:00Z' }] : [] };
    const [maxX, maxY, minX, minY] = p;                                                          // honour the bbox filter like Postgres would
    return { rows: rows.filter((r) => r.bbox[0] <= maxX && r.bbox[2] >= minX && r.bbox[1] <= maxY && r.bbox[3] >= minY).map((r) => ({ ref: r.ref, name: r.name, parts: r.parts })) };
  } };
}

test('parser: FeatureCollection and GeoJSON lines, MultiPolygon, rounding, and a clear error for National Grid coordinates', () => {
  const f = parseCoalGeoJson(fc([square(0, 0, 100)]));
  assert.equal(f.length, 1); assert.equal(f[0].name, 'Development High Risk Area'); assert.equal(f[0].parts[0][0].length, 5);
  const lines = '\x1e' + JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 50)], [square(500, 0, 50)]] } }) + '\n';
  assert.equal(parseCoalGeoJson(lines)[0].parts.length, 2);
  assert.throws(() => parseCoalGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[530000, 180000], [530100, 180000], [530100, 180100], [530000, 180000]]] } }] })), /ogr2ogr/);
  assert.equal(boxLiteral([-1.4, 52.9, -1.2, 53.1]), '(-1.2,53.1),(-1.4,52.9)');
});

test('inside, near, outside: judged from the polygon, with distance to the edge', async () => {
  const db = fakeDb(fc([square(0, 0, 100)]));                                    // 200 m square centred on the property
  const p = createCoalRisk({ db });
  const inside = await p.check({ lat: LAT, lng: LNG });
  assert.equal(inside.status, 'inside'); assert.match(inside.source, /Development High Risk Area \(loaded 2026-07-01\)/);
  const near = await p.check({ lat: LAT, lng: LNG + DLNG(180) });                 // 80 m outside the east edge
  assert.equal(near.status, 'near'); assert.ok(Math.abs(near.distanceM - 80) <= 2, `distance ${near.distanceM}`);
  const outside = await p.check({ lat: LAT, lng: LNG + DLNG(1000) });
  assert.equal(outside.status, 'outside'); assert.equal(outside.distanceM, null);
});

test('a hole in the polygon is not inside', async () => {
  const ring = square(0, 0, 100), hole = square(0, 0, 20).reverse();
  const p = createCoalRisk({ db: fakeDb(fc([ring, hole])) });
  assert.equal((await p.check({ lat: LAT, lng: LNG })).status, 'near');           // in the hole, 20 m from the hole's edge
});

test('no data loaded, no table, or provider not configured: unavailable - never "outside"', async () => {
  assert.equal((await createCoalRisk({ db: fakeDb(fc([square(0, 0, 100)]), false) }).check({ lat: LAT, lng: LNG })).status, 'unavailable');
  const broken = { async query() { throw new Error('relation "coal_risk_meta" does not exist'); } };
  const r = await createCoalRisk({ db: broken }).check({ lat: LAT, lng: LNG });
  assert.equal(r.status, 'unavailable'); assert.match(r.reason, /not loaded|could not be read/);
  assert.equal((await createCoalRisk().check({ lat: LAT, lng: LNG })).status, 'unavailable');
});

test('live ArcGIS layer: a hit is inside, an empty answer is outside, an error is unavailable; query uses WGS84 point', async () => {
  let url;
  const mk = (data) => createCoalRisk({ liveUrl: 'https://example.test/FeatureServer/0/', fetchJson: async (u) => { url = u; return data; } });
  assert.equal((await mk({ features: [{ attributes: { CLASS_NAME: 'DHRA' } }] }).check({ lat: LAT, lng: LNG })).status, 'inside');
  assert.match(url, /inSR=4326/); assert.match(url, /geometry=-1\.3%2C53/); assert.match(url, /returnGeometry=false/);
  assert.equal((await mk({ features: [] }).check({ lat: LAT, lng: LNG })).status, 'outside');
  assert.equal((await mk({ error: { code: 400 } }).check({ lat: LAT, lng: LNG })).status, 'unavailable');
});

test('live folder mode: one parallel round of queries returns the high-risk area plus the detail layers, and a failed detail layer is unknown, not clear', async () => {
  const urls = [];
  const fetchJson = async (u) => {
    urls.push(u);
    if (/coalauthority_specific_risk\/MapServer\/5\//.test(u)) throw new Error('boom');
    const hit = (attrs = {}) => ({ features: [{ attributes: attrs }] });
    if (/planning_policy_constraints\/MapServer\/0\//.test(u)) return hit({ FEATURE_TYPE: 'Development High Risk Area' });
    if (/specific_risk\/MapServer\/0\//.test(u)) return hit({ TYPE: 'Shaft' });
    if (/specific_risk\/MapServer\/4\//.test(u)) return hit();
    return { features: [] };
  };
  const coal = createCoalRisk({ liveUrl: 'https://example.test/arcgis/rest/services/CoalAuthority', fetchJson });
  const r = await coal.check({ lat: 53.5, lng: -1.4 });
  assert.equal(r.status, 'inside');
  assert.deepEqual(r.details.mineEntry, ['Shaft']);
  assert.equal(r.details.pastWorkings, true);
  assert.equal(r.details.fissures, false);
  assert.equal(r.details.probableWorkings, null, 'a layer that failed is unknown');
  assert.ok(urls.every((u) => u.includes('inSR=4326')));
  const { coalTile } = await import('../src/services/siteExtras.js');
  assert.match(coalTile(r).sub, /recorded mine entry \(shaft\)/);
});
