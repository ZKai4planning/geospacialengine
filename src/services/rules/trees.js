import { pointPolyDistance } from '../../utils/polygons.js';
import { r1 } from './util.js';

const SRC = { trunk: 'from its trunk size', crown: 'from its crown size', assumed: 'assumed – trunk size unknown' };
const MAX_LISTED = 4;

/**
 * Trees from OpenStreetMap: a footprint covering a trunk = fail; inside the estimated root protection area = warn.
 * OSM tree coverage is patchy, so "no trees found" is reported as an info note, never as a pass.
 */
export const treeRule = {
  id: 'trees',
  run({ P, T, trees, flags, zones = [] }, result) {
    trees.forEach((tree, i) => {
      const rec = result.trees[i];
      const d = pointPolyDistance(tree.xy, P);          // trunk to footprint
      rec.distanceM = r1(d);
      if (d > tree.radiusM + T.treeRangeM) return;
      if (d <= T.treeOnTrunkM) rec.status = 'blocked';
      else if (d < tree.radiusM) rec.status = 'near';
    });

    const flagged = result.trees.filter((t) => t.status !== 'clear').sort((a, b) => (a.status === 'blocked' ? 0 : 1) - (b.status === 'blocked' ? 0 : 1) || a.distanceM - b.distanceM);
    for (const t of flagged.slice(0, MAX_LISTED)) {
      const what = t.protected ? `protected tree${t.order ? ` (TPO ${t.order})` : ''}` : t.species ? `mapped tree (${t.species})` : 'mapped tree';
      if (t.status === 'blocked') result.items.push({ status: 'fail', message: `The footprint covers or touches a ${what}.` });
      else result.items.push({ status: 'warn', message: `About ${t.distanceM} m from a ${what}, inside its estimated root protection area (radius ${t.radiusM} m, ${SRC[t.radiusSource]}). Foundations here usually need a tree survey${t.protected ? ', and consent for any work affecting a protected tree' : ''}.` });
    }
    if (flagged.length > MAX_LISTED) result.items.push({ status: 'warn', message: `…and ${flagged.length - MAX_LISTED} more trees within their root protection areas.` });

    if (flags?.tpo && !zones.length) result.items.push({ status: 'info', message: 'A tree preservation order applies in this area: you would need the council\'s consent to cut, prune or damage the roots of a protected tree.' });
    if (!trees.length) result.items.push({ status: 'info', message: 'No trees are mapped here (OpenStreetMap and council protected-tree data). That does not mean there are none – check the garden and neighbouring gardens on site.' });
    else if (!flagged.length) result.items.push({ status: 'pass', message: 'No mapped trees found within their root protection areas (tree data is incomplete – check on site).' });
  },
};
