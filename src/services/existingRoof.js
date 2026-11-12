/**
 * The EXISTING house's roof height, from the best source we have, for the two "no higher than the existing house" limits (GPDO Class A.1(c) ridge, A.1(d) eaves).
 *
 *   LiDAR (Environment Agency, 1 m grid)  -> ridge AND eaves, accurate to about +-0.5 m when the building is clearly seen (high confidence), +-0.8 m (medium).
 *                                            Low confidence is not used: a tree or a demolished house can fool it.
 *   OpenStreetMap height tag              -> ridge only, community-entered, treated as +-1 m.
 *   neither                               -> null (the rule says it cannot test it; it never guesses).
 *
 * The survey can be older than the house's latest extension, so a LiDAR height is a measurement, not a certificate: the rules only FAIL when the extension is
 * clearly above it (more than twice the tolerance, high confidence); closer than that is "too close to call" (warn).
 */
export const ROOF_TOLERANCE_M = { high: 0.5, medium: 0.8, osm: 1 };

export function resolveExistingRoof({ lidar, footprint } = {}) {
  if (lidar?.status === 'ok' && (lidar.confidence === 'high' || lidar.confidence === 'medium') && Number.isFinite(lidar.ridgeM)) {
    return { source: 'lidar', confidence: lidar.confidence, toleranceM: ROOF_TOLERANCE_M[lidar.confidence], ridgeM: lidar.ridgeM, eavesM: Number.isFinite(lidar.eavesM) ? lidar.eavesM : null, roofShape: lidar.roofShape ?? null, groundFallM: lidar.groundFallM ?? null };
  }
  if (Number.isFinite(footprint?.heightM)) return { source: 'osm', confidence: 'low', toleranceM: ROOF_TOLERANCE_M.osm, ridgeM: footprint.heightM, eavesM: null, roofShape: null, groundFallM: lidar?.status === 'ok' ? lidar.groundFallM ?? null : null };
  return null;
}

/** One line for people: where the number came from and how far to trust it. */
export function describeExistingRoof(r) {
  if (!r) return 'not known';
  const src = r.source === 'lidar' ? `Environment Agency LiDAR (${r.confidence} confidence, ±${r.toleranceM} m)` : 'OpenStreetMap height tag (community-entered, ±1 m)';
  return `ridge ${r.ridgeM} m${r.eavesM != null ? `, eaves ${r.eavesM} m` : ''} – ${src}`;
}
