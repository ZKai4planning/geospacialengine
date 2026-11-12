import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { pointInRing, ringAreaM2 } from '../utils/geo.js';
import { parseWktPolygons } from '../utils/wkt.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';

export { parseWktPolygons }; // kept here for existing imports

/**
 * HM Land Registry title boundaries (INSPIRE index polygons) via planning.data.gov.uk, dataset `title-boundary`.
 * Indicative only: a title boundary is NOT the legal boundary. Coverage is still partial in this dataset, so `null` is a normal answer.
 *
 * A title can be made of several separate pieces (MULTIPOLYGON), e.g. a house and a detached garage. We return all of them as `rings`
 * so a proposal reaching into another piece of the SAME title is not reported as "outside". `ring` is the piece containing the point.
 */
export function createTitleBoundary({ fetchJson = defaultFetchJson } = {}) {
  return {
    name: 'hmlr-title-boundary',
    async findTitle({ lat, lng }) {
      const data = await fetchJson(entityUrl([['dataset', 'title-boundary'], ['longitude', lng], ['latitude', lat], ['limit', 20]]), { timeoutMs: 10000 });
      const pt = [lng, lat];
      const hits = (data?.entities ?? [])
        .filter((e) => isCurrent(e))
        .map((e) => {
          const rings = parseWktPolygons(e.geometry);
          const ring = rings.find((r) => pointInRing(pt, r));
          return ring ? { e, rings, ring, areaM2: rings.reduce((s, r) => s + ringAreaM2(r), 0) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.areaM2 - b.areaM2); // flats can share a title: use the smallest one containing the point
      if (!hits.length) return null;
      const { e, rings, ring, areaM2 } = hits[0];
      return {
        source: 'hmlr-title-boundary', reference: e.reference ?? null, entity: e.entity ?? null, quality: e.quality ?? null,
        ring, rings, areaM2: Math.round(areaM2),
        attribution: `Title boundaries © HM Land Registry, Crown copyright and database rights ${new Date().getFullYear()} (via planning.data.gov.uk, Open Government Licence v3.0). Indicative only.`,
      };
    },
  };
}
