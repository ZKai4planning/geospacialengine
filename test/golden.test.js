import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCases, runCase, coverage } from '../src/services/goldenRunner.js';

const dir = fileURLToPath(new URL('../golden/cases', import.meta.url));
const cases = loadCases(dir);

test('golden cases are well formed: unique id matching the file name, a basis, a known kind and an expected answer', () => {
  assert.ok(cases.length >= 40, `only ${cases.length} cases`);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'duplicate ids');
  for (const c of cases) {
    assert.equal(`${c.id}.json`, c.file, `${c.file}: id must match the file name`);
    assert.ok(c.basis && c.title, `${c.id}: needs a title and a basis`);
    assert.ok(['legislation', 'decision'].includes(c.kind), `${c.id}: kind`);
    assert.ok(c.expect && Object.keys(c.expect).length, `${c.id}: needs an expected answer`);
  }
});

for (const c of cases) test(`golden: ${c.id}: ${c.title}`, () => {
  const r = runCase(c);
  assert.deepEqual(r.failures, [], `${c.basis}\n  ${r.failures.join('\n  ')}`);
});

test('golden coverage: the core limits of every Class the tool assesses are exercised at least once', () => {
  const cov = coverage(cases.map(runCase));
  const must = { A: ['A.1(f)', 'A.1(h)', 'A.1(c)', 'A.1(i)', 'A.1(j)', 'A.1(b)'], B: ['B.1(d)'], D: ['D.1(b)'], E: ['E.1(e)'] };
  for (const [cls, refs] of Object.entries(must)) {
    const c = cov.find((x) => x.class === cls);
    for (const ref of refs) assert.ok(c.provisions.some((p) => p.ref.startsWith(ref) && p.cases > 0), `no golden case exercises Class ${cls} ${ref}`);
  }
});
