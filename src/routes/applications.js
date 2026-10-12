import { Router } from 'express';
import { z } from 'zod';
import { asyncH } from '../middleware/errorHandler.js';
import { buildSummary } from '../services/summary.js';
import { proposalSchema } from '../services/workTypes.js';

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
});

export function applicationRoutes({ applicationService, mediaService }) {
  const r = Router();
  const send = (res, app, status = 200) => res.status(status).json(buildSummary(app));

  // Applicant confirms an address -> capture address/postcode/id, enrich, return the cards
  r.post('/', asyncH(async (req, res) => {
    const body = createSchema.parse(req.body);
    send(res, await applicationService.create({ id: body.id ?? body.uprn, manual: body.manual }), 201);
  }));

  r.get('/:id', asyncH(async (req, res) => send(res, await applicationService.load(req.params.id))));

  r.patch('/:id/profile', asyncH(async (req, res) => {
    send(res, await applicationService.updateProfile(req.params.id, profileSchema.parse(req.body)));
  }));

  // Type of work + dimensions -> map outline + permitted-development screening
  r.put('/:id/proposal', asyncH(async (req, res) => {
    send(res, await applicationService.setProposal(req.params.id, proposalSchema.parse(req.body)));
  }));

  r.get('/:id/map', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    res.json(buildSummary(app).map);
  }));

  r.get('/:id/assessment', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    res.json({ assessment: app.assessment });
  }));

  // Image proxy: API keys never reach the browser, and only the application's own coordinates are used.
  const sendImage = (res, { buffer, contentType }) => res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' }).send(buffer);
  r.get('/:id/media/street-view', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    sendImage(res, await mediaService.streetViewImage(app, mediaService.size(req.query)));
  }));
  r.get('/:id/media/aerial', asyncH(async (req, res) => {
    const app = await applicationService.load(req.params.id);
    sendImage(res, await mediaService.aerialImage(app));
  }));

  return r;
}
