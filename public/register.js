// The 228-check register screen. Reads /api/intelligence (catalogue) or /api/applications/:id/intelligence (live); evidence, surveys and sign-off use the register workflow endpoints.
// Every piece of text is added as a text node, never parsed as markup, so data from the API cannot inject HTML.
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const STATUS = { have: 'Have', partial: 'Partial', missing: 'Not built' };
const LIVE = { pass: 'Pass', issue: 'Issue', info: 'Info', awaiting: 'Awaiting data', not_built: 'Not built' };
const badge = (cls, text) => el('span', { class: `b ${cls}` }, text);

const appId = new URLSearchParams(location.search).get('app');
const S = { doc: null, live: false, tab: 'checks', f: { q: '', status: '', result: '', domain: '', off: false, route: '' }, selected: null, key: '', msg: '', surveys: [], evidence: [] };
const REVIEW = { verified: 'have', stale: 'partial', rejected: 'issue', query: 'info' };
const reviewBadge = (rv) => (rv ? badge(REVIEW[rv.status] ?? 'info', rv.status) : null);

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await r.json().catch(() => null);
  if (!r.ok && r.status !== 409) throw new Error(body?.error?.message ?? body?.message ?? `${r.status} ${r.statusText}`);
  return body;
}

async function load() {
  let note = '';
  try {
    if (appId) { S.doc = await getJson(`/api/applications/${encodeURIComponent(appId)}/intelligence`); S.live = true; }
  } catch (e) { note = `Could not load application ${appId} (${e.message}). Showing the catalogue instead.`; }
  if (!S.doc) { S.doc = await getJson('/api/intelligence'); S.live = false; }
  if (S.live) S.surveys = (await getJson(`/api/applications/${encodeURIComponent(appId)}/surveys`).catch(() => ({ surveys: [] }))).surveys ?? [];
  $('#sub').textContent = S.live
    ? `${S.doc.address ?? 'Application'} · engine-derived readings, not verified findings`
    : `${note || 'Catalogue view: what the engine covers. Open an application to see its readings.'}`;
  const base = S.live ? `/api/applications/${encodeURIComponent(appId)}/intelligence` : '/api/intelligence';
  $('#lnk-csv').href = `${base}?format=csv`; $('#lnk-html').href = `${base}?format=html`;
  $('#f-result').hidden = !S.live;
  const routes = [...new Set(S.doc.checks.map((c) => c.routeLabel).filter(Boolean))];
  $('#f-route').replaceChildren(el('option', { value: '' }, 'Any route to close'), ...routes.map((r) => el('option', { value: r }, r)));
  render();
}

// ---------------------------------------------------------------------------------------------------------- filtering
const matches = (c) => {
  const f = S.f;
  if (f.domain && c.domain !== f.domain) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.result && c.live?.state !== f.result) return false;
  if (f.off && c.runtime !== 'off') return false;
  if (f.route && c.routeLabel !== f.route) return false;
  if (f.q) { const t = `${c.id} ${c.name} ${c.evidence} ${c.acceptance} ${c.note} ${c.live?.value ?? ''}`.toLowerCase(); if (!f.q.toLowerCase().split(/\s+/).every((w) => t.includes(w))) return false; }
  return true;
};

// ---------------------------------------------------------------------------------------------------------- rendering
function renderBanner() {
  const box = $('#banner'), r = S.doc.readiness;
  box.hidden = !S.live || !r; if (box.hidden) return;
  box.className = `banner ${r.state}`;
  const title = r.released ? (r.withExceptions ? 'Ready for release, with recorded exceptions' : 'Ready for release') : 'Held: not for release';
  box.replaceChildren(el('h2', {}, badge(r.released ? 'pass' : 'issue', r.state.toUpperCase()), ' ', title),
    el('p', {}, r.summary),
    r.blockers.length ? el('div', {}, el('b', {}, 'What stands in the way'), el('ul', {}, r.blockers.map((x) => el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); if (x.checkId) open(x.checkId); } }, x.checkId ?? x.code), ` ${x.message}`)))) : null,
    r.exceptions?.length ? el('div', {}, el('b', {}, 'Recorded exceptions'), el('ul', {}, r.exceptions.map((x) => el('li', {}, `${x.checkId}: ${x.reason} (${x.by})`)))) : null,
    el('p', { class: 'muted' }, S.doc.notice));
}

