// Property form from OS AddressBase codes (RD02 etc.) or OpenStreetMap `building=*` values
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
const UNKNOWN = { code: null, description: null, propertyType: 'Not confirmed', form: 'other', isResidential: false, source: null };

export function classify(code, description) {
  const c = code || '';
  const hit = OS[c];
  return {
    code: c || null, description: description || null,
    propertyType: hit?.type ?? (c.startsWith('RD') ? 'Residential dwelling' : description || 'Unclassified'),
    form: hit?.form ?? 'other', isResidential: c.startsWith('R'), source: 'os_places',
  };
}

export function classifyOsm(buildingTag) {
  const hit = OSM[buildingTag];
  if (!hit) return { ...UNKNOWN };
  return { code: `osm:${buildingTag}`, description: buildingTag, propertyType: hit.type, form: hit.form, isResidential: true, source: 'osm' };
}
