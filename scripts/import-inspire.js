// Loads HM Land Registry INSPIRE Index Polygons (the free cadastral parcels, England & Wales) into Postgres, so the plot / title
// boundary is looked up in OUR database instead of through the slow, rate-limited live service.
//
// Where to get the data (free, Open Government Licence - read the licence and attribution terms on that page):
//   HM Land Registry "INSPIRE Index Polygons" - https://use-land-property-data.service.gov.uk/datasets/inspire
//   Download the council(s) you need: one ZIP per local authority, each holding a GML file in British National Grid.
//
// Prerequisites: db/schema.sql has been applied (npm run db:schema) and DATABASE_DIRECT_URL (or DATABASE_URL) is set in .env.
// Use the provider's DIRECT connection string, not the PgBouncer pooler (COPY and index builds need a real session).
//
// Usage:
//   npm run import:inspire -- "C:\data\Leicester_City_Council.zip"             one council (name taken from the file name)
//   npm run import:inspire -- a.zip b.zip c.zip                                several councils
//   npm run import:inspire -- parcels.geojsonl --council "Leicester"           GeoJSON lines from GDAL (see below)
//   options:  --council NAME   override the council name (single file only)
//             --crs bng|wgs84|auto     coordinate system of the input (default auto: decided from the numbers / GML srsName)
//             --fast                   drop the indexes before loading and rebuild them after (use for the first big load)
//             --dry-run                read and convert the files, print what would be loaded, touch no database
//             --limit N                stop after N polygons per file (testing)
//
// Re-running a council replaces that council's rows (safe to repeat).
//
// ACCURACY: GML is in British National Grid. The built-in conversion to WGS84 is good to roughly 2-5 m. The app compensates by aligning a parcel to
// the house outline, but for sub-metre positions convert with GDAL (it uses OS's OSTN15 grid when installed) and import the result:
//   ogr2ogr -f GeoJSONSeq parcels.geojsonl -t_srs EPSG:4326 Leicester.gml
//   npm run import:inspire -- parcels.geojsonl --council Leicester
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import { listZip, openZipEntry } from '../src/utils/zipRead.js';
import { parseGmlStream, parseGeoJsonStream, featureRows, copyLine, conversionStats } from '../src/utils/inspireParse.js';
import { pgConfig } from '../src/utils/pgConfig.js';

const { Client } = pg;
const { from: copyFrom } = copyStreams;

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes(n);
const valued = new Set(['--council', '--crs', '--limit']);
const rawFiles = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const files = rawFiles.flatMap((p) =>
  fs.existsSync(p) && fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((n) => /\.(zip|gml)$/i.test(n)).sort().map((n) => path.join(p, n))
    : [p]);
const councilOverride = flag('--council'), crs = flag('--crs') ?? 'auto', fast = has('--fast'), dry = has('--dry-run');
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;
const dbUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

const die = (m) => { console.error(m); process.exit(1); };
if (!files.length) die('Usage: npm run import:inspire -- <council.zip | file.gml | file.geojsonl> [more files] [--council NAME] [--fast] [--dry-run]\n(see the comments at the top of scripts/import-inspire.js for where to download the data)');
if (!['bng', 'wgs84', 'auto'].includes(crs)) die('--crs must be bng, wgs84 or auto');
if (councilOverride && files.length > 1) die('--council can only be used with a single file.');
for (const f of files) if (!fs.existsSync(f)) die(`File not found: ${f}`);
if (!dry && !dbUrl) die('Set DATABASE_DIRECT_URL (or DATABASE_URL) in .env - the provider\'s direct connection string. Or use --dry-run to only read the files.');

const councilName = (file) => councilOverride ?? path.basename(file).replace(/\.(zip|gml|xml|geojsonl?|json)$/i, '').replace(/[_]+/g, ' ').replace(/\s*(Land Registry|INSPIRE|Cadastral Parcels|Polygons)\s*/gi, ' ').trim();
const kindOf = (name) => (/\.(gml|xml)$/i.test(name) ? 'gml' : /\.(geojsonl|geojsonseq|json|geojson)$/i.test(name) ? 'geojson' : null);

/** The readable parts of one input file: [{ name, kind, open() }] */
async function sourcesOf(file) {
  if (/\.zip$/i.test(file)) {
    const parts = (await listZip(file)).filter((e) => kindOf(e.name));
    if (!parts.length) die(`${file}: no .gml / .geojson file inside the ZIP.`);
    return parts.map((e) => ({ name: e.name, kind: kindOf(e.name), open: () => openZipEntry(file, e) }));
  }
  const kind = kindOf(file) ?? die(`${file}: expected .zip, .gml, .geojson or .geojsonl`);
  return [{ name: path.basename(file), kind, open: async () => fs.createReadStream(file) }];
}

const stats = { rows: 0, features: 0, t0: Date.now(), usedBng: false, sample: null };

