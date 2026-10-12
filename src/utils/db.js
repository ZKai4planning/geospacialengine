import pg from 'pg';
import { config } from '../config.js';
import { logger } from './logger.js';
import { pgConfig } from './pgConfig.js';

let pool;

/**
 * Shared Postgres pool (exposes .query(text, params)). Returns null when DATABASE_URL is not set, so the app still
 * runs locally with in-memory drafts and no UPRN matching.
 *
 * Serverless note: every warm Vercel instance holds its own pool, so keep PG_POOL_MAX small (default 3) and, on a managed
 * provider, connect through its connection pooler (PgBouncer) rather than straight to the database.
 */
export function getDb() {
  if (!config.databaseUrl) return null;
  if (!pool) {
    pool = new pg.Pool({
      ...pgConfig(config.databaseUrl, { ssl: config.databaseSsl, ca: config.databaseCa }),
      max: config.pgPoolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 20_000,
    });
    pool.on('error', (err) => logger.warn({ err: err.message }, 'idle Postgres client error'));
  }
  return pool;
}
