/**
 * Inside-the-home 3D viewer. No libraries and no network: plain canvas, an orthographic orbit camera and a
 * painter's-algorithm draw (the page's content-security policy only allows scripts from this server, and a
 * house is a few hundred flat polygons, so this is plenty).
 *
 * Model coordinates (from the server's interior model): x across the house, y front (0) to rear (D), z up, metres.
 * The viewer re-centres them on the house, so the camera orbits the middle of the building.
 *
 *   const v = createViewer(canvas, interior, { onSelect(room|null) });
 *   v.set({ storey: 'all' | n, roof: bool, cut: bool, exploded: bool, surroundings: bool, existingOnly: bool });
 *   v.view('front' | 'rear' | 'top' | 'reset');   v.select(roomId);   v.update(interior);   v.destroy();
 */
const COLORS = {
  floor: { hall: '#e7e2d6', landing: '#e7e2d6', living: '#efe3c9', dining: '#efe3c9', kitchen: '#dfe9e2', kitchen_diner: '#dfe9e2', bedroom: '#dfe5f3', study: '#ebe0f0', bathroom: '#d6ebf0', utility: '#e4e4e4', porch: '#e4e4e4', storage: '#e4e4e4', garage: '#d9d9d9', garden_room: '#e1ecd0', other: '#e7e7e7' },
  newFloor: '#ffd9b8', newWall: '#f4a261', wall: '#f2efe9', roof: '#b4573d', roofNew: '#d9763a', slab: '#cfc9bd', door: '#8a5a3a', window: '#bfe3f5', tread: '#dcc6a4', riser: '#b99c78', ground: '#e9f1df', plot: '#dfeccf', neighbour: '#c9ccd6', dormer: '#e07a3f', select: '#2f54d6',
};
const LIGHT = norm([-0.45, -0.55, 0.7]);

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function shade(hex, f, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(clamp(x * f, 0, 255)));
  return alpha < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const PRESETS = { front: { yaw: 0, pitch: 16 }, rear: { yaw: 180, pitch: 16 }, top: { yaw: 0, pitch: 88 } };
/** The first view looks at the new work: from the back for rear work, from the side for side work, from the front for a porch. */
function homeView(m) {
  const k = m?.proposal?.kind, side = m?.proposal?.side === 'left' ? -1 : 1;
  if (['rear_extension', 'rear_dormer', 'outbuilding', 'custom_polygon'].includes(k)) return { yaw: 156, pitch: 42 };
  if (k === 'wraparound_extension') return { yaw: side > 0 ? 140 : 220, pitch: 42 };
  if (k === 'side_extension') return { yaw: side * 48, pitch: 40 };
  if (k === 'front_porch') return { yaw: 22, pitch: 34 };
  return { yaw: 28, pitch: 40 };
}

