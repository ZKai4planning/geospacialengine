import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { parseWktPolygons, wktSquare } from '../utils/wkt.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';
import { simplifyRing } from '../utils/simplify.js';

/**
 * The OUTLINES of national planning constraints around the property, from planning.data.gov.uk, so they can be drawn on the plan
 * (constraintsService only answers "which constraints apply at this point"). One request, all datasets, area search by WKT.
 * Coverage varies by council: "none drawn" never means "none apply".
 */
export const AREA_DATASETS = [
  'conservation-area', 'listed-building-outline', 'article-4-direction-area', 'flood-risk-zone', 'green-belt', 'national-park',
  'area-of-outstanding-natural-beauty', 'world-heritage-site', 'scheduled-monument', 'site-of-special-scientific-interest',
  'ancient-woodland', 'park-and-garden', 'battlefield',
];
const LABEL = {
  'conservation-area': 'Conservation area', 'listed-building-outline': 'Listed building', 'article-4-direction-area': 'Article 4 direction area', 'flood-risk-zone': 'Flood risk zone',
  'green-belt': 'Green Belt', 'national-park': 'National park', 'area-of-outstanding-natural-beauty': 'National landscape (AONB)', 'world-heritage-site': 'World Heritage Site',
  'scheduled-monument': 'Scheduled monument', 'site-of-special-scientific-interest': 'SSSI', 'ancient-woodland': 'Ancient woodland', 'park-and-garden': 'Registered park and garden', battlefield: 'Registered battlefield',
};
export const areaLabel = (dataset, e = {}) => {
  const base = LABEL[dataset] ?? dataset;
  if (dataset === 'flood-risk-zone' && e.level) return `Flood zone ${e.level}`;
  if (dataset === 'listed-building-outline' && e.grade) return `Listed building (Grade ${String(e.grade).replace(/^grade\s*/i, '')})`;
  return base;
};
const text = (v) => (v == null || v === '' ? null : String(v));

/** One API entity -> drawable areas (one per outer ring group), or []. */
export function areaFromEntity(e) {
  const rings = parseWktPolygons(e.geometry).map((r) => simplifyRing(r, { tolM: 2, maxPts: 300 }));
  if (!rings.length) return null;
  const details = {
    level: text(e['flood-risk-level'] ?? e['flood-zone'] ?? e['flood-risk-zone']), grade: text(e['listed-building-grade'] ?? e.grade),
    rights: text(e['permitted-development-rights']), notes: text(e.notes ?? e.description),
    documentUrl: text(e['document-url'] ?? e['documentation-url'] ?? e['article-4-direction-document-url']), direction: text(e['article-4-direction']), startDate: text(e['start-date']),
  };
  return {
    id: `area-${e.entity}`, dataset: e.dataset, entity: e.entity, reference: text(e.reference), name: text(e.name), label: areaLabel(e.dataset, details), details, rings,
    url: `https://www.planning.data.gov.uk/entity/${e.entity}`,
  };
}

export function createConstraintAreas({ fetchJson = defaultFetchJson } = {}) {
  return {
    name: 'planning.data.gov.uk-areas',
    async findNear({ lat, lng, radiusM = 250 }) {
      const data = await fetchJson(entityUrl([['geometry', wktSquare(lat, lng, radiusM)], ['geometry_relation', 'intersects'], ['limit', 200], ...AREA_DATASETS.map((d) => ['dataset', d])]), { timeoutMs: 15000 });
      return (data?.entities ?? []).filter((e) => isCurrent(e) && AREA_DATASETS.includes(e.dataset)).map(areaFromEntity).filter(Boolean).slice(0, 40);
    },
  };
}
