// Property form + USE (is this a house?) from OS AddressBase codes (RD02 etc.) or OpenStreetMap tags.
//
// `use` is what the engine stands on: this tool applies HOUSEHOLDER permitted-development rules, which only cover houses.
//   'residential'     : a dwelling (house, bungalow, ...). Flats are residential but have no householder rights (handled by `form`).
//   'non_residential' : positively identified as something else (civic, commercial, pub, school, church, ...).
//   'unknown'         : the source does not say (OSM `building=yes`, or no data) - we never guess "house" from silence.
const OS = {
  RD02: { type: 'Detached house', form: 'detached' },
  RD03: { type: 'Semi-detached house', form: 'semi' },
  RD04: { type: 'Terraced house', form: 'terraced' },
  RD06: { type: 'Flat / maisonette', form: 'flat' },
  RD07: { type: 'House in multiple occupation', form: 'other' },
};
const OSM = {
  terrace: { type: 'Terraced house', form: 'terraced' },
  detached: { type: 'Detached house', form: 'detached' },
  semidetached_house: { type: 'Semi-detached house', form: 'semi' },
  apartments: { type: 'Flat / maisonette', form: 'flat' },
  house: { type: 'House', form: 'other' },
  residential: { type: 'Residential dwelling', form: 'other' },
  bungalow: { type: 'Bungalow', form: 'other' },
};
/** OSM `building=*` values that are clearly not a dwelling. */
const OSM_NOT_HOUSE = new Set([
  'commercial', 'retail', 'office', 'industrial', 'warehouse', 'civic', 'public', 'government', 'church', 'chapel', 'cathedral', 'mosque',
  'synagogue', 'temple', 'religious', 'school', 'college', 'university', 'kindergarten', 'hospital', 'clinic', 'hotel', 'supermarket', 'kiosk',
  'train_station', 'transportation', 'stadium', 'sports_hall', 'sports_centre', 'garage', 'garages', 'carport', 'parking', 'barn', 'farm',
  'farm_auxiliary', 'shed', 'service', 'hangar', 'manufacture', 'data_center', 'fire_station', 'police', 'prison', 'museum', 'theatre', 'cinema',
  'library', 'pub', 'restaurant', 'cafe', 'bank', 'dormitory', 'monastery', 'castle', 'ruins', 'construction', 'greenhouse', 'stable', 'cowshed',
]);
/** OSM keys that say what a building (or a point inside it) is used for. */
export const USE_TAG_KEYS = ['amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure'];
/** Values under those keys that are street furniture / garden features, not a use of the building (a bench or post box inside an outline). */
const NOT_A_USE = {
  amenity: new Set(['bench', 'post_box', 'letter_box', 'waste_basket', 'waste_disposal', 'recycling', 'bicycle_parking', 'bicycle_repair_station', 'parking_space',
    'parking_entrance', 'telephone', 'vending_machine', 'drinking_water', 'shelter', 'clock', 'grit_bin', 'charging_station', 'give_box', 'bbq', 'fountain']),
  leisure: new Set(['garden', 'swimming_pool', 'picnic_table', 'outdoor_seating', 'firepit', 'playground']),
  tourism: new Set(['artwork', 'information', 'viewpoint', 'picnic_site']),
};
const isUse = (k, v) => Boolean(v) && !NOT_A_USE[k]?.has(v);
export const pickUseTags = (tags = {}) => Object.fromEntries(USE_TAG_KEYS.filter((k) => isUse(k, tags[k])).map((k) => [k, tags[k]]));

const UNKNOWN = { code: null, description: null, propertyType: 'Not confirmed', form: 'other', isResidential: false, use: 'unknown', useReason: null, source: null };
const words = (v) => String(v).replace(/_/g, ' ');

/** OS AddressBase code -> use. RD* are dwellings; C/L/M/O/Z and residential institutions / garages / parking are not; the rest are not decided. */
function useFromOs(c) {
  if (c.startsWith('RD')) return 'residential';
  if (/^(RI|RC|RG)/.test(c) || /^[CLMOZ]/.test(c)) return 'non_residential';
  return 'unknown';
}

export function classify(code, description) {
  const c = code || '';
  const hit = OS[c];
  const use = useFromOs(c);
  return {
    code: c || null, description: description || null,
    propertyType: hit?.type ?? (c.startsWith('RD') ? 'Residential dwelling' : description || 'Unclassified'),
    form: hit?.form ?? 'other', isResidential: use === 'residential', use,
    useReason: use === 'non_residential' ? `Ordnance Survey classifies it as: ${description || c}.` : null,
    source: 'os_places',
  };
}

export function classifyOsm(buildingTag, tags = {}) {
  const poiKey = USE_TAG_KEYS.find((k) => isUse(k, tags[k]));
  if (poiKey) {
    const what = words(tags[poiKey]);
    return { code: `osm:${poiKey}=${tags[poiKey]}`, description: what, propertyType: `Non-residential (${what})`, form: 'other', isResidential: false, use: 'non_residential', useReason: `OpenStreetMap lists it as ${what} (${poiKey}).`, source: 'osm' };
  }
  const b = buildingTag ?? tags.building ?? null;
  if (b && OSM_NOT_HOUSE.has(b)) {
    return { code: `osm:${b}`, description: b, propertyType: `Non-residential (${words(b)})`, form: 'other', isResidential: false, use: 'non_residential', useReason: `OpenStreetMap lists it as a ${words(b)} building.`, source: 'osm' };
  }
  const hit = OSM[b];
  if (!hit) return { ...UNKNOWN };
  return { code: `osm:${b}`, description: b, propertyType: hit.type, form: hit.form, isResidential: true, use: 'residential', useReason: null, source: 'osm' };
}
