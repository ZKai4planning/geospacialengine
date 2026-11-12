import { WORK_TYPES } from './workTypes.js';
import { badRequest } from '../utils/errors.js';

/**
 * WHAT-IF: re-run the engine on a changed proposal WITHOUT saving it, so a slider can show at once what a different depth, height or width does.
 * `evaluate(proposal)` is supplied by the application service and returns whatIfView(...) of a derived (never stored) application.
 */
export function whatIfView(derived) {
  const a = derived.assessment, sc = derived.map?.siteChecks;
  if (!a) return null;
  return {
    verdict: a.verdict, label: a.label, confidence: a.confidence, summary: a.summary,
    checks: a.checks.map(({ id, status, message }) => ({ id, status, message })),
    wallSafety: sc?.wallSafety ?? null,
    walls: (sc?.walls ?? []).map(({ index, from, to, lengthM, facing, kind, status, neighbour, boundary }) => ({ index, from, to, lengthM, facing, kind, status, neighbour, boundary })),
    geometry: sc?.trace?.geometry ?? null,
  };
}

/** The fields of this proposal that can be moved with a slider (numbers only; the polygon of a drawn shape has none). */
export function sliderFields(proposal) {
  const def = WORK_TYPES[proposal?.type];
  if (!def) return [];
  return def.fields.filter((f) => f.kind === 'number' && (!f.onlyFor || f.onlyFor.includes(proposal.treatAs)));
}

const round = (v, step) => { const d = Math.max(0, Math.ceil(-Math.log10(step))); return Number((Math.round(v / step) * step).toFixed(d)); };
const rank = (c) => ({ fail: 3, warn: 2, pass: 1, info: 0 }[c.status] ?? 0);

/**
 * Where does moving ONE number change the answer? Samples the field across its allowed range, then bisects every place the verdict changes, down to the field's step.
 * Returns { field, label, unit, min, max, step, current, currentVerdict, ranges: [{ from, to, verdict, label }], flips: [{ at, from, to, because: [{ id, from, to, message }] }] }.
 * `at` is the FIRST value that gives the new verdict, `before` the last value that gave the old one. At most ~100 engine runs.
 */
export async function findLimits({ proposal, field, evaluate, samples = 48 }) {
  const f = sliderFields(proposal).find((x) => x.name === field);
  if (!f) throw badRequest(`"${field}" is not a number that can be moved for this type of work.`);
  const lo = f.min ?? 0, hi = f.max ?? 1000, step = f.step ?? 0.1;
  const cache = new Map();
  const at = async (v) => { const k = round(v, step); if (!cache.has(k)) cache.set(k, await evaluate({ ...proposal, [field]: k })); return cache.get(k); };
  const grid = []; for (let i = 0; i <= samples; i++) { const v = round(lo + ((hi - lo) * i) / samples, step); if (!grid.length || v > grid[grid.length - 1]) grid.push(v); }
  const verdicts = []; for (const v of grid) verdicts.push((await at(v))?.verdict);
  const flips = [];
  for (let i = 1; i < grid.length; i++) {
    if (verdicts[i] === verdicts[i - 1]) continue;
    let a = grid[i - 1], b = grid[i];                                 // verdict(a) = old, verdict(b) = new
    const old = verdicts[i - 1];
    while (round(b - a, step) > step) { const mid = round((a + b) / 2, step); if (mid <= a || mid >= b) break; ((await at(mid))?.verdict === old ? (a = mid) : (b = mid)); }
    const A = await at(a), B = await at(b), because = [];
    for (const id of new Set([...A.checks.map((c) => c.id), ...B.checks.map((c) => c.id)])) {
      const ca = A.checks.find((c) => c.id === id), cb = B.checks.find((c) => c.id === id);
      if ((ca?.status ?? 'none') !== (cb?.status ?? 'none') && Math.max(ca ? rank(ca) : 0, cb ? rank(cb) : 0) >= 2) because.push({ id, from: ca?.status ?? 'none', to: cb?.status ?? 'none', message: (rank(cb ?? { status: 'info' }) >= rank(ca ?? { status: 'info' }) ? cb : ca)?.message ?? '' });
    }
    flips.push({ at: b, before: a, from: old, to: B.verdict, because });
  }
  const cur = proposal[field] ?? f.default ?? lo, labels = {};
  for (const v of cache.values()) if (v) labels[v.verdict] = v.label;
  const ranges = []; let from = grid[0], v0 = verdicts[0];
  for (const fl of flips) { ranges.push({ from, to: fl.before, verdict: v0, label: labels[v0] }); from = fl.at; v0 = fl.to; }
  ranges.push({ from, to: grid[grid.length - 1], verdict: v0, label: labels[v0] });
  return { field, label: f.label, unit: f.unit ?? '', min: lo, max: hi, step, current: cur, currentVerdict: (await at(cur))?.verdict ?? null, ranges, flips, runs: cache.size };
}
