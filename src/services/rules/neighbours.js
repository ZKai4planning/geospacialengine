import { polyArea, centroid, polyDistance, overlapArea } from '../../utils/polygons.js';
import { dirOf, r1 } from './util.js';

/** Neighbouring buildings: overlap = fail, very close = warn, shared wall = info. */
export const neighbourRule = {
  id: 'neighbours',
  run({ P, H, from, T, neighbours }, result) {
    neighbours.forEach((n, i) => {
      const rec = result.neighbours[i];
      const N = n.local;
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
  },
};
