import { projector, open, pointInPoly, polyArea, centroid, pointSegDist } from '../utils/polygons.js';
import { ringCentroid, pointInRing } from '../utils/geo.js';

/**
 * Facts worked out from the plot and building geometry the app already holds (no new data source):
 *   - which OSM buildings inside a REGISTERED plot are the owner's own sheds / garages / earlier extensions (not neighbours)
 *   - distance from the work to the rear / side / front boundary, so the rules no longer have to ask
 *   - how much of the curtilage the buildings already cover
 * All input rings are [lng, lat]. An ESTIMATED plot outline is never used for these: a guessed boundary must not produce a number.
 */
const r1 = (n) => Math.round(n * 10) / 10;
const MAX_OUTBUILDING_M2 = 150;

/** Buildings whose middle is inside the registered plot = the owner's own outbuildings; everything else stays a neighbour. */
export function splitOutbuildings({ plotRings, neighbours = [] }) {
  const rings = (plotRings ?? []).filter((r) => r?.length > 3);
  if (!rings.length) return { own: [], others: neighbours };
  const own = [], others = [];
  for (const n of neighbours) {
    const c = ringCentroid(n.ring), inside = rings.some((r) => pointInRing([c.lng, c.lat], r));
    const area = polyArea(open(n.ring).map(projector(c.lat, c.lng)));
    const isOwn = inside && area <= MAX_OUTBUILDING_M2;
    (isOwn ? own : others).push(isOwn ? { ...n, areaM2: r1(area) } : n);
  }
  return { own, others };
}

const segToPoly = (P, a, b) => Math.min(...P.map((v) => pointSegDist(v, a, b)), ...P.map((v, i) => Math.min(pointSegDist(a, v, P[(i + 1) % P.length]), pointSegDist(b, v, P[(i + 1) % P.length]))));

/**
 * Distance from the work to the nearest rear / side / front boundary, by which way each boundary edge faces relative to the house front.
 * Needs the work wholly inside the plot and the front bearing; otherwise only { nearestM } (or null) is returned.
 */
export function boundaryDistances({ plotRings, proposalRing, frontBearingDeg = null }) {
  const rings = (plotRings ?? []).filter((r) => r?.length > 3);
  if (!rings.length || !proposalRing) return null;
  const c = ringCentroid(proposalRing), proj = projector(c.lat, c.lng);
  const P = open(proposalRing.map(proj)), parts = rings.map((r) => open(r.map(proj)));
  // a wall ON the boundary line (a terrace, a party wall) counts as inside: 0.3 m, the same tolerance the boundary rule uses
  const onOrIn = (v) => parts.some((pt) => pointInPoly(v, pt) || pt.some((a, i) => pointSegDist(v, a, pt[(i + 1) % pt.length]) <= 0.3));
  if (!P.every(onOrIn)) return null;                                                  // work outside the plot: the boundary rule reports that
  const mid = centroid(parts.flat());
  const out = { rearM: Infinity, sideM: Infinity, frontM: Infinity, nearestM: Infinity };
  for (const part of parts) for (let i = 0; i < part.length; i++) {
    const a = part[i], b = part[(i + 1) % part.length], d = segToPoly(P, a, b);
    out.nearestM = Math.min(out.nearestM, d);
    if (frontBearingDeg == null) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let n = [dy / len, -dx / len]; const m = [(a[0] + b[0]) / 2 - mid[0], (a[1] + b[1]) / 2 - mid[1]];
    if (n[0] * m[0] + n[1] * m[1] < 0) n = [-n[0], -n[1]];                             // outward normal
    const bearing = (Math.atan2(n[0], n[1]) * 180) / Math.PI, rel = Math.abs(((bearing - frontBearingDeg + 540) % 360) - 180);
    // rel = how far the boundary's outward direction is from the way the house front faces: ~0 = the FRONT boundary, ~180 = the REAR boundary
    const key = rel <= 45 ? 'frontM' : rel < 135 ? 'sideM' : 'rearM';
    out[key] = Math.min(out[key], d);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Number.isFinite(v) ? r1(v) : null]));
}

/** How much of the curtilage the buildings cover, in the GPDO sense: everything except the original house, over the curtilage without the house. */
export function curtilageCover({ plotAreaM2, houseM2, outbuildingsM2 = 0, proposalM2 = 0 }) {
  if (!plotAreaM2 || houseM2 == null) return null;
  const additions = outbuildingsM2 + proposalM2, curtilage = plotAreaM2 - houseM2;
  return { additionsM2: r1(additions), curtilageM2: r1(curtilage), pct: curtilage > 0 ? Math.round((additions / curtilage) * 100) : null };
}

/**
 * Values the rules would otherwise ask the applicant for. Only fills what is EMPTY, and only from a registered title.
 * Returns { fields, names }: `names` lists what was filled so the UI can say "found automatically".
 */
export function autoFacts(proposal, { boundary = null, additionsAreaM2 = null } = {}, { registered = false } = {}) {
  const fields = {}, set = (k, v) => { if (v != null && proposal[k] == null) fields[k] = v; };
  if (registered && boundary) {
    const sideOrRear = [boundary.sideM, boundary.rearM].filter((v) => v != null);
    if (proposal.type === 'rear_extension' || proposal.type === 'side_extension' || proposal.type === 'wraparound_extension') {
      set('distanceToSideBoundaryM', sideOrRear.length ? Math.min(...sideOrRear) : boundary.nearestM);   // the eaves limit applies within 2 m of ANY boundary
      set('distanceToRearBoundaryM', boundary.rearM);
    }
    if (proposal.type === 'outbuilding') set('distanceToBoundaryM', boundary.nearestM);
  }
  if (registered && (proposal.type === 'rear_extension' || proposal.type === 'side_extension' || proposal.type === 'wraparound_extension' || proposal.type === 'outbuilding')) set('additionsAreaM2', additionsAreaM2);
  return { fields, names: Object.keys(fields) };
}
