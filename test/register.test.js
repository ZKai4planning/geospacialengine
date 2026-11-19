import test from 'node:test';
import assert from 'node:assert/strict';
// Deliberately imports nothing that needs config.js / express, so this file runs with no services and no network.
import { CHECKS } from '../src/data/intelligenceRegister.js';
import { COVERAGE_ROWS } from '../src/data/intelligenceCoverage.js';
import { buildCatalogue, buildLiveRegister, capabilities } from '../src/services/intelligenceRegister.js';
import { LIVE_EXTRA, COVERAGE_OVERRIDES } from '../src/register/checks.js';
import { DATASETS } from '../src/register/datasets.js';
import { createGeoLayers, createMemoryBackend, evaluateDataset } from '../src/register/geo.js';
import { buildRows, parseGeoFile } from '../src/register/geoParse.js';
import { addEvidence, withdrawEvidence, signOff, reviewStatus, requestSurvey, updateSurvey, submitOfficerReview, recordOfficerOutcome, EvidenceError } from '../src/register/evidence.js';
import { parseStandards, createMemoryStandards, validateStandard } from '../src/register/standards.js';
import { evaluateGate, MANDATORY } from '../src/register/gate.js';
import { parseExtras } from '../src/register/osmExtras.js';
import { buildDatasetGuide } from '../src/register/guide.js';
import { createRegisterService, requireReviewer } from '../src/services/registerService.js';

// ------------------------------------------------------------------------------------------------------------------------------ fixtures
const LAT = 51.5, LNG = -0.1;
const dLat = (m) => m / 111320, dLng = (m) => m / (111320 * Math.cos((LAT * Math.PI) / 180));
/** A closed [lng, lat] rectangle: centre offset (east, north) in metres, width, depth. */
const rect = (e, n, w, d) => { const x = LNG + dLng(e), y = LAT + dLat(n), hw = dLng(w / 2), hd = dLat(d / 2); return [[x - hw, y - hd], [x + hw, y - hd], [x + hw, y + hd], [x - hw, y + hd], [x - hw, y - hd]]; };
const poly = (e, n, w, d) => ({ type: 'Polygon', coordinates: [rect(e, n, w, d)] });
const line = (...pts) => ({ type: 'LineString', coordinates: pts.map(([e, n]) => [LNG + dLng(e), LAT + dLat(n)]) });
const point = (e, n) => ({ type: 'Point', coordinates: [LNG + dLng(e), LAT + dLat(n)] });

const baseApp = (over = {}) => ({
  id: 'a1', reference: 'PA-2026-123456',
  address: { fullAddress: '22 Example Road, London, E6 2AA', postcode: 'E6 2AA', lat: LAT, lng: LNG, uprn: '100023', uprnMatch: { confidence: 'high' }, classification: { use: 'residential' } },
  country: 'England', authority: { code: 'E09000025', name: 'Newham' },
  footprint: { ring: rect(0, 0, 6, 8), areaM2: 48 },
  constraints: { flags: {}, items: [] }, outlines: [], roads: [], trees: [], neighbours: [], powerLines: [],
  proposal: { type: 'rear_extension', depthM: 4, heightM: 3 },
  ...over,
});
const ev = (app, id, input) => ({ ...app, ...addEvidence(app, id, { kind: 'declaration', source: 'client', recordedBy: 'Ada Client', summary: 'Declared by the client', ...input }).patch });
const geoWith = (features, datasets = DATASETS) => createGeoLayers({ backend: createMemoryBackend({ features }), datasets });

// ------------------------------------------------------------------------------------------------------------------------------ coverage
test('every one of the 95 checks that were "not built" now has a reading and a coverage override', () => {
  const was = COVERAGE_ROWS.filter((r) => r[1] === 'missing').map((r) => r[0]);
  assert.equal(was.length, 95);
  const overridden = new Set(COVERAGE_OVERRIDES.map((r) => r[0]));
  for (const id of was) assert.ok(overridden.has(id), `${id} has no coverage override`);
  for (const id of was) assert.ok(LIVE_EXTRA[id] || id === 'PI-17-14', `${id} has no reading`);
  const cat = buildCatalogue({});
  assert.equal(cat.summary.missing, 0);
  assert.equal(cat.summary.total, 228);
  assert.equal(cat.summary.have + cat.summary.partial, 228);
  for (const c of cat.checks) assert.equal(c.route, null, 'a built check has no "route to close"');
});

test('the catalogue reports what each new check needs switched on, and does not pretend it is on', () => {
  const off = buildCatalogue({}).checks, on = buildCatalogue({ databaseUrl: 'x', reviewerToken: 't' }).checks;
  const get = (rows, id) => rows.find((c) => c.id === id);
  assert.equal(get(off, 'PI-17-11').runtime, 'off');
  assert.equal(get(on, 'PI-17-11').runtime, 'on');
  assert.equal(get(off, 'PI-08-02').runtime, 'off');          // flood dataset needs the geo store
  assert.equal(get(on, 'PI-08-02').runtime, 'on');
  assert.equal(get(off, 'PI-04-16').runtime, 'on');           // pure logic needs nothing
  assert.equal(capabilities({ databaseUrl: 'x', geoLayersEnabled: false }).geo, false);
});

