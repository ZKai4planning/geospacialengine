import { engineView } from './engine.js';
import { openPlanEditor } from '/planEditor.js';
import { createViewer } from '/viewer3d.js';
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
  if (!r.ok) {
    const detail = b.error?.details?.[0]?.message; // validation problems carry the useful message
    throw new Error(detail ? `${b.error.message} ${detail}` : b.error?.message || `Request failed (${r.status})`);
  }
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

// start from a JSON file saved with "Save everything as JSON": the address is looked up again and the saved answers are replayed
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  setStatus('Reading the saved file…');
  try {
    const doc = JSON.parse(await file.text());
    const [app] = await Promise.all([api('/applications/import', { method: 'POST', body: JSON.stringify(doc) }), workTypes ?? api('/work-types').then((d) => (workTypes = d.types))]);
    setStatus(''); mount(app);
  } catch (err) { setStatus(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message); }
});

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

/* ---- Web-Mercator, same maths as the server (src/utils/mercator.js), so clicks map back to lng/lat exactly ---- */
const MR = 6378137, mrad = (d) => (d * Math.PI) / 180, mdeg = (r) => (r * 180) / Math.PI;
const toMerc = (lng, lat) => [MR * mrad(lng), MR * Math.log(Math.tan(Math.PI / 4 + mrad(lat) / 2))];
const fromMerc = (x, y) => [mdeg(x / MR), mdeg(2 * Math.atan(Math.exp(y / MR)) - Math.PI / 2)];
const viewRes = (v) => (2 * Math.PI * MR) / (256 * 2 ** v.zoom);
const projectPx = (v, lng, lat) => { const [mx, my] = toMerc(lng, lat), [cx, cy] = toMerc(v.lng, v.lat), res = viewRes(v); return [(mx - cx) / res + v.w / 2, v.h / 2 - (my - cy) / res]; };
const unprojectPx = (v, x, y) => { const [cx, cy] = toMerc(v.lng, v.lat), res = viewRes(v); return fromMerc(cx + (x - v.w / 2) * res, cy - (y - v.h / 2) * res); };

/* ---- drawing your own shape ---- */
const draw = { active: false, pts: [] }; // pts: [lng, lat] corners, in the order clicked
const mark = { active: false };          // "mark the neighbour's window" mode (45-degree test): the next click sets it
let syncMark = () => {};
const SNAP_PX = 9, CLOSE_PX = 11;
let preview = () => {};   // set by mount(): sends the shape to the server (debounced unless asked otherwise)
let syncDraw = () => {};  // set by mount(): refreshes the draw buttons / hint text
const redrawMap = () => { if (current) document.querySelector('.map-svg')?.replaceWith(mapView(current)); };

/** Corners we snap to: the house, existing extension, neighbours and plot boundary, so shapes can meet walls exactly. */
function snapTargets(app) {
  const v = app.map.view;
  return app.map.layers
    .filter((l) => ['building', 'existing_extension', 'neighbour', 'plot'].includes(l.kind) && l.ring)
    .flatMap((l) => l.ring.slice(0, -1).map(([lng, lat]) => ({ lng, lat, px: projectPx(v, lng, lat) })));
}

/** The next map click is the middle of the neighbour's nearest ground-floor window: save it, and the 45-degree test runs. */
async function placeWindow(e, app) {
  const v = app.map.view, box = e.currentTarget.getBoundingClientRect();
  const [lng, lat] = unprojectPx(v, ((e.clientX - box.left) / box.width) * v.w, ((e.clientY - box.top) / box.height) * v.h);
  mark.active = false; syncMark();
  try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ neighbourWindow: { lng, lat } }) })); }
  catch (err) { alert(err.message); redrawMap(); }
}

function onMapClick(e, app) {
  if (mark.active) { placeWindow(e, app); return; }
  if (!draw.active) return;
  const v = app.map.view, box = e.currentTarget.getBoundingClientRect();
  const px = [((e.clientX - box.left) / box.width) * v.w, ((e.clientY - box.top) / box.height) * v.h];
  const dist = (a) => Math.hypot(a[0] - px[0], a[1] - px[1]);
  if (draw.pts.length >= 3 && dist(projectPx(v, ...draw.pts[0])) <= CLOSE_PX) { finishDrawing(); return; }
  const snap = snapTargets(app).map((t) => ({ t, d: dist(t.px) })).filter((x) => x.d <= SNAP_PX).sort((a, b) => a.d - b.d)[0];
  const pt = snap ? [snap.t.lng, snap.t.lat] : unprojectPx(v, ...px);
  if (draw.pts.length && draw.pts.at(-1)[0] === pt[0] && draw.pts.at(-1)[1] === pt[1]) return; // same corner twice
  draw.pts.push(pt);
  syncDraw(); redrawMap();
  if (draw.pts.length >= 3) preview();
}

function finishDrawing() { draw.active = false; syncDraw(); redrawMap(); if (draw.pts.length >= 3) preview(true); }
function undoCorner() { draw.pts.pop(); syncDraw(); redrawMap(); if (draw.pts.length >= 3) preview(); }
function clearDrawing() { draw.pts = []; draw.active = false; syncDraw(); redrawMap(); }

// registered ONCE (not per property), otherwise every new address would add another listener
document.addEventListener('keydown', (e) => {
  if (!draw.active || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === 'Escape') finishDrawing(); else if (e.key === 'Backspace') { e.preventDefault(); undoCorner(); }
});

function draftView(app) {
  if (!draw.active || !draw.pts.length) return null;
  const v = app.map.view, px = draw.pts.map(([lng, lat]) => projectPx(v, lng, lat));
  const d = `M${px.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}${px.length >= 3 ? ' Z' : ''}`;
  return svg('g', { class: 'draft' }, svg('path', { d }),
    px.map(([x, y], i) => svg('circle', { cx: x, cy: y, r: i === 0 ? 6 : 4.5, class: i === 0 && px.length >= 3 ? 'first' : '' })));
}

function mapView(app, { readonly = false } = {}) {
  const m = app.map, { w, h } = m.view;
  const Z = { wall: 4.5, constraint: -2, road: -1, pathway: -0.8, powerline: 0.8, window45line: 0.65, window45: 0.7, public_land: -0.5, plot: 0, tpo_zone: 0.2, tree: 0.5, obstacle: 0.6, neighbour: 1, outbuilding: 1.1, building: 2, existing_extension: 3, proposal: 4 }; // draw order: context first, proposal on top
  const ordered = m.layers.filter((l) => !hiddenLayers.has(keyOfLayer(l))).sort((a, b) => (Z[a.kind] ?? 9) - (Z[b.kind] ?? 9));
  const layer = (l) => {
    const cls = `l-${l.kind}${l.style === 'roof' ? ' roof' : ''}${l.protected ? ' protected' : ''}${l.estimated ? ' est' : ''}${l.status ? ` st-${l.status}` : ''}${l.pathKind ? ` pk-${l.pathKind}${l.row ? ' row' : ''}` : ''}${l.obstacleKind ? ` ok-${l.obstacleKind}` : ''}`;
    if (l.kind === 'constraint') { const col = CONSTRAINT[l.dataset]?.[1] ?? '#888'; return svg('path', { d: l.path, class: cls, fill: `${col}33`, stroke: col, 'stroke-width': l.status === 'inside' ? 2 : 1.2, 'stroke-dasharray': l.dataset === 'flood-risk-zone' ? '' : '6 3', 'fill-rule': 'evenodd' }); }
    if (l.kind === 'road' || l.kind === 'pathway' || l.kind === 'powerline' || l.kind === 'window45line' || l.kind === 'wall') return svg('path', { d: l.path, class: cls, 'stroke-width': l.strokePx });
    if (l.kind === 'tree') return svg('g', {}, svg('path', { d: l.path, class: cls }), svg('circle', { cx: l.labelAt.x, cy: l.labelAt.y - 4, r: 3.5, class: 'tree-dot' }));
    return svg('path', { d: l.path, class: cls, 'fill-rule': 'evenodd' });
  };
  const label = (l) => {
    if (l.kind === 'building' || l.kind === 'plot' || ((l.kind === 'neighbour' || l.kind === 'road' || l.kind === 'tree' || l.kind === 'tpo_zone' || l.kind === 'public_land' || l.kind === 'pathway' || l.kind === 'obstacle' || l.kind === 'window45line' || l.kind === 'wall' || l.kind === 'constraint' || l.kind === 'powerline') && !l.label)) return null;
    const text = l.kind === 'proposal' ? [l.label, l.dimsText].filter(Boolean) : [l.label];
    return svg('text', { x: l.labelAt.x, y: l.labelAt.y - (text.length - 1) * 7, 'text-anchor': 'middle', class: `lbl lbl-${l.kind}` },
      text.map((t, i) => svg('tspan', { x: l.labelAt.x, dy: i ? 14 : 0 }, document.createTextNode(t))));
  };
  const s = m.scale;
  const sv = svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', class: `map-svg${draw.active || mark.active ? ' drawing' : ''}`, role: 'img', 'aria-label': 'Proposed work outlined on the aerial photo' },
    svg('defs', {}, svg('pattern', { id: 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('rect', { width: 7, height: 7, fill: 'rgba(47,84,214,.18)' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'rgba(47,84,214,.8)', 'stroke-width': 2 }))),
    blockBase(app), ordered.map(layer), ordered.map(label), blockOverlay(app), draftView(app),
    svg('g', { class: 'scale' }, svg('line', { x1: 14, y1: h - 16, x2: 14 + s.px, y2: h - 16 }), svg('text', { x: 14, y: h - 22 }, document.createTextNode(`${s.metres} m`))));
  if (!readonly) sv.addEventListener('click', (e) => onMapClick(e, app));
  else sv.classList.remove('drawing');
  return sv;
}

