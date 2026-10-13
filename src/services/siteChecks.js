import { projector, open, polyArea, centroid, pointInPoly, polyDistance, edgeDistance, overlapArea, outsideStats } from '../utils/polygons.js';

/** Tunable thresholds. Map data is only accurate to about a metre, so these deliberately ignore tiny overlaps. */
export const THRESHOLDS = {
  neighbourOverlapM2: 0.5,   // overlap with a neighbouring building at or above this = "overlaps"
  adjoinM: 0.3,              // closer than this (but not overlapping) = "adjoins"
  closeM: 1.0,               // closer than this = "very close"
  rangeM: 8,                 // neighbours further away than this are not examined
  boundaryToleranceM: 0.5,   // ignore anything within this of the title outline (data accuracy)
  boundaryCrossM2: 0.5,      // area beyond the title boundary at or above this = "crosses"
};

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirOf = (dx, dy) => DIRS[Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 / 45) % 8];
const r1 = (n) => Math.round(n * 10) / 10;

export const DISCLAIMER =
  'Indicative only: based on OpenStreetMap building outlines and HM Land Registry title boundaries. Positions can be a metre or more out, '
  + 'and a title boundary is not the legal boundary. Please check on site.';

/**
 * Checks the proposal footprint against neighbouring buildings and the registered title boundary.
 * All rings are [lng, lat]. Returns per-neighbour status (for map colouring), a boundary result and human-readable items.
 */
export function runSiteChecks({ proposalRing, houseRing, houseIndicative = false, footprintWork = true, neighbours = [], plot = null }) {
  const T = THRESHOLDS;
  const result = {
    neighbours: neighbours.map((n) => ({ id: n.id, status: 'clear', overlapM2: 0, distanceM: null, direction: null })),
    boundary: { status: plot ? 'idle' : 'unavailable', areaM2: plot?.areaM2 ?? null, outsideM2: 0, maxOutsideM: 0, minDistanceM: null },
    items: [], disclaimer: DISCLAIMER,
  };
  if (!proposalRing) return result;

  if (!footprintWork) {
    result.items.push({ status: 'info', message: 'Roof-level work does not extend the building footprint, so overlap and boundary checks do not apply.' });
    return result;
  }
  if (houseIndicative) {
    result.items.push({ status: 'info', message: 'No building outline was found, so neighbour and boundary checks were skipped.' });
    return result;
  }

  const c = ((r) => ({ lng: r.reduce((s, p) => s + p[0], 0) / r.length, lat: r.reduce((s, p) => s + p[1], 0) / r.length }))(proposalRing);
  const proj = projector(c.lat, c.lng);
  const local = (ring) => open(ring.map(proj));
  const P = local(proposalRing), H = houseRing ? local(houseRing) : null;
  const from = H ? centroid(H) : centroid(P); // compass direction is measured from the middle of the house

  // ---- neighbouring buildings ----
  neighbours.forEach((n, i) => {
    const rec = result.neighbours[i];
    const N = local(n.ring);
    const dist = polyDistance(P, N);
    rec.distanceM = r1(dist);
    if (dist > T.rangeM) return;
    const nArea = polyArea(N);
    if (H && nArea > 0 && overlapArea(H, N) / nArea > 0.5) { rec.status = 'ignored'; return; } // duplicate / part of the same building
    const [nx, ny] = centroid(N);
    rec.direction = dirOf(nx - from[0], ny - from[1]);
    const ov = overlapArea(P, N);
    rec.overlapM2 = r1(ov);
    rec.status = ov >= T.neighbourOverlapM2 ? 'overlap' : dist <= T.adjoinM ? 'adjoining' : dist <= T.closeM ? 'close' : 'clear';
  });

  const order = { overlap: 0, close: 1, adjoining: 2 };
  const flagged = result.neighbours.filter((n) => order[n.status] !== undefined).sort((a, b) => order[a.status] - order[b.status]);
  for (const n of flagged) {
    if (n.status === 'overlap') result.items.push({ status: 'fail', message: `Overlaps the neighbouring building to the ${n.direction} by about ${n.overlapM2} m².` });
    else if (n.status === 'close') result.items.push({ status: 'warn', message: `Within about ${n.distanceM} m of the neighbouring building to the ${n.direction}.` });
    else result.items.push({ status: 'info', message: `Adjoins the neighbouring building to the ${n.direction}; party wall matters may apply.` });
  }
  if (!flagged.some((n) => n.status === 'overlap')) result.items.push({ status: 'pass', message: 'No overlap with neighbouring buildings found (OpenStreetMap outlines can be incomplete).' });

  // ---- registered title boundary ----
  const b = result.boundary;
  if (!plot) {
    result.items.push({ status: 'info', message: 'No registered title boundary was found for this property, so the boundary check was skipped.' });
    return result;
  }
  const C = local(plot.ring);
  if (H && !pointInPoly(centroid(H), C)) {
    b.status = 'unreliable';
    result.items.push({ status: 'info', message: 'The title boundary found does not seem to contain the house (shared or split titles are common), so the boundary check was skipped.' });
    return result;
  }
  const stats = outsideStats(P, C, T.boundaryToleranceM);
  b.outsideM2 = r1(stats.areaM2); b.maxOutsideM = r1(stats.maxDepthM); b.minDistanceM = r1(edgeDistance(P, C));
  if (stats.areaM2 >= T.boundaryCrossM2) {
    b.status = 'crosses';
    result.items.push({ status: 'fail', message: `Extends about ${b.maxOutsideM} m beyond the registered title boundary (about ${b.outsideM2} m² outside it).` });
  } else {
    b.status = 'inside';
    result.items.push({ status: 'pass', message: `Inside the registered title boundary${b.minDistanceM <= T.boundaryToleranceM ? ' (up to the boundary line)' : ` (about ${b.minDistanceM} m from the nearest boundary line)`}.` });
  }
  return result;
}
