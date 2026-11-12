import { z } from 'zod';
import { projector, polyArea, isSimple } from './polygons.js';
import { haversine } from './geo.js';

export const DRAWN = { minVertices: 3, maxVertices: 50, minAreaM2: 0.5, maxAreaM2: 1000, maxFromAddressM: 120 };

const sameXY = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Drops a repeated closing vertex and consecutive duplicates, so the ring is stored OPEN. */
export function normaliseRing(ring) {
  const out = ring.filter((p, i) => i === 0 || !sameXY(p, ring[i - 1]));
  return out.length > 1 && sameXY(out[0], out.at(-1)) ? out.slice(0, -1) : out;
}

/** Returns a human-readable problem with a drawn ring ([lng,lat] pairs, open), or null if it is acceptable. */
export function ringProblem(ring) {
  if (ring.length < DRAWN.minVertices) return 'Draw at least 3 corners.';
  const proj = projector(ring[0][1], ring[0][0]);
  const pts = ring.map(proj);
  if (!isSimple(pts)) return 'The outline crosses itself. Move the corners so the edges do not cross.';
  const area = polyArea(pts);
  if (area < DRAWN.minAreaM2) return 'The shape is too small to be a building.';
  if (area > DRAWN.maxAreaM2) return `The shape is too large (over ${DRAWN.maxAreaM2} m²).`;
  return null;
}

/** Zod schema for the `ring` field of a drawn proposal (lng/lat pairs inside Great Britain). */
export const ringSchema = z
  .array(z.tuple([z.number().min(-9).max(2), z.number().min(49.5).max(61)]), { required_error: 'Draw the shape on the map first.' })
  .max(DRAWN.maxVertices, `Use at most ${DRAWN.maxVertices} corners.`)
  .transform(normaliseRing)
  .superRefine((ring, ctx) => {
    const problem = ringProblem(ring);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/** The shape must be drawn on or very near the property, not somewhere else on the map. */
export function ringNearAddress(ring, address) {
  return ring.every(([lng, lat]) => haversine({ lat, lng }, address) <= DRAWN.maxFromAddressM);
}
