import { CHECKS } from '../data/intelligenceRegister.js';
import { randomUUID } from 'node:crypto';

/**
 * EVIDENCE, SIGN-OFF, SURVEYS AND OFFICER REVIEW for the register (PI-17-10, 17-11, 17-12 and every check that rests on documents).
 * Everything here is a PURE function: it takes the application and returns the patch to store, so it is testable without a database or a server.
 *
 * The register's own rules are kept:
 *   - the engine never verifies anything: a reading is "engine-derived" until a NAMED reviewer signs it
 *   - a sign-off is tied to what the reviewer saw (the engine reading and the evidence on file) and goes STALE if either changes
 *   - evidence is never deleted, only withdrawn with a reason, so the audit trail survives
 */
const CHECK_IDS = new Set(CHECKS.map((c) => c.id));
const CHECK_BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

export const EVIDENCE_KINDS = ['declaration', 'document', 'survey', 'official_record', 'exception'];
export const EVIDENCE_SOURCES = ['client', 'conveyancer', 'surveyor', 'specialist', 'council', 'utility', 'reviewer'];
export const SIGN_OFF_DECISIONS = ['accepted', 'rejected', 'query'];
export const SURVEY_KINDS = ['physical', 'digital'];
export const SURVEY_STATUSES = ['draft', 'requested', 'booked', 'returned', 'cancelled'];
export const OFFICER_OUTCOMES = ['accepted', 'amended', 'rejected', 'query'];

const MAX_PER_CHECK = 25, MAX_VALUES = 20;
export class EvidenceError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const bad = (m) => new EvidenceError(m);

const text = (v, name, { min = 0, max = 600, required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && s.length < Math.max(min, 1)) throw bad(`${name} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (s.length > max) throw bad(`${name} is too long (maximum ${max} characters).`);
  return s || null;
};
const httpUrl = (v) => { if (v == null || v === '') return null; try { const u = new URL(String(v)); if (!/^https?:$/.test(u.protocol)) throw 0; return u.toString().slice(0, 500); } catch { throw bad('url must be a full http(s) link.'); } };
const dateOnly = (v, name) => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date like 2026-11-16.`); return String(v); };
const cleanValues = (v) => {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('values must be an object of simple fields.');
  const out = {};
  for (const [k, x] of Object.entries(v).slice(0, MAX_VALUES)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) throw bad(`values.${k}: field names are letters, digits and underscores.`);
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    else if (typeof x === 'boolean') out[k] = x;
    else if (typeof x === 'string') out[k] = x.slice(0, 300);
    else if (x != null) throw bad(`values.${k} must be a number, true/false or text.`);
  }
  return out;
};
const needCheck = (id) => { if (!CHECK_IDS.has(id)) throw new EvidenceError(`Unknown check ${id}.`, 404); return CHECK_BY_ID[id]; };
const stamp = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

// --------------------------------------------------------------------------------------------------------------------- evidence
/** Evidence entries still in force for a check (withdrawn ones are kept for the audit trail but not counted). */
export const activeEvidence = (app, checkId) => (app?.evidence?.[checkId] ?? []).filter((e) => !e.withdrawn);

export function addEvidence(app, checkId, input, { now, id = randomUUID() } = {}) {
  needCheck(checkId);
  const kind = EVIDENCE_KINDS.includes(input?.kind) ? input.kind : (() => { throw bad(`kind must be one of ${EVIDENCE_KINDS.join(', ')}.`); })();
  const source = EVIDENCE_SOURCES.includes(input?.source) ? input.source : (() => { throw bad(`source must be one of ${EVIDENCE_SOURCES.join(', ')}.`); })();
  const entry = {
    id, kind, source, recordedAt: stamp(now),
    recordedBy: text(input.recordedBy, 'recordedBy', { required: true, min: 2, max: 80 }),
    summary: text(input.summary, kind === 'exception' ? 'The reason for the exception (summary)' : 'summary', { required: true, min: 5, max: 600 }),
    reference: text(input.reference, 'reference', { max: 160 }), url: httpUrl(input.url), effectiveDate: dateOnly(input.effectiveDate, 'effectiveDate'),
    values: cleanValues(input.values),
  };
  const list = app?.evidence?.[checkId] ?? [];
  if (list.filter((e) => !e.withdrawn).length >= MAX_PER_CHECK) throw bad(`A check holds at most ${MAX_PER_CHECK} pieces of evidence: withdraw one first.`);
  return { entry, patch: { evidence: { ...(app?.evidence ?? {}), [checkId]: [...list, entry] } } };
}

