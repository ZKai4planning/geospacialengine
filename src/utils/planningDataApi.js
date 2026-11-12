const BASE = 'https://www.planning.data.gov.uk/entity.json';

/**
 * Builds a planning.data.gov.uk /entity.json URL. `params` is a list of [key, value] pairs (repeat a key for arrays, e.g. several `dataset`s).
 * Values are percent-encoded with %20 for spaces, as the API documentation asks for WKT geometry.
 * Docs: https://www.planning.data.gov.uk/docs  (longitude/latitude = point intersects; geometry + geometry_relation = area search;
 * field / exclude_field = trim the response; geometry comes back by default as WKT).
 */
export function entityUrl(params) {
  return `${BASE}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`;
}

/** Current = not ended. The API gives `end-date: ""` for live records. */
export const isCurrent = (e, today = new Date().toISOString().slice(0, 10)) => !e?.['end-date'] || e['end-date'] > today;
