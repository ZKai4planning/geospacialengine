import { whatIfView, findLimits } from './whatIf.js';
import { resolveExistingRoof } from './existingRoof.js';
import { buildInterior } from './interior/index.js';
import { layoutProblems } from './interior/geometry.js';
/** The planning history at this address records a change of use into a home under a Part 3 right (approved or prior approval granted). */
const part3FromHistory = (h) => (h?.here ?? []).some((r) => r.part3 && r.outcome === 'approved');
import crypto from 'node:crypto';
import { notFound, badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { assessProposal } from './permittedDevelopment.js';
import { frontSpaceCheck, publicLandCheck, outsidePlotCheck, streetCheck } from './frontSpace.js';
import { assessLpa, buildAreas } from './lpaPolicy.js';
import { classifyProject } from './projectClassifier.js';
import { traceGpdo } from './gpdoEngine.js';
import { autoFacts } from './siteFacts.js';
import { formFromEpc } from '../providers/epc.js';
import { ppdSignals } from './ppdSignals.js';
import { estimateUplift } from './valueEstimate.js';
import { summariseHistory } from './planningHistory.js';
import { buildBlockPlanSvg, buildLdcPackHtml } from './planExport.js';
import { applyTitleInput } from './titleInfo.js';
import { buildExport, parseImport } from './applicationExport.js';
import { useGate as computeUseGate } from './useGate.js';
import { buildMap } from './mapService.js';
import { buildFrame } from './proposalGeometry.js';
import { estimatePlot, choosePlot } from '../utils/plotEstimate.js';
import { config } from '../config.js';
import { classifyOsm } from '../providers/classification.js';
import { standardiseDrawn } from './customProposal.js';
import { ringNearAddress } from '../utils/drawn.js';
import { ringCentroid, haversine } from '../utils/geo.js';

const UUID = /^[0-9a-f-]{36}$/i;
const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass8 = (deg) => COMPASS8[Math.round((deg ?? 0) / 45) % 8];

export function createApplicationService({ store, addressService, constraintsService, propertyService, mediaService }) {
  async function safe(label, fn, fallback, warnings) {
    try { return await fn(); }
    catch (e) {
      logger.warn({ label, err: e.message }, 'enrichment failed');
      warnings.push(`${label} is temporarily unavailable.`);
      return fallback;
    }
  }

  /** Council name: the postcode lookup first, then the council recorded on the address, then the nearest postcode to the point. */
  async function findAuthority(address, postcodeInfo) {
    let name = postcodeInfo?.adminDistrict ?? address?.localCustodian ?? null, code = postcodeInfo?.lpaCode ?? null;
    if (!name && address?.lat != null && address?.lng != null) {
      try { const r = await addressService.authorityAt({ lat: address.lat, lng: address.lng }); name = r?.adminDistrict ?? null; code = r?.lpaCode ?? code; }
      catch (e) { logger.warn({ err: e.message }, 'authority lookup failed'); }
    }
    return { name, code, note: 'Derived from the postcode – confirm with the planning authority finder before submitting.' };
  }

  async function load(id) {
    if (!UUID.test(id)) throw badRequest('Invalid application id.');
    let app = await store.get(id);
    if (!app) throw notFound('Application not found.');
    if (!app.authority?.name && app.address) { // older drafts, or a lookup that failed earlier: try again and keep the answer
      const authority = await findAuthority(app.address, null);
      if (authority.name) app = (await store.update(id, { authority, ...derive({ ...app, authority }) })) ?? { ...app, authority };
    }
    if (app.ppd === undefined && app.address) { // drafts saved before sale records were collected
      try {
        const ppd = await propertyService.findSales(app.address);
        app = (await store.update(id, { ppd: ppd ?? null, ...derive({ ...app, ppd: ppd ?? null }) })) ?? { ...app, ppd: ppd ?? null };
      } catch (e) { logger.warn({ err: e.message }, 'sales lookup failed'); }
    }
    if (app.outlines === undefined && app.address) { // drafts saved before constraint outlines were collected
      try {
        const outlines = await propertyService.findAreas(app.address);
        app = (await store.update(id, { outlines: outlines ?? [], ...derive({ ...app, outlines: outlines ?? [] }) })) ?? { ...app, outlines: outlines ?? [] };
      } catch (e) { logger.warn({ err: e.message }, 'constraint outlines lookup failed'); }
    }
    if ((app.lidar === undefined || app.coal === undefined) && app.address) { // drafts saved before LiDAR heights / coal risk were collected (null = provider off, stored so it is not retried)
      try {
        const lidar = (await propertyService.findHeights(app.address, app.footprint?.ring ?? null)) ?? null, coal = (await propertyService.findCoal(app.address)) ?? null;
        app = (await store.update(id, { lidar, coal, ...derive({ ...app, lidar, coal }) })) ?? { ...app, lidar, coal };
      } catch (e) { logger.warn({ err: e.message }, 'building height / coal risk lookup failed'); }
    }
    if (app.landfill === undefined && app.address) { // drafts saved before the historic landfill check (null = provider off, stored so it is not retried)
      try {
        const landfill = (await propertyService.findLandfill(app.address)) ?? null;
        app = (await store.update(id, { landfill, ...derive({ ...app, landfill }) })) ?? { ...app, landfill };
      } catch (e) { logger.warn({ err: e.message }, 'historic landfill lookup failed'); }
    }
    if ((app.flood === undefined || app.infra === undefined || app.layers === undefined) && app.address) { // drafts saved before the open flood data / infrastructure / air-quality-noise layers were collected (null = provider off, stored so it is not retried)
      try {
        const flood = app.flood === undefined ? ((await propertyService.findFlood(app.address)) ?? null) : app.flood;
        const infra = app.infra === undefined ? ((await propertyService.findInfra(app.address)) ?? null) : app.infra;
        const layers = app.layers === undefined ? ((await propertyService.findLayers(app.address)) ?? null) : app.layers;
        app = (await store.update(id, { flood, infra, layers })) ?? { ...app, flood, infra, layers };
      } catch (e) { logger.warn({ err: e.message }, 'open flood data lookup failed'); }
    }
    if (app.history === undefined && app.address) { // drafts saved before planning history existed (null = provider off, stored so it is not retried)
      try {
        const history = await propertyService.findPlanningHistory(app.address);
        app = (await store.update(id, { history: history ?? null, ...derive({ ...app, history: history ?? null }) })) ?? { ...app, history: history ?? null };
      } catch (e) { logger.warn({ err: e.message }, 'planning history lookup failed'); }
    }
    if ((app.pathways === undefined || app.powerLines === undefined) && app.address) { // drafts saved before street features / overhead lines were collected: fetch them once
      try {
        const site = await propertyService.findSite(app.address);
        if (Array.isArray(site?.pathways)) {
          const next = { ...app, pathways: site.pathways, obstacles: site.obstacles ?? [], powerLines: site.powerLines ?? [], footprint: app.footprint && site.footprint?.heightM != null && app.footprint.heightM === undefined ? { ...app.footprint, heightM: site.footprint.heightM } : app.footprint };
          app = (await store.update(id, { pathways: next.pathways, obstacles: next.obstacles, powerLines: next.powerLines, footprint: next.footprint, ...derive(next) })) ?? next;
        }
      } catch (e) { logger.warn({ err: e.message }, 'street features lookup failed'); }
    }
    if (app.interior === undefined && app.address && app.footprint) { // drafts saved before the 3D interior existed
      try { app = (await store.update(id, { interior: derive(app).interior })) ?? app; }
      catch (e) { logger.warn({ err: e.message }, 'interior backfill failed'); }
    }
    return app;
  }

  /**
   * Picks the plot outline: the registered title when it matches the house, otherwise an estimate from neighbouring buildings and roads.
   * `app.titlePlot` keeps the raw title lookup so the choice can be redone (e.g. when the applicant swaps front and back).
   */
  function resolvePlot(app, frontBearingDeg = app.profile?.frontBearingDeg?.value ?? null) {
    const title = app.titlePlot !== undefined ? app.titlePlot : (app.plot && !app.plot.estimated ? app.plot : null);
    const houseRing = app.footprint?.ring ?? null;
    let estimate = null;
    if (houseRing && config.plotSource !== 'title') {
      try {
        const frame = buildFrame({ address: app.address, footprint: app.footprint, roads: app.roads ?? [], camera: app.media?.streetView?.camera ?? null, frontBearingDeg });
        estimate = estimatePlot({ frame, houseRing, neighbours: app.neighbours ?? [], roadDetails: app.roadDetails ?? [], barriers: app.barriers ?? [] });
      } catch (e) { logger.warn({ err: e.message }, 'plot estimate failed'); }
    }
    return { ...choosePlot({ title, estimate, houseRing, mode: config.plotSource }), title };
  }

  /** Recomputes the map layers + the permitted-development assessment from the current state. */
  function derive(app) {
    const flags = app.constraints?.flags ?? {};
    const map = buildMap({
      address: app.address, footprint: app.footprint, roads: app.roads, roadDetails: app.roadDetails ?? [], trees: app.trees ?? [], pathways: app.pathways ?? [], obstacles: app.obstacles ?? [], powerLines: app.powerLines ?? [], areas: app.outlines ?? [], lidar: app.lidar ?? null, coal: app.coal ?? null, landfill: app.landfill ?? null, flags,
      neighbours: app.neighbours ?? [], plot: app.plot ?? null, protectedTrees: app.protectedTrees ?? { zones: [], trees: [] },
      camera: app.media?.streetView?.camera ?? null, profile: app.profile, proposal: app.proposal,
    });
    const form = app.address.classification.form !== 'other' ? app.address.classification.form : formFromEpc(app.epc?.builtForm) ?? ppdSignals({ ppd: app.ppd, epc: app.epc }).formHint ?? app.address.classification.form;
    const gate = computeUseGate({ classification: app.address.classification, footprintAreaM2: app.footprint?.areaM2 ?? null });
    let assessment = null;
    if (app.proposal) {
      const ex = app.profile.existingExtension;
      let proposal = app.proposal, notes = [];
      if (proposal.type === 'custom_polygon') {
        // a drawn shape is measured, then screened as the kind of work the applicant chose (needs a real outline to measure against)
        if (!map.frame.indicative) {
          const b = map.siteChecks.boundary;
          ({ proposal, notes } = standardiseDrawn(proposal, map.drawn, {
            houseWidthM: map.frame.houseWidthM, existingDepthM: ex.present ? ex.depthM ?? 0 : 0, existingBeyondOutline: ex.present && ex.inOutline === false,
            boundaryM: !b.estimated && !(b.approxM > 1) && (b.status === 'inside' || b.status === 'crosses') ? b.minDistanceM : null,
          }));
        } else proposal = null;
      }
      let autoNote = null;
      if (proposal) {          // fill in what the plot geometry already tells us (distances to boundaries, buildings already on the plot)
        const auto = autoFacts(proposal, map.siteFacts, { registered: map.siteFacts.registered });
        if (auto.names.length) { proposal = { ...proposal, ...auto.fields, _auto: auto.names }; autoNote = { id: 'auto-facts', status: 'info', message: `Measured from the plan instead of asked: ${auto.names.map((n) => ({ distanceToSideBoundaryM: 'distance to the nearest side/rear boundary', distanceToRearBoundaryM: 'distance to the rear boundary', distanceToBoundaryM: 'distance to the nearest boundary', additionsAreaM2: 'area of buildings already on the plot plus this work' }[n] ?? n)).join('; ')}. Correct them in the form if you know better.` }; }
      }
      if (proposal) {
        assessment = assessProposal({
          country: app.country, houseForm: form, flags: part3FromHistory(app.history) ? { ...flags, part3Conversion: true } : flags,
          proposal, houseWidthM: map.frame.indicative ? null : map.frame.houseWidthM,
          existingExtensionDepthM: ex.present === false ? 0 : ex.depthM,
          plotAreaM2: app.profile.siteAreaM2.value, isOriginalDwelling: app.profile.originalDwelling.value !== false,
          frontSpace: frontSpaceCheck({ proposal, siteChecks: map.siteChecks }),
          publicLand: publicLandCheck({ proposal, siteChecks: map.siteChecks }),
          outsidePlot: outsidePlotCheck({ proposal, siteChecks: map.siteChecks }),
          existingHeightM: app.footprint?.heightM ?? null,
          existingRoof: resolveExistingRoof({ lidar: app.lidar, footprint: app.footprint }),
          street: streetCheck({ proposal, siteChecks: map.siteChecks }),
          useGate: gate, frontCheck: { corner: !!map.frame.corner, source: map.frame.frontSource, facing: compass8(map.frame.frontBearingDeg) },
        });
        assessment.checks.unshift(...notes);
        // what the energy certificate adds (rooms, built form, flats, earlier extensions) - information only, never a verdict on its own
        const epc = app.epc, epcNotes = [];
        if (epc) {
          if (/flat|maisonette/i.test(epc.propertyType ?? '')) epcNotes.push({ id: 'epc-flat', status: 'warn', message: `The energy certificate records this as a ${String(epc.propertyType).toLowerCase()}. Flats and maisonettes have no householder permitted development rights – confirm the property type.` });
          if (app.address.classification.form === 'other' && formFromEpc(epc.builtForm)) epcNotes.push({ id: 'epc-form', status: 'info', message: `House form taken from the energy certificate (${epc.builtForm}), because the map data did not say. The 3 m / 4 m rear-depth limits depend on it.` });
          if (epc.extensionCount > 0 && app.profile.existingExtension.present == null) epcNotes.push({ id: 'epc-extension', status: 'info', message: `The energy certificate records ${epc.extensionCount} extension${epc.extensionCount > 1 ? 's' : ''}. Permitted-development limits count what was built since the original house, so tell us how far the existing extension reaches.` });
        }
        const hist = summariseHistory(app.history, { type: proposal.type, existingExtensionKnown: app.profile.existingExtension.present != null });
        if (hist) { assessment.precedent = hist.precedent; assessment.checks.unshift(...hist.checks); }
        // Article 4: say WHICH rights the direction removes, when the register records it
        const art4 = (app.outlines ?? []).filter((a) => a.dataset === 'article-4-direction-area' && map.siteChecks.areas.find((x) => x.id === a.id)?.status === 'inside').slice(0, 2)
          .map((a) => ({ id: 'article4-details', status: 'warn', message: `Article 4 direction${a.name ? ` "${a.name}"` : ''}${a.details?.rights ? ` – rights removed: ${a.details.rights}` : ''}.${a.details?.notes ? ` ${a.details.notes}` : ''} Read the direction itself${a.details?.documentUrl ? `: ${a.details.documentUrl}` : ` on the register: ${a.url}`}.` }));
        assessment.checks.unshift(...art4);
        assessment.checks.unshift(...epcNotes, ...ppdSignals({ ppd: app.ppd, epc: app.epc }).checks);
        if (autoNote) assessment.checks.unshift(autoNote);
        // stage 1: what is this project and which questions matter; stage 2: the GPDO provisions laid out against the checks
        assessment.project = classifyProject({
          proposal, original: app.proposal, houseForm: form, flags, profile: app.profile,
          constraintsChecked: app.constraints != null, frontSpaceKnown: proposal.type === 'front_porch' && ['inside', 'crosses'].includes(map.siteChecks.boundary?.status),
        });
        assessment.gpdo = traceGpdo({ workType: proposal.type, checks: assessment.checks, route: assessment.verdict, proposal });
        // then the council's own guidance, using the plot / house / extension areas measured on the plan
        const propLayer = map.layers.find((l) => l.kind === 'proposal');
        assessment.value = estimateUplift({
          ppd: app.ppd, epc: app.epc, type: proposal.type, storeys: proposal.storeys ?? 1, verdict: assessment.verdict,
          extensionFootprintM2: propLayer && propLayer.style !== 'roof' ? propLayer.areaM2 : null,
        });
        assessment.lpa = assessLpa({
          authorityName: app.authority?.name, verdict: assessment.verdict, flags, proposal,
          plotAreaM2: app.profile.siteAreaM2.value ?? app.plot?.areaM2 ?? null, houseFootprintM2: app.footprint?.areaM2 ?? null,
          proposalAreaM2: propLayer && propLayer.style !== 'roof' ? propLayer.areaM2 : 0, existingDepthM: ex.present === false ? 0 : ex.depthM ?? 0,
          outsidePlot: outsidePlotCheck({ proposal, siteChecks: map.siteChecks }), publicLand: publicLandCheck({ proposal, siteChecks: map.siteChecks }),
          habitableRooms: app.epc?.habitableRooms ?? app.profile.habitableRooms?.value ?? null, habitableRoomsSource: app.epc?.habitableRooms != null ? 'epc' : 'user', precedent: hist?.precedent ?? null, fortyFive: map.siteChecks.fortyFive,
        });
        if (notes.some((n) => n.id === 'drawn-warning')) {
          // the shape does not look like the kind of work selected, so a verdict would be misleading
          assessment.confidence = 'needs_confirmation';
          assessment.label = 'Check the shape and the "Screen it as" setting';
          assessment.summary = 'The shape you drew does not match the kind of work selected under "Screen it as", so this result is unreliable. Change that setting or redraw the shape.';
        }
      }
    }
    const propLayer0 = map.layers.find((l) => l.kind === 'proposal');
    const areas = buildAreas({
      plotAreaM2: app.profile.siteAreaM2.value ?? app.plot?.areaM2 ?? null,
      plotKind: app.profile.siteAreaM2.source === 'user' ? 'user' : app.plot?.estimated ? 'estimate' : 'title',
      houseFootprintM2: app.footprint?.areaM2 ?? null,
      extensionAreaM2: propLayer0 ? (propLayer0.style === 'roof' ? 0 : propLayer0.areaM2) : null,
      extensionDims: propLayer0?.dimsText ?? null, extensionLabel: propLayer0?.label ?? null,
    });
    // the inside of the building for the 3D view: built from the same house frame as the map, so both always line up
    let interior;
    try {
      const frame = buildFrame({ address: app.address, footprint: app.footprint, roads: app.roads ?? [], camera: app.media?.streetView?.camera ?? null, frontBearingDeg: app.profile.frontBearingDeg?.value ?? null });
      interior = buildInterior({
        frame, profile: app.profile, proposal: app.proposal ?? null, form, lidar: app.lidar ?? null,
        plotRings: app.plot ? (app.plot.rings ?? [app.plot.ring]).filter(Boolean) : [], neighbours: app.neighbours ?? [], setup: app.interiorSetup ?? {},
      });
    } catch (e) { logger.warn({ err: e.message }, 'interior model failed'); interior = { available: false, reason: 'The inside could not be built for this property.' }; }
    return { map, assessment, useGate: gate, areas, interior };
  }

  const save = (id, app, patch) => store.update(id, { ...patch, ...derive({ ...app, ...patch }) });

  return {
    load,

    /** Called when the applicant CONFIRMS an address. Captures address + postcode and enriches the site. */
    async create({ id: addressId, manual }) {
      const address = manual ? await addressService.manual(manual) : await addressService.getById(addressId);
      const warnings = [];
      if (address.uprnMatch?.confidence === 'low') warnings.push(`Several properties are very close together, so UPRN ${address.uprn} is a best guess from the map – please confirm it.`);
      if (address.approximate) warnings.push('You entered this address manually, so the map is centred on the postcode – please check the yellow outline is the right building.');
      const [postcodeInfo, site, plot, title0, epc, ppd, history, outlines, tpo, constraints, media] = await Promise.all([
        safe('Postcode data', () => addressService.postcodeInfo(address.postcode), null, warnings),
        safe('Building outline', () => propertyService.findSite(address), { footprint: null, roads: [], roadDetails: [], trees: [], neighbours: [], barriers: [], pathways: [], obstacles: [], powerLines: [] }, warnings),
        safe('Site area', () => propertyService.findPlot(address), null, warnings),
        safe('Plot boundary', () => propertyService.findTitle(address), undefined, warnings), // undefined = lookup failed, null = nothing found
        safe('Energy certificate', () => propertyService.findEpc(address), null, warnings),
        safe('Land Registry sales', () => propertyService.findSales(address), null, warnings),
        safe('Planning history', () => propertyService.findPlanningHistory(address), null, warnings),
        safe('Constraint outlines', () => propertyService.findAreas(address), [], warnings),
        safe('Protected trees', () => propertyService.findProtectedTrees(address), { zones: [], trees: [] }, warnings),
        safe('Planning constraints', () => constraintsService.check(address), null, warnings),
        safe('Street imagery', () => mediaService.prepare(address), { streetView: { available: false }, aerial: { available: true } }, warnings),
      ]);

      // The address point can sit just outside every title polygon (e.g. on the pavement side): try the middle of the building too.
      let title = title0 ?? null;
      if (title0 === null && site.footprint?.ring) {
        const c = ringCentroid(site.footprint.ring);
        title = await safe('Plot boundary', () => propertyService.findTitleAt({ lat: c.lat, lng: c.lng }), null, warnings);
      }

      // Now the registered plot is known, ask the constraint datasets about the WHOLE plot, not just the address point (a conservation area or flood zone
      // that covers only the back garden still matters). If that search fails the point answer from above stays.
      let constraintsFinal = constraints;
      if (constraints && title?.ring) constraintsFinal = await safe('Planning constraints across the plot', () => constraintsService.check({ ...address, ring: title.ring }), constraints, warnings);

      const [lidar, coal, landfill, flood, infra, layers] = await Promise.all([
        safe('Building heights', () => propertyService.findHeights(address, site.footprint?.ring ?? null), null, warnings),
        safe('Coal mining risk', () => propertyService.findCoal(address), null, warnings),
        safe('Historic landfill', () => propertyService.findLandfill(address), null, warnings),
        safe('Open flood data', () => propertyService.findFlood(address), null, warnings),
        safe('Nearby watercourses and substations', () => propertyService.findInfra(address), null, warnings),
        safe('Air quality, flood defences, main river and noise', () => propertyService.findLayers(address), null, warnings),
      ]);

      // Property type: fall back to OSM's building tag when the address source didn't classify it
      let classification = address.classification;
      if (classification.use === 'unknown' && site.footprint) {
        const c = classifyOsm(site.footprint.buildingType, site.footprint.useTags); // the building's own OSM tags, incl. a pub / shop / office point inside it
        if (c.use !== 'unknown') classification = c;
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
        authority: await findAuthority(address, postcodeInfo),
        footprint: site.footprint, roads: site.roads, roadDetails: site.roadDetails ?? [], trees: site.trees ?? [], pathways: site.pathways ?? [], obstacles: site.obstacles ?? [], epc: epc ?? null, ppd: ppd ?? null, history: history ?? null, outlines: outlines ?? [], lidar: lidar ?? null, coal: coal ?? null, landfill: landfill ?? null, flood: flood ?? null, infra: infra ?? null, layers: layers ?? null, powerLines: site.powerLines ?? [], neighbours: site.neighbours ?? [], barriers: site.barriers ?? [], plot: null, titlePlot: title, protectedTrees: tpo ?? { zones: [], trees: [] }, constraints: constraintsFinal, media,
        profile: propertyService.buildProfile({ footprint: site.footprint, plot }),
        proposal: null, warnings,
      };
      const chosen = resolvePlot(app);
      app.plot = chosen.plot;
      if (chosen.note) warnings.push(chosen.note);
      return store.create({ ...app, ...derive(app), });
    },

    /** A4 block plan at a true printed scale (SVG), for the application as it stands. */
    async blockPlanSvg(id) {
      const app = await load(id);
      if (!app.map?.layers) throw badRequest('There is no map to draw yet.');
      return buildBlockPlanSvg(app);
    },
    /** Draft Lawful Development Certificate supporting statement (HTML, print to PDF). */
    async ldcPack(id) {
      const app = await load(id);
      if (!app.assessment?.gpdo) throw badRequest('Choose the work first: the statement is built from the permitted-development check.');
      return buildLdcPackHtml(app);
    },

    /** Everything the applicant entered plus the engine's results, as one portable JSON document. */
    async exportJson(id) { return buildExport(await load(id)); },

    /** Re-creates a draft from an exported file: the address is re-fetched, then the saved answers and proposal are replayed. */
    async importJson(doc) {
      const inputs = parseImport(doc);
      let app = await this.create({ id: inputs.address.id, manual: inputs.address.manual });
      const warnings = [];
      if (Object.keys(inputs.profile).length) {
        try { app = await this.updateProfile(app.id, inputs.profile); }
        catch (e) { warnings.push(`Some saved answers were not applied: ${e.message}`); }
      }
      if (inputs.proposal) {
        try { app = await this.setProposal(app.id, inputs.proposal); }
        catch (e) { warnings.push(`The saved proposal was not applied: ${e.message}`); }
      }
      if (inputs.title) {
        try { app = await this.setTitle(app.id, inputs.title); }
        catch (e) { warnings.push(`The saved title number was not applied: ${e.message}`); }
      }
      if (inputs.interior) {
        try { app = await this.updateInterior(app.id, inputs.interior); }
        catch (e) { warnings.push(`The saved changes to the inside were not applied: ${e.message}`); }
      }
      if (warnings.length) app = (await store.update(app.id, { warnings: [...(app.warnings ?? []), ...warnings] })) ?? app;
      return app;
    },

    async updateProfile(id, input) {
      const app = await load(id);
      if (input.neighbourWindow && haversine(app.address, input.neighbourWindow) > 40) throw badRequest('Mark the neighbour\'s window on the building next to the property.');
      const profile = propertyService.applyUserProfile(app.profile, input);
      const patch = { profile };
      // front/back decides which side is the road, so an ESTIMATED plot outline has to be redrawn (a matching title is kept as is)
      if (input.isHouse !== undefined) {
        const c = app.address.classification;
        patch.address = { ...app.address, classification: {
          ...c, use: input.isHouse ? 'residential' : 'non_residential', isResidential: input.isHouse, useSource: 'user',
          useReason: input.isHouse ? null : 'You told us this is not a house.',
          propertyType: c.propertyType === 'Not confirmed' || c.use === 'non_residential' ? (input.isHouse ? 'House (confirmed by you)' : 'Not a house (confirmed by you)') : c.propertyType,
        } };
      }
      if (input.frontBearingDeg !== undefined) patch.plot = resolvePlot({ ...app, profile }, profile.frontBearingDeg.value).plot;
      return save(id, app, patch);
    },

    /** Title number + tenure, recorded against the property's UPRN (see services/titleInfo.js). */
    async setTitle(id, input) {
      const app = await load(id);
      let title;
      try { title = applyTitleInput(app, input); } catch (e) { throw badRequest(e.message); }
      const patch = { title };
      // The title number is bound to the registered polygon this address resolved to, and every constraint is then searched across that whole polygon.
      // (Open data cannot turn a title number into a polygon on its own: the number is the applicant's, the polygon comes from the address.)
      const poly = app.titlePlot && !app.titlePlot.estimated ? app.titlePlot : null;
      if (title.titleNumber && poly) {
        title.polygonRef = poly.reference ?? null; title.polygonSource = poly.source ?? null; title.polygonAreaM2 = poly.areaM2 ?? null;
        if (poly.ring && app.constraints?.scope !== 'plot') {
          try { patch.constraints = await constraintsService.check({ ...app.address, ring: poly.ring }); }
          catch (e) { logger.warn({ err: e.message }, 'plot-wide constraint search failed'); }
        }
      } else if (title.titleNumber) { title.polygonRef = null; title.note = 'No registered polygon matched this address, so the constraints were searched at the address point only.'; }
      return save(id, app, patch);
    },

    /** Applicant edits to the inside: storeys, ceiling height, which side the stairs are, room names and uses. */
    async updateInterior(id, setup) {
      const app = await load(id);
      if (setup.layout) {   // the drawn rooms must fit this house: sizes are checked against the mapped outline
        const f = app.map?.frame;
        const problems = f && !f.indicative ? layoutProblems(setup.layout, f.houseWidthM, f.houseDepthM, (app.interior?.rooms ?? []).filter((r) => r.isNew)) : ['There is no house outline to draw rooms in.'];
        if (problems.length) throw badRequest(`The floor plan has a problem: ${problems.slice(0, 3).join(' ')}`);
      }
      const prev = app.interiorSetup ?? {};
      const next = { ...prev, ...setup, rooms: setup.rooms ? { ...(prev.rooms ?? {}), ...setup.rooms } : prev.rooms };
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];   // null clears a setting
      return save(id, app, { interiorSetup: next });
    },

    /** WHAT-IF (nothing is saved): the answer for a changed proposal. */
    async whatIf(id, proposal) {
      const app = await load(id);
      if (proposal.type === 'custom_polygon' && !ringNearAddress(proposal.ring, app.address)) throw badRequest('Draw the shape on or very close to the property.');
      return whatIfView(derive({ ...app, proposal }));
    },
    /** WHAT-IF: where moving one number changes the verdict (nothing is saved). */
    async whatIfLimits(id, proposal, field) {
      const app = await load(id);
      return findLimits({ proposal, field, evaluate: async (p) => whatIfView(derive({ ...app, proposal: p })) });
    },

    async setProposal(id, proposal) {
      const app = await load(id);
      if (proposal.type === 'custom_polygon' && !ringNearAddress(proposal.ring, app.address)) {
        throw badRequest('Draw the shape on or very close to the property.');
      }
      return save(id, app, { proposal });
    },
  };
}
