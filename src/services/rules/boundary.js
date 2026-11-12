import { pointInAny, centroid, edgeDistanceAny, outsideStats } from '../../utils/polygons.js';
import { r1 } from './util.js';

/** Registered title boundary (HM Land Registry): sticking out beyond it = fail. An ESTIMATED plot outline only ever warns. */
export const boundaryRule = {
  id: 'boundary',
  run({ P, H, T, plot }, result) {
    const b = result.boundary;
    if (!plot) {
      result.items.push({ status: 'info', message: 'No registered title boundary was found for this property, so the boundary check was skipped.' });
      return;
    }
    const C = plot.parts ?? plot.local; // every piece of the title (house + detached garage, ...)
    b.estimated = !!plot.estimated;
    b.approxM = plot.approxM ?? 0;
    // parcels converted with the built-in grid conversion can be a few metres out: widen the tolerance and say so (never a hard fail on noise)
    const tolM = Math.max(T.boundaryToleranceM, b.approxM > 1 ? b.approxM * 0.5 : 0);
    const approxNote = b.approxM > 1 ? ` Parcel positions here are only accurate to about ${b.approxM} m.` : '';
    if (H && !plot.estimated && !pointInAny(centroid(H), C)) {
      b.status = 'unreliable';
      result.items.push({ status: 'info', message: 'The title boundary found does not seem to contain the house (shared or split titles are common), so the boundary check was skipped.' });
      return;
    }
    const stats = outsideStats(P, C, tolM);
    b.outsideM2 = r1(stats.areaM2); b.maxOutsideM = r1(stats.maxDepthM); b.minDistanceM = r1(edgeDistanceAny(P, C));
    if (plot.estimated) { // an estimate is never a verdict: warn / inform, never fail, and say so
      if (stats.areaM2 >= T.boundaryCrossM2) {
        b.status = 'crosses';
        result.items.push({ status: 'warn', message: `Looks like it extends about ${b.maxOutsideM} m beyond the estimated plot outline (about ${b.outsideM2} m² outside it). That outline is only an estimate, so check where the real boundary is.` });
      } else {
        b.status = 'inside';
        result.items.push({ status: 'info', message: 'Within the estimated plot outline. This is not a confirmed boundary – check the real boundary on site or on the title plan.' });
      }
      return;
    }
    if (stats.areaM2 >= T.boundaryCrossM2) {
      b.status = 'crosses';
      result.items.push({ status: 'fail', message: `Extends about ${b.maxOutsideM} m beyond the registered title boundary (about ${b.outsideM2} m² outside it).${approxNote}` });
    } else {
      b.status = 'inside';
      result.items.push({ status: 'pass', message: `Inside the registered title boundary${b.minDistanceM <= tolM ? ' (up to the boundary line)' : ` (about ${b.minDistanceM} m from the nearest boundary line)`}.${approxNote}` });
    }
  },
};