async function* rowsFor(file) {
  const council = councilName(file);
  let n = 0;
  for (const src of await sourcesOf(file)) {
    console.log(`  reading ${src.name}`);
    const stream = await src.open();
    const parse = src.kind === 'gml' ? parseGmlStream(stream, { crs }) : parseGeoJsonStream(stream, { crs });
    for await (const feature of parse) {
      if (n++ >= limit) return;
      stats.features++;
      const rows = featureRows(feature, council);
      for (const r of rows) {
        stats.rows++;
        stats.sample ??= { council, inspireId: r.inspireId, areaM2: r.areaM2, corners: r.flat.length / 2 - 1, first: [r.flat[0] / 1e7, r.flat[1] / 1e7] };
        yield r;
      }
      if (stats.rows % 100000 === 0) console.log(`    ${stats.rows.toLocaleString()} polygons… (${Math.round((Date.now() - stats.t0) / 1000)}s)`);
    }
  }
}

if (dry) {
  for (const f of files) { console.log(`${f}  (council "${councilName(f)}")`); for await (const _ of rowsFor(f)) { /* count only */ } }
  console.log(`\nDry run: ${stats.features.toLocaleString()} parcels, ${stats.rows.toLocaleString()} polygons. Nothing was written.`);
  if (stats.sample) console.log('First polygon:', JSON.stringify(stats.sample), '\nCheck that the position is right (paste "lat,lng" into a map), then run again without --dry-run.');
  else console.log('No polygons found - is this the right file? (GML from the HM Land Registry INSPIRE download, or GeoJSON)');
  process.exit(stats.rows ? 0 : 1);
}

const ca = process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
const client = new Client(pgConfig(dbUrl, { ssl: process.env.DATABASE_SSL === 'disable' ? 'disable' : 'require', ca }));
await client.connect();
const run = (sql, params) => client.query(sql, params);
const INDEXES = [
  ['inspire_parcels_bbox_idx', 'CREATE INDEX inspire_parcels_bbox_idx ON inspire_parcels USING gist (bbox)'],
  ['inspire_parcels_council_idx', 'CREATE INDEX inspire_parcels_council_idx ON inspire_parcels (council)'],
  ['inspire_parcels_inspire_idx', 'CREATE INDEX inspire_parcels_inspire_idx ON inspire_parcels (inspire_id, council)'],
];

try {
  await run('SET statement_timeout = 0');
  await run("SET maintenance_work_mem = '512MB'");
  if (fast) { console.log('Dropping indexes for a faster load (they are rebuilt at the end)…'); for (const [n] of INDEXES) await run(`DROP INDEX IF EXISTS ${n}`); }

    let todo = files;
  if (has('--skip-existing')) {
    const { rows } = await run('SELECT DISTINCT council FROM inspire_parcels');
    const done = new Set(rows.map((r) => r.council));
    todo = files.filter((f) => !done.has(councilName(f)));
    console.log(`Skipping ${files.length - todo.length} councils already loaded; ${todo.length} to go.`);
  }

  for (const f of todo) {
    const council = councilName(f);
    console.log(`\n${f}  ->  council "${council}"`);
    const before = stats.rows;
    await run('DELETE FROM inspire_parcels WHERE council = $1', [council]);   // re-running replaces that council
    const copy = client.query(copyFrom('COPY inspire_parcels (inspire_id, council, parts, area_m2, bbox, ring_e7) FROM STDIN'));
    async function* lines() { let buf = []; for await (const r of rowsFor(f)) { buf.push(copyLine(r)); if (buf.length >= 2000) { yield buf.join(''); buf = []; } } if (buf.length) yield buf.join(''); }
    await pipeline(Readable.from(lines()), copy);
    console.log(`  loaded ${(stats.rows - before).toLocaleString()} polygons`);
  }

  if (fast) { console.log('\nRebuilding indexes (can take several minutes for a big load)…'); for (const [, sql] of INDEXES) await run(sql); }
  await run('VACUUM (ANALYZE) inspire_parcels');

  // metadata: totals, councils loaded, and how coordinates were converted (the worst case wins, because the app uses it to decide how far to trust positions)
  const { rows: [{ n }] } = await run('SELECT count(*)::text AS n FROM inspire_parcels');
  const { rows: cs } = await run('SELECT council FROM inspire_parcels GROUP BY council ORDER BY council');
  const { rows: old } = await run("SELECT value FROM inspire_meta WHERE key = 'crs_method'");
  const method = conversionStats.bng > 0 || old[0]?.value === 'helmert' ? 'helmert' : 'external';
  const meta = { rows: n, councils: JSON.stringify(cs.map((c) => c.council)), crs_method: method, imported_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(meta)) await run('INSERT INTO inspire_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v]);

  const { rows: [{ size }] } = await run("SELECT pg_size_pretty(pg_total_relation_size('inspire_parcels')) AS size");
  console.log(`\nDone in ${Math.round((Date.now() - stats.t0) / 1000)}s. ${Number(n).toLocaleString()} polygons from ${cs.length} council(s); table + indexes use ${size}.`);
  if (method === 'helmert') console.log('Coordinates were converted with the built-in method (about 2-5 m). The app aligns each parcel to the house outline. For sub-metre accuracy re-import via GDAL (see the top of this script).');
  console.log('Check a location:  npm run check:inspire -- "LE1 1AA"   (or lat,lng)');
} catch (e) {
  console.error('\nImport failed:', e.message);
  console.error('Fix the problem and run the command again - each council is replaced from scratch.');
  process.exitCode = 1;
} finally {
  await client.end();
}