export function withdrawEvidence(app, checkId, evidenceId, { by, reason }, { now } = {}) {
  needCheck(checkId);
  const list = app?.evidence?.[checkId] ?? [];
  const i = list.findIndex((e) => e.id === evidenceId);
  if (i < 0) throw new EvidenceError('Evidence not found.', 404);
  if (list[i].withdrawn) throw bad('That evidence is already withdrawn.');
  const next = list.map((e, k) => (k === i ? { ...e, withdrawn: { at: stamp(now), by: text(by, 'by', { required: true, min: 2, max: 80 }), reason: text(reason, 'reason', { required: true, min: 5, max: 300 }) } } : e));
  return { patch: { evidence: { ...app.evidence, [checkId]: next } } };
}

// -------------------------------------------------------------------------------------------------------------------- sign-off
const fingerprint = (reading, app, checkId) => JSON.stringify({ s: reading?.state ?? null, v: reading?.value ?? null, e: activeEvidence(app, checkId).map((e) => e.id).sort() });

/**
 * A named reviewer signs what the engine found for ONE check. `reading` = the engine's own reading at this moment ({ state, value }),
 * which the caller computes - the reviewer cannot type in a reading of their own.
 */
export function signOff(app, checkId, input, reading, { now } = {}) {
  needCheck(checkId);
  const decision = SIGN_OFF_DECISIONS.includes(input?.decision) ? input.decision : (() => { throw bad(`decision must be one of ${SIGN_OFF_DECISIONS.join(', ')}.`); })();
  if (reading?.state === 'not_built') throw bad('The engine has no reading for this check, so there is nothing to sign.');
  const rec = {
    checkId, decision, at: stamp(now),
    reviewer: text(input.reviewer, 'reviewer', { required: true, min: 2, max: 80 }),
    role: text(input.role, 'role (the reviewer\'s qualification or position)', { required: true, min: 2, max: 120 }),
    notes: text(input.notes, 'notes', { required: decision !== 'accepted', min: 5, max: 1000 }),
    reading: { state: reading?.state ?? null, value: String(reading?.value ?? '').slice(0, 400) },
    evidenceIds: activeEvidence(app, checkId).map((e) => e.id),
    fingerprint: fingerprint(reading, app, checkId),
  };
  const history = [...(app?.signOffHistory ?? []), rec].slice(-500);
  return { record: rec, patch: { signOffs: { ...(app?.signOffs ?? {}), [checkId]: rec }, signOffHistory: history } };
}

/** null (never reviewed) | { status: 'verified' | 'stale' | 'rejected' | 'query', ... }. Stale = the engine reading or the evidence changed after signing. */
export function reviewStatus(app, checkId, reading) {
  const rec = app?.signOffs?.[checkId];
  if (!rec) return null;
  const view = { reviewer: rec.reviewer, role: rec.role, at: rec.at, decision: rec.decision, notes: rec.notes };
  if (rec.decision === 'rejected') return { status: 'rejected', ...view };
  if (rec.decision === 'query') return { status: 'query', ...view };
  return rec.fingerprint === fingerprint(reading, app, checkId) ? { status: 'verified', ...view } : { status: 'stale', ...view };
}

// ------------------------------------------------------------------------------------------------------------------------ surveys
const needsSurvey = (c) => /survey|inspection|investigation|appraisal|test|scan|structural|engineer|specialist/i.test(`${c.evidence} ${c.acceptance}`);

/** A survey brief built from the register's own words for each check it covers: what evidence is required and how it is accepted. */
export function buildSurveyBrief(app, kind, checkIds) {
  const items = checkIds.map((id) => { const c = needCheck(id); return { checkId: id, parameter: c.name, evidenceRequired: c.evidence, acceptance: c.acceptance }; });
  return {
    property: app?.address?.fullAddress ?? null, uprn: app?.address?.uprn ?? null, reference: app?.reference ?? null,
    kind, scope: items,
    returnAs: 'For each check: the document or data, who produced it and their qualification, the date, and any limits of the survey. Quote the check ID on each item.',
    note: kind === 'digital' ? 'Digital survey (point cloud, photogrammetry, drone or desk review): state the capture date, accuracy and software used.' : 'Physical inspection: record access limits, areas not seen and the surveyor\'s professional body.',
  };
}

export function requestSurvey(app, input, { now, id = randomUUID() } = {}) {
  const kind = SURVEY_KINDS.includes(input?.kind) ? input.kind : (() => { throw bad(`kind must be one of ${SURVEY_KINDS.join(', ')}.`); })();
  const ids = [...new Set(Array.isArray(input?.checkIds) ? input.checkIds : [])];
  if (!ids.length) throw bad('Choose at least one check the survey should cover (checkIds).');
  if (ids.length > 40) throw bad('A survey covers at most 40 checks.');
  const rec = {
    id, kind, status: 'draft', createdAt: stamp(now), updatedAt: stamp(now),
    requestedBy: text(input.requestedBy, 'requestedBy', { required: true, min: 2, max: 80 }),
    brief: buildSurveyBrief(app, kind, ids), notes: text(input.notes, 'notes', { max: 600 }), booking: null, returned: null, history: [{ at: stamp(now), status: 'draft' }],
  };
  return { survey: rec, patch: { surveys: [...(app?.surveys ?? []), rec] } };
}

