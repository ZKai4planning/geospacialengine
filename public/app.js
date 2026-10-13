const $ = (s) => document.querySelector(s);
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
const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error?.message || `Request failed (${r.status})`);
  return b;
};

/* ---------------- address search ---------------- */
const input = $('#q'), list = $('#list'), statusEl = $('#status');
let ctl, timer, items = [], active = -1, selected = null;

const setStatus = (t) => (statusEl.textContent = t);
const hideList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };

function renderList() {
  list.replaceChildren(...items.map((it, i) =>
    el('li', { role: 'option', id: `opt-${i}`, 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); choose(it); } },
      it.id ? it.fullAddress : it.postcode,
      it.id ? el('small', {}, it.propertyType) : null)));
  list.hidden = !items.length;
  input.setAttribute('aria-expanded', String(items.length > 0));
  if (active >= 0) input.setAttribute('aria-activedescendant', `opt-${active}`);
}

async function search() {
  const q = input.value.trim();
  if (q.length < 2) { items = []; hideList(); setStatus(''); return; }
  ctl?.abort(); ctl = new AbortController();
  const mine = ctl;
  let timedOut = false;
  const guard = setTimeout(() => { timedOut = true; mine.abort(); }, 25000);
  setStatus(/\d/.test(q) ? 'Looking up addresses… (free map services can take a few seconds)' : 'Searching…');
  try {
    const data = await api('/address/search?q=' + encodeURIComponent(q), { signal: mine.signal });
    items = data.suggestions; active = -1;
    setStatus(data.message || data.note || (items.length ? `${items.length} result${items.length === 1 ? '' : 's'} – choose your address` : 'No matches. Check the postcode or try the street name.'));
    renderList();
  } catch (e) {
    if (timedOut) setStatus('This is taking longer than usual – the free address service may be busy. Please try again in a moment.');
    else if (e.name !== 'AbortError') setStatus(e.message);
  } finally { clearTimeout(guard); }
}

function choose(it) {
  hideList();
  if (!it.id) { input.value = it.postcode + ' '; search(); return; } // partial postcode -> full postcode
  selected = it;
  input.value = it.fullAddress;
  $('#confirm-addr').textContent = it.fullAddress;
  $('#confirm').hidden = false;
  setStatus('');
}

input.addEventListener('input', () => { $('#confirm').hidden = true; updateManualLink(); clearTimeout(timer); timer = setTimeout(search, 400); });
input.addEventListener('keydown', (e) => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown') { active = (active + 1) % items.length; renderList(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; renderList(); e.preventDefault(); }
  else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
  else if (e.key === 'Escape') hideList();
});
input.addEventListener('blur', () => setTimeout(hideList, 120));
$('#no').addEventListener('click', () => { $('#confirm').hidden = true; $('#result').hidden = true; input.value = ''; input.focus(); });
async function start(body, btn) {
  btn.disabled = true; setStatus('Fetching property details…');
  try {
    const [app] = await Promise.all([
      api('/applications', { method: 'POST', body: JSON.stringify(body) }),
      workTypes ?? api('/work-types').then((d) => (workTypes = d.types)),
    ]);
    setStatus(''); mount(app);
  } catch (err) { setStatus(err.message); } finally { btn.disabled = false; }
}
$('#yes').addEventListener('click', (e) => start({ id: selected.id }, e.target));

// manual entry – works even when the free address services are down
const PC = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
function updateManualLink() {
  const has = PC.test(input.value);
  $('#manual-link').hidden = !has;
  if (!has) $('#manual').hidden = true;
}
$('#manual-toggle').addEventListener('click', () => { $('#manual').hidden = !$('#manual').hidden; $('#m-line1').focus(); });
$('#manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const postcode = PC.exec(input.value)?.[0];
  if (!postcode) { setStatus('Enter the full postcode in the box above first.'); return; }
  start({ manual: { line1: $('#m-line1').value, town: $('#m-town').value || undefined, postcode } }, e.target.querySelector('button'));
});

/* ---------------- result: cards, map overlay, proposal form ---------------- */
let workTypes = null;
const rows = (r) => el('ul', { class: 'rows' }, r.map((x) => el('li', {}, el('span', { class: 'k' }, x.label), el('span', { class: 'v' }, x.value))));

