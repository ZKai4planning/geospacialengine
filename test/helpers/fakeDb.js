import { haversine } from '../../src/utils/geo.js';

/**
 * Minimal in-memory stand-in for a node-postgres Pool: query(sql, params) -> { rows }.
 * It mimics what db/schema.sql does (uprn_within, uprn_nearest_batch, application_patch, simple selects/inserts)
 * so the JS side can be tested without a database. It does NOT run the real SQL – test that against a real Postgres (see README).
 */
export function createFakeDb({ uprns = [] } = {}) {
  const tables = { uprn: uprns.map((u) => ({ uprn: String(u.uprn), lat_e7: Math.round(u.lat * 1e7), lng_e7: Math.round(u.lng * 1e7) })), uprn_meta: [], applications: [] };
  const calls = [];

  const within = (lat, lng, r) => tables.uprn
    .map((u) => ({ ...u, dist_m: haversine({ lat, lng }, { lat: u.lat_e7 / 1e7, lng: u.lng_e7 / 1e7 }) }))
    .filter((u) => u.dist_m <= Math.min(r, 1000)).sort((a, b) => a.dist_m - b.dist_m);

  return {
    tables, calls,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT * FROM uprn_within')) { calls.push('uprn_within'); return { rows: within(...params) }; }
      if (q.startsWith('SELECT * FROM uprn_nearest_batch')) {
        calls.push('uprn_nearest_batch');
        const [points, maxM, limit] = [JSON.parse(params[0]), params[1], params[2]];
        return { rows: points.flatMap((p) => within(p.lat, p.lng, maxM).slice(0, limit).map((r) => ({ idx: p.idx, ...r }))) };
      }
      if (q.startsWith('SELECT uprn, lat_e7, lng_e7 FROM uprn WHERE uprn =')) return { rows: tables.uprn.filter((u) => u.uprn === params[0]) };
      if (q.startsWith('SELECT key, value FROM uprn_meta')) return { rows: tables.uprn_meta };
      if (q.startsWith('INSERT INTO applications')) {
        if (!/^[0-9a-f-]{36}$/.test(params[0])) throw Object.assign(new Error('invalid uuid'), { code: '22P02' });
        tables.applications.push({ id: params[0], data: JSON.parse(params[1]) });
        return { rows: [] };
      }
      if (q.startsWith('SELECT data FROM applications')) {
        if (!/^[0-9a-f-]{36}$/.test(params[0])) throw Object.assign(new Error('invalid uuid'), { code: '22P02' });
        return { rows: tables.applications.filter((a) => a.id === params[0]).map((a) => ({ data: a.data })) };
      }
      if (q.startsWith('SELECT application_patch')) {
        const row = tables.applications.find((a) => a.id === params[0]);
        if (!row) return { rows: [{ data: null }] };
        row.data = { ...row.data, ...JSON.parse(params[1]) };
        return { rows: [{ data: row.data }] };
      }
      throw new Error(`fakeDb: unhandled SQL: ${q}`);
    },
  };
}
