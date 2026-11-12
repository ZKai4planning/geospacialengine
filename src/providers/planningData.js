import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';

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
export function createPlanningData({ fetchJson = defaultFetchJson } = {}) {
  return {
    name: 'planning.data.gov.uk',
    async entitiesAt({ lat, lng, datasets = CONSTRAINT_DATASETS }) {
      // We only need to know WHICH constraints apply, not their outlines (a conservation area can be 60 KB of WKT),
      // so ask the API to leave geometry out: `exclude_field` is part of the documented API.
      const data = await fetchJson(entityUrl([
        ['longitude', lng], ['latitude', lat], ['limit', 100],
        ...datasets.map((d) => ['dataset', d]),
        ['exclude_field', 'geometry'], ['exclude_field', 'point'],
      ]), { timeoutMs: 10000 });
      return (data?.entities ?? [])
        .filter((e) => isCurrent(e))
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