function renderCards() {
  const s = S.doc.coverage ?? S.doc.summary, box = $('#cards');
  const card = (cls, n, label, on, set) => el('button', { type: 'button', class: `card ${cls}${on ? ' on' : ''}`, onclick: set }, el('b', {}, n), label);
  const status = (v) => () => { S.f.status = S.f.status === v ? '' : v; S.f.result = ''; sync(); render(); };
  const res = (v) => () => { S.f.result = S.f.result === v ? '' : v; S.f.status = ''; sync(); render(); };
  const items = [
    el('div', { class: 'card' }, el('b', {}, s.total), 'checks in the register'),
    card('have', s.have, `have (${s.havePct}%)`, S.f.status === 'have', status('have')),
    card('partial', s.partial, `partial (${s.partialPct}%)`, S.f.status === 'partial', status('partial')),
    card('missing', s.missing, `not built (${s.missingPct}%)`, S.f.status === 'missing', status('missing')),
  ];
  if (S.live) for (const k of ['pass', 'issue', 'info', 'awaiting']) items.push(card(k, S.doc.live[k], `${LIVE[k].toLowerCase()} for this application`, S.f.result === k, res(k)));
  box.replaceChildren(...items);
}

function renderDomains() {
  const box = $('#domains');
  const all = el('button', { type: 'button', class: `dom${S.f.domain ? '' : ' on'}`, onclick: () => { S.f.domain = ''; render(); } }, el('b', {}, 'All 17 domains'), ' ', el('small', {}, `${S.doc.checks.length} checks`));
  box.replaceChildren(all, ...S.doc.domains.map((d) => {
    const s = d.summary, t = s.total || 1;
    return el('button', { type: 'button', class: `dom${S.f.domain === d.no ? ' on' : ''}`, onclick: () => { S.f.domain = S.f.domain === d.no ? '' : d.no; render(); }, title: d.gate },
      el('b', {}, `${d.no} ${d.name}`), el('br'), el('small', {}, `${s.have} have · ${s.partial} partial · ${s.missing} not built`),
      el('div', { class: 'bar' }, el('i', { class: 'h', style: `width:${(s.have / t) * 100}%` }), el('i', { class: 'p', style: `width:${(s.partial / t) * 100}%` }), el('i', { class: 'm', style: `width:${(s.missing / t) * 100}%` })));
  }));
}

function renderTabs() {
  const tabs = [['checks', 'Checks'], ['roadmap', `Not built (${S.doc.coverage?.missing ?? S.doc.summary.missing})`]];
  if (S.live) tabs.push(['queue', `Review queue (${queueRows().length})`], ['surveys', `Survey requests (${S.surveys.length})`]);
  $('#tabs').replaceChildren(...tabs.map(([k, t]) => el('button', { type: 'button', role: 'tab', class: `tab${S.tab === k ? ' on' : ''}`, 'aria-selected': S.tab === k, onclick: () => { S.tab = k; render(); } }, t)));
}

function checksTable(rows) {
  if (!rows.length) return el('p', { class: 'muted' }, 'No checks match these filters.');
  const head = ['ID', 'Parameter', 'Engine', S.live ? 'Result' : null, S.live ? 'Finding' : 'What the engine does / needs'].filter(Boolean);
  return el('div', { class: 'w' }, el('p', { class: 'muted' }, `${rows.length} of ${S.doc.checks.length} checks`), el('table', {},
    el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))),
    el('tbody', {}, rows.map((c) => el('tr', { class: 'row', tabindex: 0, onclick: () => open(c.id), onkeydown: (e) => { if (e.key === 'Enter') open(c.id); } },
      el('td', {}, c.id), el('td', {}, c.name),
      el('td', {}, badge(c.status, STATUS[c.status]), c.runtime === 'off' ? [' ', badge('off', 'switched off')] : null),
      S.live ? el('td', {}, badge(c.live.state, LIVE[c.live.state]), c.review ? [' ', reviewBadge(c.review)] : null, c.evidenceCount ? [' ', badge('info', `${c.evidenceCount} evidence`)] : null) : null,
      el('td', {}, String(S.live ? c.live.value : c.note).slice(0, 220)))))));
}

