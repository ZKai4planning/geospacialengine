import { bngToWgs84 } from '../utils/bng.js';

/**
 * Turns three OFFICIAL FILE DOWNLOADS into files `npm run import:geo` can load. Nothing here downloads anything: you fetch the file from the publisher
 * (see reports/dataset-loading-guide.md), run `npm run prepare:open-data`, then load the output.
 *
 *   appeals   Planning Inspectorate Casework Database (gov.uk, Excel, 5-year rolling, updated about monthly, OGL).
 *             The sheet has NO coordinates: each site address is placed at its POSTCODE centre (postcodes.io), so a position is good to roughly 50-100 m
 *             and every row says so (locationBasis: postcode). Rows without a postcode are counted and dropped, never guessed.
 *   hnpd      DESNZ Heat Networks Planning Database (data.gov.uk, CSV or Excel, quarterly, OGL). Projects (points), not zoned areas. Uses its own
 *             X/Y National Grid columns.
 *   ofcom     Ofcom Connected Nations fixed coverage by postcode (CSV, one file per postcode area, OGL). Keyed by postcode, no geometry.
 *
 * Column names are matched by meaning, not by exact spelling, because publishers rename columns. If a column the conversion needs cannot be found it STOPS and
 * lists the headers it saw, rather than loading a half-understood file.
 */
export class PrepError extends Error {}

// ------------------------------------------------------------------------------------------------------------------------------ csv
export function splitCsvLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
/** CSV text -> array of { header: value } rows. Handles quoted commas and doubled quotes; quoted line breaks are not supported (these files have none). */
export function rowsFromCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = splitCsvLine(l); return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()])); });
}

// ------------------------------------------------------------------------------------------------------------------------------ helpers
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9%<>=]+/g, ' ').trim();
/** First header (in file order) that satisfies `test`, or null. */
const findHeader = (headers, test) => headers.find((h) => test(norm(h))) ?? null;
const need = (found, what, headers) => { if (!found) throw new PrepError(`Cannot find the ${what} column. Headers seen: ${headers.join(' | ')}`); return found; };
const blank = (v) => v == null || v === '' || /^(not set|n\/a|na|null|none|-)$/i.test(String(v).trim());
const txt = (v) => (blank(v) ? null : String(v).trim().slice(0, 300));
const POSTCODE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/i;
export const postcodeIn = (s) => { const m = POSTCODE.exec(String(s ?? '').toUpperCase()); return m ? `${m[1]} ${m[2]}` : null; };
const isoDay = (v) => {
  if (blank(v)) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); } // Excel serial day
  return null;
};
const point = (lng, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] }, properties });

// ------------------------------------------------------------------------------------------------------------------------------ appeals
/**
 * @param rows     rows of the "Casework Database" sheet
 * @param geocode  async (postcodes[]) => Map(postcode -> { lat, lng })   (postcodes.io in the CLI; a stub in tests)
 * @returns { features, stats }
 */
export async function appealsFromRows(rows, geocode) {
  if (!rows.length) throw new PrepError('The sheet has no rows.');
  const headers = Object.keys(rows[0]);
  const hRef = need(findHeader(headers, (h) => h === 'reference' || /^(pins|appeal|case) (reference|ref|number)/.test(h)), 'appeal reference', headers);
  const hAddr = need(findHeader(headers, (h) => h === 'site address' || /^site (address|location)/.test(h)), 'site address', headers);
  const hDecision = need(findHeader(headers, (h) => /^(appeal )?decision( outcome| result)?$/.test(h)), 'decision (allowed / dismissed ...)', headers);
  const hDate = findHeader(headers, (h) => /^decision date$/.test(h)) ?? findHeader(headers, (h) => /decision date|date of decision|decided/.test(h) && !/lpa/.test(h));
  const hType = findHeader(headers, (h) => /^type of (appeal|casework|case)|^appeal type|^case type/.test(h));
  const hLpa = findHeader(headers, (h) => h === 'lpa name' || /^local planning authority( name)?$/.test(h));
  const withPc = [], stats = { rows: rows.length, noDecision: 0, noPostcode: 0, notPlaced: 0, written: 0 };
  for (const r of rows) {
    if (blank(r[hDecision])) { stats.noDecision++; continue; }
    const pc = postcodeIn(r[hAddr]);
    if (!pc) { stats.noPostcode++; continue; }
    withPc.push([r, pc]);
  }
  const placed = await geocode([...new Set(withPc.map(([, pc]) => pc))]);
  const features = [];
  for (const [r, pc] of withPc) {
    const at = placed.get(pc);
    if (!at) { stats.notPlaced++; continue; }
    features.push(point(at.lng, at.lat, {
      appealRef: txt(r[hRef]), decision: txt(r[hDecision]), decidedOn: hDate ? isoDay(r[hDate]) : null, appealType: hType ? txt(r[hType]) : null,
      lpa: hLpa ? txt(r[hLpa]) : null, address: txt(r[hAddr]), postcode: pc, locationBasis: 'postcode',
    }));
  }
  stats.written = features.length;
  return { features, stats };
}

