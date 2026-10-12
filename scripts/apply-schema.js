// Creates the tables and functions in your Postgres (runs db/schema.sql). Safe to re-run.
// Usage: npm run db:schema      (uses DATABASE_DIRECT_URL, falling back to DATABASE_URL, from .env)
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { pgConfig } from '../src/utils/pgConfig.js';

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_DIRECT_URL (or DATABASE_URL) in .env first.'); process.exit(1); }

const ca = process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
const client = new pg.Client(pgConfig(url, { ssl: process.env.DATABASE_SSL === 'disable' ? 'disable' : 'require', ca }));
try {
  await client.connect();
  await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('uprn','uprn_meta','applications') ORDER BY 1");
  console.log(`Schema applied. Tables present: ${rows.map((r) => r.table_name).join(', ')}`);
} catch (e) {
  console.error('Could not apply schema:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
