import { polyToLineDistance } from '../../utils/polygons.js';
import { r1 } from './util.js';

/**
 * Roads: the OSM centreline plus half the (tagged or typical) carriageway width.
 * Reaching onto the carriageway = fail; within ~1 m of its edge = warn (a pavement or verge normally lies between).
 * Private driveways are ignored – building on your own drive is not a road conflict.
 */
export const roadRule = {
  id: 'roads',
  run({ P, T, roads }, result) {
    let examined = 0;
    roads.forEach((road, i) => {
      const rec = result.roads[i];
      if (road.ignore) { rec.status = 'ignored'; return; }
      const half = road.widthM / 2;
      const dist = polyToLineDistance(P, road.local);   // to the centreline
      const gap = dist - half;                          // to the carriageway edge (negative = onto the road)
      rec.distanceM = r1(Math.max(0, gap));
      if (gap > T.roadRangeM) return;
      examined++;
      const into = half - dist;
      if (into >= T.roadOverlapM) { rec.status = 'overlap'; rec.intoM = r1(into); }
      else if (gap < T.roadCloseM) rec.status = 'close';
    });

    const flagged = result.roads.filter((r) => r.status === 'overlap' || r.status === 'close')
      .sort((a, b) => (a.status === 'overlap' ? 0 : 1) - (b.status === 'overlap' ? 0 : 1) || a.distanceM - b.distanceM);
    for (const r of flagged) {
      const name = r.name ? `the road (${r.name})` : 'the road';
      if (r.status === 'overlap') result.items.push({ status: 'fail', message: `Reaches about ${r.intoM} m onto ${name} (mapped carriageway width is approximate).` });
      else result.items.push({ status: 'warn', message: `Within about ${r.distanceM} m of the edge of ${name}. A pavement or verge usually lies between – check the highway boundary on site.` });
    }
    if (!flagged.length && examined) result.items.push({ status: 'pass', message: 'Clear of mapped roads.' });
  },
};
