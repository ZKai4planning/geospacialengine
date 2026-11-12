import { SITE_RULES } from './rules/index.js';
import { describeRule } from './rules/catalog.js';
import { THRESHOLDS } from './rules/thresholds.js';
import { describeExistingRoof, resolveExistingRoof } from './existingRoof.js';
import { LIMITS, CLASSES, SCHEDULE } from '../data/gpdo.js';

/**
 * THE ENGINE ROOM: shows what the engine actually did for this application, in the order it did it, so a person can follow and check it.
 * Nothing is recomputed here and nothing is invented: every stage is read from what the engine already stored on the application
 * (map.siteChecks.trace, assessment.checks, assessment.gpdo, assessment.lpa ...). If something was skipped, the stage says so and why.
 *
 * Returns { stages: [{ id, title, status, headline, details?, rules?, checks?, steps?, provisions?, skipped? }], geometry, walls }
 *   status: ok | warn | fail | info | skipped | pending
 */
const RANK = { fail: 3, warn: 2, info: 1, pass: 0, ok: 0 };
const worst = (list) => list.reduce((w, s) => ((RANK[s] ?? 0) > (RANK[w] ?? 0) ? s : w), 'ok');
const row = (label, value, status) => ({ label, value: String(value), ...(status ? { status } : {}) });
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const GATES = new Set(['jurisdiction', 'not-a-house', 'use-unconfirmed', 'listed', 'dwellinghouse']);

