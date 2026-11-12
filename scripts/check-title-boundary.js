// Live check of the HM Land Registry title boundary (+ council protected trees) from THIS machine.
//
//   npm run check:title -- "E6 2AA"          a postcode
//   npm run check:title -- 51.5390,0.0590    or  lat,lng
//
// It shows: the raw API answer (so you can see the real field names), what our parser makes of it, and a small grid probe that
// tells you how much of the area around the point is covered by title polygons. Run it for a few postcodes you care about.
import { config } from '../src/config.js';
import { fetchJson } from '../src/utils/http.js';
import { entityUrl } from '../src/utils/planningDataApi.js';
import { createTitleBoundary } from '../src/providers/titleBoundary.js';
import { createProtectedTrees } from '../src/providers/protectedTrees.js';
import { parseWktPolygons } from '../src/utils/wkt.js';

const arg = process.argv.slice(2).join(' ').trim() || 'E6 2AA';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (b) => (b ? '✅' : '❌');

let lat, lng;
const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(arg);
if (m) { lat = Number(m[1]); lng = Number(m[2]); }
else {
  const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(arg)}`, { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => null);
  if (!r?.result) { console.error(`Could not look up "${arg}" on postcodes.io. Try  npm run check:title -- 51.539,0.059`); process.exit(1); }
  ({ latitude: lat, longitude: lng } = r.result);
}
console.log(`\nChecking ${arg}  →  lat ${lat}, lng ${lng}\n`);

// 1. raw answer
const url = entityUrl([['dataset', 'title-boundary'], ['longitude', lng], ['latitude', lat], ['limit', 20]]);
console.log('1. Raw API call\n   ' + url);
let raw;
try { raw = await fetchJson(url, { timeoutMs: 15000 }); } catch (e) { console.log(`   ${ok(false)} request failed: ${e.message}\n   (network/firewall? try: curl "${url}")`); process.exit(1); }
const ents = raw?.entities ?? [];
console.log(`   ${ok(Array.isArray(raw?.entities))} HTTP ok, ${ents.length} entit${ents.length === 1 ? 'y' : 'ies'} returned (API "count": ${raw?.count ?? '?'})`);
if (ents[0]) {
  const e = ents[0];
  console.log(`   fields: ${Object.keys(e).join(', ')}`);
  console.log(`   first: dataset=${e.dataset} reference=${e.reference} entity=${e.entity} end-date="${e['end-date']}" quality=${e.quality ?? ''}`);
  const parts = parseWktPolygons(e.geometry);
  console.log(`   geometry: ${typeof e.geometry === 'string' ? e.geometry.slice(0, 60) + '…' : 'MISSING'}  → ${parts.length} part(s), ${parts.map((p) => p.length - 1 + ' pts').join(' / ')}`);
}

// 2. what our provider returns
const titles = createTitleBoundary();
const t = await titles.findTitle({ lat, lng }).catch((e) => { console.log(`   ${ok(false)} provider error: ${e.message}`); return null; });
console.log('\n2. Our provider (the polygon the app would draw)');
if (t) console.log(`   ${ok(true)} title ${t.reference} · ${t.rings.length} part(s) · about ${t.areaM2} m² · quality ${t.quality ?? 'n/a'}`);
else console.log(`   ⚠️  no title polygon contains this exact point. Either this area is not in the dataset yet (it is still being filled in)\n      or the point is just outside the polygon. The app then tries the middle of the building outline as well, and otherwise skips the boundary check.`);

// 3. coverage probe: 5 x 5 points, 40 m apart (polite: one request every 300 ms)
console.log('\n3. Coverage probe (5 × 5 points, 40 m apart around the location)');
const kLat = 1 / 111320, kLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
let hits = 0, total = 0; const refs = new Set();
const rows = [];
for (let j = 2; j >= -2; j--) {
  let row = '   ';
  for (let i = -2; i <= 2; i++) {
    const r = await titles.findTitle({ lat: lat + j * 40 * kLat, lng: lng + i * 40 * kLng }).catch(() => undefined);
    total++;
    if (r) { hits++; refs.add(r.reference); }
    row += r ? '■ ' : r === null ? '· ' : '? ';
    await sleep(300);
  }
  rows.push(row);
}
console.log(rows.join('\n'));
console.log(`   ${hits}/${total} points are inside a title polygon (${refs.size} distinct title${refs.size === 1 ? '' : 's'}).   ■ found   · none   ? request failed`);
console.log(hits === 0 ? '   → No coverage here yet: boundary checks will be skipped for addresses in this area.' : hits < total / 2 ? '   → Patchy coverage: boundary checks will work for some addresses only.' : '   → Good coverage here.');

// 4. council protected trees
console.log('\n4. Protected trees / tree preservation zones within 60 m');
const tp = await createProtectedTrees().findNear({ lat, lng }).catch((e) => { console.log(`   ${ok(false)} ${e.message}`); return null; });
if (tp) console.log(`   ${ok(true)} ${tp.zones.length} zone(s)${tp.zones.length ? ' (' + tp.zones.map((z) => `${z.type ?? 'zone'} ${z.order ?? z.reference ?? ''}`.trim()).join(', ') + ')' : ''}, ${tp.trees.length} individual protected tree(s)`);
console.log(`\nLicence: dataset content is published under the Open Government Licence v3.0 (planning.data.gov.uk); keep the attribution the app shows.\n`);