test('a live register on an empty application never throws and passes nothing it cannot back', () => {
  const doc = buildLiveRegister({}, {});
  assert.equal(doc.checks.length, 228);
  assert.equal(doc.live.not_built, 0);
  assert.equal(doc.live.pass, 0);
  assert.equal(doc.live.pass + doc.live.issue + doc.live.info + doc.live.awaiting, 228);
  for (const c of doc.checks) assert.equal(c.live.signOff, null);
  assert.equal(doc.readiness.state, 'held');
});

// ------------------------------------------------------------------------------------------------------------------------------ geo layers
test('geo: a dataset that is not loaded is "unavailable", never "outside" - and the check says awaiting', async () => {
  const geo = geoWith([]);
  const out = await geo.lookupAll({ lat: LAT, lng: LNG, authority: { code: 'X', name: 'X' } });
  assert.equal(out.loaded, 0);
  const doc = buildLiveRegister(baseApp({ geo: out }), {});
  const c = doc.checks.find((x) => x.id === 'PI-13-01');
  assert.equal(c.live.state, 'awaiting');
  assert.match(c.live.value, /not loaded/);
});

test('geo: polygon, line, point and keyed datasets are measured against the building, not just the address point', async () => {
  const feats = [
    { dataset: 'aqma', authority: '', geom: poly(0, 0, 400, 400), props: { pollutant: 'NO2' }, name: 'Town centre AQMA' },
    { dataset: 'sewers', authority: '', geom: line([-20, 3.2], [20, 3.2]), props: { type: 'foul', adopted: true } },           // 0.2 m from the building edge (building spans -4..+4 north)
    { dataset: 'comah-sites', authority: '', geom: { ...point(300, 0), }, props: { radiusM: 500 }, name: 'Fuel depot' },
    { dataset: 'ofcom-broadband', authority: '', key: 'E62AA', props: { maxDownMbps: 900, gigabit: true } },
    { dataset: 'ea-rofsw', authority: '', geom: poly(0, 0, 400, 400), props: { risk: 'High' } },
    { dataset: 'ea-rofsw', authority: '', geom: poly(0, 0, 400, 400), props: { risk: 'Low' } },
  ];
  const site = { lat: LAT, lng: LNG, postcode: 'E6 2AA', uprn: '100023', authority: { code: 'E09000025', name: 'Newham' }, ring: rect(0, 0, 6, 8) };
  const out = await geoWith(feats).lookupAll(site);
  assert.equal(out.results.aqma.status, 'inside');
  assert.equal(out.results.sewers.status, 'near');
  assert.ok(out.results.sewers.features[0].distanceM < 3, 'the sewer is measured from the building outline');
  assert.equal(out.results['comah-sites'].status, 'inside', 'inside the hazard consultation radius');
  assert.equal(out.results['ofcom-broadband'].status, 'inside');
  assert.equal(out.results['ea-rofsw'].features[0].props.risk, 'High', 'the worst band wins');

  const doc = buildLiveRegister(baseApp({ geo: out }), {});
  const state = (id) => doc.checks.find((c) => c.id === id).live;
  assert.equal(state('PI-13-01').state, 'issue');
  assert.equal(state('PI-08-10').state, 'issue');
  assert.match(state('PI-08-10').value, /Public sewer/);
  assert.equal(state('PI-13-05').state, 'issue');
  assert.equal(state('PI-10-14').state, 'info');
  assert.equal(state('PI-08-02').state, 'issue');
  assert.match(state('PI-13-01').value, /Air Quality/);
});

test('geo: council data is only used for its own council', async () => {
  const feats = [{ dataset: 'council-enforcement', authority: 'E09000007', geom: point(2, 2), props: { status: 'live', noticeType: 'Breach of condition' } }];
  const other = await geoWith(feats).lookupAll({ lat: LAT, lng: LNG, authority: { code: 'E09000025', name: 'Newham' } });
  assert.equal(other.results['council-enforcement'], undefined);
  const own = await geoWith(feats).lookupAll({ lat: LAT, lng: LNG, authority: { code: 'E09000007', name: 'Camden' } });
  assert.equal(own.results['council-enforcement'].status, 'near', 'a notice point 2.8 m from the address is near, not inside');
  const doc = buildLiveRegister(baseApp({ authority: { code: 'E09000007', name: 'Camden' }, geo: own }), {});
  assert.equal(doc.checks.find((c) => c.id === 'PI-04-05').live.state, 'issue');
});

