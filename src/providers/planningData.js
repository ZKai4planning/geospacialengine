import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';
import { simplifyRing } from '../utils/simplify.js';

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

const toEntity = (e) => ({ dataset: e.dataset, entity: e.entity, reference: e.reference ?? null, name: e.name ?? null, url: `https://www.planning.data.gov.uk/entity/${e.entity}` });
/** [lng, lat] ring -> closed WKT POLYGON, thinned so the request URL stays short. */
export function ringToWkt(ring) {
  const r = simplifyRing(ring, { tolM: 1, maxPts: 60 });
  const pts = r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]];
  return `POLYGON((${pts.map(([lng, lat]) => `${Number(lng.toFixed(7))} ${Number(lat.toFixed(7))}`).join(',')}))`;
}

/** planning.data.gov.uk – national planning constraints that intersect a point, or any part of a plot outline. */
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
      return (data?.entities ?? []).filter((e) => isCurrent(e)).map(toEntity);
    },
    /** Same constraints, but for ANY part of the plot (`ring` = [[lng, lat], ...], e.g. the registered title polygon), not just the address point. */
    async entitiesWithin({ ring, datasets = CONSTRAINT_DATASETS }) {
      if (!ring || ring.length < 4) return [];
      const data = await fetchJson(entityUrl([
        ['geometry', ringToWkt(ring)], ['geometry_relation', 'intersects'], ['limit', 100],
        ...datasets.map((d) => ['dataset', d]),
        ['exclude_field', 'geometry'], ['exclude_field', 'point'],
      ]), { timeoutMs: 12000 });
      return (data?.entities ?? []).filter((e) => isCurrent(e)).map(toEntity);
    },
  };
}
