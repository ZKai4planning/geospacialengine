/**
 * Pure helpers that turn raw OpenStreetMap tags into the numbers the site checks need.
 * Kept separate from the Overpass provider so they can be unit-tested without a network.
 */

/** "0.5", "50 cm", "6'" -> metres. Returns null when it cannot be read. Bare numbers above `cmAbove` are taken as centimetres. */
export function parseMetres(v, { cmAbove = Infinity } = {}) {
  if (v == null) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|ft|')?\s*$/i.exec(String(v));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'mm') return n / 1000;
  if (unit === 'cm') return n / 100;
  if (unit === 'ft' || unit === "'") return n * 0.3048;
  if (unit === 'm') return n;
  return n > cmAbove ? n / 100 : n;
}

/** Trunk diameter in metres from `diameter` or `circumference` (OSM: metres unless a unit is given). */
export function trunkDiameterM(tags = {}) {
  const d = parseMetres(tags.diameter, { cmAbove: 3 });
  if (d) return d;
  const c = parseMetres(tags.circumference, { cmAbove: 9 });
  return c ? c / Math.PI : null;
}

/** An OSM `natural=tree` node -> a tree record, or null if it has no usable position. */
export function treeFromElement(e) {
  if (e?.type !== 'node' || e.tags?.natural !== 'tree' || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return null;
  const t = e.tags;
  return {
    osmId: e.id, lng: e.lon, lat: e.lat,
    trunkDiameterM: trunkDiameterM(t),
    crownDiameterM: parseMetres(t.diameter_crown),
    species: t.species ?? t['species:en'] ?? t.genus ?? null,
  };
}

/** Typical carriageway width (m) per OSM highway class, used when the way has no `width` tag. */
export const ROAD_WIDTH_M = {
  motorway: 7.5, trunk: 7.3, primary: 7.3, secondary: 7, tertiary: 6, unclassified: 5.5, residential: 5.5,
  living_street: 4.5, service: 3.5, pedestrian: 3, road: 5,
};

/** An OSM highway way -> road record. Private driveways / parking aisles are kept but marked `ignore` (building on your own drive is fine). */
/** A / B / C class from the road's reference ("A406", "B112"), or "main road (probably classified)" from its OSM level. Classified roads change the rules for vehicle access. */
export function roadClass(t) {
  const ref = String(t.ref ?? '').split(';').map((r) => r.trim()).find((r) => /^[ABC]\d/.test(r));
  if (ref) return { classified: true, roadClass: ref[0], classLabel: `${ref[0]} road (${ref})` };
  if (['motorway', 'trunk'].includes(t.highway)) return { classified: true, roadClass: 'A', classLabel: 'Trunk road' };
  if (['primary', 'secondary', 'tertiary'].includes(t.highway)) return { classified: true, roadClass: null, classLabel: 'Main road (probably classified)' };
  return { classified: false, roadClass: null, classLabel: null };
}

export function roadFromElement(e) {
  const t = e?.tags;
  if (!t?.highway || !(e.geometry?.length >= 2)) return null;
  const tagged = parseMetres(t.width);
  return {
    osmId: e.id, name: t.name ?? null, highway: t.highway,
    widthM: tagged && tagged >= 1 && tagged <= 30 ? tagged : ROAD_WIDTH_M[t.highway] ?? 5,
    widthSource: tagged ? 'osm' : 'assumed',
    ignore: t.service === 'driveway' || t.service === 'parking_aisle',
    ref: t.ref ?? null, ...roadClass(t),
    sidewalk: t.sidewalk ?? null,   // 'both' | 'left' | 'right' | 'no' | ... : a pavement exists even when it is not drawn as its own line
    line: e.geometry.map((g) => [g.lon, g.lat]),
  };
}

/** OSM `barrier` values that mark a property boundary (kerbs, bollards, gates and the like are not boundaries). */
export const BOUNDARY_BARRIERS = ['fence', 'wall', 'hedge', 'retaining_wall'];

/** An OSM way tagged barrier=fence|wall|hedge|retaining_wall -> { kind, line }, or null. */
export function barrierFromElement(e) {
  const kind = e?.tags?.barrier;
  if (e?.type !== 'way' || !BOUNDARY_BARRIERS.includes(kind) || !(e.geometry?.length >= 2)) return null;
  return { osmId: e.id, kind: kind === 'retaining_wall' ? 'wall' : kind, line: e.geometry.map((g) => [g.lon, g.lat]) };
}

/** OSM highway values that are pavements / paths rather than roads. */
export const PATH_HIGHWAYS = ['footway', 'path', 'steps', 'cycleway', 'bridleway'];
const PATH_LABEL = { pavement: 'Pavement', path: 'Footpath', cycleway: 'Cycle path', steps: 'Steps', crossing: 'Crossing', bridleway: 'Bridleway' };
const PATH_WIDTH_M = { pavement: 2, path: 1.5, cycleway: 2, steps: 1.5, crossing: 3, bridleway: 3 };
const ROW_DESIGNATIONS = /public_footpath|public_bridleway|restricted_byway|byway_open_to_all_traffic/;

/** An OSM footway / path / steps / cycleway way -> { kind, label, widthM, row (public right of way), private, line }, or null. */
export function pathFromElement(e) {
  const t = e?.tags;
  if (e?.type !== 'way' || !PATH_HIGHWAYS.includes(t?.highway) || !(e.geometry?.length >= 2)) return null;
  const kind = t.footway === 'sidewalk' ? 'pavement' : t.footway === 'crossing' || t.crossing ? 'crossing'
    : t.highway === 'steps' ? 'steps' : t.highway === 'cycleway' ? 'cycleway' : t.highway === 'bridleway' ? 'bridleway' : 'path';
  const tagged = parseMetres(t.width);
  return {
    osmId: e.id, name: t.name ?? null, kind, label: PATH_LABEL[kind],
    widthM: tagged && tagged >= 0.5 && tagged <= 10 ? tagged : PATH_WIDTH_M[kind],
    widthSource: tagged && tagged >= 0.5 && tagged <= 10 ? 'osm' : 'assumed',
    surface: t.surface ?? null,
    row: ROW_DESIGNATIONS.test(t.designation ?? '') || !!t.prow_ref,                // a public right of way: cannot be built over without a diversion order
    private: t.access === 'private' || t.access === 'no',
    line: e.geometry.map((g) => [g.lon, g.lat]),
  };
}

/** Street furniture and utilities that can stand in the way of work near the road: what to look for in OSM, and what to call it. */
export const OBSTACLE_KINDS = {
  post_box: { label: 'Post box', radiusM: 0.35 }, pole: { label: 'Electricity / telephone pole', radiusM: 0.25 }, pylon: { label: 'Pylon', radiusM: 1 },
  lamp: { label: 'Street lamp', radiusM: 0.2 }, cabinet: { label: 'Street cabinet', radiusM: 0.6 }, hydrant: { label: 'Fire hydrant', radiusM: 0.2 },
  bollard: { label: 'Bollard', radiusM: 0.15 }, bus_stop: { label: 'Bus stop', radiusM: 0.5 }, dropped_kerb: { label: 'Dropped kerb', radiusM: 0.5 },
};

/** An OSM node -> an obstacle record { kind, label, lng, lat, ref, heightM, blocks }, or null. A dropped kerb is a vehicle crossing: shown, but not an obstruction. */
export function obstacleFromElement(e) {
  const t = e?.tags;
  if (e?.type !== 'node' || !t || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return null;
  const kind = t.amenity === 'post_box' ? 'post_box' : t.power === 'pole' ? 'pole' : t.power === 'tower' ? 'pylon' : t.highway === 'street_lamp' ? 'lamp'
    : t.man_made === 'street_cabinet' ? 'cabinet' : t.emergency === 'fire_hydrant' ? 'hydrant' : t.highway === 'bus_stop' ? 'bus_stop'
    : t.barrier === 'bollard' ? 'bollard' : t.barrier === 'kerb' && /^(lowered|flush)$/.test(t.kerb ?? '') ? 'dropped_kerb' : null;
  if (!kind) return null;
  return { osmId: e.id, kind, label: OBSTACLE_KINDS[kind].label, lng: e.lon, lat: e.lat, ref: t.ref ?? null, heightM: parseMetres(t.height), blocks: kind !== 'dropped_kerb' };
}

/** An OSM overhead line (power=line high voltage, power=minor_line local distribution) -> { kind, label, voltage, line }, or null. */
export function powerLineFromElement(e) {
  const t = e?.tags;
  if (e?.type !== 'way' || !['line', 'minor_line'].includes(t?.power) || !(e.geometry?.length >= 2)) return null;
  return { osmId: e.id, kind: t.power, label: t.power === 'line' ? 'High-voltage overhead line' : 'Overhead power line', voltage: t.voltage ?? null, line: e.geometry.map((g) => [g.lon, g.lat]) };
}