test('geo: an extract that covers only part of the country is "unavailable" outside it, not "clear"', async () => {
  const backend = createMemoryBackend({ features: [{ dataset: 'aqma', authority: '', geom: poly(5000, 5000, 10, 10), props: {} }], meta: [{ dataset: 'aqma', authority: '', features: 1, coverage: [-3, 53, -2, 54] }] });
  const out = await createGeoLayers({ backend }).lookup('aqma', { lat: LAT, lng: LNG, authority: {} });
  assert.equal(out.status, 'unavailable');
});

test('geo: parsing a GIS export (BNG GeoJSON, JSON-lines, CSV) gives rows in WGS84 and refuses features outside Great Britain', () => {
  const fc = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { RISK: 'Medium', NAME: 'x' }, geometry: { type: 'Polygon', coordinates: [[[530000, 180000], [530100, 180000], [530100, 180100], [530000, 180100], [530000, 180000]]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10, 10] } },
  ] });
  const { rows, skipped, coverage } = buildRows(parseGeoFile(fc), { crs: 'auto', ratingField: 'RISK', ratingProp: 'risk', nameField: 'NAME' });
  assert.equal(rows.length, 1); assert.equal(skipped, 1);
  assert.equal(rows[0].props.risk, 'Medium'); assert.equal(rows[0].name, 'x');
  assert.ok(rows[0].bbox[0] > -1 && rows[0].bbox[0] < 1 && rows[0].bbox[1] > 51 && rows[0].bbox[1] < 52, 'reprojected from British National Grid');
  assert.equal(coverage.length, 4);
  const csv = parseGeoFile('postcode,maxDownMbps,gigabit\nE6 2AA,900,yes\n');
  const k = buildRows(csv, { keyField: 'postcode', keyKind: 'postcode' });
  assert.equal(k.rows.length, 0, 'a keyed CSV row with no coordinates is only usable by the keyed path (see importer)');
});

// ------------------------------------------------------------------------------------------------------------------------------ logic checks
const live = (app, id, cfg = {}) => buildLiveRegister(app, cfg).checks.find((c) => c.id === id).live;

test('PI-07-10 heritage statement: listed, conservation, national park (regression: these flags did not exist), and clear', () => {
  assert.equal(live(baseApp({ constraints: { flags: { listedBuilding: true }, items: [] } }), 'PI-07-10').state, 'issue');
  assert.equal(live(baseApp({ constraints: { flags: { conservationArea: true }, items: [] } }), 'PI-07-10').state, 'issue');
  assert.equal(live(baseApp({ constraints: { flags: {}, items: [{ dataset: 'world-heritage-site' }] } }), 'PI-07-10').state, 'issue');
  assert.equal(live(baseApp(), 'PI-07-10').state, 'pass');
  assert.match(live(baseApp({ constraints: { flags: {}, items: [{ dataset: 'national-park' }] } }), 'PI-16-06').value, /sensitive area/);
});

test('PI-12-09 BNG: England only; PD and householder exempt; otherwise it applies', () => {
  assert.equal(live(baseApp({ country: 'Wales' }), 'PI-12-09').state, 'info');
  assert.equal(live(baseApp({ assessment: { verdict: 'permitted' } }), 'PI-12-09').state, 'pass');
  assert.equal(live(baseApp(), 'PI-12-09').state, 'pass');
  assert.equal(live(baseApp({ proposal: { type: 'rear_extension', usedAsHome: true } }), 'PI-12-09').state, 'issue');
});

test('PI-13-08 asbestos: age band decides; no age is "awaiting", never a pass', () => {
  assert.equal(live(baseApp({ epc: { ageBand: 'England and Wales: 1930-1949' } }), 'PI-13-08').state, 'issue');
  assert.equal(live(baseApp({ epc: { ageBand: 'England and Wales: 2007 onwards' } }), 'PI-13-08').state, 'pass');
  assert.equal(live(baseApp(), 'PI-13-08').state, 'awaiting');
});

test('PI-12-02 conservation-area trees and PI-08-13 sequential test', () => {
  assert.equal(live(baseApp({ constraints: { flags: { conservationArea: true }, items: [] } }), 'PI-12-02').state, 'issue');
  assert.equal(live(baseApp(), 'PI-12-02').state, 'pass');
  const flood = { flags: { floodZone: true }, items: [{ dataset: 'flood-risk-zone', name: 'Flood zone 3' }] };
  assert.equal(live(baseApp({ constraints: flood }), 'PI-08-13').state, 'info', 'a householder extension does not normally need the test');
  assert.equal(live(baseApp({ constraints: flood, proposal: { type: 'rear_extension', usedAsHome: true } }), 'PI-08-13').state, 'issue');
  assert.equal(live(baseApp(), 'PI-08-13').state, 'pass');
});

