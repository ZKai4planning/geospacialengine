// Usage: npm run diagnose            (default postcode SW1A 2AA)
//        npm run diagnose -- "IG6 2JE"
// Tests every external service from THIS machine and prints pass/fail + latency.
import { config } from '../src/config.js';

const pc = process.argv.slice(2).join(' ').trim() || 'SW1A 2AA';
const TIMEOUT = 25000;
const headers = { 'user-agent': config.userAgent };

const pcInfo = await (await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { headers, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null))?.json().catch(() => null);
const { latitude: lat = 51.5034, longitude: lng = -0.1276 } = pcInfo?.result ?? {};
const q = `[out:json][timeout:15];(nwr(around:${config.overpassRadiusM},${lat},${lng})["addr:housenumber"];);out tags center 250;`;

// extra public mirrors worth trying if the defaults don't answer from your network
const EXTRA_MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const mirrors = [...new Set([...config.overpassUrls, ...EXTRA_MIRRORS])];

const tests = [
  { name: 'postcodes.io (postcode -> location)', url: `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, ok: (j) => (j?.result?.latitude ? `${j.result.admin_district}` : null) },
  { name: 'Photon (address type-ahead)', url: 'https://photon.komoot.io/api/?q=10%20Downing%20Street%20London&limit=3', ok: (j) => (j?.features?.length ? `${j.features.length} result(s)` : null) },
  ...mirrors.map((u) => ({
    name: `Overpass ${new URL(u).host}`, url: u, mirror: true, method: 'POST', body: new URLSearchParams({ data: q }), headers: { accept: '*/*' },
    ok: (j) => (Array.isArray(j?.elements) ? `${j.elements.length} address element(s) near ${pc}` : null),
  })),
  { name: 'Esri World Imagery (aerial)', url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=-14050,6710000,-13950,6710100&bboxSR=3857&imageSR=3857&size=64,64&format=jpg&f=image', binary: true },
  { name: 'Esri aerial – full-size export (what the app first tries)', url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=-14050,6710000,-13955,6710060&bboxSR=3857&imageSR=3857&size=1280,800&format=jpg&f=image', binary: true },
  { name: 'Esri aerial – map tile (fallback)', url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/18/110170/130992', binary: true },
  { name: 'planning.data.gov.uk (constraints)', url: 'https://www.planning.data.gov.uk/entity.json?longitude=-0.1276&latitude=51.5034&dataset=conservation-area&limit=1', ok: (j) => (Array.isArray(j?.entities) ? `${j.entities.length} entity` : null) },
];

console.log(`\nChecking live services from this machine (postcode ${pc}, UA "${config.userAgent}")\n`);
const results = [];
for (const t of tests) {
  const t0 = Date.now();
  let status = 'FAIL', detail = '';
  try {
    const res = await fetch(t.url, { method: t.method ?? 'GET', body: t.body, headers: { ...headers, ...(t.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) detail = `HTTP ${res.status}`;
    else if (t.binary) { const b = await res.arrayBuffer(); status = b.byteLength > 500 ? 'OK' : 'FAIL'; detail = `${b.byteLength} bytes (${res.headers.get('content-type')})`; }
    else { const d = t.ok(await res.json().catch(() => null)); status = d ? 'OK' : 'FAIL'; detail = d ?? 'unexpected response'; }
  } catch (e) { detail = e.name === 'TimeoutError' ? `no answer in ${TIMEOUT / 1000}s` : e.message; }
  results.push({ name: t.name, status, ms: Date.now() - t0, detail, url: t.mirror ? t.url : null });
  console.log(`${status === 'OK' ? '✅' : '❌'} ${t.name.padEnd(42)} ${String(Date.now() - t0).padStart(6)} ms  ${detail}`);
}

const overpassOk = results.filter((r) => r.name.startsWith('Overpass') && r.status === 'OK').length;
// Postgres (UPRN lookups + application storage)
if (!config.databaseUrl) console.log('ℹ️  DATABASE_URL not set – using in-memory drafts and no UPRN matching');
else {
  const { getDb } = await import('../src/utils/db.js');
  const { createOpenUprn } = await import('../src/providers/openUprn.js');
  const db = getDb();
  try {
    const apps = await db.query('SELECT count(*)::int AS n FROM applications');
    console.log(`✅ Postgres connected – applications table OK (${apps.rows[0].n} drafts)`);
  } catch (e) { console.log(`❌ Postgres: ${e.message} (is DATABASE_URL right, and did you run db/schema.sql?)`); }
  const u = createOpenUprn({ db });
  const st = await u.stats();
  const near = st ? await u.within(lat, lng, 60) : [];
  console.log(st ? `✅ OS Open UPRN: ${st.rows.toLocaleString()} UPRNs (${st.source}); ${near.length} within 60 m of ${pc}` : 'ℹ️  OS Open UPRN table is empty or unreachable – run: npm run import:uprn -- --sqlite data/open-uprn.sqlite');
  await db.end();
}
console.log('\nWhat this means:');
if (results[0].status !== 'OK') console.log('• postcodes.io is unreachable – check internet/proxy/firewall; nothing else can work without it.');
if (!overpassOk) console.log('• No Overpass mirror answered: building outlines and address-by-postcode will fail. The app falls back to manual address entry and an indicative house outline.\n  Try later, raise OVERPASS_TIMEOUT_MS, lower OVERPASS_RADIUS_M, self-host Overpass, or use a paid address API (OS Places / getAddress.io / Ideal Postcodes).');
else {
  console.log(`• ${overpassOk}/${mirrors.length} Overpass mirror(s) working – address lists and building outlines should work.`);
  const good = results.filter((r) => r.url && r.status === 'OK').sort((a, b) => a.ms - b.ms).map((r) => r.url);
  console.log('• Put this in your .env so only mirrors that answer from your network are used (fastest first):\n  OVERPASS_URLS=' + good.join(','));
}
if (results.find((r) => r.name.startsWith('Photon'))?.status !== 'OK') console.log('• Photon failed: free-text address type-ahead will be unavailable; full-postcode search and manual entry still work.');
if (results.find((r) => r.name.startsWith('Esri'))?.status !== 'OK') console.log('• Esri aerial failed: set AERIAL_PROVIDER=google (needs a key) or check your firewall.');
console.log('');
process.exit(results.every((r) => r.status === 'OK') ? 0 : 1);
