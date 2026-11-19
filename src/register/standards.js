import { normAuthority } from './geo.js';

/**
 * COUNCIL STANDARDS for the register: numbers and rules that are not maps (parking, cycle parking, density, SuDS policy, privacy distances).
 * They are loaded once PER council (npm run import:geo -- --standards standards.json --authority <code>) into the `lpa_standards` table
 * and read per application as `app.geo.standards[topic] = { data, source, url, retrievedOn }`.
 *
 * Nothing here is invented: a council with no row simply gets "awaiting" from the check, and the finding names the document the number came from.
 *
 * File format (JSON), one object per topic - `source` is REQUIRED so every number can be traced:
 *   {
 *     "parking": { "data": { "type": "minimum", "bedrooms": { "1": 1, "2": 1.5, "3": 2 } }, "source": "Local Plan 2021, Appendix 4", "url": "https://...", "retrievedOn": "2026-11-01" },
 *     "cycle":   { "data": { "perDwelling": { "1": 1, "2": 2, "3": 3 } }, "source": "..." },
 *     "density": { "data": { "minDwellingsPerHa": 40, "maxDwellingsPerHa": 120, "notes": "town centre" }, "source": "..." },
 *     "suds":    { "data": { "policy": "Policy SI 13", "requiresSudsFor": "all major and minor", "greenfieldRunoffRequired": true }, "source": "..." },
 *     "privacy": { "data": { "backToBackM": 21, "windowToBlankM": 12 }, "source": "..." }
 *   }
 */
export const TOPICS = ['parking', 'cycle', 'density', 'suds', 'privacy'];
export class StandardsError extends Error { constructor(m) { super(m); this.status = 400; } }
const bad = (m) => new StandardsError(m);

const num = (v, name, { min = 0, max = 1e6 } = {}) => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}.`);
  return n;
};
/** { "1": 1, "2": 1.5 } -> numbers keyed by bedroom count (at least one entry). */
const byBedrooms = (o, name) => {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.keys(o).length) throw bad(`${name} must be an object keyed by number of bedrooms, e.g. { "1": 1, "2": 1.5 }.`);
  const out = {};
  for (const [k, v] of Object.entries(o)) { if (!/^\d{1,2}$/.test(k)) throw bad(`${name}: "${k}" is not a bedroom count.`); out[k] = num(v, `${name}.${k}`, { max: 20 }); }
  return out;
};
const text = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const VALIDATE = {
  parking(d) {
    const type = d?.type === 'maximum' ? 'maximum' : d?.type === 'minimum' || d?.type == null ? 'minimum' : (() => { throw bad('parking.type must be "minimum" or "maximum".'); })();
    const table = d.bedrooms ?? d.perDwelling;
    return { type, bedrooms: byBedrooms(table, 'parking.bedrooms'), ...(text(d.notes) ? { notes: text(d.notes) } : {}) };
  },
  cycle(d) {
    const t = d?.perDwelling;
    return { perDwelling: typeof t === 'number' || (typeof t === 'string' && t.trim() !== '' && Number.isFinite(Number(t))) ? num(t, 'cycle.perDwelling', { max: 20 }) : byBedrooms(t, 'cycle.perDwelling'), ...(text(d.notes) ? { notes: text(d.notes) } : {}) };
  },
  density(d) {
    const out = {};
    if (d?.minDwellingsPerHa != null) out.minDwellingsPerHa = num(d.minDwellingsPerHa, 'density.minDwellingsPerHa', { max: 2000 });
    if (d?.maxDwellingsPerHa != null) out.maxDwellingsPerHa = num(d.maxDwellingsPerHa, 'density.maxDwellingsPerHa', { max: 2000 });
    if (out.minDwellingsPerHa != null && out.maxDwellingsPerHa != null && out.minDwellingsPerHa > out.maxDwellingsPerHa) throw bad('density: the minimum is above the maximum.');
    if (text(d?.notes)) out.notes = text(d.notes);
    if (!Object.keys(out).length) throw bad('density needs minDwellingsPerHa, maxDwellingsPerHa or notes.');
    return out;
  },
  suds(d) {
    const out = { policy: text(d?.policy), requiresSudsFor: text(d?.requiresSudsFor), greenfieldRunoffRequired: d?.greenfieldRunoffRequired === true };
    if (!out.policy && !out.requiresSudsFor) throw bad('suds needs a policy reference or requiresSudsFor.');
    return out;
  },
  privacy(d) {
    return { backToBackM: num(d?.backToBackM, 'privacy.backToBackM', { min: 5, max: 60 }), windowToBlankM: num(d?.windowToBlankM, 'privacy.windowToBlankM', { min: 3, max: 40 }) };
  },
};

/** Checks one topic's data and returns the cleaned copy that is stored. Throws StandardsError. */
export function validateStandard(topic, data) {
  if (!TOPICS.includes(topic)) throw bad(`Unknown standard "${topic}". Topics: ${TOPICS.join(', ')}.`);
  return VALIDATE[topic](data ?? {});
}

/** Parses a standards file (see the format above) into rows ready to store. Every topic must carry a source. */
export function parseStandards(json) {
  let doc;
  try { doc = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw bad('The standards file is not valid JSON.'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad('The standards file must be an object with one entry per topic.');
  const rows = [];
  for (const [topic, v] of Object.entries(doc)) {
    const source = text(v?.source);
    if (!source) throw bad(`${topic}: "source" is required (the policy or document the numbers came from).`);
    const when = v.retrievedOn ?? null;
    if (when != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(when))) throw bad(`${topic}: retrievedOn must be a date like 2026-11-16.`);
    let url = null;
    if (v.url) { try { const u = new URL(String(v.url)); if (!/^https?:$/.test(u.protocol)) throw 0; url = u.toString().slice(0, 500); } catch { throw bad(`${topic}: url must be a full http(s) link.`); } }
    rows.push({ topic, data: validateStandard(topic, v.data), source, url, retrievedOn: when });
  }
  if (!rows.length) throw bad('The standards file has no topics.');
  return rows;
}

const shape = (r) => ({ data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data, source: r.source ?? null, url: r.url ?? null, retrievedOn: r.retrieved_on ? new Date(r.retrieved_on).toISOString().slice(0, 10) : r.retrievedOn ?? null });

const pick = (rows, authority) => {
  const code = String(authority?.code ?? ''), name = normAuthority(authority?.name);
  const out = {};
  for (const r of rows) if ((code && r.authority === code) || (name && normAuthority(r.authority) === name)) out[r.topic] = shape(r);
  return out;
};

/** In-memory standards (tests, small set-ups). rows: [{ authority, topic, data, source, url, retrievedOn }] */
export function createMemoryStandards(rows = []) {
  return { name: 'memory', async forAuthority(authority) { return pick(rows, authority); } };
}

/** Postgres standards (table lpa_standards in db/schema-geo.sql). The small table is cached for a minute. */
export function createStandards({ db, ttlMs = 60_000 }) {
  let cache = null, at = 0;
  return {
    name: 'postgres',
    async forAuthority(authority) {
      if (!cache || Date.now() - at > ttlMs) {
        const { rows } = await db.query('select authority, topic, data, source, url, retrieved_on from lpa_standards', []);
        cache = rows; at = Date.now();
      }
      return pick(cache, authority);
    },
  };
}
