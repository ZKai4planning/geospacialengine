import { createProviders } from './providers/index.js';
import { createMemoryStore } from './store/memoryStore.js';
import { createPgStore } from './store/pgStore.js';
import { getDb } from './utils/db.js';
import { createAddressService } from './services/addressService.js';
import { createConstraintsService } from './services/constraintsService.js';
import { createPropertyService } from './services/propertyService.js';
import { createMediaService } from './services/mediaService.js';
import { createUprnMatcher } from './services/uprnMatcher.js';
import { createOsmMap } from './providers/osmMap.js';
import { config } from './config.js';
import { createApplicationService } from './services/applicationService.js';

/** Simple dependency wiring – pass overrides in tests (fake providers, custom store...). */
export function createContainer(overrides = {}) {
  const db = overrides.db !== undefined ? overrides.db : getDb();
  const providers = overrides.providers ?? createProviders({ db });
  // Drafts live in Postgres when DATABASE_URL is set (required on Vercel: serverless instances don't share memory).
  // Mock mode and tests always use the in-memory store so they never touch your database.
  const store = overrides.store ?? (db && config.mode !== 'mock' ? createPgStore({ db }) : createMemoryStore());
  const uprnMatcher = createUprnMatcher({ openUprn: providers.uprn, maxM: config.openUprnMaxM });
  const addressService = createAddressService({ providers, uprnMatcher });
  const constraintsService = createConstraintsService({ providers });
  const propertyService = createPropertyService({ providers });
  const osmMap = overrides.osmMap !== undefined ? overrides.osmMap : config.mode === 'mock' ? null : createOsmMap();
  const mediaService = createMediaService({ providers, osmMap });
  const applicationService = createApplicationService({ store, addressService, constraintsService, propertyService, mediaService });
  return { providers, store, addressService, constraintsService, propertyService, mediaService, applicationService };
}