test('PI-10-06 overhead line clearance: inside the screening buffer is an issue; surveyed vs DNO minimum overrides it', () => {
  const near = baseApp({ powerLines: [{ kind: 'minor_line', label: 'Overhead line', line: [[LNG + dLng(-20), LAT + dLat(8)], [LNG + dLng(20), LAT + dLat(8)]] }] });
  assert.equal(live(near, 'PI-10-06').state, 'issue');
  const far = baseApp({ powerLines: [{ kind: 'minor_line', label: 'Overhead line', line: [[LNG + dLng(-20), LAT + dLat(40)], [LNG + dLng(20), LAT + dLat(40)]] }] });
  assert.equal(live(far, 'PI-10-06').state, 'info');
  const surveyed = ev(near, 'PI-10-06', { kind: 'survey', source: 'surveyor', values: { surveyedClearanceM: 3, dnoMinimumM: 5.8 } });
  assert.equal(live(surveyed, 'PI-10-06').state, 'issue');
  assert.match(live(surveyed, 'PI-10-06').value, /BELOW/);
});

test('PI-06-07 privacy: upper-level work near a neighbour is an issue; ground-floor work is information only', () => {
  const nb = (d) => [{ id: 'n1', ring: rect(0, 4 + d + 4, 8, 8) }];
  const dormer = { proposal: { type: 'rear_dormer' }, map: { layers: [{ kind: 'proposal', ring: rect(0, 0, 4, 3) }] } };
  assert.equal(live(baseApp({ ...dormer, neighbours: nb(6) }), 'PI-06-07').state, 'issue');       // ~8 m between buildings: under 12 m
  assert.equal(live(baseApp({ ...dormer, neighbours: nb(30) }), 'PI-06-07').state, 'pass');
  assert.equal(live(baseApp({ map: { layers: [{ kind: 'proposal', ring: rect(0, 6, 4, 3) }] }, neighbours: nb(6) }), 'PI-06-07').state, 'info');
});

test('PI-11-10 visibility splays: a mapped barrier inside the splay is flagged; a clear splay is information; classified roads need a speed', () => {
  const road = (classified) => [{ id: 'r1', classified, widthM: 6, line: [[LNG + dLng(-60), LAT + dLat(-14)], [LNG + dLng(60), LAT + dLat(-14)]] }];
  const wall = { kind: 'wall', line: [[LNG + dLng(-1), LAT + dLat(-10)], [LNG + dLng(1), LAT + dLat(-10)]] };
  assert.equal(live(baseApp({ roads: road(false) }), 'PI-11-10').state, 'info');
  assert.equal(live(baseApp({ roads: road(false), barriers: [wall] }), 'PI-11-10').state, 'issue');
  assert.equal(live(baseApp({ roads: road(true) }), 'PI-11-10').state, 'awaiting');
  assert.equal(live(baseApp({ roads: road(true), ...{ evidence: ev(baseApp(), 'PI-11-10', { kind: 'survey', source: 'surveyor', values: { speedMph: 30 } }).evidence } }), 'PI-11-10').state, 'info');
});

test('PI-04-16 planning-history completeness is never "complete" without a council-register audit', () => {
  const h = { here: [{ receivedOn: '2019-04-01', outcome: 'approved' }], nearby: [], radiusM: 150 };
  const partial = live(baseApp({ history: h, epc: { ageBand: '1900-1929' } }), 'PI-04-16');
  assert.equal(partial.state, 'info'); assert.match(partial.value, /PARTIAL/);
  const audited = live(ev(baseApp({ history: h }), 'PI-04-16', { kind: 'document', source: 'council', values: { councilRegisterSearched: true, aliasesSearched: true } }), 'PI-04-16');
  assert.match(audited.value, /audited/);
  assert.equal(live(baseApp(), 'PI-04-16').state, 'awaiting');
});

test('PI-15-10 licensing: needs designation data or occupancy before it concludes', async () => {
  assert.equal(live(baseApp(), 'PI-15-10').state, 'awaiting');
  const mand = ev(baseApp(), 'PI-15-10', { values: { occupants: 5, households: 3 } });
  assert.equal(live(mand, 'PI-15-10').state, 'issue');
  const out = await geoWith([{ dataset: 'licensing-selective', authority: 'E09000025', geom: poly(0, 0, 500, 500), props: { effectiveFrom: '2025-01-01' } }]).lookupAll({ lat: LAT, lng: LNG, authority: { code: 'E09000025', name: 'Newham' } });
  assert.equal(live(baseApp({ geo: out }), 'PI-15-10').state, 'issue');
});

test('OSM extras: substations and traffic signals are read from what Overpass returned', () => {
  const parsed = parseExtras({ elements: [
    { type: 'node', id: 1, lat: LAT + dLat(40), lon: LNG, tags: { power: 'substation', voltage: '11000', operator: 'UKPN' } },
    { type: 'node', id: 2, lat: LAT, lon: LNG + dLng(30), tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 3, lat: LAT, lon: LNG + dLng(60), tags: { highway: 'crossing', crossing: 'traffic_signals' } },
  ] }, { lat: LAT, lng: LNG });
  assert.equal(parsed.substations.length, 1); assert.equal(parsed.signals.length, 2);
  const a = baseApp({ extras: { ...parsed, substationRadiusM: 150, signalRadiusM: 100 } });
  assert.match(live(a, 'PI-10-03').value, /substation/);
  assert.match(live(a, 'PI-11-03').value, /2 traffic signal/);
  assert.equal(live(baseApp(), 'PI-10-03').state, 'awaiting');
});

