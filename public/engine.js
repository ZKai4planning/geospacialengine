/* ENGINE ROOM: shows what the engine did for this application, step by step, with the plan it was looking at.
   Everything shown comes from app.engine (built on the server from what the engine already stored); nothing is calculated here except drawing. */
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((x) => x != null));
  return n;
};
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids.flat().filter((x) => x != null));
  return n;
};

const MARK = { ok: '✓', pass: '✓', warn: '!', fail: '✕', info: 'i', skipped: '–', pending: '○' };
const WALL = { // wall status -> [colour, short label, severity]
  overlaps_neighbour: ['#d62f2f', 'runs into a neighbour', 'fail'], touches_neighbour: ['#e8590c', 'touches a neighbour', 'warn'], on_boundary: ['#c2255c', 'on the boundary', 'warn'],
  within_1m: ['#f08c00', 'within 1 m of boundary', 'warn'], close_neighbour: ['#f08c00', 'narrow gap to neighbour', 'warn'], clear: ['#17794a', 'clear', 'ok'], unchecked: ['#8a92ad', 'nothing to compare with', 'info'], internal: ['#8a92ad', 'joins your house', 'info'],
};
const SEV = { fail: '#d62f2f', warn: '#e08a00', pass: '#17794a', ok: '#17794a', info: '#6b7390' };

const st = { sel: null, hover: null, playing: false, timer: null, tab: 'run', rulebook: null, open: true };

