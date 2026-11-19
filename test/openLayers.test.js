import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenLayers, parseAqma, distanceToAnyM, coverageIds, pickLdenCoverage, plausibleDb } from '../src/providers/openLayers.js';
import { buildLiveRegister } from '../src/services/intelligenceRegister.js';

const LAT = 51.5, LNG = -0.1;
const off = (m) => m / 110540; // metres north -> degrees latitude
const fc = (...features) => ({ type: 'FeatureCollection', features });

test('distanceToAnyM handles points, lines and polygons', () => {
  assert.ok(Math.abs(distanceToAnyM({ type: 'Point', coordinates: [LNG, LAT + off(30)] }, LAT, LNG) - 30) < 1);
  const line = { type: 'LineString', coordinates: [[LNG - 0.001, LAT + off(12)], [LNG + 0.001, LAT + off(12)]] };
  assert.ok(Math.abs(distanceToAnyM(line, LAT, LNG) - 12) < 1);
  const poly = { type: 'Polygon', coordinates: [[[LNG - 0.001, LAT - 0.001], [LNG + 0.001, LAT - 0.001], [LNG + 0.001, LAT + 0.001], [LNG - 0.001, LAT + 0.001], [LNG - 0.001, LAT - 0.001]]] };
  assert.equal(distanceToAnyM(poly, LAT, LNG), 0);
  assert.equal(distanceToAnyM(null, LAT, LNG), Infinity);
});

test('parseAqma keeps current entities and the documentation link', () => {
  const a = parseAqma({ entities: [{ name: 'AQMA No.1', reference: '405', notes: 'E06000063', 'documentation-url': 'https://uk-air.defra.gov.uk/aqma/details?aqma_ref=405', 'end-date': '' }, { name: 'old', 'end-date': '2001-01-01' }] });
  assert.equal(a.length, 1); assert.equal(a[0].reference, '405'); assert.match(a[0].url, /uk-air/);
});

test('noise helpers: coverage choice and plausible decibel values only', () => {
  const xml = '<wcs:CoverageId>abc__Road_Noise_Lnight_England_Round_4_All</wcs:CoverageId><wcs:CoverageId>abc__Road_Noise_Lden_England_Round_4_All</wcs:CoverageId>';
  assert.equal(pickLdenCoverage(coverageIds(xml)), 'abc__Road_Noise_Lden_England_Round_4_All');
  assert.equal(pickLdenCoverage(['x_Lnight']), null);
  assert.equal(plausibleDb([NaN, -96, 0, 58.2, 61.4]), 61.4);
  assert.equal(plausibleDb([-96, 0, NaN]), null); // no-data and zero are NOT a quiet reading
});

function layers({ aqma, defences, river, caps = '<wcs:CoverageId>x__Road_Noise_Lden_England_Round_4_All</wcs:CoverageId>', tiff = new Float64Array([58, 63.5]), raster = true, railUrl } = {}) {
  const fetchJson = async (url) => {
    if (url.includes('planning.data.gov.uk')) { assert.match(url, /dataset=air-quality-management-area/); return aqma ?? { entities: [] }; }
    if (url.endsWith('/collections')) return { collections: [{ id: 'c1' }] };
    if (url.includes('spatial-flood-defences')) return defences ?? fc();
    if (url.includes('statutory-main-river')) return river ?? fc();
    throw new Error(`unexpected ${url}`);
  };
  const fetchText = async () => caps;
  const fetchImpl = async () => ({ ok: true, headers: { get: () => (raster ? 'image/tiff' : 'text/xml') }, arrayBuffer: async () => new ArrayBuffer(8) });
  return createOpenLayers({ fetchJson, fetchText, fetchImpl, decode: async () => ({ width: 2, height: 1, values: tiff }), cfg: railUrl ? { noiseRailWcsUrl: railUrl } : {} });
}

