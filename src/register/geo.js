import { localProjector, pointInRing, ringEdgeDistance, segDist, openRing } from '../utils/geomLite.js';
import { ringDistance, ringToLineDistance } from './planar.js';
import { DATASETS, DATASET_BY_KEY } from './datasets.js';

/**
 * GEO LAYERS: one generic store for every dataset the register needs that is not fetched live (flood maps, BGS geology, utility records,
 * council registers ...). Each dataset is imported ONCE onto your own server (scripts/import-geo.js) and looked up per application.
 *
 *   geometry   GeoJSON in WGS84 (Polygon, MultiPolygon, LineString, MultiLineString, Point, MultiPoint)
 *   key        optional exact-match key (normalised postcode or UPRN) for datasets that are keyed rather than mapped
 *   authority  '' for national datasets, otherwise the planning authority code the council data belongs to
 *
 * A dataset that is not loaded answers 'unavailable' - NEVER 'outside'. "Nothing found" is only ever reported for data that is really there.
 * Result: { status: 'inside'|'near'|'outside'|'unavailable', distanceM, features: [{ ref, name, props, distanceM, inside }], nearM, source, licence, loadedAt, reason }
 */
const NA = 'unavailable';
export const normPostcode = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normAuthority = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/\b(london borough of|royal borough of|city of|borough of|council|district)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------------------------- geometry
const polysOf = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null);
const linesOf = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : null);
const pointsOf = (g) => (g?.type === 'Point' ? [g.coordinates] : g?.type === 'MultiPoint' ? g.coordinates : null);

/** Distance in metres from (lat, lng) to a GeoJSON geometry, and whether the point is inside it (polygons only). */
export function measureGeom(geom, lat, lng) {
  const proj = localProjector(lat, lng), O = [0, 0];
  const polys = polysOf(geom), lines = linesOf(geom), pts = pointsOf(geom);
  if (polys) {
    let best = Infinity;
    for (const poly of polys) {
      const outer = openRing(poly[0].map(proj)), holes = poly.slice(1).map((h) => openRing(h.map(proj)));
      if (pointInRing(O, outer) && !holes.some((h) => pointInRing(O, h))) return { inside: true, distanceM: 0 };
      best = Math.min(best, ringEdgeDistance(O, outer), ...holes.map((h) => ringEdgeDistance(O, h)));
    }
    return { inside: false, distanceM: best };
  }
  if (lines) {
    let best = Infinity;
    for (const line of lines) { const p = line.map(proj); for (let i = 0; i + 1 < p.length; i++) best = Math.min(best, segDist(O, p[i], p[i + 1])); }
    return { inside: false, distanceM: best };
  }
  if (pts) return { inside: false, distanceM: Math.min(...pts.map((c) => Math.hypot(...proj(c)))) };
  return { inside: false, distanceM: Infinity };
}

/**
 * Same as measureGeom, but for a whole building / proposal outline (a closed [lng, lat] ring) instead of one point.
 * Polygons: inside = the outline touches or overlaps it. Lines: distance 0 when the line enters or crosses the outline (inside stays false: a line has no inside).
 * This is what makes "within 3 m of a public sewer" a statement about the BUILDING, not the address point.
 */
export function measureGeomToRing(geom, ring, lat, lng) {
  const proj = localProjector(lat, lng), R = openRing(ring.map(proj));
  const polys = polysOf(geom), lines = linesOf(geom), pts = pointsOf(geom);
  if (polys) {
    let best = Infinity;
    for (const poly of polys) {
      const outer = openRing(poly[0].map(proj)), holes = poly.slice(1).map((h) => openRing(h.map(proj)));
      const d = ringDistance(R, outer);
      if (d === 0 && !(holes.some((h) => R.every((p) => pointInRing(p, h))))) return { inside: true, distanceM: 0 };
      best = Math.min(best, d);
    }
    return { inside: false, distanceM: best };
  }
  if (lines) return { inside: false, distanceM: Math.min(...lines.map((l) => ringToLineDistance(R, l.map(proj)))) };
  if (pts) return { inside: false, distanceM: Math.min(...pts.map((c) => { const p = proj(c); return pointInRing(p, R) ? 0 : ringEdgeDistance(p, R); })) };
  return { inside: false, distanceM: Infinity };
}

/** [minLng, minLat, maxLng, maxLat] of a GeoJSON geometry, or null. */
export function bboxOf(geom) {
  const xs = [], ys = [];
  const walk = (c) => { if (typeof c?.[0] === 'number') { xs.push(c[0]); ys.push(c[1]); } else if (Array.isArray(c)) c.forEach(walk); };
  walk(geom?.coordinates);
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}

