/** Checks on a floor plan the applicant drew, in house-frame metres (x across, y front to rear). Pure, no dependencies. */
const area = (pts) => Math.abs(pts.reduce((a, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + x1 * y2 - x2 * y1; }, 0)) / 2;
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function crosses(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
}
export function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;          // neighbouring edges share a corner
    if (crosses(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

export const LAYOUT_LIMITS = { maxRooms: 60, minAreaM2: 1, marginM: 0.5, maxCorners: 16, maxOpenings: 80, maxStairs: 4, overlapM2: 0.05, wallTolM: 0.12 };

export function pointInPoly([px, py], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bb = (p) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });

/** Area (m2) where two room polygons overlap, by sampling 5 cm cells (cell centres, so rooms that only share a wall give 0). */
export function overlapM2(a, b, step = 0.05) {
  const A = bb(a), B = bb(b);
  const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1), y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return 0;
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPoly([x, y], a) && pointInPoly([x, y], b)) n++;
  return Math.round(n * step * step * 100) / 100;
}

/** Distance from point p to segment a-b, and the foot of the perpendicular (clamped to the segment). */
export function nearOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const f = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - f[0], p[1] - f[1]), t, foot: f };
}
/** Does the opening a-b lie along an edge of the polygon (both ends within tol of that edge)? */
export function onEdgeOf(poly, a, b, tol = LAYOUT_LIMITS.wallTolM) {
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    if (nearOnSegment(a, c, d).d <= tol && nearOnSegment(b, c, d).d <= tol) return true;
  }
  return false;
}

/** Returns a list of plain-language problems (empty = fine). */
export function layoutProblems(layout, W, D, newRooms = []) {
  const out = [];
  const L = LAYOUT_LIMITS;
  const ids = new Set();
  let count = 0;
  for (const st of layout.storeys ?? []) {
    for (const r of st.rooms) {
      count++;
      const label = r.name || r.id;
      if (ids.has(r.id)) out.push(`Two rooms share the id ${r.id}.`); ids.add(r.id);
      if (r.poly.length < 3 || r.poly.length > L.maxCorners) out.push(`${label}: a room needs 3 to ${L.maxCorners} corners.`);
      if (r.poly.some(([x, y]) => x < -L.marginM || x > W + L.marginM || y < -L.marginM || y > D + L.marginM)) out.push(`${label}: reaches outside the house outline.`);
      if (selfIntersects(r.poly)) out.push(`${label}: its walls cross each other.`);
      else if (area(r.poly) < L.minAreaM2) out.push(`${label}: smaller than ${L.minAreaM2} m².`);
    }
  }
  if (count > L.maxRooms) out.push(`Too many rooms (the limit is ${L.maxRooms}).`);

  // rooms on the same floor must not sit on top of each other (sharing a wall is fine)
  for (const st of layout.storeys ?? []) {
    const rs = st.rooms.filter((r) => r.poly.length >= 3 && !selfIntersects(r.poly));
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const o = overlapM2(rs[i].poly, rs[j].poly);
      if (o > L.overlapM2) out.push(`${rs[i].name || rs[i].id} and ${rs[j].name || rs[j].id} overlap by ${o} m².`);
    }
  }

  // doors and windows must sit on a wall (an edge of a drawn room, or of the proposal's new room on that floor)
  for (const st of layout.storeys ?? []) {
    const polys = [...st.rooms.map((r) => r.poly), ...(newRooms.filter((r) => r.storey === st.index).map((r) => r.poly))];
    if ((st.openings?.length ?? 0) > L.maxOpenings) out.push(`Too many doors and windows on one floor (the limit is ${L.maxOpenings}).`);
    for (const o of st.openings ?? []) {
      const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
      if (len < 0.3 || len > 6) out.push(`A ${o.kind} on floor ${st.index} is ${Math.round(len * 100) / 100} m wide: use 0.3 to 6 m.`);
      else if (!polys.some((p) => onEdgeOf(p, o.a, o.b))) out.push(`A ${o.kind} on floor ${st.index} is not on a wall.`);
    }
    if ((st.stairs?.length ?? 0) > L.maxStairs) out.push(`Too many stairs on one floor (the limit is ${L.maxStairs}).`);
    for (const t of st.stairs ?? []) {
      if (selfIntersects(t.poly) || area(t.poly) < 0.5) out.push(`A stair on floor ${st.index} is too small or has crossing sides.`);
      else if (t.poly.some(([x, y]) => x < -L.marginM || x > W + L.marginM || y < -L.marginM || y > D + L.marginM)) out.push(`A stair on floor ${st.index} reaches outside the house outline.`);
    }
  }
  return out;
}