export function buildEngineTrace(app) {
  const map = app.map, a = app.assessment, sc = map?.siteChecks, pr = app.proposal;
  const stages = [];

  // 1. what the engine knew before it started
  const flags = Object.entries(app.constraints?.flags ?? {}).filter(([, v]) => v === true).map(([k]) => k);
  const plot = app.plot;
  stages.push({
    id: 'data', title: 'What the engine knew', status: 'ok', headline: `${app.address?.fullAddress ?? 'Address'}`,
    details: [
      row('Address id', `${app.address?.id ?? '–'}${app.address?.uprn ? ` · UPRN ${app.address.uprn}${app.address.uprnMatch?.confidence === 'low' ? ' (low confidence)' : ''}` : ' · no UPRN'}`, app.address?.uprn ? 'pass' : 'info'),
      row('House outline', app.footprint ? `${app.footprint.areaM2 ?? '?'} m² from OpenStreetMap` : 'none found – an indicative 5.5 × 9 m shape is drawn', app.footprint ? 'pass' : 'warn'),
      row('Neighbouring buildings', count((app.neighbours ?? []).length, 'outline')),
      row('Roads / paths / street furniture', `${(app.roadDetails ?? app.roads ?? []).length} / ${(app.pathways ?? []).length} / ${(app.obstacles ?? []).length}`),
      row('Trees (map) / council protected', `${(app.trees ?? []).length} / ${(app.protectedTrees?.trees ?? []).length}`),
      row('Plot boundary', plot ? (plot.estimated ? `estimated (${plot.confidence ?? 'low'} confidence) – never a verdict` : `registered title${plot.approxM > 1 ? `, accurate to about ${plot.approxM} m` : ''}`) : 'none', plot && !plot.estimated ? 'pass' : 'info'),
      (() => { const r = resolveExistingRoof({ lidar: app.lidar, footprint: app.footprint }); return row('Existing roof height', describeExistingRoof(r), r?.source === 'lidar' ? 'pass' : r ? 'warn' : 'info'); })(),
      row('Planning constraints found', flags.length ? flags.join(', ') : 'none flagged', flags.length ? 'warn' : 'pass'),
      row('Energy certificate / sale records / planning history', [app.epc ? 'EPC' : 'no EPC', app.ppd ? 'sales' : 'no sales', app.history ? 'history' : 'no history'].join(' · ')),
    ],
  });

  // 2. which way the house faces
  const f = map?.frame;
  stages.push({
    id: 'frame', title: 'House frame (front and back)', status: f?.indicative ? 'warn' : f?.frontSource === 'assumed' || f?.corner ? 'warn' : 'ok',
    headline: f ? `Front faces ${Math.round(f.frontBearingDeg)}° (${{ road: 'nearest road', camera: 'street photo', user: 'set by you', assumed: 'assumed' }[f.frontSource] ?? f.frontSource})` : 'Not available',
    details: f ? [row('Front bearing', `${Math.round(f.frontBearingDeg)}°`), row('Decided from', f.frontSource), row('House size', `${f.houseWidthM} × ${f.houseDepthM} m${f.indicative ? ' (indicative)' : ''}`), row('Corner house', f.corner ? 'yes – confirm which side is the front' : 'no')] : [],
    note: 'Everything measured "behind" or "beside" the house depends on this.',
  });

  // 3. the proposal as geometry
  const layer = map?.layers?.find((l) => l.kind === 'proposal');
  stages.push(pr ? {
    id: 'proposal', title: 'Proposal turned into a footprint', status: 'ok',
    headline: `${pr.type.replace(/_/g, ' ')}${layer?.dimsText ? ` · ${layer.dimsText}` : ''}`,
    details: [row('Type of work', pr.type), row('Footprint', layer ? `${layer.areaM2} m²${layer.style === 'roof' ? ' (roof level)' : ''}` : '–'), ...(pr.type === 'custom_polygon' ? [row('Drawn by', 'you, corner by corner (validated on the server)')] : [])],
  } : { id: 'proposal', title: 'Proposal turned into a footprint', status: 'pending', headline: 'Choose a type of work to start the engine', details: [] });

  // 4. the site rules, one by one
  const tr = sc?.trace;
  if (!pr) stages.push({ id: 'site', title: 'Site rules', status: 'pending', headline: 'Waiting for a proposal', rules: [] });
  else if (!tr) stages.push({ id: 'site', title: 'Site rules', status: 'info', headline: 'This draft was saved before the engine room existed – change any detail (or press the button again) and the rules run and are recorded.', rules: [] });
  else if (tr.skipped) stages.push({ id: 'site', title: 'Site rules', status: 'skipped', headline: tr.skipped.message, skipped: tr.skipped, rules: [] });
  else {
    const rules = (tr?.rules ?? []);
    const st = worst(rules.flatMap((r) => r.added.map((i) => i.status)));
    const flagged = rules.filter((r) => r.added.some((i) => i.status === 'fail' || i.status === 'warn')).length;
    stages.push({ id: 'site', title: 'Site rules (the plan itself)', status: st, headline: `${count(rules.length, 'rule')} ran in order · ${flagged ? `${flagged} raised a warning or failure` : 'nothing flagged'}`, rules });
  }

  // 5. the permitted-development checks (gates first, then the limits for the Class)
  const checks = a?.checks ?? [];
  stages.push(a ? {
    id: 'checks', title: 'Permitted-development checks', status: worst(checks.map((c) => c.status)),
    headline: `${count(checks.length, 'check')} · ${checks.filter((c) => c.status === 'fail').length} not met · ${checks.filter((c) => c.status === 'warn').length} to confirm · ${checks.filter((c) => c.status === 'pass').length} met`,
    checks: checks.map((c) => ({ id: c.id, status: c.status, message: c.message, gate: GATES.has(c.id) })),
    note: 'Gates (England only, a house, not listed, not a flat) run first and stop everything if they fail. Then each limit for the type of work.',
  } : { id: 'checks', title: 'Permitted-development checks', status: 'pending', headline: 'Waiting for a proposal', checks: [] });

  // 6. every provision of the Class, tested or not
  const g = a?.gpdo;
  stages.push(g ? {
    id: 'gpdo', title: `GPDO Class ${g.class}: every provision`, status: g.counts.fail ? 'fail' : g.counts.uncertain ? 'warn' : 'ok',
    headline: `${g.counts.pass} met · ${g.counts.fail} not met · ${g.counts.uncertain} to confirm · ${g.counts.not_assessed} not tested here`,
    provisions: g.provisions,
    note: 'A provision no check covers is shown as "not tested here", never as a pass.',
  } : { id: 'gpdo', title: 'GPDO provisions', status: 'pending', headline: a ? 'Not applicable to this verdict' : 'Waiting for a proposal', provisions: [] });

  // 7. how the verdict was reached (read back from the checks, in the order the engine decides)
  stages.push(a ? { id: 'decision', title: 'How the verdict was reached', status: a.verdict === 'permitted_development' ? 'ok' : a.verdict === 'prior_approval' ? 'warn' : 'fail', headline: a.label, steps: decisionPath(a), verdict: { verdict: a.verdict, label: a.label, summary: a.summary, confidence: a.confidence } }
    : { id: 'decision', title: 'How the verdict was reached', status: 'pending', headline: 'Waiting for a proposal', steps: [] });

  // 8. the council's own guidance, applied afterwards and never overriding the national result
  const l = a?.lpa;
  stages.push(l ? { id: 'council', title: 'Council guidance (local rules)', status: l.available ? ({ likely_ok: 'ok', at_risk: 'warn', unlikely: 'fail' }[l.outlook] ?? 'info') : 'info', headline: l.headline, details: l.available ? [row('Authority', l.authority), row('Document', l.document ?? '–')] : [], checks: (l.checks ?? []).map((c) => ({ id: c.id ?? 'lpa', status: c.status, message: c.message })) }
    : { id: 'council', title: 'Council guidance (local rules)', status: 'pending', headline: a ? 'Not available' : 'Waiting for a proposal', checks: [] });

  return { stages, geometry: tr?.geometry ?? null, walls: sc?.walls ?? [], wallSafety: sc?.wallSafety ?? null, ruleOrder: SITE_RULES.map((r) => r.id) };
}

