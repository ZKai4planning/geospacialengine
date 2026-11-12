import { cached } from '../utils/cache.js';

const PITCHED = new Set(['gabled', 'hipped', 'half-hipped', 'gambrel', 'pitched', 'mansard', 'saltbox']);
const mapRoof = (shape) => (!shape ? null : PITCHED.has(shape) ? 'Pitched' : shape === 'flat' ? 'Flat' : shape[0].toUpperCase() + shape.slice(1));
const unconfirmed = { value: null, source: 'unconfirmed' };

/** Builds the property profile. Every field carries provenance so the applicant can confirm/override it. */
export function createPropertyService({ providers }) {
  return {
    findSite: (a) => cached(`site:${a.id}`, () => providers.buildings.findSite(a), 86400),
    findTitle: (a) => cached(`title:${a.id}`, () => providers.titles.findTitle(a), 86400),
    /** Same lookup at another point (e.g. the middle of the building outline) when the address point itself hit no title. */
    findTitleAt: ({ lat, lng }) => cached(`titleat:${lat.toFixed(6)},${lng.toFixed(6)}`, () => providers.titles.findTitle({ lat, lng }), 86400),
    /** Council tree preservation zones + individually protected trees around the address. */
    findProtectedTrees: (a) => cached(`tpo:${a.id}`, () => providers.protectedTrees.findNear({ lat: a.lat, lng: a.lng }), 86400),
    /** The home's energy certificate (rooms, built form, age band, floor area), or null when the register is off or has no match. */
    findEpc: (a) => (providers.epc ? cached(`epc:${a.id}`, () => providers.epc.findByAddress({ uprn: a.uprn ?? null, postcode: a.postcode, line1: String(a.fullAddress ?? '').split(',')[0] }), 86400) : null),
    /** Outlines of planning constraints within 250 m, for drawing on the plan. */
    findAreas: (a) => (providers.constraintAreas ? cached(`areas:${a.id}`, () => providers.constraintAreas.findNear({ lat: a.lat, lng: a.lng }), 6 * 3600) : []),
    /** Earlier planning applications at this address, and similar work within 150 m (null when the planning-history provider is off). */
    findPlanningHistory: (a) => (providers.planning ? cached(`plan:${a.id}`, () => providers.planning.findHistory({ lat: a.lat, lng: a.lng, line1: String(a.fullAddress ?? '').split(',')[0] }), 86400) : null),
    /** This home's recorded sales (type, tenure, new build) and same-street comparables from the Land Registry. */
    findSales: (a) => (providers.landRegistry ? cached(`ppd:${a.id}`, () => providers.landRegistry.findSales({ postcode: a.postcode, line1: String(a.fullAddress ?? '').split(',')[0], town: a.town ?? null }), 86400) : null),
    /** Roof / eaves height from LiDAR for the building outline (null when the provider is off or there is no outline). */
    findHeights: (a, ring) => (providers.lidar && ring ? cached(`lidar:${a.id}`, () => providers.lidar.measure({ ring }), 6 * 3600) : null),
    /** Is the address inside a coal mining Development High Risk Area? (null when the provider is off). */
    findCoal: (a) => (providers.coal ? cached(`coal:${a.id}`, () => providers.coal.check({ lat: a.lat, lng: a.lng }), 6 * 3600) : null),
    /** Is the address on or near a recorded historic landfill site (made ground)? (null when the provider is off). */
    findLandfill: (a) => (providers.landfill ? cached(`landfill:${a.id}`, () => providers.landfill.check({ lat: a.lat, lng: a.lng }), 6 * 3600) : null),
    findPlot: (a) => cached(`plot:${a.id}`, () => providers.parcels.findPlot(a), 86400),

    buildProfile({ footprint, plot }) {
      const roof = mapRoof(footprint?.roofShape);
      const src = footprint?.source;
      return {
        originalDwelling: { ...unconfirmed },
        existingExtension: { present: null, depthM: null, widthM: null, inOutline: true, source: 'unconfirmed' },
        storeys: footprint?.levels ? { value: footprint.levels, source: src } : { ...unconfirmed },
        roofType: roof ? { value: roof, source: src } : { ...unconfirmed },
        siteAreaM2: plot?.areaM2 ? { value: plot.areaM2, source: plot.source } : { ...unconfirmed },
        footprintAreaM2: footprint?.areaM2 ? { value: footprint.areaM2, source: src } : { ...unconfirmed },
        frontBearingDeg: { value: null, source: 'auto' }, // compass bearing the front of the house faces
        habitableRooms: { value: null, source: 'unset' }, // typed in when there is no energy certificate
        neighbourWindow: { value: null, source: 'unset' }, // marked by the applicant for the council's 45-degree test
      };
    },

    applyUserProfile(profile, input) {
      const next = structuredClone(profile);
      const user = (value) => ({ value, source: 'user' });
      for (const k of ['originalDwelling', 'storeys', 'roofType', 'siteAreaM2']) if (input[k] !== undefined) next[k] = user(input[k]);
      if (input.frontBearingDeg !== undefined) next.frontBearingDeg = user(input.frontBearingDeg);
      if (input.habitableRooms !== undefined) next.habitableRooms = user(input.habitableRooms);
      if (input.neighbourWindow !== undefined) next.neighbourWindow = user(input.neighbourWindow);   // {lng,lat} of the neighbour's nearest habitable-room window, or null
      if (input.existingExtension) {
        const { present, depthM, widthM, inOutline } = input.existingExtension;
        const cur = next.existingExtension;
        const has = present ?? (depthM != null ? depthM > 0 : cur.present);
        next.existingExtension = {
          present: has,
          depthM: has === false ? 0 : depthM ?? cur.depthM,
          widthM: widthM ?? cur.widthM,
          inOutline: inOutline ?? cur.inOutline,
          source: 'user',
        };
      }
      return next;
    },
  };
}
