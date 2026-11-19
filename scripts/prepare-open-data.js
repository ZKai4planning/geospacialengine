// Prepares three official downloads for `npm run import:geo`. Nothing is loaded into the database here, and nothing is downloaded: fetch the file first
// (the exact pages are in reports/dataset-loading-guide.md).
//
//   npm run prepare:open-data -- appeals --file Casework_Database.xlsx [--sheet "Casework Database"] --out appeals.geojsonl
//   npm run import:geo -- --dataset pins-appeals --file appeals.geojsonl --ref-field appealRef --source "PINS Casework Database, 2026-10"
//
//   npm run prepare:open-data -- hnpd --file hnpd-2026-q1.csv --out heat.geojsonl           (CSV, or the Excel file with --sheet if needed)
//   npm run import:geo -- --dataset heat-networks --file heat.geojsonl --name-field siteName --source "DESNZ HNPD, 2026 Q1"
//
//   npm run prepare:open-data -- ofcom --dir postcode_files --out ofcom-fixed.csv           (the unzipped folder of 121 area files)
//   npm run import:geo -- --dataset ofcom-broadband --file ofcom-fixed.csv --key-field postcode --source "Ofcom Connected Nations, Spring 2026"
//
// Excel files need the optional `xlsx` package (npm i xlsx). Without it, save the sheet as CSV from Excel/LibreOffice and pass the CSV instead.
import fs from 'node:fs';
import path from 'node:path';
import { appealsFromRows, hnpdFromRows, rowsFromCsv, ofcomColumns, ofcomRowsToCsv, PrepError } from '../src/register/openDataPrep.js';

const argv = process.argv.slice(2);
const kind = argv[0];
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(m); process.exit(1); };
if (!['appeals', 'hnpd', 'ofcom'].includes(kind)) fail('Usage: npm run prepare:open-data -- <appeals|hnpd|ofcom> --file <file> | --dir <folder> --out <output>');
const out = opt('out') ?? fail('--out <output file> is required.');

async function readRows(file, sheet) {
  if (/\.csv$/i.test(file)) return rowsFromCsv(fs.readFileSync(file, 'utf8'));
  if (!/\.xls[xm]?$/i.test(file)) fail('Give a .csv or .xlsx file.');
  let XLSX;
  try { XLSX = (await import('xlsx')).default ?? (await import('xlsx')); } catch { fail('Reading Excel needs the "xlsx" package (npm i xlsx), or save the sheet as CSV and pass that.'); }
  const wb = XLSX.readFile(file, { cellDates: false });
  const name = sheet ?? wb.SheetNames.find((n) => /casework|hnpd|heat|data/i.test(n)) ?? wb.SheetNames[0];
  if (!wb.Sheets[name]) fail(`No sheet "${name}". Sheets: ${wb.SheetNames.join(' | ')}`);
  console.log(`Reading sheet "${name}" (of: ${wb.SheetNames.join(' | ')})`);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false });
}

/** postcodes.io bulk lookup, 100 per request. Postcodes it does not know are simply absent from the map. */
async function geocode(postcodes) {
  const map = new Map();
  for (let i = 0; i < postcodes.length; i += 100) {
    const res = await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) }) });
    if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`);
    for (const r of (await res.json()).result ?? []) if (r.result?.latitude != null) map.set(r.query, { lat: r.result.latitude, lng: r.result.longitude });
    if (i % 5000 === 0 && i) console.log(`  placed ${i} of ${postcodes.length} postcodes`);
  }
  return map;
}

try {
  if (kind === 'ofcom') {
    const dir = opt('dir') ?? fail('--dir <folder of the unzipped postcode CSV files> is required.');
    const files = fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).sort();
    if (!files.length) fail(`No CSV files in ${dir}.`);
    const fd = fs.openSync(out, 'w');
    let first = true, total = 0, cols0 = null;
    for (const f of files) {
      const rows = rowsFromCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!rows.length) continue;
      const cols = ofcomColumns(Object.keys(rows[0]));
      if (first) { cols0 = cols; console.log(`Key column "${cols.key}"; keeping ${cols.keep.length} measure column(s):\n  ${cols.keep.join('\n  ')}`); }
      else if (cols.keep.join('|') !== cols0.keep.join('|')) fail(`${f} has different columns from the first file; convert them separately.`);
      fs.writeSync(fd, ofcomRowsToCsv(rows, cols, { header: first })); first = false; total += rows.length;
    }
    fs.closeSync(fd);
    console.log(`Wrote ${total} postcode rows from ${files.length} file(s) to ${out}`);
  } else {
    const file = opt('file') ?? fail('--file <file> is required.');
    const rows = await readRows(file, opt('sheet'));
    const { features, stats } = kind === 'appeals' ? await appealsFromRows(rows, geocode) : hnpdFromRows(rows);
    fs.writeFileSync(out, features.map((f) => JSON.stringify(f)).join('\n') + '\n');
    console.log(`${JSON.stringify(stats)}\nWrote ${features.length} point(s) to ${out}`);
    if (kind === 'appeals') console.log('Positions are postcode centres (about 50-100 m): the register says so on every reading.');
  }
} catch (e) { if (e instanceof PrepError) fail(`Stopped: ${e.message}`); throw e; }