// ------------------------------------------------------------------------------------------------------------------------------ heat networks
const GONE = /decommission|abandon|no application made|refused|withdrawn|expired/i;
export function hnpdFromRows(rows) {
  if (!rows.length) throw new PrepError('The sheet has no rows.');
  const headers = Object.keys(rows[0]);
  const hX = need(findHeader(headers, (h) => /^x coordinate$|^easting$/.test(h)), 'X-coordinate (easting)', headers);
  const hY = need(findHeader(headers, (h) => /^y coordinate$|^northing$/.test(h)), 'Y-coordinate (northing)', headers);
  const hRef = findHeader(headers, (h) => h === 'ref id');
  const hOp = findHeader(headers, (h) => /^operator/.test(h));
  const hSite = findHeader(headers, (h) => h === 'site name');
  const hStatus = findHeader(headers, (h) => h === 'development status short') ?? findHeader(headers, (h) => h === 'development status');
  const hAddr = findHeader(headers, (h) => h === 'address');
  const hKind = findHeader(headers, (h) => /^connection to communal/.test(h));
  const hPc = findHeader(headers, (h) => h === 'post code' || h === 'postcode');
  const stats = { rows: rows.length, noCoordinates: 0, inactive: 0, written: 0 }, features = [];
  for (const r of rows) {
    const x = Number(r[hX]), y = Number(r[hY]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) { stats.noCoordinates++; continue; }
    const status = hStatus ? txt(r[hStatus]) : null;
    if (status && GONE.test(status)) { stats.inactive++; continue; }
    const [lng, lat] = bngToWgs84(x, y);
    if (!(lat > 49 && lat < 61 && lng > -9 && lng < 3)) { stats.noCoordinates++; continue; }
    features.push(point(lng, lat, { heatNetworkRef: hRef ? txt(r[hRef]) : null, operator: hOp ? txt(r[hOp]) : null, siteName: hSite ? txt(r[hSite]) : null, status, networkType: hKind ? txt(r[hKind]) : null, address: hAddr ? txt(r[hAddr]) : null, postcode: hPc ? txt(r[hPc]) : null }));
  }
  stats.written = features.length;
  return { features, stats };
}

// ------------------------------------------------------------------------------------------------------------------------------ ofcom
const OFCOM_KEEP = /gigabit|full.?fibre|fttp|superfast|sfbb|ufbb|>=?\s*300|300\s*mbit|<\s*10|<\s*2\s*mbit|premises|decent|ngn|nga/i;
/** Ofcom headers worth keeping from one postcode file (the key plus every coverage / premises measure). Throws when no postcode column exists. */
export function ofcomColumns(headers) {
  const key = need(findHeader(headers, (h) => h === 'postcode space' || h === 'postcode spaced') ?? findHeader(headers, (h) => h === 'postcode' || h === 'pc'), 'postcode', headers);
  const keep = headers.filter((h) => h !== key && OFCOM_KEEP.test(h)).slice(0, 38);
  if (!keep.length) throw new PrepError(`No coverage columns found next to the postcode. Headers seen: ${headers.join(' | ')}`);
  return { key, keep };
}
/** Header names are kept AS PUBLISHED (the register shows them verbatim), so nothing is relabelled on the way in. */
export function ofcomRowsToCsv(rows, cols, { header = true } = {}) {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const names = ['postcode', ...cols.keep];
  const out = header ? [names.map(q).join(',')] : [];
  for (const r of rows) out.push([r[cols.key], ...cols.keep.map((k) => r[k] ?? '')].map(q).join(','));
  return out.join('\n') + '\n';
}
