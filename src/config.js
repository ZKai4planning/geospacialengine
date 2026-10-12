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
    HTTP_USER_AGENT: z.string().default('uk-planning-engine/1.0 (+https://github.com/your-org/uk-planning-engine)'),
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
    OVERPASS_URLS: z.string().default('https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter'),
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
  overpassUrls: env.OVERPASS_URLS.split(',').map((s) => s.trim()).filter(Boolean),
});
