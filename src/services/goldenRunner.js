import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessProposal } from './permittedDevelopment.js';
import { traceGpdo } from './gpdoEngine.js';
import { runSiteChecks } from './siteChecks.js';
import { classForType } from '../data/gpdo.js';

/**
 * GOLDEN CASES: fixed scenarios with the answer a planner would give, checked on every test run so a change to the engine cannot silently change an outcome.
 * A case is one JSON file in golden/cases/. Two kinds of scenario:
 *   "assess": input for assessProposal()  -> expect { verdict, confidence?, checks: { id: status }, absent: [ids] }
 *   "site"  : a plan in metres for the site rules -> expect { walls: { east: 'touches_neighbour' }, wallSafety?, items: [regex] }
 * `kind` says where the expected answer comes from: "legislation" (the GPDO text / MHCLG technical guidance, named in `basis`) or "decision" (a real
 * council decision: put its reference and date in `basis`). Real decisions are the strongest evidence; see golden/README.md.
 */
export function loadCases(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

// metres -> [lng, lat] around a fixed point, so a site case reads in metres
const LAT0 = 51.5, LNG0 = 0.05, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const ll = ([x, y]) => [LNG0 + x / KX, LAT0 + y / KY];
const rect = ([x0, y0, x1, y1]) => { const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll); return [...r, r[0]]; };

export function runCase(c) {
  const failures = [];
  const expect = c.expect ?? {};
  let actual = {}, checks = [];
  if (c.type === 'assess') {
    const a = assessProposal(c.input);
    checks = a.checks;
    actual = { verdict: a.verdict, confidence: a.confidence, checks: Object.fromEntries(a.checks.map((x) => [x.id, x.status])) };
    if (expect.verdict && a.verdict !== expect.verdict) failures.push(`verdict: expected ${expect.verdict}, got ${a.verdict}`);
    if (expect.confidence && a.confidence !== expect.confidence) failures.push(`confidence: expected ${expect.confidence}, got ${a.confidence}`);
    for (const [id, st] of Object.entries(expect.checks ?? {})) if (actual.checks[id] !== st) failures.push(`check "${id}": expected ${st}, got ${actual.checks[id] ?? 'not present'}`);
    for (const id of expect.absent ?? []) if (id in actual.checks) failures.push(`check "${id}" should not be present (got ${actual.checks[id]})`);
  } else if (c.type === 'site') {
    const i = c.input;
    const r = runSiteChecks({ proposalRing: rect(i.proposal), houseRing: i.house ? rect(i.house) : null, neighbours: (i.neighbours ?? []).map((n, k) => ({ id: `n${k + 1}`, ring: rect(n) })), plot: i.plot ? { ring: rect(i.plot), rings: [rect(i.plot)], areaM2: (i.plot[2] - i.plot[0]) * (i.plot[3] - i.plot[1]), estimated: !!i.plotEstimated } : null });
    actual = { walls: Object.fromEntries(r.walls.filter((w) => w.kind === 'external').map((w) => [w.facing, w.status])), wallSafety: r.wallSafety?.status, items: r.items.map((x) => `${x.status}: ${x.message}`) };
    for (const [dir, st] of Object.entries(expect.walls ?? {})) if (actual.walls[dir] !== st) failures.push(`${dir} wall: expected ${st}, got ${actual.walls[dir] ?? 'no such wall'}`);
    if (expect.wallSafety && actual.wallSafety !== expect.wallSafety) failures.push(`wallSafety: expected ${expect.wallSafety}, got ${actual.wallSafety}`);
    for (const re of expect.items ?? []) if (!actual.items.some((t) => new RegExp(re).test(t))) failures.push(`no message matching /${re}/`);
  } else failures.push(`unknown case type "${c.type}"`);
  return { id: c.id, title: c.title, kind: c.kind, basis: c.basis, ok: failures.length === 0, failures, actual, checks, workType: c.input?.proposal?.type, proposal: c.input?.proposal ?? {} };
}

/** Which provisions of each GPDO Class are exercised by at least one case (tested pass/fail/uncertain), and which no case reaches. */
export function coverage(results) {
  const byType = new Map();
  for (const r of results) if (r.workType && r.checks.length) { const cls = classForType(r.workType); if (cls) { const t = traceGpdo({ workType: r.workType, checks: r.checks, proposal: r.proposal }); const m = byType.get(cls.class) ?? new Map(); for (const p of t.provisions) { const e = m.get(p.id) ?? { id: p.id, ref: p.ref, kind: p.kind, cases: new Set(), statuses: new Set() }; if (p.status !== 'not_assessed' && p.kind !== 'condition') { e.cases.add(r.id); e.statuses.add(p.status); } m.set(p.id, e); } byType.set(cls.class, m); } }
  return [...byType].map(([cls, m]) => ({ class: cls, provisions: [...m.values()].filter((p) => p.kind !== 'condition').map((p) => ({ id: p.id, ref: p.ref, cases: p.cases.size, statuses: [...p.statuses] })) }));
}
