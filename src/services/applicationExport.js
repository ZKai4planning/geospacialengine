/**
 * Portable JSON for an application.
 *
 *   buildExport(app)      what the applicant entered (`inputs`) + what the engine worked out (`results`)
 *   parseImport(doc)      validates a document and returns ONLY the inputs, ready to replay
 *
 * Importing never trusts the file's `results`: the engine re-fetches the address by id and re-runs every check from `inputs`, so an edited
 * or out-of-date file cannot inject a verdict, a plot boundary or a constraint. `results` is there for people and other tools to read.
 */
import { z } from 'zod';
import { proposalSchema } from './workTypes.js';
import { badRequest } from '../utils/errors.js';
import { interiorSchema } from './interior/schema.js';

export const EXPORT_SCHEMA = 'uk-planning-engine/application';
export const EXPORT_VERSION = 1;

const idPattern = /^(\d{1,12}|osm:(node|way|relation):\d{1,12})$/;
const manualSchema = z.object({
  line1: z.string().min(1).max(80), line2: z.string().max(80).optional(),
  town: z.string().max(60).optional(), postcode: z.string().max(10),
});
const profileSchema = z.object({
  originalDwelling: z.boolean().optional(),
  existingExtension: z.object({
    present: z.boolean().optional(), depthM: z.number().min(0).max(20).optional(),
    widthM: z.number().min(0.5).max(30).optional(), inOutline: z.boolean().optional(),
  }).optional(),
  storeys: z.number().int().min(1).max(5).optional(),
  roofType: z.enum(['Pitched', 'Flat', 'Hipped', 'Mixed']).optional(),
  siteAreaM2: z.number().positive().max(100000).optional(),
  frontBearingDeg: z.number().min(0).max(360).optional(),
  habitableRooms: z.number().int().min(1).max(30).nullable().optional(),
  neighbourWindow: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).nullable().optional(),
  isHouse: z.boolean().optional(),
});
const inputsSchema = z.object({
  address: z.object({ id: z.string().regex(idPattern).optional(), manual: manualSchema.optional() })
    .refine((a) => a.id || a.manual, 'The file has no address id or manual address.'),
  profile: profileSchema.default({}),
  proposal: proposalSchema.nullable().optional(),
  interior: interiorSchema.nullable().optional(),   // edits to the inside (storeys, room names...); files saved before the 3D view have none
});
const docSchema = z.object({ schema: z.literal(EXPORT_SCHEMA), version: z.number().int().min(1).max(EXPORT_VERSION), inputs: inputsSchema });

/** Only the profile fields the applicant set (source === 'user'); engine estimates are re-derived on import, not copied. */
function userProfile(app) {
  const p = app.profile ?? {}, out = {};
  for (const k of ['originalDwelling', 'storeys', 'roofType', 'siteAreaM2', 'frontBearingDeg', 'habitableRooms', 'neighbourWindow']) {
    if (p[k]?.source === 'user') out[k] = p[k].value;
  }
  const ex = p.existingExtension;
  if (ex?.source === 'user') {
    out.existingExtension = { present: ex.present ?? undefined, depthM: ex.depthM ?? undefined, widthM: ex.widthM ?? undefined, inOutline: ex.inOutline ?? undefined };
  }
  const c = app.address?.classification;
  if (c?.useSource === 'user') out.isHouse = !!c.isResidential;
  return JSON.parse(JSON.stringify(out)); // drops undefined keys
}

function addressInput(app) {
  const a = app.address;
  if (!a.approximate) return { id: idPattern.test(String(a.id)) ? String(a.id) : String(a.uprn) };
  const parts = String(a.fullAddress ?? '').split(', ');
  const manual = { line1: parts[0], postcode: a.postcode };
  if (a.postTown) manual.town = a.postTown;
  if (parts.length > 3) manual.line2 = parts[1];
  return { manual };
}

export function buildExport(app) {
  const a = app.assessment ?? null;
  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    reference: app.reference,
    note: 'Draft prepared from open data. `inputs` is what the applicant entered and is what an import replays; `results` is what the engine worked out at export time and is ignored on import. Screening only, not legal advice.',
    inputs: {
      address: addressInput(app),
      profile: userProfile(app),
      proposal: app.proposal ?? null,
      interior: app.interiorSetup && Object.keys(app.interiorSetup).length ? app.interiorSetup : null,
    },
    results: {
      address: {
        fullAddress: app.address.fullAddress, postcode: app.address.postcode, uprn: app.address.uprn ?? null,
        lat: app.address.lat, lng: app.address.lng, propertyType: app.address.classification?.propertyType ?? null,
      },
      authority: app.authority ?? null,
      country: app.country ?? null,
      profile: app.profile ?? null,
      constraints: app.constraints ?? null,
      assessment: a,
      areas: app.areas ?? null,
      epc: app.epc ?? null,
      warnings: app.warnings ?? [],
    },
  };
}

/** Returns { address: {id}|{manual}, profile, proposal } or throws a 400 that says what is wrong. */
export function parseImport(doc) {
  const r = docSchema.safeParse(doc);
  if (r.success) return r.data.inputs;
  const first = r.error.issues[0];
  const where = first.path.length ? ` (${first.path.join('.')})` : '';
  throw badRequest(`This is not a valid application file${where}: ${first.message}`);
}
