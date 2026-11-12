import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { bngToWgs84, gridToOsgb36 } from '../src/utils/bng.js';
import { listZip, openZipEntry } from '../src/utils/zipRead.js';
import { parseGmlStream, parseGeoJsonStream, parseGmlFeature, featureRows, copyLine, parseCoordList } from '../src/utils/inspireParse.js';
import { createInspireLocal, createTitleChain, decodeRing } from '../src/providers/inspireLocal.js';
import { alignTitleToHouse, choosePlot, titleMatchesHouse } from '../src/utils/plotEstimate.js';
import { runSiteChecks } from '../src/services/siteChecks.js';
import { pointInRing } from '../src/utils/geo.js';

const collect = async (gen) => { const out = []; for await (const x of gen) out.push(x); return out; };
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 111320);

/* ---------------- coordinate conversion ---------------- */
test('BNG: matches the Ordnance Survey worked example (OSGB36 exactly; WGS84 within the Helmert accuracy)', () => {
  const { lat, lon } = gridToOsgb36(651409.903, 313177.27);                       // OS guide: 52°39′27.2531″N 1°43′4.5177″E (OSGB36)
  assert.ok(Math.abs((lat * 180) / Math.PI - 52.657570302) < 1e-7, String((lat * 180) / Math.PI));
  assert.ok(Math.abs((lon * 180) / Math.PI - 1.717921581) < 1e-7, String((lon * 180) / Math.PI));
  const w = bngToWgs84(651409.903, 313177.27);                                    // OSTN15/ETRS89: 52.658008, 1.716074
  assert.ok(metres(w, [1.716074, 52.658008]) < 6, `${metres(w, [1.716074, 52.658008])} m`);
});

/* ---------------- parsing ---------------- */
const GML_A = `<?xml version="1.0"?><wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:LR="www.landregistry.gov.uk"><gml:featureMember><LR:PREDEFINED gml:id="LR.PREDEFINED.1"><LR:GEOMETRY><gml:Polygon srsName="urn:ogc:def:crs:EPSG::27700"><gml:exterior><gml:LinearRing><gml:posList srsDimension="2">651400 313170 651420 313170 651420 313190 651400 313190 651400 313170</gml:posList></gml:LinearRing></gml:exterior><gml:interior><gml:LinearRing><gml:posList>651405 313175 651406 313175 651406 313176 651405 313175</gml:posList></gml:LinearRing></gml:interior></gml:Polygon></LR:GEOMETRY><LR:INSPIREID>12345</LR:INSPIREID></LR:PREDEFINED></gml:featureMember>`;
const GML_B = `<gml:featureMember><LR:PREDEFINED><LR:GEOMETRY><gml:MultiSurface srsName="EPSG:27700"><gml:surfaceMember><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>651400,313170 651420,313170 651420,313190 651400,313190</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></gml:surfaceMember><gml:surfaceMember><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>651430,313170 651440,313170 651440,313180 651430,313180</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></gml:surfaceMember></gml:MultiSurface></LR:GEOMETRY><LR:INSPIREID>999</LR:INSPIREID></LR:PREDEFINED></gml:featureMember></wfs:FeatureCollection>`;

test('GML: both flavours (posList / coordinates), multi-surface, holes dropped, ids read, tiny chunks and all', async () => {
  const feats = await collect(parseGmlStream(Readable.from((GML_A + GML_B).match(/[\s\S]{1,53}/g))));
  assert.equal(feats.length, 2);
  assert.equal(feats[0].inspireId, '12345'); assert.equal(feats[0].rings.length, 1);
  assert.equal(feats[0].rings[0].length, 5);                                     // outer ring only (the hole is gone), closed
  assert.ok(metres(feats[0].rings[0][0], bngToWgs84(651400, 313170)) < 0.01);
  assert.equal(feats[1].inspireId, '999'); assert.equal(feats[1].rings.length, 2);
  assert.equal(feats[1].rings[0].length, 5);                                     // coordinates style: ring closed automatically
  assert.deepEqual(parseCoordList('1,2 3,4'), [[1, 2], [3, 4]]); assert.deepEqual(parseCoordList('1 2 3 4'), [[1, 2], [3, 4]]);
});

