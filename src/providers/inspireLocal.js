import { logger } from '../utils/logger.js';
import { pointInRing, ringAreaM2 } from '../utils/geo.js';
import { pointSegDist } from '../utils/polygons.js';

const M_PER_DEG = 111320;
/** How far a point may sit outside a parcel and still count as being on it (the address point can be on the pavement side of the line). */
const EDGE_TOL_M = 1.5;

/** [lng_e7, lat_e7, ...] -> [[lng, lat], ...] */
export function decodeRing(flat) {
  const ring = [];
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i] / 1e7, flat[i + 1] / 1e7]);
  return ring;
}

function distanceToRingM(pt, ring) {
  const kx = M_PER_DEG * Math.cos((pt[1] * Math.PI) / 180);
  const loc = ([lng, lat]) => [(lng - pt[0]) * kx, (lat - pt[1]) * M_PER_DEG];
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, pointSegDist([0, 0], loc(ring[i]), loc(ring[i + 1])));
  return best;
}

/**
 * HM Land Registry INSPIRE parcels stored in OUR Postgres (tables `inspire_parcels` / `inspire_meta`, functions from db/schema.sql,
 * loaded by `npm run import:inspire`). Same interface as the live planning.data.gov.uk provider: findTitle({ lat, lng }).
 * Returns null when nothing is stored there (the provider chain then asks the live service), and never throws on a missing table.
 *
 * `approxM` is how far the stored coordinates may be from the truth: the built-in grid conversion is good to a few metres, a GDAL/OSTN15
 * conversion to well under a metre. The importer records which one was used; plotEstimate.js aligns approximate parcels to the house outline.
 */
export function createInspireLocal({ db }) {
  let warned = false;
  const failed = (op, err) => {
    logger[warned ? 'debug' : 'warn']({ op, err: err?.message ?? String(err) }, 'local INSPIRE lookup failed (is db/schema.sql applied and the data imported? falling back to the live service)');
    warned = true;
  };

  let metaP = null;
  const meta = () => (metaP ??= db.query('SELECT key, value FROM inspire_meta').then(({ rows }) => Object.fromEntries(rows.map((r) => [r.key, r.value]))).catch((e) => { metaP = null; failed('meta', e); return {}; }));
  const approxMOf = (m) => (m.crs_method === 'external' ? 0.5 : 5);

  const toParcel = (r) => ({ id: String(r.id), inspireId: r.inspire_id, council: r.council, parts: r.parts, areaM2: r.area_m2, ring: decodeRing(r.ring_e7) });

  return {
    name: 'hmlr-inspire-local',
    async findTitle({ lat, lng }) {
      let rows;
      try { ({ rows } = await db.query('SELECT * FROM inspire_parcels_at($1, $2, $3)', [lat, lng, EDGE_TOL_M])); }
      catch (e) { failed('findTitle', e); return null; }
      const pt = [lng, lat];
      const cands = rows.map(toParcel).filter((p) => p.ring.length >= 4).map((p) => {
        const inside = pointInRing(pt, p.ring);
        return { p, inside, d: inside ? 0 : distanceToRingM(pt, p.ring) };
      }).filter((c) => c.inside || c.d <= EDGE_TOL_M)
        .sort((a, b) => (a.inside === b.inside ? a.d - b.d || a.p.areaM2 - b.p.areaM2 : a.inside ? -1 : 1)); // containing parcels first (smallest: flats can overlap), then the nearest
      if (!cands.length) return null;
      const hit = cands[0].p;

      let rings = [hit.ring];
      if (hit.parts > 1 && hit.inspireId) {
        try {
          const { rows: more } = await db.query('SELECT * FROM inspire_parts($1, $2)', [hit.inspireId, hit.council]);
          const all = more.map(toParcel).map((x) => x.ring).filter((r) => r.length >= 4);
          if (all.length) rings = all;
        } catch (e) { failed('parts', e); }
      }
      const ring = rings.find((r) => pointInRing(pt, r)) ?? hit.ring;
      const m = await meta();
      return {
        source: 'hmlr-inspire-local', reference: hit.inspireId, entity: null, quality: 'inspire', approxM: approxMOf(m),
        ring, rings, areaM2: Math.round(rings.reduce((s, r) => s + ringAreaM2(r), 0)),
        attribution: `Contains HM Land Registry data © Crown copyright and database right ${new Date().getFullYear()}. Licensed under the Open Government Licence v3.0. Registered extents are indicative, not the legal boundary.`,
      };
    },
    async stats() {
      try {
        const m = await meta();
        if (!m.rows) return null;
        const { rows } = await db.query("SELECT value FROM inspire_meta WHERE key = 'councils'");
        return { rows: Number(m.rows), councils: rows[0]?.value ? JSON.parse(rows[0].value) : [], crsMethod: m.crs_method ?? null, importedAt: m.imported_at ?? null };
      } catch (e) { failed('stats', e); return null; }
    },
  };
}

/**
 * Tries each title source in order and returns the first answer. A source that throws is skipped when another can still answer;
 * if every source failed, the last error is rethrown (so the app shows its usual "temporarily unavailable" note).
 */
export function createTitleChain(sources) {
  const list = sources.filter(Boolean);
  return {
    name: list.map((s) => s.name).join(' -> '),
    sources: list,
    async findTitle(point) {
      let lastErr = null, answered = false;
      for (const s of list) {
        try { const t = await s.findTitle(point); if (!s.partial) answered = true; if (t) return t; }
        catch (e) { lastErr = e; logger.warn({ source: s.name, err: e.message }, 'title source failed'); }
      }
      if (!answered && lastErr) throw lastErr;
      return null;
    },
  };
}