/* ---------- the plan: the geometry the rules were given (local metres, north up) ---------- */
function planSvg(eng, focusRule) {
  const g = eng.geometry;
  if (!g) return el('p', { class: 'hint' }, 'No plan to show: the rules did not run (see the "Site rules" step).');
  const all = [...g.proposal, ...(g.house ?? []), ...g.neighbours.flatMap((n) => n.ring)];
  if (g.plot && g.plot.parts.flat().length) { const pp = g.plot.parts.flat(); const bb = (a) => [Math.min(...a.map((p) => p[0])), Math.max(...a.map((p) => p[0])), Math.min(...a.map((p) => p[1])), Math.max(...a.map((p) => p[1]))]; const b = bb(pp); if (b[1] - b[0] < 70 && b[3] - b[2] < 70) all.push(...pp); }
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]), pad = 2.5;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad, W = maxX - minX, H = maxY - minY;
  const fs = Math.max(W, H) / 38;                                   // text size in metres, so it scales with the drawing
  const P = ([x, y]) => `${(x - minX).toFixed(2)},${(maxY - y).toFixed(2)}`;
  const poly = (ring) => `M${ring.map(P).join(' L')} Z`;
  const rule = (id) => eng.stages.find((s) => s.id === 'site')?.rules.find((r) => r.id === id);
  const nbStatus = Object.fromEntries((rule('neighbours')?.measures ?? []).filter((m) => m.ref?.kind === 'neighbour').map((m) => [m.ref.id, m.status]));
  const focusNb = focusRule === 'neighbours' || focusRule === 'wall-safety', focusWalls = focusRule === 'wall-safety', focusBd = focusRule === 'boundary', overview = !focusRule || !['neighbours', 'wall-safety', 'boundary', 'roads', 'trees'].includes(focusRule);
  const line = (a, b, attrs) => svg('line', { x1: (a[0] - minX).toFixed(2), y1: (maxY - a[1]).toFixed(2), x2: (b[0] - minX).toFixed(2), y2: (maxY - b[1]).toFixed(2), 'vector-effect': 'non-scaling-stroke', ...attrs });
  const txt = (p, s, attrs = {}) => svg('text', { x: (p[0] - minX).toFixed(2), y: (maxY - p[1]).toFixed(2), 'font-size': fs.toFixed(2), 'text-anchor': 'middle', class: 'ep-txt', ...attrs }, document.createTextNode(s));

  const els = [];
  els.push(svg('rect', { x: 0, y: 0, width: W.toFixed(2), height: H.toFixed(2), class: 'ep-bg' }));
  for (const r of g.roads) els.push(svg('polyline', { points: r.line.map(P).join(' '), class: 'ep-road', 'stroke-width': r.widthM, opacity: focusRule === 'roads' ? 0.55 : 0.22, fill: 'none', 'stroke-linecap': 'butt' }));
  if (g.plot) els.push(svg('path', { d: g.plot.parts.map(poly).join(' '), class: `ep-plot${g.plot.estimated ? ' est' : ''}${focusBd ? ' hot' : ''}`, 'vector-effect': 'non-scaling-stroke' }));
  for (const n of g.neighbours) {
    const s = nbStatus[n.id], hot = focusNb && s && s !== 'pass';
    els.push(svg('path', { d: poly(n.ring), class: 'ep-nb', 'vector-effect': 'non-scaling-stroke', style: hot ? `fill:${SEV[s]}33;stroke:${SEV[s]};stroke-width:2.5` : '' }));
  }
  for (const t of g.trees) els.push(svg('circle', { cx: (t.xy[0] - minX).toFixed(2), cy: (maxY - t.xy[1]).toFixed(2), r: t.radiusM, class: `ep-tree${focusRule === 'trees' ? ' hot' : ''}` }), svg('circle', { cx: (t.xy[0] - minX).toFixed(2), cy: (maxY - t.xy[1]).toFixed(2), r: 0.3, class: 'ep-trunk' }));
  if (g.house) els.push(svg('path', { d: poly(g.house), class: 'ep-house', 'vector-effect': 'non-scaling-stroke' }));
  els.push(svg('path', { d: poly(g.proposal), class: 'ep-prop', 'vector-effect': 'non-scaling-stroke' }));

  // walls: always shown (thin) when flagged; all of them, thick and labelled, when wall safety is the step being looked at
  for (const w of eng.walls) {
    const [col, word] = WALL[w.status] ?? WALL.unchecked, flagged = ['overlaps_neighbour', 'touches_neighbour', 'on_boundary', 'within_1m', 'close_neighbour'].includes(w.status);
    const hov = st.hover === `wall:${w.index}`;
    if (!focusWalls && !flagged) continue;
    els.push(line(w.from, w.to, { stroke: col, 'stroke-width': hov ? 7 : focusWalls ? 5 : 3.5, 'stroke-linecap': 'round', 'stroke-dasharray': w.status === 'internal' ? '4 4' : '', opacity: w.status === 'internal' ? 0.5 : 1 }));
    if (focusWalls && w.kind === 'external') {
      const mid = [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2], dx = w.to[0] - w.from[0], dy = w.to[1] - w.from[1], len = Math.hypot(dx, dy) || 1;
      // label sits just outside the wall (the side away from the middle of the proposal)
      const c = g.proposal.reduce((a, p) => [a[0] + p[0] / g.proposal.length, a[1] + p[1] / g.proposal.length], [0, 0]); let nx = -dy / len, ny = dx / len; if ((mid[0] - c[0]) * nx + (mid[1] - c[1]) * ny < 0) { nx = -nx; ny = -ny; }
      els.push(txt([mid[0] + nx * fs * 1.15, mid[1] + ny * fs * 1.15 - fs * 0.3], `${w.lengthM} m`, { fill: col, 'font-weight': 700 }));
      for (const key of ['neighbour', 'boundary']) {
        const m = w[key]; if (!m?.line || m.distanceM > 1.5 || m.distanceM <= 0.05) continue;
        els.push(line(m.line[0], m.line[1], { stroke: key === 'neighbour' ? '#5a3fd1' : '#c2255c', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }), txt([(m.line[0][0] + m.line[1][0]) / 2, (m.line[0][1] + m.line[1][1]) / 2 + fs * 0.9], `${m.distanceM} m`, { fill: key === 'neighbour' ? '#5a3fd1' : '#c2255c' }));
      }
    }
  }
  if (focusRule === 'neighbours') for (const w of eng.walls) if (w.neighbour?.line && w.neighbour.distanceM > 0.05 && w.neighbour.distanceM <= 3) els.push(line(w.neighbour.line[0], w.neighbour.line[1], { stroke: '#5a3fd1', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }), txt([(w.neighbour.line[0][0] + w.neighbour.line[1][0]) / 2, (w.neighbour.line[0][1] + w.neighbour.line[1][1]) / 2 + fs * 0.9], `${w.neighbour.distanceM} m`, { fill: '#5a3fd1' }));
  // north arrow + 5 m scale
  els.push(svg('g', { class: 'ep-north' }, svg('path', { d: `M${(W - 1.6).toFixed(2)},${(fs * 2.4).toFixed(2)} l0,${(-fs * 1.6).toFixed(2)} l-${(fs * 0.4).toFixed(2)},${(fs * 0.7).toFixed(2)} m${(fs * 0.4).toFixed(2)},${(-fs * 0.7).toFixed(2)} l${(fs * 0.4).toFixed(2)},${(fs * 0.7).toFixed(2)}` }), svg('text', { x: (W - 1.6).toFixed(2), y: (fs * 3.2).toFixed(2), 'font-size': fs.toFixed(2), 'text-anchor': 'middle' }, document.createTextNode('N'))));
  els.push(line([minX + 1, minY + 1], [minX + 6, minY + 1], { stroke: '#161c3a', 'stroke-width': 2 }), txt([minX + 3.5, minY + 1 + fs * 1.1], '5 m'));
  return svg('svg', { viewBox: `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`, class: 'engine-plan', role: 'img', 'aria-label': 'Plan of the proposal, neighbours and boundary as the rules saw them' }, els);
}