/** Degrees of latitude / longitude that cover `m` metres at this latitude. */
export const degreesFor = (m, lat) => ({ dLat: m / 111320, dLng: m / (111320 * Math.cos((lat * Math.PI) / 180)) });

// ------------------------------------------------------------------------------------------------------------------- evaluation
/** Position of a band in the dataset's scale (low -> high): exact match first, then "contains" so long publisher wording still ranks. -1 = unknown. */
const SCALE_RANK = (def, v) => {
  const s = String(v ?? '').toLowerCase().trim(), scale = (def.ratings ?? []).map((r) => r.toLowerCase());
  const exact = scale.indexOf(s);
  return exact >= 0 ? exact : scale.findIndex((r) => s.includes(r));
};
export const rankOf = SCALE_RANK;

/** Candidate features (already narrowed to this authority / key / bounding box) -> one result for the dataset. */
export function evaluateDataset(def, candidates, { lat, lng, postcode, uprn, ring = null }, meta) {
  const base = { nearM: def.nearM ?? 0, measuredFrom: ring ? 'building outline' : 'address point', source: meta?.source ?? def.publisher, licence: meta?.licence ?? def.licence, loadedAt: meta?.loadedAt ?? null };
  const wantKeys = new Set([def.matchBy?.includes('postcode') ? normPostcode(postcode) : null, def.matchBy?.includes('uprn') && uprn ? String(uprn) : null].filter(Boolean));
  const out = [];
  for (const f of candidates) {
    const keyed = f.key != null && wantKeys.has(String(f.key));
    if (def.matchBy === 'postcode' || def.matchBy === 'uprn') { if (keyed) out.push({ ref: f.ref ?? null, name: f.name ?? null, props: f.props ?? {}, distanceM: 0, inside: true }); continue; }
    if (!f.geom) { if (keyed) out.push({ ref: f.ref ?? null, name: f.name ?? null, props: f.props ?? {}, distanceM: 0, inside: true }); continue; }
    const m = ring ? measureGeomToRing(f.geom, ring, lat, lng) : measureGeom(f.geom, lat, lng), radius = Number(f.props?.radiusM);
    const inside = m.inside || (Number.isFinite(radius) && radius > 0 && pointsOf(f.geom) && m.distanceM <= radius);
    if (inside || keyed || m.distanceM <= (def.nearM ?? 0)) out.push({ ref: f.ref ?? null, name: f.name ?? null, props: f.props ?? {}, distanceM: inside ? 0 : Math.round(m.distanceM * 10) / 10, inside: !!inside || keyed });
  }
  out.sort((a, b) => (b.inside - a.inside) || a.distanceM - b.distanceM);
  // banded datasets (flood risk band, radon class ...): the worst band among the features that contain the point wins
  if (def.ratings) {
    const rank = (f) => SCALE_RANK(def, f.props?.[def.ratingProp ?? 'rating']);
    out.sort((a, b) => (b.inside - a.inside) || (rank(b) - rank(a)) || a.distanceM - b.distanceM);
  }
  const hit = out.filter((f) => f.inside), near = out.filter((f) => !f.inside);
  const status = hit.length ? 'inside' : near.length ? 'near' : 'outside';
  return { status, distanceM: out.length ? out[0].distanceM : null, count: out.length, features: out.slice(0, 5), ...base };
}

// -------------------------------------------------------------------------------------------------------------------- backends
/** In-memory backend: tests, small deployments, and a way to try a dataset before loading it into Postgres. */
export function createMemoryBackend({ features = [], meta = [] } = {}) {
  const rows = features.map((f) => ({ ...f, authority: f.authority ?? '', bbox: f.geom ? bboxOf(f.geom) : null }));
  const metaRows = meta.length ? meta : [...new Set(rows.map((r) => `${r.dataset}|${r.authority}`))].map((k) => { const [dataset, authority] = k.split('|'); return { dataset, authority, features: rows.filter((r) => r.dataset === dataset && r.authority === authority).length, source: null, licence: null, loadedAt: null, coverage: null }; });
  return {
    name: 'memory',
    async meta() { return metaRows; },
    async candidates({ dataset, authority, lat, lng, nearM, keys }) {
      const { dLat, dLng } = degreesFor(Math.max(nearM, 50) + 5, lat);
      return rows.filter((r) => r.dataset === dataset && r.authority === authority && ((r.key != null && keys.includes(String(r.key))) || (r.bbox && r.bbox[0] <= lng + dLng && r.bbox[2] >= lng - dLng && r.bbox[1] <= lat + dLat && r.bbox[3] >= lat - dLat)));
    },
  };
}

