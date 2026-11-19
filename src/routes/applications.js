import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';
import { asyncH } from '../middleware/errorHandler.js';
import { buildSummary } from '../services/summary.js';
import { proposalSchema } from '../services/workTypes.js';
import { buildEngineTrace } from '../services/engineTrace.js';
import { interiorSchema } from '../services/interior/schema.js';
import { renderHtml, toCsv, LIVE_COLUMNS } from '../services/intelligenceRegister.js';
import { renderReportHtml } from '../services/householderReport.js';
import { requireReviewer } from '../services/registerService.js';
import { titleSchema } from '../services/titleInfo.js';
import { config } from '../config.js';

const idPattern = /^(\d{1,12}|osm:(node|way|relation):\d{1,12})$/;
const manualSchema = z.object({
  line1: z.string().min(1).max(80), line2: z.string().max(80).optional(),
  town: z.string().max(60).optional(), postcode: z.string().max(10),
});
const createSchema = z
  .object({ id: z.string().regex(idPattern).optional(), uprn: z.string().regex(idPattern).optional(), manual: manualSchema.optional() })
  .refine((v) => v.id || v.uprn || v.manual, 'Provide the confirmed address id, or a manual address');

const profileSchema = z.object({
  originalDwelling: z.boolean().optional(),
  existingExtension: z.object({
    present: z.boolean().optional(),
    depthM: z.number().min(0).max(20).optional(),
    widthM: z.number().min(0.5).max(30).optional(),
    inOutline: z.boolean().optional(),
  }).optional(),
  storeys: z.number().int().min(1).max(5).optional(),
  roofType: z.enum(['Pitched', 'Flat', 'Hipped', 'Mixed']).optional(),
  siteAreaM2: z.number().positive().max(100000).optional(),
  frontBearingDeg: z.number().min(0).max(360).optional(),
  habitableRooms: z.number().int().min(1).max(30).nullable().optional(),   // for the council's garden-space test when there is no energy certificate
  neighbourWindow: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).nullable().optional(), // 45-degree test
  isHouse: z.boolean().optional(), // applicant confirms (true) or rejects (false) that the building is a house
});