// ------------------------------------------------------------------------------------------------------------------------------ council standards
test('standards: validated, source required, matched to a council by code or name', async () => {
  const rows = parseStandards({ parking: { data: { type: 'minimum', bedrooms: { 1: 1, 2: 1.5, 3: 2 } }, source: 'Local Plan 2021, App. 4', retrievedOn: '2026-11-01' }, cycle: { data: { perDwelling: { 1: 1, 2: 2 } }, source: 'LP' } });
  assert.equal(rows.length, 2);
  assert.throws(() => parseStandards({ parking: { data: { bedrooms: { 1: 1 } } } }), /source/);
  assert.throws(() => parseStandards({ parking: { data: { bedrooms: { one: 1 } }, source: 's' } }), /bedroom/);
  assert.throws(() => validateStandard('privacy', { backToBackM: 2, windowToBlankM: 12 }), /between/);
  assert.throws(() => validateStandard('colour', {}), /Unknown/);

  const store = createMemoryStandards([{ authority: 'E09000025', topic: 'parking', data: rows[0].data, source: rows[0].source }]);
  assert.ok((await store.forAuthority({ code: 'E09000025' })).parking);
  assert.ok((await store.forAuthority({ name: 'London Borough of Newham', code: null }).catch(() => ({}))).parking === undefined, 'name match is on the stored authority text, not guessed');
  assert.deepEqual(await store.forAuthority({ code: 'E09000007', name: 'Camden' }), {});
});

test('standards feed the checks: parking compares spaces to the council figure; no standard = awaiting', async () => {
  const std = (await createMemoryStandards([{ authority: 'E09000025', topic: 'parking', data: { type: 'minimum', bedrooms: { 1: 1, 2: 1.5, 3: 2 } }, source: 'Local Plan' }]).forAuthority({ code: 'E09000025' }));
  const withStd = baseApp({ geo: { results: {}, standards: std }, epc: { habitableRooms: 4 } });
  assert.equal(live(withStd, 'PI-06-09').state, 'info');
  const short = ev(withStd, 'PI-06-09', { values: { proposedSpaces: 1 } });
  assert.equal(live(short, 'PI-06-09').state, 'issue');
  const ok = ev(withStd, 'PI-06-09', { values: { proposedSpaces: 2 } });
  assert.equal(live(ok, 'PI-06-09').state, 'pass');
  assert.equal(live(baseApp({ geo: { results: {}, standards: {} } }), 'PI-06-09').state, 'awaiting');
});

// ------------------------------------------------------------------------------------------------------------------------------ evidence, sign-off, surveys, officer review
test('evidence: validated, kept for the audit trail, and withdrawn only with a named person and a reason', () => {
  let app = baseApp();
  assert.throws(() => addEvidence(app, 'PI-99-99', { kind: 'declaration', source: 'client', recordedBy: 'Ada', summary: 'hello there' }), (e) => e instanceof EvidenceError && e.status === 404);
  assert.throws(() => addEvidence(app, 'PI-02-05', { kind: 'declaration', source: 'client', recordedBy: 'A', summary: 'x' }), /required/);
  assert.throws(() => addEvidence(app, 'PI-02-05', { kind: 'rumour', source: 'client', recordedBy: 'Ada', summary: 'hello there' }), /kind/);
  app = ev(app, 'PI-02-05', { values: { present: true, affectsProposal: true } });
  const r = live(app, 'PI-02-05');
  assert.equal(r.state, 'issue'); assert.match(r.value, /not legally verified/);
  const id = app.evidence['PI-02-05'][0].id;
  assert.throws(() => withdrawEvidence(app, 'PI-02-05', id, { by: 'Ada' }), /reason/);
  app = { ...app, ...withdrawEvidence(app, 'PI-02-05', id, { by: 'Ada Client', reason: 'Entered on the wrong property' }).patch };
  assert.equal(app.evidence['PI-02-05'].length, 1, 'never deleted');
  assert.equal(live(app, 'PI-02-05').state, 'awaiting');
});

test('evidence-only checks never pass on their own: adverse possession is never decided by the engine', () => {
  const none = live(baseApp(), 'PI-02-11'); assert.equal(none.state, 'awaiting'); assert.match(none.value, /Never decided automatically/);
  const some = live(ev(baseApp(), 'PI-02-11', { values: { indicatorsFound: false } }), 'PI-02-11');
  assert.notEqual(some.state, 'pass');
});

