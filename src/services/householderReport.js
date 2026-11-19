import { buildBlockPlanSvg } from './planExport.js';
import { WORK_TYPES, describeProposal } from './workTypes.js';
import { titleOf } from './titleInfo.js';

/**
 * HOUSEHOLDER REPORT: the "Property Intelligence" report (cover, dashboard, domains, route, findings, site, inside, ground, actions, limits)
 * built ONLY from what the engine already holds for one application. Nothing is invented and nothing is simulated:
 *   buildReportModel(doc, app)  doc = buildLiveRegister() (the 228 checks + readiness gate), app = the stored draft  ->  plain JSON
 *   renderReportHtml(model)     one self-contained, paged A4 HTML document (open it and use the browser's Print > Save as PDF)
 * Status words follow the register: pass = Passed, issue = Conflict, awaiting = Pending, not_built = Not run. "info" (a value, neither pass nor issue) is
 * shown as Noted. A pass is limited to its own test and never means the work is authorised.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const STATES = [['pass', 'Passed'], ['issue', 'Conflict'], ['info', 'Noted'], ['awaiting', 'Pending'], ['not_built', 'Not run']];
const LABEL = Object.fromEntries(STATES);
const tally = (rows) => Object.fromEntries(STATES.map(([k]) => [k, rows.filter((r) => r.live.state === k).length]));
const tone = (rows) => (rows.some((r) => r.live.state === 'issue') ? 'bad' : rows.some((r) => r.live.state === 'awaiting' || r.live.state === 'not_built') ? 'warn' : 'ok');
const first = (rows, st) => rows.find((r) => r.live.state === st);

/** What the user can do about a row: the register's own evidence requirement (or the suggested route for a check that is not built). */
function nextStep(r) {
  if (r.live.state === 'not_built') return r.routeLabel ? `Not run in this engine. Route: ${r.routeLabel}` : 'Not run in this engine yet.';
  if (r.live.state === 'pass' || r.live.state === 'info') return `Confirm with: ${clip(r.evidence, 110)}`;
  return `${r.live.state === 'issue' ? 'Resolve with' : 'Obtain'}: ${clip(r.evidence, 110)}`;
}

