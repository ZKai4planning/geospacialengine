import { localProjector, pointInRing, ringEdgeDistance, openRing } from '../utils/geomLite.js';
import { logger } from '../utils/logger.js';

/**
 * Is this point inside a coal mining Development High Risk Area (Mining Remediation Authority, formerly the Coal Authority)?
 *
 * Answers { status: 'inside' | 'near' | 'outside' | 'unavailable', distanceM, name, source, reason }.
 * "outside" only ever means "not inside a mapped high-risk area" - the point can still be in the coalfield's low-risk area, and this is
 * NOT a Mining Report. When no data is loaded the answer is 'unavailable', never 'outside'.
 *
 * Sources, in order:  1. your own Postgres table `coal_risk_areas` (npm run import:coal)   2. optional live ArcGIS layer (COAL_LIVE_URL).
 * LICENCE: the data's licence is not clear (data.gov.uk lists OGL, the dataset's own metadata says "Coal Authority data licence").
 * That is why this provider is OFF unless COAL_RISK_ENABLED=true. Confirm re-use terms with the Mining Remediation Authority first.
 *
 * `db` is a pg-style pool: db.query(sql, params) -> { rows }.
 */
// Layers of the Mining Remediation Authority's free map services (map.bgs.ac.uk, the same data as its Map Viewer). Layer ids checked 2026-11.
const MRA_PLANNING = 'coalauthority_planning_policy_constraints', MRA_RISK = 'coalauthority_specific_risk';
const MRA_DETAIL = [ // key, service, layer, search distance in metres (0 = must be inside the polygon)
  ['reportingArea', MRA_PLANNING, 3, 0], ['surfaceMining', MRA_PLANNING, 1, 0], ['surfaceCoal', MRA_PLANNING, 2, 0],
  ['mineEntry', MRA_RISK, 0, 50], ['entryZone', MRA_RISK, 1, 0], ['fissures', MRA_RISK, 2, 10],
  ['pastWorkings', MRA_RISK, 4, 0], ['probableWorkings', MRA_RISK, 5, 0], ['outcrop', MRA_RISK, 6, 20],
];

