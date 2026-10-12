// Bulk-loads OS Open UPRN into Postgres using COPY (millions of rows/minute – row-by-row INSERTs are far too slow for this).
//
// Prerequisites: db/schema.sql has been run, and DATABASE_URL is set in .env (see .env.example).
// Use the provider's DIRECT connection string here (not the PgBouncer pooler) – COPY and long index builds need a real session.
//
// Usage:
//   npm run import:uprn -- --csv  "C:\data\osopenuprn_202609.csv"
//   npm run import:uprn -- --sqlite data/open-uprn.sqlite            # migrate the file you already built
//   add  --bbox minLat,minLng,maxLat,maxLng   to load one region only (e.g. London: 51.28,-0.52,51.70,0.34)
//
// Re-running replaces the table contents. The load is a single streaming COPY; if it is interrupted just run it again.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import { openDb } from './lib/sqlite.js';
import { cellKey } from '../src/utils/uprnGrid.js';
import { pgConfig } from '../src/utils/pgConfig.js';

const { Client } = pg;
const { from: copyFrom } = copyStreams;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const csv = flag('--csv') ?? args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const sqliteFile = flag('--sqlite');
const bbox = flag('--bbox')?.split(',').map(Number);
const dbUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

const die = (m) => { console.error(m); process.exit(1); };
if (!dbUrl) die('Set DATABASE_URL (or DATABASE_DIRECT_URL) in .env – the provider\'s direct connection string, with the database password filled in.');
if (!csv && !sqliteFile) die('Usage: npm run import:uprn -- --csv <osopenuprn_*.csv> | --sqlite <open-uprn.sqlite>  [--bbox minLat,minLng,maxLat,maxLng]');
const source = csv ?? sqliteFile;
if (!fs.existsSync(source)) die(`File not found: ${source}`);
if (bbox && (bbox.length !== 4 || bbox.some(Number.isNaN))) die('--bbox must be minLat,minLng,maxLat,maxLng');
const inBox = (lat, lng) => !bbox || (lat >= bbox[0] && lng >= bbox[1] && lat <= bbox[2] && lng <= bbox[3]);

const stats = { rows: 0, skipped: 0, outside: 0, t0: Date.now() };
const progress = () => {
  if (stats.rows % 1_000_000 === 0) console.log(`  ${(stats.rows / 1e6).toFixed(0)}M rows sent… (${Math.round((Date.now() - stats.t0) / 1000)}s)`);
};

/** Yields ~64 KB tab-separated chunks: uprn \t lat_e7 \t lng_e7 \t cell */
async function* fromCsv(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let col = null, buf = [];
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    const f = line.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
    if (!col) {
      const h = f.map((x) => x.toUpperCase());
      col = { uprn: h.indexOf('UPRN'), lat: h.indexOf('LATITUDE'), lng: h.indexOf('LONGITUDE') };
      if (Object.values(col).some((i) => i < 0)) die(`Could not find UPRN, LATITUDE and LONGITUDE columns. Header was: ${f.join(', ')}`);
      continue;
    }
    const uprn = Number(f[col.uprn]), lat = Number(f[col.lat]), lng = Number(f[col.lng]);
    if (!Number.isFinite(uprn) || !Number.isFinite(lat) || !Number.isFinite(lng)) { stats.skipped++; continue; }
    if (!inBox(lat, lng)) { stats.outside++; continue; }
    buf.push(`${uprn}\t${Math.round(lat * 1e7)}\t${Math.round(lng * 1e7)}\t${cellKey(lat, lng)}\n`);
    stats.rows++;
    if (buf.length >= 4000) { yield buf.join(''); buf = []; progress(); }
  }
  if (buf.length) yield buf.join('');
}

/** Reads the old SQLite file in (cell, uprn) order, so rows land in Postgres physically grouped by map cell (faster lookups). */
async function* fromSqlite(file) {
  const db = await openDb(file, { readonly: true });
  const page = db.prepare('SELECT uprn, lat_e7, lng_e7, cell FROM uprn WHERE (cell, uprn) > (?, ?) ORDER BY cell, uprn LIMIT 100000');
  let lastCell = -1, lastUprn = -1;
  for (;;) {
    const rows = page.all(lastCell, lastUprn);
    if (!rows.length) break;
    const buf = [];
    for (const r of rows) {
      if (!inBox(r.lat_e7 / 1e7, r.lng_e7 / 1e7)) { stats.outside++; continue; }
      buf.push(`${r.uprn}\t${r.lat_e7}\t${r.lng_e7}\t${r.cell}\n`);
      stats.rows++;
      if (stats.rows % 1_000_000 === 0) progress();
    }
    if (buf.length) yield buf.join('');
    ({ cell: lastCell, uprn: lastUprn } = rows[rows.length - 1]);
  }
}

const ca = process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
const client = new Client(pgConfig(dbUrl, { ssl: process.env.DATABASE_SSL === 'disable' ? 'disable' : 'require', ca }));
await client.connect();
const run = (sql) => client.query(sql);

try {
  console.log(`Source: ${source}${bbox ? `  (bbox ${bbox.join(',')})` : '  (whole file)'}`);
  await run('SET statement_timeout = 0');
  await run("SET maintenance_work_mem = '512MB'");
  await run('ALTER TABLE uprn DROP CONSTRAINT IF EXISTS uprn_pkey');
  await run('DROP INDEX IF EXISTS uprn_cell_idx');
  await run('TRUNCATE uprn');

  console.log('Loading rows (COPY)…');
  const copy = client.query(copyFrom('COPY uprn (uprn, lat_e7, lng_e7, cell) FROM STDIN'));
  await pipeline(Readable.from(csv ? fromCsv(csv) : fromSqlite(sqliteFile)), copy);
  console.log(`Loaded ${stats.rows.toLocaleString()} rows${stats.skipped ? `, skipped ${stats.skipped} bad rows` : ''}${bbox ? `, ${stats.outside.toLocaleString()} outside the bbox` : ''}.`);

  console.log('Building indexes (this can take several minutes for the whole of GB)…');
  await run('ALTER TABLE uprn ADD CONSTRAINT uprn_pkey PRIMARY KEY (uprn)');
  await run('CREATE INDEX uprn_cell_idx ON uprn (cell)');
  await run('VACUUM (ANALYZE) uprn');

  const meta = { rows: String(stats.rows), source: path.basename(source), imported_at: new Date().toISOString() };
  if (bbox) meta.bbox = bbox.join(',');
  await run('DELETE FROM uprn_meta');
  for (const [k, v] of Object.entries(meta)) await client.query('INSERT INTO uprn_meta (key, value) VALUES ($1, $2)', [k, v]);

  const { rows: [{ size }] } = await client.query("SELECT pg_size_pretty(pg_total_relation_size('uprn')) AS size");
  console.log(`Done in ${Math.round((Date.now() - stats.t0) / 1000)}s. Table + indexes use ${size} of your database.`);
  console.log('Check it works:  npm run diagnose');
} catch (e) {
  console.error('\nImport failed:', e.message);
  console.error('Fix the problem and run the command again – it starts from scratch each time.');
  process.exitCode = 1;
} finally {
  await client.end();
}
