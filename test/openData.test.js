import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatureInfo, distanceToGeometryM, createFloodSources } from '../src/providers/floodSources.js';
import { createOsmInfra } from '../src/providers/osmInfra.js';
import { buildLiveRegister } from '../src/services/intelligenceRegister.js';

// NOTE: these fixtures are shaped from the Environment Agency's published descriptions (layer rofsw_4band, attribute risk_band; OGC API Features).
// They are NOT recordings of the live services. `npm run verify:open-data` checks the real ones.

test('GetFeatureInfo: JSON, GML/XML and plain text replies are all understood; garbage and errors are not guessed at', () => {
  assert.deepEqual(parseFeatureInfo('{"type":"FeatureCollection","features":[{"properties":{"fid":7,"risk_band":"High"}}]}'), { ok: true, bands: ['high'] });
  assert.deepEqual(parseFeatureInfo('{"type":"FeatureCollection","features":[{"properties":{"RISK_BAND":"Very Low"}},{"properties":{"risk_band":"Medium"}}]}'), { ok: true, bands: ['very_low', 'medium'] });
  assert.deepEqual(parseFeatureInfo('{"type":"FeatureCollection","features":[]}'), { ok: true, bands: [] });
  assert.deepEqual(parseFeatureInfo('<?xml version="1.0"?><msGMLOutput><rofsw_4band_layer><rofsw_4band_feature><fid>3</fid><risk_band>Low</risk_band></rofsw_4band_feature></rofsw_4band_layer></msGMLOutput>'), { ok: true, bands: ['low'] });
  assert.deepEqual(parseFeatureInfo('Results for FeatureType rofsw_4band:\n--------------------------------------------\nfid = 12\nrisk_band = Medium\n'), { ok: true, bands: ['medium'] });
  assert.deepEqual(parseFeatureInfo('<?xml version="1.0"?><FeatureCollection xmlns="http://www.opengis.net/wfs"></FeatureCollection>'), { ok: true, bands: [] });
  assert.equal(parseFeatureInfo('<ServiceExceptionReport><ServiceException>Layer not queryable</ServiceException></ServiceExceptionReport>').ok, false);
  assert.equal(parseFeatureInfo('<html>502 Bad Gateway</html>').ok, false);
  assert.equal(parseFeatureInfo('').ok, false);
  assert.equal(parseFeatureInfo('{"oops":1}').ok, false);
});

test('geometry: inside a polygon is 0, holes are respected, outside gives the metres to the edge', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 51.5], [0.001, 51.5], [0.001, 51.501], [0, 51.501], [0, 51.5]]] };
  assert.equal(distanceToGeometryM(sq, 51.5005, 0.0005), 0);
  const d = distanceToGeometryM(sq, 51.5005, 0.0015);                       // 0.0005 deg of longitude east of the edge, about 34.7 m
  assert.ok(d > 30 && d < 40, `got ${d}`);
  const holed = { type: 'Polygon', coordinates: [sq.coordinates[0], [[0.0004, 51.5004], [0.0006, 51.5004], [0.0006, 51.5006], [0.0004, 51.5006], [0.0004, 51.5004]]] };
  assert.ok(distanceToGeometryM(holed, 51.5005, 0.0005) > 0);              // in the hole
  assert.equal(distanceToGeometryM({ type: 'Point', coordinates: [0, 0] }, 51.5, 0), Infinity);
  assert.equal(distanceToGeometryM({ type: 'MultiPolygon', coordinates: [sq.coordinates] }, 51.5005, 0.0005), 0);
});

const SW = 'https://example.test/wms', REC = 'https://example.test/rec', RES = 'https://example.test/res';
const poly = (lng, lat, w = 0.001, h = 0.001) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + w, lat], [lng + w, lat + h], [lng, lat + h], [lng, lat]]] });
function make({ wms, items = {}, collections = { collections: [{ id: 'flood_outlines', title: 'Recorded Flood Outlines' }] }, fail = {} }) {
  const calls = [];
  const fetchText = async (url) => { calls.push(url); if (fail.wms) throw new Error('boom'); return typeof wms === 'function' ? wms(url) : wms; };
  const fetchJson = async (url) => {
    calls.push(url);
    const base = url.startsWith(REC) ? 'rec' : 'res';
    if (fail[base]) throw new Error('boom');
    if (url.endsWith('/collections')) return collections;
    return items[base] ?? { type: 'FeatureCollection', features: [] };
  };
  return { calls, p: createFloodSources({ fetchJson, fetchText, surfaceWaterUrl: SW, recordedUrl: REC, reservoirUrl: RES }) };
}

