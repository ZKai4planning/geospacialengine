import { logger } from '../utils/logger.js';

/**
 * Is this point on, or near, a recorded historic landfill site (Environment Agency "Historic Landfill Sites", England)?
 * This is the best open sign of "made ground" and landfill gas / settlement risk. It is NOT a ground investigation: filled land that
 * was never recorded as landfill is not in the data, and Wales / Scotland / Northern Ireland are not covered by this dataset.
 *
 * Answers { status: 'inside' | 'near' | 'outside' | 'unavailable', sites: [{ name, ref, waste[], licenceHolder, issued, surrendered, gasControl, leachate }], nearM, source, reason }.
 * Two small queries (the point, then a ring around it), no geometry downloaded.
 * LICENCE: the data is under the Environment Agency Conditional Licence, not the Open Government Licence. Read it before use
 * (https://www.gov.uk/government/publications/environment-agency-conditional-licence) and keep the attribution. OFF unless LANDFILL_ENABLED=true.
 */
const WASTE = [['inert', 'inert'], ['industrial', 'industrial'], ['commercial', 'commercial'], ['household', 'household'], ['special', 'special / hazardous'], ['liqsludge', 'liquid sludge'], ['wasteunk', 'unknown waste']];

export function createLandfill({ url, fetchJson, nearM = 250 } = {}) {
  let warned = false;
  // field names differ in case between copies of the dataset, so read them case-insensitively
  const pick = (attrs, key) => { const k = Object.keys(attrs ?? {}).find((x) => x.toLowerCase() === key); return k ? attrs[k] : null; };
  const yes = (v) => v != null && v !== '' && !/^(0|no|n|false)$/i.test(String(v));
  const date = (v) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
  const site = (a) => ({
    name: pick(a, 'site_name') || pick(a, 'site_add') || 'Unnamed site', ref: pick(a, 'hld_ref') ?? pick(a, 'site_ref') ?? null,
    waste: WASTE.filter(([k]) => yes(pick(a, k))).map(([, label]) => label),
    licenceHolder: pick(a, 'lic_hold') ?? null, issued: date(pick(a, 'lic_issue')), surrendered: date(pick(a, 'lic_surren')),
    gasControl: yes(pick(a, 'gascontrol')), leachate: yes(pick(a, 'leachatcnt')),
  });
  async function query({ lat, lng }, distanceM) {
    const q = new URLSearchParams({ f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false', outFields: '*', where: '1=1', ...(distanceM ? { distance: String(distanceM), units: 'esriSRUnit_Meter' } : {}) });
    const data = await fetchJson(`${url.replace(/\/$/, '')}/query?${q}`, { timeoutMs: 12000 });
    if (data?.error || !Array.isArray(data?.features)) throw new Error(data?.error?.message ?? 'bad ArcGIS reply');
    return data.features.map((f) => site(f.attributes));
  }
  return {
    name: 'ea-historic-landfill',
    async check({ lat, lng }) {
      if (lat == null || lng == null) return { status: 'unavailable', reason: 'No location.' };
      const source = 'Environment Agency, Historic Landfill Sites (© Environment Agency copyright and/or database right 2025. All rights reserved)';
      try {
        const inside = await query({ lat, lng }, 0);
        if (inside.length) return { status: 'inside', sites: inside.slice(0, 5), nearM, source };
        const near = await query({ lat, lng }, nearM);
        return near.length ? { status: 'near', sites: near.slice(0, 5), nearM, source } : { status: 'outside', sites: [], nearM, source };
      } catch (e) {
        if (!warned) { warned = true; logger.warn({ err: e.message }, 'historic landfill lookup failed'); }
        return { status: 'unavailable', reason: 'The historic landfill data could not be read.' };
      }
    },
  };
}