export function buildReportModel(doc, app) {
  const rows = doc.checks, A = app ?? {}, as = A.assessment ?? null;
  const dom = (no) => rows.filter((r) => r.domain === no);
  const domains = doc.domains.map((d) => ({ no: d.no, name: d.name, gate: d.gate, reviewer: d.reviewer, total: dom(d.no).length, counts: tally(dom(d.no)), tone: tone(dom(d.no)) }));
  const reviewerOf = (id) => doc.domains.find((d) => d.no === String(id ?? '').slice(3, 5))?.reviewer ?? 'Planning consultant';
  const mandatory = new Set(['PI-01-01', 'PI-05-01', 'PI-05-02', 'PI-05-03', 'PI-05-18', 'PI-17-06', 'PI-17-07']);

  // The three questions every householder asks, answered from the register rows that bear on them.
  const q = (title, sel) => { const s = rows.filter(sel); const hit = first(s, 'issue') ?? first(s, 'awaiting') ?? first(s, 'info') ?? s[0]; return { title, tone: tone(s), text: hit ? clip(hit.live.value, 170) : 'No reading yet.', counts: tally(s) }; };
  const questions = [
    q('Can I build it without a planning application?', (r) => ['PI-05-01', 'PI-05-02', 'PI-05-03', 'PI-05-04', 'PI-05-05', 'PI-05-06', 'PI-05-07', 'PI-05-18'].includes(r.id)),
    q('Is the land safe to build on?', (r) => ['08', '09', '10', '12', '13'].includes(r.domain)),
    q('Will the inside of the house work?', (r) => r.domain === '14'),
  ];

  // Priority findings: every conflict, then the mandatory checks that have no reading yet; the first eight.
  const priority = [...rows.filter((r) => r.live.state === 'issue'), ...rows.filter((r) => mandatory.has(r.id) && r.live.state === 'awaiting')].slice(0, 8)
    .map((r) => ({ id: r.id, name: r.name, state: r.live.state, finding: clip(r.live.value, 190), next: nextStep(r), domain: r.domainName }));

  const actions = (doc.readiness?.blockers ?? []).slice(0, 8).map((b, i) => ({ n: i + 1, text: clip(b.message, 200), owner: reviewerOf(b.checkId ?? 'PI-01-01'), status: 'Open' }));
  const sig = (st) => rows.filter((r) => r.review?.status === st).length;

  return {
    generatedAt: new Date().toISOString(), applicationId: A.id ?? doc.applicationId, reference: A.reference ?? null, edition: 'Householder',
    property: {
      address: A.address?.fullAddress ?? doc.address, uprn: A.address?.uprn ?? null, ...(({ titleNumber, tenureLabel, tenureSource, leaseYearsRemaining }) => ({ titleNumber, tenure: tenureLabel, tenureSource, leaseYearsRemaining }))(titleOf(A)), authority: A.authority?.name ?? null, type: A.address?.classification?.propertyType ?? null,
      footprintM2: A.footprint?.areaM2 ? Math.round(A.footprint.areaM2) : null, plotM2: A.plot?.areaM2 ? Math.round(A.plot.areaM2) : null, plotEstimated: !!A.plot?.estimated,
      streetView: !!A.media?.streetView?.available, attribution: A.media?.aerial?.attribution ?? null,
      proposal: A.proposal ? { label: WORK_TYPES[A.proposal.type]?.label ?? A.proposal.type, rows: describeProposal(A.proposal) } : null,
    },
    position: { state: doc.readiness?.state ?? 'held', headline: doc.readiness?.released ? 'READY FOR REVIEW' : 'VERIFICATION REQUIRED', summary: doc.readiness?.summary ?? '', counts: tally(rows), total: rows.length },
    coverage: doc.coverage, questions, domains, priority, actions,
    route: as ? { label: as.label ?? as.verdict, verdict: as.verdict, confidence: as.confidence ?? null, summary: as.summary ?? '', gpdo: as.gpdo ? { class: as.gpdo.class, title: as.gpdo.title } : null, provisions: (as.gpdo?.provisions ?? []).map((p) => ({ ref: p.ref, text: clip(p.text, 100), status: p.status, note: clip(p.evidence?.[0]?.message, 100) })) } : null,
    interior: A.interior?.available ? { checks: (A.interior.checks ?? []).slice(0, 8).map((c) => ({ status: c.status, message: clip(c.message, 200) })), disclaimer: A.interior.disclaimer } : { checks: [], disclaimer: A.interior?.reason ?? 'No interior model for this application yet.' },
    ground: ['02', '07', '08', '09', '12', '13'].map((no) => { const d = domains.find((x) => x.no === no), s = dom(no); return { name: d.name, tone: d.tone, counts: d.counts, more: Math.max(0, s.filter((r) => r.live.state === 'issue' || r.live.state === 'awaiting').length - 1), items: [...s.filter((r) => r.live.state === 'issue'), ...s.filter((r) => r.live.state === 'awaiting')].slice(0, 1).map((r) => ({ id: r.id, name: r.name, state: r.live.state, value: clip(r.live.value, 120) })) }; }),
    evidence: { onFile: rows.reduce((n, r) => n + (r.evidenceCount ?? 0), 0), surveys: (A.surveys ?? []).map((s) => ({ kind: s.kind ?? s.type ?? 'survey', status: s.status })), signed: sig('verified'), stale: sig('stale'), queried: sig('query') + sig('rejected') },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------ HTML
const CSS = `@page{size:A4;margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}:root{--ink:#0b1a2b;--ink2:#12283f;--mut:#6a7b8d;--teal:#0ea5b0;--mint:#7be8df;--line:#dbe3ea;--soft:#eef3f6;--ok:#13a16e;--bad:#c9455b;--warn:#cd8a2c;--grey:#9aa7b4}
*{box-sizing:border-box}body{margin:0;background:#cfd8e0;color:var(--ink);font:13px/1.45 Lato,"Segoe UI",Arial,sans-serif}
.bar{max-width:210mm;margin:12px auto 0;color:#314456;font-size:12px}.pg{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:0 0 14mm;position:relative;page-break-after:always;break-after:page;overflow:hidden}
.hd{background:var(--ink);color:#d6e2ec;padding:9mm 14mm 6mm;display:flex;justify-content:space-between;font-size:11px;letter-spacing:.04em}.hd b{color:#fff;font-size:15px;letter-spacing:0}
.in{padding:10mm 14mm 0}.k{color:var(--teal);font-weight:700;font-size:11px}h1{font-size:30px;line-height:1.1;margin:4px 0 6px}h2{font-size:15px;margin:16px 0 6px}.lead{color:var(--mut);margin:0 0 12px;max-width:150mm}
.ft{position:absolute;left:14mm;right:14mm;bottom:7mm;border-top:1px solid var(--line);padding-top:4px;color:var(--mut);font-size:10px;display:flex;justify-content:space-between}
.cover{background:var(--ink);color:#fff}.cover h1{font-size:46px;margin:14mm 0 2mm}.cover h1 span{color:var(--mint)}.cover .lead{color:#b9c9d6}.cover .ft{color:#8fa3b3;border-color:#28405a}
.hero{margin:8mm 14mm 0;border-radius:6mm;overflow:hidden;border:1px solid #2c4a68;position:relative;height:110mm;background:#122b44}.hero img{width:100%;height:100%;object-fit:cover;display:block}
.tag{position:absolute;left:5mm;bottom:5mm;background:rgba(7,20,34,.88);padding:3mm 5mm;border-radius:3mm;font-size:12px;color:#c9d8e4;max-width:150mm}.tag b{display:block;color:#fff;font-size:20px}
.stats{display:flex;gap:10mm;margin:8mm 14mm 0}.stats div{color:#9db1c1;font-size:11px}.stats b{display:block;color:var(--mint);font-size:30px}
.verdict{background:var(--ink2);color:#fff;border-radius:4mm;padding:6mm 7mm;margin:4mm 0}.verdict .k{color:var(--mint)}.verdict b{display:block;font-size:26px;margin:2px 0 4px}.verdict p{margin:0;color:#b9c9d6}
.cnt{display:flex;gap:3mm;margin:4mm 0}.cnt div{flex:1;background:var(--soft);border-radius:3mm;padding:3mm 4mm;color:var(--mut);font-size:11px}.cnt b{display:block;font-size:24px}
.bar2{display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e3e9ee}.s-pass{background:var(--ok);color:var(--ok)}.s-issue{background:var(--bad);color:var(--bad)}.s-info{background:#4a90c2;color:#4a90c2}.s-awaiting{background:var(--warn);color:var(--warn)}.s-not_built{background:var(--grey);color:var(--grey)}
.row{display:flex;gap:4mm;align-items:flex-start;background:var(--soft);border-left:4px solid var(--grey);border-radius:3mm;padding:3mm 4mm;margin:0 0 2.5mm;break-inside:avoid}.row.bad{border-color:var(--bad)}.row.warn{border-color:var(--warn)}.row.ok{border-color:var(--ok)}
.row .m{flex:1}.row b{display:block}.row small{color:var(--mut)}.row .x{width:52mm;font-size:11px;color:#35506a}.pill{font-size:10px;font-weight:700;border-radius:9px;padding:1px 8px;background:#fff;border:1px solid currentColor;white-space:nowrap}
table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top;font-size:12px}th{color:var(--mut);font-weight:700;font-size:11px}
.plan svg{width:100%;height:auto;border:1px solid var(--line);border-radius:3mm}.note{background:#eaf7f6;border-left:4px solid var(--mint);padding:3mm 4mm;border-radius:2mm;margin:4mm 0 0;font-size:12px}
.glos{columns:2;column-gap:8mm;font-size:11px;color:#35506a}.glos p{margin:0 0 5px;break-inside:avoid}.glos b{color:var(--ink)}
.tight .in{padding-top:6mm}.tight .row{padding:2mm 3mm;margin-bottom:1.5mm}.tight td{padding:2px 6px}.tight h2{margin:9px 0 3px}.tight .lead{margin-bottom:6px}.tight .note{margin-top:3mm}
@media screen and (max-width:230mm){.pg{width:auto;margin:8px}.row{flex-direction:column}.row .x{width:auto}.hero{height:70mm}}
@media print{body{background:#fff}.pg{margin:0;box-shadow:none}.bar{display:none}}`;

const pill = (st) => `<span class="pill s-t-${st}" style="color:var(--${{ pass: 'ok', issue: 'bad', info: 'teal', awaiting: 'warn', not_built: 'grey' }[st]})">${esc(LABEL[st] ?? st)}</span>`;
const mix = (c, total) => `<div class="bar2">${STATES.map(([k]) => (c[k] ? `<i class="s-${k}" style="width:${(c[k] / total) * 100}%"></i>` : '')).join('')}</div>`;
const rowCard = (title, sub, right, t = 'ok', extra = '') => `<div class="row ${t}"><div class="m"><b>${esc(title)}</b><small>${esc(sub)}</small></div>${extra ? `<div class="x">${extra}</div>` : ''}${right}</div>`;

export function renderReportHtml(m, { planSvg = '', base = '' } = {}) {
  const p = m.property, pos = m.position, total = pos.total || 1;
  let pn = 1;
  const date = new Date(m.generatedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase();
  const foot = (i) => `<div class="ft"><span>AI4PLANNING / ${esc(m.reference ?? m.applicationId)} / ENGINE-DERIVED READINGS</span><span>HOUSEHOLDER REPORT ${i} / 9</span></div>`;
  const head = (a, b) => `<div class="hd"><div><b>AI4Planning</b></div><div style="text-align:right">${esc(a)}<br>${esc(b)}</div></div>`;
  const page = (k, title, lead, body, cls = '') => { const i = ++pn; return `<section class="pg ${cls}">${head('HOUSEHOLDER / PROPERTY INTELLIGENCE', `REPORT / ${date}`)}<div class="in"><div class="k">${esc(k)}</div><h1 style="font-size:26px">${esc(title)}</h1><p class="lead">${esc(lead)}</p>${body}</div>${foot(i)}</section>`; };

  const img = `${base}/api/applications/${esc(m.applicationId)}/media/${p.streetView ? 'street-view' : 'aerial'}`;
  const cover = `<section class="pg cover"><div class="hd" style="background:none"><div><b>AI4Planning</b></div><div style="text-align:right">${date} / HOUSEHOLDER EDITION</div></div>
<div class="in"><div class="k" style="color:var(--mint)">01 / HOUSEHOLDER EDITION</div><h1>Your property.<br><span>Clearly understood.</span></h1><p class="lead">What you could build, what might stand in your way, and what happens next. Every reading below comes from the data the engine holds for this address.</p></div>
<div class="hero"><img src="${img}" alt="${p.streetView ? 'Street view' : 'Aerial view'} of the property"><div class="tag"><b>${esc(p.address ?? 'Property')}</b>${esc([p.authority, p.uprn && `UPRN ${p.uprn}`, p.titleNumber && `Title ${p.titleNumber}`, p.tenure !== 'Not known' && p.tenure, m.reference].filter(Boolean).join(' | '))}${p.attribution ? `<br><small>${esc(p.attribution)}</small>` : ''}</div></div>
<div class="stats"><div><b>${pos.total}</b>checks in the register</div><div><b>${m.coverage.built}</b>built in this engine</div><div><b>${pos.counts.issue}</b>conflicts found</div></div>
<div class="in"><p style="color:#9db1c1;margin-top:8mm"><b style="color:#fff">Evidence first. Planning outcome never assumed.</b><br>${p.proposal ? `Proposal: ${esc(p.proposal.label)}.` : 'No proposal chosen yet.'}</p></div>${foot(1)}</section>`;

  const dash = page('02 / YOUR DASHBOARD', 'Your property. One clear picture.', 'Where this application stands across all checks, and the three questions that matter first.',
    `<div class="verdict"><div class="k">OVERALL POSITION</div><b>${esc(pos.headline)}</b><p>${esc(pos.summary)}</p></div>
<div class="cnt">${STATES.map(([k, l]) => `<div><b style="color:var(--${{ pass: 'ok', issue: 'bad', info: 'teal', awaiting: 'warn', not_built: 'grey' }[k]})">${pos.counts[k]}</b>${l}</div>`).join('')}</div>${mix(pos.counts, total)}
<h2>The property</h2><table>${[['Address', p.address], ['UPRN', p.uprn ?? 'Not matched yet'], ['Title number', p.titleNumber ? `${p.titleNumber} (entered by the applicant; check it against the title register)` : 'Not entered yet. It is not in open data: get it from the title register.'], ['Tenure', p.tenure === 'Not known' ? 'Not known' : `${p.tenure}${p.leaseYearsRemaining != null ? `, about ${p.leaseYearsRemaining} years left` : ''} (${p.tenureSource})`], ['Local authority', p.authority ?? 'Not resolved'], ['Property type', p.type ?? 'Not confirmed']].map(([k, v]) => `<tr><th style="width:34mm">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>Your three biggest questions</h2>${m.questions.map((x) => rowCard(x.title, x.text, pill(x.counts.issue ? 'issue' : x.counts.awaiting ? 'awaiting' : 'pass'), x.tone)).join('')}
<div class="note">A pass means one test passed. It never means the work has been authorised. A reading becomes a verified finding only when a named reviewer signs it (${m.evidence.signed} signed, ${m.evidence.stale} out of date, ${m.evidence.queried} queried or rejected).</div>`);

  const doms = page('03 / DOMAINS', `${m.domains.length} evidence domains`, 'Each domain groups the checks that answer one everyday question. The bar shows passed, conflict, noted, pending and not run.',
    `<table><tr><th style="width:8mm">#</th><th>Domain</th><th style="width:14mm">Checks</th><th style="width:44mm">Status mix</th></tr>${m.domains.map((d) => `<tr><td><b>${esc(d.no)}</b></td><td><b>${esc(d.name)}</b><div style="color:var(--mut);font-size:11px">${esc(clip(d.gate, 80))}</div></td><td>${d.total}</td><td>${mix(d.counts, d.total || 1)}<small style="color:var(--mut)">${d.counts.pass} pass · ${d.counts.issue} conflict · ${d.counts.awaiting} pending · ${d.counts.not_built} not run</small></td></tr>`).join('')}</table>`, 'tight');

  const r = m.route, prov = r?.provisions ?? [];
  const route = page('04 / PLANNING ROUTE', 'Can I build without permission?', 'The engine tests the proposal against the permitted-development rules. One passing test is never a planning conclusion.',
    r ? `<div class="verdict"><div class="k">${esc(r.gpdo ? `CLASS ${r.gpdo.class} – ${r.gpdo.title}` : 'ROUTE')}</div><b style="font-size:20px">${esc(r.label)}</b><p>${esc(r.summary)}${r.confidence ? ` Confidence: ${esc(r.confidence)}.` : ''}</p></div>
<table><tr><th style="width:18mm">Ref</th><th>Requirement</th><th style="width:48mm">Position</th></tr>${prov.slice(0, 8).map((x) => `<tr><td><b>${esc(x.ref)}</b></td><td>${esc(x.text)}</td><td>${esc({ pass: 'Met', fail: 'Not met', uncertain: 'To confirm', condition: 'Condition', not_assessed: 'Not tested' }[x.status] ?? x.status)}${x.note ? `<div style="color:var(--mut);font-size:11px">${esc(x.note)}</div>` : ''}</td></tr>`).join('')}</table>${prov.length > 8 ? `<p class="lead">${prov.length - 8} more provisions in the Lawful Development Certificate statement.</p>` : ''}`
      : `<div class="note">No work has been chosen yet, so no route can be tested. Choose the type of work and its dimensions, then regenerate this report.</div>`, 'tight');

  const find = page('05 / PRIORITY FINDINGS', 'The alerts that deserve your attention.', 'Conflicts first, then the mandatory checks that still have no reading. Each shows what the engine found and what evidence would settle it.',
    m.priority.length ? m.priority.map((x) => rowCard(`${x.id} ${x.name}`, `${x.domain}: ${x.finding}`, pill(x.state), x.state === 'issue' ? 'bad' : 'warn', `<b style="font-size:10px;color:var(--teal)">NEXT</b> ${esc(x.next)}`)).join('') : '<div class="note">No conflicts and no missing mandatory readings.</div>');

  const side = page('06 / OUTSIDE YOUR HOME', 'See the proposal on the site.', 'Block plan drawn from the engine’s own geometry: house, plot, proposal, neighbours, roads and street features.',
    `<div class="plan">${planSvg || '<div class="note">No map is available for this property yet.</div>'}</div>${p.proposal ? `<table>${p.proposal.rows.map((x) => `<tr><th style="width:40mm">${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</table>` : ''}
<div class="note">Drawn from open map data (OpenStreetMap, HM Land Registry INSPIRE). Not a surveyed plan; positions can be a metre or more out. A map proximity alert is not proof of an on-site obstruction.</div>`);

  const ins = page('07 / INSIDE YOUR HOME', 'Walk through the rooms you want to change.', 'Guidance checks on the rooms the proposal creates or changes.',
    `${m.interior.checks.length ? m.interior.checks.map((c) => rowCard(c.message, '', pill(c.status === 'fail' ? 'issue' : c.status === 'pass' ? 'pass' : 'info'), c.status === 'fail' ? 'bad' : c.status === 'pass' ? 'ok' : 'warn')).join('') : ''}<div class="note">${esc(m.interior.disclaimer)} Structural and fire assessments must be made by qualified professionals.</div>`);

  const grd = page('08 / TITLE, LAND AND ENVIRONMENT', 'Not every restriction is a planning rule.', 'Covenants, heritage, flooding, ground, trees and environmental records, each with its most pressing items.',
    m.ground.map((g) => `<h2>${esc(g.name)}</h2>${mix(g.counts, Object.values(g.counts).reduce((a, b) => a + b, 0) || 1)}${g.items.length ? g.items.map((i) => rowCard(`${i.id} ${i.name}`, i.value, pill(i.state), i.state === 'issue' ? 'bad' : 'warn')).join('') : '<small style="color:var(--mut)">No conflicts and nothing pending.</small>'}${g.more ? `<small style="color:var(--mut)">+ ${g.more} more conflict or pending check(s) in this domain: see the register.</small>` : ''}`).join('')
    + `<div class="note">An LPA planning decision does not resolve private legal rights. “No record found” is never “none exists”: council and map coverage varies.</div>`, 'tight');

  const act = page('09 / ACTIONS, LIMITS AND TERMS', 'Your next actions.', 'What stands between this application and release, with who normally resolves each item.',
    `${m.actions.length ? m.actions.map((a) => rowCard(`${a.n}. ${a.text}`, `Owner: ${a.owner}`, `<span class="pill" style="color:var(--warn)">${esc(a.status)}</span>`, 'warn')).join('') : '<div class="note">The readiness gate is clear.</div>'}
<div class="verdict" style="margin-top:6mm"><div class="k">THE GO / NO-GO GATE</div><p>Do not treat the development as submission-ready until the planning route, dimensions, constraints and required professional evidence have been verified. ${m.evidence.onFile} evidence item(s) on file${m.evidence.surveys.length ? `; ${m.evidence.surveys.length} survey request(s)` : ''}.</p></div>
<h2>Terms</h2><div class="glos"><p><b>GPDO</b> General Permitted Development Order.</p><p><b>Article 4</b> A direction that can remove permitted development rights.</p><p><b>UPRN</b> Unique Property Reference Number.</p><p><b>LPA</b> Local Planning Authority.</p><p><b>DNO</b> Distribution Network Operator (electricity).</p><p><b>TPO</b> Tree Preservation Order.</p><p><b>Passed / Conflict / Pending / Not run</b> One test passed / needs review / data or evidence missing / this engine has no check yet.</p><p><b>Noted</b> A value reported that is neither a pass nor a conflict.</p></div>
<div class="note"><b>Limits.</b> Engine-derived readings from public data, not a determination by the council, Building Control, a utility or a title authority. ${m.coverage.built} of ${m.coverage.total} register checks are built; ${m.coverage.missing} are not. Full check-by-check table: <a href="${base}/api/applications/${esc(m.applicationId)}/intelligence?format=html">open the register</a>.</div>`, 'tight');

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Householder report – ${esc(p.address ?? '')}</title><style>${CSS}</style></head><body>
<div class="bar">To save as PDF: Print (Ctrl/Cmd + P), choose “Save as PDF”, paper A4, margins none, background graphics on.</div>${cover}${dash}${doms}${route}${find}${side}${ins}${grd}${act}</body></html>`;
}

/** Convenience for the route: the SVG block plan is embedded when a map exists. */
export function planSvgFor(app) {
  try { return buildBlockPlanSvg(app).replace(/^<\?xml[^>]*>\s*/, ''); } catch { return ''; }
}
