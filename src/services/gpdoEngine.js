import { classForType, SCHEDULE } from '../data/gpdo.js';

/**
 * STAGE 2 – RULE ENGINE TRACE.
 * permittedDevelopment.js makes the decision; this lays it out against the GPDO provisions of the Class so the result can be audited:
 * every limit, restriction and condition of the Class, whether it was tested, how it came out, and the message that shows why.
 * A provision no check covers is reported as 'not_assessed' – never as a pass – so the tool cannot look more certain than it is.
 *
 * status: 'fail' | 'uncertain' (a check asked for confirmation) | 'pass' | 'condition' (to comply with) | 'not_assessed'
 */
const RANK = { fail: 3, warn: 2, pass: 1, info: 0 };

export function traceGpdo({ workType, checks = [], route = null, proposal = {} }) {
  const cls = classForType(workType);
  if (!cls) return null;
  const provisions = cls.provisions.filter((p) => (!p.types || p.types.includes(workType)) && (!p.when || p.when(proposal))).map((p) => {
    const evidence = checks.filter((c) => p.evidence.includes(c.id));
    const worst = evidence.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'info');
    let status;
    if (p.kind === 'condition') status = 'condition';
    else if (!evidence.length) status = 'not_assessed';
    else status = worst === 'fail' ? 'fail' : worst === 'warn' ? 'uncertain' : worst === 'pass' ? 'pass' : 'not_assessed';
    return { id: p.id, ref: p.ref, kind: p.kind, text: p.text, status, evidence: evidence.map((c) => ({ id: c.id, status: c.status, message: c.message })) };
  });
  const count = (s) => provisions.filter((p) => p.status === s).length;
  return {
    schedule: SCHEDULE, class: cls.class, title: cls.title, route,
    provisions,
    counts: { fail: count('fail'), uncertain: count('uncertain'), pass: count('pass'), not_assessed: count('not_assessed'), condition: count('condition') },
  };
}
