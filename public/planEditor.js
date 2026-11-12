/**
 * Floor-plan editor. The applicant draws the real rooms of each floor inside the house outline; the 3D view and the
 * interior checks then use those rooms instead of the generated typical layout.
 *
 * Coordinates are the interior model's: x across the house (0..W), y from the front wall (0) to the rear wall (D), metres.
 * On screen the front is at the bottom, like a site plan seen with the street below.
 *
 *   openPlanEditor(interior, { onSave(layout) -> error text | null, onUseTypical() -> error text | null })      layout = { storeys: [{ index, rooms: [{ id, name, type, poly }] }] }
 *
 * Also: Door and Window tools (click on a wall to place one, drag it along the wall), Stairs (drag a rectangle; choose the
 * direction of travel up), and a live warning when two rooms overlap.
 * Tools: Select (click a room, drag its corners or the room itself), Draw room (click corners, click the first corner,
 * Enter or double-click to finish, Esc cancels, Backspace removes the last corner), Rectangle (press, drag, release).
 * Corners snap to a 0.1 m grid and to other corners; hold Alt to place freely. Ctrl+Z / Ctrl+Y undo and redo.
 */
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { hall: '#e7e2d6', landing: '#e7e2d6', living: '#efe3c9', dining: '#efe3c9', kitchen: '#dfe9e2', kitchen_diner: '#dfe9e2', bedroom: '#dfe5f3', study: '#ebe0f0', bathroom: '#d6ebf0', utility: '#e4e4e4', porch: '#e4e4e4', storage: '#e4e4e4', garage: '#d9d9d9', garden_room: '#e1ecd0', other: '#e7e7e7' };
const GRID = 0.1, SNAP_PT = 0.25, MIN_SIDE = 0.5;
const r2 = (n) => Math.round(n * 100) / 100;
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v);
  n.append(...kids.flat().filter((x) => x != null));
  return n;
};
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
const polyArea = (p) => Math.abs(p.reduce((a, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + x1 * y2 - x2 * y1; }, 0)) / 2;
const centroid = (p) => { const b = bounds(p); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
const bounds = (p) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
const isRect = (p) => { if (p.length !== 4) return false; const b = bounds(p); return Math.abs(polyArea(p) - (b.x1 - b.x0) * (b.y1 - b.y0)) < 0.01; };
const copy = (x) => JSON.parse(JSON.stringify(x));
const pip = ([px, py], pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
/** Overlap area of two room polygons by sampling 5 cm cells (rooms that only share a wall give 0). */
const overlap = (a, b) => {
  const A = bounds(a), B = bounds(b), x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1), y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  let n = 0; for (let x = x0 + 0.025; x < x1; x += 0.05) for (let y = y0 + 0.025; y < y1; y += 0.05) if (pip([x, y], a) && pip([x, y], b)) n++;
  return Math.round(n * 0.0025 * 100) / 100;
};
const nearSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t, foot: [a[0] + t * dx, a[1] + t * dy] }; };
const OPEN_DEF = { door: { w: 0.9, sill: 0, h: 2.0 }, window: { w: 1.2, sill: 0.9, h: 1.2 } };
const MAX_RISER = 0.22;

