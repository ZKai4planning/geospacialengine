import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyRing } from '../src/utils/simplify.js';
import { areaFromEntity, createConstraintAreas, AREA_DATASETS } from '../src/providers/constraintAreas.js';
import { roadClass, roadFromElement, powerLineFromElement } from '../src/utils/osmTags.js';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { streetCheck } from '../src/services/frontSpace.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { traceGpdo } from '../src/services/gpdoEngine.js';
import { assessLpa } from '../src/services/lpaPolicy.js';
import { buildMap } from '../src/services/mapService.js';

const LAT = 51.5, LNG = -0.1, MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const ll = ([x, y]) => [LNG + x / MX, LAT + y / MY];
const ring = (pts) => [...pts, pts[0]].map(ll);
const wkt = (pts) => `POLYGON ((${[...pts, pts[0]].map(([x, y]) => { const [lng, lat] = ll([x, y]); return `${lng} ${lat}`; }).join(', ')}))`;
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('simplifyRing keeps the shape of a big outline within a point cap', () => {
  const circle = Array.from({ length: 2000 }, (_, i) => { const a = (i / 2000) * 2 * Math.PI; return ll([100 * Math.cos(a), 100 * Math.sin(a)]); });
  const big = [...circle, circle[0]], s = simplifyRing(big, { tolM: 0.5, maxPts: 120 });
  assert.ok(s.length <= 121 && s.length > 20, `${s.length} points`);
  assert.deepEqual(s[0], s.at(-1));
  const maxDev = Math.max(...s.map(([lng, lat]) => Math.abs(Math.hypot((lng - LNG) * MX, (lat - LAT) * MY) - 100)));
  assert.ok(maxDev < 3, `vertices stay on the circle (off by ${maxDev.toFixed(2)} m)`);
  const tiny = ring(box(0, 0, 3, 3)); assert.deepEqual(simplifyRing(tiny), tiny);
});

test('constraint entities become drawable areas with plain labels and the register\'s details', () => {
  const flood = areaFromEntity({ entity: 7, dataset: 'flood-risk-zone', 'flood-risk-level': '3', geometry: wkt(box(-50, -50, 50, 50)) });
  assert.equal(flood.label, 'Flood zone 3'); assert.equal(flood.rings.length, 1); assert.equal(flood.url, 'https://www.planning.data.gov.uk/entity/7');
  const listed = areaFromEntity({ entity: 8, dataset: 'listed-building-outline', 'listed-building-grade': 'II', name: 'No 5', geometry: wkt(box(0, 0, 8, 8)) });
  assert.equal(listed.label, 'Listed building (Grade II)');
  const a4 = areaFromEntity({ entity: 9, dataset: 'article-4-direction-area', name: 'Direction 12', 'permitted-development-rights': 'Class A', notes: 'Front elevations', 'document-url': 'https://c.example/a4.pdf', geometry: wkt(box(0, 0, 8, 8)) });
  assert.deepEqual([a4.details.rights, a4.details.documentUrl], ['Class A', 'https://c.example/a4.pdf']);
  assert.equal(areaFromEntity({ entity: 1, dataset: 'green-belt', geometry: 'POINT (1 2)' }), null);
});

test('provider: one area search for all datasets; ended and unknown records are ignored', async () => {
  let url = '';
  const fetchJson = async (u) => { url = decodeURIComponent(u); return { entities: [
    { entity: 1, dataset: 'conservation-area', name: 'CA', 'end-date': '', geometry: wkt(box(-50, -50, 50, 50)) },
    { entity: 2, dataset: 'conservation-area', name: 'old', 'end-date': '2001-01-01', geometry: wkt(box(-50, -50, 50, 50)) },
    { entity: 3, dataset: 'something-else', geometry: wkt(box(-50, -50, 50, 50)) },
  ] }; };
  const a = await createConstraintAreas({ fetchJson }).findNear({ lat: LAT, lng: LNG });
  assert.deepEqual(a.map((x) => x.id), ['area-1']);
  assert.match(url, /geometry_relation=intersects/); assert.ok(AREA_DATASETS.every((d) => url.includes(`dataset=${d}`)));
});

const plot = ring(box(0, -24, 5, 0)), house = ring(box(0, -10, 5, -2)), work = ring(box(1, -16, 4, -10));
const area = (id, dataset, label, pts) => ({ id, dataset, label, rings: [ring(pts)] });
const run = (extra) => runSiteChecks({ proposalRing: work, houseRing: house, plot: { ring: plot, areaM2: 120, estimated: false }, proposalAbsolute: true, ...extra });

