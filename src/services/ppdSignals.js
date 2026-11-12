import { formFromPpd } from '../providers/landRegistry.js';
import { formFromEpc } from '../providers/epc.js';

/**
 * What the Land Registry sales record says about whether householder rights apply. Information for the person and the assessment's
 * checks - never a verdict on its own, because a sale record can be old, and an address can match a neighbour with a similar name.
 *
 *  - recorded as a FLAT / MAISONETTE            -> householder permitted development does not apply
 *  - LEASEHOLD                                  -> the freeholder's consent is needed for building work; the lease may forbid it
 *  - a NEW BUILD sale                           -> many estates have a planning condition removing permitted development
 *  - type disagrees with the energy certificate -> confirm the property type
 */
const LABEL = { detached: 'detached house', semi_detached: 'semi-detached house', terraced: 'terraced house', flat: 'flat or maisonette', other: 'property of another type' };
const gbp = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function ppdSignals({ ppd, epc = null }) {
  const sales = ppd?.sales ?? [];
  if (!sales.length) return { checks: [], formHint: null };
  const last = sales[0], checks = [];
  if (last.propertyType === 'flat') checks.push({ id: 'ppd-flat', status: 'warn', message: `The Land Registry records the last sale of this address (${last.date.slice(0, 4)}) as a ${LABEL.flat}. Flats and maisonettes have no householder permitted development rights – confirm the property type.` });
  if (last.tenure === 'leasehold' && last.propertyType !== 'flat') checks.push({ id: 'ppd-leasehold', status: 'info', message: `The last recorded sale (${last.date.slice(0, 4)}) was leasehold. Building work usually needs the freeholder's written consent and the lease may forbid it, whatever planning allows.` });
  if (sales.some((s) => s.newBuild)) checks.push({ id: 'ppd-newbuild', status: 'info', message: 'This address has a recorded new-build sale. Many modern estates have a planning condition that removes permitted development rights – look up the original planning permission before relying on them.' });
  const epcForm = formFromEpc(epc?.builtForm), ppdForm = formFromPpd(last.propertyType);
  if (epcForm && ppdForm && epcForm !== ppdForm) checks.push({ id: 'ppd-epc-mismatch', status: 'info', message: `The Land Registry records a ${LABEL[last.propertyType]} but the energy certificate says ${epc.builtForm}. The rear-depth limits depend on this – confirm which is right.` });
  return { checks, formHint: ppdForm };
}

export const formatStreetStats = (street) => {
  const s = street?.stats;
  if (!s) return null;
  return `${s.count} ${street.type ? LABEL[street.type].replace(' house', '') : 'house'} sale${s.count > 1 ? 's' : ''} on ${street.name} in the last ${street.years} years: median ${gbp(s.medianGbp)} (middle half ${gbp(s.p25Gbp)}–${gbp(s.p75Gbp)}).`;
};
