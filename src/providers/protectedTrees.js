import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { ringAreaM2, ringCentroid } from '../utils/geo.js';
import { parseWktPolygons, parseWktPoint, wktSquare } from '../utils/wkt.js';
import { entityUrl, isCurrent } from '../utils/planningDataApi.js';
import { logger } from '../utils/logger.js';

const TREE_MAX_CROWN_M2 = 700; // a "tree" outline bigger than this is not one tree: use its centre only

/**
 * Legally protected trees from planning.data.gov.uk (council tree preservation order data):
 *   - dataset `tree-preservation-zone`: polygons (type area / group / woodland) where a TPO applies
 *   - dataset `tree`: individual protected trees (a `point` and/or an outline), `felled-date` set when removed
 * Coverage depends on which councils publish, so "none found" never means "none exist".
 * Area search = documented `geometry` (WKT) + `geometry_relation=intersects`.
 */
export function createProtectedTrees({ fetchJson = defaultFetchJson, mirror = null } = {}) {
  const search = (dataset, lat, lng, radiusM) =>
    fetchJson(entityUrl([['dataset', dataset], ['geometry', wktSquare(lat, lng, radiusM)], ['geometry_relation', 'intersects'], ['limit', 100]]), { timeoutMs: 10000 });

  // Zones: our own mirror first (needs no rate limit and survives a planning.data.gov.uk outage); on any mirror failure or a point outside
  // its coverage, the live service answers instead. A failure is never turned into an empty list.
  const zonesAt = async (lat, lng, radiusM) => {
    if (mirror) {
      try {
        const r = await mirror.query('tree-preservation-zone', { lat, lng, radiusM, geometry: true, limit: 100 });
        if (!r.outside) return { entities: r.rows.map((e) => ({ ...e, dataset: 'tree-preservation-zone' })) };
      } catch (e) { logger.warn({ err: e.message }, 'constraints mirror failed for tree zones, using planning.data.gov.uk'); }
    }
    return search('tree-preservation-zone', lat, lng, radiusM);
  };

  return {
    name: mirror ? 'constraints-mirror+planning.data.gov.uk-tpo' : 'planning.data.gov.uk-tpo',
    async findNear({ lat, lng, radiusM = 60 }) {
      const [zoneData, treeData] = await Promise.all([
        zonesAt(lat, lng, radiusM),
        search('tree', lat, lng, radiusM),
      ]);

      const zones = (zoneData?.entities ?? []).filter((e) => isCurrent(e)).flatMap((e) => {
        const rings = parseWktPolygons(e.geometry);
        if (!rings.length) return [];
        return [{
          id: `tpo-zone-${e.entity}`, entity: e.entity, reference: e.reference ?? null, name: e.name ?? null,
          type: e['tree-preservation-zone-type'] || null, order: e['tree-preservation-order'] || null,
          rings, url: `https://www.planning.data.gov.uk/entity/${e.entity}`,
        }];
      });

      const trees = (treeData?.entities ?? []).filter((e) => isCurrent(e) && !e['felled-date']).flatMap((e) => {
        const rings = parseWktPolygons(e.geometry);
        let pos = parseWktPoint(e.point);
        let crownDiameterM = null;
        if (rings.length) {
          const area = ringAreaM2(rings[0]);
          if (area >= 1 && area <= TREE_MAX_CROWN_M2) crownDiameterM = Math.round(2 * Math.sqrt(area / Math.PI) * 10) / 10;
          if (!pos) { const c = ringCentroid(rings[0]); pos = [c.lng, c.lat]; }
        }
        if (!pos) return [];
        return [{
          id: `tpo-tree-${e.entity}`, entity: e.entity, reference: e.reference ?? null, order: e['tree-preservation-order'] || null,
          lng: pos[0], lat: pos[1], trunkDiameterM: null, crownDiameterM, species: null, protected: true,
          url: `https://www.planning.data.gov.uk/entity/${e.entity}`,
        }];
      });

      return { zones, trees };
    },
  };
}