/* ---------------- block plan: the same outlines on a plain drawing, with the measurements written on it ---------------- */
const upright = (deg) => (deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg); // keep text readable, never upside down
function blockBase(app) {
  const { w, h } = app.map.view, px = app.map.scale.px, lines = [];
  for (let x = px; x < w; x += px) lines.push(svg('line', { x1: x, y1: 0, x2: x, y2: h }));   // grid squares = the scale-bar length
  for (let y = h - px; y > 0; y -= px) lines.push(svg('line', { x1: 0, y1: y, x2: w, y2: y }));
  return svg('g', { class: 'bp-only bp-grid' }, svg('rect', { width: w, height: h, class: 'bp-bg' }), lines);
}
function blockOverlay(app) {
  const bp = app.map.blockPlan;
  if (!bp) return null;
  const { w } = app.map.view;
  const text = (x, y, str, cls, deg = 0) => svg('text', { x, y, class: cls, 'text-anchor': 'middle', ...(deg ? { transform: `rotate(${deg} ${x} ${y})` } : {}) }, document.createTextNode(str));
  const dim = (d) => {
    const [x1, y1] = d.a, [x2, y2] = d.b, a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * 4.5, ny = Math.cos(a) * 4.5;
    return svg('g', { class: `bp-dim bp-${d.kind}` },
      svg('line', { x1, y1, x2, y2 }), svg('line', { x1: x1 - nx, y1: y1 - ny, x2: x1 + nx, y2: y1 + ny }), svg('line', { x1: x2 - nx, y1: y2 - ny, x2: x2 + nx, y2: y2 + ny }),
      // the number sits beside its line (boundary distances on one side, the rest on the other) so labels around a small porch do not pile up
      text((x1 + x2) / 2 - Math.sin(a) * (d.kind === 'boundary' ? -9 : 9), (y1 + y2) / 2 + Math.cos(a) * (d.kind === 'boundary' ? -9 : 9) + 3, d.label, 'bp-dimtxt', upright((a * 180) / Math.PI)));
  };
  return svg('g', { class: 'bp-only bp-over' },
    bp.vertices.map(([x, y]) => svg('circle', { cx: x, cy: y, r: 2.6, class: 'bp-vertex' })),
    bp.edges.map((e) => text(e.x, e.y - 3, `${e.metres} m`, 'bp-edge', upright(e.angle))),
    bp.dims.map(dim),
    svg('g', { class: 'bp-north', transform: `translate(${w - 22},34)` }, svg('line', { x1: 0, y1: 0, x2: 0, y2: -20 }), svg('path', { d: 'M0,-26 L-5,-16 L5,-16 Z' }), text(0, 12, 'N', 'bp-ntxt')));
}
/** Every number on the plan in one table, so it can be checked against a title plan or a tape measure. */
function blockTable(app, always = false) {
  const bp = app.map.blockPlan;
  if (!bp) return null;
  const data = [];
  if (bp.areas.plotM2 != null) data.push([bp.plotEstimated ? 'Plot area (estimated)' : 'Plot area (title, indicative)', `${bp.areas.plotM2} m²`]);
  if (bp.areas.houseM2 != null) data.push([bp.houseIndicative ? 'House footprint (indicative)' : 'House footprint', `${bp.areas.houseM2} m²`]);
  const prop = app.map.layers.find((l) => l.kind === 'proposal');
  if (prop?.dimsText) data.push(['Proposal size (width × projection)', prop.dimsText]);
  if (bp.areas.proposalM2 != null) data.push(['Proposal footprint', `${bp.areas.proposalM2} m²`]);
  bp.dims.forEach((d) => data.push([d.text, d.label]));
  (bp.facts ?? []).forEach((f) => data.push([f.text, f.label]));
  if (!data.length) return null;
  return el('div', { class: `bp-table${always ? ' show' : ''}` },
    el('h3', {}, 'Measurements'),
    el('table', { class: 'bp-rows' }, el('tbody', {}, data.map(([k, v]) => el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, v))))),
    el('p', { class: 'note' }, bp.plotEstimated
      ? 'Measured between the outlines drawn on the plan (about 0.1 m). The plot outline is an estimate, so distances to it are too – check against your title plan.'
      : 'Measured between the outlines drawn on the plan (about 0.1 m). The title boundary is indicative, not a legal boundary. Distances to the boundary only appear when the work is inside the plot.',
    bp.houseIndicative ? ' No building outline was found, so the house is a standard-size stand-in.' : ''));
}

/* ---------------- layers: every kind of data drawn on the plan can be switched on and off ---------------- */
const hiddenLayers = new Set();
const keyOfLayer = (l) => (l.kind === 'constraint' ? `constraint:${l.dataset}` : l.kind === 'window45line' ? 'window45' : l.kind);
const CONSTRAINT = { // dataset -> [label, colour]
  'conservation-area': ['Conservation area', '#2e9e6b'], 'listed-building-outline': ['Listed building', '#b5499a'], 'article-4-direction-area': ['Article 4 direction area', '#d9822b'],
  'flood-risk-zone': ['Flood risk zone', '#2f6fdb'], 'green-belt': ['Green Belt', '#5aa02c'], 'national-park': ['National park', '#2c8a5a'], 'area-of-outstanding-natural-beauty': ['National landscape (AONB)', '#3aa17e'],
  'world-heritage-site': ['World Heritage Site', '#c9a227'], 'scheduled-monument': ['Scheduled monument', '#a0522d'], 'site-of-special-scientific-interest': ['SSSI', '#7a4fcf'],
  'ancient-woodland': ['Ancient woodland', '#1f6b3a'], 'park-and-garden': ['Registered park and garden', '#8cb04a'], battlefield: ['Registered battlefield', '#b34a4a'],
};
const LAYER_INFO = { // key -> [group, label, swatch class]
  building: ['Plan', 'Existing house', 's-building'], existing_extension: ['Plan', 'Existing extension', 's-existing'], proposal: ['Plan', 'Your proposal', 's-proposal'], plot: ['Plan', 'Title boundary', 's-plot'],
  public_land: ['Street', 'Public land (pavement / highway)', 's-public'], road: ['Street', 'Roads (approximate width)', 's-road'], pathway: ['Street', 'Pavements and paths', 's-path'],
  obstacle: ['Street', 'Post boxes, poles, lamps (possible obstructions)', 's-obstacle'], powerline: ['Street', 'Overhead power lines', 's-powerline'],
  neighbour: ['Surroundings', 'Neighbouring buildings', 's-neighbour'], outbuilding: ['Surroundings', 'Existing outbuildings on the plot', 's-outbuilding'],
  tree: ['Surroundings', 'Trees and root zones (estimated)', 's-tree'], tpo_zone: ['Surroundings', 'Tree preservation zone (council)', 's-tpo'],
  window45: ['Analysis', "Neighbour's window and 45° line", 's-window45'],
  wall: ['Analysis', 'Wall safety (walls touching or near a neighbour / boundary)', 's-wall'],
};
function layerCatalog(app) {
  const seen = new Map();
  for (const l of app.map.layers) {
    const key = keyOfLayer(l);
    if (seen.has(key)) { seen.get(key).count++; continue; }
    const c = l.kind === 'constraint' ? CONSTRAINT[l.dataset] : null;
    const info = c ? ['Constraints', c[0], ''] : LAYER_INFO[key];
    if (!info) continue;
    seen.set(key, { key, group: info[0], label: l.kind === 'plot' && l.estimated ? 'Estimated plot outline' : info[1], swatch: info[2], colour: c?.[1] ?? null, count: 1 });
  }
  return [...seen.values()];
}
function legend(app) {
  const cat = layerCatalog(app), groups = ['Plan', 'Street', 'Surroundings', 'Constraints', 'Analysis'];
  const setAll = (on, node) => { for (const c of cat) { if (on) hiddenLayers.delete(c.key); else hiddenLayers.add(c.key); } redrawMap(); node.replaceWith(legend(app)); };
  const item = (c) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = !hiddenLayers.has(c.key);
    cb.addEventListener('change', () => { if (cb.checked) hiddenLayers.delete(c.key); else hiddenLayers.add(c.key); redrawMap(); });
    const sw = el('i', { class: `sw ${c.swatch}` });
    if (c.colour) { sw.style.background = `${c.colour}55`; sw.style.borderColor = c.colour; }
    return el('li', {}, el('label', {}, cb, sw, `${c.label}${c.count > 1 ? ` (${c.count})` : ''}`));
  };
  const node = el('details', { class: 'layerpanel', open: 'open' },
    el('summary', {}, `Layers on this plan (${cat.length})`),
    el('div', { class: 'layer-actions' }, el('button', { type: 'button', class: 'ghost', onclick: () => setAll(true, node) }, 'Show all'), el('button', { type: 'button', class: 'ghost', onclick: () => setAll(false, node) }, 'Hide all')),
    groups.map((g) => { const items = cat.filter((c) => c.group === g); return items.length ? el('div', { class: 'layer-group' }, el('h5', {}, g), el('ul', { class: 'legend' }, items.map(item))) : null; }));
  return node;
}