test('GML in a geographic CRS is refused with the ogr2ogr hint (axis order differs); junk is skipped', async () => {
  assert.throws(() => parseGmlFeature('<gml:Polygon srsName="urn:ogc:def:crs:EPSG::4326"><gml:posList>1 2 3 4 5 6 1 2</gml:posList></gml:Polygon>'), /ogr2ogr/);
  assert.deepEqual(await collect(parseGmlStream(Readable.from(['<a>nothing here</a>']))), []);
});

test('GeoJSON lines and FeatureCollections are read; WGS84 stays as is, BNG numbers are converted', async () => {
  const f = (coords, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } });
  const wgs = f([[-1.14, 52.63], [-1.139, 52.63], [-1.139, 52.631], [-1.14, 52.631], [-1.14, 52.63]], { INSPIREID: 77 });
  const seq = await collect(parseGeoJsonStream(Readable.from([JSON.stringify(wgs) + '\n' + JSON.stringify(wgs) + '\n'])));
  assert.equal(seq.length, 2); assert.equal(seq[0].inspireId, '77'); assert.deepEqual(seq[0].rings[0][0], [-1.14, 52.63]);
  const coll = await collect(parseGeoJsonStream(Readable.from([JSON.stringify({ type: 'FeatureCollection', features: [wgs, f([[651400, 313170], [651420, 313170], [651420, 313190], [651400, 313170]])] }, null, 2)])));
  assert.equal(coll.length, 2); assert.ok(metres(coll[1].rings[0][0], bngToWgs84(651400, 313170)) < 0.01);
});

test('import rows: one per polygon, box + array literals, tabs and backslashes escaped', () => {
  const rows = featureRows({ inspireId: 'a\tb\\c', rings: [[[-1, 52], [-0.9, 52], [-0.9, 52.1], [-1, 52]], [[0, 0], [1, 0], [1, 1], [0, 0]]] }, 'Test Council');
  assert.equal(rows.length, 2); assert.equal(rows[0].parts, 2);
  const line = copyLine(rows[0]), cols = line.trimEnd().split('\t');
  assert.equal(cols.length, 6); assert.equal(cols[0], 'a\\tb\\\\c'); assert.equal(cols[1], 'Test Council');
  assert.equal(cols[4], '(-0.9,52.1),(-1,52)');
  assert.equal(cols[5], '{-10000000,520000000,-9000000,520000000,-9000000,521000000,-10000000,520000000}');
  assert.equal(copyLine({ ...rows[0], inspireId: null }).split('\t')[0], '\\N');
});

