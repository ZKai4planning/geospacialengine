import { fetchJson } from '../utils/http.js';
import { overpass } from './overpass.js';
import { config } from '../config.js';
import { classifyOsm } from './classification.js';
import { haversine } from '../utils/geo.js';

const PHOTON = 'https://photon.komoot.io/api/';
const UK_BBOX = '-8.7,49.8,1.8,60.9';

function fromTags({ osmType, osmId, tags, lat, lng, postcodeFallback = null }) {
  const num = tags['addr:housenumber'];
  const name = tags['addr:housename'];
  const street = tags['addr:street'];
  const town = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:suburb'] || null;
  const postcode = (tags['addr:postcode'] || postcodeFallback || '').toUpperCase();
  const line1 = [num, street].filter(Boolean).join(' ');
  return {
    id: `osm:${osmType}:${osmId}`,
    uprn: null, // OSM has no UPRN – see README for how to enrich later
    fullAddress: [name, line1, town, postcode].filter(Boolean).join(', '),
    organisation: null, subBuilding: tags['addr:unit'] || null, buildingName: name || null,
    buildingNumber: num || null, thoroughfare: street || null, dependentLocality: null,
    postTown: town, postcode, lat, lng, easting: null, northing: null, localCustodian: null,
    classification: classifyOsm(tags.building),
  };
}

const typeName = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' };
const centre = (el) => ({ lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon });

/**
 * Keyless address provider built on OpenStreetMap.
 *  - free-text type-ahead: Photon (komoot) geocoder
 *  - addresses at a postcode / by id: Overpass API
 * Coverage of addr:* tags in OSM is good in most towns but incomplete – treat it as "best effort" and let
 * the applicant add a missing address manually.
 */
export function createOsmAddress({ postcodes }) {
  return {
    name: 'osm',

    /**
     * Addresses at a postcode. A country-wide tag search is far too heavy for the public Overpass servers, so we
     * look up the postcode's coordinates (postcodes.io) and search a small circle around it:
     *  1. addresses whose addr:postcode matches                      -> exact
     *  2. addresses with NO addr:postcode tag within ~100 m          -> inferred (OSM often omits the tag)
     */
    async byPostcode(postcode, { limit = 250 } = {}) {
      const info = await postcodes.lookup(postcode);
      if (!info) return [];
      const R = config.overpassRadiusM;
      const q = `[out:json][timeout:15];(nwr(around:${R},${info.lat},${info.lng})["addr:housenumber"];nwr(around:${R},${info.lat},${info.lng})["addr:housename"];);out tags center ${limit};`;
      const data = await overpass(q);
      const want = postcode.replace(/\s+/g, '').toUpperCase();
      const seen = new Map();
      for (const el of data?.elements ?? []) {
        const c = centre(el);
        if (c.lat == null || !el.tags) continue;
        const tagged = (el.tags['addr:postcode'] || '').replace(/\s+/g, '').toUpperCase();
        const exact = tagged === want;
        const inferred = !tagged && haversine(c, info) <= 100;
        if (!exact && !inferred) continue;
        const a = fromTags({ osmType: el.type, osmId: el.id, tags: el.tags, ...c, postcodeFallback: postcode });
        const key = a.fullAddress.toLowerCase();
        if (!seen.has(key) || el.type === 'way') seen.set(key, a); // prefer the building polygon over a bare node
      }
      return [...seen.values()];
    },

    async find(query, { limit = 10 } = {}) {
      const u = new URL(PHOTON);
      u.searchParams.set('q', query);
      u.searchParams.set('limit', String(limit + 5));
      u.searchParams.set('lang', 'en');
      u.searchParams.set('bbox', UK_BBOX);
      const data = await fetchJson(u.toString(), { timeoutMs: 10000, retries: 0 });
      return (data?.features ?? [])
        .filter((f) => f.properties?.countrycode === 'GB' && f.properties.housenumber)
        .map((f) => {
          const p = f.properties;
          return fromTags({
            osmType: typeName[p.osm_type] ?? 'node', osmId: p.osm_id,
            tags: {
              'addr:housenumber': p.housenumber, 'addr:street': p.street, 'addr:postcode': p.postcode,
              'addr:city': p.city || p.district || p.locality,
            },
            lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
          });
        })
        .slice(0, limit);
    },

    async byId(id) {
      const m = /^osm:(node|way|relation):(\d+)$/.exec(id);
      if (!m) return null;
      const data = await overpass(`[out:json][timeout:10];${m[1]}(${m[2]});out tags center;`);
      const el = data?.elements?.[0];
      if (!el) return null;
      return fromTags({ osmType: el.type, osmId: el.id, tags: el.tags ?? {}, ...centre(el) });
    },
  };
}
