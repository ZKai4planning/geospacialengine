import { projector, open, pointPolyDistance, polyToLineDistance, edgeDistanceAny, polyArea } from '../utils/polygons.js';
import { ringCentroid } from '../utils/geo.js';
import { boundaryDistances } from './siteFacts.js';
import { heightTiles, coalTile, landfillTile, boundaryOverhang, PENDING } from './siteExtras.js';

/**
 * The site DASHBOARD: every measured street / site value in one place, so nothing hides inside a paragraph.
 * Distances are from the proposed work when there is one, otherwise from the house, and say which.
 *
 * A tile is { id, label, value, sub, status }:
 *   ok     measured from data
 *   check  worth attention (something is in the way, close, or crosses)
 *   info   found nothing / informational  ("none mapped" is never a pass: map coverage is incomplete)
 *   na     NOT AVAILABLE YET - a placeholder saying what data it needs
 */
const r1 = (n) => Math.round(n * 10) / 10;
const m = (n) => `${r1(n)} m`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SRC = (s) => (s === 'osm' ? 'as mapped' : 'assumed');

export const PLACEHOLDERS = [
  { id: 'sewers', label: 'Public sewers', sub: 'Needs the water company\'s sewer records (building over or within 3 m of a sewer needs their agreement).' },
  { id: 'underground', label: 'Underground cables and pipes', sub: 'Needs a utility record search (gas, electricity, water, telecoms).' },
  { id: 'roof-height', label: 'Roof and eaves height', sub: PENDING.height.sub },
  { id: 'ground', label: 'Ground conditions and subsidence', sub: 'Needs geology data (shrink-swell clay, made ground).' },
  { id: 'coal', label: 'Coal mining risk', sub: PENDING.coal.sub },
  { id: 'floor-plans', label: 'Floor plans and elevations', sub: 'Supplied by you or your designer: existing and proposed plans with dimensions.' },
];

