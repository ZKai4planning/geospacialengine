/**
 * Builds node-postgres connection options from a DATABASE_URL.
 * `sslmode=...` is stripped from the URL because node-postgres lets it override the `ssl` option, and
 * "sslmode=require" would then demand a certificate chain that managed providers (e.g. DigitalOcean) sign with their own CA.
 * Pass the provider's CA certificate (DATABASE_CA_CERT) for full verification, or leave it out for encrypted-but-unverified TLS.
 */
export function pgConfig(url, { ssl = 'require', ca = null } = {}) {
  let u;
  try { u = new URL(url); } catch {
    throw new Error('DATABASE_URL is not a valid connection URL (expected postgresql://user:password@host:port/db). Special characters in the password must be URL-encoded, e.g. @ -> %40, # -> %23.');
  }
  u.searchParams.delete('sslmode');
  return {
    connectionString: u.toString(),
    ssl: ssl === 'disable' ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}