function roadmap() {
  const miss = S.doc.checks.filter((c) => c.status === 'missing' && matches({ ...c, status: 'missing' }));
  const groups = new Map();
  for (const c of miss) { const k = c.routeLabel ?? 'Other'; groups.set(k, [...(groups.get(k) ?? []), c]); }
  if (!groups.size) return el('p', { class: 'muted' }, 'Nothing to show for these filters.');
  return el('div', {}, [...groups].map(([k, list]) => el('div', { class: 'group' }, el('h3', {}, `${k} (${list.length})`),
    el('ul', {}, list.map((c) => el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); open(c.id); } }, c.id), ` ${c.name}: `, el('span', { class: 'muted' }, c.note)))))));
}

// The review queue is derived here from the live readings: every issue (critical) and every reading that is still awaiting data, unless a reviewer has already accepted it.
function queueRows() {
  const rows = S.doc.checks.filter((c) => (c.live.state === 'issue' || c.live.state === 'awaiting') && c.status !== 'missing' && c.review?.status !== 'verified');
  const dom = (c) => S.doc.domains.find((d) => d.no === c.domain);
  return rows.map((c) => ({ id: c.id, name: c.name, priority: c.live.state === 'issue' ? 'critical' : 'normal', reason: c.review?.status === 'stale' ? `Sign-off is out of date. ${c.live.value}` : c.live.value, reviewer: dom(c)?.reviewer ?? '' }))
    .sort((x, y) => (x.priority === y.priority ? x.id.localeCompare(y.id) : x.priority === 'critical' ? -1 : 1));
}
function queue() {
  const q = queueRows();
  if (!q.length) return el('p', { class: 'ok' }, 'Nothing is waiting for review.');
  return el('div', { class: 'w' }, el('table', {}, el('thead', {}, el('tr', {}, ['Priority', 'Check', 'Why', 'Reviewer role'].map((h) => el('th', {}, h)))),
    el('tbody', {}, q.map((x) => el('tr', { class: 'row', tabindex: 0, onclick: () => open(x.id), onkeydown: (e) => { if (e.key === 'Enter') open(x.id); } },
      el('td', {}, badge(x.priority === 'critical' ? 'issue' : 'awaiting', x.priority)), el('td', {}, `${x.id} ${x.name}`), el('td', {}, String(x.reason).slice(0, 200)), el('td', {}, x.reviewer))))));
}

function surveys() {
  const s = S.surveys;
  if (!s.length) return el('p', { class: 'muted' }, 'No survey has been requested for this application yet. Survey requests are made through POST /api/applications/:id/surveys and returned results become evidence.');
  return el('ul', {}, s.map((x) => el('li', {}, el('b', {}, `${x.kind} survey`), ` (${x.status}), `, `${x.brief?.items?.length ?? 0} check(s): `, (x.brief?.items ?? []).map((i) => i.checkId).join(', '), ' ', el('span', { class: 'muted' }, `requested by ${x.requestedBy}, ${String(x.createdAt).slice(0, 10)}`))));
}

function renderContent() {
  const rows = S.doc.checks.filter(matches);
  $('#content').replaceChildren(S.tab === 'checks' ? checksTable(rows) : S.tab === 'roadmap' ? roadmap() : S.tab === 'queue' ? queue() : surveys());
}

function render() { renderBanner(); renderCards(); renderDomains(); renderTabs(); renderContent(); if (S.selected) paintDrawer(); }