function siteChecksView(app) {
  const sc = app.map.siteChecks;
  if (!sc?.items?.length && !sc?.regulatory?.length) return null;
  return el('div', { class: 'sitechecks' },
    el('h3', {}, 'Map checks'),
    el('ul', { class: 'checks' }, sc.items.map((c) => el('li', { class: c.status }, c.message))),
    sc.regulatory?.length ? el('div', { class: 'regs' }, el('h4', {}, 'Other approvals to think about'), el('ul', { class: 'checks' }, sc.regulatory.map((c) => el('li', { class: c.status }, c.message)))) : null,
    el('p', { class: 'note' }, sc.disclaimer),
    sc.attribution?.length ? el('p', { class: 'note attr-line' }, sc.attribution.join(' · ')) : null);
}

function cardsFor(app) {
  const { property, proposal, site } = app.cards;
  return el('div', { class: 'cards' },
    el('article', { class: 'card' },
      el('div', { class: 'img' }, el('img', { src: property.imageUrl, alt: `Street view of ${property.title}` }), property.attribution ? el('span', { class: 'attr' }, property.attribution) : null),
      el('div', { class: 'body' }, el('h2', {}, property.title), el('p', { class: 'sub' }, property.subtitle), rows(property.rows), useGateView(app), titleView(app))),
    el('article', { class: 'card' }, el('div', { class: 'body' }, el('h2', {}, proposal.title), rows(proposal.rows), ['no-front-space', 'public-land', 'outside-plot'].includes(app.assessment?.blocker?.id) ? blockerView(app.assessment) : null)),
    el('article', { class: 'card' },
      siteMapBox(app),
      el('div', { class: 'body' },
        legend(app),
        blockTable(app),
        siteChecksView(app),
        el('p', { class: 'note' }, app.map.frontNote, ' ',
          el('button', { type: 'button', class: 'link', onclick: swapFront }, 'Front and back look wrong? Swap')),
        frontPicker(app),
        rows(site.rows), profileEditor(app))));
}

/* ---------------- correct the house details (roof type, storeys, original dwelling, site area) ---------------- */
function profileEditor(app) {
  const p = app.profile ?? {};
  const send = async (body) => { try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify(body) })); } catch (err) { alert(err.message); } };
  const choose = (id, label, opts, cur, toBody) => el('div', {}, el('label', { for: id }, label),
    el('select', { id, onchange: (e) => { if (e.target.value !== '') send(toBody(e.target.value)); } },
      el('option', { value: '' }, 'To confirm'), opts.map(([v, t]) => el('option', { value: v, selected: String(cur ?? '') === v ? 'selected' : null }, t))));
  const area = el('input', { id: 'pe-area', type: 'number', min: '1', step: '1', value: p.siteAreaM2?.value ?? '', placeholder: 'm²', 'aria-label': 'Site area in square metres' });
  return el('details', { class: 'profile-edit' }, el('summary', {}, 'Correct the house details'),
    el('p', { class: 'note' }, 'These start as "To confirm" or come from map data. What you enter here is used by the checks and the 3D view.'),
    el('div', { class: 'grid' },
      choose('pe-roof', 'Roof type', [['Pitched', 'Pitched'], ['Hipped', 'Hipped'], ['Flat', 'Flat'], ['Mixed', 'Mixed']], p.roofType?.value, (v) => ({ roofType: v })),
      choose('pe-storeys', 'Storeys', [1, 2, 3, 4].map((n) => [String(n), String(n)]), p.storeys?.value, (v) => ({ storeys: Number(v) })),
      choose('pe-orig', 'Original house (not converted from a shop, office or barn)', [['true', 'Yes'], ['false', 'No']], p.originalDwelling?.value == null ? '' : String(p.originalDwelling.value), (v) => ({ originalDwelling: v === 'true' })),
      el('div', {}, el('label', { for: 'pe-area' }, 'Site (plot) area'), area,
        el('button', { type: 'button', class: 'link', onclick: () => { const n = Number(area.value); if (n > 0) send({ siteAreaM2: n }); } }, 'Use this area'))));
}

/* ---------------- map card: aerial photo or street map under the same outlines ---------------- */
let baseLayer = 'aerial'; // remembered across repaints
function siteMapBox(app) {
  const site = app.cards.site;
  const img = el('img', { src: site.imageUrl, alt: 'Aerial view of the property' });
  const attr = site.attribution ? el('span', { class: 'attr' }, site.attribution) : null;
  const buttons = {};
  const sync = () => {
    const map = baseLayer === 'map', blk = baseLayer === 'block';
    img.src = map ? site.mapImageUrl : site.imageUrl;
    img.alt = map ? 'Street map of the property' : 'Aerial view of the property';
    box.classList.toggle('block', blk);                              // block plan: plain drawing + measurements instead of a picture
    document.body.dataset.layer = baseLayer;                         // shows the measurements table under the map
    if (attr) attr.hidden = map || blk;                              // the street map carries its own attribution
    for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(k === baseLayer));
  };
  const btn = (key, label) => (buttons[key] = el('button', { type: 'button', class: 'layer-btn', onclick: () => { baseLayer = key; sync(); } }, label));
  const box = el('div', { class: 'img' }, img, mapView(app), attr,
    el('div', { class: 'layers', role: 'group', 'aria-label': 'Map background' }, btn('aerial', 'Aerial'), btn('map', 'Map'), btn('block', 'Block plan')),
    el('button', { type: 'button', class: 'expand', 'aria-label': 'Enlarge map and checks', title: 'Enlarge map and checks', onclick: () => openMapModal(app) }, '⤢ Zoom'));
  sync();
  return box;
}

