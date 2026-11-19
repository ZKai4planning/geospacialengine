import { activeEvidence } from './evidence.js';

/**
 * PI-17-14 PLANNING READINESS GATE: "prevent release while mandatory inputs or critical issues remain".
 * A pure function over the live register rows of ONE application (nothing is stored here, nothing is fetched).
 *
 * The gate HOLDS the application until all four hold:
 *   1. identity    the property is confirmed: a UPRN that was not a low-confidence guess and not a manual address, or a named reviewer accepted PI-01-01
 *   2. mandatory   every mandatory check has a reading (not "awaiting data" / "not built"), or the gap is recorded as an exception with a reason
 *   3. issues      every check the engine flags as an ISSUE is either accepted by a named reviewer (and still current), or recorded as an exception with a reason
 *   4. verdict     the preliminary route (PI-05-18) is signed by a named reviewer, and that sign-off is not stale
 *
 * Exceptions are evidence entries of kind "exception" (POST /api/applications/:id/evidence/:checkId): a named person and a reason, kept in the audit trail.
 * The gate never makes the planning decision; it only decides whether the pack may leave the building. Enforcement on the exports is optional (READINESS_ENFORCE).
 */
export const MANDATORY = [
  ['PI-01-01', 'UPRN matching'], ['PI-05-01', 'GPDO eligibility'], ['PI-05-02', 'Article 4 Direction'], ['PI-05-03', 'Permitted development class'],
  ['PI-05-18', 'PD conclusion and caveats'], ['PI-17-06', 'Property match confidence'], ['PI-17-07', 'Rule applicability'],
];
export const VERDICT_CHECK = 'PI-05-18';
export const GATE_CHECK = 'PI-17-14';

const exceptionOn = (app, id) => activeEvidence(app, id).filter((e) => e.kind === 'exception').at(-1) ?? null;
const who = (e) => `${e.recordedBy}, ${String(e.recordedAt).slice(0, 10)}`;

/** @param rows  the live register rows: [{ id, name, live: { state, value }, review }] (review = reviewStatus() or null) */
export function evaluateGate(app, rows) {
  const by = new Map(rows.map((r) => [r.id, r]));
  const blockers = [], resolved = [];

  // 1. identity
  const m = app?.address?.uprnMatch, idReview = by.get('PI-01-01')?.review;
  const identityOk = (!!app?.address?.uprn && m?.confidence !== 'low' && !app?.address?.approximate) || idReview?.status === 'verified';
  if (!identityOk) blockers.push({ code: 'identity', message: !app?.address?.uprn ? 'The property has no UPRN: confirm the address (or have a named reviewer accept PI-01-01).' : app.address.approximate ? 'The address was typed in manually and the map is centred on the postcode: confirm the building.' : 'The UPRN is a low-confidence best guess: confirm it (or have a named reviewer accept PI-01-01).' });

  // 2. mandatory checks have data
  for (const [id, name] of MANDATORY) {
    const r = by.get(id), state = r?.live?.state;
    if (state && state !== 'awaiting' && state !== 'not_built') continue;
    const ex = exceptionOn(app, id);
    if (ex) resolved.push({ code: 'mandatory', checkId: id, how: 'exception', by: who(ex), reason: ex.summary });
    else blockers.push({ code: 'mandatory', checkId: id, message: `${id} ${name}: no reading yet (${String(r?.live?.value ?? 'not available').slice(0, 160)})` });
  }

  // 3. issues are accepted or excepted
  for (const r of rows) {
    if (r.id === GATE_CHECK || r.live?.state !== 'issue') continue;
    const rv = r.review, ex = exceptionOn(app, r.id);
    if (rv?.status === 'verified') { resolved.push({ code: 'issue', checkId: r.id, how: 'accepted', by: `${rv.reviewer} (${rv.role}), ${String(rv.at).slice(0, 10)}` }); continue; }
    if (ex) { resolved.push({ code: 'issue', checkId: r.id, how: 'exception', by: who(ex), reason: ex.summary }); continue; }
    const why = rv?.status === 'stale' ? 'the sign-off is out of date (the reading or the evidence changed after it was signed)' : rv?.status === 'rejected' ? `the reviewer rejected it${rv.notes ? `: ${rv.notes}` : ''}` : rv?.status === 'query' ? `the reviewer raised a query${rv.notes ? `: ${rv.notes}` : ''}` : 'no reviewer has accepted it and no exception is recorded';
    blockers.push({ code: 'issue', checkId: r.id, message: `${r.id} ${r.name}: ${why}` });
  }

  // 4. the verdict is signed
  const v = by.get(VERDICT_CHECK)?.review;
  if (v?.status === 'verified') resolved.push({ code: 'verdict', checkId: VERDICT_CHECK, how: 'signed', by: `${v.reviewer} (${v.role}), ${String(v.at).slice(0, 10)}` });
  else blockers.push({ code: 'verdict', checkId: VERDICT_CHECK, message: `The preliminary route (${VERDICT_CHECK}) is not signed by a named reviewer${v?.status ? ` (${v.status})` : ''}.` });

  const exceptions = resolved.filter((x) => x.how === 'exception');
  const open = blockers.length;
  return {
    state: open ? 'held' : 'ready', released: !open, withExceptions: !open && exceptions.length > 0,
    blockers, resolved, exceptions,
    counts: { blockers: open, accepted: resolved.filter((x) => x.how === 'accepted').length, exceptions: exceptions.length, issuesOpen: blockers.filter((b) => b.code === 'issue').length },
    summary: open ? `HELD: ${open} thing(s) stand between this application and release (${[...new Set(blockers.map((b) => b.code))].join(', ')}).` : `READY${exceptions.length ? ` with ${exceptions.length} recorded exception(s)` : ''}: identity confirmed, mandatory checks have readings, every issue is accepted or excepted, and the verdict is signed.`,
  };
}

/** The register reading for PI-17-14 itself. */
export function gateReading(gate) {
  if (gate.released) return { state: gate.withExceptions ? 'info' : 'pass', value: gate.summary };
  return { state: 'issue', value: `${gate.summary} First: ${gate.blockers[0].message}` };
}
