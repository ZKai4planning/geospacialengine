import { openRing, pointInRing, ringEdgeDistance, quantile } from '../utils/geomLite.js';

/**
 * Roof and eaves height from two LiDAR height grids over a building outline.
 *
 *   DSM = height of whatever the laser hit first / last (roofs, trees, cars)      DTM = bare ground
 *   nDSM = DSM - DTM  = height above the ground at each 1 m cell
 *
 * Everything is in National Grid metres. Grid cell (i, j) has its centre at (x0 + i + 0.5, y0 + j + 0.5); arrays are row-major, j = northing.
 *
 * Map positions (OSM outline -> grid) are only good to a few metres, and a 4 m shift puts half a house on the neighbour's garden.
 * So the outline is first SLID over the nDSM within +-maxShiftM to where it best fits a building: the spot where the most cells inside the
 * outline are "tall" (over tallM above ground) and the fewest cells in the ring just outside it are. The shift used is returned, so it can be shown.
 *
 * Eaves = the low edge of the roof. Cells 0.5-1.5 m inside the wall are on the roof slope, so on a steep roof this reads up to about
 * 0.5 m high; the result is an estimate (+-0.5 m). It feeds the A.1(c)/(d) tests through existingRoof.js, which only fails when an extension is clearly (more than twice the tolerance) above it.
 */
const r1 = (n) => Math.round(n * 10) / 10;
export const ROOF = { maxShiftM: 5, minContrastM: 1.5, goodContrastM: 3, flatSpreadM: 0.7, tallM: 2, maxCells: 1600, padM: 9 };

/** Grid covering a footprint (open ring of [E, N]) with padding for the alignment search. Aligned to whole metres, like the EA grids. */
export function gridFor(footprint, padM = ROOF.padM) {
  const xs = footprint.map((p) => p[0]), ys = footprint.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) - padM), y0 = Math.floor(Math.min(...ys) - padM);
  const nx = Math.ceil(Math.max(...xs) + padM) - x0, ny = Math.ceil(Math.max(...ys) + padM) - y0;
  return { x0, y0, nx, ny, cells: nx * ny };
}

export function analyseRoof({ footprint, grid, dsm, dtm, maxShiftM = ROOF.maxShiftM }) {
  const F = openRing(footprint), { x0, y0, nx, ny } = grid;
  if (F.length < 3 || dsm.length !== nx * ny || dtm.length !== nx * ny) return { status: 'unavailable', reason: 'No usable height data for this building.' };
  const ndsm = new Float64Array(nx * ny).map((_, k) => (Number.isFinite(dsm[k]) && Number.isFinite(dtm[k]) ? dsm[k] - dtm[k] : NaN));
  const cx = (i) => x0 + i + 0.5, cy = (j) => y0 + j + 0.5;

  const evaluate = (sx, sy) => {
    const R = F.map(([x, y]) => [x + sx, y + sy]);
    const xs = R.map((p) => p[0]), ys = R.map((p) => p[1]);
    const iMin = Math.max(0, Math.floor(Math.min(...xs) - 4 - x0)), iMax = Math.min(nx - 1, Math.ceil(Math.max(...xs) + 4 - x0));
    const jMin = Math.max(0, Math.floor(Math.min(...ys) - 4 - y0)), jMax = Math.min(ny - 1, Math.ceil(Math.max(...ys) + 4 - y0));
    const inside = [], ring = [], band = [], dtmIn = [], total = { inside: 0, valid: 0 };
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      const p = [cx(i), cy(j)], v = ndsm[j * nx + i], within = pointInRing(p, R), d = ringEdgeDistance(p, R);
      if (within && d >= 0.5) {
        total.inside++;
        if (Number.isFinite(v)) { total.valid++; inside.push(v); dtmIn.push(dtm[j * nx + i]); if (d <= 1.5) band.push(v); }
      } else if (!within && d >= 1 && d <= 3 && Number.isFinite(v)) ring.push(v);
    }
    const tall = (list) => list.filter((v) => v > ROOF.tallM).length / list.length;
    const ok = inside.length >= 6 && ring.length >= 6;
    const fit = ok ? tall(inside) - tall(ring) : -Infinity;                       // 1 = perfectly on a building, 0 = no better than the surroundings
    return { fit, score: ok ? quantile(inside, 0.5) - quantile(ring, 0.5) : -Infinity, inside, ring, band, dtmIn, total };
  };

  let best = null;
  for (let sx = -maxShiftM; sx <= maxShiftM; sx++) for (let sy = -maxShiftM; sy <= maxShiftM; sy++) {
    const e = evaluate(sx, sy), adj = e.fit - 0.005 * Math.hypot(sx, sy);            // on a tie prefer the smaller move
    if (Number.isFinite(adj) && (!best || adj > best.adj)) best = { ...e, adj, sx, sy };
  }
  if (!best) return { status: 'unavailable', reason: 'The LiDAR grid has no data around this building.' };

  const shift = { x: best.sx, y: best.sy }, shiftM = r1(Math.hypot(best.sx, best.sy)), contrastM = r1(best.score);
  if (best.score < ROOF.minContrastM) {
    return { status: 'unclear', contrastM, shift, shiftM, reason: 'The LiDAR does not show a clear building at this outline (new build, demolished, or hidden under trees).' };
  }
  const validFrac = best.total.inside ? best.total.valid / best.total.inside : 0;
  const spread = quantile(best.inside, 0.9) - quantile(best.inside, 0.1);
  const flat = spread < ROOF.flatSpreadM;
  const ridge = flat ? quantile(best.inside, 0.5) : quantile(best.inside, 0.95);
  const eaves = flat ? ridge : quantile(best.band.length ? best.band : best.inside, 0.15);
  const confidence = best.score >= ROOF.goodContrastM && validFrac >= 0.85 && shiftM <= 6 ? 'high' : best.score >= 2 && validFrac >= 0.6 ? 'medium' : 'low';
  return {
    status: 'ok', roofShape: flat ? 'flat' : 'pitched', eavesM: r1(eaves), ridgeM: r1(ridge),
    groundOdnM: r1(quantile(best.dtmIn, 0.5)), groundFallM: r1(quantile(best.dtmIn, 0.95) - quantile(best.dtmIn, 0.05)),
    contrastM, shift, shiftM, confidence, cells: best.inside.length,
  };
}