test('surface water: asks the EA WMS in British National Grid for the right layer and takes the highest band', async () => {
  const { p, calls } = make({ wms: '{"features":[{"properties":{"risk_band":"Low"}},{"properties":{"risk_band":"High"}}]}' });
  const r = await p.check({ lat: 51.539, lng: 0.059 });
  assert.equal(r.surfaceWater.status, 'ok'); assert.equal(r.surfaceWater.band, 'high'); assert.equal(r.surfaceWater.mapped, true);
  const u = new URL(calls.find((c) => c.startsWith(SW) && /GetFeatureInfo/.test(c)));
  assert.equal(u.searchParams.get('LAYERS'), 'rofsw_4band'); assert.equal(u.searchParams.get('QUERY_LAYERS'), 'rofsw_4band'); assert.equal(u.searchParams.get('SRS'), 'EPSG:27700');
  const [x0, y0, x1, y1] = u.searchParams.get('BBOX').split(',').map(Number);
  assert.ok(x1 - x0 === 100 && y1 - y0 === 100, 'a 100 m box, well inside the 1:50,000 limit');
  assert.ok(x0 > 540000 && x0 < 548000 && y0 > 180000 && y0 < 190000, `E/N look like east London, got ${x0},${y0}`);
});

test('surface water: nothing mapped means very low; an unreadable reply means unavailable, never a guess; the next format is tried', async () => {
  assert.equal((await make({ wms: '{"features":[]}' }).p.check({ lat: 51.5, lng: 0 })).surfaceWater.band, 'very_low');
  assert.equal((await make({ wms: '{"features":[]}' }).p.check({ lat: 51.5, lng: 0 })).surfaceWater.mapped, false);
  assert.equal((await make({ wms: '<html>nope</html>' }).p.check({ lat: 51.5, lng: 0 })).surfaceWater.status, 'unavailable');
  assert.equal((await make({ fail: { wms: true }, wms: '' }).p.check({ lat: 51.5, lng: 0 })).surfaceWater.status, 'unavailable');
  const { p, calls } = make({ wms: (u) => (u.includes('INFO_FORMAT=application%2Fjson') ? '<ServiceException>no json</ServiceException>' : 'risk_band = Medium') });
  assert.equal((await p.check({ lat: 51.5, lng: 0 })).surfaceWater.band, 'medium');
  assert.ok(calls.filter((c) => c.startsWith(SW)).length >= 2);
});

test('recorded flood outlines: inside, near, outside; collection found by listing; properties read forgivingly', async () => {
  const here = { lat: 51.5005, lng: 0.0005 };
  const inside = make({ items: { rec: { features: [{ geometry: poly(0, 51.5), properties: { FLOOD_SOURCE: 'main river', start_date: '2007-07-20T00:00:00Z' } }] } } });
  const r = await inside.p.check(here);
  assert.equal(r.recorded.status, 'inside'); assert.equal(r.recorded.events[0].source, 'main river'); assert.equal(r.recorded.events[0].start, '2007-07-20');
  const items = inside.calls.find((c) => c.includes('/items'));
  assert.ok(items.startsWith(`${REC}/collections/flood_outlines/items?`) && /bbox=-?\d/.test(items) && items.includes('limit=50'));
  const near = make({ items: { rec: { features: [{ geometry: poly(0.0008, 51.5), properties: {} }] } } });     // starts about 20 m east
  const rn = (await near.p.check(here)).recorded;
  assert.equal(rn.status, 'near'); assert.ok(rn.nearestM > 10 && rn.nearestM < 40, `got ${rn.nearestM}`);
  assert.equal((await make({ items: { rec: { features: [{ geometry: poly(0.01, 51.6), properties: {} }] } } }).p.check(here)).recorded.status, 'outside');
  assert.equal((await make({ collections: { collections: [] } }).p.check(here)).recorded.status, 'unavailable');
  assert.equal((await make({ fail: { rec: true } }).p.check(here)).recorded.status, 'unavailable');
});