export function createViewer(canvas, interior, { onSelect = () => {}, initial = null } = {}) {
  const ctx = canvas.getContext('2d');
  let model = interior;
  const cam = { ...homeView(model), zoom: 1, ...(initial?.cam ?? {}) };
  const opt = { storey: 'all', roof: false, cut: true, exploded: false, surroundings: true, existingOnly: false, ...(initial?.opt ?? {}) };
  let selected = null, faces = [], dpr = 1, W = 300, H = 300, raf = 0;

  const centre = () => [model.W / 2, model.D / 2, 0];
  const basis = () => {
    const ψ = (cam.yaw * Math.PI) / 180, φ = (cam.pitch * Math.PI) / 180;
    const f = [-Math.sin(ψ) * Math.cos(φ), Math.cos(ψ) * Math.cos(φ), -Math.sin(φ)];
    const r = [Math.cos(ψ), Math.sin(ψ), 0];
    const u = cross(r, f);
    return { f, r, u };
  };

  /** Which storeys are drawn, and how high each is lifted when exploded. */
  const topShown = () => {
    const max = Math.max(...model.storeys.map((s) => s.index));
    return opt.storey === 'all' ? max : Math.min(Number(opt.storey), max);
  };
  const lift = (storey) => (opt.exploded ? storey * 1.6 : 0);

  function build() {
    const out = [];
    const c = centre();
    const P = (x, y, z) => [x - c[0], y - c[1], z];
    const top = topShown(), showAll = opt.storey === 'all';
    const roofOn = opt.roof && showAll;                           // a roof over a single selected floor would hide it
    const rooms = model.rooms.filter((r) => r.storey <= top && !(opt.existingOnly && r.isNew));
    const byStorey = new Map();
    for (const r of rooms) { if (!byStorey.has(r.storey)) byStorey.set(r.storey, []); byStorey.get(r.storey).push(r); }

    const face = (layer, pts, fill, extra = {}) => out.push({ layer, pts, fill, ...extra });
    const quad = (layer, a, b, z0, z1, base, extra = {}) => {
      const pts = [P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1)];
      face(layer, pts, base, { wall: true, ...extra });
    };

    // ground, plot and neighbours
    const reach = Math.max(model.W, model.D) * 1.6;
    face(0, [P(-reach + model.W / 2, -reach + model.D / 2, -0.06), P(reach + model.W / 2, -reach + model.D / 2, -0.06), P(reach + model.W / 2, reach + model.D / 2, -0.06), P(-reach + model.W / 2, reach + model.D / 2, -0.06)], COLORS.ground, { flat: true, ground: true });
    if (opt.surroundings) {
      for (const p of model.context?.plot ?? []) face(0.1, p.map(([x, y]) => P(x, y, -0.04)), COLORS.plot, { flat: true, stroke: '#d62f2f', strokeW: 1.6, ground: true });
    }

    const nbFaces = [];
    if (opt.surroundings) {
      for (const p of model.context?.neighbours ?? []) {
        const h = 5.2, n = p.length;
        const mid = p.reduce((a, q) => [a[0] + q[0] / n, a[1] + q[1] / n], [0, 0]);
        const faces6 = [];
        for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; faces6.push({ pts: [P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], h), P(a[0], a[1], h)], wall: true }); }
        faces6.push({ pts: p.map(([x, y]) => P(x, y, h)), flat: true });
        nbFaces.push({ mid: P(mid[0], mid[1], 2), faces: faces6 });
      }
    }

    const wallHeightOf = (r) => r.ceilingM + (r.isNew && r.storey === 0 && r.id !== 'new-porch' ? 0.35 : 0.25);
    const near = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); };
    // a room is "exposed" when no visible room sits above it (so, with the roof off, it is open to the sky)
    const exposed = (r) => !rooms.some((o) => o.storey > r.storey && pointInPoly(o.centre, r.poly));
    const inMainBlock = (r) => r.poly.every(([x, y]) => x >= -0.01 && x <= model.W + 0.01 && y >= -0.01 && y <= model.D + 0.01);
    // storeys, bottom to top: floor, then walls
    const cutH = 1.15;
    for (const [s, list] of [...byStorey.entries()].sort((a, b) => a[0] - b[0])) {
      const L = 10 + s * 10;
      const z = (r) => r.z0 + lift(s);
      const isTop = s === top;
      for (const r of list) {
        if (r.slopedCeiling) {                                    // loft: a floor under the roof; the roof (or the cut-away) shows the rest
          face(L, r.poly.map(([x, y]) => P(x, y, z(r) + 0.02)), r.isNew ? COLORS.newFloor : COLORS.floor.other, { flat: true, roomId: r.id, floor: true, isNew: r.isNew, stroke: 'rgba(0,0,0,.35)' });
          continue;
        }
        const base = r.isNew ? COLORS.newFloor : COLORS.floor[r.type] ?? COLORS.floor.other;
        face(L, r.poly.map(([x, y]) => P(x, y, z(r) + 0.02)), base, { flat: true, roomId: r.id, floor: true, isNew: r.isNew, stroke: 'rgba(0,0,0,.30)' });
      }
      // walls, each shared edge once
      const seen = new Set(), walls = [];
      for (const r of list) {
        if (r.slopedCeiling) continue;
        const wallH = wallHeightOf(r);
        const h = opt.cut && !roofOn && exposed(r) ? Math.min(wallH, cutH) : wallH;
        r.poly.forEach((a, i) => {
          const b = r.poly[(i + 1) % r.poly.length];
          const k = [a, b].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).sort().join('|') + `@${s}`;
          if (seen.has(k)) return; seen.add(k);
          walls.push({ a, b, z0: z(r), z1: z(r) + h, isNew: r.isNew });
        });
      }
      walls.forEach((w) => quad(L + 1, w.a, w.b, w.z0, w.z1, w.isNew ? COLORS.newWall : COLORS.wall, { stroke: 'rgba(40,30,20,.55)', isNew: w.isNew, mid: P((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, (w.z0 + w.z1) / 2) }));
      // doors and windows sit on their wall and share its draw order (so they never show through a nearer wall)
      for (const o of (model.openings ?? []).filter((q) => q.storey === s)) {
        const room = list.find((r) => o.roomIds.includes(r.id));
        if (!room || room.slopedCeiling) continue;
        const wallH = wallHeightOf(room), hMax = opt.cut && !roofOn && exposed(room) ? Math.min(wallH, cutH) : wallH;
        const zb = z(room) + o.sillM, zt = Math.min(z(room) + o.headM, z(room) + hMax);
        if (zt - zb < 0.05) continue;
        const host = walls.find((w) => near(o.a, w.a, w.b) < 0.13 && near(o.b, w.a, w.b) < 0.13);
        const pts = [P(o.a[0], o.a[1], zb), P(o.b[0], o.b[1], zb), P(o.b[0], o.b[1], zt), P(o.a[0], o.a[1], zt)];
        face(L + 1, pts, o.kind === 'door' ? COLORS.door : COLORS.window, { wall: true, stroke: o.kind === 'door' ? '#4a2c18' : '#3b6f8c', strokeW: 1.4, bias: -0.04, keyPt: host ? P((host.a[0] + host.b[0]) / 2, (host.a[1] + host.b[1]) / 2, (host.z0 + host.z1) / 2) : null, opening: true });
      }
      // stairs rising from this floor: risers and treads
      for (const t of (model.stairs ?? []).filter((q) => q.storey === s)) {
        const base = (model.storeys[s]?.z0 ?? 0) + lift(s), b = t.box, sgn = t.dir[0] === '+' ? 1 : -1, alongX = t.dir[1] === 'x';
        const g = t.lengthM / (t.steps - 1), rs = t.riserM;
        const at = (d, w, z) => alongX ? P((sgn > 0 ? b.x0 : b.x1) + sgn * d, w, z) : P(w, (sgn > 0 ? b.y0 : b.y1) + sgn * d, z);
        const w0 = alongX ? b.y0 : b.x0, w1 = alongX ? b.y1 : b.x1;
        for (let i = 0; i < t.steps; i++) {
          const d = i * g;
          face(L + 1, [at(d, w0, base + i * rs), at(d, w1, base + i * rs), at(d, w1, base + (i + 1) * rs), at(d, w0, base + (i + 1) * rs)], COLORS.riser, { wall: true, stroke: 'rgba(60,40,20,.5)', stair: true });
          if (i < t.steps - 1) face(L + 1, [at(d, w0, base + (i + 1) * rs), at(d, w1, base + (i + 1) * rs), at(d + g, w1, base + (i + 1) * rs), at(d + g, w0, base + (i + 1) * rs)], COLORS.tread, { flat: true, stroke: 'rgba(60,40,20,.5)', stair: true });
        }
      }
      // flat roofs over extension rooms (outside the main block) that have nothing above them; the main block has its own roof below
      if (roofOn) {
        for (const r of list) {
          if (r.slopedCeiling || inMainBlock(r) || !exposed(r)) continue;
          const zt = z(r) + r.ceilingM + (r.storey === 0 && r.isNew ? 0.35 : 0.25);
          face(L + 5, r.poly.map(([x, y]) => P(x, y, zt)), r.isNew ? COLORS.roofNew : COLORS.slab, { flat: true, stroke: 'rgba(40,30,20,.55)', isNew: r.isNew });
        }
      }
    }

    // main roof: the ridge runs across the house, so the slopes face the front and the rear
    if (roofOn && model.roof) {
      const R = model.roof, e = R.eavesM + lift(model.nStoreys - 1), rz = R.ridgeM + lift(model.nStoreys - 1);
      const raised = model.proposal?.kind === 'additional_storey';
      const col = raised ? COLORS.roofNew : COLORS.roof;
      const w = model.W, d = model.D, mid = d / 2;
      if (R.type === 'flat') {
        face(60, [P(0, 0, e), P(w, 0, e), P(w, d, e), P(0, d, e)], COLORS.slab, { flat: true, stroke: 'rgba(40,30,20,.6)' });
      } else {
        const hip = R.type === 'hipped' ? Math.min(mid, w / 2) : 0;
        const x0 = hip, x1 = w - hip;
        face(60, [P(0, 0, e), P(w, 0, e), P(x1, mid, rz), P(x0, mid, rz)], col, { roof: true, stroke: 'rgba(40,30,20,.6)' });
        face(60, [P(0, d, e), P(w, d, e), P(x1, mid, rz), P(x0, mid, rz)], col, { roof: true, stroke: 'rgba(40,30,20,.6)' });
        face(60, [P(0, 0, e), P(0, d, e), P(x0, mid, rz)], hip ? col : COLORS.wall, { roof: true, stroke: 'rgba(40,30,20,.6)' });
        face(60, [P(w, 0, e), P(w, d, e), P(x1, mid, rz)], hip ? col : COLORS.wall, { roof: true, stroke: 'rgba(40,30,20,.6)' });
      }
      // dormer: a box on the rear slope
      const dm = model.loft?.dormer;
      if (dm && !opt.existingOnly) {
        const zb = model.loft.floorAboveGroundM + lift(model.nStoreys), zt = zb + dm.heightM + 0.3, y0 = dm.y0, y1 = d;
        const A = [dm.x0, y0], B = [dm.x1, y0], C = [dm.x1, y1], D2 = [dm.x0, y1];
        face(62, [P(...C, zb), P(...D2, zb), P(...D2, zt), P(...C, zt)], COLORS.dormer, { wall: true, stroke: 'rgba(40,30,20,.7)', isNew: true });
        face(62, [P(...A, zb), P(...D2, zb), P(...D2, zt), P(...A, zt)], COLORS.dormer, { wall: true, stroke: 'rgba(40,30,20,.7)', isNew: true });
        face(62, [P(...B, zb), P(...C, zb), P(...C, zt), P(...B, zt)], COLORS.dormer, { wall: true, stroke: 'rgba(40,30,20,.7)', isNew: true });
        face(63, [P(...A, zt), P(...B, zt), P(...C, zt), P(...D2, zt)], '#c9b8a8', { flat: true, stroke: 'rgba(40,30,20,.7)', isNew: true });
      }
    }
    return { out, nbFaces };
  }

  function draw() {
    raf = 0;
    const { out, nbFaces } = build();
    const { f, r, u } = basis();
    // fit: scale so the whole building (plus any extension) fits the canvas at zoom 1
    const pts = model.rooms.flatMap((q) => q.poly.map(([x, y]) => [x - model.W / 2, y - model.D / 2]));
    const radius = Math.max(model.W, model.D) * 0.5 + Math.max(0, ...pts.map(([x, y]) => Math.hypot(x, y) - Math.max(model.W, model.D) * 0.5)) + 3;
    const scale = (Math.min(W, H) / (2.1 * radius)) * cam.zoom;
    const proj = (p) => [W / 2 + dot(p, r) * scale, H / 2 + 8 - dot(p, u) * scale + Math.min(40, H * 0.05)];
    const depth = (p) => dot(p, f);

    // neighbours behind the house are drawn before it, those in front after it
    const behind = [], infront = [];
    for (const n of nbFaces) (depth(n.mid) >= 0 ? behind : infront).push(...n.faces.map((fc) => ({ ...fc, fill: COLORS.neighbour, alpha: 0.2, layer: depth(n.mid) >= 0 ? 5 : 80, stroke: 'rgba(60,60,80,.30)', neighbour: true })));
    const all = [...out, ...behind, ...infront];
    for (const fc of all) {
      fc.cen = fc.pts.reduce((a, p) => [a[0] + p[0] / fc.pts.length, a[1] + p[1] / fc.pts.length, a[2] + p[2] / fc.pts.length], [0, 0, 0]);
      fc.d = depth(fc.keyPt ?? fc.cen) + (fc.bias ?? 0);
    }
    all.sort((a, b) => a.layer - b.layer || b.d - a.d);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    faces = [];
    for (const fc of all) {
      const sp = fc.pts.map(proj);
      let k = 1;
      if (!fc.flat || fc.roof) {
        let n = norm(cross(sub(fc.pts[1], fc.pts[0]), sub(fc.pts[2], fc.pts[0])));
        const l = dot(n, LIGHT);
        k = 0.62 + 0.42 * Math.abs(l);
      } else k = fc.ground ? 1 : 0.98;
      ctx.beginPath();
      sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = shade(fc.fill, k, fc.alpha);
      ctx.fill();
      if (fc.stroke) { ctx.strokeStyle = fc.stroke; ctx.lineWidth = fc.strokeW ?? 1; ctx.stroke(); }
      if (fc.floor) faces.push({ roomId: fc.roomId, sp });
    }

    // selected room outline + labels
    const rooms = model.rooms.filter((q) => q.storey <= topShown() && !(opt.existingOnly && q.isNew));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const roofShown = opt.roof && opt.storey === 'all';
    for (const q of rooms) {
      const z = q.z0 + lift(q.storey) + (q.slopedCeiling ? 0.05 : 0.05);
      const sp = q.poly.map(([x, y]) => proj([x - model.W / 2, y - model.D / 2, z]));
      if (q.id === selected) {
        ctx.beginPath(); sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        ctx.strokeStyle = COLORS.select; ctx.lineWidth = 3; ctx.stroke();
      }
      // only label rooms on the top drawn floor, or new rooms: lower floors are hidden underneath
      if (roofShown || !(q.storey === topShown() || q.isNew)) continue;
      const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
      const wpx = Math.max(...xs) - Math.min(...xs), hpx = Math.max(...ys) - Math.min(...ys);
      if (wpx < 46 || hpx < 16) continue;
      const [cx, cy] = proj([q.centre[0] - model.W / 2, q.centre[1] - model.D / 2, z + 0.02]);
      ctx.font = `600 ${q.isNew ? 12 : 11}px system-ui, sans-serif`;
      const label = `${q.name}`, sub2 = `${q.areaM2} m²`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = q.isNew ? '#7a2e00' : '#243056';
      ctx.strokeText(label, cx, cy - 6); ctx.fillText(label, cx, cy - 6);
      ctx.font = '400 11px system-ui, sans-serif'; ctx.strokeText(sub2, cx, cy + 8); ctx.fillText(sub2, cx, cy + 8);
    }
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const resize = () => {
    const b = canvas.getBoundingClientRect();
    W = Math.max(200, Math.round(b.width)); H = Math.max(200, Math.round(b.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    schedule();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);

  // ---- input: drag = orbit, wheel / pinch = zoom, click = select a room, arrows / + / - from the keyboard ----
  const ptrs = new Map(); let moved = 0, lastPinch = 0;
  const onDown = (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; lastPinch = 0; };
  const onMove = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw = (cam.yaw + dx * 0.45 + 360) % 360; cam.pitch = clamp(cam.pitch + dy * 0.35, 6, 88); schedule();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastPinch) { cam.zoom = clamp(cam.zoom * (d / lastPinch), 0.4, 6); schedule(); }
      lastPinch = d; moved += 5;
    }
  };
  const onUp = (e) => {
    const was = ptrs.has(e.pointerId) && ptrs.size === 1; ptrs.delete(e.pointerId); lastPinch = 0;
    if (was && moved < 6) {
      const b = canvas.getBoundingClientRect(), pt = [e.clientX - b.left, e.clientY - b.top];
      const hit = [...faces].reverse().find((fc) => pointInPoly(pt, fc.sp));
      api.select(hit?.roomId ?? null, true);
    }
  };
  const onWheel = (e) => { e.preventDefault(); cam.zoom = clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.4, 6); schedule(); };
  const onKey = (e) => {
    const step = e.shiftKey ? 20 : 8;
    if (e.key === 'ArrowLeft') cam.yaw = (cam.yaw - step + 360) % 360;
    else if (e.key === 'ArrowRight') cam.yaw = (cam.yaw + step) % 360;
    else if (e.key === 'ArrowUp') cam.pitch = clamp(cam.pitch + step, 6, 88);
    else if (e.key === 'ArrowDown') cam.pitch = clamp(cam.pitch - step, 6, 88);
    else if (e.key === '+' || e.key === '=') cam.zoom = clamp(cam.zoom * 1.15, 0.4, 6);
    else if (e.key === '-') cam.zoom = clamp(cam.zoom / 1.15, 0.4, 6);
    else if (e.key === '0') Object.assign(cam, { ...homeView(model), zoom: 1 });
    else return;
    e.preventDefault(); schedule();
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); });
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('keydown', onKey);

  const api = {
    set(o) { Object.assign(opt, o); schedule(); },
    view(name) { Object.assign(cam, PRESETS[name] ?? homeView(model), name in PRESETS ? {} : { zoom: 1 }); schedule(); },
    select(id, fromCanvas = false) {
      selected = id; schedule();
      onSelect(id ? model.rooms.find((q) => q.id === id) ?? null : null, fromCanvas);
    },
    update(next) { model = next; if (selected && !model.rooms.some((q) => q.id === selected)) selected = null; schedule(); },
    state: () => ({ cam: { ...cam }, opt: { ...opt } }),
    destroy() { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('keydown', onKey); },
  };
  resize();
  return api;
}
