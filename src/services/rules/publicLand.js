import { pointInPoly, pointSegDist, segmentsIntersect } from '../../utils/polygons.js';
import { r1 } from './util.js';

/**
 * Public land: everything between the plot's road-facing boundary and the road is NOT the applicant's –
 * it is the pavement, verge and carriageway (the highway). Nothing (porch, extension, outbuilding) may be built there.
 *
 * Definition used (works for any road angle, including a road running diagonally alongside the plot): a point of the
 * proposal is on public land when it is outside the plot AND the straight line from it to the nearest point of the road
 * does not cross the plot AND the plot lies BEHIND it as seen from the road (angle > 120 deg between "towards the plot"
 * and "towards the road"). Rear work (the line to the road crosses the house/plot) and sideways work (plot to one side,
 * road ahead) are therefore not flagged.
 *
 * Confidence follows the boundary rule: a REGISTERED title boundary = fail; an ESTIMATED plot outline = warn only.
 * With no plot at all the rule cannot say where the frontage is, and the road rule (carriageway only) still applies.
 *
 * Result: result.publicLand = { status: 'clear' | 'on_public_land' | 'unavailable', estimated, areaM2, maxIntoM, gapM, roadName }
 */
const distToLine = (pt, line) => {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, pointSegDist(pt, line[i], line[i + 1]));
  return best;
};
const bboxOf = (pts) => ({ minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) });

const nearestOnLine = (pt, line) => {
  let best = { d: Infinity, p: null };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
    if (d < best.d) best = { d, p: q };
  }
  return best;
};

export const publicLandRule = {
  id: 'public-land',
  run({ P, T, plot, roads }, result) {
    const pl = result.publicLand = { status: 'unavailable', estimated: !!plot?.estimated, areaM2: 0, maxIntoM: 0, gapM: null, roadName: null, approxM: plot?.approxM ?? 0 };
    if (!plot) return;
    const parts = plot.parts ?? [plot.local];
    const plotEdges = parts.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]]));
    // Deliberately the plain data tolerance, NOT widened by the parcel's grid-conversion error: the registered title and the
    // road both come from the same data, and a porch is exactly the size of the error that would otherwise hide it.
    const tolM = T.boundaryToleranceM, step = 0.1, bb = bboxOf(P);

    pl.status = 'clear';
    for (const road of roads) {
      if (road.ignore || !road.local || road.local.length < 2) continue;
      const half = (road.widthM ?? 5) / 2;
      const plotDist = Math.min(...parts.flatMap((part) => part.map((v) => distToLine(v, road.local))));
      if (plotDist - half > T.roadRangeM) continue;     // plot is nowhere near this road
      const gap = Math.max(0, plotDist - half);          // plot boundary -> carriageway edge (the pavement / verge)
      if (pl.gapM == null || gap < pl.gapM) { pl.gapM = r1(gap); pl.roadName = pl.roadName ?? road.name ?? null; }

      let n = 0, maxInto = 0;
      for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
        for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
          const pt = [x, y];
          if (!pointInPoly(pt, P) || parts.some((r) => pointInPoly(pt, r))) continue;       // proposal, outside the plot
          const dPlot = Math.min(...plotEdges.map(([a, b]) => pointSegDist(pt, a, b)));
          if (dPlot <= tolM) continue;
          const nr = nearestOnLine(pt, road.local);
          if (nr.d - half > T.roadRangeM) continue;
          if (plotEdges.some(([a, b]) => segmentsIntersect(pt, nr.p, a, b))) continue;       // the way to the road crosses the plot = rear / far side
          // direction to the nearest plot point vs direction to the road: the plot must be behind us
          let np = null, bd = Infinity;
          for (const [a, b] of plotEdges) {
            const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
            const t = l2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2)) : 0;
            const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
            if (d < bd) { bd = d; np = q; }
          }
          const v1 = [np[0] - pt[0], np[1] - pt[1]], v2 = [nr.p[0] - pt[0], nr.p[1] - pt[1]];
          const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
          if (cos > -0.5) continue;
          n++; maxInto = Math.max(maxInto, dPlot);
        }
      }
      const areaM2 = n * step * step;
      if (areaM2 >= T.boundaryCrossM2 && areaM2 > pl.areaM2) {
        Object.assign(pl, { status: 'on_public_land', areaM2: r1(areaM2), maxIntoM: r1(maxInto), gapM: r1(gap), roadName: road.name ?? null });
      }
    }

    const road = pl.roadName ? `the road (${pl.roadName})` : 'the road';
    if (pl.status !== 'on_public_land') {
      if (pl.gapM != null && pl.gapM > 0) result.items.push({ status: 'info', message: `The land between the plot and ${road} (about ${pl.gapM} m) is public land – pavement or highway. The work stays off it.` });
      return;
    }
    const acc = pl.approxM > 1 ? ` Parcel positions here are only accurate to about ${pl.approxM} m, so confirm on site.` : '';
    const where = `about ${pl.areaM2} m² of the proposal, up to ${pl.maxIntoM} m beyond the plot, stands on the land between the plot and ${road} (about ${pl.gapM} m of public land – pavement or highway)`;
    if (pl.estimated) {
      result.items.push({ status: 'warn', message: `Looks like ${where}. The plot outline is only an estimate, so check where your boundary runs.` });
    } else {
      result.items.push({ status: 'fail', message: `${where[0].toUpperCase()}${where.slice(1)}. That is public land, not part of the registered title, so it can't be built on.${acc}` });
    }
  },
};
