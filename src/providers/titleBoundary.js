import { fetchJson } from '../utils/http.js';
import { pointInRing, ringAreaM2 } from '../utils/geo.js';

const BASE = 'https://www.planning.data.gov.uk/entity.json';

/** Parses a WKT POLYGON / MULTIPOLYGON into an array of OUTER rings ([lng, lat] pairs, closed). Holes are ignored. */
export function parseWktPolygons(wkt) {
  if (!wkt || typeof wkt !== 'string' || !/^\s*(MULTI)?POLYGON/i.test(wkt)) return [];
  const s = wkt.slice(wkt.indexOf('('));
  let i = 0;
  const parse = () => {
    const arr = [];
    let buf = '';
    i++; // skip '('
    while (i < s.length) {
      const c = s[i];
      if (c === '(') { arr.push(parse()); continue; }
      if (c === ')') { if (buf.trim()) arr.push(buf.trim()); i++; return arr; }
      if (c === ',') { if (buf.trim()) arr.push(buf.trim()); buf = ''; i++; continue; }
      buf += c; i++;
    }
    return arr;
  };
  const tree = parse();
  const polygons = /^\s*MULTIPOLYGON/i.test(wkt) ? tree : [tree];
  return polygons
    .map((p) => (Array.isArray(p[0]) ? p[0] : []).map((pt) => String(pt).split(/\s+/).map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)))
    .filter((r) => r.length >= 4)
    .map((r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]]));
}

/**
 * HM Land Registry title boundaries (INSPIRE index polygons) via planning.data.gov.uk.
 * Indicative only: a title boundary is NOT the legal boundary. Coverage may be partial – returns null when none is found.
 */
export function createTitleBoundary() {
  return {
    name: 'hmlr-title-boundary',
    async findTitle({ lat, lng }) {
      const u = new URL(BASE);
      u.searchParams.set('dataset', 'title-boundary');
      u.searchParams.set('longitude', String(lng));
      u.searchParams.set('latitude', String(lat));
      u.searchParams.set('limit', '20');
      const data = await fetchJson(u.toString(), { timeoutMs: 10000 });
      const today = new Date().toISOString().slice(0, 10);
      const hits = (data?.entities ?? [])
        .filter((e) => !e['end-date'] || e['end-date'] > today)
        .flatMap((e) => parseWktPolygons(e.geometry).map((ring) => ({ ring, reference: e.reference ?? null, entity: e.entity ?? null })))
        .filter((c) => pointInRing([lng, lat], c.ring))
        .map((c) => ({ ...c, areaM2: ringAreaM2(c.ring) }))
        .sort((a, b) => a.areaM2 - b.areaM2); // flats can share a title: use the smallest one containing the point
      if (!hits.length) return null;
      const t = hits[0];
      return {
        source: 'hmlr-title-boundary', reference: t.reference, ring: t.ring, areaM2: Math.round(t.areaM2),
        attribution: `Title boundaries © HM Land Registry, Crown copyright and database rights ${new Date().getFullYear()} (via planning.data.gov.uk). Indicative only.`,
      };
    },
  };
}
