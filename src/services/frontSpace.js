/**
 * "Is there any private land in front of the door?"  (front porches)
 *
 * Many older terraces and corner houses have their front door straight onto the pavement. A porch would then stand on the
 * footway / highway, so it can never be permitted development (GPDO Class D: no part within 2 m of a boundary that adjoins a
 * highway) and cannot simply be built. Instead of drawing the porch and listing a string of failed checks, we say it plainly.
 *
 * Two confidence levels, because the data behind them differs:
 *   certain : the porch reaches onto the mapped carriageway, or the REGISTERED title boundary runs along the front wall and the
 *             porch stands (almost) entirely outside it.
 *   likely  : only an ESTIMATED plot outline is crossed, or the porch is within ~1 m of the carriageway edge. An estimate is
 *             never a verdict (see rules/boundary.js), so this only warns.
 *
 * Input: the proposal and the result of runSiteChecks (map.siteChecks). Returns null when nothing points to a problem.
 */
export const NO_FRONT_SPACE = "There's no private land in front of the door, so a porch can't be added without using the highway.";
export const MAYBE_NO_FRONT_SPACE = 'There may be no private land in front of the door. If the front wall is on the edge of the pavement, a porch can\'t be added without using the highway.';

const NEXT = 'It can\'t be permitted development, and it would need planning permission plus the agreement of the highway authority – speak to the council before applying.';
const CHECK_ON_SITE = 'Check where your boundary runs on site or on the title plan.';

export function frontSpaceCheck({ proposal, siteChecks }) {
  if (proposal?.type !== 'front_porch' || !siteChecks) return null;
  const depth = proposal.depthM ?? 0, area = (proposal.widthM ?? 0) * depth;
  const b = siteChecks.boundary ?? {};
  const roads = siteChecks.roads ?? [];

  const onRoad = roads.filter((r) => r.status === 'overlap').sort((a, z) => (z.intoM ?? 0) - (a.intoM ?? 0))[0];
  if (onRoad) {
    const reason = `On the map the porch reaches about ${onRoad.intoM ?? 'some'} m onto the road${onRoad.name ? ` (${onRoad.name})` : ''}.`;
    return { level: 'certain', basis: 'road', headline: NO_FRONT_SPACE, reason, message: `${NO_FRONT_SPACE} ${reason} ${NEXT}` };
  }

  // the strip between the plot and the road is public land: any real intrusion into it is a verdict on a registered title
  const pub = siteChecks.publicLand;
  if (pub?.status === 'on_public_land' && !pub.estimated) {
    const reason = `The land between your registered title boundary and the road${pub.roadName ? ` (${pub.roadName})` : ''} is public (pavement / highway), and the porch would stand about ${pub.maxIntoM} m into it.`;
    return { level: 'certain', basis: 'public-land', headline: NO_FRONT_SPACE, reason, message: `${NO_FRONT_SPACE} ${reason} ${NEXT}` };
  }

  // registered title boundary on the front wall: the porch stands (almost) wholly outside it
  const titleKnown = !b.estimated && b.status === 'crosses';
  if (titleKnown && area > 0 && b.maxOutsideM >= 0.8 * depth && b.outsideM2 >= 0.6 * area) {
    const reason = `The registered title boundary runs along the front wall, so the porch would stand about ${b.maxOutsideM} m outside your property.`;
    return { level: 'certain', basis: 'title', headline: NO_FRONT_SPACE, reason, message: `${NO_FRONT_SPACE} ${reason} ${NEXT}` };
  }

  const nearRoad = roads.filter((r) => r.status === 'close').sort((a, z) => a.distanceM - z.distanceM)[0];
  if ((b.estimated && b.status === 'crosses') || (pub?.status === 'on_public_land' && pub.estimated) || nearRoad) {
    const reason = nearRoad ? `The porch would be within about ${nearRoad.distanceM} m of the edge of the road.` : 'The porch sticks out past the estimated plot outline.';
    return { level: 'likely', basis: nearRoad ? 'near-road' : 'estimate', headline: MAYBE_NO_FRONT_SPACE, reason, message: `${MAYBE_NO_FRONT_SPACE} ${reason} ${CHECK_ON_SITE}` };
  }
  return null;
}

