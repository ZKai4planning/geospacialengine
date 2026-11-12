import 'dotenv/config';
import { z } from 'zod';

const choice = (...v) => z.enum(['auto', ...v]).default('auto');

const env = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().default(3000),
    LOG_LEVEL: z.string().default('info'),
    CORS_ORIGINS: z.string().default(''),
    MOCK_PROVIDERS: z.enum(['true', 'false']).default('false'),
    // provider selection ("auto" = best option for the keys you have)
    ADDRESS_PROVIDER: choice('os', 'osm'),
    AERIAL_PROVIDER: choice('esri', 'google', 'none'),
    STREETVIEW_PROVIDER: choice('mapillary', 'google', 'none'),
    // optional keys
    OS_DATA_HUB_KEY: z.string().optional(),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    GOOGLE_URL_SIGNING_SECRET: z.string().optional(),
    MAPILLARY_TOKEN: z.string().optional(),
    CACHE_TTL_SECONDS: z.coerce.number().int().default(3600),
    // Public OSM services block anonymous clients – identify your app (add a real contact URL/email)
    HTTP_USER_AGENT: z.string().default('uk-planning-engine/1.0 (+https://ai4planning.com/contact)'),
    OVERPASS_TIMEOUT_MS: z.coerce.number().int().default(15000),
    OVERPASS_RADIUS_M: z.coerce.number().int().default(120),
    POSTCODES_TIMEOUT_MS: z.coerce.number().int().default(15000),
    IMAGERY_TIMEOUT_MS: z.coerce.number().int().default(30000),
    MAP_TILE_URL: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    MAP_TILE_ATTRIBUTION: z.string().default('© OpenStreetMap contributors'),
    MAP_TILE_MAX_ZOOM: z.coerce.number().int().default(19),
    // Postgres (DigitalOcean, Neon, RDS, ... any standard Postgres). Server-side only.
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z.enum(['require', 'disable']).default('require'),
    DATABASE_CA_CERT: z.string().optional(),
    PG_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
    OPEN_UPRN_MAX_M: z.coerce.number().int().default(15),
    // plot outline: 'auto' = registered title when it matches the house, else an estimate; 'title' = title only; 'estimate' = always estimate
    PLOT_SOURCE: choice('title', 'estimate'),
    // where the registered title polygon comes from: 'auto' = local INSPIRE table (if DATABASE_URL set) then the live service
    TITLE_SOURCE: choice('local', 'live'),
    // Energy Performance Certificate register (free account). Without a key the EPC lookup is simply off.
    // Planning history from PlanIt. OFF by default: PlanIt has its own terms (free for non-commercial use) - check them for your use first.
    PLANNING_HISTORY_ENABLED: z.string().default('false'),
    PLANIT_URL: z.string().default('https://www.planit.org.uk/api/applics/json'),
    PPD_SPARQL_URL: z.string().default('https://landregistry.data.gov.uk/landregistry/query'),   // Land Registry Price Paid Data (open, no key)
    EPC_API_URL: z.string().default('https://epc.opendatacommunities.org/api/v1/domestic/search'),
    EPC_API_EMAIL: z.string().optional(),
    EPC_API_KEY: z.string().optional(),
    EPC_API_TOKEN: z.string().optional(),            // new service: bearer token from My Account (used instead of email + key)
    EPC_POSTCODE_PARAM: z.string().default('postcode'),
    // LiDAR roof / eaves height (Environment Agency). On by default; fails soft. Defaults are the EA's WCS 2.0.1 services; override if `npm run check:lidar` shows different ones.
    LIDAR_ENABLED: z.enum(['true', 'false']).default('true'),
    LIDAR_DSM_URL: z.string().optional(),
    LIDAR_DTM_URL: z.string().optional(),
    LIDAR_DSM_COVERAGE: z.string().optional(),
    LIDAR_DTM_COVERAGE: z.string().optional(),
    LIDAR_AXES: z.string().optional(),       // WCS axis labels for EPSG:27700, 'E,N' by default
    // Coal mining Development High Risk Areas. OFF by default: check the data's re-use licence with the Mining Remediation Authority first.
    COAL_RISK_ENABLED: z.enum(['true', 'false']).default('false'),
    COAL_LIVE_URL: z.string().optional(),
    // Historic landfill (made ground): Environment Agency Conditional Licence applies, so OFF unless you switch it on after reading it.
    LANDFILL_ENABLED: z.enum(['true', 'false']).default('false'),
    LANDFILL_URL: z.string().default('https://environment.data.gov.uk/arcgis/rest/services/EA/HistoricLandfill/FeatureServer/0'),
    // OVERPASS_URLS: z.string().default('https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter'),
    OVERPASS_URLS: z.string().default('https://overpass.ai4planning.com/api/interpreter'),
    // Your own Overpass server (deploy/overpass): tried first, key sent as the X-Api-Key header the proxy checks. The public mirrors above stay as fallback.
    OVERPASS_SELF_URL: z.string().optional(),
    OVERPASS_SELF_KEY: z.string().optional(),
    // Your own constraints / tree / title mirror (constraints.ai4planning.com): tried first, key sent as the X-Api-Key header. planning.data.gov.uk stays as fallback.
    CONSTRAINTS_URL: z.string().optional(),
    CONSTRAINTS_KEY: z.string().optional(),
  })
  // Blank values (e.g. "ADDRESS_PROVIDER=" pasted from .env.example into a hosting dashboard) count as "not set".
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  mode: env.MOCK_PROVIDERS === 'true' ? 'mock' : 'live',
  addressProvider: env.ADDRESS_PROVIDER,
  aerialProvider: env.AERIAL_PROVIDER,
  streetViewProvider: env.STREETVIEW_PROVIDER,
  osKey: env.OS_DATA_HUB_KEY || null,
  googleKey: env.GOOGLE_MAPS_API_KEY || null,
  googleSigningSecret: env.GOOGLE_URL_SIGNING_SECRET || null,
  mapillaryToken: env.MAPILLARY_TOKEN || null,
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  userAgent: env.HTTP_USER_AGENT,
  overpassTimeoutMs: env.OVERPASS_TIMEOUT_MS,
  overpassRadiusM: env.OVERPASS_RADIUS_M,
  postcodesTimeoutMs: env.POSTCODES_TIMEOUT_MS,
  imageryTimeoutMs: env.IMAGERY_TIMEOUT_MS,
  mapTileUrl: env.MAP_TILE_URL,
  mapTileAttribution: env.MAP_TILE_ATTRIBUTION,
  mapTileMaxZoom: env.MAP_TILE_MAX_ZOOM,
  databaseUrl: env.DATABASE_URL || null,
  databaseSsl: env.DATABASE_SSL,
  databaseCa: env.DATABASE_CA_CERT ? env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null,
  pgPoolMax: env.PG_POOL_MAX,
  openUprnMaxM: env.OPEN_UPRN_MAX_M,
  plotSource: env.PLOT_SOURCE,
  titleSource: env.TITLE_SOURCE,
  // Google Static Maps only draws whole zoom levels; Esri can draw any, which lets the map fill the picture with the plot
  fractionalZoom: !(env.AERIAL_PROVIDER === 'google' || (env.AERIAL_PROVIDER === 'auto' && !!env.GOOGLE_MAPS_API_KEY)),
  planningHistoryEnabled: String(env.PLANNING_HISTORY_ENABLED).toLowerCase() === 'true', planitUrl: env.PLANIT_URL,
  ppdUrl: env.PPD_SPARQL_URL,
  epcUrl: env.EPC_API_URL, epcEmail: env.EPC_API_EMAIL || null, epcKey: env.EPC_API_KEY || null, epcToken: env.EPC_API_TOKEN || null, epcPostcodeParam: env.EPC_POSTCODE_PARAM,
  lidarEnabled: env.LIDAR_ENABLED === 'true', lidarDsmUrl: env.LIDAR_DSM_URL || null, lidarDtmUrl: env.LIDAR_DTM_URL || null, lidarDsmCoverage: env.LIDAR_DSM_COVERAGE || null, lidarDtmCoverage: env.LIDAR_DTM_COVERAGE || null, lidarAxes: env.LIDAR_AXES ? env.LIDAR_AXES.split(',').map((x) => x.trim()) : null,
  coalEnabled: env.COAL_RISK_ENABLED === 'true', coalLiveUrl: env.COAL_LIVE_URL || null,
  landfillEnabled: env.LANDFILL_ENABLED === 'true', landfillUrl: env.LANDFILL_URL,
  overpassUrls: env.OVERPASS_URLS.split(',').map((s) => s.trim()).filter(Boolean),
  overpassSelfUrl: env.OVERPASS_SELF_URL || null, overpassSelfKey: env.OVERPASS_SELF_KEY || null,
  constraintsUrl: env.CONSTRAINTS_URL ? env.CONSTRAINTS_URL.trim().replace(/\/+$/, '') : null, constraintsKey: env.CONSTRAINTS_KEY?.trim() || null,
});
