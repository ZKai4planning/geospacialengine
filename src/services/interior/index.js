import { buildLayout } from './layout.js';
import { interiorChecks, interiorTotals } from './checks.js';
import { ROOM_TYPES } from '../../data/interiorStandards.js';

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Builds the inside of the building (rooms, floors, roof) for the 3D view, plus the interior checks.
 *
 * @param {object} i
 * @param {object} i.frame       house frame from buildFrame(): { W, D, toSD(lng,lat), synthetic }
 * @param {object} i.profile     application profile (storeys, roofType, existingExtension are { value } / plain objects)
 * @param {object|null} i.proposal   the proposal as saved (work type + dimensions)
 * @param {string} i.form        'detached' | 'semi' | 'terraced' | 'other'
 * @param {object|null} i.lidar  roof analysis from LiDAR, if any
 * @param {object[]} i.plotRings registered or estimated plot rings (lng/lat) for context
 * @param {object[]} i.neighbours neighbouring building rings (lng/lat) for context
 * @param {object} i.setup       applicant edits (storeys, ceiling, hallSide, room names/types, loftUse)
 *
 * Fails soft: any problem returns { available: false, reason } and the rest of the application is untouched.
 */
export function buildInterior({ frame, profile, proposal, form = 'other', lidar = null, plotRings = [], neighbours = [], setup = {} }) {
  try {
    if (!frame || !Number.isFinite(frame.W) || !Number.isFinite(frame.D)) return { available: false, reason: 'No house outline to build from.' };
    if (frame.synthetic) return { available: false, reason: 'No building outline was found for this address, so the inside cannot be placed. Confirm the building on the map first.' };
    const W = frame.W, D = frame.D;
    const ringToSD = (ring) => ring.map(([lng, lat]) => frame.toSD(lng, lat));
    const model = buildLayout({
      W, D, form, lidar, setup,
      storeys: profile?.storeys?.value ?? null, roofType: profile?.roofType?.value ?? null,
      existing: profile?.existingExtension ?? null, proposal, ringToSD,
    });
    const toXY = (ring) => ring.slice(0, -1).map(([lng, lat]) => { const [s, d] = frame.toSD(lng, lat); return [r2(s + W / 2), r2(d + D)]; });
    const context = {
      plot: plotRings.slice(0, 3).map(toXY).filter((p) => p.length >= 3),
      neighbours: neighbours.slice(0, 40).map((n) => toXY(n.ring)).filter((p) => p.length >= 3
        // keep only those near the house, so the view is not dominated by the street
        && p.some(([x, y]) => x > -25 && x < W + 25 && y > -25 && y < D + 40)),
    };
    const checks = interiorChecks(model);
    return {
      available: true, ...model, context, checks, totals: interiorTotals(model),
      roomTypes: Object.fromEntries(Object.entries(ROOM_TYPES).map(([k, v]) => [k, v.label])),
      disclaimer: 'Indicative only. The existing rooms are a typical layout generated from the outline, not a survey. The new rooms use your dimensions. Guidance checks are not a Building Regulations or planning decision.',
    };
  } catch (e) {
    return { available: false, reason: `The inside could not be built (${e.message}).` };
  }
}
