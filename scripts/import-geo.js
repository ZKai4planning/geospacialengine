// Loads ONE register dataset onto your server (tables geo_features / geo_meta; create them with db/schema-geo.sql).
//
//   ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 out.geojsonl Source.shp          (or give British National Grid files straight in: --crs 27700)
//   npm run import:geo -- --list                                              what each dataset is, who publishes it, its licence
//   npm run import:geo -- --dataset ea-rofsw --file rofsw.geojsonl --rating-field risk_band --source "EA RoFSW, 2026-09"
//   npm run import:geo -- --dataset aqma --file aqma.geojson --authority E09000031 --source "Waltham Forest AQMA 2025"
//   npm run import:geo -- --dataset ofcom-broadband --file postcodes.csv --key-field postcode
//   npm run import:geo -- --dataset ea-rofsw --file london.geojsonl --partial    (the file covers only part of the country: points outside it stay 'unavailable' instead of 'outside')
//   npm run import:geo -- --dataset aqma --file aqma.geojson --dry-run
//   npm run import:geo -- --standards standards.json --authority E09000031            council parking / cycle / density / SuDS / privacy numbers (format: src/register/standards.js)
//
// Re-running replaces that dataset (and authority) wholesale, in one transaction. Uses DATABASE_DIRECT_URL (falls back to DATABASE_URL).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { pgConfig } from '../src/utils/pgConfig.js';
import { DATASETS, DATASET_BY_KEY } from '../src/register/datasets.js';
import { parseGeoFile, buildRows } from '../src/register/geoParse.js';
import { boxLiteral } from '../src/utils/coalParse.js';
import { parseStandards } from '../src/register/standards.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

if (flag('list')) {
  for (const d of DATASETS) console.log(`${d.key.padEnd(26)} ${d.scope === 'authority' ? 'per council ' : 'national    '} ${d.checks.join(', ').padEnd(24)} ${d.title}\n${' '.repeat(26)} ${d.publisher} - ${d.licence}\n${' '.repeat(26)} ${d.obtain}\n`);
  process.exit(0);
}

const connect = async () => {
  const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_DIRECT_URL (or DATABASE_URL) in .env'); process.exit(1); }
  const ca = process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
  const c = new pg.Client(pgConfig(url, { ssl: process.env.DATABASE_SSL === 'disable' ? 'disable' : 'require', ca }));
  await c.connect();
  return c;
};

// ---- council standards (numbers, not maps) ---------------------------------------------------------------------------------------------------------
if (opt('standards')) {
  const authority = opt('authority');
  if (!authority) { console.error('Council standards belong to one council: pass --authority <planning authority code>.'); process.exit(1); }
  let rows;
  try { rows = parseStandards(fs.readFileSync(opt('standards'), 'utf8')); } catch (e) { console.error(`Not loaded: ${e.message}`); process.exit(1); }
  for (const r of rows) console.log(`${r.topic.padEnd(8)} ${JSON.stringify(r.data).slice(0, 110)}  <- ${r.source}`);
  if (flag('dry-run')) { console.log('Dry run: nothing written.'); process.exit(0); }
  const client = await connect();
  try {
    await client.query('begin');
    for (const r of rows) await client.query(
      `insert into lpa_standards (authority, topic, data, source, url, retrieved_on) values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (authority, topic) do update set data = excluded.data, source = excluded.source, url = excluded.url, retrieved_on = excluded.retrieved_on`,
      [authority, r.topic, JSON.stringify(r.data), r.source, r.url, r.retrievedOn]);
    await client.query('commit');
    console.log(`Loaded ${rows.length} standard(s) for ${authority}. The app re-reads them within a minute.`);
  } catch (e) { await client.query('rollback'); console.error('Failed, nothing changed:', e.message); process.exitCode = 1; }
  finally { await client.end(); }
  process.exit(process.exitCode ?? 0);
}

const key = opt('dataset'), file = opt('file');
const def = DATASET_BY_KEY[key];
if (!def || !file) { console.error('Usage: npm run import:geo -- --dataset <key> --file <path> [--authority <code>] [--crs 27700] [--source "text"] [--licence "text"] [--rating-field COL] [--name-field COL] [--ref-field COL] [--key-field COL] [--partial] [--dry-run]\n       npm run import:geo -- --list'); process.exit(1); }
const authority = def.scope === 'authority' ? opt('authority') : '';
if (def.scope === 'authority' && !authority) { console.error(`${key} is council data: pass --authority <planning authority code> so it is only used for that council.`); process.exit(1); }

const features = parseGeoFile(fs.readFileSync(file, 'utf8'));
const keyKind = def.matchBy === 'uprn' ? 'uprn' : 'postcode';
const { rows, skipped, coverage } = buildRows(features, { crs: opt('crs') ?? 'auto', nameField: opt('name-field'), refField: opt('ref-field'), keyField: opt('key-field'), keyKind, ratingField: opt('rating-field'), ratingProp: def.ratingProp });
console.log(`${key}: ${rows.length} usable rows from ${features.length} (${skipped} skipped: no geometry, or not in Great Britain).`);
if (rows[0]) console.log('First row:', JSON.stringify({ ref: rows[0].ref, name: rows[0].name, key: rows[0].key, props: rows[0].props, bbox: rows[0].bbox }).slice(0, 400));
if (def.ratings && rows.length && !rows.some((r) => r.props[def.ratingProp] != null)) console.warn(`WARNING: this dataset is banded (${def.ratings.join(' < ')}) but no row has "${def.ratingProp}". Pass --rating-field <column>.`);
if (def.matchBy.includes('postcode') && rows.length && !rows.some((r) => r.key)) console.warn('WARNING: this dataset is looked up by postcode but no row has a key. Pass --key-field <postcode column>.');
if (!rows.length) { console.error('Nothing to load.'); process.exit(1); }
if (flag('dry-run')) { console.log('Dry run: nothing written. Check the bbox is in Great Britain (longitude about -8..2, latitude about 50..59).'); process.exit(0); }

const client = await connect();
try {
  await client.query('begin');
  await client.query('delete from geo_features where dataset = $1 and authority = $2', [key, authority]);
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200), params = [];
    const values = batch.map((r, k) => {
      params.push(key, authority, r.ref, r.name, r.key, JSON.stringify(r.props), boxLiteral(r.bbox), JSON.stringify(r.geom));
      const b = k * 8;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}::box, $${b + 8}::jsonb)`;
    });
    await client.query(`insert into geo_features (dataset, authority, ref, name, key, props, bbox, geom) values ${values.join(',')}`, params);
  }
  await client.query(
    `insert into geo_meta (dataset, authority, features, source, licence, coverage, loaded_at) values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (dataset, authority) do update set features = excluded.features, source = excluded.source, licence = excluded.licence, coverage = excluded.coverage, loaded_at = now()`,
    [key, authority, rows.length, opt('source') ?? `${def.publisher} (${file})`, opt('licence') ?? def.licence, flag('partial') ? JSON.stringify(coverage) : null],
  );
  await client.query('commit');
  console.log(`Loaded ${rows.length} rows into ${key}${authority ? ` for ${authority}` : ''}. Restart not needed: the app re-reads what is loaded within a minute.`);
} catch (e) { await client.query('rollback'); console.error('Failed, nothing changed:', e.message); process.exitCode = 1; }
finally { await client.end(); }