/* ---------------- enlarged map + checks (zoom / pan) ---------------- */
function openMapModal(app) {
  const site = app.cards.site;
  const MIN = 1, MAX = 6;
  const t = { k: 1, x: 0, y: 0 };                 // zoom factor + offset as a FRACTION of the picture, so every pane moves together
  let mode = baseLayer === 'map' ? 'map' : baseLayer === 'block' ? 'block' : 'both'; // aerial | map | block | both (aerial photo beside the block plan)
  let stages = [];
  const panes = el('div', { class: 'modal-panes' });

  const clamp = () => { t.k = Math.min(MAX, Math.max(MIN, t.k)); t.x = Math.min(0, Math.max(1 - t.k, t.x)); t.y = Math.min(0, Math.max(1 - t.k, t.y)); };
  const apply = () => {
    clamp();
    for (const st of stages) {
      st.firstChild.style.transform = `translate(${t.x * st.clientWidth}px,${t.y * st.clientHeight}px) scale(${t.k})`;
      st.classList.toggle('zoomed', t.k > 1);
    }
  };
  const zoomAt = (st, px, py, factor) => {
    const nx = px / st.clientWidth, ny = py / st.clientHeight, k0 = t.k;
    t.k = Math.min(MAX, Math.max(MIN, t.k * factor));
    const r = t.k / k0; t.x = nx - (nx - t.x) * r; t.y = ny - (ny - t.y) * r; apply();
  };
  const centre = (f) => { const st = stages[0]; zoomAt(st, st.clientWidth / 2, st.clientHeight / 2, f); };
  const reset = () => { t.k = 1; t.x = t.y = 0; apply(); };

  // one pane = picture + the same outlines; drag to pan, wheel / pinch / double-click to zoom
  function pane(label, url) {
    const stage = el('div', { class: 'zoom-stage' },
      el('div', { class: `zoom-inner${url ? '' : ' block'}` }, url ? el('img', { src: url, alt: `${label} view of the property`, draggable: 'false' }) : null, mapView(app, { readonly: true })),
      mode === 'both' ? el('span', { class: 'pane-tag' }, label) : null);
    const box = () => stage.getBoundingClientRect();
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const b = box(); zoomAt(stage, e.clientX - b.left, e.clientY - b.top, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    stage.addEventListener('dblclick', (e) => { const b = box(); if (t.k > 1) reset(); else zoomAt(stage, e.clientX - b.left, e.clientY - b.top, 2.5); });
    const ptrs = new Map(); let lastDist = 0;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); lastDist = 0; });
    stage.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { t.x += (e.clientX - prev[0]) / stage.clientWidth; t.y += (e.clientY - prev[1]) / stage.clientHeight; apply(); }
      else if (ptrs.size === 2) {
        const [a, c] = [...ptrs.values()], d = Math.hypot(a[0] - c[0], a[1] - c[1]), b = box();
        if (lastDist) zoomAt(stage, (a[0] + c[0]) / 2 - b.left, (a[1] + c[1]) / 2 - b.top, d / lastDist);
        lastDist = d;
      }
    });
    const up = (e) => { ptrs.delete(e.pointerId); lastDist = 0; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    return stage;
  }
  const layout = () => {
    const wanted = mode === 'both' ? [['Aerial', site.imageUrl], ['Block plan', null]] : mode === 'map' ? [['Map', site.mapImageUrl]] : mode === 'block' ? [['Block plan', null]] : [['Aerial', site.imageUrl]];
    stages = wanted.map(([label, url]) => pane(label, url));
    panes.replaceChildren(...stages);
    box.classList.toggle('both', mode === 'both');
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(k === mode));
    attrEl.hidden = !(mode === 'aerial' || mode === 'both');
    apply();
  };
  const modeBtns = {};
  const modeBtn = (key, label) => (modeBtns[key] = el('button', { type: 'button', class: 'layer-btn', onclick: () => { mode = key; layout(); } }, label));

  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); document.body.classList.remove('modal-open'); opener?.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === '+' || e.key === '=') centre(1.25); else if (e.key === '-') centre(0.8); else if (e.key === '0') reset(); };
  const opener = document.activeElement;
  const attrEl = el('span', { class: 'attr' }, site.attribution ?? '');

  const box = el('div', { class: 'modal-box' },
    el('div', { class: 'modal-bar' },
      el('strong', {}, app.cards.property.title),
      el('span', { class: 'layers inline', role: 'group', 'aria-label': 'Map background' }, modeBtn('aerial', 'Aerial'), modeBtn('map', 'Map'), modeBtn('block', 'Block plan'), modeBtn('both', 'Aerial + block plan')),
      el('span', { class: 'zoom-btns' },
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Zoom out', onclick: () => centre(0.8) }, '−'),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Zoom in', onclick: () => centre(1.25) }, '+'),
        el('button', { type: 'button', class: 'ghost', onclick: reset }, 'Reset'),
        el('button', { type: 'button', onclick: close }, 'Close'))),
    el('div', { class: 'modal-main' },
      el('div', { class: 'modal-map' }, panes,
        el('p', { class: 'note zoom-hint' }, 'The outlines and measurements come from the same data on every view. Scroll or pinch to zoom, drag to move, double-click to zoom in or out.'),
        site.attribution ? attrEl : null),
      el('div', { class: 'modal-side' }, legend(app), blockTable(app, true), siteChecksView(app))));
  const overlay = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Enlarged map and checks', onclick: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay); document.body.classList.add('modal-open');
  overlay.querySelector('.modal-bar .zoom-btns button:last-child').focus();
  document.addEventListener('keydown', onKey);
  layout();
}

let current = null;
/** Title number + tenure. The title number is not in open data, so the applicant enters it from the title register; it is stored against this property's UPRN. */
function titleView(app) {
  const t = app.title;
  if (!t) return null;
  const num = el('input', { type: 'text', placeholder: 'e.g. TGL123456', maxlength: '16', 'aria-label': 'Title number' });
  num.value = t.titleNumber ?? '';
  const ten = el('select', { 'aria-label': 'Tenure' }, ['unknown', 'freehold', 'leasehold'].map((v) => el('option', { value: v }, { unknown: 'Tenure: not sure', freehold: 'Freehold', leasehold: 'Leasehold' }[v])));
  ten.value = t.tenureEntered ? t.tenure : 'unknown';
  const yrs = el('input', { type: 'number', min: '0', max: '999', placeholder: 'Years left on lease', 'aria-label': 'Years left on the lease' });
  yrs.value = t.leaseYearsRemaining ?? '';
  const save = async () => {
    try { paint(await api(`/applications/${current.id}/title`, { method: 'PATCH', body: JSON.stringify({ titleNumber: num.value, tenure: ten.value, leaseYearsRemaining: yrs.value === '' ? null : Number(yrs.value) }) })); }
    catch (e) { setStatus(e.message); }
  };
  return el('div', { class: 'title-box' },
    el('p', { class: 'note' }, t.uprn ? `Recorded against UPRN ${t.uprn}. ${t.note}` : `No UPRN yet, so the title number cannot be mapped. ${t.note}`),
    el('div', { class: 'actions' }, num, ' ', ten, ' ', yrs, ' ', el('button', { type: 'button', class: 'ghost', onclick: save }, 'Save title details')));
}

/** Not a house (or not confirmed): say so plainly, and let the applicant correct a wrong guess. */
function useGateView(app) {
  const g = app.useGate;
  if (!g || g.state === 'soft') return null;
  return el('div', {}, blockerView({ blocker: { ...g, id: 'not-a-house' } }),
    el('div', { class: 'actions confirm-use' },
      el('button', { type: 'button', class: 'ghost', onclick: () => confirmUse(true) }, g.state === 'stop' ? 'This is actually a house' : "Yes, it's a house"),
      g.state === 'confirm' ? el('button', { type: 'button', class: 'ghost', onclick: () => confirmUse(false) }, "No, it isn't a house") : null));
}
async function confirmUse(isHouse) {
  try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ isHouse }) })); }
  catch (e) { setStatus(e.message); }
}

/** Which way the front door faces: the swap link only flips 180°, a corner house needs a quarter turn. */
function frontPicker(app) {
  const names = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
  const cur = (Math.round(app.map.frame.frontBearingDeg / 45) % 8) * 45;
  const corner = app.map.frame.corner && app.map.frame.frontSource !== 'user';
  return el('div', { class: `frontpick${corner ? ' needed' : ''}` },
    el('label', { for: 'front-dir' }, corner ? 'Corner house – which way does the front door face?' : 'Front door faces'),
    el('select', { id: 'front-dir', onchange: (e) => setFront(Number(e.target.value)) },
      names.map((n, i) => el('option', { value: i * 45, selected: i * 45 === cur ? 'selected' : false }, n))));
}
async function setFront(deg) {
  try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ frontBearingDeg: deg }) })); }
  catch (e) { setStatus(e.message); }
}

async function swapFront() {
  try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ frontBearingDeg: (current.map.frame.frontBearingDeg + 180) % 360 }) })); }
  catch (e) { setStatus(e.message); }
}

/** Plain-English callout when a porch has no private land in front of the door (assessment.blocker comes from the server). */
const blockerView = (a) => a?.blocker
  ? el('div', { class: `blocker${a.blocker.level === 'certain' ? '' : ' warn'}`, role: 'alert' },
      el('strong', {}, a.blocker.headline), a.blocker.reason ? el('span', {}, a.blocker.reason) : null)
  : null;

function verdictFor(a) {
  if (!a) return null;
  return el('div', { class: 'verdict' },
    el('h3', {}, a.label), blockerView(a), a.blocker?.id === 'not-a-house' || a.blocker?.level === 'certain' ? null : el('p', {}, a.summary),
    a.blocker?.id === 'not-a-house' ? null : el('ul', { class: 'checks' }, a.checks.map((c) => el('li', { class: c.status }, c.message))),
    projectView(a.project), gpdoView(a.gpdo), lpaView(a.lpa), valueView(a.value),
    el('p', { class: 'note' }, a.disclaimer));
}