export function createCoalRisk({ db = null, liveUrl = null, fetchJson = null, nearM = 250 } = {}) {
  // COAL_LIVE_URL can be one layer (…/MapServer/0 or a FeatureServer layer: high-risk area only) or the CoalAuthority folder (…/rest/services/CoalAuthority: high-risk area plus the detail layers above).
  const folder = liveUrl && /\/CoalAuthority\/?$/i.test(liveUrl) ? liveUrl.replace(/\/$/, '') : null;
  const memo = new Map(); // per provider: an address answered in the last day is not asked of the Authority again
  let warned = false;
  const warnOnce = (msg, extra) => { if (!warned) { warned = true; logger.warn(extra ?? {}, msg); } };

  async function local({ lat, lng }) {
    const meta = await db.query("select features, source, loaded_at from coal_risk_meta where kind = 'high'", []);
    if (!meta.rows?.length || !(Number(meta.rows[0].features) > 0)) return null;                       // nothing loaded
    const dLat = nearM / 111320, dLng = dLat / Math.cos((lat * Math.PI) / 180);
    const { rows } = await db.query(
      "select ref, name, parts from coal_risk_areas where kind = 'high' and bbox && box(point($1, $2), point($3, $4))",
      [lng + dLng, lat + dLat, lng - dLng, lat - dLat],
    );
    const proj = localProjector(lat, lng), origin = [0, 0];
    let best = null;
    for (const row of rows) {
      const parts = typeof row.parts === 'string' ? JSON.parse(row.parts) : row.parts;
      for (const poly of parts) {
        const outer = openRing(poly[0].map(proj)), holes = poly.slice(1).map((h) => openRing(h.map(proj)));
        const inside = pointInRing(origin, outer) && !holes.some((h) => pointInRing(origin, h));
        const d = inside ? 0 : Math.min(ringEdgeDistance(origin, outer), ...holes.map((h) => ringEdgeDistance(origin, h)));
        if (!best || d < best.d) best = { d, name: row.name ?? null, ref: row.ref ?? null };
      }
    }
    const loaded = meta.rows[0].loaded_at ? new Date(meta.rows[0].loaded_at).toISOString().slice(0, 10) : null;
    const source = `Mining Remediation Authority, Development High Risk Area${loaded ? ` (loaded ${loaded})` : ''}`;
    if (best && best.d === 0) return { status: 'inside', distanceM: 0, name: best.name, source };
    if (best && best.d <= nearM) return { status: 'near', distanceM: Math.round(best.d), name: best.name, source };
    return { status: 'outside', distanceM: null, name: null, source };
  }

  const arcQuery = async (layerUrl, { lat, lng }, distanceM = 0) => {
    const q = new URLSearchParams({ f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false', outFields: '*', where: '1=1', ...(distanceM ? { distance: String(distanceM), units: 'esriSRUnit_Meter' } : {}) });
    const data = await fetchJson(`${layerUrl}/query?${q}`, { timeoutMs: 12000 });
    if (data?.error || !Array.isArray(data?.features)) throw new Error(data?.error?.message ?? 'bad ArcGIS reply');
    return data.features;
  };

  /** The Authority's map services, one parallel round per address: high-risk area plus the detail layers a Mining Report would cover. */
  async function liveFolder({ lat, lng }) {
    const url = (svc, id) => `${folder}/${svc}/MapServer/${id}`;
    const source = 'Mining Remediation Authority map services (live)';
    const inside = await arcQuery(url(MRA_PLANNING, 0), { lat, lng });
    let near = null;
    const [nearQ, ...detailQ] = await Promise.allSettled([
      inside.length ? Promise.resolve([]) : arcQuery(url(MRA_PLANNING, 0), { lat, lng }, nearM),
      ...MRA_DETAIL.map(([, svc, id, d]) => arcQuery(url(svc, id), { lat, lng }, d)),
    ]);
    if (nearQ.status === 'fulfilled' && nearQ.value.length) near = nearQ.value;
    const details = {};
    MRA_DETAIL.forEach(([key, , , d], i) => { details[key] = detailQ[i].status === 'fulfilled' ? (key === 'mineEntry' ? detailQ[i].value.map((f) => f.attributes?.TYPE ?? 'Mine entry') : detailQ[i].value.length > 0) : null; });
    details.mineEntryWithinM = MRA_DETAIL.find(([k]) => k === 'mineEntry')[3];
    if (inside.length) return { status: 'inside', distanceM: 0, name: inside[0].attributes?.FEATURE_TYPE ?? null, source, details };
    if (near) return { status: 'near', distanceM: nearM, name: near[0].attributes?.FEATURE_TYPE ?? null, source, details };
    return { status: 'outside', distanceM: null, name: null, source, details };
  }

  async function live({ lat, lng }) {
    if (folder) return liveFolder({ lat, lng });
    const q = new URLSearchParams({ f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false', outFields: '*', where: '1=1' });
    const data = await fetchJson(`${liveUrl.replace(/\/$/, '')}/query?${q}`, { timeoutMs: 12000 });
    if (data?.error || !Array.isArray(data?.features)) return null;
    const f = data.features[0];
    const source = 'Mining Remediation Authority, Development High Risk Area (live service)';
    return f ? { status: 'inside', distanceM: 0, name: f.attributes?.CLASS_NAME ?? f.attributes?.ADVICETYPE ?? null, source } : { status: 'outside', distanceM: null, name: null, source };
  }

  return {
    name: 'coal-dhra',
    async check({ lat, lng }) {
      if (lat == null || lng == null) return { status: 'unavailable', reason: 'No location.' };
      if (db) {
        try { const r = await local({ lat, lng }); if (r) return r; }
        catch (e) { warnOnce('coal risk table lookup failed (run db/schema-coal.sql and npm run import:coal)', { err: e.message }); }
      }
      if (liveUrl && fetchJson) {
        try {
          const key = `${lat.toFixed(4)},${lng.toFixed(4)}`, hit = memo.get(key);
          if (hit && hit.at > Date.now() - 86400000) return hit.r;
          const r = await live({ lat, lng });
          if (r) { if (memo.size > 2000) memo.clear(); memo.set(key, { r, at: Date.now() }); return r; }
        }
        catch (e) { warnOnce('coal risk live lookup failed', { err: e.message }); }
      }
      return { status: 'unavailable', reason: db || liveUrl ? 'Coal mining data is not loaded or could not be read.' : 'Coal mining data is not set up.' };
    },
  };
}