// ---------------------------------------------------------------------------------------------------------- detail drawer, evidence, sign-off
function open(id) { S.selected = id; S.msg = ''; S.evidence = []; paintDrawer(); if (S.live) loadEvidence(id); }
function closeDrawer() { S.selected = null; $('#drawer').hidden = true; }
const appBase = () => `/api/applications/${encodeURIComponent(appId)}`;

async function loadEvidence(id) {
  try { const j = await getJson(`${appBase()}/evidence/${id}`); if (S.selected === id) { S.evidence = (j.evidence ?? []).filter((e) => !e.withdrawn); paintDrawer(); } } catch { /* the drawer still works without the list */ }
}

function paintDrawer() {
  const c = S.doc.checks.find((x) => x.id === S.selected), box = $('#drawer');
  if (!c) return closeDrawer();
  const dom = S.doc.domains.find((d) => d.no === c.domain);
  const dl = el('dl', {},
    el('dt', {}, 'Evidence required (register)'), el('dd', {}, c.evidence),
    el('dt', {}, 'Acceptance criterion (register)'), el('dd', {}, c.acceptance),
    el('dt', {}, 'What the engine does / needs'), el('dd', {}, c.note),
    el('dt', {}, 'Engine modules'), el('dd', {}, c.modules || 'None: not built'),
    c.switchesNeeded?.length ? [el('dt', {}, 'Switched off: to turn on'), el('dd', {}, c.switchesNeeded.join('; '))] : null,
    c.routeLabel ? [el('dt', {}, 'Suggested route to close'), el('dd', {}, c.routeLabel)] : null,
    dom ? [el('dt', {}, 'Accountable reviewer (register)'), el('dd', {}, dom.reviewer), el('dt', {}, 'Domain release gate'), el('dd', {}, dom.gate)] : null);
  const live = S.live ? el('div', {}, el('h3', {}, 'Engine reading for this application'), el('p', {}, badge(c.live.state, LIVE[c.live.state]), ' ', c.live.value),
    el('p', { class: 'muted' }, 'Engine-derived. Not a verified record until a named reviewer signs it off.')) : null;
  const rv = c.review;
  const signed = rv ? el('p', {}, reviewBadge(rv), ` ${rv.decision} by ${rv.reviewer}${rv.role ? ` (${rv.role})` : ''}, ${String(rv.at).slice(0, 10)}`, rv.notes ? ` – ${rv.notes}` : '', rv.status === 'stale' ? ' The reading or the evidence changed after this was signed; sign it again.' : '') : null;
  const ev = S.live ? el('div', {}, el('h3', {}, `Evidence on file (${S.evidence.length})`),
    S.evidence.length ? el('ul', {}, S.evidence.map((e) => el('li', {}, el('b', {}, e.kind), ` from ${e.source}: ${e.summary} `, el('span', { class: 'muted' }, `(${e.recordedBy}, ${String(e.recordedAt).slice(0, 10)}${e.reference ? `, ref ${e.reference}` : ''})`)))) : el('p', { class: 'muted' }, 'None yet.'),
    el('form', { onsubmit: (e) => { e.preventDefault(); addEvidence(new FormData(e.target)); } },
      el('h3', {}, 'Add evidence'),
      el('label', {}, 'Kind ', el('select', { name: 'kind' }, ['declaration', 'document', 'survey', 'official_record', 'exception'].map((k) => el('option', { value: k }, k.replace('_', ' '))))),
      el('label', {}, 'Source ', el('select', { name: 'source' }, ['client', 'conveyancer', 'surveyor', 'specialist', 'council', 'utility', 'reviewer'].map((k) => el('option', { value: k }, k)))),
      el('label', {}, 'Your name ', el('input', { name: 'recordedBy', required: true, minlength: 2, maxlength: 80 })),
      el('label', {}, 'Summary (an exception needs the reason) ', el('textarea', { name: 'summary', rows: 2, required: true, minlength: 5, maxlength: 600 })),
      el('label', {}, 'Reference ', el('input', { name: 'reference', maxlength: 160 })),
      el('button', { type: 'submit' }, 'Save evidence'))) : null;
  const form = S.live ? el('form', { onsubmit: (e) => { e.preventDefault(); sign(new FormData(e.target)); } },
    el('h3', {}, 'Reviewer decision'),
    el('label', {}, 'Reviewer token ', el('input', { type: 'password', name: 'key', value: S.key, autocomplete: 'off', required: true })),
    el('label', {}, 'Your name ', el('input', { name: 'reviewer', required: true, minlength: 2, maxlength: 80 })),
    el('label', {}, 'Role (your qualification or position) ', el('input', { name: 'role', required: true, minlength: 2, maxlength: 120 })),
    el('label', {}, 'Decision ', el('select', { name: 'decision' }, el('option', { value: 'accepted' }, 'Accepted'), el('option', { value: 'rejected' }, 'Rejected'), el('option', { value: 'query' }, 'Query'))),
    el('label', {}, 'Notes (required unless accepted) ', el('textarea', { name: 'notes', rows: 2, maxlength: 1000 })),
    el('button', { type: 'submit' }, 'Save decision'),
    el('p', { class: S.msg.startsWith('Saved') ? 'ok' : 'err', role: 'status' }, S.msg),
    el('p', { class: 'muted' }, 'The decision is recorded against the engine reading shown above and the evidence on file; it goes stale if either changes. The token is typed each time and is not stored in the browser.')) : null;
  box.replaceChildren(el('button', { type: 'button', class: 'ghost', onclick: closeDrawer, 'aria-label': 'Close' }, 'Close'),
    el('h2', {}, `${c.id} ${c.name}`), el('p', {}, badge(c.status, STATUS[c.status]), c.runtime === 'off' ? [' ', badge('off', 'switched off')] : null, ` ${c.domain} ${c.domainName}`),
    live, signed, ev, dl, form);
  box.hidden = false;
}

