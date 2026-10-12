import { cached } from '../utils/cache.js';

const META = {
  'conservation-area': { label: 'Conservation area', impact: 'Tighter permitted-development limits; planning permission often needed.' },
  'listed-building-outline': { label: 'Listed building', impact: 'Listed building consent required for most works.' },
  'article-4-direction-area': { label: 'Article 4 direction', impact: 'Permitted-development rights may be withdrawn.' },
  'tree-preservation-zone': { label: 'Tree preservation order', impact: 'Consent needed to prune/fell protected trees.' },
  'flood-risk-zone': { label: 'Flood risk zone', impact: 'A flood risk assessment may be needed.' },
  'green-belt': { label: 'Green Belt', impact: 'Extensions must not be disproportionate.' },
  'national-park': { label: 'National park', impact: 'Treated as protected (Article 2(3)) land.' },
  'area-of-outstanding-natural-beauty': { label: 'National landscape (AONB)', impact: 'Treated as protected (Article 2(3)) land.' },
  'world-heritage-site': { label: 'World Heritage Site', impact: 'Treated as protected (Article 2(3)) land.' },
  'scheduled-monument': { label: 'Scheduled monument', impact: 'Scheduled monument consent may be needed.' },
  'site-of-special-scientific-interest': { label: 'SSSI', impact: 'Prior-approval extension route unavailable; Natural England may be consulted.' },
};
const PROTECTED = ['conservation-area', 'national-park', 'area-of-outstanding-natural-beauty', 'world-heritage-site'];

export function createConstraintsService({ providers }) {
  return {
    async check({ lat, lng }) {
      const key = `pd:${lat.toFixed(5)},${lng.toFixed(5)}`;
      const entities = await cached(key, () => providers.planningData.entitiesAt({ lat, lng }), 6 * 3600);
      const items = (entities ?? []).map((e) => ({ ...e, label: META[e.dataset]?.label ?? e.dataset, impact: META[e.dataset]?.impact ?? null }));
      const has = (d) => items.some((i) => i.dataset === d);
      return {
        source: 'planning.data.gov.uk',
        checkedAt: new Date().toISOString(),
        items,
        flags: {
          listedBuilding: has('listed-building-outline'),
          conservationArea: has('conservation-area'),
          article4: has('article-4-direction-area'),
          article23Land: PROTECTED.some(has),
          floodZone: has('flood-risk-zone'),
          tpo: has('tree-preservation-zone'),
          greenBelt: has('green-belt'),
          sssi: has('site-of-special-scientific-interest'),
          scheduledMonument: has('scheduled-monument'),
        },
      };
    },
  };
}
