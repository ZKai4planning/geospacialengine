import { localProjector, openRing, pointInRing, ringEdgeDistance } from '../utils/geomLite.js';

/**
 * Dashboard tiles for the three "not available yet" items that open data can now fill: roof / eaves height (LiDAR),
 * coal mining risk (Development High Risk Areas) and what happens at the boundary when the work is not wholly inside the title.
 *
 * A tile is { id, label, value, sub, status }  (ok | check | info | na). Same shape as dashboard.js.
 * "Nothing found" is never reported as ok: absence of data is not clearance.
 */
const r1 = (n) => Math.round(n * 10) / 10;
const m = (n) => `${r1(n)} m`;

export const PENDING = {
  height: { id: 'roof-height', label: 'Roof and eaves height', sub: 'Needs LiDAR / building-height data. Only a community-entered map height is used today, when it exists.' },
  coal: { id: 'coal', label: 'Coal mining risk', sub: 'Needs the Mining Remediation Authority\'s Development High Risk Area data (check its licence before loading it). Free to view on their map viewer.' },
};
const na = (p, sub = p.sub) => ({ id: p.id, label: p.label, value: 'Not available yet', sub, status: 'na' });

/** Roof and eaves height, plus the ground fall under the building. Returns 1-2 tiles; the first has status 'na' when there is nothing to show. */
export function heightTiles(lidar) {
  if (!lidar) return [na(PENDING.height)];
  if (lidar.status === 'unavailable') return [na(PENDING.height, lidar.reason ?? PENDING.height.sub)];
  if (lidar.status === 'unclear') return [{ id: 'roof-height', label: 'Roof and eaves height', value: 'Not clear from LiDAR', sub: lidar.reason, status: 'info' }];
  const pitched = lidar.roofShape === 'pitched';
  const sure = lidar.confidence === 'high' || lidar.confidence === 'medium';
  const tiles = [{
    id: 'roof-height', label: 'Roof and eaves height',
    value: pitched ? `Eaves about ${m(lidar.eavesM)}, ridge about ${m(lidar.ridgeM)}` : `Flat roof about ${m(lidar.ridgeM)}`,
    sub: `Height above ground from Environment Agency LiDAR (1 m grid, surveys 2000-2022): roof surface minus ground over the building outline`
      + `${lidar.shiftM >= 1 ? `, outline moved ${m(lidar.shiftM)} to fit the building` : ''}. Roughly +-0.5 m, and the survey may pre-date recent building work. `
      + `${lidar.confidence === 'low' ? 'Low confidence. ' : ''}It is used to test the "no higher than the existing roof / eaves" limits (GPDO A.1(c)-(d)); a result close to the limit is "too close to call", never a fail.`,
    status: sure ? 'ok' : 'info',
  }];
  if (lidar.groundFallM >= 0.3) tiles.push({ id: 'ground-fall', label: 'Ground level across the building', value: `Falls ${m(lidar.groundFallM)}`, sub: 'From the LiDAR ground model. Heights in the rules are measured from the highest ground next to the building, so a sloping site can add to them.', status: 'info' });
  return tiles;
}

/** Historic landfill ("made ground") tile. Returns null when the check did not run, so nothing is claimed. */
export function landfillTile(lf) {
  if (!lf || lf.status === 'unavailable') return null;
  const base = { id: 'landfill', label: 'Made ground (historic landfill)' };
  const src = lf.source ? ` Source: ${lf.source}.` : '';
  const one = (s) => `${s.name}${s.waste?.length ? ` (${s.waste.join(', ')} waste)` : ''}${s.surrendered ? `, licence surrendered ${s.surrendered.slice(0, 4)}` : ''}${s.gasControl ? ', gas control recorded' : ''}${s.leachate ? ', leachate control recorded' : ''}`;
  const list = lf.sites?.length ? ` ${lf.sites.map(one).join('; ')}.` : '';
  if (lf.status === 'inside') return { ...base, value: 'On a recorded landfill site', sub: `The address is inside a recorded historic landfill.${list} Filled ground can settle and give off gas, so foundations and gas protection need an engineer's advice, and a ground investigation is likely.${src}`, status: 'check' };
  if (lf.status === 'near') return { ...base, value: `Landfill within ${lf.nearM} m`, sub: `A recorded historic landfill lies within ${lf.nearM} m.${list} Landfill gas can travel; ask a building control officer or engineer whether gas protection applies.${src}`, status: 'check' };
  return { ...base, value: `None recorded within ${lf.nearM} m`, sub: `No recorded historic landfill site here or within ${lf.nearM} m (England only). Land filled without a record is not in the data, so this is not a ground investigation.${src}`, status: 'info' };
}

