import test from 'node:test';
import assert from 'node:assert/strict';
import { entityUrl, isCurrent } from '../src/utils/planningDataApi.js';
import { parseWktPolygons, parseWktPoint, wktSquare } from '../src/utils/wkt.js';
import { createPlanningData, CONSTRAINT_DATASETS } from '../src/providers/planningData.js';
import { createTitleBoundary } from '../src/providers/titleBoundary.js';
import { createProtectedTrees } from '../src/providers/protectedTrees.js';

// ---- fixtures: same shape as the live API (checked 14 Oct 2026): hyphenated keys, end-date "" when current, geometry/point as WKT
const live = (o) => ({ 'entry-date': '2026-07-23', 'start-date': '2026-07-23', 'end-date': '', typology: 'geography', prefix: 'x', 'organisation-entity': 1, quality: 'authoritative', ...o });
const sq = (x0, y0, x1, y1) => `((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))`;
const LNG = -0.5, LAT = 51.5;                      // the query point
const around = (d) => sq(LNG - d, LAT - d, LNG + d, LAT + d);
const recorder = (response) => { const urls = []; return { urls, fetchJson: async (u) => { urls.push(u); return typeof response === 'function' ? response(u) : response; } }; };
const params = (u) => new URL(u).searchParams;

test('entityUrl: repeated keys, %20 for spaces, documented parameter names', () => {
  const u = entityUrl([['dataset', 'a'], ['dataset', 'b'], ['geometry', 'POLYGON((1 2,3 4))'], ['limit', 5]]);
  assert.match(u, /^https:\/\/www\.planning\.data\.gov\.uk\/entity\.json\?/);
  assert.equal(params(u).getAll('dataset').join(), 'a,b');
  assert.ok(u.includes('POLYGON((1%202%2C3%204))') || u.includes('POLYGON((1%202,3%204))'), u);
  assert.equal(params(u).get('geometry'), 'POLYGON((1 2,3 4))');
  assert.equal(isCurrent({ 'end-date': '' }), true);
  assert.equal(isCurrent({ 'end-date': '2001-01-01' }), false);
  assert.equal(isCurrent({ 'end-date': '2999-01-01' }), true);
});

test('WKT: real MULTIPOLYGON (", " separators), POINT, query square', () => {
  const real = 'MULTIPOLYGON (((-0.128393 51.510546, -0.12839 51.510481, -0.128425 51.509906, -0.128393 51.510546)))';
  const r = parseWktPolygons(real);
  assert.equal(r.length, 1); assert.deepEqual(r[0][0], [-0.128393, 51.510546]); assert.equal(r[0].length, 4);
  assert.equal(parseWktPolygons('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))').length, 2);
  assert.equal(parseWktPolygons('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))').length, 1);   // hole ignored
  assert.deepEqual(parseWktPolygons('POINT (1 2)'), []); assert.deepEqual(parseWktPolygons(''), []); assert.deepEqual(parseWktPolygons(undefined), []);
  assert.deepEqual(parseWktPoint('POINT (-0.681152 52.762892)'), [-0.681152, 52.762892]);
  assert.equal(parseWktPoint('POLYGON ((0 0))'), null); assert.equal(parseWktPoint(null), null);
  const s = parseWktPolygons(wktSquare(51.5, 0, 60))[0];
  assert.equal(s.length, 5);
  const heightM = (Math.max(...s.map((p) => p[1])) - Math.min(...s.map((p) => p[1]))) * 111320;
  assert.ok(Math.abs(heightM - 120) < 0.5, String(heightM));
});

test('constraints: asks the API to leave geometry out, keeps only current records', async () => {
  const { urls, fetchJson } = recorder({ entities: [
    live({ entity: 44002870, name: 'Trafalgar Square', dataset: 'conservation-area', reference: 'CONARA/1300', geometry: 'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))', point: 'POINT (0 0)' }),
    live({ entity: 7, name: 'Old zone', dataset: 'tree-preservation-zone', reference: 'Z1', 'end-date': '2001-01-01' }),
  ], links: {}, count: 2 });
  const out = await createPlanningData({ fetchJson }).entitiesAt({ lat: LAT, lng: LNG });
  const p = params(urls[0]);
  assert.deepEqual(p.getAll('dataset'), CONSTRAINT_DATASETS);
  assert.deepEqual(p.getAll('exclude_field'), ['geometry', 'point']);
  assert.equal(p.get('longitude'), String(LNG)); assert.equal(p.get('latitude'), String(LAT));
  assert.deepEqual(out, [{ dataset: 'conservation-area', entity: 44002870, reference: 'CONARA/1300', name: 'Trafalgar Square', url: 'https://www.planning.data.gov.uk/entity/44002870' }]);
});