function planLegend(eng, focusRule) {
  const sw = (c, t, dash) => el('li', {}, el('i', { class: `esw${dash ? ' dash' : ''}`, style: `background:${dash ? 'transparent' : c + '55'};border-color:${c}` }), t);
  const items = [sw('#2f54d6', 'Proposal'), sw('#e8c000', 'Your house'), sw('#8a92ad', 'Neighbouring buildings'), sw('#d62f2f', eng.geometry?.plot?.estimated ? 'Estimated plot (not a boundary)' : 'Title boundary', !!eng.geometry?.plot?.estimated)];
  if (focusRule === 'wall-safety') for (const k of ['touches_neighbour', 'on_boundary', 'within_1m', 'clear']) items.push(sw(WALL[k][0], `Wall: ${WALL[k][1]}`));
  return el('ul', { class: 'eng-legend' }, items);
}

/* ---------- the steps ---------- */
function flatten(eng) {
  const steps = [];
  for (const s of eng.stages) {
    steps.push({ key: `stage:${s.id}`, stage: s });
    if (s.id === 'site') for (const r of s.rules ?? []) steps.push({ key: `rule:${r.id}`, rule: r, parent: s });
  }
  return steps;
}
const ruleStatus = (r) => (r.error ? 'info' : r.added.some((i) => i.status === 'fail') ? 'fail' : r.added.some((i) => i.status === 'warn') ? 'warn' : r.added.some((i) => i.status === 'pass') ? 'ok' : 'info');
const list = (items) => el('ul', { class: 'checks' }, items.map((c) => el('li', { class: c.status === 'ok' ? 'pass' : c.status }, c.message)));

