const OUTWARD = '[A-Z]{1,2}\\d[A-Z\\d]?';
const FULL_ONLY = new RegExp(`^\\s*(${OUTWARD})\\s*(\\d[A-Z]{2})\\s*$`, 'i');
const FULL_ANYWHERE = new RegExp(`\\b(${OUTWARD})\\s*(\\d[A-Z]{2})\\b`, 'i');
const PARTIAL = new RegExp(`^${OUTWARD}\\s?\\d?[A-Z]{0,2}$`, 'i');

const format = (out, inn) => `${out.toUpperCase()} ${inn.toUpperCase()}`;

/** "e62aa" -> "E6 2AA"; returns null if not a complete postcode. */
export function parsePostcode(input) {
  const m = FULL_ONLY.exec(input || '');
  return m ? format(m[1], m[2]) : null;
}

/** Finds a postcode inside free text ("22 e6 2aa") and returns the remaining text. */
export function extractPostcode(input) {
  const m = FULL_ANYWHERE.exec(input || '');
  if (!m) return null;
  const rest = input.replace(m[0], ' ').replace(/[,\s]+/g, ' ').trim();
  return { postcode: format(m[1], m[2]), rest };
}

/** "SW1A 2", "E6" – looks like the start of a postcode rather than an address. */
export function looksLikePartialPostcode(input) {
  const s = (input || '').trim();
  return s.length >= 2 && s.length <= 8 && PARTIAL.test(s) && /\d/.test(s);
}
