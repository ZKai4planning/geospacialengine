import { classify } from './classification.js';

const POSTCODE_TAIL = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-(]|\bo')([a-z])/g, (_, p, c) => p + c.toUpperCase());

/** "22, EXAMPLE ROAD, LONDON, E6 2AA" -> "22 Example Road, London, E6 2AA" */
export function prettyAddress(raw = '') {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out = parts.map((p, i) => (i === parts.length - 1 && POSTCODE_TAIL.test(p) ? p.toUpperCase() : titleCase(p)));
  if (out.length > 1 && /^\d+[A-Za-z]?$/.test(out[0])) out.splice(0, 2, `${out[0]} ${out[1]}`);
  return out.join(', ');
}

/** Normalises an OS Places DPA record into our Address model. */
export function normaliseDpa(d) {
  return {
    id: String(d.UPRN),
    uprn: String(d.UPRN),
    fullAddress: prettyAddress(d.ADDRESS),
    organisation: d.ORGANISATION_NAME ? titleCase(d.ORGANISATION_NAME) : null,
    subBuilding: d.SUB_BUILDING_NAME ? titleCase(d.SUB_BUILDING_NAME) : null,
    buildingName: d.BUILDING_NAME ? titleCase(d.BUILDING_NAME) : null,
    buildingNumber: d.BUILDING_NUMBER ? String(d.BUILDING_NUMBER) : null,
    thoroughfare: d.THOROUGHFARE_NAME ? titleCase(d.THOROUGHFARE_NAME) : null,
    dependentLocality: d.DEPENDENT_LOCALITY ? titleCase(d.DEPENDENT_LOCALITY) : null,
    postTown: d.POST_TOWN ? titleCase(d.POST_TOWN) : null,
    postcode: String(d.POSTCODE || '').toUpperCase(),
    lat: Number(d.LAT),
    lng: Number(d.LNG),
    easting: d.X_COORDINATE != null ? Number(d.X_COORDINATE) : null,
    northing: d.Y_COORDINATE != null ? Number(d.Y_COORDINATE) : null,
    localCustodian: d.LOCAL_CUSTODIAN_CODE_DESCRIPTION ? titleCase(d.LOCAL_CUSTODIAN_CODE_DESCRIPTION) : null,
    classification: classify(d.CLASSIFICATION_CODE, d.CLASSIFICATION_CODE_DESCRIPTION),
  };
}
