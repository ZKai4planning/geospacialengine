/**
 * Estimated root protection area (RPA) radius for a tree, after BS 5837: radius = 12 x trunk diameter,
 * limited to 2-15 m. OpenStreetMap rarely records trunk size, so when it is missing we fall back to the crown
 * radius, then to a cautious default, and say which one we used (`source`).
 */
export const TREE = { factor: 12, minM: 2, maxM: 15, defaultM: 5 };
const clamp = (v) => Math.min(TREE.maxM, Math.max(TREE.minM, v));

export function protectionRadius({ trunkDiameterM = null, crownDiameterM = null } = {}) {
  if (trunkDiameterM > 0) return { radiusM: Math.round(clamp(TREE.factor * trunkDiameterM) * 10) / 10, source: 'trunk' };
  if (crownDiameterM > 0) return { radiusM: Math.round(clamp(crownDiameterM / 2) * 10) / 10, source: 'crown' };
  return { radiusM: TREE.defaultM, source: 'assumed' };
}
