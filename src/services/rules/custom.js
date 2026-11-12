/**
 * YOUR OWN CHECKS GO HERE.
 *
 * A rule is `{ id, run(ctx, result) }`. It is called once per proposal with everything in LOCAL METRES
 * (x = east, y = north), and it adds messages to `result.items`:
 *
 *   ctx.P          proposal footprint as [[x, y], ...]
 *   ctx.H          existing house footprint (null when no outline was found)
 *   ctx.from       centre of the house, [x, y]
 *   ctx.neighbours [{ id, local }]                       neighbouring buildings
 *   ctx.plot       { local, areaM2 } | null              HM Land Registry title boundary
 *   ctx.roads      [{ id, name, widthM, ignore, local }] OSM road centrelines
 *   ctx.trees      [{ id, xy, radiusM, radiusSource }]   OSM trees + estimated root protection radius
 *   ctx.flags      planning constraint flags (tpo, listedBuilding, conservationArea, ...)
 *   ctx.T          THRESHOLDS
 *
 *   result.items.push({ status: 'fail' | 'warn' | 'pass' | 'info', message: '...' })
 *
 * Helpers (polyArea, polyDistance, overlapArea, edgeDistance, ...) live in src/utils/polygons.js.
 * A rule that throws is caught and reported as an info line; it never breaks the request.
 *
 * Example – warn when more than 60% of the plot would be covered by the house + this proposal:
 *
 *   import { polyArea } from '../../utils/polygons.js';
 *   export const coverageRule = {
 *     id: 'coverage',
 *     run({ P, H, plot }, result) {
 *       if (!plot || !H) return;
 *       const used = polyArea(P) + polyArea(H);
 *       if (used / plot.areaM2 > 0.6) result.items.push({ status: 'warn', message: 'Covers over 60% of the plot.' });
 *     },
 *   };
 *
 * Then add it to the array below (or call registerRule(coverageRule) from your own code / tests).
 */
export const customRules = [];