/** The decision order of assessProposal(), read back from its checks. Mirrors the code at the end of permittedDevelopment.js; if that logic changes, change this. */
export function decisionPath(a) {
  const checks = a.checks ?? [], fails = checks.filter((c) => c.status === 'fail'), warns = checks.filter((c) => c.status === 'warn');
  const steps = [];
  const gateFail = fails.filter((c) => GATES.has(c.id));
  const gateHalt = ['not_applicable', 'not_a_house', 'house_unconfirmed', 'listed_building_consent'].includes(a.verdict) || (a.verdict === 'planning_permission' && fails.some((c) => c.id === 'dwellinghouse'));
  steps.push({ label: 'Gates', outcome: gateHalt ? 'stopped' : 'passed', status: gateHalt ? 'fail' : 'ok', detail: gateHalt ? (gateFail[0]?.message ?? a.summary) : 'England, a house, not listed, not a flat.' });
  if (gateHalt) { steps.push({ label: 'Result', outcome: a.label, status: 'fail', detail: 'The engine stops at a gate and does not run the limits.' }); return steps; }
  steps.push({ label: 'Limits for this type of work', outcome: fails.length ? `${count(fails.length, 'limit')} not met` : 'all within limits', status: fails.length ? 'fail' : 'ok', detail: fails.length ? fails.map((c) => c.id).join(', ') : `${count(checks.filter((c) => c.status === 'pass').length, 'check')} passed.` });
  if (fails.length) { steps.push({ label: 'Result', outcome: 'Planning permission needed', status: 'fail', detail: 'Any single limit that is not met means this is not permitted development.' }); return steps; }
  const upward = checks.some((c) => c.id === 'upward');
  steps.push({ label: 'Special routes', outcome: upward ? 'extra storey → planning permission' : a.verdict === 'prior_approval' ? 'larger home extension → prior approval' : 'none triggered', status: upward ? 'fail' : a.verdict === 'prior_approval' ? 'warn' : 'ok', detail: upward ? 'Adding storeys normally needs planning permission.' : a.verdict === 'prior_approval' ? 'Over the standard depth but within the prior-approval limit: the council consults neighbours first.' : '' });
  steps.push({ label: 'Questions still open', outcome: warns.length ? `${count(warns.length, 'warning')}` : 'none', status: warns.length ? 'warn' : 'ok', detail: warns.length ? 'They do not change the route but lower the confidence to "needs confirmation".' : '' });
  steps.push({ label: 'Result', outcome: a.label, status: a.verdict === 'permitted_development' ? 'ok' : a.verdict === 'prior_approval' ? 'warn' : 'fail', detail: `Confidence: ${a.confidence}.` });
  return steps;
}

/** The whole rulebook in one object (GET /api/engine/rules): every site rule with its numbers, and every GPDO limit and provision. */
export function buildRulebook() {
  return {
    siteRules: SITE_RULES.map((r) => describeRule(r.id)),
    thresholds: THRESHOLDS,
    gpdo: { schedule: SCHEDULE, limits: LIMITS, classes: Object.values(CLASSES).map((c) => ({ class: c.class, title: c.title, workTypes: c.workTypes, provisions: c.provisions.map((p) => ({ id: p.id, ref: p.ref, kind: p.kind, text: p.text })) })) },
    notes: [
      'Site rules measure the plan (distances, overlaps, walls). Only the rules marked "can change the verdict" feed the permitted-development result.',
      'GPDO limits are data (src/data/gpdo.js); paragraph letters should be checked against legislation.gov.uk before quoting them formally.',
      'This is screening, not a decision: confirm with the council or a Lawful Development Certificate.',
    ],
  };
}
