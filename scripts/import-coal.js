// Loads the Development High Risk Area polygons into Postgres (table coal_risk_areas; create it with db/schema-coal.sql).
//   ogr2ogr -f GeoJSONSeq dhra.geojsonl -t_srs EPSG:4326 DevelopmentHighRiskArea.shp
//   npm run import:coal -- dhra.geojsonl [--source "MRA download, 2026-07"] [--dry-run]
// Re-running replaces what was loaded before. Uses DATABASE_DIRECT_URL (falls back to DATABASE_URL).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { parseCoalGeoJson, boxLiteral } from '../src/utils/coalParse.js';

const args = process.argv.slice(2), si = args.indexOf('--source');
const source = si >= 0 ? args[si + 1] ?? null : null, dry = args.includes('--dry-run');
const file = args.find((a, i) => !a.startsWith('--') && i !== si + 1);
if (!file) { console.error('Usage: npm run import:coal -- <file.geojson|.geojsonl> [--source "text"] [--dry-run]'); process.exit(1); }

const feats = parseCoalGeoJson(fs.readFileSync(file, 'utf8'));
const pts = feats.reduce((n, f) => n + f.parts.flat(2).length, 0);
console.log(`${feats.length} polygons, ${pts} points. First: ${feats[0].name ?? feats[0].ref}, bbox ${feats[0].bbox.join(', ')}`);
if (dry) { console.log('Dry run: nothing written. Check the bbox is where you expect (longitude about -8..2, latitude about 50..59).'); process.exit(0); }

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_DIRECT_URL (or DATABASE_URL) in .env'); process.exit(1); }
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query("delete from coal_risk_areas where kind = 'high'");
  for (let i = 0; i < feats.length; i += 100) {
    const batch = feats.slice(i, i + 100), params = [], rows = batch.map((f, k) => {
      params.push(f.ref, f.name, boxLiteral(f.bbox), JSON.stringify(f.parts));
      return `('high', $${k * 4 + 1}, $${k * 4 + 2}, $${k * 4 + 3}::box, $${k * 4 + 4}::jsonb)`;
    });
    await client.query(`insert into coal_risk_areas (kind, ref, name, bbox, parts) values ${rows.join(',')}`, params);
  }
  await client.query("insert into coal_risk_meta (kind, features, source, loaded_at) values ('high', $1, $2, now()) on conflict (kind) do update set features = excluded.features, source = excluded.source, loaded_at = now()", [feats.length, source]);
  await client.query('commit');
  console.log('Loaded', feats.length, 'polygons.');
} catch (e) { await client.query('rollback'); console.error('Failed, nothing changed:', e.message); process.exitCode = 1; }
finally { await client.end(); }
