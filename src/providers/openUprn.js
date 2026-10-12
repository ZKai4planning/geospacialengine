import { logger } from '../utils/logger.js';

const CHUNK = 500; // max points per batch query (db/schema.sql accepts at most 500)

/**
 * OS Open UPRN stored in Postgres (tables `uprn` + `uprn_meta`, functions `uprn_within` / `uprn_nearest_batch`
 * from db/schema.sql, loaded by `npm run import:uprn`).
 * It has coordinates only – no address text – so it is used to attach a UPRN to an address we found elsewhere.
 * If the database is unreachable or not set up, lookups log a warning and simply return nothing.
 * `db` is anything with query(text, params) -> { rows } (a node-postgres Pool).
 */
export function createOpenUprn({ db }) {
  const toPoint = (r) => ({ uprn: String(r.uprn), lat: r.lat_e7 / 1e7, lng: r.lng_e7 / 1e7 });
  const withDist = (r) => ({ ...toPoint(r), distM: Math.round(r.dist_m * 10) / 10 });

  let warned = false;
  const failed = (op, err) => {
    logger[warned ? 'debug' : 'warn']({ op, err: err?.message ?? String(err) }, 'OS Open UPRN lookup failed (is db/schema.sql applied and the data imported?)');
    warned = true;
  };

  /** All UPRN points within radiusM metres, nearest first. */
  async function within(lat, lng, radiusM) {
    try {
      const { rows } = await db.query('SELECT * FROM uprn_within($1, $2, $3)', [lat, lng, radiusM]);
      return rows.map(withDist).sort((a, b) => a.distM - b.distM);
    } catch (e) { failed('within', e); return []; }
  }

  /** nearest() for many points in as few round-trips as possible. Result[i] belongs to points[i]. */
  async function nearestMany(points, { maxM = 15, limit = 5 } = {}) {
    const out = points.map(() => []);
    const starts = [];
    for (let i = 0; i < points.length; i += CHUNK) starts.push(i);
    await Promise.all(starts.map(async (start) => {
      const slice = points.slice(start, start + CHUNK).map((p, k) => ({ idx: k, lat: p.lat, lng: p.lng }));
      try {
        const { rows } = await db.query('SELECT * FROM uprn_nearest_batch($1::jsonb, $2, $3)', [JSON.stringify(slice), maxM, limit]);
        for (const r of rows) out[start + r.idx]?.push(withDist(r));
      } catch (e) { failed('nearestMany', e); }
    }));
    return out.map((list) => list.sort((a, b) => a.distM - b.distM).slice(0, limit));
  }

  return {
    name: 'os-open-uprn',
    within,
    nearestMany,
    async nearest(lat, lng, { maxM = 15, limit = 5 } = {}) { return (await within(lat, lng, maxM)).slice(0, limit); },
    async byUprn(uprn) {
      try {
        const { rows } = await db.query('SELECT uprn, lat_e7, lng_e7 FROM uprn WHERE uprn = $1', [String(uprn)]);
        return rows[0] ? toPoint(rows[0]) : null;
      } catch (e) { failed('byUprn', e); return null; }
    },
    async stats() {
      try {
        const { rows } = await db.query('SELECT key, value FROM uprn_meta');
        const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        return meta.rows ? { rows: Number(meta.rows), source: meta.source, importedAt: meta.imported_at, bbox: meta.bbox ?? null } : null;
      } catch (e) { failed('stats', e); return null; }
    },
  };
}