/** Stage 1: what the project is, which approval routes could apply, and the planning questions that still need an answer (assessment.project). */
function projectView(c) {
  if (!c) return null;
  const needed = c.questions.filter((q) => q.status === 'needed'), done = c.questions.filter((q) => q.status !== 'needed');
  const where = (q) => (q.where === 'profile' ? 'Answer it in the property details above.' : q.field ? 'Fill it in under "More details" in the work form.' : '');
  return el('div', { class: 'project' },
    el('h4', {}, 'What this project is'),
    el('p', {}, el('strong', {}, c.developmentType), c.gpdo ? ` – ${c.gpdo.schedule.split(',').slice(0, 2).join(',')}, Class ${c.gpdo.class}: ${c.gpdo.title}.` : ''),
    el('p', { class: 'note' }, 'Routes that could apply: ', c.routes.map((r) => r.label).join(' · ')),
    needed.length ? el('div', {}, el('strong', {}, `Questions still to answer (${needed.length})`),
      el('ul', { class: 'qs' }, needed.map((q) => el('li', {}, q.question, el('span', { class: 'ref' }, ` ${q.refs.join(', ')} · ${where(q)}`))))) : el('p', { class: 'note' }, 'Every question the rules need for this kind of work has been answered or found automatically.'),
    done.length ? el('p', { class: 'note' }, `Already answered: ${done.length}`) : null,
    c.conditions.length ? el('p', { class: 'note' }, 'Conditions to comply with: ', c.conditions.map((x) => `${x.ref} ${x.text}`).join(' ')) : null);
}

/** Stage 2: every limit / restriction / condition of the GPDO Class and whether it was tested (assessment.gpdo). */
function gpdoView(g) {
  if (!g) return null;
  const mark = { pass: '✓', fail: '✗', uncertain: '?', condition: '•', not_assessed: '–' }, word = { pass: 'Met', fail: 'Not met', uncertain: 'Please confirm', condition: 'Condition', not_assessed: 'Not tested here' };
  const c = g.counts;
  return el('details', { class: 'gpdo' },
    el('summary', {}, `GPDO Class ${g.class} – provisions checked (${c.fail} not met, ${c.uncertain} to confirm, ${c.pass} met, ${c.not_assessed} not tested)`),
    el('ul', { class: 'prov' }, g.provisions.map((p) => el('li', { class: `prov-${p.status}` },
      el('span', { class: 'mk' }, mark[p.status]), el('div', {},
        el('strong', {}, p.ref), ` ${word[p.status]}. ${p.text}`,
        ...p.evidence.map((e) => el('div', { class: 'how' }, e.message)))))));
}

/** Planning history: earlier applications at this address, and how similar work nearby has been decided (app.history, assessment.precedent). */
function historyView(h, pr) {
  if (!h) return null;
  const word = { approved: 'Approved', refused: 'Refused', withdrawn: 'Withdrawn', pending: 'Undecided', unknown: '—' };
  const row = (r) => el('tr', {}, el('th', {}, (r.decidedOn ?? r.receivedOn ?? '').slice(0, 10)), el('td', {}, el('strong', {}, `${word[r.outcome]}: `), r.description.length > 140 ? `${r.description.slice(0, 140)}…` : r.description,
    el('div', { class: 'how' }, [r.address, r.distanceM != null ? `${r.distanceM} m away` : null].filter(Boolean).join(' · '), r.councilUrl ? [' · ', el('a', { href: r.councilUrl, target: '_blank', rel: 'noopener' }, 'council register')] : null)));
  return el('div', { class: 'areas history' }, el('h4', {}, 'Planning history'),
    el('strong', {}, 'At this address'),
    h.here?.length ? el('table', {}, el('tbody', {}, h.here.slice(0, 8).map(row))) : el('p', { class: 'note' }, `No applications found for this exact address in the last ${h.years} years.`),
    h.building?.length ? el('p', { class: 'note' }, `${h.building.length} application${h.building.length > 1 ? 's' : ''} for other parts of the same building (flats) were also found.`) : null,
    pr ? el('div', {}, el('strong', {}, `Similar work within ${pr.radiusM} m (last ${pr.years} years)`),
      pr.decided ? el('p', {}, `${pr.decided} decided: ${pr.approved} approved, ${pr.refused} refused${pr.approvalRate != null ? ` (${Math.round(pr.approvalRate * 100)}% approved)` : ''}.`) : el('p', { class: 'note' }, 'None found nearby.'),
      pr.examples?.length ? el('table', {}, el('tbody', {}, pr.examples.map(row))) : null) : null,
    el('p', { class: 'note' }, `The register data does not include the decision notice, so planning conditions (for example one removing permitted development rights) are not shown – open the council register to read them. ${h.attribution ?? ''}`));
}

/** A rough value for the extra space, from the street's sale prices and the home's floor area (assessment.value). Always a range, always with its caveats. */
function valueView(v) {
  if (!v) return null;
  if (!v.available) return el('div', { class: 'areas value' }, el('h4', {}, 'Rough value of the extra space'), el('p', { class: 'note' }, v.reason));
  const gbp = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
  return el('div', { class: 'areas value' }, el('h4', {}, 'Rough value of the extra space'),
    el('p', { class: 'bigfig' }, el('strong', {}, `${gbp(v.lowGbp)} – ${gbp(v.highGbp)}`), el('span', {}, ` (middle ${gbp(v.midGbp)})`)),
    el('p', { class: 'note' }, `${v.addedFloorM2} m² of new floor space on a ${Math.round(v.homeFloorM2)} m² home (+${v.growthPct}%). Typical price per m² here: ${gbp(v.pricePerM2.lowGbp)}–${gbp(v.pricePerM2.highGbp)}. ${v.method}`),
    v.ownSale ? el('p', { class: 'note' }, `From this home's own ${v.ownSale.year} sale (${gbp(v.ownSale.priceGbp)}): about ${gbp(v.ownSale.midGbp)}. ${v.ownSale.note}`) : null,
    ...v.caution.map((c) => el('p', { class: 'note warn' }, c)),
    quoteBox(v),
    el('p', { class: 'note' }, `Based on ${v.basis.comps} recent sales on ${v.basis.street}. This is a rough guide from sale prices, not a valuation – ask a local estate agent or a RICS valuer, and compare it with your build quote.`));
}

/** The site dashboard: every measured street / site value as a tile; placeholders for data we cannot get yet (app.map.dashboard). */
function dashboardView(d) {
  if (!d?.sections?.length) return null;
  const mark = { ok: '●', check: '▲', info: '○', na: '–' }, tag = { ok: 'Measured', check: 'Check', info: 'Found nothing / info', na: 'Not available yet' };
  const tileEl = (t) => el('div', { class: `tile tile-${t.status}`, title: tag[t.status] },
    el('div', { class: 'tile-label' }, el('span', { class: 'dot', 'aria-label': tag[t.status] }, mark[t.status]), t.label),
    el('div', { class: 'tile-value' }, t.value), el('div', { class: 'tile-sub' }, t.sub));
  const counts = d.sections.flatMap((s) => s.tiles).reduce((a, t) => { a[t.status] = (a[t.status] ?? 0) + 1; return a; }, {});
  return el('div', { class: 'areas dashboard' },
    el('h4', {}, 'Street and site dashboard'),
    el('p', { class: 'note' }, `${d.subjectKind === 'proposal' ? 'Distances are from the proposed work.' : 'Distances are from the house (choose a work to measure from it).'} ${counts.ok ?? 0} measured · ${counts.check ?? 0} to check · ${counts.na ?? 0} not available yet. "None mapped" means none in the map data, not none on site.`),
    d.sections.map((sec) => el('section', { class: `dash-sec dash-${sec.id}` }, el('h5', {}, sec.title), el('div', { class: 'tiles' }, sec.tiles.map(tileEl)))));
}

/** Printable outputs: block plan at a true scale, and a draft Lawful Development Certificate supporting statement. */
function exportsView(app) {
  if (!app.assessment?.gpdo) return null;
  const base = `/api/applications/${app.id}`;
  return el('div', { class: 'areas exports' }, el('h4', {}, 'Take it with you'),
    el('p', { class: 'actions' },
      el('a', { class: 'button', href: `${base}/report`, target: '_blank', rel: 'noopener' }, 'Property report (print or save as PDF)'), ' ',
      el('a', { class: 'button', href: `${base}/block-plan.svg`, target: '_blank', rel: 'noopener' }, 'Block plan (A4, printed to scale)'), ' ',
      el('a', { class: 'button', href: `${base}/ldc-pack`, target: '_blank', rel: 'noopener' }, 'Lawful Development Certificate statement (draft)'), ' ',
      el('a', { class: 'button', href: `${base}/export.json`, download: `${app.reference}.json` }, 'Save everything as JSON'), ' ',
      el('a', { class: 'button', href: `/register.html?app=${encodeURIComponent(app.id)}`, target: '_blank', rel: 'noopener' }, '228-check register')),
    el('p', { class: 'note' }, 'Drafts prepared from open data, for you to check and correct. The block plan is not a surveyed or Ordnance Survey-licensed plan, and no location plan is produced – councils set their own validation rules, so check theirs.'));
}