export function applicationRoutes({ applicationService, mediaService, registerService }) {
  const r = Router();
  const send = (res, app, status = 200) => res.status(status).json(buildSummary(app));

  // Applicant confirms an address -> capture address/postcode/id, enrich, return the cards
  r.post('/', asyncH(async (req, res) => {
    const body = createSchema.parse(req.body);
    send(res, await applicationService.create({ id: body.id ?? body.uprn, manual: body.manual }), 201);
  }));

  // Save everything entered so far as JSON, and start a new draft from such a file (the file's results are never trusted: see applicationExport.js)
  r.post('/import', asyncH(async (req, res) => send(res, await applicationService.importJson(req.body), 201)));
  r.get('/:id/export.json', asyncH(async (req, res) => {
    const doc = await applicationService.exportJson(req.params.id);
    res.set({ 'Content-Disposition': `attachment; filename="${doc.reference}.json"`, 'Cache-Control': 'private, no-store' }).json(doc);
  }));

  r.get('/:id', asyncH(async (req, res) => send(res, await applicationService.load(req.params.id))));

  r.patch('/:id/profile', asyncH(async (req, res) => {
    send(res, await applicationService.updateProfile(req.params.id, profileSchema.parse(req.body)));
  }));

  // Title number + tenure, recorded against the UPRN (the title number is not in open data, so the applicant enters it)
  r.patch('/:id/title', asyncH(async (req, res) => send(res, await applicationService.setTitle(req.params.id, titleSchema.parse(req.body)))));

  // Type of work + dimensions -> map outline + permitted-development screening
  r.put('/:id/proposal', asyncH(async (req, res) => {
    send(res, await applicationService.setProposal(req.params.id, proposalSchema.parse(req.body)));
  }));

  // The inside of the building (3D view): rooms, floors, roof and the interior checks; PATCH changes storeys, ceiling height, stair side, room names / uses
  r.get('/:id/interior', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    res.json({ interior: buildSummary(app).interior });
  }));
  r.patch('/:id/interior', asyncH(async (req, res) => {
    send(res, await applicationService.updateInterior(req.params.id, interiorSchema.parse(req.body)));
  }));

  // WHAT-IF: re-runs the engine on a changed proposal without saving it (sliders). Rate-limited separately because a slider is chatty.
  const whatIfLimit = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
  r.post('/:id/what-if', whatIfLimit, asyncH(async (req, res) => res.set('Cache-Control', 'no-store').json(await applicationService.whatIf(req.params.id, proposalSchema.parse(req.body.proposal ?? req.body)))));
  r.post('/:id/what-if/limits', whatIfLimit, asyncH(async (req, res) => {
    const field = typeof req.body?.field === 'string' ? req.body.field : '';
    res.set('Cache-Control', 'no-store').json(await applicationService.whatIfLimits(req.params.id, proposalSchema.parse(req.body.proposal), field));
  }));

  r.get('/:id/map', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    res.json(buildSummary(app).map);
  }));

  // The engine room: what the engine did for this application, stage by stage (read from what is already stored: nothing is re-run)
  r.get('/:id/engine', asyncH(async (req, res) => res.set('Cache-Control', 'private, no-store').json(buildEngineTrace(await applicationService.load(req.params.id)))));

  // The 228-parameter register for THIS application: what the engine found for every check it has (JSON, ?format=csv or ?format=html). Engine-derived, not reviewer-verified.
  r.get('/:id/intelligence', asyncH(async (req, res) => {
    const doc = await registerService.live(req.params.id);
    res.set('Cache-Control', 'private, no-store');
    if (req.query.format === 'csv') return res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="intelligence-${req.params.id}.csv"` }).send(toCsv(doc.checks, LIVE_COLUMNS));
    if (req.query.format === 'html') return res.set('Content-Type', 'text/html; charset=utf-8').send(renderHtml(doc));
    res.json(doc);
  }));

  // The householder report (cover, dashboard, domains, route, findings, site plan, inside, ground, actions): HTML to print or save as PDF, or ?format=json for the raw model.
  r.get('/:id/report', asyncH(async (req, res) => {
    const { model, planSvg } = await registerService.report(req.params.id);
    res.set('Cache-Control', 'private, no-store');
    if (req.query.format === 'json') return res.json(model);
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderReportHtml(model, { planSvg }));
  }));

  // ---- register workflow: evidence, reviewer sign-off, surveys, officer review, release gate ------------------------------------------------------------------
  // Evidence and survey requests are open to whoever holds the draft's id (the same trust model as the rest of the draft). Sign-off and officer outcomes need the
  // reviewer token (REVIEWER_TOKEN, sent as "Authorization: Bearer ..."): a named person, a role and a reason - the engine never signs for anyone.
  const reviewer = requireReviewer(config);
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  r.get('/:id/readiness', asyncH(async (req, res) => res.set('Cache-Control', 'private, no-store').json(await registerService.readiness(req.params.id))));
  r.get('/:id/evidence/:checkId', asyncH(async (req, res) => res.set('Cache-Control', 'private, no-store').json(await registerService.evidence(req.params.id, req.params.checkId))));
  r.post('/:id/evidence/:checkId', asyncH(async (req, res) => res.status(201).json(await registerService.addEvidence(req.params.id, req.params.checkId, body(req)))));
  r.post('/:id/evidence/:checkId/:evidenceId/withdraw', asyncH(async (req, res) => res.json(await registerService.withdrawEvidence(req.params.id, req.params.checkId, req.params.evidenceId, body(req)))));
  r.post('/:id/sign-off/:checkId', reviewer, asyncH(async (req, res) => res.status(201).json(await registerService.signOff(req.params.id, req.params.checkId, body(req)))));
  r.get('/:id/surveys', asyncH(async (req, res) => res.set('Cache-Control', 'private, no-store').json(await registerService.surveys(req.params.id))));
  r.post('/:id/surveys', asyncH(async (req, res) => res.status(201).json(await registerService.requestSurvey(req.params.id, body(req)))));
  r.patch('/:id/surveys/:surveyId', asyncH(async (req, res) => res.json(await registerService.updateSurvey(req.params.id, req.params.surveyId, body(req)))));
  r.post('/:id/officer-reviews', asyncH(async (req, res) => res.status(201).json(await registerService.submitOfficerReview(req.params.id, body(req)))));
  r.post('/:id/officer-reviews/:reviewId/outcome', reviewer, asyncH(async (req, res) => res.json(await registerService.recordOfficerOutcome(req.params.id, req.params.reviewId, body(req)))));

  r.get('/:id/assessment', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    res.json({ assessment: app.assessment });
  }));

  // Printable outputs: a block plan at a true printed scale (SVG) and a draft Lawful Development Certificate supporting statement (HTML, print to PDF)
  r.get('/:id/block-plan.svg', asyncH(async (req, res) => {
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': 'inline; filename="block-plan.svg"', 'Cache-Control': 'private, no-store' }).send(await applicationService.blockPlanSvg(req.params.id));
  }));
  r.get('/:id/ldc-pack', asyncH(async (req, res) => {
    await registerService.requireReady(req.params.id); // 409 with the blockers when READINESS_ENFORCE=true and the readiness gate (PI-17-14) is still held
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' }).send(await applicationService.ldcPack(req.params.id));
  }));

  // Image proxy: API keys never reach the browser, and only the application's own coordinates are used.
  const sendImage = (res, { buffer, contentType }) => res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' }).send(buffer);
  r.get('/:id/media/street-view', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    sendImage(res, await mediaService.streetViewImage(app, mediaService.size(req.query)));
  }));
  r.get('/:id/media/map', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    sendImage(res, await mediaService.mapImage(app));
  }));
  r.get('/:id/media/aerial', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    sendImage(res, await mediaService.aerialImage(app));
  }));

  return r;
}
