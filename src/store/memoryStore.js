/**
 * In-memory draft store. Replace with Postgres/Mongo/Redis in production by implementing
 * the same three methods: create / get / update.
 */
export function createMemoryStore() {
  const apps = new Map();
  return {
    async create(app) { apps.set(app.id, app); return app; },
    async get(id) { return apps.get(id) ?? null; },
    async update(id, patch) {
      const cur = apps.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      apps.set(id, next);
      return next;
    },
  };
}
