import { normaliseDpa } from './addressModel.js';
import { ringAreaM2 } from '../utils/geo.js';

const BASE = { lat: 51.539, lng: 0.059 };
const mk = (n) =>
  normaliseDpa({
    UPRN: String(1234567890 + (n - 22)),
    ADDRESS: `${n}, EXAMPLE ROAD, LONDON, E6 2AA`,
    BUILDING_NUMBER: String(n),
    THOROUGHFARE_NAME: 'EXAMPLE ROAD',
    POST_TOWN: 'LONDON',
    POSTCODE: 'E6 2AA',
    LAT: BASE.lat,
    LNG: BASE.lng + ((n - 22) / 2) * 0.000072, // terraces side by side along an east-west street
    CLASSIFICATION_CODE: 'RD04',
    CLASSIFICATION_CODE_DESCRIPTION: 'Terraced',
    LOCAL_CUSTODIAN_CODE_DESCRIPTION: 'NEWHAM',
  });
const DB = [18, 20, 22, 24, 26, 28].map(mk);

/** Offline sample data so the whole flow runs without any network access or keys. */
export function createMockProviders() {
  return {
    address: {
      name: 'mock',
      async byPostcode(pc) { return pc === 'E6 2AA' ? DB : []; },
      async find(q, { limit = 10 } = {}) {
        const t = q.toLowerCase().split(/\s+/).filter(Boolean);
        return DB.filter((a) => t.every((x) => a.fullAddress.toLowerCase().includes(x))).slice(0, limit);
      },
      async byId(id) { return DB.find((a) => a.id === id) ?? null; },
    },
    postcodes: {
      name: 'mock',
      async lookup(pc) {
        return pc === 'E6 2AA'
          ? { postcode: pc, ...BASE, country: 'England', region: 'London', adminDistrict: 'Newham', adminCounty: null, ward: 'East Ham', lpaCode: 'E09000025' }
          : null;
      },
      async autocomplete(p) { return 'E6 2AA'.startsWith(p.toUpperCase().trim()) ? ['E6 2AA'] : []; },
    },
    buildings: {
      name: 'mock',
      async findSite({ lat, lng }) {
        const dLat = 0.0000404, dLng = 0.000036; // ~9 m deep x ~5 m wide
        const ring = [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]];
        return {
          footprint: { source: 'mock', osmId: null, ring, areaM2: Math.round(ringAreaM2(ring)), levels: 2, roofShape: 'gabled', buildingType: 'terrace' },
          roads: [[[lng - 0.0004, lat - 0.0001], [lng + 0.0004, lat - 0.0001]]], // street runs along the south side
        };
      },
    },
    planningData: { name: 'mock', async entitiesAt() { return []; } },
    parcels: { name: 'mock', async findPlot() { return { areaM2: 156, source: 'mock' }; } },
  };
}