/** Compare the estimate with the applicant's own build quote (nothing is stored). */
function quoteBox(v) {
  const g = (n) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
  const out = el('p', { class: 'note' }), input = el('input', { type: 'number', min: '0', step: '1000', placeholder: 'e.g. 45000', 'aria-label': 'Your build quote in pounds' });
  input.addEventListener('input', () => {
    const c = Number(input.value);
    out.textContent = c > 0 ? `After a ${g(c)} build: ${g(v.lowGbp - c)} to ${g(v.highGbp - c)} (middle ${g(v.midGbp - c)}). ${v.midGbp < c ? 'A negative figure means the extra space is unlikely to pay for itself on sale price alone. ' : ''}This leaves out fees, VAT, finance and the cost of disruption, and counts only what the space might add to a sale price, not what it is worth to you to live in.` : '';
  });
  return el('div', { class: 'quotebox' }, el('label', {}, 'Your build quote (£): ', input), out);
}

/** Land Registry sale records for this home (type, tenure, new build) and the street's recent prices (app.ppd). */
function salesView(p) {
  if (!p || (!p.sales?.length && !p.street?.stats)) return null;
  const gbp = (n) => `£${Math.round(n).toLocaleString('en-GB')}`, type = { detached: 'Detached', semi_detached: 'Semi-detached', terraced: 'Terraced', flat: 'Flat / maisonette', other: 'Other' };
  const st = p.street?.stats;
  return el('div', { class: 'areas ppd' }, el('h4', {}, 'From Land Registry sales records'),
    p.sales?.length ? el('table', {}, el('tbody', {}, p.sales.slice(0, 5).map((s) => el('tr', {}, el('th', {}, s.date), el('td', {}, el('strong', {}, gbp(s.priceGbp)), el('div', { class: 'how' }, `${type[s.propertyType]} · ${s.tenure}${s.newBuild ? ' · new build' : ''}`)))))) : el('p', { class: 'note' }, 'No sale of this exact address was found in the records (Land Registry data is published with a delay of a few months).'),
    st ? el('p', {}, el('strong', {}, `Street: ${st.count} ${p.street.type ? type[p.street.type].toLowerCase() : 'house'} sale${st.count > 1 ? 's' : ''} in ${p.street.years} years`), ` – median ${gbp(st.medianGbp)}, middle half ${gbp(st.p25Gbp)} to ${gbp(st.p75Gbp)}.`) : null,
    el('p', { class: 'note' }, `Sale prices are what was recorded at registration, not valuations. ${p.attribution ?? ''}`));
}

/** Facts from the home's energy performance certificate (app.epc): the real room count, built form, age band and floor area. */
function epcView(e) {
  if (!e) return null;
  const rows = [['Habitable rooms', e.habitableRooms], ['Property type', e.propertyType], ['Built form', e.builtForm], ['Age band', e.ageBand], ['Floor area', e.floorAreaM2 != null ? `${e.floorAreaM2} m²` : null], ['Extensions recorded', e.extensionCount], ['Certificate lodged', e.lodgedOn]].filter(([, v]) => v != null && v !== '');
  if (!rows.length) return null;
  return el('div', { class: 'areas epc' }, el('h4', {}, 'From the energy performance certificate'),
    el('table', {}, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, el('strong', {}, String(v))))))),
    el('p', { class: 'note' }, `Matched by ${e.matchedBy === 'uprn' ? 'property reference (UPRN)' : 'address'}. Certificates can be years old and room counts are the assessor's – confirm them. ${e.attribution ?? ''}`));
}

/** No energy certificate: let the applicant type the number of habitable rooms, so the council's garden test uses a real figure. */
function roomsForm() {
  const input = el('input', { type: 'number', min: '1', max: '30', step: '1', placeholder: 'e.g. 5', 'aria-label': 'Habitable rooms' });
  const btn = el('button', { type: 'button', onclick: async () => {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1) { input.focus(); return; }
    try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ habitableRooms: n }) })); } catch (err) { alert(err.message); }
  } }, 'Use this number');
  return el('div', { class: 'roomsform' }, el('label', {}, 'How many habitable rooms does the house have? ', el('span', { class: 'note' }, '(bedrooms, living rooms, and kitchens of 13 m² or more) '), input), btn);
}

/** Plot / house / extension figures and how each was worked out (app.areas comes from the server). Shown even when no proposal or council rules exist. */
function areasView(a) {
  if (!a?.rows?.length) return null;
  return el('div', { class: 'areas' }, el('h4', {}, 'Land and building sizes – how they were calculated'),
    el('table', {}, el('tbody', {}, a.rows.map((r) => el('tr', {}, el('th', {}, r.label), el('td', {}, el('strong', {}, r.value ?? 'Not available'), el('div', { class: 'how' }, r.how)))))));
}

/** The council's own guidance, applied to the plot / house / extension areas measured on the plan (assessment.lpa comes from the server). */
function lpaView(l) {
  if (!l) return null;
  if (!l.available) return el('div', { class: 'lpa' }, el('h4', {}, 'Local planning authority'), el('p', { class: 'note' }, l.headline));
  return el('div', { class: `lpa lpa-${l.outlook}` },
    el('h4', {}, `${l.authority} Council – local guidance`),
    el('p', { class: 'lpa-head' }, l.headline),
    l.measured?.remainingGardenM2 != null && l.measured.habitableRooms == null ? roomsForm() : null,
    el('ul', { class: 'checks' }, l.checks.map((c) => el('li', { class: c.status, title: c.ref || '' }, c.message))),
    el('p', { class: 'note' }, `${l.document}. `, el('a', { href: l.url, target: '_blank', rel: 'noopener' }, 'Read the guidance'), l.caution ? ` ${l.caution}` : ''));
}

/* ---------------- where the data comes from ---------------- */
const KIND = { measured: 'Measured', official: 'Official record', mapped: 'Map data', estimated: 'Estimated', you: 'From you', assumed: 'Assumed' };
const chip = (kind) => el('span', { class: `src src-${kind}`, title: KIND[kind] }, KIND[kind] ?? kind);

function sourcesView(app) {
  const rows = app.sources ?? [];
  if (!rows.length) return null;
  return el('details', { class: 'sources' }, el('summary', {}, 'Where this data comes from'),
    el('p', { class: 'note' }, 'Every item on this page, and who it came from. "Assumed" and "Estimated" items are not records: check them.'),
    el('ul', { class: 'source-list' }, ...rows.map((r) => el('li', {},
      el('div', { class: 'src-head' }, el('strong', {}, r.topic), chip(r.kind)),
      r.value ? el('div', { class: 'src-val' }, String(r.value)) : null,
      el('div', { class: 'src-from' }, r.source), r.note ? el('div', { class: 'src-note' }, r.note) : null))));
}

/* ---------------- inside the home: 3D view, rooms and interior checks ---------------- */
let viewer = null;
let viewerState = { cam: null, opt: null, selected: null }; // survives repaints, so the camera does not jump back after every change

