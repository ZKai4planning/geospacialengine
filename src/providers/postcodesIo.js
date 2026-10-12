import { fetchJson } from '../utils/http.js';

const BASE = 'https://api.postcodes.io';

/** postcodes.io – free postcode validation, partial-postcode autocomplete, admin areas. */
export function createPostcodesIo() {
  return {
    name: 'postcodes.io',
    async lookup(postcode) {
      const data = await fetchJson(`${BASE}/postcodes/${encodeURIComponent(postcode)}`);
      const r = data?.result;
      if (!r) return null;
      return {
        postcode: r.postcode,
        lat: r.latitude,
        lng: r.longitude,
        country: r.country,
        region: r.region,
        adminDistrict: r.admin_district,
        adminCounty: r.admin_county,
        ward: r.admin_ward,
        lpaCode: r.codes?.admin_district ?? null,
      };
    },
    async autocomplete(partial, limit = 8) {
      const data = await fetchJson(`${BASE}/postcodes/${encodeURIComponent(partial)}/autocomplete?limit=${limit}`);
      return data?.result ?? [];
    },
  };
}