function mapView(app) {
  const m = app.map, { w, h } = m.view;
  const Z = { plot: 0, neighbour: 1, building: 2, existing_extension: 3, proposal: 4 }; // draw order: context first, proposal on top
  const ordered = [...m.layers].sort((a, b) => (Z[a.kind] ?? 9) - (Z[b.kind] ?? 9));
  const layer = (l) => {
    const cls = `l-${l.kind}${l.style === 'roof' ? ' roof' : ''}${l.status ? ` st-${l.status}` : ''}`;
    return svg('path', { d: l.path, class: cls, 'fill-rule': 'evenodd' });
  };
  const label = (l) => {
    if (l.kind === 'building' || l.kind === 'plot' || (l.kind === 'neighbour' && !l.label)) return null;
    const text = l.kind === 'proposal' ? [l.label, l.dimsText].filter(Boolean) : [l.label];
    return svg('text', { x: l.labelAt.x, y: l.labelAt.y - (text.length - 1) * 7, 'text-anchor': 'middle', class: 'lbl' },
      text.map((t, i) => svg('tspan', { x: l.labelAt.x, dy: i ? 14 : 0 }, document.createTextNode(t))));
  };
  const s = m.scale;
  const sv = svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', class: 'map-svg', role: 'img', 'aria-label': 'Proposed work outlined on the aerial photo' },
    svg('defs', {}, svg('pattern', { id: 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('rect', { width: 7, height: 7, fill: 'rgba(47,84,214,.18)' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'rgba(47,84,214,.8)', 'stroke-width': 2 }))),
    ordered.map(layer), ordered.map(label),
    svg('g', { class: 'scale' }, svg('line', { x1: 14, y1: h - 16, x2: 14 + s.px, y2: h - 16 }), svg('text', { x: 14, y: h - 22 }, document.createTextNode(`${s.metres} m`))));
  return sv;
}

const legend = (app) => el('ul', { class: 'legend' },
  el('li', {}, el('i', { class: 'sw s-building' }), 'Existing house'),
  app.map.layers.some((l) => l.kind === 'neighbour') ? el('li', {}, el('i', { class: 'sw s-neighbour' }), 'Neighbouring buildings') : null,
  app.map.layers.some((l) => l.kind === 'plot') ? el('li', {}, el('i', { class: 'sw s-plot' }), 'Title boundary (indicative)') : null,
  app.map.layers.some((l) => l.kind === 'existing_extension') ? el('li', {}, el('i', { class: 'sw s-existing' }), 'Existing extension') : null,
  app.map.layers.some((l) => l.kind === 'proposal') ? el('li', {}, el('i', { class: 'sw s-proposal' }), 'Your proposal') : null);

function siteChecksView(app) {
  const sc = app.map.siteChecks;
  if (!sc?.items?.length) return null;
  return el('div', { class: 'sitechecks' },
    el('h3', {}, 'Map checks'),
    el('ul', { class: 'checks' }, sc.items.map((c) => el('li', { class: c.status }, c.message))),
    el('p', { class: 'note' }, sc.disclaimer),
    sc.attribution?.length ? el('p', { class: 'note attr-line' }, sc.attribution.join(' · ')) : null);
}

function cardsFor(app) {
  const { property, proposal, site } = app.cards;
  return el('div', { class: 'cards' },
    el('article', { class: 'card' },
      el('div', { class: 'img' }, el('img', { src: property.imageUrl, alt: `Street view of ${property.title}` }), property.attribution ? el('span', { class: 'attr' }, property.attribution) : null),
      el('div', { class: 'body' }, el('h2', {}, property.title), el('p', { class: 'sub' }, property.subtitle), rows(property.rows))),
    el('article', { class: 'card' }, el('div', { class: 'body' }, el('h2', {}, proposal.title), rows(proposal.rows))),
    el('article', { class: 'card' },
      el('div', { class: 'img' }, el('img', { src: site.imageUrl, alt: 'Aerial view of the property' }), mapView(app), site.attribution ? el('span', { class: 'attr' }, site.attribution) : null),
      el('div', { class: 'body' },
        legend(app),
        siteChecksView(app),
        el('p', { class: 'note' }, app.map.frontNote, ' ',
          el('button', { type: 'button', class: 'link', onclick: swapFront }, 'Front and back look wrong? Swap')),
        rows(site.rows))));
}

let current = null;
async function swapFront() {
  try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ frontBearingDeg: (current.map.frame.frontBearingDeg + 180) % 360 }) })); }
  catch (e) { setStatus(e.message); }
}

function verdictFor(a) {
  if (!a) return null;
  return el('div', { class: 'verdict' },
    el('h3', {}, a.label), el('p', {}, a.summary),
    el('ul', { class: 'checks' }, a.checks.map((c) => el('li', { class: c.status }, c.message))),
    el('p', { class: 'note' }, a.disclaimer));
}

function paint(app) {
  current = app;
  $('#cards-area').replaceChildren(cardsFor(app));
  $('#verdict-area').replaceChildren(...[verdictFor(app.assessment)].filter(Boolean));
  const chips = app.constraints?.items ?? [];
  $('#chips-area').replaceChildren(
    ...(chips.length ? [el('ul', { class: 'chips', 'aria-label': 'Planning constraints' }, chips.map((c) => el('li', { title: c.impact || '' }, c.label)))] : []),
    ...(app.warnings.length ? [el('p', { class: 'note' }, app.warnings.join(' '))] : []));
}