/**
 * Any OTHER footprint work (extensions, outbuildings) that reaches onto the strip between the plot and the road.
 * Returns { level, reason, message } or null. Porches are handled by frontSpaceCheck above.
 */
export const PUBLIC_LAND = "Part of the work would be on public land (the pavement or highway), which isn't yours to build on.";
export function publicLandCheck({ proposal, siteChecks }) {
  const pub = siteChecks?.publicLand;
  if (!proposal || proposal.type === 'front_porch' || pub?.status !== 'on_public_land') return null;
  const road = pub.roadName ? ` (${pub.roadName})` : '';
  const reason = `About ${pub.areaM2} m² of it, up to ${pub.maxIntoM} m past the front of the plot, falls on the land between the plot and the road${road}.`;
  return pub.estimated
    ? { level: 'likely', reason, message: `${PUBLIC_LAND} ${reason} The plot outline is only an estimate, so check where your boundary runs.` }
    : { level: 'certain', reason, message: `${PUBLIC_LAND} ${reason} It can't be permitted development or built without the highway authority's agreement.` };
}

/**
 * Work that sticks out beyond the plot (any direction). Registered title = certain; an estimated outline = likely (warn only).
 * Not used for the strip towards the road, which publicLandCheck / frontSpaceCheck already explain more specifically.
 */
export const OUTSIDE_PLOT = "Part of the work is outside the registered title boundary, on land that isn't the applicant's.";
export function outsidePlotCheck({ proposal, siteChecks }) {
  const b = siteChecks?.boundary;
  if (!proposal || b?.status !== 'crosses') return null;
  const reason = `About ${b.outsideM2} m² of it, up to ${b.maxOutsideM} m past the boundary, is on land outside the plot.`;
  return b.estimated
    ? { level: 'likely', reason, message: `${OUTSIDE_PLOT} ${reason} The plot outline is only an estimate, so check where your boundary runs.` }
    : { level: 'certain', reason, message: `${OUTSIDE_PLOT} ${reason} It can't be permitted development; it would need the owner's agreement and planning permission with the correct ownership notice.` };
}

/**
 * Pavements, paths and street furniture as a verdict input.
 *  - a designated public right of way under the footprint = certain (not permitted development; it has to be diverted first)
 *  - a post box / pole / lamp / cabinet in the way, or a mapped path crossing = likely (map positions are a metre or two out)
 */
export function streetCheck({ proposal, siteChecks }) {
  const st = siteChecks?.street;
  if (!proposal || !st) return null;
  const row = st.pathways.find((p) => p.status === 'crosses' && p.row && !p.private);
  if (row) return { level: 'certain', reason: 'A public right of way runs through the footprint.', message: `A public right of way (${row.label.toLowerCase()}) runs through the footprint. It can't be permitted development: the council would have to divert the path before anything is built over it.` };
  const blocked = st.obstacles.filter((o) => o.status === 'blocked');
  if (blocked.length) {
    const names = [...new Set(blocked.map((o) => o.label.toLowerCase()))].join(', ');
    return { level: 'likely', reason: `A ${names} is mapped where the work would stand.`, message: `A ${names} is mapped where the work would stand. It belongs to the street or a utility, so check the position on site; moving it needs the owner's agreement.` };
  }
  const cable = (st.powerLines ?? []).find((l) => l.status === 'over');
  if (cable) return { level: 'likely', reason: `An ${cable.label.toLowerCase()} passes over or beside the work.`, message: `An ${cable.label.toLowerCase()} passes over or right beside the work. Ask the electricity network operator about safe distances before building or putting up scaffolding.` };
  const path = st.pathways.find((p) => p.status === 'crosses' && !p.private && p.kind !== 'pavement');
  if (path) return { level: 'likely', reason: `A mapped ${path.label.toLowerCase()} crosses the footprint.`, message: `A mapped ${path.label.toLowerCase()} crosses the footprint. Check whether it is a public right of way – if so it can't be built over without a diversion order.` };
  return null;
}