function interiorView(app) {
  const it = app.interior;
  viewer?.destroy(); viewer = null;
  if (!it) return null;
  if (!it.available) return el('section', { class: 'interior' }, el('h3', {}, 'Inside the home (3D)'), el('p', { class: 'note' }, it.reason ?? 'Not available for this property.'));

  const patchInterior = async (body) => {
    try { paint(await api(`/applications/${app.id}/interior`, { method: 'PATCH', body: JSON.stringify(body) })); }
    catch (e) { setStatus(e.message); }
  };
  const canvas = el('canvas', { class: 'viewer-canvas', tabindex: '0', role: 'img',
    'aria-label': `3D model of the home: ${it.rooms.length} rooms over ${it.storeys.length} floor${it.storeys.length > 1 ? 's' : ''}${it.proposal ? `, with the ${it.proposal.label.toLowerCase()} shown in orange` : ''}. Drag to turn, scroll to zoom, arrow keys also turn it. The rooms are listed beside it.` });
  const detail = el('div', { class: 'room-detail', 'aria-live': 'polite' });
  const roomBtns = new Map();

  const showRoom = (room) => {
    viewerState.selected = room?.id ?? null;
    for (const [id, b] of roomBtns) b.setAttribute('aria-pressed', String(id === room?.id));
    if (!room) { detail.replaceChildren(el('p', { class: 'hint' }, 'Click a room in the model or the list to see its size and rename it.')); return; }
    const name = el('input', { id: 'room-name', value: room.name, maxlength: '40', 'aria-label': 'Room name' });
    const type = el('select', { id: 'room-type', 'aria-label': 'Room use' }, Object.entries(it.roomTypes).map(([k, v]) => el('option', { value: k, selected: k === room.type ? 'selected' : null }, v)));
    detail.replaceChildren(
      el('h4', {}, room.name, room.isNew ? el('span', { class: 'tag new' }, 'New') : el('span', { class: 'tag' }, room.userDrawn ? 'Drawn by you' : 'Typical layout')),
      el('ul', { class: 'rows' },
        el('li', {}, el('span', { class: 'k' }, 'Floor area'), el('span', { class: 'v' }, `${room.areaM2} m²`)),
        el('li', {}, el('span', { class: 'k' }, 'Width (shorter side)'), el('span', { class: 'v' }, `${room.widthM} m`)),
        el('li', {}, el('span', { class: 'k' }, room.slopedCeiling ? 'Highest head height' : 'Ceiling height'), el('span', { class: 'v' }, `${room.ceilingM} m`)),
        room.headroom ? el('li', {}, el('span', { class: 'k' }, 'Floor with about 2.2 m head height'), el('span', { class: 'v' }, `${room.headroom.over2_2} m² of ${room.headroom.over1_5} m²`)) : null),
      el('div', { class: 'grid' }, el('div', {}, el('label', { for: 'room-name' }, 'Name'), name), el('div', {}, el('label', { for: 'room-type' }, 'Used as'), type)),
      el('div', { class: 'actions' }, el('button', { type: 'button', onclick: () => patchInterior({ rooms: { [room.id]: { name: name.value, type: type.value } } }) }, 'Save room')));
  };

  const state = viewerState;
  viewer = createViewer(canvas, it, { initial: { cam: state.cam, opt: state.opt }, onSelect: (room, fromCanvas) => { showRoom(room); if (fromCanvas && room) roomBtns.get(room.id)?.scrollIntoView({ block: 'nearest' }); } });
  const remember = () => { viewerState.cam = viewer.state().cam; viewerState.opt = viewer.state().opt; };
  canvas.addEventListener('pointerup', remember); canvas.addEventListener('wheel', remember, { passive: true }); canvas.addEventListener('keyup', remember);

  const o = viewer.state().opt;
  const toggle = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o[key] ? 'checked' : null, onchange: (e) => { viewer.set({ [key]: e.target.checked }); remember(); } }), label);
  const storeySel = el('select', { id: 'storey-sel', 'aria-label': 'Floors shown', onchange: (e) => { viewer.set({ storey: e.target.value === 'all' ? 'all' : Number(e.target.value) }); remember(); } },
    el('option', { value: 'all', selected: o.storey === 'all' ? 'selected' : null }, 'All floors'),
    it.storeys.map((s) => el('option', { value: String(s.index), selected: String(o.storey) === String(s.index) ? 'selected' : null }, `Up to ${s.label.toLowerCase()}`)));
  const viewBtn = (name, label) => el('button', { type: 'button', class: 'ghost small', onclick: () => { viewer.view(name); remember(); } }, label);

  const roomList = el('ul', { class: 'room-list', 'aria-label': 'Rooms' }, [...it.storeys].reverse().map((st) =>
    el('li', {}, el('strong', {}, st.label), el('ul', {}, st.roomIds.map((id) => it.rooms.find((r) => r.id === id)).filter(Boolean).map((r) => {
      const b = el('button', { type: 'button', class: `room-btn${r.isNew ? ' new' : ''}`, 'aria-pressed': 'false', onclick: () => viewer.select(r.id) }, r.name, el('span', {}, `${r.areaM2} m²`));
      roomBtns.set(r.id, b); return el('li', {}, b);
    })))));

  const setup = app.interiorSetup ?? {};
  const hasLoft = !!it.loft;
  const settings = el('details', { class: 'interior-settings' }, el('summary', {}, 'Change the assumed layout'),
    el('div', { class: 'grid' },
      el('div', {}, el('label', { for: 'in-storeys' }, 'Floors in the house'),
        el('select', { id: 'in-storeys', onchange: (e) => patchInterior({ storeys: e.target.value ? Number(e.target.value) : null }) },
          el('option', { value: '' }, `As mapped (${it.nStoreys})`), [1, 2, 3].map((n) => el('option', { value: String(n), selected: setup.storeys === n ? 'selected' : null }, String(n))))),
      el('div', {}, el('label', { for: 'in-ceil' }, 'Ceiling height (m)'),
        el('input', { id: 'in-ceil', type: 'number', min: '2', max: '4', step: '0.05', value: setup.ceilingM ?? '', placeholder: String(it.ceilingM), onchange: (e) => patchInterior({ ceilingM: e.target.value ? Number(e.target.value) : null }) })),
      el('div', {}, el('label', { for: 'in-hall' }, 'Stairs and hall on the'),
        el('select', { id: 'in-hall', onchange: (e) => patchInterior({ hallSide: e.target.value || null }) },
          el('option', { value: '' }, 'Left (default)'), el('option', { value: 'right', selected: setup.hallSide === 'right' ? 'selected' : null }, 'Right'))),
      hasLoft || setup.loftUse ? el('div', {}, el('label', { for: 'in-loft' }, 'New loft room used as'),
        el('select', { id: 'in-loft', onchange: (e) => patchInterior({ loftUse: e.target.value || null }) },
          el('option', { value: '' }, 'Bedroom'), el('option', { value: 'study', selected: setup.loftUse === 'study' ? 'selected' : null }, 'Study'), el('option', { value: 'storage', selected: setup.loftUse === 'storage' ? 'selected' : null }, 'Storage'))) : null));

  const t = it.totals;
  const totals = el('ul', { class: 'rows' },
    t.newFloorM2 ? el('li', {}, el('span', { class: 'k' }, 'New floor area'), el('span', { class: 'v' }, `${t.newFloorM2} m² in ${t.newRooms} room${t.newRooms > 1 ? 's' : ''}`, chip('you'))) : null,
    t.loftUsableM2 != null ? el('li', {}, el('span', { class: 'k' }, 'Usable loft floor (about 2.2 m head height)'), el('span', { class: 'v' }, `${t.loftUsableM2} m²`)) : null,
    el('li', {}, el('span', { class: 'k' }, 'Bedrooms (typical layout)'), el('span', { class: 'v' }, t.bedroomsAfter === t.bedroomsBefore ? `${t.bedroomsAfter}` : `${t.bedroomsBefore} → ${t.bedroomsAfter}`, chip(setup.layout ? 'you' : 'assumed'))),
    el('li', {}, el('span', { class: 'k' }, 'Roof'), el('span', { class: 'v' }, it.roof.type === 'flat' ? 'Flat' : `${it.roof.type === 'hipped' ? 'Hipped' : 'Pitched'}, ${it.roof.pitchDeg}° pitch`, chip(it.roof.source === 'lidar' ? 'measured' : 'assumed'))),
    el('li', {}, el('span', { class: 'k' }, 'Roof shape and ridge direction'), el('span', { class: 'v' }, it.roof.type === 'flat' ? 'Flat' : 'Ridge across the house', chip('assumed'))));

  const hasDrawn = !!setup.layout;
  const saveLayout = async (layout) => {
    try { paint(await api(`/applications/${app.id}/interior`, { method: 'PATCH', body: JSON.stringify({ layout }) })); return null; }
    catch (e) { return e.message; }
  };
  const editorBar = el('div', { class: 'actions editor-bar' },
    el('button', { type: 'button', onclick: () => openPlanEditor(it, { onSave: saveLayout, onUseTypical: hasDrawn ? () => saveLayout(null) : null }) }, hasDrawn ? 'Edit your floor plan' : 'Draw your own floor plan'),
    hasDrawn ? el('button', { type: 'button', class: 'ghost', onclick: () => saveLayout(null) }, 'Use the typical layout again') : null,
    el('span', { class: 'hint' }, hasDrawn ? 'Showing the rooms you drew.' : 'Showing a typical layout. Draw the real rooms for accurate 3D and checks.'));

  const section = el('section', { class: 'interior' },
    el('h3', {}, 'Inside the home (3D)'),
    el('p', { class: 'note' }, it.disclaimer), editorBar,
    el('div', { class: 'interior-grid' },
      el('div', { class: 'viewer' },
        el('div', { class: 'viewer-bar' }, viewBtn('front', 'Front'), viewBtn('rear', 'Rear'), viewBtn('top', 'Top'), viewBtn('reset', 'Reset'), storeySel),
        canvas,
        el('div', { class: 'viewer-opts' }, toggle('roof', 'Roof'), toggle('cut', 'Cut-away walls'), toggle('exploded', 'Pull floors apart'), toggle('surroundings', 'Plot and neighbours'), toggle('existingOnly', 'Hide the new work')),
        el('p', { class: 'hint' }, 'Drag to turn, scroll or pinch to zoom, click a room for details. ', el('span', { class: 'swatch new' }), ' orange = new work.')),
      el('div', { class: 'interior-side' }, totals, detail, roomList)),
    it.checks.length ? el('div', { class: 'regs' }, el('h4', {}, 'Checks on the inside'), el('ul', { class: 'checks' }, it.checks.map((c) => el('li', { class: c.status, title: c.basis || '' }, c.message))),
      el('p', { class: 'note' }, 'Guidance only (space standard and Approved Documents). It does not change the permitted-development result.')) : null,
    settings,
    it.assumptions.length ? el('details', {}, el('summary', {}, 'What was assumed'), el('ul', { class: 'checks' }, it.assumptions.map((a) => el('li', { class: 'info' }, a)))) : null);

  showRoom(it.rooms.find((r) => r.id === state.selected) ?? null);
  if (state.selected) viewer.select(state.selected);
  return section;
}