test('area rule: inside / near / clear, with plain notes only where nothing else already speaks', () => {
  const r = run({ areas: [
    area('a1', 'conservation-area', 'Conservation area', box(-40, -40, 40, 40)),                 // inside: status only (flags drive the rules)
    area('a2', 'flood-risk-zone', 'Flood zone 3', box(-40, -40, 40, 40)),                         // inside: warning
    area('a3', 'scheduled-monument', 'Scheduled monument', box(20, -10, 30, -2)),                 // 15 m away: near
    area('a4', 'scheduled-monument', 'Scheduled monument', box(300, 300, 310, 310)),              // far
    area('a5', 'listed-building-outline', 'Listed building', box(-40, -40, 40, 40)),             // inside = the house is listed: handled by flags
  ] });
  assert.deepEqual(r.areas.map((a) => a.status), ['inside', 'inside', 'near', 'clear', 'inside']);
  assert.ok(r.areas[2].distanceM > 14 && r.areas[2].distanceM < 17);
  assert.ok(r.items.some((i) => i.status === 'warn' && /flood zone 3/.test(i.message) && /flood risk assessment/.test(i.message)));
  assert.ok(r.items.some((i) => i.status === 'info' && /scheduled monument lies about 1[56] m away/.test(i.message)));
  assert.ok(!r.items.some((i) => /conservation/i.test(i.message)), 'no duplicate note for what the flags already cover');
  assert.equal(run({}).areas.length, 0);
});

test('road class from the reference; classified road note in the other approvals', () => {
  assert.deepEqual([roadClass({ ref: 'A406', highway: 'primary' }).classLabel, roadClass({ ref: 'B112' }).roadClass, roadClass({ ref: 'A406;N1' }).roadClass], ['A road (A406)', 'B', 'A']);
  assert.equal(roadClass({ highway: 'secondary' }).classLabel, 'Main road (probably classified)'); assert.equal(roadClass({ highway: 'residential' }).classified, false);
  const road = { id: 'r', name: 'High Road', widthM: 8, ignore: false, classified: true, classLabel: 'A road (A406)', line: [[-20, 7], [30, 7]].map(ll) };
  const r = run({ roads: [road] });
  assert.ok(r.regulatory.some((x) => x.id === 'classified-road' && /A road \(A406\)/.test(x.message) && /not permitted development/.test(x.message)));
  assert.ok(!run({ roads: [{ ...road, classified: false, classLabel: null }] }).regulatory.some((x) => x.id === 'classified-road'));
  assert.equal(roadFromElement({ type: 'way', id: 1, tags: { highway: 'primary', ref: 'A12' }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] }).classLabel, 'A road (A12)');
});

test('overhead power lines: parsed, flagged when over or near the work, and a likely blocker only when over it', () => {
  const el = { type: 'way', id: 1, tags: { power: 'minor_line', voltage: '11000' }, geometry: [-20, 30].map((x) => { const [lon, lat] = ll([x, -13]); return { lat, lon }; }) };
  const pl = { ...powerLineFromElement(el), id: 'pl1' };
  assert.equal(pl.label, 'Overhead power line'); assert.equal(powerLineFromElement({ ...el, tags: { power: 'cable' } }), null);
  const over = run({ powerLines: [pl] });                                       // the line runs through the work (y = -13)
  assert.equal(over.street.powerLines[0].status, 'over');
  assert.ok(over.items.some((i) => i.status === 'warn' && /passes over or right beside/.test(i.message) && /network operator/.test(i.message)));
  assert.equal(streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: over }).level, 'likely');
  const far = { ...pl, line: [-20, 30].map((x) => ll([x, -19])) };            // 3 m beyond the work
  const near = run({ powerLines: [far] });
  assert.equal(near.street.powerLines[0].status, 'near'); assert.ok(near.items.some((i) => i.status === 'info' && /safe working distance/.test(i.message)));
  assert.equal(streetCheck({ proposal: { type: 'rear_extension' }, siteChecks: near }), null);
});