test('sign-off: needs a named reviewer, role and (unless accepting) a reason; goes stale when the reading or the evidence changes', () => {
  let app = ev(baseApp(), 'PI-02-05', { values: { present: true, affectsProposal: false } });
  const reading = live(app, 'PI-02-05');
  assert.throws(() => signOff(app, 'PI-02-05', { decision: 'accepted', reviewer: 'Dr R. Singh' }, reading), /role/);
  assert.throws(() => signOff(app, 'PI-02-05', { decision: 'rejected', reviewer: 'Dr R. Singh', role: 'Conveyancer' }, reading), /notes/);
  assert.throws(() => signOff(app, 'PI-02-05', { decision: 'accepted', reviewer: 'R', role: 'x' }, { state: 'not_built' }), /nothing to sign|reviewer|role/);
  const { patch, record } = signOff(app, 'PI-02-05', { decision: 'accepted', reviewer: 'Dr R. Singh', role: 'Conveyancer (SRA)' }, reading, { now: '2026-11-18T09:00:00Z' });
  app = { ...app, ...patch };
  assert.equal(record.at, '2026-11-18T09:00:00.000Z');
  assert.equal(reviewStatus(app, 'PI-02-05', reading).status, 'verified');
  const doc = buildLiveRegister(app, {});
  assert.equal(doc.checks.find((c) => c.id === 'PI-02-05').live.signOff.status, 'verified');
  app = ev(app, 'PI-02-05', { values: { present: true, affectsProposal: true } });                       // new evidence arrives after sign-off
  assert.equal(buildLiveRegister(app, {}).checks.find((c) => c.id === 'PI-02-05').live.signOff.status, 'stale');
});

test('surveys: draft > requested > booked > returned; a returned survey becomes evidence on each check it covered', () => {
  let app = baseApp();
  const { survey, patch } = requestSurvey(app, { kind: 'physical', checkIds: ['PI-14-04', 'PI-14-11'], requestedBy: 'Ada Client' }, { id: 's1' });
  app = { ...app, ...patch };
  assert.equal(survey.status, 'draft'); assert.equal(survey.brief.scope.length, 2);
  assert.match(survey.brief.scope[0].evidenceRequired, /./);
  assert.throws(() => updateSurvey(app, 's1', { status: 'returned', items: [] }), /cannot become/);
  for (const [status, extra] of [['requested', {}], ['booked', { bookedFor: '2026-12-01', surveyor: 'Acme Surveys' }]]) { const r = updateSurvey(app, 's1', { status, ...extra }); app = { ...app, ...r.patch }; }
  assert.throws(() => updateSurvey(app, 's1', { status: 'returned', items: [{ checkId: 'PI-09-15', summary: 'not in scope' }] }), /scope/);
  const done = updateSurvey(app, 's1', { status: 'returned', items: [{ checkId: 'PI-14-04', summary: 'Chimney breast is load-bearing', values: { loadbearingKnown: true } }, { checkId: 'PI-14-11', summary: 'Condition fair', values: { overallCondition: 'fair' } }] });
  app = { ...app, ...done.patch };
  assert.equal(app.evidence['PI-14-04'][0].kind, 'survey'); assert.equal(app.evidence['PI-14-04'][0].source, 'surveyor');
  assert.equal(live(app, 'PI-14-04').state, 'info');
  assert.equal(live(app, 'PI-17-10').state, 'info');
});

test('officer review queue: one pending review at a time; the officer records an outcome with notes unless accepting', () => {
  let app = baseApp();
  const sub = submitOfficerReview(app, { submittedBy: 'Ada Client', lpaReference: '26/0123/HH', checkIds: ['PI-05-18'] }, { id: 'r1' });
  app = { ...app, ...sub.patch };
  assert.throws(() => submitOfficerReview(app, { submittedBy: 'Ada Client' }), /already pending/);
  assert.throws(() => recordOfficerOutcome(app, 'r1', { outcome: 'amended', officer: 'P. Officer' }), /notes/);
  const out = recordOfficerOutcome(app, 'r1', { outcome: 'accepted', officer: 'P. Officer' });
  app = { ...app, ...out.patch };
  assert.equal(app.officerReviews[0].status, 'closed');
  assert.match(live(app, 'PI-17-12').value, /26\/0123\/HH/);
});

