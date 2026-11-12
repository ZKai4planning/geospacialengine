import { pointInPoly, edgeDistanceAny, centroid } from '../../utils/polygons.js';
import { r1 } from './util.js';
import { META } from '../constraintsService.js';

/**
 * Constraint OUTLINES (conservation area, flood zone, SSSI, scheduled monument...) against the house / the work.
 *   inside  = the house (or the work) is inside the outline
 *   near    = the work is within 100 m of it
 * Datasets that already drive the permitted-development rules through the point lookup (conservation area, Article 4, listed building,
 * Green Belt, national park, AONB, World Heritage) only get their status here (for the drawing); the others also get a plain note.
 * result.areas = [{ id, dataset, label, status: clear|near|inside, distanceM }]
 */
const NEAR_M = 100;
const INSIDE_NOTE = {
  'flood-risk-zone': { status: 'warn', text: (l) => `The site is in a ${l.toLowerCase()}. A planning application may need a flood risk assessment – ask the council, or check the Environment Agency's standing advice for householder extensions.` },
  'site-of-special-scientific-interest': { status: 'warn', text: () => 'The site is inside a Site of Special Scientific Interest. The larger-home-extension prior-approval route is not available, and Natural England may need to be consulted.' },
  'scheduled-monument': { status: 'warn', text: () => 'The site is inside a scheduled monument. Scheduled monument consent from Historic England is needed for most works.' },
  'ancient-woodland': { status: 'info', text: () => 'The site is inside ancient woodland. Natural England and the Forestry Commission give standing advice; trees and root areas need particular care.' },
  'park-and-garden': { status: 'info', text: () => 'The site is in a registered historic park or garden. If planning permission is needed, the effect on its character will be considered.' },
  battlefield: { status: 'info', text: () => 'The site is in a registered battlefield. If planning permission is needed, the effect on its significance will be considered.' },
};
const NEAR_NOTE = {
  'listed-building-outline': (l, d) => `A listed building stands about ${d} m away. If planning permission is needed, the effect on its setting will be considered.`,
  'scheduled-monument': (l, d) => `A scheduled monument lies about ${d} m away. Works that affect its setting may need advice from Historic England.`,
  'ancient-woodland': (l, d) => `Ancient woodland lies about ${d} m away; root protection and construction access need care.`,
  'site-of-special-scientific-interest': (l, d) => `A Site of Special Scientific Interest lies about ${d} m away; Natural England may be consulted on larger work.`,
  'world-heritage-site': (l, d) => `A World Heritage Site lies about ${d} m away; its setting is protected in planning decisions.`,
};

export const areaRule = {
  id: 'areas',
  run({ P, H, areas = [] }, result) {
    if (!areas.length) return;
    const c = centroid(H?.length ? H : P), said = new Set();
    areas.forEach((a, i) => {
      const rec = result.areas[i], inside = a.parts.some((r) => pointInPoly(c, r) || P.some((v) => pointInPoly(v, r)));
      const d = inside ? 0 : edgeDistanceAny(P, a.parts);
      rec.distanceM = r1(d);
      rec.status = inside ? 'inside' : d <= NEAR_M ? 'near' : 'clear';
      if (said.has(`${a.dataset}:${rec.status}`) || rec.status === 'clear') return;
      said.add(`${a.dataset}:${rec.status}`);
      if (rec.status === 'inside' && INSIDE_NOTE[a.dataset]) result.items.push({ status: INSIDE_NOTE[a.dataset].status, message: INSIDE_NOTE[a.dataset].text(a.label) });
      else if (rec.status === 'near' && NEAR_NOTE[a.dataset]) result.items.push({ status: 'info', message: NEAR_NOTE[a.dataset](a.label, Math.round(d)) });
    });
    void META;
  },
};
