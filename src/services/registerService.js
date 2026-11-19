import crypto from 'node:crypto';
import { CHECKS } from '../data/intelligenceRegister.js';
import { buildLiveRegister } from './intelligenceRegister.js';
import { buildReportModel, planSvgFor } from './householderReport.js';
import { addEvidence, withdrawEvidence, signOff, requestSurvey, updateSurvey, submitOfficerReview, recordOfficerOutcome, EvidenceError } from '../register/evidence.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../utils/errors.js';

/**
 * The register, wired to applications. Everything that is not already on the stored draft is fetched here, on demand:
 *
 *   geo      datasets YOU loaded onto your server (flood maps, BGS, utility records, council registers) + the council's own standards.
 *            Looked up per request (cheap indexed queries), never stored on the draft, so a re-loaded dataset shows at once.
 *   extras   OpenStreetMap substations and traffic signals. One Overpass call per application, stored once it succeeds;
 *            a failure is remembered for a few minutes only, so a flaky mirror does not hammer Overpass or stick forever.
 *
 * Nothing here decides a planning outcome: it assembles readings and records what named people said about them.
 */
const toAppError = (e) => (e instanceof EvidenceError ? new AppError(e.status, e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', e.message) : e);

export function createRegisterService({ store, applicationService, geo = null, standards = null, extras = null, cfg = {}, logger = { warn() {} }, now = () => Date.now() }) {
  const failedExtras = new Map(); // application id -> time of the last failed lookup
  const RETRY_MS = 5 * 60_000;

  const siteOf = (app) => ({ lat: app.address?.lat ?? null, lng: app.address?.lng ?? null, postcode: app.address?.postcode ?? null, uprn: app.address?.uprn ?? null, authority: app.authority ?? null, ring: app.footprint?.ring ?? null });

  /** The stored draft plus what the register needs beyond it. Never throws: a layer that cannot be read is simply absent (and the check says "awaiting"). */
  async function enrich(app) {
    const out = { ...app };
    if (geo && app.address?.lat != null) {
      try {
        const [layers, std] = await Promise.all([geo.lookupAll(siteOf(app)), standards ? standards.forAuthority(app.authority).catch((e) => { logger.warn({ err: e.message }, 'council standards unavailable'); return {}; }) : {}]);
        if (layers) out.geo = { ...layers, standards: std ?? {} };
      } catch (e) { logger.warn({ err: e.message }, 'geo layers unavailable'); }
    }
    if (out.extras === undefined && extras && app.address?.lat != null) {
      const failedAt = failedExtras.get(app.id);
      if (!failedAt || now() - failedAt > RETRY_MS) {
        try {
          const found = await extras.find({ lat: app.address.lat, lng: app.address.lng });
          out.extras = found;
          failedExtras.delete(app.id);
          await store.update(app.id, { extras: found }).catch((e) => logger.warn({ err: e.message }, 'could not store OSM extras'));
        } catch (e) { failedExtras.set(app.id, now()); logger.warn({ err: e.message }, 'OSM extras lookup failed'); }
      }
    }
    return out;
  }

  async function live(id) { return buildLiveRegister(await enrich(await applicationService.load(id)), cfg); }

  const rowOf = (doc, checkId) => {
    const row = doc.checks.find((c) => c.id === checkId);
    if (!row) throw notFound(`Unknown check ${checkId}.`);
    return row;
  };
  const save = async (id, patch) => { const next = await store.update(id, patch); if (!next) throw notFound('Application not found.'); return next; };
  const guard = (fn) => { try { return fn(); } catch (e) { throw toAppError(e); } };

  return {
    enrich, live,

    /** The householder report model for one application, plus its block plan (never gated: the report shows the readiness gate, it does not wait for it). */
    async report(id) {
      const app = await applicationService.load(id);
      const doc = buildLiveRegister(await enrich(app), cfg);
      return { model: buildReportModel(doc, app), planSvg: planSvgFor(app) };
    },

    /** The release gate for one application (PI-17-14). */
    async readiness(id) { return (await live(id)).readiness; },

    /** Throws 409 (with the blockers) when READINESS_ENFORCE is on and the application is not ready. Used before a pack leaves the building. */
    async requireReady(id) {
      if (!cfg.readinessEnforce) return;
      const g = await this.readiness(id);
      if (!g.released) throw conflict('This application has not passed the planning readiness gate (PI-17-14), so it cannot be released yet.', { state: g.state, blockers: g.blockers });
    },

    // ----------------------------------------------------------------------------------------------------------------- evidence
    async addEvidence(id, checkId, input) {
      const app = await applicationService.load(id);
      const { entry, patch } = guard(() => addEvidence(app, checkId, input));
      await save(id, patch);
      return entry;
    },
    async withdrawEvidence(id, checkId, evidenceId, input) {
      const app = await applicationService.load(id);
      const { patch } = guard(() => withdrawEvidence(app, checkId, evidenceId, input ?? {}));
      await save(id, patch);
      return { withdrawn: evidenceId };
    },
    async evidence(id, checkId) {
      const app = await applicationService.load(id);
      if (!CHECKS.some((c) => c.id === checkId)) throw notFound(`Unknown check ${checkId}.`);
      return { checkId, evidence: app.evidence?.[checkId] ?? [] };
    },

    // ----------------------------------------------------------------------------------------------------------------- sign-off
    /** A named reviewer signs the engine's CURRENT reading of one check. The reviewer cannot type a reading of their own. */
    async signOff(id, checkId, input) {
      const app = await applicationService.load(id);
      const doc = buildLiveRegister(await enrich(app), cfg), row = rowOf(doc, checkId);
      const { record, patch } = guard(() => signOff(app, checkId, input, row.live));
      await save(id, patch);
      return record;
    },

    // ----------------------------------------------------------------------------------------------------------------- surveys
    async surveys(id) { return { surveys: (await applicationService.load(id)).surveys ?? [] }; },
    async requestSurvey(id, input) {
      const app = await applicationService.load(id);
      const { survey, patch } = guard(() => requestSurvey(app, input));
      await save(id, patch);
      return survey;
    },
    async updateSurvey(id, surveyId, input) {
      const app = await applicationService.load(id);
      const { survey, patch } = guard(() => updateSurvey(app, surveyId, input));
      await save(id, patch);
      return survey;
    },

    // ----------------------------------------------------------------------------------------------------------------- officer review
    async submitOfficerReview(id, input) {
      const app = await applicationService.load(id);
      const { review, patch } = guard(() => submitOfficerReview(app, input));
      await save(id, patch);
      return review;
    },
    async recordOfficerOutcome(id, reviewId, input) {
      const app = await applicationService.load(id);
      const { review, patch } = guard(() => recordOfficerOutcome(app, reviewId, input));
      await save(id, patch);
      return review;
    },
    /** Every application with a review waiting for an officer (the council's queue). */
    async reviewQueue() {
      if (!store.listPendingReviews) return { queue: [] };
      const apps = await store.listPendingReviews();
      return { queue: apps.flatMap((a) => (a.officerReviews ?? []).filter((r) => r.status === 'pending').map((r) => ({ applicationId: a.id, reference: a.reference, address: a.address?.fullAddress ?? null, authority: a.authority?.name ?? null, reviewId: r.id, submittedAt: r.submittedAt, submittedBy: r.submittedBy, lpaReference: r.lpaReference, consultationReference: r.consultationReference, checkIds: r.checkIds, note: r.note }))) };
    },
  };
}

/** Express middleware factory: reviewers and officers send `Authorization: Bearer <REVIEWER_TOKEN>`. With no token configured the endpoints stay closed. */
export function requireReviewer(cfg) {
  return (req, res, next) => {
    if (!cfg.reviewerToken) return next(forbidden('Reviewer sign-off is switched off: set REVIEWER_TOKEN on the server.'));
    const given = String(req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!given) return next(unauthorized('Send the reviewer token as "Authorization: Bearer <token>".'));
    const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(cfg.reviewerToken).digest();
    return crypto.timingSafeEqual(a, b) ? next() : next(forbidden('That reviewer token is not valid.'));
  };
}
