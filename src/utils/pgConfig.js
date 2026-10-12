/**
 * Builds node-postgres connection options from a DATABASE_URL.
 * `sslmode=...` is stripped from the URL because node-postgres lets it override the `ssl` option, and
 * "sslmode=require" would then demand a certificate chain that managed providers (e.g. DigitalOcean) sign with their own CA.
 * Pass the provider's CA certificate (DATABASE_CA_CERT) for full verification, or leave it out for encrypted-but-unverified TLS.
 */
export function pgConfig(url, { ssl = 'require', ca = null } = {}) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return {
    connectionString: u.toString(),
    ssl: ssl === 'disable' ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}
