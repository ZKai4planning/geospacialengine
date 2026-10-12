import { fetchJson } from '../utils/http.js';
import { normaliseDpa } from './addressModel.js';

const BASE = 'https://api.os.uk/search/places/v1';

/** Ordnance Survey Places API (AddressBase-backed). Authoritative UK addresses + UPRN. */
export function createOsPlaces({ apiKey }) {
  const url = (path, params) => {
    const u = new URL(BASE + path);
    const all = { ...params, key: apiKey, dataset: 'DPA', output_srs: 'WGS84' };
    for (const [k, v] of Object.entries(all)) u.searchParams.set(k, String(v));
    return u.toString();
  };
  const rows = (data) => (data?.results ?? []).map((r) => r.DPA).filter(Boolean).map(normaliseDpa);

  return {
    name: 'os-places',

    /** All addresses at a postcode (paginates, max 100 per page). */
    async byPostcode(postcode, { limit = 500 } = {}) {
      const out = [];
      let offset = 0;
      while (out.length < limit) {
        const data = await fetchJson(url('/postcode', { postcode, maxresults: 100, offset }));
        const page = rows(data);
        out.push(...page);
        const total = data?.header?.totalresults ?? page.length;
        offset += data?.results?.length ?? 0;
        if (!page.length || offset >= total) break;
      }
      return out;
    },

    /** Free-text address search (type-ahead). */
    async find(query, { limit = 10 } = {}) {
      return rows(await fetchJson(url('/find', { query, maxresults: limit, minmatch: 0.4 })));
    },

    async byId(uprn) {
      return rows(await fetchJson(url('/uprn', { uprn })))[0] ?? null;
    },
  };
}
