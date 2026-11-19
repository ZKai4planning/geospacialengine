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
    // sample open flood data and nearby infrastructure (offline demo only; not real readings)
    flood: {
      name: 'mock-flood',
      async check() {
        return {
          surfaceWater: { status: 'ok', band: 'low', mapped: true, text: 'Low (0.1% to 1% a year)', source: 'SAMPLE DATA (mock mode)' },
          recorded: { status: 'outside', events: [], nearM: 250, source: 'SAMPLE DATA (mock mode)' },
          reservoir: { status: 'outside', events: [], nearM: 250, source: 'SAMPLE DATA (mock mode)' },
          checkedAt: new Date().toISOString(),
        };
      },
    },
    layers: {
      name: 'mock-layers',
      async check() {
        return {
          aqma: { status: 'outside', areas: [], source: 'SAMPLE DATA (mock mode)' },
          defences: { status: 'outside', assets: [], count: 0, nearM: 250, source: 'SAMPLE DATA (mock mode)' },
          mainRiver: { status: 'outside', rivers: [], nearM: 50, source: 'SAMPLE DATA (mock mode)' },
          noise: { status: 'ok', lden: 52.5, source: 'road', sources: [{ source: 'road', lden: 52.5 }], cellM: 10, text: 'SAMPLE DATA (mock mode)' },
          checkedAt: new Date().toISOString(),
        };
      },
    },
    infra: {
      name: 'mock-infra',
      async check() { return { watercourses: [{ kind: 'stream', name: null, culverted: false, distanceM: 120 }], substations: [{ name: null, operator: null, kind: 'minor_distribution', distanceM: 70 }], signals: [], source: 'SAMPLE DATA (mock mode)' }; },
    },
    address: {
      name: 'mock',
      async byPostcode(pc) { return pc === 'E6 2AA' ? DB : []; },
      async find(q, { limit = 10 } = {}) {
        const t = q.toLowerCase().split(/\s+/).filter(Boolean);
        return DB.filter((a) => t.every((x) => a.fullAddress.toLowerCase().includes(x))).slice(0, limit);
      },
      async byId(id) { return DB.find((a) => a.id === id) ?? null; },
    },
    constraintAreas: { name: 'mock', async findNear({ lat, lng }) {
      const sq = (n, s_, e, w) => { const ky = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180), r = [[w, s_], [e, s_], [e, n], [w, n]].map(([x, y]) => [lng + x / kx, lat + y / ky]); return [...r, r[0]]; };
      const mk = (dataset, label, rings, details = {}) => ({ id: `area-mock-${dataset}`, dataset, entity: 1, reference: null, name: label, label, details, rings: [rings], url: 'https://www.planning.data.gov.uk/entity/1' });
      return [mk('conservation-area', 'Conservation area', sq(80, -80, 90, -90)), mk('article-4-direction-area', 'Article 4 direction area', sq(80, -80, 90, -90), { rights: 'Class A (extensions), Class B (roof additions)', notes: 'Mock direction for demonstration.' }),
        mk('flood-risk-zone', 'Flood zone 2', sq(120, 30, 150, -150), { level: '2' })];
    } },
    planning: { name: 'mock', async findHistory() {
      const rec = (o) => ({ ref: 'MOCK/1', council: 'Newham', address: '1 Example Road, London E6 2AA', postcode: 'E6 2AA', description: '', appType: 'Full', size: 'Small', state: 'Permitted', outcome: 'approved', receivedOn: '2019-02-01', decidedOn: '2019-04-02', lat: 51.539, lng: 0.059, distanceM: 40, councilUrl: 'https://example.invalid/register', planitUrl: null, kind: null, lawful: false, prior: false, flats: false, newDwelling: false, ...o });
      return { here: [rec({ ref: 'MOCK/H1', address: '22 Example Road, London E6 2AA', description: 'Single storey rear extension', kind: 'rear', receivedOn: '2012-05-01', decidedOn: '2012-07-10', distanceM: 0 })], building: [],
        nearby: [rec({ ref: 'MOCK/N1', description: 'Single storey rear extension', kind: 'rear', decidedOn: '2022-03-01' }), rec({ ref: 'MOCK/N2', description: 'Two storey rear extension', kind: 'rear', outcome: 'refused', state: 'Rejected', decidedOn: '2021-09-01' }), rec({ ref: 'MOCK/N3', description: 'Rear extension and loft conversion', kind: 'rear', decidedOn: '2023-06-01' }), rec({ ref: 'MOCK/N4', description: 'Single storey rear extension', kind: 'rear', decidedOn: '2024-01-15' })],
        radiusM: 150, years: 10, source: 'planit', attribution: 'Planning application data from council registers, aggregated by PlanIt (planit.org.uk). Check PlanIt\'s terms of use.' };
    } },
    landRegistry: { name: 'mock', async findSales() { return { sales: [{ transactionId: 'mock-1', priceGbp: 425000, date: '2021-06-18', propertyType: 'terraced', tenure: 'freehold', newBuild: false, paon: '22', street: 'EXAMPLE ROAD', town: 'LONDON', postcode: 'E6 2AA' }], street: { name: 'EXAMPLE ROAD', town: 'LONDON', years: 5, type: 'terraced', stats: { count: 12, medianGbp: 465000, p25Gbp: 440000, p75Gbp: 490000, minGbp: 410000, maxGbp: 540000 }, allTypesStats: null }, source: 'land-registry-ppd', attribution: 'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.' }; } },
    epc: { name: 'mock', async findByAddress() { return { uprn: null, address: '22 Example Road', propertyType: 'House', builtForm: 'Mid-Terrace', habitableRooms: 5, floorAreaM2: 86, ageBand: 'England and Wales: 1900-1929', extensionCount: 0, lodgedOn: '2021-05-01', source: 'epc', matchedBy: 'address' }; } },
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
        const box = (l0, l1) => [[l0, lat - dLat], [l1, lat - dLat], [l1, lat + dLat], [l0, lat + dLat], [l0, lat - dLat]];
        return {
          neighbours: [ // the terraced houses either side
            { osmId: null, ring: box(lng - 3 * dLng, lng - dLng), buildingType: 'terrace' },
            { osmId: null, ring: box(lng + dLng, lng + 3 * dLng), buildingType: 'terrace' },
          ],
          footprint: { source: 'mock', osmId: null, ring, areaM2: Math.round(ringAreaM2(ring)), levels: 2, roofShape: 'gabled', buildingType: 'terrace' },
          roads: [[[lng - 0.0004, lat - 0.0001], [lng + 0.0004, lat - 0.0001]]], // street runs along the south side
          roadDetails: [{ osmId: null, name: 'Example Road', highway: 'residential', widthM: 5.5, widthSource: 'assumed', ignore: false, line: [[lng - 0.0004, lat - 0.0001], [lng + 0.0004, lat - 0.0001]] }],
          trees: [ // one tree in the rear garden, 6 m behind the back wall (0.5 m trunk -> 6 m root zone)
            { osmId: null, lng, lat: lat + dLat + 6 / 111320, trunkDiameterM: 0.5, crownDiameterM: null, species: 'Silver birch' },
          ],
        };
      },
    },
    planningData: { name: 'mock', async entitiesAt() { return []; } },
    protectedTrees: {
      name: 'mock',
      async findNear({ lat, lng }) { // a "group" tree preservation zone at the bottom of the rear garden (7-10 m behind the back wall)
        const dLat = 0.0000404, dLng = 0.000036, m = 1 / 111320;
        const ring = [[lng - dLng, lat + dLat + 7 * m], [lng + dLng, lat + dLat + 7 * m], [lng + dLng, lat + dLat + 10 * m], [lng - dLng, lat + dLat + 10 * m], [lng - dLng, lat + dLat + 7 * m]];
        return { zones: [{ id: 'tpo-zone-mock', entity: null, reference: 'TPO-MOCK-G1', name: 'G1', type: 'group', order: 'TPO-MOCK', rings: [ring], url: null }], trees: [] };
      },
    },
    lidar: { name: 'mock', async measure() { return { status: 'ok', roofShape: 'pitched', eavesM: 5.2, ridgeM: 8.1, groundOdnM: 6.4, groundFallM: 0.6, contrastM: 5.1, shift: [0, 0], shiftM: 0, confidence: 'high', cells: 40, source: 'Sample LiDAR heights (mock data)' }; } },
    parcels: { name: 'mock', async findPlot() { return { areaM2: 156, source: 'mock' }; } },
    titles: {
      name: 'mock',
      async findTitle({ lat, lng }) { // house width, ~2 m front garden, ~10 m rear garden
        const dLat = 0.0000404, dLng = 0.000036;
        const ring = [[lng - dLng, lat - dLat - 0.000018], [lng + dLng, lat - dLat - 0.000018], [lng + dLng, lat + dLat + 0.00009], [lng - dLng, lat + dLat + 0.00009], [lng - dLng, lat - dLat - 0.000018]];
        return { source: 'mock', reference: 'MOCK1', ring, areaM2: Math.round(ringAreaM2(ring)), attribution: 'Sample title boundary (mock data).' };
      },
    },
  };
}