test('title boundary: point query, smallest containing title wins, all parts of a multi-part title returned', async () => {
  const far = sq(LNG + 0.001, LAT, LNG + 0.0012, LAT + 0.0002);
  const { urls, fetchJson } = recorder({ entities: [
    live({ entity: 1, dataset: 'title-boundary', reference: 'BIG', geometry: `MULTIPOLYGON (${around(0.0005)})` }),
    live({ entity: 2, dataset: 'title-boundary', reference: 'HOUSE', quality: 'authoritative', geometry: `MULTIPOLYGON (${around(0.0001)}, ${far})` }),   // house + a detached garage piece
    live({ entity: 3, dataset: 'title-boundary', reference: 'ENDED', 'end-date': '2020-01-01', geometry: `MULTIPOLYGON (${around(0.00001)})` }),
    live({ entity: 4, dataset: 'title-boundary', reference: 'ELSEWHERE', geometry: `MULTIPOLYGON (${sq(10, 10, 11, 11)})` }),
    live({ entity: 5, dataset: 'title-boundary', reference: 'NOGEOM', geometry: '' }),
  ] });
  const t = await createTitleBoundary({ fetchJson }).findTitle({ lat: LAT, lng: LNG });
  const p = params(urls[0]);
  assert.equal(p.get('dataset'), 'title-boundary'); assert.equal(p.get('longitude'), String(LNG)); assert.equal(p.get('latitude'), String(LAT));
  assert.equal(t.reference, 'HOUSE');
  assert.equal(t.rings.length, 2);                                   // both pieces, so reaching the garage is not "outside"
  assert.equal(t.ring, t.rings[0]);                                  // the piece that contains the point
  assert.ok(t.areaM2 > 100 && t.quality === 'authoritative');
  assert.match(t.attribution, /HM Land Registry/);
  assert.equal(await createTitleBoundary({ fetchJson: async () => ({ entities: [] }) }).findTitle({ lat: LAT, lng: LNG }), null);
  assert.equal(await createTitleBoundary({ fetchJson: async () => ({}) }).findTitle({ lat: LAT, lng: LNG }), null);
});

test('protected trees: area search for both datasets; zones, trees, felled/ended/unplaceable records', async () => {
  const { urls, fetchJson } = recorder((u) => (params(u).get('dataset') === 'tree-preservation-zone'
    ? { entities: [
      live({ entity: 10, dataset: 'tree-preservation-zone', reference: 'G1', 'tree-preservation-zone-type': 'group', 'tree-preservation-order': 'TPO1', geometry: `MULTIPOLYGON (${around(0.00005)})` }),
      live({ entity: 11, dataset: 'tree-preservation-zone', reference: 'OLD', 'end-date': '2010-01-01', geometry: `MULTIPOLYGON (${around(0.00005)})` }),
      live({ entity: 12, dataset: 'tree-preservation-zone', reference: 'NOGEOM', geometry: '' }),
    ] }
    : { entities: [
      live({ entity: 20, dataset: 'tree', reference: 'T1', 'tree-preservation-order': 'TPO1', point: `POINT (${LNG} ${LAT})`, geometry: '' }),
      live({ entity: 21, dataset: 'tree', reference: 'T2', 'felled-date': '2024-03-01', point: `POINT (${LNG} ${LAT})` }),
      live({ entity: 22, dataset: 'tree', reference: 'T3', point: '', geometry: `MULTIPOLYGON (${around(0.00004)})` }),            // outline only: centre + crown size from the outline
      live({ entity: 23, dataset: 'tree', reference: 'T4', point: '', geometry: '' }),                                                       // nowhere to put it
      live({ entity: 24, dataset: 'tree', reference: 'WOOD', point: '', geometry: `MULTIPOLYGON (${around(0.003)})` }),                    // far too big to be one tree: centre only
    ] }));
  const { zones, trees } = await createProtectedTrees({ fetchJson }).findNear({ lat: LAT, lng: LNG, radiusM: 60 });
  assert.deepEqual(urls.map((u) => params(u).get('dataset')).sort(), ['tree', 'tree-preservation-zone']);
  for (const u of urls) { assert.equal(params(u).get('geometry_relation'), 'intersects'); assert.match(params(u).get('geometry'), /^POLYGON\(\(/); }
  assert.deepEqual(zones.map((z) => [z.reference, z.type, z.order, z.rings.length]), [['G1', 'group', 'TPO1', 1]]);
  assert.deepEqual(trees.map((t) => t.reference), ['T1', 'T3', 'WOOD']);
  assert.ok(trees.every((t) => t.protected === true));
  const t1 = trees[0], t3 = trees[1], wood = trees[2];
  assert.deepEqual([t1.lng, t1.lat, t1.order, t1.crownDiameterM], [LNG, LAT, 'TPO1', null]);
  assert.ok(Math.abs(t3.lng - LNG) < 1e-4 && t3.crownDiameterM > 4 && t3.crownDiameterM < 12, String(t3.crownDiameterM));
  assert.equal(wood.crownDiameterM, null);
});
