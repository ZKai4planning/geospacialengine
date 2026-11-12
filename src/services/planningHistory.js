/**
 * What the planning history says about THIS work. Information and cautions for the person - never a verdict on its own.
 *
 *   this house   earlier extensions (so the permitted-development allowance may already be used), refusals of similar work,
 *                conversion to flats (then it is not a single house), a new-build permission (look for a condition removing PD rights)
 *   nearby       similar work within 150 m in the last 10 years: how many were approved or refused - useful precedent for work that needs permission
 */
export const KINDS_FOR_TYPE = {
  rear_extension: ['rear', 'wraparound', 'extension'], side_extension: ['side', 'wraparound', 'extension'], wraparound_extension: ['wraparound', 'rear', 'side', 'extension'],
  front_porch: ['porch'], rear_dormer: ['dormer'], outbuilding: ['outbuilding'], additional_storey: ['storey'],
};
const WORD = { rear: 'rear extension', side: 'side extension', wraparound: 'wraparound extension', porch: 'porch', dormer: 'dormer or loft conversion', storey: 'extra storey', outbuilding: 'outbuilding', extension: 'extension' };
const year = (r) => String(r.decidedOn ?? r.receivedOn ?? '').slice(0, 4);
const isDecided = (r) => r.outcome === 'approved' || r.outcome === 'refused';

export function summariseHistory(history, { type, existingExtensionKnown = false, now = new Date() } = {}) {
  if (!history) return null;
  const checks = [], here = history.here ?? [], cutoff = new Date(now.getTime() - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
  const wanted = KINDS_FOR_TYPE[type] ?? [];

  const built = here.filter((r) => ['rear', 'side', 'wraparound', 'dormer', 'storey', 'extension'].includes(r.kind) && r.outcome === 'approved' && !r.lawful);
  if (built.length && !existingExtensionKnown) checks.push({ id: 'history-extension', status: 'info', message: `The planning history shows ${built.length === 1 ? 'an extension' : `${built.length} extensions`} approved at this address (${built.slice(0, 3).map((r) => `${WORD[r.kind]} ${year(r)}`).join(', ')}). If built, permitted-development limits count it – tell us how far it reaches beyond the original back wall.` });
  if (here.some((r) => r.flats && r.outcome === 'approved')) checks.push({ id: 'history-flats', status: 'warn', message: `The planning history includes an approved conversion to flats or an HMO at this address (${year(here.find((r) => r.flats && r.outcome === 'approved'))}). If it was carried out this is not a single house, and householder permitted development rights do not apply.` });
  const dwelling = here.find((r) => r.newDwelling && r.outcome === 'approved');
  if (dwelling) checks.push({ id: 'history-new-dwelling', status: 'info', message: `The home appears to come from a development approved in ${year(dwelling)}. Open that permission's decision notice and look for a condition removing permitted development rights – the register data here does not include the conditions.` });
  const refusedSame = here.filter((r) => r.outcome === 'refused' && wanted.includes(r.kind));
  if (refusedSame.length) checks.push({ id: 'history-refused', status: 'warn', message: `A ${WORD[refusedSame[0].kind]} application at this address was refused in ${year(refusedSame[0])}. Read the refusal reasons on the council's register before designing something similar.` });
  const lawful = here.filter((r) => r.lawful && r.outcome === 'approved' && wanted.includes(r.kind));
  if (lawful.length) checks.push({ id: 'history-lawful', status: 'info', message: `A certificate of lawfulness for similar work was granted at this address (${year(lawful[0])}), which confirms it was permitted development then.` });

  // nearby precedent: planning applications (not lawful-development certificates or prior approvals) of the same kind, decided in the last 10 years
  const same = (history.nearby ?? []).filter((r) => wanted.includes(r.kind) && !r.lawful && !r.prior && (r.decidedOn ?? r.receivedOn ?? '') >= cutoff);
  const approved = same.filter((r) => r.outcome === 'approved').length, refused = same.filter((r) => r.outcome === 'refused').length;
  const decided = approved + refused;
  const lawfulNearby = (history.nearby ?? []).filter((r) => r.lawful && r.outcome === 'approved' && wanted.includes(r.kind)).length;
  const precedent = wanted.length ? {
    kinds: wanted, radiusM: history.radiusM, years: history.years, found: same.length, approved, refused, decided,
    withdrawn: same.filter((r) => r.outcome === 'withdrawn').length, pending: same.filter((r) => r.outcome === 'pending').length,
    approvalRate: decided >= 3 ? Math.round((approved / decided) * 100) / 100 : null, lawfulNearby,
    examples: same.filter(isDecided).slice(0, 5).map((r) => ({ address: r.address, description: r.description, outcome: r.outcome, decidedOn: r.decidedOn, distanceM: r.distanceM, councilUrl: r.councilUrl, planitUrl: r.planitUrl })),
  } : null;
  if (precedent && decided) checks.push({ id: 'history-precedent', status: 'info', message: `Within ${history.radiusM} m in the last ${history.years} years: ${decided} decided application${decided > 1 ? 's' : ''} for similar work – ${approved} approved, ${refused} refused${precedent.approvalRate != null ? ` (${Math.round(precedent.approvalRate * 100)}% approved)` : ' (too few to read a pattern)'}.` });
  return { here, building: history.building ?? [], precedent, checks };
}
