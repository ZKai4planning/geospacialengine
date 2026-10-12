import { upstream } from '../utils/errors.js';

const INVALID_UUID = '22P02';

/**
 * Application drafts in Postgres (table `applications`: id uuid, data jsonb). Same three methods as the
 * in-memory store: create / get / update. `update` is an atomic shallow merge done in Postgres
 * (function `application_patch`), the same semantics as {...current, ...patch}.
 */
export function createPgStore({ db }) {
  const fail = (op, e) => {
    throw upstream('Application storage is temporarily unavailable. Please try again.', { op, err: e.message, code: e.code });
  };

  return {
    name: 'postgres',

    async create(app) {
      try { await db.query('INSERT INTO applications (id, data) VALUES ($1, $2::jsonb)', [app.id, JSON.stringify(app)]); }
      catch (e) { fail('create', e); }
      return app;
    },

    async get(id) {
      try {
        const { rows } = await db.query('SELECT data FROM applications WHERE id = $1', [id]);
        return rows[0]?.data ?? null;
      } catch (e) { if (e.code === INVALID_UUID) return null; fail('get', e); }
    },

    async update(id, patch) {
      try {
        const { rows } = await db.query('SELECT application_patch($1, $2::jsonb) AS data', [id, JSON.stringify({ ...patch, updatedAt: new Date().toISOString() })]);
        return rows[0]?.data ?? null;
      } catch (e) { if (e.code === INVALID_UUID) return null; fail('update', e); }
    },
  };
}
