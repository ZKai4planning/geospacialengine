import { STD } from '../../data/interiorStandards.js';
import { onEdgeOf } from './geometry.js';

const r2 = (n) => Math.round(n * 100) / 100;
export const OPENING_DEFAULTS = { door: { sillM: 0, heightM: 2.0, widthM: 0.9 }, window: { sillM: 0.9, heightM: 1.2, widthM: 1.2 } };

/**
 * Doors and windows drawn on a floor, tied to the rooms whose wall they sit on. An opening that no longer lies on any wall
 * (the room was moved or the proposal changed) is dropped and counted, never guessed at.
 */
export function attachOpenings(drawn, rooms) {
  const out = []; let orphans = 0;
  for (const st of drawn?.storeys ?? []) {
    for (const o of st.openings ?? []) {
      const on = rooms.filter((r) => r.storey === st.index && !r.slopedCeiling && onEdgeOf(r.poly, o.a, o.b));
      if (!on.length) { orphans++; continue; }
      const d = OPENING_DEFAULTS[o.kind], sill = o.sillM ?? d.sillM, h = o.heightM ?? d.heightM;
      out.push({
        id: o.id, kind: o.kind, storey: st.index, a: o.a, b: o.b, widthM: r2(Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1])),
        sillM: sill, heightM: h, headM: r2(sill + h), fixed: !!o.fixed, roomIds: on.map((r) => r.id),
      });
    }
  }
  return { openings: out, orphans };
}

/** Straight flights drawn on a floor, with the figures Approved Document K cares about. */
export function buildStairs(drawn, { ceilingM }) {
  const out = [];
  for (const st of drawn?.storeys ?? []) {
    for (const t of st.stairs ?? []) {
      const xs = t.poly.map((p) => p[0]), ys = t.poly.map((p) => p[1]);
      const ex = Math.max(...xs) - Math.min(...xs), ey = Math.max(...ys) - Math.min(...ys);
      const alongX = t.dir === '+x' || t.dir === '-x';
      const length = alongX ? ex : ey, width = alongX ? ey : ex;
      const rise = ceilingM + STD.build.slabM;                         // floor to floor
      const steps = Math.max(2, Math.ceil(rise / STD.adK.maxRiserM - 1e-9));
      const riser = rise / steps, going = length / (steps - 1);
      out.push({
        id: t.id, storey: st.index, poly: t.poly, dir: t.dir, lengthM: r2(length), widthM: r2(width), rise: r2(rise), steps,
        riserM: r2(riser), goingM: r2(going), pitchDeg: Math.round((Math.atan(riser / going) * 180) / Math.PI * 10) / 10,
        box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
      });
    }
  }
  return out;
}
