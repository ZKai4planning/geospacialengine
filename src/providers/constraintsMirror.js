import { fetchJson as defaultFetchJson } from '../utils/http.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { parseWktPolygons } from '../utils/wkt.js';
import { pointInRing, ringAreaM2 } from '../utils/geo.js';
import { CONSTRAINT_DATASETS } from './planningData.js';

/** Datasets our own mirror (constraints.ai4planning.com) holds. Everything else still comes from planning.data.gov.uk. */
export const MIRRORED_DATASETS = ['conservation-area', 'listed-building-outline', 'tree-preservation-zone'];

/**
 * Client for our own constraints mirror (PostGIS behind a key). null when CONSTRAINTS_URL / CONSTRAINTS_KEY are not set.
 * query() resolves to { rows } or { outside: true } (point outside the area the mirror covers), and THROWS when the mirror is down,
 * the key is wrong or the answer is malformed, so callers can fall back. A failure is never returned as an empty list.
 */
export function createConstraintsClient({ url = config.constraintsUrl, key = config.constraintsKey, fetchJson = defaultFetchJson } = {}) {
  if (!url || !key) return null;
  return {
    name: 'constraints-mirror',
    async query(dataset, { lat, lng, radiusM = 0, geometry = false, limit = 20 }) {
      const qs = new URLSearchParams({ lon: String(lng), lat: String(lat), radius_m: String(radiusM), limit: String(limit) });
      if (geometry) qs.set('geometry', '1');
      const data = await fetchJson(`${url}/${dataset}?${qs}`, { headers: { 'x-api-key': key }, timeoutMs: 6000, retries: 1 });
      if (!data) throw new Error(`constraints mirror: unknown dataset ${dataset}`);
      if (data.status === 'outside_coverage') return { outside: true };
      if (data.status !== 'ok' || !Array.isArray(data.results)) throw new Error('constraints mirror: unexpected response');
      return { rows: data.results };
    },
  };
}

/**
 * Which constraints apply at a point. The three mirrored datasets come from our mirror (if it fails, from planning.data.gov.uk instead);
 * the rest still come from planning.data.gov.uk. If a source that is needed cannot answer, this THROWS (the app then shows its usual
 * "temporarily unavailable" note) rather than reporting "no constraints".
 */
export function createHybridPlanningData({ live, client }) {
  const rest = CONSTRAINT_DATASETS.filter((d) => !MIRRORED_DATASETS.includes(d));
  const asEntity = (dataset, e) => ({ dataset, entity: e.entity, reference: e.reference ?? null, name: e.name ?? null, url: `https://www.planning.data.gov.uk/entity/${e.entity}` });
  return {
    name: `${client.name}+${live.name}`,
    async entitiesAt({ lat, lng }) {
      const fromMirror = (async () => {
        try {
          const parts = await Promise.all(MIRRORED_DATASETS.map(async (d) => {
            const r = await client.query(d, { lat, lng, radiusM: 0 });
            if (r.outside) throw new Error('point outside mirror coverage');
            return r.rows.map((e) => asEntity(d, e));
          }));
          return parts.flat();
        } catch (e) {
          logger.warn({ err: e.message }, 'constraints mirror failed, using planning.data.gov.uk for those datasets');
          return null;
        }
      })();
      const [mirrored, others] = await Promise.all([fromMirror, live.entitiesAt({ lat, lng, datasets: rest })]);
      if (mirrored) return [...mirrored, ...others];
      return [...(await live.entitiesAt({ lat, lng, datasets: MIRRORED_DATASETS })), ...others];
    },
  };
}

/**
 * Registered title boundary from our mirror (Greater London only at the moment). `partial` tells the title chain that "nothing here"
 * is not a complete answer, so the next source is still asked and a total failure is still reported as a failure.
 */
export function createTitleMirror({ client }) {
  return {
    name: 'hmlr-title-mirror',
    partial: true,
    async findTitle({ lat, lng }) {
      const r = await client.query('title-boundary', { lat, lng, radiusM: 0, geometry: true, limit: 20 }); // throws if the mirror is down: the chain skips it
      if (r.outside) return null;
      const pt = [lng, lat];
      const hits = r.rows.map((e) => {
        const rings = parseWktPolygons(e.geometry);
        const ring = rings.find((x) => pointInRing(pt, x));
        return ring ? { e, rings, ring, areaM2: rings.reduce((s, x) => s + ringAreaM2(x), 0) } : null;
      }).filter(Boolean).sort((a, b) => a.areaM2 - b.areaM2); // flats can share a title: use the smallest one containing the point
      if (!hits.length) return null;
      const { e, rings, ring, areaM2 } = hits[0];
      return {
        source: 'hmlr-title-mirror', reference: e.reference ?? null, entity: e.entity ?? null, quality: null,
        ring, rings, areaM2: Math.round(areaM2),
        attribution: `Title boundaries © HM Land Registry, Crown copyright and database rights ${new Date().getFullYear()} (Open Government Licence v3.0). Indicative only.`,
      };
    },
  };
}