function ruleDetail(r, redrawPlan) {
  return el('div', { class: 'eng-detail' },
    el('p', { class: 'eng-q' }, r.question),
    el('p', { class: 'hint' }, `Looks at: ${r.data}.`),
    r.thresholds.length ? el('table', { class: 'eng-tbl' }, el('caption', {}, 'Numbers it used'), el('tbody', {}, r.thresholds.map((t) => el('tr', {}, el('th', {}, t.key), el('td', {}, String(t.value)), el('td', {}, t.meaning))))) : null,
    r.measures.length ? el('div', {}, el('h5', {}, 'What it measured'), el('ul', { class: 'eng-meas' }, r.measures.map((m) => {
      const key = m.ref ? `${m.ref.kind}:${m.ref.index ?? m.ref.id}` : null;
      return el('li', { class: m.status, onmouseenter: key ? () => { st.hover = key; redrawPlan(); } : null, onmouseleave: key ? () => { st.hover = null; redrawPlan(); } : null },
        el('span', { class: 'mk' }, MARK[m.status] ?? 'i'), el('span', { class: 'ml' }, m.label), el('span', { class: 'mv' }, m.value));
    }))) : el('p', { class: 'hint' }, 'It had nothing to measure here.'),
    r.added.length ? el('div', {}, el('h5', {}, 'What it said'), list(r.added)) : null,
    r.error ? el('p', { class: 'note' }, `This rule failed and was skipped: ${r.error}`) : null,
    el('p', { class: 'hint' }, r.affectsVerdict ? 'Can change the permitted-development verdict.' : 'Shown on the plan and in Map checks only: it does not change the verdict.', ' ', r.limits, ` (${r.ms} ms)`));
}

function stageDetail(s) {
  return el('div', { class: 'eng-detail' },
    s.note ? el('p', { class: 'hint' }, s.note) : null,
    s.details?.length ? el('ul', { class: 'eng-meas' }, s.details.map((d) => el('li', { class: d.status ?? 'info' }, el('span', { class: 'mk' }, MARK[d.status] ?? ''), el('span', { class: 'ml' }, d.label), el('span', { class: 'mv' }, d.value)))) : null,
    s.skipped ? el('p', { class: 'note' }, s.skipped.message) : null,
    s.steps?.length ? el('ol', { class: 'eng-path' }, s.steps.map((p) => el('li', { class: p.status }, el('strong', {}, `${p.label}: `), p.outcome, p.detail ? el('div', { class: 'hint' }, p.detail) : null))) : null,
    s.checks?.length ? el('ul', { class: 'checks' }, s.checks.map((c) => el('li', { class: c.status }, c.gate ? el('span', { class: 'badge' }, 'gate') : null, c.gate ? ' ' : null, c.message))) : null,
    s.provisions?.length ? el('ul', { class: 'prov' }, s.provisions.map((p) => el('li', { class: `prov-${p.status}` }, el('span', { class: 'mk' }, { pass: '✓', fail: '✗', uncertain: '?', condition: '•', not_assessed: '–' }[p.status]), el('div', {}, el('strong', {}, p.ref), ` ${p.text}`)))) : null);
}

/* ---------- the rulebook ---------- */
function rulebookView(rb) {
  const kv = (o) => Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  return el('div', { class: 'eng-rulebook' },
    el('p', { class: 'hint' }, rb.notes.join(' ')),
    el('h4', {}, `Site rules (${rb.siteRules.length}) – they run in this order`),
    rb.siteRules.map((r, i) => el('details', {}, el('summary', {}, `${i + 1}. ${r.title}`, el('span', { class: `badge ${r.affectsVerdict ? 'yes' : ''}` }, r.affectsVerdict ? 'can change verdict' : 'plan only')),
      el('p', { class: 'eng-q' }, r.question), el('p', { class: 'hint' }, `Looks at: ${r.data}. ${r.limits}`),
      r.thresholds.length ? el('table', { class: 'eng-tbl' }, el('tbody', {}, r.thresholds.map((t) => el('tr', {}, el('th', {}, t.key), el('td', {}, String(t.value)), el('td', {}, t.meaning))))) : null)),
    el('h4', {}, 'Permitted-development limits (GPDO 2015)'),
    el('p', { class: 'hint' }, kv(rb.gpdo.limits)),
    rb.gpdo.classes.map((c) => el('details', {}, el('summary', {}, `Class ${c.class}: ${c.title}`), el('ul', { class: 'prov' }, c.provisions.map((p) => el('li', {}, el('span', { class: 'mk' }, '•'), el('div', {}, el('strong', {}, p.ref), ` ${p.text}`)))))));
}


