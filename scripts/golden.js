// Runs every golden case and prints the result and a coverage report.
//   npm run golden            -> table + coverage, exit code 1 if any case fails
//   npm run golden -- --json  -> machine-readable
import { fileURLToPath } from 'node:url';
import { loadCases, runCase, coverage } from '../src/services/goldenRunner.js';

const dir = fileURLToPath(new URL('../golden/cases', import.meta.url));
const results = loadCases(dir).map(runCase);
if (process.argv.includes('--json')) { console.log(JSON.stringify({ results: results.map(({ checks, ...r }) => r), coverage: coverage(results) }, null, 2)); process.exit(results.every((r) => r.ok) ? 0 : 1); }
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.id, 34)} ${pad(r.kind, 11)} ${r.title}${r.ok ? '' : '\n        ' + r.failures.join('\n        ')}`);
const bad = results.filter((r) => !r.ok).length, real = results.filter((r) => r.kind === 'decision').length;
console.log(`\n${results.length - bad}/${results.length} cases pass · ${real} based on real council decisions, ${results.length - real} on the legislation text`);
console.log('\nGPDO provisions no case exercises yet:');
for (const c of coverage(results)) { const none = c.provisions.filter((p) => !p.cases); console.log(`  Class ${c.class}: ${c.provisions.length - none.length}/${c.provisions.length} covered${none.length ? ' · missing ' + none.map((p) => p.ref).join(', ') : ''}`); }
process.exit(bad ? 1 : 0);
