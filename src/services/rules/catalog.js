import { THRESHOLDS } from './thresholds.js';

/**
 * Plain-language description of every site rule, used by the "engine room" view (what the rule asks, what data it reads, which numbers it uses, whether it can change the verdict)
 * and by GET /api/engine/rules. The rule code itself is in the files next to this one; this file only DESCRIBES it, so a rule with no entry still runs and is still traced
 * (it just shows its id). `measures(result, ctx)` lists what the rule measured, one line each, so a person can check the numbers.
 *
 * measure line = { label, value, status: 'pass'|'info'|'warn'|'fail', ref?: { kind, id|index } }   (`ref` lets the plan highlight the thing it is about)
 */
const m = (label, value, status = 'info', ref) => ({ label, value, status, ...(ref ? { ref } : {}) });
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dash = (v, unit = ' m') => (v == null ? '–' : `${v}${unit}`);

export const RULE_CATALOG = {
  neighbours: {
    title: 'Neighbouring buildings',
    question: 'Does the new work overlap, touch or crowd a neighbouring building?',
    data: 'OpenStreetMap building outlines within 8 m of the work',
    thresholds: { neighbourOverlapM2: 'overlap this big or bigger = "overlaps" (fail)', adjoinM: 'closer than this = "adjoins" (shared wall)', closeM: 'closer than this = "very close" (warning)', rangeM: 'neighbours further away than this are not examined' },
    affectsVerdict: false,
    limits: 'OpenStreetMap outlines can be a metre out, and a whole terrace is sometimes mapped as one building.',
    measures: (r) => r.neighbours.filter((n) => n.distanceM != null && n.status !== 'ignored' && n.distanceM <= THRESHOLDS.rangeM)
      .map((n) => m(`Building to the ${n.direction ?? 'side'}`, `${n.distanceM} m away${n.overlapM2 ? `, overlap ${n.overlapM2} m²` : ''}`, { overlap: 'fail', close: 'warn', adjoining: 'info', clear: 'pass' }[n.status] ?? 'info', { kind: 'neighbour', id: n.id })),
  },
  boundary: {
    title: 'Plot boundary',
    question: 'Does the work stay inside the registered title boundary?',
    data: 'HM Land Registry title boundary (INSPIRE parcels or planning.data.gov.uk); otherwise an estimated outline',
    thresholds: { boundaryToleranceM: 'anything within this of the title line is ignored (data accuracy)', boundaryCrossM2: 'area beyond the line at or above this = "crosses"' },
    affectsVerdict: true,
    limits: 'The title boundary is not the legal boundary. An ESTIMATED outline can only warn, never fail.',
    measures: (r) => (r.boundary.status === 'unavailable' ? [m('Boundary', 'none found', 'info')] : [
      m('Kind', r.boundary.estimated ? 'estimated outline (not a verdict)' : 'registered title', 'info'),
      m('Outside the line', `${r.boundary.outsideM2} m² (up to ${r.boundary.maxOutsideM} m)`, r.boundary.status === 'crosses' ? (r.boundary.estimated ? 'warn' : 'fail') : 'pass'),
      m('Nearest boundary line', dash(r.boundary.minDistanceM), 'info'),
    ]),
  },
  'wall-safety': {
    title: 'Wall safety',
    question: 'Is any new outside wall built against a neighbour, on the boundary line, or close enough to it to raise fire or maintenance problems?',
    data: 'The wall-by-wall geometry of the proposal, neighbouring building outlines, and the REGISTERED title boundary (never an estimate)',
    thresholds: { wallTouchM: 'a wall this close to a neighbour / the title line is "against" it', wallContactMinM: '... for at least this much of its length', wallFireM: 'closer than this to a boundary or neighbour wall: Approved Document B limits openings', rangeM: 'neighbours further away than this are not examined' },
    affectsVerdict: false,
    limits: 'Guidance only: Party Wall etc. Act and Approved Document B are separate regimes. Positions are only as good as the map data.',
    measures: (r) => r.walls.map((w) => {
      const lab = `${cap(w.facing)} wall, ${w.lengthM} m`;
      if (w.kind === 'internal') return m(lab, 'joins your house (not an outside wall)', 'info', { kind: 'wall', index: w.index });
      const bits = [];
      if (w.neighbour) bits.push(`neighbour ${w.neighbour.distanceM} m${w.neighbour.contactM ? ` (${w.neighbour.contactM} m touching)` : ''}`);
      if (w.boundary) bits.push(`boundary ${w.boundary.distanceM} m${w.boundary.contactM ? ` (${w.boundary.contactM} m on the line)` : ''}`);
      const word = { overlaps_neighbour: 'runs into a neighbour', touches_neighbour: 'TOUCHES a neighbour', on_boundary: 'ON the boundary', within_1m: 'within 1 m of the boundary', close_neighbour: 'narrow gap to a neighbour', clear: 'clear', unchecked: 'nothing to compare with' }[w.status];
      return m(lab, `${word}${bits.length ? ' · ' + bits.join(' · ') : ''}`, { overlaps_neighbour: 'fail', touches_neighbour: 'warn', on_boundary: 'warn', within_1m: 'warn', close_neighbour: 'warn', clear: 'pass', unchecked: 'info' }[w.status] ?? 'info', { kind: 'wall', index: w.index });
    }),
  },
  roads: {
    title: 'Roads',
    question: 'Does the work reach onto, or very near, the mapped carriageway?',
    data: 'OpenStreetMap road centrelines + half the tagged (or typical) width',
    thresholds: { roadOverlapM: 'reaching this far onto the carriageway = fail', roadCloseM: 'closer than this to its edge = warning', roadRangeM: 'roads further away are not examined' },
    affectsVerdict: false, limits: 'Road widths are estimates; private driveways are ignored.',
    measures: (r) => r.roads.filter((x) => x.distanceM != null && x.status !== 'ignored' && x.distanceM <= THRESHOLDS.roadRangeM).map((x) => m(x.name ?? 'Road', `${x.distanceM} m from the edge`, { overlap: 'fail', close: 'warn', clear: 'pass' }[x.status] ?? 'info', { kind: 'road', id: x.id })),
  },
  'public-land': {
    title: 'Public land in front of the plot',
    question: 'Is any of the work on the pavement / verge strip between the plot and the road?',
    data: 'Plot outline (registered or estimated) and road edge',
    thresholds: {}, affectsVerdict: true, limits: 'With an estimated plot this can only warn.',
    measures: (r) => [m('Result', r.publicLand.status.replace(/_/g, ' '), r.publicLand.status === 'on_public_land' ? (r.publicLand.estimated ? 'warn' : 'fail') : 'info'),
      ...(r.publicLand.areaM2 ? [m('Area on public land', `${r.publicLand.areaM2} m²`, 'warn')] : [])],
  },
  'street-features': {
    title: 'Pavements, paths and street furniture',
    question: 'Is a post box, pole, lamp, path or right of way in the way?',
    data: 'OpenStreetMap paths and street furniture within ~25 m',
    thresholds: { obstacleBlockedM: 'on or this close to the footprint = in the way', obstacleNearM: 'closer than this = keep clear', powerLineOverM: 'overhead line this close or over the work', powerLineNearM: 'within this: ask the network operator' },
    affectsVerdict: true, limits: 'Street furniture coverage in OpenStreetMap is patchy. "None mapped" is never a pass.',
    measures: (r) => [
      ...r.street.obstacles.filter((o) => o.status !== 'clear').map((o) => m(o.label, `${o.distanceM} m`, o.status === 'blocked' ? 'fail' : 'warn', { kind: 'obstacle', id: o.id })),
      ...r.street.pathways.filter((p) => p.status !== 'clear').map((p) => m(p.label, p.status === 'crosses' ? 'under the work' : `${p.distanceM} m`, p.status === 'crosses' ? (p.row ? 'fail' : 'warn') : 'info')),
      ...r.street.powerLines.filter((l) => l.status !== 'clear').map((l) => m(l.label, `${l.distanceM} m`, 'warn')),
    ],
  },
  areas: {
    title: 'Constraint outlines',
    question: 'Is the site inside, or near, a conservation area, flood zone, SSSI, monument...?',
    data: 'planning.data.gov.uk outlines (simplified)',
    thresholds: {}, affectsVerdict: false, limits: 'Outline coverage varies by council. The point lookup that drives the verdict is separate.',
    measures: (r) => r.areas.filter((a) => a.status !== 'clear').map((a) => m(a.label, a.status === 'inside' ? 'inside' : `near (${a.distanceM} m)`, a.status === 'inside' ? 'warn' : 'info')),
  },
  'tpo-zones': {
    title: 'Tree preservation zones',
    question: 'Is the work inside an area where trees are protected?',
    data: 'Council tree-preservation zone polygons',
    thresholds: { tpoZoneNearM: 'outside a zone but closer than this = "close to"' }, affectsVerdict: false,
    limits: 'A zone says protected trees are somewhere in it, not where.',
    measures: (r) => r.zones.filter((z) => z.status !== 'clear').map((z) => m(`Zone ${z.order ?? z.id}`, z.status === 'inside' ? 'inside' : `${z.distanceM} m`, z.status === 'inside' ? 'warn' : 'info')),
  },
  trees: {
    title: 'Trees',
    question: 'Is the work on a trunk or inside a tree\'s root protection area?',
    data: 'OpenStreetMap trees and council protected trees',
    thresholds: { treeOnTrunkM: 'trunk this close to the footprint = built on the tree', treeRangeM: 'trees further than their root zone + this are not examined' },
    affectsVerdict: false, limits: 'Root radius = 12 x trunk diameter (2-15 m). An unmapped tree is not seen.',
    measures: (r) => r.trees.filter((t) => t.distanceM != null && t.status !== 'clear').map((t) => m(`${t.protected ? 'Protected tree' : 'Tree'}${t.species ? ` (${t.species})` : ''}`, `${t.distanceM} m · root zone ${t.radiusM} m`, t.status === 'blocked' ? 'fail' : 'warn', { kind: 'tree', id: t.id })),
  },
  'forty-five': {
    title: '45-degree rule',
    question: 'Does the extension cut across a 45° line from the neighbour\'s nearest window?',
    data: 'The neighbour window you marked on the map',
    thresholds: {}, affectsVerdict: false, limits: 'Council guidance, not a permitted-development test.',
    measures: (r) => [m('Result', r.fortyFive.status ?? 'unavailable', r.fortyFive.status === 'breach' ? 'warn' : 'info')],
  },
  regulatory: {
    title: 'Other approvals',
    question: 'What else might this need (Building Regulations, Party Wall Act, CIL, sewers)?',
    data: 'The same geometry, plus road class', thresholds: {}, affectsVerdict: false,
    limits: 'Reminders only: none of these change the permitted-development verdict.',
    added: (r) => (r.regulatory ?? []).map((x) => ({ status: x.status, message: x.message })),
    measures: (r) => (r.regulatory ?? []).map((x) => m(x.id, x.message.slice(0, 90) + (x.message.length > 90 ? '…' : ''), 'info')),
  },
};

/** Catalog entry for a rule id (custom rules get a generic one). Thresholds are expanded to [{ key, value, meaning }]. */
export function describeRule(id) {
  const c = RULE_CATALOG[id] ?? { title: id, question: 'A custom rule.', data: 'see src/services/rules/custom.js', thresholds: {}, affectsVerdict: false, limits: '' };
  return { id, ...c, thresholds: Object.entries(c.thresholds ?? {}).map(([key, meaning]) => ({ key, value: THRESHOLDS[key], meaning })) };
}