/* ---------- WHAT-IF: sliders that re-run the engine on a changed proposal (nothing is saved until "Use these values") ---------- */
const VERDICT = { permitted_development: ['Permitted development', '#17794a'], prior_approval: ['Prior approval', '#d98a00'], planning_permission: ['Planning permission', '#d62f2f'], listed_building_consent: ['Listed building consent', '#d62f2f'], not_a_house: ['Not a house', '#6b7390'], house_unconfirmed: ['Confirm it is a house', '#6b7390'], not_applicable: ['Outside England', '#6b7390'] };
const vName = (v) => VERDICT[v]?.[0] ?? v, vCol = (v) => VERDICT[v]?.[1] ?? '#6b7390';
const wi = { key: null, draft: {}, view: null, limits: {}, seq: 0, timer: null, finding: false };
const fmt = (v, unit) => `${v}${unit ? ' ' + unit : ''}`;

function whatIfView(app, o) {
  const prop = app.proposal, def = (o.workTypes ?? []).find((t) => t.type === prop?.type);
  if (!prop) return el('p', { class: 'hint' }, 'Choose a type of work first, then come back here to try different sizes.');
  if (!def || !def.fields.some((f) => f.kind === 'number')) return el('p', { class: 'hint' }, 'A shape you drew yourself has no sizes to move. Pick a type of work (for example a rear extension) to try this.');
  const key = `${app.id}|${JSON.stringify(prop)}`;
  if (wi.key !== key) { wi.key = key; wi.draft = { ...prop }; wi.view = null; wi.limits = {}; }
  const fields = def.fields.filter((f) => f.kind !== 'polygon' && (!f.onlyFor || f.onlyFor.includes(wi.draft.treatAs ?? prop.treatAs)));
  const saved = app.assessment, resultBox = el('div', { class: 'wi-result', 'aria-live': 'polite' }), planBox = el('div', { class: 'eng-planbox' }), changesBox = el('div', {});
  const bars = new Map(), reads = new Map();
  const others = (name) => JSON.stringify({ ...wi.draft, [name]: undefined });

  function drawResult() {
    const v = wi.view;
    if (!v) { resultBox.replaceChildren(el('p', { class: 'hint' }, 'Working it out…')); return; }
    const changed = saved && v.verdict !== saved.verdict;
    resultBox.replaceChildren(
      el('div', { class: 'wi-chip', style: `background:${vCol(v.verdict)}` }, vName(v.verdict)),
      el('div', { class: 'wi-sub' }, changed ? el('span', {}, 'This changes the answer. Your saved proposal: ', el('strong', {}, vName(saved.verdict)), '.') : 'Same route as your saved proposal.', ` Confidence: ${v.confidence.replace('_', ' ')}.`));
    const was = Object.fromEntries((saved?.checks ?? []).map((c) => [c.id, c])), now = Object.fromEntries(v.checks.map((c) => [c.id, c]));
    const diff = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((id) => (was[id]?.status ?? 'none') !== (now[id]?.status ?? 'none')).map((id) => ({ id, from: was[id]?.status ?? 'none', to: now[id]?.status ?? 'none', message: (now[id] ?? was[id]).message }));
    const open = v.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
    changesBox.replaceChildren(
      diff.length ? el('div', {}, el('h5', {}, 'Rules that changed compared with your saved proposal'), el('ul', { class: 'wi-diff' }, diff.map((d) => el('li', { class: d.to }, el('code', {}, d.id), ` ${d.from} → ${d.to}: `, d.message)))) : el('p', { class: 'hint' }, 'No rule differs from your saved proposal.'),
      open.length ? el('div', {}, el('h5', {}, 'Rules that need attention now'), list(open)) : el('p', { class: 'hint' }, 'Nothing is failing or needs confirming.'));
    planBox.replaceChildren(el('h5', {}, 'The plan with these values'), v.geometry ? planSvg({ geometry: v.geometry, walls: v.walls, stages: [] }, 'wall-safety') : el('p', { class: 'hint' }, 'No plan: the site rules did not run for this work.'), planLegend({ geometry: v.geometry }, 'wall-safety'));
  }
  async function run() {
    const my = ++wi.seq;
    try { const v = await o.onWhatIf({ ...wi.draft }); if (my === wi.seq) { wi.view = v; drawResult(); } }
    catch (e) { if (my === wi.seq) resultBox.replaceChildren(el('p', { class: 'note' }, e.message)); }
  }
  const later = () => { clearTimeout(wi.timer); wi.timer = setTimeout(run, 220); refreshBars(); };

  function drawBar(f) {
    const r = wi.limits[f.name]?.res, box = bars.get(f.name); if (!box) return;
    if (!r) { box.replaceChildren(); return; }
    const span = r.max - r.min || 1, pct = (v) => `${Math.max(0, Math.min(100, ((v - r.min) / span) * 100)).toFixed(2)}%`;
    const stale = wi.limits[f.name].key !== others(f.name);
    box.className = `wi-bar${stale ? ' stale' : ''}`;
    const track = el('div', { class: 'wi-track' }, r.ranges.map((g, i) => { const end = i + 1 < r.ranges.length ? r.ranges[i + 1].from : r.max; return el('span', { style: `left:${pct(g.from)};width:${(((end - g.from) / span) * 100).toFixed(2)}%;background:${vCol(g.verdict)}`, title: `${fmt(g.from, r.unit)} to ${fmt(end, r.unit)}: ${vName(g.verdict)}` }); }), el('i', { class: 'wi-now', style: `left:${pct(wi.draft[f.name] ?? r.current)}` }));
    const lines = r.flips.length ? r.flips.map((fl) => el('li', {}, el('strong', {}, `Above ${fmt(fl.before, r.unit)}`), `: ${vName(fl.to)}`, fl.because[0] ? el('span', { class: 'hint' }, ` – ${fl.because[0].message}`) : null)) : [el('li', { class: 'hint' }, r.currentVerdict === 'planning_permission' ? `Another value already needs planning permission, so moving ${r.label.toLowerCase()} alone cannot change the route. Lower that one first.` : `With the other values as they are, ${r.label.toLowerCase()} does not change the route.`)];
    box.replaceChildren(...[track, el('ul', { class: 'wi-lim' }, lines), stale ? el('p', { class: 'hint' }, 'Out of date because another value changed – press "Find the limits" again.') : null].filter(Boolean));
  }
  const refreshBars = () => fields.filter((x) => x.kind === 'number').forEach(drawBar);
  async function findAll() {
    if (wi.finding) return; wi.finding = true; findBtn.disabled = true;
    try { for (const f of fields.filter((x) => x.kind === 'number' && wi.draft[x.name] != null)) { findBtn.textContent = `Checking ${f.label.toLowerCase()}…`; wi.limits[f.name] = { key: others(f.name), res: await o.onLimits({ ...wi.draft }, f.name) }; drawBar(f); } }
    catch (e) { resultBox.append(el('p', { class: 'note' }, e.message)); }
    finally { wi.finding = false; findBtn.disabled = false; findBtn.textContent = 'Find the limits'; }
  }

  const rows = fields.map((f) => {
    const id = `wi-${f.name}`;
    if (f.kind === 'number') {
      const optional = !f.required && f.default === undefined, on = wi.draft[f.name] != null;
      const readout = el('output', { for: id, class: 'wi-val' }), box = el('div', { class: 'wi-bar' });
      reads.set(f.name, readout); bars.set(f.name, box);
      const input = el('input', { type: 'range', id, min: f.min ?? 0, max: f.max ?? 30, step: f.step ?? 0.1, value: on ? wi.draft[f.name] : (f.default ?? f.min ?? 0), ...(on ? {} : { disabled: 'disabled' }) });
      const sync = () => { readout.textContent = wi.draft[f.name] == null ? 'not given' : fmt(Number(wi.draft[f.name]), f.unit); };
      input.addEventListener('input', () => { wi.draft[f.name] = Number(input.value); sync(); later(); });
      const toggle = optional ? el('label', { class: 'wi-on' }, el('input', { type: 'checkbox', ...(on ? { checked: 'checked' } : {}), onchange: (e) => { if (e.target.checked) { const start = Math.min(f.max ?? 30, Math.max(f.min ?? 0.1, f.unit === 'm²' ? 15 : 3)); wi.draft[f.name] = Number(input.value) || start; input.value = wi.draft[f.name]; input.disabled = false; } else { delete wi.draft[f.name]; input.disabled = true; } sync(); later(); } }), ' use') : null;
      sync();
      queueMicrotask(() => drawBar(f));
      return el('div', { class: 'wi-row' }, el('label', { for: id }, f.label), el('div', { class: 'wi-ctl' }, input, readout, toggle), box);
    }
    if (f.kind === 'boolean') return el('div', { class: 'wi-row' }, el('label', { class: 'wi-on' }, el('input', { type: 'checkbox', ...(wi.draft[f.name] ? { checked: 'checked' } : {}), onchange: (e) => { wi.draft[f.name] = e.target.checked; later(); } }), ` ${f.label}`));
    return el('div', { class: 'wi-row' }, el('label', { for: id }, f.label), el('select', { id, onchange: (e) => { const o2 = f.options.find((x) => String(x.value) === e.target.value); wi.draft[f.name] = o2.value; later(); } }, f.options.map((x) => el('option', { value: x.value, ...(String(wi.draft[f.name] ?? f.default) === String(x.value) ? { selected: 'selected' } : {}) }, x.label))));
  });
  const findBtn = el('button', { type: 'button', onclick: findAll }, 'Find the limits');
  const apply = el('button', { type: 'button', class: 'ghost', onclick: async () => { apply.disabled = true; try { await o.onApply({ ...wi.draft }); } catch (e) { resultBox.append(el('p', { class: 'note' }, e.message)); apply.disabled = false; } } }, 'Use these values');
  const reset = el('button', { type: 'button', class: 'ghost', onclick: () => { wi.key = null; wi.limits = {}; if (typeof o.redraw === 'function') o.redraw(); } }, 'Reset to my proposal');
  const root = el('div', { class: 'wi' },
    el('p', { class: 'hint' }, 'Move a slider and the engine re-runs at once on the changed values, nothing is saved. "Find the limits" shows exactly where each number changes the route.'),
    el('div', { class: 'eng-grid' }, el('div', {}, resultBox, el('div', { class: 'wi-rows' }, rows), el('div', { class: 'eng-ctl' }, findBtn, apply, reset), changesBox), el('div', { class: 'eng-side' }, planBox)));
  run();
  return root;
}

