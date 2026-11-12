/**
 * A ROUGH figure for what the extra floor space might be worth, from real sale prices – not a valuation.
 *
 *   price per m² of a typical home like this = street sale price for the same property type ÷ this home's floor area (energy certificate)
 *   value of the new space                    = that × the new floor area (footprint × storeys)
 *
 * The spread comes from the data itself: the street's 25th and 75th percentile prices give the low and high figures,
 * so no uplift percentage is invented. It is shown as a range, rounded to the nearest £1,000.
 * It needs the energy certificate's floor area and at least MIN_COMPS comparable sales; otherwise it says what is missing.
 *
 * Limits (stated to the user): comparables are assumed to be similar in size to this home; extra space adds less per m² as it
 * gets bigger; a loft or garden room is not counted; the work is assumed to be approved and built to the same standard.
 */
export const MIN_COMPS = 5;
const EXTENSION_TYPES = ['rear_extension', 'side_extension', 'wraparound_extension'];
const round1000 = (n) => Math.round(n / 1000) * 1000;

export function estimateUplift({ ppd = null, epc = null, type, extensionFootprintM2 = null, storeys = 1, verdict = null, now = new Date() }) {
  const no = (reason) => ({ available: false, reason });
  if (!EXTENSION_TYPES.includes(type)) return no('A value estimate is only given for extensions that add living space (not porches, outbuildings or roof work).');
  const homeM2 = epc?.floorAreaM2 ?? null, stats = ppd?.street?.stats ?? null;
  if (!homeM2 || homeM2 < 25 || homeM2 > 500) return no('This needs the home\'s floor area from its energy certificate, which was not found.');
  if (!stats || stats.count < MIN_COMPS) return no(`This needs at least ${MIN_COMPS} recent sales of the same type of home on the street${stats ? ` (only ${stats.count} found)` : ''}.`);
  const addedM2 = Math.round((extensionFootprintM2 ?? 0) * (storeys || 1) * 10) / 10;
  if (!(addedM2 > 0)) return no('Choose the work and its size to see an estimate.');

  const per = (price) => price / homeM2;
  const range = { lowGbp: round1000(per(stats.p25Gbp) * addedM2), midGbp: round1000(per(stats.medianGbp) * addedM2), highGbp: round1000(per(stats.p75Gbp) * addedM2) };
  const caution = [];
  const growthPct = Math.round((addedM2 / homeM2) * 100);
  if (growthPct > 50) caution.push(`The new space is ${growthPct}% of the existing floor area. Extra space adds less per m² as it gets bigger, so treat this as a ceiling.`);
  else if (growthPct > 30) caution.push(`The new space is ${growthPct}% of the existing floor area, so the estimate is likely to be on the high side.`);
  if (verdict && verdict !== 'permitted_development') caution.push('This assumes the work is approved. Permission is needed, and a refusal would mean no uplift.');
  if (ppd?.street?.type == null) caution.push('The home\'s own property type was not found, so the street comparables mix house types.');

  // a second view from this home's own last sale, when it was recent enough to mean something
  let ownSale = null;
  const last = ppd?.sales?.[0];
  if (last?.date) {
    const years = (now - new Date(last.date)) / (365.25 * 86400000);
    if (years <= 5 && last.propertyType !== 'flat') ownSale = { year: last.date.slice(0, 4), priceGbp: last.priceGbp, midGbp: round1000(per(last.priceGbp) * addedM2), note: 'Not adjusted for price changes since the sale.' };
  }
  return {
    available: true, addedFloorM2: addedM2, homeFloorM2: homeM2, growthPct,
    pricePerM2: { lowGbp: Math.round(per(stats.p25Gbp)), midGbp: Math.round(per(stats.medianGbp)), highGbp: Math.round(per(stats.p75Gbp)) },
    ...range, basis: { comps: stats.count, street: ppd.street.name, years: ppd.street.years, medianGbp: stats.medianGbp },
    ownSale, caution,
    method: `Street median price ÷ ${Math.round(homeM2)} m² home × ${addedM2} m² new space; the range uses the street's 25th and 75th percentile prices.`,
  };
}