test('existing height from the map data: prompts when the extension is higher, passes when not, silent when unknown; shown in the GPDO trace', () => {
  const go = (existingHeightM, heightM) => assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', storeys: 1, depthM: 2, widthM: 3, heightM, distanceToSideBoundaryM: 3 }, existingExtensionDepthM: 0, existingHeightM, plotAreaM2: 100 });
  const hi = go(3, 3.5), ok = go(7, 3), none = go(null, 3);
  assert.equal(hi.checks.find((c) => c.id === 'existing-height').status, 'warn'); assert.match(hi.checks.find((c) => c.id === 'existing-height').message, /highest part of the existing roof/);
  assert.equal(ok.checks.find((c) => c.id === 'existing-height').status, 'pass'); assert.equal(none.checks.find((c) => c.id === 'existing-height'), undefined);
  assert.equal(traceGpdo({ workType: 'rear_extension', checks: hi.checks, proposal: {} }).provisions.find((p) => p.id === 'roof-height').status, 'uncertain');
  assert.equal(traceGpdo({ workType: 'rear_extension', checks: none.checks, proposal: {} }).provisions.find((p) => p.id === 'roof-height').status, 'not_assessed');
});

test('the garden test says where the room count came from (typed in, not just the energy certificate)', () => {
  const l = assessLpa({ authorityName: 'Waltham Forest', verdict: 'planning_permission', proposal: { type: 'rear_extension', depthM: 3, storeys: 1 }, plotAreaM2: 180, houseFootprintM2: 74, proposalAreaM2: 72, habitableRooms: 5, habitableRoomsSource: 'user' });
  assert.ok(l.checks.some((c) => /You told us the house has 5 habitable rooms/.test(c.message)));
});

test('buildMap draws constraint outlines (underneath) and overhead lines, with statuses and geometry types', () => {
  const m = buildMap({
    address: { lat: LAT, lng: LNG }, footprint: { ring: house, source: 'osm', areaM2: 40 }, plot: { ring: plot, areaM2: 120, estimated: false }, profile: { existingExtension: null }, camera: null,
    roads: [[[-20, 8], [30, 8]].map(ll)], roadDetails: [{ name: 'Example Road', widthM: 5, widthSource: 'assumed', ignore: false, line: [[-20, 8], [30, 8]].map(ll) }],
    areas: [area('a1', 'conservation-area', 'Conservation area', box(-40, -40, 40, 40)), area('a2', 'flood-risk-zone', 'Flood zone 2', box(260, 260, 290, 290))],
    powerLines: [{ kind: 'minor_line', label: 'Overhead power line', line: [[-30, -30], [30, -30]].map(ll) }],
    proposal: { type: 'rear_extension', widthM: 3, depthM: 3, heightM: 3, storeys: 1 },
  });
  const cs = m.layers.filter((l) => l.kind === 'constraint');
  assert.deepEqual(cs.map((l) => [l.dataset, l.status]), [['conservation-area', 'inside'], ['flood-risk-zone', 'clear']]);
  assert.equal(cs[0].label, 'Conservation area'); assert.equal(cs[1].label, '');
  assert.ok(m.layers.some((l) => l.kind === 'powerline' && /^M/.test(l.path)));
  assert.ok(m.geojson.features.some((f) => f.properties.kind === 'powerline' && f.geometry.type === 'LineString'));
  assert.ok(m.geojson.features.some((f) => f.properties.kind === 'constraint' && f.geometry.type === 'Polygon'));
});

test('flow: outlines are stored, the Article 4 direction is explained, and a typed-in room count is used', async () => {
  process.env.MOCK_PROVIDERS = 'true';
  const { createContainer } = await import('../src/container.js');
  const { createMockProviders } = await import('../src/providers/mock.js');
  const b = createMockProviders(), svc = createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null }, db: null }).applicationService;
  let app = await svc.create({ id: '1234567886' });
  assert.deepEqual(app.outlines.map((a) => a.dataset).sort(), ['article-4-direction-area', 'conservation-area', 'flood-risk-zone']);
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  assert.ok(app.map.layers.filter((l) => l.kind === 'constraint').length === 3);
  const a4 = app.assessment.checks.find((c) => c.id === 'article4-details');
  assert.ok(a4 && /rights removed: Class A \(extensions\), Class B/.test(a4.message) && /planning\.data\.gov\.uk/.test(a4.message));
  app = await svc.updateProfile(app.id, { habitableRooms: 4 });
  assert.equal(app.profile.habitableRooms.value, 4); assert.equal(app.profile.habitableRooms.source, 'user');
});