/* ---------- the whole panel ---------- */
export function engineView(app, opts = {}) {
  const { onRulebook } = opts;
  const eng = app.engine;
  if (!eng) return null;
  const steps = flatten(eng);
  if (!steps.some((s) => s.key === st.sel)) st.sel = (steps.find((s) => s.stage?.id === 'site' && s.stage.rules?.length) ? steps.find((s) => s.rule)?.key : null) ?? steps[0].key;
  const root = el('section', { class: 'engine', 'aria-label': 'Engine room' });
  const body = el('div', {});
  const planBox = el('div', { class: 'eng-planbox' });
  let listBox;

  const focus = () => steps.find((s) => s.key === st.sel)?.rule?.id ?? null;
  const redrawPlan = () => planBox.replaceChildren(el('h5', {}, focus() ? `What the "${steps.find((s) => s.key === st.sel).rule.title}" rule was looking at` : 'The plan as the rules saw it'), planSvg(eng, focus()), planLegend(eng, focus()));
  const select = (key) => { st.sel = key; draw(); };
  const idx = () => steps.findIndex((s) => s.key === st.sel);
  const go = (d) => { const i = Math.max(0, Math.min(steps.length - 1, idx() + d)); select(steps[i].key); return i; };
  const stop = () => { st.playing = false; clearInterval(st.timer); st.timer = null; };
  const play = () => {
    if (st.playing) { stop(); draw(); return; }
    st.playing = true; if (idx() >= steps.length - 1) st.sel = steps[0].key; draw();
    clearInterval(st.timer);
    st.timer = setInterval(() => { if (!root.isConnected || idx() >= steps.length - 1) { stop(); if (root.isConnected) draw(); return; } go(1); }, 1700);
  };

  function draw() {
    const cur = steps[idx()];
    listBox = el('ol', { class: 'eng-steps' }, steps.map((s, i) => {
      const status = s.rule ? ruleStatus(s.rule) : s.stage.status, active = s.key === st.sel;
      return el('li', { class: `eng-step ${status}${s.rule ? ' sub' : ''}${active ? ' active' : ''}` },
        el('button', { type: 'button', class: 'eng-hd', 'aria-expanded': active ? 'true' : 'false', onclick: () => { stop(); select(s.key); } },
          el('span', { class: 'mk' }, MARK[status] ?? 'i'), el('span', { class: 'ttl' }, s.rule ? s.rule.title : s.stage.title), el('span', { class: 'sum' }, s.rule ? (s.rule.added[0]?.message.slice(0, 80) ?? 'nothing to report') + (s.rule.added[0]?.message.length > 80 ? '…' : '') : s.stage.headline)),
        active ? (s.rule ? ruleDetail(s.rule, redrawPlan) : stageDetail(s.stage)) : null);
    }));
    body.replaceChildren(
      el('div', { class: 'eng-ctl' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { stop(); go(-1); }, disabled: idx() === 0 ? 'disabled' : null }, '◀ Previous'),
        el('button', { type: 'button', onclick: play }, st.playing ? '❚❚ Pause' : '▶ Replay the run'),
        el('button', { type: 'button', class: 'ghost', onclick: () => { stop(); go(1); }, disabled: idx() === steps.length - 1 ? 'disabled' : null }, 'Next ▶'),
        el('span', { class: 'hint' }, `Step ${idx() + 1} of ${steps.length}: ${cur.rule ? cur.rule.title : cur.stage.title}`)),
      el('div', { class: 'eng-grid' }, listBox, el('div', { class: 'eng-side' }, planBox)));
    redrawPlan();
  }

  const tabBtn = (id, label) => el('button', { type: 'button', class: `tab${st.tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(st.tab === id), onclick: async () => {
    st.tab = id;
    if (id === 'rules' && !st.rulebook) { try { st.rulebook = await onRulebook(); } catch (e) { st.rulebook = { error: e.message }; } }
    show();
  } }, label);
  function show() {
    stop();
    const head = el('div', { class: 'eng-tabs', role: 'tablist' }, tabBtn('run', 'This run, step by step'), tabBtn('whatif', 'What if…'), tabBtn('rules', 'The rulebook'));
    if (st.tab === 'whatif') root.replaceChildren(head, whatIfView(app, { ...opts, redraw: show }));
    else if (st.tab === 'rules') root.replaceChildren(head, st.rulebook?.error ? el('p', { class: 'note' }, st.rulebook.error) : st.rulebook ? rulebookView(st.rulebook) : el('p', { class: 'hint' }, 'Loading…'));
    else { root.replaceChildren(head, body); draw(); }
  }
  const wrap = el('details', { class: 'engine-wrap', ...(st.open ? { open: 'open' } : {}) },
    el('summary', {}, 'Engine room: see exactly what the engine did', el('span', { class: 'hint' }, ' – every step, every number, every rule')), root);
  wrap.addEventListener('toggle', () => { st.open = wrap.open; if (!wrap.open) stop(); });
  show();
  return wrap;
}
