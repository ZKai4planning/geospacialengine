import crypto from 'node:crypto';
import { notFound, badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { assessProposal } from './permittedDevelopment.js';
import { buildMap } from './mapService.js';
import { classifyOsm } from '../providers/classification.js';

const UUID = /^[0-9a-f-]{36}$/i;

export function createApplicationService({ store, addressService, constraintsService, propertyService, mediaService }) {
  async function safe(label, fn, fallback, warnings) {
    try { return await fn(); }
    catch (e) {
      logger.warn({ label, err: e.message }, 'enrichment failed');
      warnings.push(`${label} is temporarily unavailable.`);
      return fallback;
    }
  }

  async function load(id) {
    if (!UUID.test(id)) throw badRequest('Invalid application id.');
    const app = await store.get(id);
    if (!app) throw notFound('Application not found.');
    return app;
  }

  /** Recomputes the map layers + the permitted-development assessment from the current state. */
  function derive(app) {
    const map = buildMap({
      address: app.address, footprint: app.footprint, roads: app.roads, neighbours: app.neighbours ?? [], plot: app.plot ?? null,
      camera: app.media?.streetView?.camera ?? null, profile: app.profile, proposal: app.proposal,
    });
    let assessment = null;
    if (app.proposal) {
      const ex = app.profile.existingExtension;
      assessment = assessProposal({
        country: app.country, houseForm: app.address.classification.form, flags: app.constraints?.flags ?? {},
        proposal: app.proposal, houseWidthM: map.frame.indicative ? null : map.frame.houseWidthM,
        existingExtensionDepthM: ex.present === false ? 0 : ex.depthM,
        plotAreaM2: app.profile.siteAreaM2.value, isOriginalDwelling: app.profile.originalDwelling.value !== false,
      });
    }
    return { map, assessment };
  }

  const save = (id, app, patch) => store.update(id, { ...patch, ...derive({ ...app, ...patch }) });

  return {
    load,

    /** Called when the applicant CONFIRMS an address. Captures address + postcode and enriches the site. */
    async create({ id: addressId, manual }) {
      const address = manual ? await addressService.manual(manual) : await addressService.getById(addressId);
      const warnings = [];
      if (address.uprnMatch?.confidence === 'low') warnings.push(`Several properties are very close together, so UPRN ${address.uprn} is a best guess from the map – please confirm it.`);
      if (address.approximate) warnings.push('You entered this address manually, so the map is centred on the postcode – please check the red outline is the right building.');
      const [postcodeInfo, site, plot, title, constraints, media] = await Promise.all([
        safe('Postcode data', () => addressService.postcodeInfo(address.postcode), null, warnings),
        safe('Building outline', () => propertyService.findSite(address), { footprint: null, roads: [], neighbours: [] }, warnings),
        safe('Site area', () => propertyService.findPlot(address), null, warnings),
        safe('Plot boundary', () => propertyService.findTitle(address), null, warnings),
        safe('Planning constraints', () => constraintsService.check(address), null, warnings),
        safe('Street imagery', () => mediaService.prepare(address), { streetView: { available: false }, aerial: { available: true } }, warnings),
      ]);

      // Property type: fall back to OSM's building tag when the address source didn't classify it
      let classification = address.classification;
      if (classification.form === 'other' && classification.code == null && site.footprint?.buildingType) {
        const c = classifyOsm(site.footprint.buildingType);
        if (c.code) classification = c;
      }
      if (!site.footprint) warnings.push('We could not find the building outline, so the map shows an indicative house shape.');

      const now = new Date().toISOString();
      const app = {
        id: crypto.randomUUID(),
        reference: `PA-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`,
        status: 'draft', createdAt: now, updatedAt: now,
        address: { ...address, classification },
        postcode: address.postcode,
        country: postcodeInfo?.country ?? 'England',
        authority: {
          name: postcodeInfo?.adminDistrict ?? address.localCustodian ?? null,
          code: postcodeInfo?.lpaCode ?? null,
          note: 'Derived from the postcode – confirm with the planning authority finder before submitting.',
        },
        footprint: site.footprint, roads: site.roads, neighbours: site.neighbours ?? [], plot: title, constraints, media,
        profile: propertyService.buildProfile({ footprint: site.footprint, plot }),
        proposal: null, warnings,
      };
      return store.create({ ...app, ...derive(app), });
    },

    async updateProfile(id, input) {
      const app = await load(id);
      return save(id, app, { profile: propertyService.applyUserProfile(app.profile, input) });
    },

    async setProposal(id, proposal) {
      const app = await load(id);
      return save(id, app, { proposal });
    },
  };
}