// ------------------------------------------------------------------------------------------------------------------------------ gate
test('gate: held on an empty application; released only when identity, mandatory data, issues and the verdict are all settled', () => {
  const empty = buildLiveRegister({}, {});
  assert.equal(empty.readiness.state, 'held');
  assert.equal(empty.checks.find((c) => c.id === 'PI-17-14').live.state, 'issue');

  const mk = (state, extra = {}) => ({ live: { state, value: 'v' }, review: null, name: 'n', ...extra });
  const rows = [...MANDATORY.map(([id]) => ({ id, ...mk('info') })), { id: 'PI-08-02', ...mk('issue') }];
  const app = baseApp();
  const held = evaluateGate(app, rows);
  assert.deepEqual([...new Set(held.blockers.map((b) => b.code))].sort(), ['issue', 'verdict']);

  const signed = { status: 'verified', reviewer: 'A. Planner', role: 'MRTPI', at: '2026-11-18' };
  const verdictRow = (r) => (r.id === 'PI-05-18' ? { ...r, review: signed } : r);
  const afterVerdict = evaluateGate(app, rows.map(verdictRow));
  assert.deepEqual(afterVerdict.blockers.map((b) => b.code), ['issue']);

  const excepted = ev(app, 'PI-08-02', { kind: 'exception', source: 'reviewer', recordedBy: 'A. Planner', summary: 'Surface-water risk addressed in the drainage report' });
  const ready = evaluateGate(excepted, rows.map(verdictRow));
  assert.equal(ready.state, 'ready'); assert.equal(ready.withExceptions, true); assert.equal(ready.exceptions.length, 1);

  const stale = evaluateGate(app, rows.map((r) => (r.id === 'PI-08-02' ? { ...r, review: { ...signed, status: 'stale' } } : verdictRow(r))));
  assert.match(stale.blockers[0].message, /out of date/);

  const lowId = evaluateGate({ ...app, address: { ...app.address, uprnMatch: { confidence: 'low' } } }, rows.map(verdictRow));
  assert.ok(lowId.blockers.some((b) => b.code === 'identity'));
});

// ------------------------------------------------------------------------------------------------------------------------------ service
const makeStore = (apps = []) => { const m = new Map(apps.map((a) => [a.id, a])); return { m, async get(id) { return m.get(id) ?? null; }, async update(id, p) { const c = m.get(id); if (!c) return null; const n = { ...c, ...p }; m.set(id, n); return n; }, async listPendingReviews() { return [...m.values()].filter((a) => (a.officerReviews ?? []).some((r) => r.status === 'pending')); } }; };

test('register service: enrich adds geo + standards + OSM extras once; failures leave the checks "awaiting" and are not retried at once', async () => {
  const app = baseApp();
  const store = makeStore([app]);
  let extrasCalls = 0, fail = true, t = 1_000_000;
  const extras = { async find() { extrasCalls++; if (fail) throw new Error('overpass down'); return { substations: [], signals: [], substationRadiusM: 150, signalRadiusM: 100 }; } };
  const geo = geoWith([{ dataset: 'aqma', authority: '', geom: poly(0, 0, 400, 400), props: {} }]);
  const standards = createMemoryStandards([{ authority: 'E09000025', topic: 'privacy', data: { backToBackM: 20, windowToBlankM: 10 }, source: 'SPD' }]);
  const svc = createRegisterService({ store, applicationService: { load: (id) => store.get(id) }, geo, standards, extras, cfg: {}, now: () => t });
  let doc = await svc.live('a1');
  assert.equal(doc.checks.find((c) => c.id === 'PI-13-01').live.state, 'issue');
  assert.equal(doc.checks.find((c) => c.id === 'PI-10-03').live.state, 'awaiting');
  await svc.live('a1'); assert.equal(extrasCalls, 1, 'a failed lookup is not repeated straight away');
  t += 6 * 60_000; fail = false;
  doc = await svc.live('a1'); assert.equal(extrasCalls, 2);
  assert.equal(doc.checks.find((c) => c.id === 'PI-10-03').live.state, 'info');
  await svc.live('a1'); assert.equal(extrasCalls, 2, 'stored once it succeeds');
  assert.ok(store.m.get('a1').extras, 'persisted on the draft');
  assert.equal(store.m.get('a1').geo, undefined, 'geo results are never stored on the draft');
});

test('register service: sign-off signs the engine\'s own current reading, and the gate / enforcement follow', async () => {
  const app = ev(baseApp(), 'PI-02-05', { values: { present: true, affectsProposal: false } });
  const store = makeStore([app]);
  const svc = createRegisterService({ store, applicationService: { load: (id) => store.get(id) }, cfg: { readinessEnforce: true } });
  await assert.rejects(() => svc.requireReady('a1'), (e) => e.status === 409 && e.details.blockers.length > 0);
  await assert.rejects(() => svc.signOff('a1', 'PI-99-99', { decision: 'accepted', reviewer: 'R. Singh', role: 'x' }), (e) => e.status === 404);
  const rec = await svc.signOff('a1', 'PI-02-05', { decision: 'accepted', reviewer: 'Dr R. Singh', role: 'Conveyancer' });
  assert.equal(rec.reading.state, 'info');
  const doc = await svc.live('a1');
  assert.equal(doc.checks.find((c) => c.id === 'PI-02-05').live.signOff.status, 'verified');
  const e = await svc.addEvidence('a1', 'PI-02-06', { kind: 'document', source: 'conveyancer', recordedBy: 'Ada', summary: 'Deed of easement reviewed', values: { present: false } });
  assert.ok(e.id);
  assert.equal((await svc.evidence('a1', 'PI-02-06')).evidence.length, 1);
  await assert.rejects(() => svc.addEvidence('a1', 'PI-02-06', { kind: 'document' }), (x) => x.status === 400);
  const relaxed = createRegisterService({ store, applicationService: { load: (id) => store.get(id) }, cfg: {} });
  await relaxed.requireReady('a1');                                                                      // enforcement is off by default
});

