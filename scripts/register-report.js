// npm run register:report  ->  reports/intelligence-coverage.{json,csv,html} + a summary on screen.
// Reads only the committed data files (no network, no database), so it is safe to run anywhere, including CI.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { buildCatalogue, renderHtml, toCsv, CATALOGUE_COLUMNS } from '../src/services/intelligenceRegister.js';
import { buildDatasetGuide } from '../src/register/guide.js';

const doc = buildCatalogue(config);
const dir = path.resolve('reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'intelligence-coverage.json'), JSON.stringify(doc, null, 2));
fs.writeFileSync(path.join(dir, 'intelligence-coverage.csv'), toCsv(doc.checks, CATALOGUE_COLUMNS));
fs.writeFileSync(path.join(dir, 'intelligence-coverage.html'), renderHtml(doc));
fs.writeFileSync(path.join(dir, 'dataset-loading-guide.md'), buildDatasetGuide());

const s = doc.summary;
console.log(`\n228-parameter register: ${s.total} checks`);
console.log(`  Have      ${String(s.have).padStart(3)}  (${s.havePct}%)   of which ${s.haveSwitchedOff} are switched off in this environment`);
console.log(`  Partial   ${String(s.partial).padStart(3)}  (${s.partialPct}%)   of which ${s.partialSwitchedOff} are switched off in this environment`);
console.log(`  Not built ${String(s.missing).padStart(3)}  (${s.missingPct}%)`);
console.log(`  Built in some form: ${s.built} (${s.builtPct}%)\n`);
for (const d of doc.domains) console.log(`  ${d.no} ${d.name.padEnd(30)} have ${String(d.summary.have).padStart(2)}  partial ${String(d.summary.partial).padStart(2)}  not built ${String(d.summary.missing).padStart(2)}`);
console.log(`\nWritten to ${dir}\n`);