/** Postgres backend (db/schema-geo.sql). Plain Postgres - no PostGIS needed: a GiST-indexed `box` finds candidates, JS does the exact test. */
export function createPgBackend({ db, metaTtlMs = 60_000 }) {
  let cache = null, at = 0;
  return {
    name: 'postgres',
    async meta() {
      if (cache && Date.now() - at < metaTtlMs) return cache;
      const { rows } = await db.query('select dataset, authority, features, source, licence, loaded_at, coverage from geo_meta', []);
      cache = rows.map((r) => ({ dataset: r.dataset, authority: r.authority ?? '', features: Number(r.features), source: r.source, licence: r.licence, loadedAt: r.loaded_at ? new Date(r.loaded_at).toISOString().slice(0, 10) : null, coverage: r.coverage ?? null }));
      at = Date.now();
      return cache;
    },
    async candidates({ dataset, authority, lat, lng, nearM, keys }) {
      const { dLat, dLng } = degreesFor(Math.max(nearM, 50) + 5, lat);
      const { rows } = await db.query(
        'select ref, name, key, props, geom from geo_features where dataset = $1 and authority = $2 and ((key is not null and key = any($7::text[])) or bbox && box(point($3, $4), point($5, $6))) limit 500',
        [dataset, authority, lng + dLng, lat + dLat, lng - dLng, lat - dLat, keys],
      );
      return rows.map((r) => ({ ...r, props: typeof r.props === 'string' ? JSON.parse(r.props) : r.props, geom: typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom }));
    },
  };
}

const inCoverage = (cov, lat, lng) => !cov || !Array.isArray(cov) || (lng >= cov[0] && lng <= cov[2] && lat >= cov[1] && lat <= cov[3]);

/**
 * The service the rest of the engine uses.
 *   loaded()                         what has been imported (dataset, authority, count, date)
 *   lookup(key, site)                one dataset at one site
 *   lookupAll(site)                  every dataset that is loaded for this site's authority, in parallel; datasets that are not loaded are simply absent
 * `site` = { lat, lng, postcode, uprn, authority: { code, name } }
 */
export function createGeoLayers({ backend, datasets = DATASETS, warn = () => {} } = {}) {
  let warned = false;
  const metaFor = (all, def, site) => {
    if (def.scope === 'national') return all.find((m) => m.dataset === def.key && m.authority === '') ?? null;
    const code = String(site.authority?.code ?? ''), name = normAuthority(site.authority?.name);
    return all.find((m) => m.dataset === def.key && m.authority !== '' && ((code && m.authority === code) || (name && normAuthority(m.authority) === name))) ?? null;
  };
  async function lookup(key, site, all) {
    const def = DATASET_BY_KEY[key];
    if (!def) return null;
    if (site.lat == null || site.lng == null) return { status: NA, reason: 'No location.' };
    const meta = metaFor(all ?? await backend.meta(), def, site);
    if (!meta) return { status: NA, reason: def.scope === 'national' ? 'Dataset not loaded.' : `Not loaded for ${site.authority?.name ?? 'this authority'}.` };
    if (!inCoverage(meta.coverage, site.lat, site.lng)) return { status: NA, reason: 'The loaded extract does not cover this location.', loadedAt: meta.loadedAt };
    const keys = [def.matchBy?.includes('postcode') ? normPostcode(site.postcode) : null, def.matchBy?.includes('uprn') && site.uprn ? String(site.uprn) : null].filter(Boolean);
    const reach = site.ring ? Math.max(...site.ring.map(([x, y]) => Math.hypot((x - site.lng) * 111320 * Math.cos((site.lat * Math.PI) / 180), (y - site.lat) * 111320))) : 0;
    const cands = await backend.candidates({ dataset: key, authority: meta.authority, lat: site.lat, lng: site.lng, nearM: (def.nearM ?? 0) + reach, keys });
    return evaluateDataset(def, cands, site, meta);
  }
  return {
    name: `geo-layers:${backend.name}`,
    loaded: () => backend.meta(),
    lookup: (key, site) => lookup(key, site),
    async lookupAll(site) {
      try {
        const all = await backend.meta();
        const wanted = datasets.filter((d) => metaFor(all, d, site));
        const results = {};
        await Promise.all(wanted.map(async (d) => {
          try { results[d.key] = await lookup(d.key, site, all); }
          catch (e) { if (!warned) { warned = true; warn({ err: e.message, dataset: d.key }, 'geo layer lookup failed (run db/schema-geo.sql and npm run import:geo)'); } results[d.key] = { status: NA, reason: 'The dataset could not be read.' }; }
        }));
        return { checkedAt: new Date().toISOString(), loaded: wanted.length, results };
      } catch (e) {
        if (!warned) { warned = true; warn({ err: e.message }, 'geo layers unavailable'); }
        return null;
      }
    },
  };
}