export function openPlanEditor(interior, { onSave, onUseTypical, roomTypes = interior.roomTypes }) {
  const W = interior.W, D = interior.D;
  const nFloors = Math.max(1, interior.nStoreys);
  const typeLabel = (t) => roomTypes[t] ?? t;

  // working copy: every floor's rooms, starting from what the 3D view shows now (typical layout or an earlier drawing)
  let floors = Array.from({ length: nFloors }, (_, i) => ({
    index: i,
    rooms: interior.rooms.filter((r) => !r.isNew && !r.slopedCeiling && r.storey === i).map((r) => ({ id: r.id.replace(/[^a-z0-9-]/g, '-'), name: r.name, type: r.type, poly: copy(r.poly) })),
    openings: (interior.openings ?? []).filter((o) => o.storey === i).map((o) => ({ id: o.id, kind: o.kind, a: [...o.a], b: [...o.b], sillM: o.sillM, heightM: o.heightM, fixed: !!o.fixed })),
    stairs: (interior.stairs ?? []).filter((t) => t.storey === i).map((t) => ({ id: t.id, poly: copy(t.poly), dir: t.dir })),
  }));
  const rise = (interior.ceilingM ?? 2.4) + 0.25;                       // floor to floor, for the stair figures
  let cur = 0, tool = 'select', selId = null, selKind = 'room', drawing = [], hover = null, drag = null, status = '';
  const undo = [], redo = [];
  const snapshot = () => { undo.push(JSON.stringify(floors)); if (undo.length > 60) undo.shift(); redo.length = 0; };
  const restore = (src, dst) => { if (!src.length) return; dst.push(JSON.stringify(floors)); floors = JSON.parse(src.pop()); selId = null; selKind = 'room'; cur = Math.min(cur, floors.length - 1); render(); };
  const rooms = () => floors[cur].rooms;
  const sel = () => (selKind === 'room' ? rooms().find((r) => r.id === selId) ?? null : null);
  const selOpening = () => (selKind === 'opening' ? floors[cur].openings.find((o) => o.id === selId) ?? null : null);
  const selStair = () => (selKind === 'stair' ? floors[cur].stairs.find((t) => t.id === selId) ?? null : null);
  const uid = (p) => { const used = new Set(floors.flatMap((f) => [...f.openings, ...f.stairs].map((x) => x.id))); let n = 1; while (used.has(`${p}-${cur}-${n}`)) n++; return `${p}-${cur}-${n}`; };
  /** Walls you can put a door or window on: every room edge on this floor, plus the new work's edges as a faint guide. */
  const wallEdges = () => {
    const out = [];
    const add = (poly) => poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.5) out.push([a, b]); });
    rooms().forEach((r) => add(r.poly));
    interior.rooms.filter((q) => q.isNew && !q.slopedCeiling && q.storey === cur).forEach((q) => add(q.poly));
    return out;
  };
  const placeOnWall = (p, width, e) => {
    let best = null;
    for (const [a, b] of wallEdges()) { const n = nearSeg(p, a, b); if (n.d <= 0.45 && (!best || n.d < best.d)) best = { ...n, a, b }; }
    if (!best) return null;
    const len = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]), w = Math.min(width, len * 0.95), u = [(best.b[0] - best.a[0]) / len, (best.b[1] - best.a[1]) / len];
    let t = Math.max(w / 2, Math.min(len - w / 2, best.t * len));
    if (!e?.altKey) t = Math.round(t / 0.05) * 0.05;
    t = Math.max(w / 2, Math.min(len - w / 2, t));
    const c = [best.a[0] + u[0] * t, best.a[1] + u[1] * t];
    return { a: [r2(c[0] - u[0] * w / 2), r2(c[1] - u[1] * w / 2)], b: [r2(c[0] + u[0] * w / 2), r2(c[1] + u[1] * w / 2)] };
  };
  const stairFigures = (t) => {
    const b = bounds(t.poly), alongX = t.dir[1] === 'x', length = alongX ? b.x1 - b.x0 : b.y1 - b.y0, width = alongX ? b.y1 - b.y0 : b.x1 - b.x0;
    const steps = Math.max(2, Math.ceil(rise / MAX_RISER - 1e-9)), riser = rise / steps, going = length / (steps - 1);
    return { length, width, steps, riser, going, pitch: (Math.atan(riser / going) * 180) / Math.PI, ok: going >= 0.22 && (Math.atan(riser / going) * 180) / Math.PI <= 42 };
  };
  const overlaps = () => {
    const rs = rooms(), out = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const o = overlap(rs[i].poly, rs[j].poly); if (o > 0.05) out.push({ a: rs[i], b: rs[j], m2: o }); }
    return out;
  };
  const nextId = () => { let n = 1; const used = new Set(floors.flatMap((f) => f.rooms.map((r) => r.id))); while (used.has(`u-${cur}-${n}`)) n++; return `u-${cur}-${n}`; };

  // ---------- drawing surface ----------
  const pad = 1.6;
  const vb = { x: -pad, y: -pad, w: W + 2 * pad, h: D + 2 * pad };       // metres; y is flipped when converting
  const sy = (y) => D - y;                                                // plan y (down) from model y (front = 0 at the bottom)
  const svg = h('svg', { class: 'pe-svg', viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, role: 'application', tabindex: '0', 'aria-label': 'Floor plan. Choose a tool, then click on the plan.' });
  const toModel = (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, D - p.y];
  };
  const snap = (p, e, ignore = null) => {
    if (e?.altKey) return [r2(p[0]), r2(p[1])];
    let best = null;
    for (const f of [floors[cur]]) for (const r of f.rooms) for (const q of r.poly) {
      if (ignore && q === ignore) continue;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= SNAP_PT && (!best || d < best.d)) best = { d, q };
    }
    for (const q of [[0, 0], [W, 0], [W, D], [0, D]]) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= SNAP_PT && (!best || d < best.d)) best = { d, q }; }
    if (best) return [best.q[0], best.q[1]];
    const g = (v) => r2(Math.round(v / GRID) * GRID);
    return [g(p[0]), g(p[1])];
  };

  const draw = () => {
    const kids = [];
    // grid at 1 m, house outline, front label
    for (let x = 0; x <= Math.floor(W); x++) kids.push(h('line', { x1: x, y1: sy(0), x2: x, y2: sy(D), class: 'pe-grid' }));
    for (let y = 0; y <= Math.floor(D); y++) kids.push(h('line', { x1: 0, y1: sy(y), x2: W, y2: sy(y), class: 'pe-grid' }));
    kids.push(h('rect', { x: 0, y: 0, width: W, height: D, class: 'pe-outline' }));
    kids.push(h('text', { x: W / 2, y: D + 1.0, class: 'pe-note', 'text-anchor': 'middle' }, 'Front (street)'));
    kids.push(h('text', { x: W / 2, y: -0.7, class: 'pe-note', 'text-anchor': 'middle' }, 'Rear (garden)'));
    kids.push(h('text', { x: W / 2, y: D + 1.35, class: 'pe-note', 'text-anchor': 'middle' }, `${r2(W)} m wide x ${r2(D)} m deep`));
    // new work for this floor, shown faint and not editable
    for (const r of interior.rooms.filter((q) => q.isNew && !q.slopedCeiling && q.storey === cur)) {
      kids.push(h('polygon', { points: r.poly.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: 'pe-ghost' }));
      const c = centroid(r.poly); kids.push(h('text', { x: c[0], y: sy(c[1]), class: 'pe-ghost-t', 'text-anchor': 'middle' }, r.name));
    }
    // the floor below, faint, as a guide
    if (cur > 0) for (const r of floors[cur - 1].rooms) kids.push(h('polygon', { points: r.poly.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: 'pe-below' }));
    // rooms
    for (const r of rooms()) {
      const on = r.id === selId;
      kids.push(h('polygon', { points: r.poly.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: `pe-room${on ? ' on' : ''}`, fill: COLORS[r.type] ?? '#eee', 'data-id': r.id }));
      const c = centroid(r.poly);
      kids.push(h('text', { x: c[0], y: sy(c[1]) - 0.1, class: 'pe-name', 'text-anchor': 'middle' }, r.name || typeLabel(r.type)));
      kids.push(h('text', { x: c[0], y: sy(c[1]) + 0.35, class: 'pe-area', 'text-anchor': 'middle' }, `${Math.round(polyArea(r.poly) * 10) / 10} m²`));
    }
    // stairs, then doors and windows, on top of the rooms
    for (const t of floors[cur].stairs) {
      const b = bounds(t.poly), f = stairFigures(t), on = selKind === 'stair' && t.id === selId, alongX = t.dir[1] === 'x', sgn = t.dir[0] === '+' ? 1 : -1;
      const g = [h('polygon', { points: t.poly.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: `pe-stair${on ? ' on' : ''}${f.ok ? '' : ' bad'}`, 'data-stair': t.id })];
      for (let i = 1; i < f.steps - 1; i++) {
        const d = (i * f.length) / (f.steps - 1);
        g.push(alongX ? h('line', { x1: sgn > 0 ? b.x0 + d : b.x1 - d, y1: sy(b.y0), x2: sgn > 0 ? b.x0 + d : b.x1 - d, y2: sy(b.y1), class: 'pe-tread' }) : h('line', { x1: b.x0, y1: sy(sgn > 0 ? b.y0 + d : b.y1 - d), x2: b.x1, y2: sy(sgn > 0 ? b.y0 + d : b.y1 - d), class: 'pe-tread' }));
      }
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hl = f.length * 0.38;
      const [ax, ay, bx, by] = alongX ? [cx - sgn * hl, cy, cx + sgn * hl, cy] : [cx, cy - sgn * hl, cx, cy + sgn * hl];
      g.push(h('line', { x1: ax, y1: sy(ay), x2: bx, y2: sy(by), class: 'pe-arrow' }));
      const k = 0.2, ux = (bx - ax) / (Math.hypot(bx - ax, by - ay) || 1), uy = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1);
      g.push(h('polygon', { points: `${bx},${sy(by)} ${bx - ux * k - uy * k * 0.6},${sy(by - uy * k + ux * k * 0.6)} ${bx - ux * k + uy * k * 0.6},${sy(by - uy * k - ux * k * 0.6)}`, class: 'pe-arrowhead' }));
      g.push(h('text', { x: cx, y: sy(cy) - 0.05, class: 'pe-name', 'text-anchor': 'middle' }, 'UP'));
      kids.push(...g);
    }
    for (const o of floors[cur].openings) {
      const on = selKind === 'opening' && o.id === selId;
      kids.push(h('line', { x1: o.a[0], y1: sy(o.a[1]), x2: o.b[0], y2: sy(o.b[1]), class: `pe-open ${o.kind}${on ? ' on' : ''}${o.fixed ? ' fixed' : ''}`, 'data-open': o.id }));
    }
    if ((tool === 'door' || tool === 'window') && hover?.a) kids.push(h('line', { x1: hover.a[0], y1: sy(hover.a[1]), x2: hover.b[0], y2: sy(hover.b[1]), class: `pe-open ${tool} ghostline` }));
    // rooms that sit on top of each other
    const bad = overlaps();
    for (const o of bad) for (const r of [o.a, o.b]) kids.push(h('polygon', { points: r.poly.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: 'pe-overlap' }));
    const s = sel();
    if (s) {
      // edge lengths and corner handles on the selected room
      s.poly.forEach((a, i) => {
        const b = s.poly[(i + 1) % s.poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len >= 0.6) kids.push(h('text', { x: (a[0] + b[0]) / 2, y: sy((a[1] + b[1]) / 2) - 0.12, class: 'pe-dim', 'text-anchor': 'middle' }, `${r2(len)}`));
      });
      s.poly.forEach((q, i) => kids.push(h('circle', { cx: q[0], cy: sy(q[1]), r: 0.17, class: 'pe-handle', 'data-corner': i })));
    }
    // polygon being drawn
    if (drawing.length) {
      const pts = [...drawing, ...(hover ? [hover] : [])];
      kids.push(h('polyline', { points: pts.map(([x, y]) => `${x},${sy(y)}`).join(' '), class: 'pe-draw' }));
      drawing.forEach(([x, y], i) => kids.push(h('circle', { cx: x, cy: sy(y), r: i === 0 ? 0.22 : 0.13, class: i === 0 ? 'pe-first' : 'pe-handle' })));
      if (hover && drawing.length) { const a = drawing.at(-1), len = Math.hypot(hover[0] - a[0], hover[1] - a[1]); kids.push(h('text', { x: (a[0] + hover[0]) / 2, y: sy((a[1] + hover[1]) / 2) - 0.15, class: 'pe-dim', 'text-anchor': 'middle' }, `${r2(len)}`)); }
    }
    if ((drag?.kind === 'rect' || drag?.kind === 'stair') && drag.to) {
      const [a, b] = [drag.from, drag.to];
      kids.push(h('rect', { x: Math.min(a[0], b[0]), y: sy(Math.max(a[1], b[1])), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'pe-draw-fill' }));
      kids.push(h('text', { x: (a[0] + b[0]) / 2, y: sy((a[1] + b[1]) / 2), class: 'pe-dim', 'text-anchor': 'middle' }, `${r2(Math.abs(b[0] - a[0]))} x ${r2(Math.abs(b[1] - a[1]))}`));
    }
    svg.replaceChildren(...kids);
  };

  // ---------- pointer handling ----------
  const finishPolygon = () => {
    if (drawing.length < 3) { status = 'A room needs at least 3 corners.'; return; }
    snapshot();
    const id = nextId();
    rooms().push({ id, name: '', type: 'other', poly: drawing.map((p) => [...p]) });
    selId = id; drawing = []; hover = null; tool = 'select'; status = 'Room added. Name it on the right.'; render();
  };
  svg.addEventListener('pointerdown', (e) => {
    svg.focus();
    const p = toModel(e);
    if (tool === 'draw') {
      const q = snap(p, e);
      if (drawing.length >= 3 && Math.hypot(q[0] - drawing[0][0], q[1] - drawing[0][1]) < 0.3) return finishPolygon();
      drawing.push(q); status = 'Click the next corner. Click the first corner or press Enter to finish.'; return render();
    }
    if (tool === 'rect' || tool === 'stairs') { svg.setPointerCapture(e.pointerId); drag = { kind: tool === 'stairs' ? 'stair' : 'rect', from: snap(p, e), to: null }; return; }
    if (tool === 'door' || tool === 'window') {
      const spot = placeOnWall(p, OPEN_DEF[tool].w, e);
      if (!spot) { status = 'Click on a wall (a room edge) to place it.'; return render(); }
      snapshot(); const kind = tool, id = uid(kind === 'door' ? 'd' : 'w');
      floors[cur].openings.push({ id, kind, ...spot, sillM: OPEN_DEF[kind].sill, heightM: OPEN_DEF[kind].h, fixed: false });
      selKind = 'opening'; selId = id; tool = 'select'; hover = null; status = `${kind === 'door' ? 'Door' : 'Window'} placed. Drag it along the wall, or change its size on the right.`; return render();
    }
    // select tool: a corner handle of the selected room, else a room (move), else nothing
    const corner = e.target.getAttribute?.('data-corner');
    if (corner != null && sel()) { svg.setPointerCapture(e.pointerId); snapshot(); drag = { kind: 'corner', room: sel(), i: Number(corner) }; return; }
    const oid = e.target.getAttribute?.('data-open'), sid = e.target.getAttribute?.('data-stair');
    if (oid) { const o = floors[cur].openings.find((q) => q.id === oid); if (o) { selKind = 'opening'; selId = oid; svg.setPointerCapture(e.pointerId); drag = { kind: 'slide', o, pushed: false }; return render(); } }
    if (sid) { const t = floors[cur].stairs.find((q) => q.id === sid); if (t) { selKind = 'stair'; selId = sid; svg.setPointerCapture(e.pointerId); drag = { kind: 'movestair', t, from: p, orig: copy(t.poly), pushed: false }; return render(); } }
    const id = e.target.getAttribute?.('data-id');
    const found = id ? rooms().find((r) => r.id === id) : null;
    selKind = 'room'; selId = found?.id ?? null;
    if (found) { svg.setPointerCapture(e.pointerId); drag = { kind: 'move', room: found, from: p, orig: copy(found.poly), pushed: false }; }
    render();
  });
  svg.addEventListener('pointermove', (e) => {
    const p = toModel(e);
    if (tool === 'draw') { hover = snap(p, e); return draw(); }
    if (tool === 'door' || tool === 'window') { hover = placeOnWall(p, OPEN_DEF[tool].w, e); return draw(); }
    if (!drag) return;
    if (drag.kind === 'slide') {
      if (!drag.pushed) { snapshot(); drag.pushed = true; }
      const w = Math.hypot(drag.o.b[0] - drag.o.a[0], drag.o.b[1] - drag.o.a[1]), spot = placeOnWall(p, w, e);
      if (spot) { drag.o.a = spot.a; drag.o.b = spot.b; } return render(true);
    }
    if (drag.kind === 'movestair') {
      if (!drag.pushed) { snapshot(); drag.pushed = true; }
      const dx = Math.round((p[0] - drag.from[0]) / GRID) * GRID, dy = Math.round((p[1] - drag.from[1]) / GRID) * GRID;
      drag.t.poly = drag.orig.map(([x, y]) => [r2(x + dx), r2(y + dy)]); return render(true);
    }
    if (drag.kind === 'stair') { drag.to = snap(p, e); return draw(); }
    if (drag.kind === 'rect') { drag.to = snap(p, e); return draw(); }
    if (drag.kind === 'corner') {
      const q = drag.room.poly[drag.i]; const n = snap(p, e, q);
      drag.room.poly[drag.i] = n; return render(true);
    }
    if (drag.kind === 'move') {
      if (!drag.pushed) { snapshot(); drag.pushed = true; }
      const dx = Math.round((p[0] - drag.from[0]) / GRID) * GRID, dy = Math.round((p[1] - drag.from[1]) / GRID) * GRID;
      drag.room.poly = drag.orig.map(([x, y]) => [r2(x + dx), r2(y + dy)]); return render(true);
    }
  });
  const endDrag = () => {
    if (drag?.kind === 'rect' && drag.to) {
      const [a, b] = [drag.from, drag.to];
      if (Math.abs(b[0] - a[0]) >= MIN_SIDE && Math.abs(b[1] - a[1]) >= MIN_SIDE) {
        snapshot();
        const id = nextId();
        rooms().push({ id, name: '', type: 'other', poly: [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]] });
        selId = id; tool = 'select'; status = 'Room added. Name it on the right.';
      } else status = 'Drag a bigger rectangle (at least 0.5 m each way).';
    }
    if (drag?.kind === 'stair' && drag.to) {
      const [a, b] = [drag.from, drag.to], w = Math.abs(b[0] - a[0]), l = Math.abs(b[1] - a[1]);
      if (w >= 0.5 && l >= 0.5) {
        snapshot(); const id = uid('s');
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        floors[cur].stairs.push({ id, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dir: l >= w ? '+y' : '+x' });
        selKind = 'stair'; selId = id; tool = 'select'; status = 'Stair added. Pick which way it climbs on the right.';
      } else status = 'Drag a bigger rectangle for the stair (at least 0.5 m each way).';
    }
    drag = null; render();
  };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', () => { if (tool === 'draw') { drawing.pop(); finishPolygon(); } });
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tool === 'draw') { e.preventDefault(); finishPolygon(); }
    else if (e.key === 'Escape') { drawing = []; hover = null; drag = null; tool = 'select'; render(); }
    else if (e.key === 'Backspace' && tool === 'draw') { e.preventDefault(); drawing.pop(); render(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (sel() || selOpening() || selStair())) { e.preventDefault(); removeSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(undo, redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); }
  });

  const removeSelected = () => {
    if (!sel() && !selOpening() && !selStair()) return;
    snapshot();
    if (selKind === 'room') floors[cur].rooms = rooms().filter((r) => r.id !== selId);
    else if (selKind === 'opening') floors[cur].openings = floors[cur].openings.filter((o) => o.id !== selId);
    else floors[cur].stairs = floors[cur].stairs.filter((t) => t.id !== selId);
    selId = null; selKind = 'room'; render();
  };

  // ---------- side panel ----------
  const panel = el('div', { class: 'pe-side' });
  const floorTabs = el('div', { class: 'pe-tabs', role: 'tablist', 'aria-label': 'Floor' });
  const msg = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const form = el('div', { class: 'pe-form' });
  const list = el('ul', { class: 'room-list' });
  const toolBtns = {};
  const toolBtn = (k, label, tip) => (toolBtns[k] = el('button', { type: 'button', class: 'ghost small', title: tip, 'aria-pressed': 'false', onclick: () => { tool = k; drawing = []; hover = null; drag = null; status = { select: 'Click a room to select it. Drag its corners or the room itself.', draw: 'Click each corner of the room. Click the first corner or press Enter to finish.', rect: 'Press where one corner goes, drag to the opposite corner, release.', door: 'Move over a wall and click to place a door.', window: 'Move over a wall and click to place a window.', stairs: 'Drag a rectangle where the stair goes, then pick which way it climbs.' }[k]; render(); svg.focus(); } }, label));

  const numField = (label, val, min, max, step, apply) => el('div', {}, el('label', {}, label), el('input', { type: 'number', step, min, max, value: r2(val), onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max) { snapshot(); apply(v); render(); } } }));
  const openingForm = (o) => {
    const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]), d = OPEN_DEF[o.kind];
    const setWidth = (w) => { const c = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], u = [(o.b[0] - o.a[0]) / len, (o.b[1] - o.a[1]) / len]; o.a = [r2(c[0] - u[0] * w / 2), r2(c[1] - u[1] * w / 2)]; o.b = [r2(c[0] + u[0] * w / 2), r2(c[1] + u[1] * w / 2)]; };
    return el('div', {},
      el('h4', {}, o.kind === 'door' ? 'Door' : 'Window'),
      el('div', { class: 'grid' }, numField('Width (m)', len, 0.3, 6, '0.05', setWidth), numField('Height (m)', o.heightM ?? d.h, 0.3, 2.6, '0.05', (v) => { o.heightM = v; }),
        o.kind === 'window' ? numField('Sill above floor (m)', o.sillM ?? d.sill, 0, 2.5, '0.05', (v) => { o.sillM = v; }) : null),
      o.kind === 'window' ? el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.fixed ? 'checked' : null, onchange: (e) => { snapshot(); o.fixed = e.target.checked; render(); } }), ' Fixed (does not open)') : null,
      el('p', { class: 'hint' }, 'Drag it along the wall to move it.'),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'ghost small', onclick: removeSelected }, `Delete ${o.kind}`)));
  };
  const stairForm = (t) => {
    const f = stairFigures(t), b = bounds(t.poly), alongX = t.dir[1] === 'x';
    const dirSel = el('select', { 'aria-label': 'Direction up', onchange: (e) => { snapshot(); t.dir = e.target.value; render(); } },
      [['+y', 'Up towards the rear'], ['-y', 'Up towards the front'], ['+x', 'Up towards the right'], ['-x', 'Up towards the left']].map(([v, l]) => el('option', { value: v, selected: v === t.dir ? 'selected' : null }, l)));
    return el('div', {},
      el('h4', {}, 'Stair up to the next floor'),
      el('div', { class: 'grid' }, el('div', {}, el('label', {}, 'Direction'), dirSel),
        numField('Length (m)', f.length, 0.5, 8, '0.05', (v) => { t.poly = alongX ? [[b.x0, b.y0], [b.x0 + v, b.y0], [b.x0 + v, b.y1], [b.x0, b.y1]] : [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y0 + v], [b.x0, b.y0 + v]]; }),
        numField('Width (m)', f.width, 0.5, 3, '0.05', (v) => { t.poly = alongX ? [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y0 + v], [b.x0, b.y0 + v]] : [[b.x0, b.y0], [b.x0 + v, b.y0], [b.x0 + v, b.y1], [b.x0, b.y1]]; })),
      el('p', { class: f.ok ? 'hint' : 'hint pe-warn' }, `${f.steps} steps of ${Math.round(f.riser * 1000)} mm rise and ${Math.round(f.going * 1000)} mm going, ${Math.round(f.pitch)}° pitch.${f.ok ? '' : ' Too steep: lengthen it (steps should be at least 220 mm deep and the pitch no more than 42°).'}`),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'ghost small', onclick: removeSelected }, 'Delete stair')));
  };
  const roomForm = () => {
    const so = selOpening(), st = selStair();
    if (so) return openingForm(so);
    if (st) return stairForm(st);
    const s = sel();
    if (!s) return el('p', { class: 'hint' }, rooms().length ? 'Select a room to name it or change its size.' : 'This floor has no rooms yet. Choose Draw room or Rectangle, then click on the plan.');
    const b = bounds(s.poly), rect = isRect(s.poly);
    const name = el('input', { value: s.name, maxlength: '40', placeholder: typeLabel(s.type), 'aria-label': 'Room name', oninput: (e) => { s.name = e.target.value; draw(); } });
    name.addEventListener('change', () => { snapshot(); renderList(); });
    const type = el('select', { 'aria-label': 'Room use', onchange: (e) => { snapshot(); s.type = e.target.value; render(); } }, Object.entries(roomTypes).map(([k, v]) => el('option', { value: k, selected: k === s.type ? 'selected' : null }, v)));
    const dim = (label, val, apply) => el('div', {}, el('label', {}, label), el('input', { type: 'number', step: '0.05', min: '0.5', value: r2(val), onchange: (e) => { const v = Number(e.target.value); if (v >= MIN_SIDE) { snapshot(); apply(v); render(); } } }));
    return el('div', {},
      el('div', { class: 'grid' }, el('div', {}, el('label', {}, 'Name'), name), el('div', {}, el('label', {}, 'Used as'), type)),
      rect ? el('div', { class: 'grid' }, dim('Width (m)', b.x1 - b.x0, (v) => { s.poly = [[b.x0, b.y0], [b.x0 + v, b.y0], [b.x0 + v, b.y1], [b.x0, b.y1]]; }), dim('Depth (m)', b.y1 - b.y0, (v) => { s.poly = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y0 + v], [b.x0, b.y0 + v]]; })) : el('p', { class: 'hint' }, 'Drag the corners to change the shape. The numbers beside each wall are its length in metres.'),
      el('p', { class: 'hint' }, `${Math.round(polyArea(s.poly) * 10) / 10} m² on this floor.`),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'ghost small', onclick: removeSelected }, 'Delete room')));
  };
  const renderList = () => list.replaceChildren(...rooms().map((r) => el('li', {}, el('button', { type: 'button', class: 'room-btn', 'aria-pressed': String(r.id === selId), onclick: () => { selId = r.id; selKind = 'room'; tool = 'select'; render(); } }, r.name || typeLabel(r.type), el('span', {}, `${Math.round(polyArea(r.poly) * 10) / 10} m²`)))));

  const copyUp = () => {
    if (cur + 1 >= 4) return;
    snapshot();
    if (!floors[cur + 1]) floors.push({ index: cur + 1, rooms: [], openings: [], stairs: [] });
    floors[cur + 1].rooms = rooms().map((r) => ({ ...copy(r), id: r.id.replace(/^u-\d+-/, `u-${cur + 1}-`) }));
    floors[cur + 1].openings = floors[cur].openings.map((o, i) => ({ ...copy(o), id: `${o.id.split('-')[0]}-${cur + 1}-${i + 1}` }));
    cur += 1; selId = null; selKind = 'room'; status = `Copied to floor ${cur + 1}. Edit it to match.`; render();
  };
  const render = (light = false) => {
    draw();
    if (light) return;
    for (const [k, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(k === tool));
    floorTabs.replaceChildren(...[...floors.map((f, i) => el('button', { type: 'button', role: 'tab', class: 'ghost small', 'aria-selected': String(i === cur), onclick: () => { cur = i; selId = null; selKind = 'room'; drawing = []; render(); } }, i === 0 ? 'Ground' : `Floor ${i}`)),
      floors.length < 4 ? el('button', { type: 'button', class: 'ghost small', title: 'Add a floor above', onclick: () => { snapshot(); floors.push({ index: floors.length, rooms: [], openings: [], stairs: [] }); cur = floors.length - 1; selId = null; selKind = 'room'; render(); } }, '+ Floor') : null,
      floors.length > 1 && cur === floors.length - 1 ? el('button', { type: 'button', class: 'ghost small', title: 'Remove this top floor', onclick: () => { snapshot(); floors.pop(); cur = floors.length - 1; selId = null; selKind = 'room'; render(); } }, '− Floor') : null].filter(Boolean));
    const bad = overlaps();
    msg.textContent = bad.length ? `${bad[0].a.name || typeLabel(bad[0].a.type)} and ${bad[0].b.name || typeLabel(bad[0].b.type)} overlap by ${bad[0].m2} m² (shown in red). Move or resize one of them.${bad.length > 1 ? ` ${bad.length - 1} more overlap.` : ''}` : status;
    msg.className = bad.length ? 'hint pe-warn' : 'hint';
    form.replaceChildren(roomForm());
    renderList();
  };

  // ---------- modal shell ----------
  const close = () => { document.removeEventListener('keydown', escClose); overlay.remove(); document.body.classList.remove('modal-open'); opener?.focus(); };
  const escClose = (e) => { if (e.key === 'Escape' && document.activeElement !== svg) close(); };
  const opener = document.activeElement;
  const save = async () => {
    const empty = floors.findIndex((f) => !f.rooms.length);
    if (empty >= 0 && empty < floors.length - 1) { status = `Floor ${empty === 0 ? 'Ground' : empty} has no rooms: draw some, or remove the floor above it.`; return render(); }
    const clash = floors.flatMap((f, i) => { const rs = f.rooms, out = []; for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) if (overlap(rs[a].poly, rs[b].poly) > 0.05) out.push(i); return out; });
    if (clash.length) { cur = clash[0]; selId = null; selKind = 'room'; status = ''; return render(); }
    const used = floors.filter((f) => f.rooms.length);
    if (!used.length) { status = 'Draw at least one room first.'; return render(); }
    status = 'Saving…'; render(true); msg.textContent = status;
    const err = await onSave({ storeys: used.map((f) => ({
      index: f.index,
      rooms: f.rooms.map((r) => ({ id: r.id, name: r.name.trim(), type: r.type, poly: r.poly.map(([x, y]) => [r2(x), r2(y)]) })),
      openings: f.openings.map((o) => ({ id: o.id, kind: o.kind, a: o.a, b: o.b, sillM: o.sillM, heightM: o.heightM, ...(o.fixed ? { fixed: true } : {}) })),
      stairs: f.stairs.map((t) => ({ id: t.id, poly: t.poly, dir: t.dir })),
    })) });
    if (err) { status = err; render(); } else close();
  };

  panel.append(
    el('div', { class: 'pe-tools', role: 'group', 'aria-label': 'Tools' }, toolBtn('select', 'Select', 'Select and move rooms or corners'), toolBtn('draw', 'Draw room', 'Click each corner'), toolBtn('rect', 'Rectangle', 'Drag a rectangle'), toolBtn('door', 'Door', 'Click a wall to add a door'), toolBtn('window', 'Window', 'Click a wall to add a window'), toolBtn('stairs', 'Stairs', 'Drag a rectangle for the stair'),
      el('button', { type: 'button', class: 'ghost small', onclick: () => restore(undo, redo) }, 'Undo'), el('button', { type: 'button', class: 'ghost small', onclick: () => restore(redo, undo) }, 'Redo')),
    msg, form, el('h4', {}, 'Rooms on this floor'), list,
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'ghost small', onclick: copyUp, title: 'Copy these rooms to the floor above' }, 'Copy to floor above')));

  const box = el('div', { class: 'modal-box pe-box' },
    el('div', { class: 'modal-bar' }, el('strong', {}, 'Draw your floor plan'), floorTabs,
      el('span', { class: 'zoom-btns' },
        onUseTypical ? el('button', { type: 'button', class: 'ghost', onclick: async () => { const err = await onUseTypical(); if (err) { status = err; render(); } else close(); } }, 'Use typical layout') : null,
        el('button', { type: 'button', class: 'ghost', onclick: close }, 'Cancel'), el('button', { type: 'button', onclick: save }, 'Save floor plan'))),
    el('div', { class: 'pe-main' }, el('div', { class: 'pe-canvas' }, svg), panel),
    el('p', { class: 'note' }, 'Walls are drawn at the room edges. Add doors and windows by clicking a wall, and stairs by dragging a rectangle. Corners snap to a 0.1 m grid and to each other; hold Alt to place a corner freely. Ctrl+Z undoes.'));
  const overlay = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Floor plan editor' }, box);
  document.body.append(overlay); document.body.classList.add('modal-open');
  document.addEventListener('keydown', escClose);
  render(); svg.focus();
  return { close };
}
