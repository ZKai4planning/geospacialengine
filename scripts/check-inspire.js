// Checks the LOCAL INSPIRE parcels in your Postgres: how much is loaded, and which parcel covers a point.
//
//   npm run check:inspire -- "LE1 1AA"        a postcode (looked up on postcodes.io)
//   npm run check:inspire -- 52.6369,-1.1398  or  lat,lng
import 'dotenv/config';
import pg from 'pg';
import { config } from '../src/config.js';
import { pgConfig } from '../src/utils/pgConfig.js';
import { createInspireLocal } from '../src/providers/inspireLocal.js';

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL (or DATABASE_DIRECT_URL) in .env first.'); process.exit(1); }
const arg = process.argv.slice(2).join(' ').trim();
const ca = process.env.DATABASE_CA_CERT ? process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
const db = new pg.Client(pgConfig(url, { ssl: process.env.DATABASE_SSL === 'disable' ? 'disable' : 'require', ca }));
await db.connect();
try {
  const local = createInspireLocal({ db });
  const st = await local.stats();
  if (!st) { console.log('❌ No INSPIRE data found. Run  npm run db:schema  then  npm run import:inspire -- <council.zip>'); process.exit(1); }
  console.log(`✅ ${st.rows.toLocaleString()} polygons loaded from ${st.councils.length} council(s): ${st.councils.slice(0, 12).join(', ')}${st.councils.length > 12 ? '…' : ''}`);
  console.log(`   coordinate conversion: ${st.crsMethod === 'external' ? 'GDAL / OSTN15 (sub-metre)' : 'built-in (about 2-5 m; parcels are aligned to the house outline)'}   imported ${st.importedAt}`);
  if (!arg) { console.log('\nAdd a postcode or "lat,lng" to look up the parcel at a point.'); process.exit(0); }

  let lat, lng;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(arg);
  if (m) { lat = Number(m[1]); lng = Number(m[2]); }
  else {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(arg)}`, { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => null);
    if (!r?.result) { console.error(`Could not look up "${arg}" on postcodes.io. Try lat,lng instead.`); process.exit(1); }
    ({ latitude: lat, longitude: lng } = r.result);
  }
  const t0 = Date.now();
  const t = await local.findTitle({ lat, lng });
  console.log(`\nPoint ${lat}, ${lng}  (${Date.now() - t0} ms)`);
  if (!t) console.log('❌ No parcel there. The council may not be loaded, or the point is on land with no registered title (roads, some public land).');
  else console.log(`✅ parcel ${t.reference}: ${t.areaM2} m², ${t.ring.length - 1} corners${t.rings.length > 1 ? `, ${t.rings.length} parts` : ''}\n   centre of parcel is at ${(t.ring.reduce((s, p) => s + p[1], 0) / t.ring.length).toFixed(6)}, ${(t.ring.reduce((s, p) => s + p[0], 0) / t.ring.length).toFixed(6)}`);
} finally { await db.end(); }