test('one source failing never blanks the others', async () => {
  const r = await make({ wms: '{"features":[]}', fail: { rec: true } }).p.check({ lat: 51.5, lng: 0 });
  assert.equal(r.surfaceWater.status, 'ok'); assert.equal(r.recorded.status, 'unavailable'); assert.equal(r.reservoir.status, 'outside');
});

test('OSM infrastructure: watercourses, substations and signals with distances, nearest first', async () => {
  const lat = 51.5, lng = 0, dLng = (m) => m / 69300, dLat = (m) => m / 110540;
  const overpass = async (q) => {
    assert.match(q, /waterway/); assert.match(q, /substation/); assert.match(q, /traffic_signals/);
    return { elements: [
      { type: 'way', tags: { waterway: 'stream', name: 'Mill Brook' }, geometry: [{ lat: lat - dLat(50), lon: lng + dLng(30) }, { lat: lat + dLat(50), lon: lng + dLng(30) }] },
      { type: 'way', tags: { waterway: 'ditch', tunnel: 'culvert' }, geometry: [{ lat: lat - dLat(50), lon: lng + dLng(6) }, { lat: lat + dLat(50), lon: lng + dLng(6) }] },
      { type: 'node', tags: { power: 'substation', operator: 'UK Power Networks' }, lat: lat + dLat(40), lon: lng },
      { type: 'node', tags: { highway: 'traffic_signals' }, lat, lon: lng + dLng(25) },
      { type: 'node', tags: { amenity: 'bench' }, lat, lon: lng },
    ] };
  };
  const r = await createOsmInfra({ overpass }).check({ lat, lng });
  assert.deepEqual(r.watercourses.map((w) => [w.kind, w.distanceM, w.culverted]), [['ditch', 6, true], ['stream', 30, false]]);
  assert.equal(r.substations[0].distanceM, 40); assert.equal(r.substations[0].operator, 'UK Power Networks');
  assert.equal(r.signals.length, 1); assert.equal(r.signals[0].distanceM, 25);
});

test('register readings for the new checks: states follow the data, and "none recorded" is never a bare pass for OSM data', () => {
  const live = (a) => Object.fromEntries(buildLiveRegister({ constraints: { flags: {}, items: [] }, ...a }, {}).checks.map((c) => [c.id, c.live]));
  const sw = (band, mapped = true) => ({ flood: { surfaceWater: { status: 'ok', band, mapped, text: band } } });
  assert.equal(live(sw('high'))['PI-08-02'].state, 'issue'); assert.equal(live(sw('medium'))['PI-08-02'].state, 'issue');
  assert.equal(live(sw('low'))['PI-08-02'].state, 'info'); assert.equal(live(sw('very_low', false))['PI-08-02'].state, 'pass');
  assert.match(live(sw('high'))['PI-08-02'].value, /not for property-level/);
  assert.equal(live({})['PI-08-02'].state, 'awaiting');
  assert.equal(live({ flood: { surfaceWater: { status: 'unavailable', reason: 'x' } } })['PI-08-02'].state, 'awaiting');
  const rec = (status, extra = {}) => ({ flood: { recorded: { status, events: [{ source: 'main river', start: '2007-07-20' }], nearM: 250, ...extra } } });
  assert.equal(live(rec('inside'))['PI-08-03'].state, 'issue'); assert.equal(live(rec('near', { nearestM: 80 }))['PI-08-03'].state, 'issue'); assert.equal(live(rec('outside'))['PI-08-03'].state, 'pass');
  assert.equal(live({ flood: { reservoir: { status: 'near', nearestM: 120, nearM: 250 } } })['PI-08-05'].state, 'info');
  const infra = { watercourses: [{ kind: 'stream', distanceM: 5, culverted: false }, { kind: 'river', distanceM: 60 }], substations: [{ distanceM: 30 }], signals: [] };
  assert.equal(live({ infra })['PI-08-08'].state, 'issue'); assert.equal(live({ infra })['PI-08-07'].state, 'info');
  assert.equal(live({ infra })['PI-10-03'].state, 'info'); assert.equal(live({ infra })['PI-11-03'].state, 'info');
  assert.equal(live({})['PI-11-03'].state, 'awaiting');
  assert.equal(live(sw('high'))['PI-08-12'].state, 'issue');
});
