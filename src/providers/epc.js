import { fetchJson } from '../utils/http.js';

/**
 * Energy Performance Certificate (EPC) register – the one open dataset that records how many HABITABLE ROOMS a home has,
 * plus its built form, property type, age band, floor area and how many extensions it already has.
 *
 * Configure with EPC_API_URL / EPC_API_EMAIL / EPC_API_KEY (the register needs a free account). Without a key the provider is
 * simply off and everything else works. The register's service has been changing: the field names are read tolerantly
 * ("number-habitable-rooms", "numberHabitableRooms" ... all work) and the endpoint is a setting, not hard-coded logic.
 * Check the register's licence and its address-data terms before showing certificate addresses to other people.
 */
const flat = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v) => { const s = String(v ?? '').trim(); const n = Number(s.replace(/[^\d.]/g, '')); return s !== '' && Number.isFinite(n) ? n : null; };
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** One raw register row (any key style) -> our record. */
export function normaliseEpcRow(row) {
  const r = Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [flat(k), v]));
  const address = r.address || [r.address1, r.address2, r.address3].filter(Boolean).join(', ') || null;
  return {
    uprn: r.uprn ? String(r.uprn) : null, address, postcode: r.postcode ?? null,
    propertyType: r.propertytype ?? null, builtForm: r.builtform ?? null,
    habitableRooms: num(r.numberhabitablerooms), heatedRooms: num(r.numberheatedrooms),
    floorAreaM2: num(r.totalfloorarea ?? r.floorarea), ageBand: r.constructionageband ?? null,
    extensionCount: num(r.extensioncount), lodgedOn: r.lodgementdate ?? r.lodgementdatetime ?? null, rating: r.currentenergyrating ?? null,
  };
}

/** The certificate for THIS home: by UPRN when it matches, else by address line; the newest one. Never a guess at a different house. */
export function pickEpc(rows, { uprn = null, line1 = '' } = {}) {
  const recs = (rows ?? []).map(normaliseEpcRow);
  const newest = (a) => a.sort((x, y) => String(y.lodgedOn ?? '').localeCompare(String(x.lodgedOn ?? '')))[0] ?? null;
  const byUprn = uprn ? recs.filter((r) => r.uprn && r.uprn === String(uprn)) : [];
  if (byUprn.length) return { ...newest(byUprn), matchedBy: 'uprn' };
  const want = norm(line1);
  if (!want) return null;
  const byAddr = recs.filter((r) => { const a = norm(r.address); return a === want || a.startsWith(`${want} `) || a.startsWith(want); });
  return byAddr.length ? { ...newest(byAddr), matchedBy: 'address' } : null;
}

/** EPC built form -> our house form ('detached' | 'semi' | 'terraced'), or null. */
export function formFromEpc(builtForm) {
  const b = String(builtForm ?? '').toLowerCase();
  return /semi/.test(b) ? 'semi' : /terrace/.test(b) ? 'terraced' : /detached/.test(b) ? 'detached' : null;
}

/** Pulls the certificate rows out of whatever envelope the service uses. */
export function extractRows(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['rows', 'data', 'results', 'certificates', 'items']) {
    if (Array.isArray(data?.[k])) return data[k];
    if (Array.isArray(data?.[k]?.rows)) return data[k].rows;
  }
  return [];
}

/** Old register: Basic auth (email + key). New service (get-energy-performance-data.communities.gov.uk): a bearer token from "My Account". */
export function epcAuthHeader({ email, key, token }) {
  if (token) return `Bearer ${token}`;
  if (email && key) return `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}`;
  return null;
}

export function createEpc({ url, email, key, token = null, postcodeParam = 'postcode', fetchJsonImpl = fetchJson }) {
  return {
    name: 'epc',
    async findByAddress({ uprn = null, postcode, line1 = '' }) {
      const auth = epcAuthHeader({ email, key, token });
      if (!url || !auth || !postcode) return null;
      const data = await fetchJsonImpl(`${url}${url.includes('?') ? '&' : '?'}${postcodeParam}=${encodeURIComponent(postcode)}&size=100`, {
        headers: { authorization: auth, accept: 'application/json' }, timeoutMs: 10000,
      });
      const hit = pickEpc(extractRows(data), { uprn, line1 });
      return hit ? { ...hit, source: 'epc', attribution: 'Energy Performance of Buildings Register data (MHCLG) – check the register\'s licence terms.' } : null;
    },
  };
}