test('provider: inside an AQMA, a defence and a main river nearby, noise sampled', async () => {
  const r = await layers({
    aqma: { entities: [{ name: 'AQMA No.1', reference: '405', 'end-date': '' }] },
    defences: fc({ geometry: { type: 'LineString', coordinates: [[LNG - 0.001, LAT + off(40)], [LNG + 0.001, LAT + off(40)]] }, properties: { asset_type: 'Wall', condition_grade: '4', standard_of_protection: '1 in 100' } }),
    river: fc({ geometry: { type: 'LineString', coordinates: [[LNG - 0.001, LAT + off(6)], [LNG + 0.001, LAT + off(6)]] }, properties: { name: 'River Test' } }),
  }).check({ lat: LAT, lng: LNG });
  assert.equal(r.aqma.status, 'inside');
  assert.equal(r.defences.assets[0].type, 'Wall'); assert.equal(r.defences.assets[0].condition, '4');
  assert.equal(r.mainRiver.rivers[0].name, 'River Test'); assert.ok(r.mainRiver.rivers[0].distanceM <= 7);
  assert.equal(r.noise.status, 'ok'); assert.equal(r.noise.lden, 63.5);
});

test('provider: failures stay separate and unclear noise is never a reading', async () => {
  const bad = await layers({ raster: false }).check({ lat: LAT, lng: LNG });
  assert.equal(bad.noise.status, 'unavailable'); assert.equal(bad.aqma.status, 'outside');
  const quiet = await layers({ tiff: new Float64Array([-96, 0]) }).check({ lat: LAT, lng: LNG });
  assert.equal(quiet.noise.status, 'no_value');
  const down = await createOpenLayers({ fetchJson: async () => { throw new Error('down'); }, fetchText: async () => { throw new Error('down'); } }).check({ lat: LAT, lng: LNG });
  for (const k of ['aqma', 'defences', 'mainRiver', 'noise']) assert.equal(down[k].status, 'unavailable', k);
});

const live = (a) => Object.fromEntries(buildLiveRegister({ constraints: { flags: {}, items: [] }, address: { lat: LAT, lng: LNG }, ...a }, {}).checks.map((c) => [c.id, c.live]));

test('register: the new live layers feed PI-13-01, 13-02, 08-06 and 08-07, and a loaded dataset would win', () => {
  const none = live({});
  for (const id of ['PI-13-01', 'PI-13-02', 'PI-08-06']) assert.equal(none[id].state, 'awaiting', id);
  const l = live({ layers: {
    aqma: { status: 'inside', areas: [{ name: 'AQMA No.1', reference: '405', url: 'https://uk-air.defra.gov.uk/aqma/details?aqma_ref=405' }] },
    defences: { status: 'near', count: 1, nearM: 250, assets: [{ distanceM: 40, type: 'Wall', condition: 'Poor', standardOfProtection: '1 in 100' }] },
    mainRiver: { status: 'near', nearM: 50, rivers: [{ distanceM: 6, name: 'River Test', tidal: false }] },
    noise: { status: 'ok', lden: 66, source: 'road', sources: [{ source: 'road', lden: 66 }] },
  } });
  assert.equal(l['PI-13-01'].state, 'issue'); assert.match(l['PI-13-01'].value, /uk-air/);
  assert.equal(l['PI-13-02'].state, 'issue');
  assert.equal(l['PI-08-06'].state, 'issue'); assert.match(l['PI-08-06'].value, /poor condition/);
  assert.equal(l['PI-08-07'].state, 'issue'); assert.match(l['PI-08-07'].value, /statutory main river/i);
  const quiet = live({ layers: { aqma: { status: 'outside', areas: [] }, noise: { status: 'ok', lden: 48, source: 'road', sources: [] }, defences: { status: 'outside', assets: [], nearM: 250 }, mainRiver: { status: 'outside', rivers: [], nearM: 50 } } });
  assert.equal(quiet['PI-13-01'].state, 'pass'); assert.match(quiet['PI-13-01'].value, /not proof/);
  assert.equal(quiet['PI-13-02'].state, 'pass'); assert.equal(quiet['PI-08-07'].state, 'info'); // no EA main river is never a pass
  assert.equal(live({ layers: { noise: { status: 'no_value' }, aqma: { status: 'unavailable' } } })['PI-13-02'].state, 'awaiting');
});
