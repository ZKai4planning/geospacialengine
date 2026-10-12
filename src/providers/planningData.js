import { fetchJson } from '../utils/http.js';

const BASE = 'https://www.planning.data.gov.uk/entity.json';

export const CONSTRAINT_DATASETS = [
  'conservation-area',
  'listed-building-outline',
  'article-4-direction-area',
  'tree-preservation-zone',
  'flood-risk-zone',
  'green-belt',
  'national-park',
  'area-of-outstanding-natural-beauty',
  'world-heritage-site',
  'scheduled-monument',
  'site-of-special-scientific-interest',
];

/** planning.data.gov.uk – national planning constraints that intersect a point. */
export function createPlanningData() {
  return {
    name: 'planning.data.gov.uk',
    async entitiesAt({ lat, lng }) {
      const u = new URL(BASE);
      u.searchParams.set('longitude', String(lng));
      u.searchParams.set('latitude', String(lat));
      u.searchParams.set('limit', '100');
      for (const d of CONSTRAINT_DATASETS) u.searchParams.append('dataset', d);
      const data = await fetchJson(u.toString(), { timeoutMs: 10000 });
      const today = new Date().toISOString().slice(0, 10);
      return (data?.entities ?? [])
        .filter((e) => !e['end-date'] || e['end-date'] > today)
        .map((e) => ({
          dataset: e.dataset,
          entity: e.entity,
          reference: e.reference ?? null,
          name: e.name ?? null,
          url: `https://www.planning.data.gov.uk/entity/${e.entity}`,
        }));
    },
  };
}