function paint(app) {
  current = app;
  $('#cards-area').replaceChildren(cardsFor(app));
  $('#verdict-area').replaceChildren(...[areasView(app.areas), interiorView(app), sourcesView(app), dashboardView(app.map?.dashboard), epcView(app.epc), salesView(app.ppd), historyView(app.history, app.assessment?.precedent), verdictFor(app.assessment), engineView(app, { onRulebook: () => api('/engine/rules'), workTypes, onWhatIf: (p) => api(`/applications/${app.id}/what-if`, { method: 'POST', body: JSON.stringify({ proposal: p }) }), onLimits: (p, field) => api(`/applications/${app.id}/what-if/limits`, { method: 'POST', body: JSON.stringify({ proposal: p, field }) }), onApply: async (p) => paint(await api(`/applications/${app.id}/proposal`, { method: 'PUT', body: JSON.stringify(p) })) }), exportsView(app)].filter(Boolean));
  const chips = app.constraints?.items ?? [];
  $('#chips-area').replaceChildren(
    ...(chips.length ? [el('ul', { class: 'chips', 'aria-label': 'Planning constraints' }, chips.map((c) => el('li', { title: [c.where === 'plot' ? 'Elsewhere on your plot (not at the address point).' : '', c.impact || ''].filter(Boolean).join(' ') }, c.where === 'plot' ? `${c.label} (on part of the plot)` : c.label)))] : []),
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
    if (f.kind === 'polygon') { out[f.name] = draw.pts.map((p) => [...p]); continue; }
    const node = form.elements[f.name];
    if (!node) continue;
    if (f.kind === 'number') { if (node.value !== '') out[f.name] = Number(node.value); }
    else if (f.kind === 'boolean') out[f.name] = node.checked;
    else out[f.name] = f.options.find((o) => String(o.value) === node.value)?.value;
  }
  return out;
}

function mount(app) {
  draw.active = false; draw.pts = []; // a new property starts with a blank canvas
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
    const main = t.fields.filter((f) => !f.advanced && f.kind !== 'polygon'), adv = t.fields.filter((f) => f.advanced && f.kind !== 'polygon');
    const field = (f) => { const n = fieldInput(f); if (f.onlyFor) n.setAttribute('data-for', f.onlyFor.join(' ')); return n; };
    fieldsBox.replaceChildren(
      el('div', { class: 'grid' }, main.map(field)),
      adv.length ? el('details', {}, el('summary', {}, 'More details (improves the permitted-development check)'), el('div', { class: 'grid' }, adv.map(field))) : null);
    applyVisibility();
    const custom = typeSel.value === 'custom_polygon';
    drawPanel.hidden = !custom;
    if (!custom && draw.active) { draw.active = false; redrawMap(); }
    syncDraw();
  };
  // fields that only matter for one kind of work (e.g. outbuilding roof) are hidden for the others
  const applyVisibility = () => {
    const kind = fieldsBox.querySelector('[name=treatAs]')?.value;
    fieldsBox.querySelectorAll('[data-for]').forEach((n) => { n.hidden = !!kind && !n.dataset.for.split(' ').includes(kind); });
  };
  fieldsBox.addEventListener('change', applyVisibility);

  // draw controls (only shown for "Draw my own shape")
  const drawHint = el('p', { class: 'hint', role: 'status' });
  const drawToggle = el('button', { type: 'button', onclick: () => {
    if (draw.active) { finishDrawing(); return; }
    draw.pts = []; draw.active = true; syncDraw(); redrawMap();
  } });
  const drawUndo = el('button', { type: 'button', class: 'ghost', onclick: undoCorner }, 'Undo last corner');
  const drawClear = el('button', { type: 'button', class: 'ghost', onclick: clearDrawing }, 'Clear');
  const drawPanel = el('div', { class: 'drawpanel', hidden: 'hidden' }, drawHint, el('div', { class: 'actions' }, drawToggle, drawUndo, drawClear));
  // 45-degree test: mark the neighbour's nearest ground-floor window on the map (rear / side work)
  const markHint = el('p', { class: 'hint', role: 'status' });
  const markBtn = el('button', { type: 'button', onclick: () => { mark.active = !mark.active; if (mark.active) { draw.active = false; syncDraw(); } syncMark(); redrawMap(); } });
  const markClear = el('button', { type: 'button', class: 'ghost', onclick: async () => {
    try { paint(await api(`/applications/${current.id}/profile`, { method: 'PATCH', body: JSON.stringify({ neighbourWindow: null }) })); } catch (err) { alert(err.message); }
  } }, 'Remove marker');
  const markPanel = el('div', { class: 'drawpanel', hidden: 'hidden' }, markHint, el('div', { class: 'actions' }, markBtn, markClear));
  syncMark = () => {
    const w = current?.profile?.neighbourWindow?.value;
    markBtn.textContent = mark.active ? 'Cancel' : w ? 'Move the window marker' : "Mark neighbour's window";
    markClear.hidden = !w;
    markHint.textContent = mark.active ? "Click the middle of the neighbour's nearest ground-floor window (kitchen, living room or bedroom) on the photo."
      : w ? 'The council\'s 45-degree line from that window is drawn on the map; the result is in the checks.'
      : "Optional: mark the middle of the neighbour's nearest back window, and the council's 45-degree test runs.";
  };
  const showMark = () => { markPanel.hidden = !['rear_extension', 'side_extension', 'wraparound_extension', 'custom_polygon'].includes(typeSel.value); syncMark(); };
  syncDraw = () => {
    const n = draw.pts.length;
    drawToggle.textContent = draw.active ? 'Finish shape' : n ? 'Draw again' : 'Start drawing';
    drawUndo.disabled = !n; drawClear.disabled = !n && !draw.active;
    drawHint.textContent = draw.active
      ? (n < 3 ? `Click the corners of the new building on the aerial photo (${n} placed, at least 3 needed). Corners snap to walls and boundaries.` : `${n} corners placed. Click the first (orange) corner or press Finish to close the shape. Esc also finishes.`)
      : n >= 3 ? 'Shape drawn. The checks update as you change the details below. Use Draw again to redraw it.'
      : 'Press Start drawing, then click the corners of the new building on the aerial photo.';
  };
  typeSel.addEventListener('change', () => { buildFields(); showMark(); });
  buildFields(); showMark();

  const submit = async () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const t = workTypes.find((x) => x.type === typeSel.value);
    if (t.type === 'custom_polygon' && draw.pts.length < 3) { status.textContent = 'Draw at least 3 corners on the map first.'; return; }
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
  preview = (now) => { clearTimeout(busy); if (now) submit(); else busy = setTimeout(submit, 500); }; // used while drawing

  form.append(
    el('h2', {}, 'What work are you planning?'),
    el('div', { class: 'grid' }, el('div', {}, el('label', { for: 'work-type' }, 'Type of work'), typeSel)),
    hint, drawPanel, markPanel, fieldsBox,
    el('fieldset', {}, el('legend', {}, 'Existing extension'),
      el('div', { class: 'grid' },
        el('div', {}, el('label', { for: 'exDepth' }, 'Depth of existing rear extension (m)', el('span', { class: 'hint' }, ' 0 if none')),
          el('input', { id: 'exDepth', name: 'exDepth', type: 'number', step: '0.1', min: '0', max: '20', value: existing.depthM ?? 0 })),
        el('label', { class: 'check', for: 'exInside' }, el('input', { id: 'exInside', name: 'exInside', type: 'checkbox', checked: existing.inOutline !== false ? 'checked' : null }), 'It is already inside the yellow house outline on the map'))),
    el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Show on map and check the rules'), status));

  $('#result').replaceChildren(
    el('p', { class: 'ref' }, `Draft ${app.reference} · ${app.authority?.name ? `Planning authority: ${app.authority.name}` : 'Planning authority to confirm'}`),
    el('div', { id: 'cards-area' }), el('div', { id: 'chips-area' }), form, el('div', { id: 'verdict-area' }));
  $('#result').hidden = false;
  paint(app);
}
