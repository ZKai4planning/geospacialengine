import { fetchJson } from '../utils/http.js';
import { ringAreaM2 } from '../utils/geo.js';
import { parseMetres } from '../utils/osmTags.js';

const BASE = 'https://nominatim.openstreetmap.org';
const PREFIX = { node: 'N', way: 'W', relation: 'R' };

/** Outer ring of a GeoJSON Polygon / MultiPolygon (the biggest part), as [[lng, lat], ...] closed. */
function outerRing(g) {
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return null;
  const rings = polys.map((p) => p[0]).filter((r) => r?.length >= 4);
  if (!rings.length) return null;
  const ring = rings.sort((a, b) => ringAreaM2(b) - ringAreaM2(a))[0].map(([lng, lat]) => [lng, lat]);
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([...f]);
  return ring;
}

/**
 * The building outline from ONE small Nominatim request. It keeps working when the public Overpass servers do not answer,
 * which is what the 3D view needs. Only the outline and its tags come back: roads, trees and neighbours need Overpass.
 *  - address id `osm:way:123` / `osm:relation:9` -> that exact building (lookup)
 *  - anything else (OS Places UPRN, a node, a manual address) -> the building under the point (reverse, zoom 18)
 */
export async function nominatimFootprint({ id = '', lat, lng }) {
  const m = /^osm:(way|relation):(\d+)$/.exec(String(id));
  const u = new URL(BASE + (m ? '/lookup' : '/reverse'));
  if (m) u.searchParams.set('osm_ids', `${PREFIX[m[1]]}${m[2]}`);
  else { u.searchParams.set('lat', String(lat)); u.searchParams.set('lon', String(lng)); u.searchParams.set('zoom', '18'); u.searchParams.set('layer', 'address'); }
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('polygon_geojson', '1');
  u.searchParams.set('polygon_threshold', '0');   // do not simplify the outline
  u.searchParams.set('extratags', '1');
  const data = await fetchJson(u.toString(), { timeoutMs: 10000, retries: 1 });
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || r.error) return null;
  const ring = outerRing(r.geojson);
  if (!ring) return null;
  const x = r.extratags ?? {};
  const type = r.category === 'building' ? r.type : x.building ?? null;
  if (!type && !m) return null;                  // reverse hit a park / pitch / road polygon, not a building
  const h = parseMetres(x.height);
  return {
    source: 'osm', osmId: Number(r.osm_id), ring, areaM2: Math.round(ringAreaM2(ring)),
    levels: x['building:levels'] ? Number(x['building:levels']) || null : null,
    heightM: h && h >= 2 && h <= 60 ? h : null,
    roofShape: x['roof:shape'] ?? null, buildingType: type ?? null, useTags: {},
  };
}
