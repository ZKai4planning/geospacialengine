import { z } from 'zod';

/**
 * TITLE NUMBER + TENURE for an application, mapped to the property's UPRN.
 *
 * Where the facts come from, honestly:
 *   title number   NOT in any open dataset this engine uses (INSPIRE polygons carry an INSPIRE ID only; HM Land Registry's Title Number / UPRN lookup is licensed).
 *                  So it is entered by the applicant (from the official title register) and stored AGAINST THE UPRN, never guessed.
 *   tenure         the applicant's answer if given; otherwise the Land Registry Price Paid record of the last sale (a sale can be old: leases get extended,
 *                  freeholds get bought), clearly labelled as that. Never presented as verified: verification is evidence on PI-02-01 / PI-02-02.
 */
export const TITLE_RE = /^[A-Z]{1,3}\d{1,7}$/;                 // e.g. TGL123456, SGL1234, EGL500
export const normaliseTitleNumber = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
export const TENURES = ['freehold', 'leasehold', 'unknown'];
export const TENURE_LABEL = { freehold: 'Freehold', leasehold: 'Leasehold', unknown: 'Not known' };

export const titleSchema = z.object({
  titleNumber: z.string().max(16).nullable().optional(),
  tenure: z.enum(TENURES).optional(),
  leaseYearsRemaining: z.number().int().min(0).max(999).nullable().optional(),
});

/** What the application knows, with where each fact came from. Pure: reads the stored draft only. */
export function titleOf(app) {
  const t = app?.title ?? {}, last = app?.ppd?.sales?.[0] ?? null, uprn = app?.address?.uprn ?? null;
  let tenure = null, tenureSource = null;
  if (t.tenure && t.tenure !== 'unknown') { tenure = t.tenure; tenureSource = 'entered by applicant'; }
  else if (last?.tenure) { tenure = last.tenure; tenureSource = `Land Registry Price Paid Data, last sale ${String(last.date).slice(0, 4)} (may be out of date)`; }
  return {
    titleNumber: t.titleNumber ?? null, uprn, mappedUprn: t.titleNumber ? (t.uprn ?? uprn) : null,
    tenure, tenureEntered: tenureSource === 'entered by applicant', tenureLabel: tenure ? TENURE_LABEL[tenure] : 'Not known', tenureSource, leaseYearsRemaining: t.leaseYearsRemaining ?? null,
    verified: false, // only evidence on PI-02-01 / PI-02-02, signed by a named reviewer, verifies it
    note: t.titleNumber ? 'Title number entered by the applicant; check it against the official title register.' : 'No title number yet: it is not in open data. Get it from the title register (HM Land Registry) and enter it.',
  };
}

/** Applies applicant input to the stored `title` object. Throws Error(message) for a bad title number (the caller maps it to a 400). */
export function applyTitleInput(app, input) {
  const t = { ...(app.title ?? {}) };
  if (input.titleNumber !== undefined) {
    const n = normaliseTitleNumber(input.titleNumber);
    if (!n) delete t.titleNumber;
    else if (!TITLE_RE.test(n)) throw new Error('That does not look like a title number. They are 1 to 3 letters followed by digits, for example TGL123456.');
    else t.titleNumber = n;
  }
  if (input.tenure !== undefined) t.tenure = input.tenure;
  if (input.leaseYearsRemaining !== undefined) { if (input.leaseYearsRemaining === null) delete t.leaseYearsRemaining; else t.leaseYearsRemaining = input.leaseYearsRemaining; }
  if (t.tenure !== 'leasehold') delete t.leaseYearsRemaining;
  t.uprn = app.address?.uprn ?? null;                           // the mapping: this title number is recorded against THIS UPRN
  t.source = 'applicant'; t.enteredAt = new Date().toISOString();
  return t;
}
