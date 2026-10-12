import { cached } from '../utils/cache.js';

const PITCHED = new Set(['gabled', 'hipped', 'half-hipped', 'gambrel', 'pitched', 'mansard', 'saltbox']);
const mapRoof = (shape) => (!shape ? null : PITCHED.has(shape) ? 'Pitched' : shape === 'flat' ? 'Flat' : shape[0].toUpperCase() + shape.slice(1));
const unconfirmed = { value: null, source: 'unconfirmed' };

/** Builds the property profile. Every field carries provenance so the applicant can confirm/override it. */
export function createPropertyService({ providers }) {
  return {
    findSite: (a) => cached(`site:${a.id}`, () => providers.buildings.findSite(a), 86400),
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
      };
    },

    applyUserProfile(profile, input) {
      const next = structuredClone(profile);
      const user = (value) => ({ value, source: 'user' });
      for (const k of ['originalDwelling', 'storeys', 'roofType', 'siteAreaM2']) if (input[k] !== undefined) next[k] = user(input[k]);
      if (input.frontBearingDeg !== undefined) next.frontBearingDeg = user(input.frontBearingDeg);
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
