import { pointInPoly, pointPolyDistance, polyToLineDistance } from '../../utils/polygons.js';
import { r1 } from './util.js';

/**
 * Pavements, paths and street furniture (post boxes, poles, lamps, cabinets, hydrants, bollards, dropped kerbs) near the work.
 *
 *  - An obstruction ON or within 0.3 m of the footprint is "in the way"; within 1.5 m "keep clear" (access, cables, working space).
 *  - A mapped path or pavement under the footprint is reported; a designated PUBLIC RIGHT OF WAY under it is a hard stop –
 *    it cannot be built over without the council diverting it first.
 *  - Everything else within reach is listed with its distance, so the numbers can be checked on site.
 * OpenStreetMap positions are a metre or two out and coverage is patchy, so "nothing found" is an info note, never a pass.
 *
 * result.street = { obstacles: [{ id, kind, label, status: clear|near|blocked, distanceM, inPlot }],
 *                   pathways:  [{ id, kind, label, widthM, widthSource, row, status: clear|near|crosses, distanceM }], crossesRow }
 */
export const streetRule = {
  id: 'street-features',
  run({ P, T, plot, pathways = [], obstacles = [], powerLines = [] }, result) {
    const st = result.street;
    const parts = plot ? plot.parts ?? [plot.local] : null;

    obstacles.forEach((o, i) => {
      const rec = st.obstacles[i], d = pointPolyDistance(o.xy, P);
      rec.distanceM = r1(d);
      rec.inPlot = parts ? parts.some((r) => pointInPoly(o.xy, r)) : null;
      if (!o.blocks) return;
      if (d <= T.obstacleBlockedM) rec.status = 'blocked';
      else if (d < T.obstacleNearM) rec.status = 'near';
    });
    const flagged = st.obstacles.filter((o) => o.status !== 'clear').sort((a, b) => a.distanceM - b.distanceM);
    for (const o of flagged.slice(0, 3)) {
      const cable = o.kind === 'pole' || o.kind === 'pylon' ? ' Overhead cables may run to it – ask the electricity network operator before building close.' : '';
      const owner = o.inPlot === false ? ' It belongs to the street or a utility, not to you, so the design would have to avoid it or it would have to be moved with the owner\'s agreement.' : o.inPlot ? ' Check on site whether it is yours.' : '';
      result.items.push({ status: 'warn', message: o.status === 'blocked'
        ? `A ${o.label.toLowerCase()} is mapped where the work would stand.${owner}${cable}`
        : `About ${o.distanceM} m from a ${o.label.toLowerCase()} – keep access and working space clear.${cable}` });
    }

    pathways.forEach((p, i) => {
      const rec = st.pathways[i], dCentre = polyToLineDistance(P, p.local), edge = Math.max(0, dCentre - p.widthM / 2);
      rec.distanceM = r1(edge);
      if (p.kind === 'crossing' || edge > T.pathRangeM) return;
      if (dCentre <= p.widthM / 2) rec.status = 'crosses';
      else if (edge < T.obstacleNearM) rec.status = 'near';
    });
    for (const p of st.pathways.filter((x) => x.status === 'crosses')) {
      if (p.private) continue;
      if (p.row) { st.crossesRow = true; result.items.push({ status: 'fail', message: `A public right of way (${p.label.toLowerCase()}${p.name ? `, ${p.name}` : ''}) runs through the footprint. It cannot be built over until the council has diverted it.` }); }
      else if (p.kind === 'pavement') result.items.push({ status: 'warn', message: `The footprint reaches onto a mapped pavement (about ${p.widthM} m wide${p.widthSource === 'assumed' ? ', assumed' : ''}). That is public land.` });
      else result.items.push({ status: 'warn', message: `A mapped ${p.label.toLowerCase()} crosses the footprint. Check whether it is a public right of way – if so it cannot be built over without a diversion order.` });
    }
    powerLines.forEach((l, i) => {                      // overhead lines: a safety matter before it is a planning one
      const rec = st.powerLines[i], d = polyToLineDistance(P, l.local);
      rec.distanceM = r1(d);
      if (d <= T.powerLineOverM) rec.status = 'over'; else if (d <= T.powerLineNearM) rec.status = 'near';
    });
    const hot = st.powerLines.filter((l) => l.status !== 'clear').sort((a, b) => a.distanceM - b.distanceM)[0];
    if (hot) result.items.push(hot.status === 'over'
      ? { status: 'warn', message: `An ${hot.label.toLowerCase()} passes over or right beside the work. Building or putting up scaffolding near live overhead cables is dangerous – ask the electricity network operator about safe distances before anything starts.` }
      : { status: 'info', message: `An ${hot.label.toLowerCase()} passes about ${hot.distanceM} m from the work. Ask the network operator for the safe working distance before scaffolding or working at height.` });

    const nearestPath = st.pathways.filter((p) => p.kind !== 'crossing' && p.status !== 'crosses' && p.distanceM != null && p.distanceM <= T.pathRangeM).sort((a, b) => a.distanceM - b.distanceM)[0];
    if (nearestPath) result.items.push({ status: 'info', message: `Nearest ${nearestPath.label.toLowerCase()}: ${nearestPath.distanceM} m from the work (about ${nearestPath.widthM} m wide, ${nearestPath.widthSource === 'osm' ? 'as mapped' : 'assumed'}).` });

    const listed = st.obstacles.filter((o) => o.status === 'clear' && o.distanceM != null && o.distanceM <= T.obstacleListM).sort((a, b) => a.distanceM - b.distanceM).slice(0, 5);
    if (listed.length) result.items.push({ status: 'info', message: `Street features nearby: ${listed.map((o) => `${o.label.toLowerCase()} ${o.distanceM} m`).join(', ')}.` });
    else if (!flagged.length) result.items.push({ status: 'info', message: 'No post boxes, poles, lamp posts or other street furniture are mapped near the work. OpenStreetMap coverage is incomplete – look for them on site.' });
  },
};
