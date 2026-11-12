/**
 * "Is this a house?"  This engine applies HOUSEHOLDER permitted-development rules, which only cover houses. For anything else
 * (civic buildings, pubs, shops, offices, schools, ...) we say so plainly and do not give a planning verdict - that is where the
 * engine is built to stand.
 *
 *   null              : a dwelling - carry on.
 *   { state: 'stop' } : positively identified as not a house -> no verdict, clear message.
 *   { state: 'confirm' }: not identified and the building is far bigger than a house -> ask before going on.
 *   { state: 'soft' } : not identified but house-sized -> carry on, with a "please confirm" warning in the result.
 */
export const LARGE_FOOTPRINT_M2 = 400;
export const NOT_A_HOUSE = "This isn't a house, and this tool only screens houses.";
const ENGINE = "It applies householder permitted-development rules, which cover houses only, so we don't give a planning answer for other buildings. Ask the council's planning team what applies to this kind of building.";

export function useGate({ classification, footprintAreaM2 = null }) {
  const use = classification?.use ?? (classification?.isResidential ? 'residential' : 'unknown');
  if (use === 'residential') return null;
  if (use === 'non_residential') {
    const why = classification.useReason ? `${classification.useReason} ` : '';
    return { state: 'stop', level: 'certain', headline: NOT_A_HOUSE, reason: `${why}${ENGINE}` };
  }
  if (footprintAreaM2 != null && footprintAreaM2 > LARGE_FOOTPRINT_M2) {
    return {
      state: 'confirm', level: 'likely', headline: "We couldn't confirm this is a house.",
      reason: `The building is about ${Math.round(footprintAreaM2).toLocaleString('en-GB')} m², far larger than a typical house, and nothing we hold says what it is. ${ENGINE}`,
    };
  }
  return { state: 'soft', level: 'likely', headline: "We couldn't confirm this is a house.", reason: 'This screening only applies to houses – please check before relying on it.' };
}