/* ---------------- zip ---------------- */
function makeZip(files) { // minimal ZIP writer for the test: { name, data, method: 0 | 8 }
  const parts = [], central = [];
  let off = 0;
  for (const { name, data, method = 8 } of files) {
    const raw = Buffer.from(data), comp = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('zip: lists entries and streams deflated and stored members, ready for the GML parser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-')), file = path.join(dir, 'Test_Council.zip');
  fs.writeFileSync(file, makeZip([{ name: 'readme.txt', data: 'hello', method: 0 }, { name: 'Land_Registry_Cadastral_Parcels.gml', data: GML_A + GML_B, method: 8 }, { name: 'folder/', data: '', method: 0 }]));
  try {
    const entries = await listZip(file);
    assert.deepEqual(entries.map((e) => e.name), ['readme.txt', 'Land_Registry_Cadastral_Parcels.gml']);
    const txt = await collect(await openZipEntry(file, entries[0])); assert.equal(Buffer.concat(txt).toString(), 'hello');
    const feats = await collect(parseGmlStream(await openZipEntry(file, entries[1])));
    assert.deepEqual(feats.map((f) => f.inspireId), ['12345', '999']);
    fs.writeFileSync(file, 'not a zip'); await assert.rejects(() => listZip(file), /Not a ZIP/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---------------- local provider + chain ---------------- */
const LAT = 52.63, LNG = -1.14, KX = 111320 * Math.cos((LAT * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG + x / KX, LAT + y / KY];
const rect = (x0, y0, x1, y1) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };
const row = (id, ring, extra = {}) => ({ id, inspire_id: `P${id}`, council: 'Test', parts: 1, area_m2: 100, ring_e7: ring.flatMap(([lng, lat]) => [Math.round(lng * 1e7), Math.round(lat * 1e7)]), ...extra });

function fakeInspireDb({ parcels = [], meta = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim(); calls.push(q.slice(0, 40));
      if (fail) throw Object.assign(new Error('relation "inspire_parcels" does not exist'), { code: '42P01' });
      if (q.startsWith('SELECT * FROM inspire_parcels_at')) { // bbox overlap on a small box, like the SQL function
        const [lat, lng, pad] = params, dLat = pad / 111320, dLng = pad / (111320 * Math.cos((lat * Math.PI) / 180));
        return { rows: parcels.filter((p) => { const xs = p.ring_e7.filter((_, i) => i % 2 === 0).map((v) => v / 1e7), ys = p.ring_e7.filter((_, i) => i % 2).map((v) => v / 1e7); return Math.min(...xs) <= lng + dLng && Math.max(...xs) >= lng - dLng && Math.min(...ys) <= lat + dLat && Math.max(...ys) >= lat - dLat; }) };
      }
      if (q.startsWith('SELECT * FROM inspire_parts')) return { rows: parcels.filter((p) => p.inspire_id === params[0] && p.council === params[1]) };
      if (q.startsWith('SELECT key, value FROM inspire_meta')) return { rows: meta };
      if (q.startsWith("SELECT value FROM inspire_meta WHERE key = 'councils'")) return { rows: meta.filter((m) => m.key === 'councils') };
      throw new Error(`fake: unhandled ${q}`);
    },
  };
}

test('local INSPIRE: finds the parcel containing the point, prefers the smallest, tolerates the pavement side, returns null when nothing is there', async () => {
  const db = fakeInspireDb({ parcels: [row(1, rect(0, 0, 10, 30), { area_m2: 300 }), row(2, rect(0, 0, 10, 10), { area_m2: 100 }), row(3, rect(40, 0, 50, 30))], meta: [{ key: 'crs_method', value: 'helmert' }] });
  const local = createInspireLocal({ db });
  let t = await local.findTitle({ lat: LAT + 5 / KY, lng: LNG + 5 / KX });
  assert.equal(t.reference, 'P2'); assert.equal(t.source, 'hmlr-inspire-local'); assert.equal(t.approxM, 5);
  assert.ok(pointInRing([LNG + 5 / KX, LAT + 5 / KY], t.ring)); assert.match(t.attribution, /HM Land Registry/);
  t = await local.findTitle({ lat: LAT + 15 / KY, lng: LNG + 5 / KX }); assert.equal(t.reference, 'P1');
  t = await local.findTitle({ lat: LAT + 31 / KY, lng: LNG + 5 / KX }); assert.equal(t.reference, 'P1');   // 1 m past the far line (pavement / lane side): still that plot
  assert.equal(await local.findTitle({ lat: LAT - 20 / KY, lng: LNG + 5 / KX }), null);
  assert.equal(decodeRing(row(9, rect(0, 0, 1, 1)).ring_e7).length, 5);
  assert.ok(db.calls.length >= 4);
});

test('local INSPIRE: multi-part extents return every piece; a GDAL-converted import is trusted to 0.5 m; a missing table is not an error', async () => {
  const parts = [row(1, rect(0, 0, 10, 20), { inspire_id: 'M1', parts: 2 }), row(2, rect(30, 0, 36, 6), { inspire_id: 'M1', parts: 2 })];
  const t = await createInspireLocal({ db: fakeInspireDb({ parcels: parts, meta: [{ key: 'crs_method', value: 'external' }] }) }).findTitle({ lat: LAT + 5 / KY, lng: LNG + 5 / KX });
  assert.equal(t.rings.length, 2); assert.equal(t.approxM, 0.5);
  assert.equal(await createInspireLocal({ db: fakeInspireDb({ fail: true }) }).findTitle({ lat: LAT, lng: LNG }), null);
  assert.equal(await createInspireLocal({ db: fakeInspireDb({ fail: true }) }).stats(), null);
});

test('title chain: local first, live when local has nothing or fails, error only when every source failed', async () => {
  const hit = (name) => ({ name, async findTitle() { return { source: name }; } }), none = (name) => ({ name, async findTitle() { return null; } }), boom = (name) => ({ name, async findTitle() { throw new Error(`${name} down`); } });
  assert.equal((await createTitleChain([hit('local'), hit('live')]).findTitle({})).source, 'local');
  assert.equal((await createTitleChain([none('local'), hit('live')]).findTitle({})).source, 'live');
  assert.equal((await createTitleChain([boom('local'), hit('live')]).findTitle({})).source, 'live');
  assert.equal(await createTitleChain([none('local'), none('live')]).findTitle({}), null);
  await assert.rejects(() => createTitleChain([boom('local'), boom('live')]).findTitle({}), /live down/);
  assert.equal(createTitleChain([null, hit('live')]).name, 'live');
});

/* ---------------- alignment of approximate parcels ---------------- */
const HOUSE = rect(0, 0, 8, 9);
const parcel = (ring, extra = {}) => ({ source: 'hmlr-inspire-local', ring, rings: [ring], areaM2: 300, approxM: 5, ...extra });

test('alignment: a parcel 3 m out is moved to where the house fits; a parcel that already fits is untouched; a hopeless one is left alone', () => {
  const truth = rect(-2, -6, 10, 22);                                              // the house sits inside this with a margin
  const off = parcel(rect(-2 + 3, -6 + 1, 10 + 3, 22 + 1));                         // the same parcel 3 m east, 1 m north: house corner now outside
  assert.equal(titleMatchesHouse(off, HOUSE), false);
  const fixed = alignTitleToHouse(off, HOUSE, 8);
  assert.ok(fixed.alignedByM > 0 && fixed.alignedByM <= 3.5, String(fixed.alignedByM));
  assert.equal(titleMatchesHouse(fixed, HOUSE), true);
  assert.ok(HOUSE.slice(0, -1).every((p) => pointInRing(p, fixed.ring) || metres(p, fixed.ring[0]) < 12));

  const ok = parcel(truth);
  assert.equal(alignTitleToHouse(ok, HOUSE), ok);                                   // same object: nothing to fix
  const far = parcel(rect(80, 80, 92, 108));
  assert.equal(alignTitleToHouse(far, HOUSE, 8), far);
  assert.equal(alignTitleToHouse(null, HOUSE), null);
});

test('choosePlot: an approximate parcel is aligned before matching; an exact one (approxM 0.5) is not shifted and a bad one falls back to the estimate', () => {
  const off = parcel(rect(1, -6, 13, 22));
  const r = choosePlot({ title: off, estimate: { estimated: true }, houseRing: HOUSE });
  assert.equal(r.plot.source, 'hmlr-inspire-local'); assert.ok(r.plot.alignedByM > 0); assert.equal(r.note, null);
  const exact = choosePlot({ title: { ...off, approxM: 0.5 }, estimate: { estimated: true }, houseRing: HOUSE });
  assert.equal(exact.plot.estimated, true);                                         // trusted as exact, does not match -> estimate
});

test('boundary rule: an approximate parcel widens its tolerance, says so, and its distance never drives the eaves rule', () => {
  const plot = parcel(rect(-2, -6, 10, 22));
  const run = (p, proposal) => runSiteChecks({ proposalRing: proposal, houseRing: HOUSE, plot: p });
  const over = rect(1, 9, 7, 23.5);                                                  // 1.5 m past the rear line
  let r = run({ ...plot, approxM: 0.5 }, over);
  assert.equal(r.boundary.status, 'crosses'); assert.ok(r.items.some((i) => i.status === 'fail' && /registered title boundary/.test(i.message)));
  r = run(plot, over);                                                               // approxM 5 -> tolerance 2.5 m: 1.5 m is within the noise
  assert.equal(r.boundary.status, 'inside'); assert.equal(r.boundary.approxM, 5);
  assert.ok(r.items.some((i) => /accurate to about 5 m/.test(i.message)));
  r = run(plot, rect(1, 9, 7, 27));                                                  // 5 m past: beyond the noise -> still reported, with the caveat
  assert.equal(r.boundary.status, 'crosses'); assert.ok(r.items.some((i) => i.status === 'fail' && /accurate to about 5 m/.test(i.message)));
});