const NEXT = { draft: ['requested', 'cancelled'], requested: ['booked', 'cancelled'], booked: ['returned', 'cancelled'], returned: [], cancelled: [] };

export function updateSurvey(app, surveyId, input, { now } = {}) {
  const list = app?.surveys ?? [], i = list.findIndex((s) => s.id === surveyId);
  if (i < 0) throw new EvidenceError('Survey request not found.', 404);
  const cur = list[i], to = input?.status;
  if (!SURVEY_STATUSES.includes(to)) throw bad(`status must be one of ${SURVEY_STATUSES.join(', ')}.`);
  if (!NEXT[cur.status].includes(to)) throw bad(`A ${cur.status} survey cannot become ${to}.`);
  const next = { ...cur, status: to, updatedAt: stamp(now), history: [...cur.history, { at: stamp(now), status: to }] };
  let evidencePatch = null;
  if (to === 'booked') {
    const date = dateOnly(input.bookedFor, 'bookedFor');
    if (!date) throw bad('bookedFor (the survey date) is required when booking.');
    next.booking = { bookedFor: date, surveyor: text(input.surveyor, 'surveyor', { required: true, min: 2, max: 120 }), reference: text(input.reference, 'reference', { max: 120 }) };
  }
  if (to === 'returned') {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw bad('items is required when a survey is returned: one entry per check ({ checkId, summary, reference?, url?, values? }).');
    let working = app, added = [];
    for (const it of items) {
      if (!cur.brief.scope.some((s) => s.checkId === it.checkId)) throw bad(`${it.checkId} was not in this survey's scope.`);
      const { entry, patch } = addEvidence(working, it.checkId, { kind: 'survey', source: 'surveyor', recordedBy: next.booking?.surveyor ?? cur.requestedBy, summary: it.summary, reference: it.reference ?? cur.id, url: it.url, effectiveDate: it.effectiveDate, values: it.values }, { now });
      working = { ...working, ...patch }; added.push({ checkId: it.checkId, evidenceId: entry.id });
    }
    next.returned = { at: stamp(now), evidence: added };
    evidencePatch = { evidence: working.evidence };
  }
  return { survey: next, patch: { surveys: list.map((s, k) => (k === i ? next : s)), ...(evidencePatch ?? {}) } };
}

// ---------------------------------------------------------------------------------------------------------------- officer review
/** Sends the case to the planning officer's queue (a record the LPA's own case/consultation reference hangs on). */
export function submitOfficerReview(app, input, { now, id = randomUUID() } = {}) {
  const open = (app?.officerReviews ?? []).find((r) => r.status === 'pending');
  if (open) throw bad('A review is already pending for this application.');
  const ids = [...new Set(Array.isArray(input?.checkIds) ? input.checkIds : [])];
  ids.forEach(needCheck);
  const rec = {
    id, status: 'pending', submittedAt: stamp(now), submittedBy: text(input?.submittedBy, 'submittedBy', { required: true, min: 2, max: 80 }),
    lpaReference: text(input?.lpaReference, 'lpaReference', { max: 80 }), consultationReference: text(input?.consultationReference, 'consultationReference', { max: 80 }),
    authority: app?.authority?.name ?? null, address: app?.address?.fullAddress ?? null, applicationId: app?.id ?? null,
    checkIds: ids, note: text(input?.note, 'note', { max: 600 }), outcome: null,
  };
  return { review: rec, patch: { officerReviews: [...(app?.officerReviews ?? []), rec] } };
}

export function recordOfficerOutcome(app, reviewId, input, { now } = {}) {
  const list = app?.officerReviews ?? [], i = list.findIndex((r) => r.id === reviewId);
  if (i < 0) throw new EvidenceError('Review not found.', 404);
  if (list[i].status !== 'pending') throw bad('That review already has an outcome.');
  if (!OFFICER_OUTCOMES.includes(input?.outcome)) throw bad(`outcome must be one of ${OFFICER_OUTCOMES.join(', ')}.`);
  const next = { ...list[i], status: 'closed', outcome: { outcome: input.outcome, officer: text(input.officer, 'officer', { required: true, min: 2, max: 80 }), notes: text(input.notes, 'notes', { required: input.outcome !== 'accepted', min: 5, max: 1000 }), at: stamp(now) } };
  return { review: next, patch: { officerReviews: list.map((r, k) => (k === i ? next : r)) } };
}
