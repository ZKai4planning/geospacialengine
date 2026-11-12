import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createOsPlaces } from './osPlaces.js';
import { createOsmAddress } from './osmAddress.js';
import { createPostcodesIo } from './postcodesIo.js';
import { createEpc } from './epc.js';
import { createLandRegistry } from './landRegistry.js';
import { createPlanit } from './planit.js';
import { createConstraintAreas } from './constraintAreas.js';
import { createLidarHeights } from './lidarHeights.js';
import { createCoalRisk } from './coalRisk.js';
import { createLandfill } from './landfill.js';
import { fetchJson } from '../utils/http.js';
import { createOsmBuildings } from './osmBuildings.js';
import { createPlanningData } from './planningData.js';
import { createTitleBoundary } from './titleBoundary.js';
import { createInspireLocal, createTitleChain } from './inspireLocal.js';
import { createProtectedTrees } from './protectedTrees.js';
import { createConstraintsClient, createHybridPlanningData, createTitleMirror } from './constraintsMirror.js';
import { createGoogleMedia } from './googleMedia.js';
import { createEsriAerial } from './esriAerial.js';
import { createMapillary } from './mapillary.js';
import { createPlaceholderMedia } from './placeholderMedia.js';
import { createMockProviders } from './mock.js';
import { createOpenUprn } from './openUprn.js';
import { getDb } from '../utils/db.js';

/**
 * Provider factory. Each provider sits behind a tiny interface, so swapping vendors
 * (getAddress.io, Ideal Postcodes, Mapbox, Bing...) means writing one file.
 *
 *   addresses : OS Places (key)  | OpenStreetMap (no key)
 *   aerial    : Google (key)     | Esri World Imagery (no key)
 *   street    : Google (key)     | Mapillary (free token)
 */
export function createProviders({ db = getDb() } = {}) {
  const placeholder = createPlaceholderMedia();

  if (config.mode === 'mock') {
    logger.warn('MOCK mode: sample data only. Try postcode E6 2AA.');
    return { ...createMockProviders(), streetView: placeholder, aerial: placeholder, uprn: null };
  }

  const google = config.googleKey ? createGoogleMedia({ apiKey: config.googleKey, signingSecret: config.googleSigningSecret }) : null;
  const need = (name, v) => { if (!v) throw new Error(`${name} selected but its key/token is not configured`); return v; };

  const addrChoice = config.addressProvider === 'auto' ? (config.osKey ? 'os' : 'osm') : config.addressProvider;
  const aerialChoice = config.aerialProvider === 'auto' ? (google ? 'google' : 'esri') : config.aerialProvider;
  const streetChoice = config.streetViewProvider === 'auto' ? (google ? 'google' : config.mapillaryToken ? 'mapillary' : 'none') : config.streetViewProvider;

  const postcodes = createPostcodesIo();
  // Our own constraints / tree / title mirror (CONSTRAINTS_URL + CONSTRAINTS_KEY). null = not configured: everything stays on planning.data.gov.uk.
  const constraintsClient = createConstraintsClient();
  const providers = {
    address: addrChoice === 'os' ? createOsPlaces({ apiKey: need('OS_DATA_HUB_KEY', config.osKey) }) : createOsmAddress({ postcodes }),
    postcodes,
    buildings: createOsmBuildings(),
    planningData: constraintsClient ? createHybridPlanningData({ live: createPlanningData(), client: constraintsClient }) : createPlanningData(),
    // HM Land Registry plot outline: our own copy of the INSPIRE parcels in Postgres first (fast, no rate limits), then the live
    // planning.data.gov.uk service. TITLE_SOURCE=local | live restricts it to one.
    titles: createTitleChain([
      db && config.titleSource !== 'live' ? createInspireLocal({ db }) : null,
      constraintsClient && config.titleSource !== 'live' ? createTitleMirror({ client: constraintsClient }) : null,
      config.titleSource !== 'local' || !db ? createTitleBoundary() : null,
    ]),
    constraintAreas: createConstraintAreas(),
    // roof / eaves height from Environment Agency LiDAR (needs `npm i geotiff`); coal mining risk (OFF unless COAL_RISK_ENABLED=true)
    lidar: config.lidarEnabled ? createLidarHeights({ dsmUrl: config.lidarDsmUrl ?? undefined, dtmUrl: config.lidarDtmUrl ?? undefined, dsmCoverage: config.lidarDsmCoverage ?? undefined, dtmCoverage: config.lidarDtmCoverage ?? undefined, axes: config.lidarAxes ?? undefined, userAgent: config.userAgent }) : null,
    coal: config.coalEnabled ? createCoalRisk({ db, liveUrl: config.coalLiveUrl, fetchJson }) : null,
    landfill: config.landfillEnabled ? createLandfill({ url: config.landfillUrl, fetchJson }) : null,
    planning: createPlanit({ url: config.planitUrl, enabled: config.planningHistoryEnabled }),
    landRegistry: createLandRegistry({ url: config.ppdUrl }),
    epc: createEpc({ url: config.epcUrl, email: config.epcEmail, key: config.epcKey, token: config.epcToken, postcodeParam: config.epcPostcodeParam }),
    protectedTrees: createProtectedTrees({ mirror: constraintsClient }), // council tree preservation zones + individual protected trees
    // Authoritative plot area needs a licensed parcel source (INSPIRE polygons / OS NGD). Left unset on purpose.
    parcels: { name: 'none', async findPlot() { return null; } },
    uprn: db ? createOpenUprn({ db }) : null,
    aerial: { esri: createEsriAerial(), google, none: placeholder }[aerialChoice] ?? need('GOOGLE_MAPS_API_KEY', google),
    streetView: { google, mapillary: config.mapillaryToken ? createMapillary({ token: config.mapillaryToken }) : null, none: placeholder }[streetChoice]
      ?? need(streetChoice === 'google' ? 'GOOGLE_MAPS_API_KEY' : 'MAPILLARY_TOKEN', null),
  };
  logger.info({ address: providers.address.name, aerial: providers.aerial.name, streetView: providers.streetView.name, openUprn: providers.uprn ? 'postgres' : 'off (set DATABASE_URL)', titles: providers.titles.name, constraints: providers.planningData.name }, 'providers ready');
  return providers;
}