function fieldInput(f, value) {
  const id = `f-${f.name}`;
  if (f.kind === 'select') {
    return el('div', {}, el('label', { for: id }, f.label),
      el('select', { id, name: f.name }, f.options.map((o) => el('option', { value: String(o.value), selected: String(o.value) === String(value ?? f.default) ? 'selected' : null }, o.label))));
  }
  if (f.kind === 'boolean') {
    return el('label', { class: 'check', for: id }, el('input', { id, name: f.name, type: 'checkbox', checked: value ?? f.default ? 'checked' : null }), f.label);
  }
  return el('div', {}, el('label', { for: id }, `${f.label} (${f.unit})`, f.hint ? el('span', { class: 'hint' }, ` ${f.hint}`) : null),
    el('input', { id, name: f.name, type: 'number', inputmode: 'decimal', step: f.step ?? 0.1, min: f.min, max: f.max, required: f.required ? 'required' : null, value: value ?? (f.required || f.default !== undefined ? f.default ?? '' : '') }));
}

function payloadFrom(form, type) {
  const out = { type: type.type };
  for (const f of type.fields) {
    const node = form.elements[f.name];
    if (!node) continue;
    if (f.kind === 'number') { if (node.value !== '') out[f.name] = Number(node.value); }
    else if (f.kind === 'boolean') out[f.name] = node.checked;
    else out[f.name] = f.options.find((o) => String(o.value) === node.value)?.value;
  }
  return out;
}

function mount(app) {
  const form = el('form', { class: 'proposal', novalidate: 'novalidate' });
  const typeSel = el('select', { id: 'work-type', name: 'work-type' }, workTypes.map((t) => el('option', { value: t.type }, t.label)));
  const fieldsBox = el('div', {});
  const existing = app.profile.existingExtension;
  const hint = el('p', { class: 'hint' });
  const status = el('span', { class: 'hint', role: 'status' });
  let busy;

  const buildFields = () => {
    const t = workTypes.find((x) => x.type === typeSel.value);
    hint.textContent = t.hint;
    const main = t.fields.filter((f) => !f.advanced), adv = t.fields.filter((f) => f.advanced);
    fieldsBox.replaceChildren(
      el('div', { class: 'grid' }, main.map((f) => fieldInput(f))),
      adv.length ? el('details', {}, el('summary', {}, 'More details (improves the permitted-development check)'), el('div', { class: 'grid' }, adv.map((f) => fieldInput(f)))) : null);
  };
  typeSel.addEventListener('change', buildFields);
  buildFields();

  const submit = async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const t = workTypes.find((x) => x.type === typeSel.value);
    status.textContent = 'Updating map…';
    try {
      await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({
        existingExtension: { depthM: Number(form.elements.exDepth.value || 0), inOutline: form.elements.exInside.checked },
      }) });
      paint(await api(`/applications/${current.id}/proposal`, { method: 'PUT', body: JSON.stringify(payloadFrom(form, t)) }));
      status.textContent = 'Map updated.';
    } catch (e) { status.textContent = e.message; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  form.addEventListener('input', () => { clearTimeout(busy); busy = setTimeout(() => form.checkValidity() && submit(), 600); }); // live preview

  form.append(
    el('h2', {}, 'What work are you planning?'),
    el('div', { class: 'grid' }, el('div', {}, el('label', { for: 'work-type' }, 'Type of work'), typeSel)),
    hint, fieldsBox,
    el('fieldset', {}, el('legend', {}, 'Existing extension'),
      el('div', { class: 'grid' },
        el('div', {}, el('label', { for: 'exDepth' }, 'Depth of existing rear extension (m)', el('span', { class: 'hint' }, ' 0 if none')),
          el('input', { id: 'exDepth', name: 'exDepth', type: 'number', step: '0.1', min: '0', max: '20', value: existing.depthM ?? 0 })),
        el('label', { class: 'check', for: 'exInside' }, el('input', { id: 'exInside', name: 'exInside', type: 'checkbox', checked: existing.inOutline !== false ? 'checked' : null }), 'It is already inside the red house outline on the map'))),
    el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Show on map and check the rules'), status));

  $('#result').replaceChildren(
    el('p', { class: 'ref' }, `Draft ${app.reference} · ${app.authority?.name ? `Planning authority: ${app.authority.name}` : 'Planning authority to confirm'}`),
    el('div', { id: 'cards-area' }), el('div', { id: 'chips-area' }), form, el('div', { id: 'verdict-area' }));
  $('#result').hidden = false;
  paint(app);
}