async function refresh() { S.doc = await getJson(`${appBase()}/intelligence`); }

async function addEvidence(fd) {
  try {
    const r = await fetch(`${appBase()}/evidence/${S.selected}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries([...fd].filter(([, v]) => v !== ''))) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `${r.status}`);
    await refresh(); await loadEvidence(S.selected);
    S.msg = 'Saved evidence.';
  } catch (e) { S.msg = `Not saved: ${e.message}`; }
  render();
}

async function sign(fd) {
  S.key = String(fd.get('key') ?? '');
  const body = JSON.stringify(Object.fromEntries([...fd].filter(([k, v]) => k !== 'key' && v !== '')));
  try {
    const r = await fetch(`${appBase()}/sign-off/${S.selected}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${S.key}` }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? j?.message ?? `${r.status}`);
    await refresh();
    S.msg = 'Saved.';
  } catch (e) { S.msg = `Not saved: ${e.message}`; }
  render();
}

// ---------------------------------------------------------------------------------------------------------- wiring
function sync() { $('#f-q').value = S.f.q; $('#f-status').value = S.f.status; $('#f-result').value = S.f.result; $('#f-route').value = S.f.route; $('#f-off').checked = S.f.off; }
$('#f-q').addEventListener('input', (e) => { S.f.q = e.target.value; renderContent(); });
$('#f-status').addEventListener('change', (e) => { S.f.status = e.target.value; render(); });
$('#f-result').addEventListener('change', (e) => { S.f.result = e.target.value; render(); });
$('#f-route').addEventListener('change', (e) => { S.f.route = e.target.value; if (S.f.route) S.tab = 'roadmap'; render(); });
$('#f-off').addEventListener('change', (e) => { S.f.off = e.target.checked; render(); });
$('#f-reset').addEventListener('click', () => { S.f = { q: '', status: '', result: '', domain: '', off: false, route: '' }; sync(); render(); });
$('#filters').addEventListener('submit', (e) => e.preventDefault());
$('#btn-print').addEventListener('click', () => print());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.selected) closeDrawer(); });
load().catch((e) => { $('#sub').textContent = `Could not load the register: ${e.message}`; });