/** Plain-English list of the extra coal-mining findings (only what was found; unknown layers are not mentioned as clear). */
function coalDetailLine(d) {
  if (!d) return '';
  const found = [];
  if (Array.isArray(d.mineEntry) && d.mineEntry.length) found.push(`${d.mineEntry.length === 1 ? 'a recorded mine entry' : `${d.mineEntry.length} recorded mine entries`} (${[...new Set(d.mineEntry)].join(', ').toLowerCase()}) within ${d.mineEntryWithinM} m`);
  if (d.entryZone) found.push("a mine entry's zone of influence");
  if (d.pastWorkings) found.push('past shallow coal workings'); if (d.probableWorkings) found.push('probable shallow coal workings');
  if (d.fissures) found.push('a fissure or breakline'); if (d.outcrop) found.push('a coal outcrop');
  if (d.surfaceMining) found.push('past or current surface (open-cast) mining'); if (d.surfaceCoal) found.push('a surface coal resource area');
  if (d.reportingArea && !found.length) found.push('the coal mining reporting area (the Authority recommends a Mining Report)');
  return found.length ? ` Also at this spot: ${found.join('; ')}.` : '';
}

/** Coal mining risk tile. */
export function coalTile(coal) {
  if (!coal || coal.status === 'unavailable') return na(PENDING.coal, coal?.reason && !/not set up/.test(coal.reason) ? `${coal.reason} ${PENDING.coal.sub}` : PENDING.coal.sub);
  const base = { id: 'coal', label: 'Coal mining risk' };
  const src = (coalDetailLine(coal.details) + (coal.source ? ` Source: ${coal.source}.` : ''));
  if (coal.status === 'inside') return { ...base, value: 'Inside a high-risk area', sub: `Inside a coal mining Development High Risk Area. Planning applications here need a Coal Mining Risk Assessment, and a Mining Report is advisable before building.${src} The permitted-development verdict does not use it.`, status: 'check' };
  if (coal.status === 'near') return { ...base, value: `${coal.distanceM} m from a high-risk area`, sub: `Close to a Development High Risk Area; the outline is approximate, so treat it as possibly inside.${src}`, status: 'info' };
  return { ...base, value: 'Not in a high-risk area', sub: `Outside the mapped Development High Risk Areas. It may still be in the coalfield's low-risk area, and this is not a Mining Report.${src}`, status: 'info' };
}

/**
 * When the work is NOT wholly inside the registered title, the distance to the boundary has no meaning; say how far it goes over instead.
 * Rings are [lng, lat]. Returns null when every corner of the work is inside (or on) the title, or there is nothing to compare.
 * Corners only: a concave plot whose edge cuts across the work between two inside corners is not detected (the Map checks boundary rule does the full overlap).
 */
export function boundaryOverhang({ plotRings, proposalRing, toleranceM = 0.3 }) {
  const rings = (plotRings ?? []).filter((r) => r?.length > 3);
  if (!rings.length || !proposalRing?.length) return null;
  const c = proposalRing.reduce((a, p) => [a[0] + p[0] / proposalRing.length, a[1] + p[1] / proposalRing.length], [0, 0]);
  const proj = localProjector(c[1], c[0]), parts = rings.map((r) => openRing(r.map(proj)));
  let worst = 0, corners = 0;
  for (const v of openRing(proposalRing.map(proj))) {
    if (parts.some((pt) => pointInRing(v, pt) || ringEdgeDistance(v, pt) <= toleranceM)) continue;
    corners++; worst = Math.max(worst, Math.min(...parts.map((pt) => ringEdgeDistance(v, pt))));
  }
  return corners ? { corners, maxOutsideM: r1(worst) } : null;
}