export function buildDashboard({
  subjectRing, subjectKind = 'house', houseRing = null, plotRings = [], plotEstimated = false, frontBearingDeg = null,
  roads = [], pathways = [], obstacles = [], powerLines = [], trees = [], protectedTreeCount = 0, tpoZoneCount = 0,
  neighbours = [], outbuildings = [], areas = [], siteChecks = null, strips = [], lidar = null, coal = null, landfill = null,
}) {
  const sections = [];
  const tile = (id, label, value, sub, status = 'ok') => ({ id, label, value, sub, status });
  const na = (p) => ({ id: p.id, label: p.label, value: 'Not available yet', sub: p.sub, status: 'na' });
  if (!subjectRing || subjectRing.length < 4) return { subject: null, subjectKind: null, sections: [{ id: 'later', title: 'Not available yet', tiles: PLACEHOLDERS.map(na) }] };

  const c = ringCentroid(subjectRing), proj = projector(c.lat, c.lng), S = open(subjectRing.map(proj));
  const from = subjectKind === 'proposal' ? 'from the proposed work' : 'from the house';
  const pt = (o) => proj([o.lng, o.lat]);
  const st = siteChecks?.street;

  // ---- Road ----
  const roadTiles = [];
  const roadsHere = roads.filter((r) => !r.ignore && r.line?.length > 1).map((r) => ({ r, d: Math.max(0, polyToLineDistance(S, r.line.map(proj)) - (r.widthM ?? 5) / 2) })).sort((a, b) => a.d - b.d);
  const road = roadsHere[0];
  if (road) {
    roadTiles.push(tile('road', 'Nearest road', road.r.name ?? 'Unnamed road', road.r.classLabel ?? 'Local road (not recorded as A, B or C)', 'ok'));
    roadTiles.push(tile('road-width', 'Carriageway width', m(road.r.widthM ?? 5), `${SRC(road.r.widthSource)}${road.r.widthSource === 'osm' ? '' : ' from the road type'}`, 'ok'));
    roadTiles.push(tile('road-dist', `Road edge ${from}`, m(road.d), strips[0] ? 'Measured to the edge of the carriageway' : 'Straight-line distance to the carriageway edge', 'ok'));
  } else roadTiles.push(tile('road', 'Nearest road', 'None mapped', 'No road found near the property in the map data', 'info'));
  if (strips[0]) {
    roadTiles.push(tile('strip', 'Public strip (plot to carriageway)', m(strips[0].gapM), 'Pavement / verge between your boundary and the road. Public land: nothing can be built on it.', siteChecks?.publicLand?.status === 'on_public_land' ? 'check' : 'ok'));
    if (strips[0].frontageM) roadTiles.push(tile('frontage', 'Plot frontage facing the road', m(strips[0].frontageM), plotEstimated ? 'From an estimated outline' : 'From the registered title boundary (indicative)', 'ok'));
  } else roadTiles.push(tile('strip', 'Public strip (plot to carriageway)', 'Not available', 'Needs a plot outline and a road next to it', 'na'));
  sections.push({ id: 'road', title: 'Road', tiles: roadTiles });

  // ---- Pavement and paths ----
  const pathTiles = [];
  const pathDist = (p) => Math.max(0, polyToLineDistance(S, p.line.map(proj)) - p.widthM / 2);
  const ps = pathways.filter((p) => p.line?.length > 1).map((p) => ({ p, d: pathDist(p) }));
  const pave = ps.filter((x) => x.p.kind === 'pavement').sort((a, b) => a.d - b.d), others = ps.filter((x) => !['pavement', 'crossing'].includes(x.p.kind)).sort((a, b) => a.d - b.d);
  if (pave.length) pathTiles.push(tile('pavement', 'Pavement', `${m(pave[0].p.widthM)} wide`, `Nearest is ${m(pave[0].d)} ${from}; ${SRC(pave[0].p.widthSource)}. ${plural(pave.length, 'pavement section')} mapped.`, pave[0].d === 0 ? 'check' : 'ok'));
  else if (road?.r.sidewalk && road.r.sidewalk !== 'no') pathTiles.push(tile('pavement', 'Pavement', 'Tagged on the road', `The road is tagged with a pavement ("${road.r.sidewalk}") but it is not drawn separately; width assumed about 2 m.`, 'info'));
  else pathTiles.push(tile('pavement', 'Pavement', 'None mapped', 'No pavement in the map data. Look on site: coverage is incomplete.', 'info'));
  if (others.length) pathTiles.push(tile('paths', 'Footpaths, cycle paths, steps', plural(others.length, 'path'), `Nearest: ${others[0].p.label.toLowerCase()}, ${m(others[0].d)} ${from}.${others.some((x) => x.p.row) ? ' A public right of way is among them.' : ''}`, st?.crossesRow ? 'check' : 'ok'));
  else pathTiles.push(tile('paths', 'Footpaths, cycle paths, steps', 'None mapped', 'None in the map data near the property.', 'info'));
  const crossings = ps.filter((x) => x.p.kind === 'crossing' && x.d <= 30).length, dropped = obstacles.filter((o) => o.kind === 'dropped_kerb').length;
  pathTiles.push(tile('crossings', 'Crossings', String(crossings), crossings ? 'Pedestrian crossings within 30 m' : 'None mapped within 30 m', 'info'));
  pathTiles.push(tile('dropped', 'Dropped kerbs', String(dropped), dropped ? 'Vehicle crossings mapped nearby' : 'None mapped nearby', 'info'));
  sections.push({ id: 'paths', title: 'Pavement and paths', tiles: pathTiles });

  // ---- Street furniture ----
  const KINDS = [['post_box', 'Post boxes'], ['lamp', 'Lamp posts'], ['pole', 'Electricity / telephone poles'], ['cabinet', 'Street cabinets'], ['hydrant', 'Fire hydrants'], ['bollard', 'Bollards'], ['bus_stop', 'Bus stops'], ['pylon', 'Pylons']];
  const furn = KINDS.map(([kind, label]) => {
    const list = obstacles.filter((o) => o.kind === kind).map((o) => ({ o, d: pointPolyDistance(pt(o), S) })).sort((a, b) => a.d - b.d);
    const rec = list[0] && st?.obstacles?.find((x) => x.id === list[0].o.id);
    if (!list.length) return tile(kind, label, '0', 'None mapped. Look on site: coverage is incomplete.', 'info');
    return tile(kind, label, String(list.length), `Nearest ${m(list[0].d)} ${from}`, rec && rec.status !== 'clear' ? 'check' : 'ok');
  }).filter((t) => !(t.value === '0' && ['pylon', 'bollard', 'bus_stop', 'hydrant', 'cabinet'].includes(t.id)));   // keep the main four always; show rarer kinds only when present
  sections.push({ id: 'furniture', title: 'Street furniture and possible obstructions', tiles: furn });

  // ---- Cables ----
  const cableTiles = [];
  const lines = powerLines.filter((l) => l.line?.length > 1).map((l) => ({ l, d: polyToLineDistance(S, l.line.map(proj)) })).sort((a, b) => a.d - b.d);
  const poles = obstacles.filter((o) => o.kind === 'pole' || o.kind === 'pylon').length;
  if (lines.length) {
    const rec = st?.powerLines?.find((x) => x.id === lines[0].l.id);
    cableTiles.push(tile('cables', 'Overhead cables', plural(lines.length, 'line'), `Nearest: ${lines[0].l.label.toLowerCase()}${lines[0].l.voltage ? ` (${lines[0].l.voltage} V)` : ''}, ${m(lines[0].d)} ${from}. Ask the network operator for safe working distances before scaffolding.`, rec && rec.status !== 'clear' ? 'check' : 'ok'));
  } else cableTiles.push(tile('cables', 'Overhead cables', 'None mapped', poles ? `${plural(poles, 'pole')} mapped nearby, which usually carry cables: look up.` : 'None in the map data. Look on site.', poles ? 'check' : 'info'));
  cableTiles.push(tile('poles', 'Poles carrying cables', String(poles), poles ? 'Electricity / telephone poles and pylons mapped nearby' : 'None mapped nearby', 'info'));
  cableTiles.push(na(PLACEHOLDERS[1]));
  sections.push({ id: 'cables', title: 'Cables', tiles: cableTiles });

  // ---- Site, boundaries, neighbours ----
  const siteTiles = [];
  const bd = plotRings.length && !plotEstimated ? boundaryDistances({ plotRings, proposalRing: subjectRing, frontBearingDeg }) : null;
  if (bd) {
    siteTiles.push(tile('rear', `Rear boundary ${from}`, bd.rearM != null ? m(bd.rearM) : 'Not available', bd.rearM != null ? 'To the registered title boundary (indicative)' : 'Needs the direction the house faces', bd.rearM != null ? 'ok' : 'na'));
    siteTiles.push(tile('side', `Nearest side boundary ${from}`, bd.sideM != null ? m(bd.sideM) : 'Not available', bd.sideM != null ? 'To the registered title boundary (indicative)' : 'Needs the direction the house faces', bd.sideM != null ? 'ok' : 'na'));
    siteTiles.push(tile('front', `Front boundary ${from}`, bd.frontM != null ? m(bd.frontM) : 'Not available', 'To the registered title boundary (indicative)', bd.frontM != null ? 'ok' : 'na'));
  } else {
    const over = plotRings.length && !plotEstimated ? boundaryOverhang({ plotRings, proposalRing: subjectRing }) : null;
    if (over) siteTiles.push(tile('boundary', 'Distances to boundaries', `Goes up to ${m(over.maxOutsideM)} beyond the title`, `${subjectKind === 'proposal' ? 'Part of the proposed work' : 'Part of the house outline'} lies outside the registered title boundary (indicative: map and title positions can differ by a metre or two). Distances to the rear, side and front boundaries are given once it sits inside.`, 'check'));
    else siteTiles.push(tile('boundary', 'Distances to boundaries', 'Not available', plotEstimated ? 'The plot outline is only an estimate, so no distances are given.' : plotRings.length ? 'The boundary directions could not be worked out for this plot.' : 'Needs a registered title boundary.', 'na'));
  }
  const nb = neighbours.map((n) => ({ n, d: edgeDistanceAny(S, [open(n.ring.map(proj))]) })).sort((a, b) => a.d - b.d);
  const within = nb.filter((x) => x.d <= 30);
  siteTiles.push(tile('neighbours', 'Neighbouring buildings within 30 m', String(within.length), nb.length ? `Nearest ${m(nb[0].d)} ${from}${nb[0].d <= 0.3 ? ' – touching: party wall matters may apply' : ''}` : 'None mapped', nb.length && nb[0].d <= 0.3 ? 'check' : 'ok'));
  const ob = outbuildings.reduce((a, b) => a + (b.areaM2 ?? polyArea(open(b.ring.map(proj)))), 0);
  siteTiles.push(tile('outbuildings', 'Your outbuildings on the plot', String(outbuildings.length), outbuildings.length ? `${m(ob).replace(' m', ' m²')} in total (sheds, garages, earlier extensions)` : 'None found in the map data', 'info'));
  const nearTrees = trees.filter((t) => pointPolyDistance(pt(t), S) <= 30).length;
  siteTiles.push(tile('trees', 'Trees within 30 m', String(nearTrees), `${protectedTreeCount ? plural(protectedTreeCount, 'protected tree') : 'No individually protected trees'}${tpoZoneCount ? `; ${plural(tpoZoneCount, 'preservation zone')} nearby` : ''}`, protectedTreeCount || tpoZoneCount ? 'check' : 'info'));
  const inside = areas.filter((a) => siteChecks?.areas?.find((x) => x.id === a.id)?.status === 'inside'), near = areas.filter((a) => siteChecks?.areas?.find((x) => x.id === a.id)?.status === 'near');
  const uniq = (l) => [...new Set(l.map((a) => a.label))];
  siteTiles.push(tile('constraints', 'Constraint outlines', `${uniq(inside).length} inside, ${uniq(near).length} within 100 m`, [uniq(inside).length ? `Inside: ${uniq(inside).join(', ')}` : null, uniq(near).length ? `Near: ${uniq(near).join(', ')}` : null].filter(Boolean).join('. ') || 'None found in the national datasets (coverage varies by council)', inside.length ? 'check' : 'info'));
  const heights = heightTiles(lidar), coalT = coalTile(coal), later = [PLACEHOLDERS[0], PLACEHOLDERS[3], PLACEHOLDERS[5]].map(na);
  if (heights[0].status === 'na') later.splice(1, 0, heights[0]); else siteTiles.push(...heights);
  if (coalT.status === 'na') later.splice(later.length - 1, 0, coalT); else siteTiles.push(coalT);
  const landfillT = landfillTile(landfill);
  if (landfillT) siteTiles.push(landfillT); // shown only when the check ran: the ground-conditions placeholder below stays for the geology that is still missing
  sections.push({ id: 'site', title: 'Site, boundaries and surroundings', tiles: siteTiles });

  // ---- Not available yet ----
  sections.push({ id: 'later', title: 'Not available yet', tiles: later });
  return { subject: subjectKind, subjectKind, sections };
}
