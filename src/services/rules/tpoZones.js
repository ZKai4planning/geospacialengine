import { polyDistance } from '../../utils/polygons.js';
import { r1 } from './util.js';

const MAX_LISTED = 3;
const what = (z) => `${z.type ? `${z.type} ` : ''}tree preservation zone${z.order ? ` (order ${z.order})` : ''}`;

/**
 * Council tree preservation zones (planning.data.gov.uk): a footprint inside one = warn, because the trees in it are legally protected.
 * A zone says "protected trees are somewhere in here"; it does not say where. Hence a warning to check, never a fail.
 */
export const tpoZoneRule = {
  id: 'tpo-zones',
  run({ P, T, zones }, result) {
    zones.forEach((z, i) => {
      const rec = result.zones[i];
      const d = Math.min(...z.parts.map((part) => polyDistance(P, part)));
      rec.distanceM = r1(d);
      rec.status = d === 0 ? 'inside' : d <= T.tpoZoneNearM ? 'near' : 'clear';
    });
    const flagged = result.zones.filter((z) => z.status !== 'clear').sort((a, b) => (a.status === 'inside' ? 0 : 1) - (b.status === 'inside' ? 0 : 1));
    for (const z of flagged.slice(0, MAX_LISTED)) {
      if (z.status === 'inside') result.items.push({ status: 'warn', message: `The proposal is inside a ${what(z)}. You would need the council's consent before cutting, pruning or damaging the roots of a protected tree.` });
      else result.items.push({ status: 'info', message: `About ${z.distanceM} m from a ${what(z)}. Zone outlines are approximate, so check whether protected trees are close to the work.` });
    }
  },
};
