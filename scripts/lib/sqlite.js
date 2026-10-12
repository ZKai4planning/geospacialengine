/**
 * Opens a SQLite database with whichever driver is available:
 *   1. better-sqlite3 (npm i better-sqlite3 – prebuilt binaries for current Node LTS)
 *   2. node:sqlite    (built into Node 22.5+; prints an "experimental" warning)
 * Both expose exec() / prepare().run|get|all(), which is all we use.
 */
export async function openDb(file, { readonly = false } = {}) {
  try {
    const { default: Database } = await import('better-sqlite3');
    return new Database(file, readonly ? { readonly: true, fileMustExist: true } : {});
  } catch { /* try the built-in driver */ }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(file, readonly ? { readOnly: true } : {});
  } catch { /* fall through */ }
  throw new Error('No SQLite driver found. Run "npm install better-sqlite3" (Node 20/22/24) or use Node 22.5+.');
}
