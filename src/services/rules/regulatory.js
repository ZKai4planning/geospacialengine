import { edgeDistanceAny, polyArea, polyToLineDistance } from '../../utils/polygons.js';
import { r1 } from './util.js';

/**
 * Other approvals the work may trigger. These are reminders from the geometry, not planning tests, so they are listed
 * separately (result.regulatory) and never change the permitted-development verdict.
 *   - Party Wall etc. Act 1996: building against / on the boundary, or digging foundations within 3 m of a neighbour's building
 *   - Building Regulations (Approved Document B): walls and openings very close to a boundary
 *   - Community Infrastructure Levy: 100 m² or more of new floor area
 *   - things this tool cannot see (public sewers)
 */
export const regulatoryRule = {
  id: 'regulatory',
  run({ P, plot, roads = [], proposalInfo = {} }, result) {
    const reg = result.regulatory = [];
    const add = (id, message) => reg.push({ id, status: 'info', message });

    add('building-regs', 'Building Regulations approval (or a building notice) is separate from planning: it covers structure, fire, drainage and insulation, and is needed for most extensions even when planning permission is not.');

    const nb = (result.neighbours ?? []).filter((n) => n.distanceM != null).sort((a, b) => a.distanceM - b.distanceM)[0];
    const parts = plot && !plot.estimated ? plot.parts ?? [plot.local] : null;
    const toBoundary = parts ? edgeDistanceAny(P, parts) : null;
    const onBoundary = toBoundary != null && toBoundary <= 0.3;

    if (onBoundary || (nb && nb.distanceM <= 0.3)) add('party-wall', 'The work touches or sits on the boundary or the neighbouring building. If you build against or astride the boundary, or cut into a shared wall, you must serve notice on the neighbour under the Party Wall etc. Act 1996.');
    else if (nb && nb.distanceM <= 3) add('party-wall', `About ${r1(nb.distanceM)} m from the neighbouring building. Digging foundations within 3 m of it (below the level of its foundations) can need a party wall notice under the Party Wall etc. Act 1996.`);

    if (toBoundary != null && toBoundary < 1 && !onBoundary) add('fire-boundary', `About ${r1(toBoundary)} m from the boundary. Building Regulations (Approved Document B) limit windows and doors in walls this close to a boundary and may need fire-resistant walls.`);
    else if (onBoundary) add('fire-boundary', 'On the boundary: Building Regulations (Approved Document B) normally need a fire-resistant wall with no openings, and the roof edge may need protection.');

    const floor = polyArea(P) * (proposalInfo.storeys ?? 1);
    if (floor >= 100) add('cil', `About ${Math.round(floor)} m² of new floor area (footprint × storeys). Extensions of 100 m² or more can be liable for the Community Infrastructure Levy – ask the council.`);

    const main = roads.filter((r) => r.classified && !r.ignore).map((r) => ({ r, d: polyToLineDistance(P, r.local) - r.widthM / 2 })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d)[0];
    if (main) add('classified-road', `The work is next to ${main.r.classLabel}${main.r.name ? ` (${main.r.name})` : ''}. A new or altered vehicle access (dropped kerb or driveway) onto a classified road is not permitted development and needs the highway authority's consent; construction traffic and deliveries may also be restricted.`);

    add('sewer', 'Not checked: whether a public sewer runs under or near the site. Building over, or within 3 m of, a public sewer needs the water company\'s agreement – ask them before digging.');
  },
};