test('register service: surveys, officer reviews and the council queue', async () => {
  const a = baseApp({ id: 'a1' }), b = baseApp({ id: 'b2', reference: 'PA-2026-222222' });
  const store = makeStore([a, b]);
  const svc = createRegisterService({ store, applicationService: { load: (id) => store.get(id) }, cfg: {} });
  const s = await svc.requestSurvey('a1', { kind: 'digital', checkIds: ['PI-14-10'], requestedBy: 'Ada' });
  await svc.updateSurvey('a1', s.id, { status: 'requested' });
  assert.equal((await svc.surveys('a1')).surveys[0].status, 'requested');
  const r = await svc.submitOfficerReview('a1', { submittedBy: 'Ada Client', lpaReference: '26/1' });
  assert.equal((await svc.reviewQueue()).queue.length, 1);
  await svc.recordOfficerOutcome('a1', r.id, { outcome: 'accepted', officer: 'P. Officer' });
  assert.equal((await svc.reviewQueue()).queue.length, 0);
});

test('reviewer token: closed when unset, 401 without a token, 403 when wrong, passes with the right one', () => {
  const run = (cfg, header) => { let err = 'called'; requireReviewer(cfg)({ get: () => header }, {}, (e) => { err = e ? e.status : 'ok'; }); return err; };
  assert.equal(run({}, 'Bearer x'), 403);
  assert.equal(run({ reviewerToken: 's3cret' }, undefined), 401);
  assert.equal(run({ reviewerToken: 's3cret' }, 'Bearer nope'), 403);
  assert.equal(run({ reviewerToken: 's3cret' }, 'Bearer s3cret'), 'ok');
});

// ------------------------------------------------------------------------------------------------------------------------------ guide + catalogue integrity
test('every dataset names real checks, and the loading guide covers every dataset with a command', () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  for (const d of DATASETS) { assert.ok(d.checks.length, d.key); for (const c of d.checks) assert.ok(ids.has(c), `${d.key} feeds unknown check ${c}`); assert.ok(d.obtain && d.publisher && d.licence, d.key); }
  assert.equal(new Set(DATASETS.map((d) => d.key)).size, DATASETS.length);
  const guide = buildDatasetGuide();
  for (const d of DATASETS) assert.ok(guide.includes(`--dataset ${d.key} `), `${d.key} missing from the guide`);
  assert.ok(guide.includes('--standards'));
  // Links are allowed only for publisher pages that were checked against the publisher's own catalogue; any other host is an invented link.
  const CONFIRMED_HOSTS = new Set(['www.gov.uk', 'environment.data.gov.uk', 'www.planning.data.gov.uk', 'files.planning.data.gov.uk']);
  for (const m of guide.matchAll(/https?:\/\/([^\/\s)]+)/g)) assert.ok(CONFIRMED_HOSTS.has(m[1]), `the guide never invents a download link (${m[1]})`);
});

test('every dataset-backed check reads its dataset: loaded-and-empty gives a limited pass, not-loaded gives awaiting', async () => {
  const site = { lat: LAT, lng: LNG, postcode: 'E6 2AA', uprn: '100023', authority: { code: 'E09000025', name: 'Newham' }, ring: rect(0, 0, 6, 8) };
  // one far-away feature per dataset: every dataset becomes "loaded", none touches the site
  const feats = DATASETS.map((d) => ({ dataset: d.key, authority: d.scope === 'authority' ? 'E09000025' : '', geom: poly(9000, 9000, 10, 10), key: d.matchBy === 'postcode' ? 'ZZ99ZZ' : undefined, props: { risk: 'low' } }));
  const out = await geoWith(feats).lookupAll(site);
  assert.equal(out.loaded, DATASETS.length);
  const doc = buildLiveRegister(baseApp({ geo: out }), {});
  for (const d of DATASETS) for (const id of d.checks) {
    const r = doc.checks.find((c) => c.id === id).live;
    assert.notEqual(r.state, 'not_built', id);
    assert.ok(!/not loaded|geo layers are off/.test(r.value) || DATASETS.filter((x) => x.checks.includes(id)).length > 1, `${id} still says its data is not loaded`);
  }
  assert.match(doc.checks.find((c) => c.id === 'PI-13-01').live.value, /limited to the loaded data/);
  assert.equal(doc.checks.find((c) => c.id === 'PI-13-01').live.state, 'pass');
});

test('evaluateDataset is exported and pure (same input, same answer)', () => {
  const def = DATASETS.find((d) => d.key === 'aqma');
  const c = [{ ref: 'x', geom: poly(0, 0, 100, 100), props: {} }];
  const a = evaluateDataset(def, c, { lat: LAT, lng: LNG }, {}), b = evaluateDataset(def, c, { lat: LAT, lng: LNG }, {});
  assert.deepEqual(a, b); assert.equal(a.status, 'inside');
});
