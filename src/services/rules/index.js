import { neighbourRule } from './neighbours.js';
import { boundaryRule } from './boundary.js';
import { wallSafetyRule } from './wallSafety.js';
import { roadRule } from './roads.js';
import { publicLandRule } from './publicLand.js';
import { streetRule } from './streetFeatures.js';
import { regulatoryRule } from './regulatory.js';
import { areaRule } from './areas.js';
import { fortyFiveRule } from './fortyFive.js';
import { tpoZoneRule } from './tpoZones.js';
import { treeRule } from './trees.js';
import { customRules } from './custom.js';
import { logger } from '../../utils/logger.js';
import { RULE_CATALOG, describeRule } from './catalog.js';

/** Rules run in this order, so messages appear neighbours -> boundary -> wall safety -> roads -> public land -> street features -> tree zones -> trees -> yours. */
export const SITE_RULES = [neighbourRule, boundaryRule, wallSafetyRule, roadRule, publicLandRule, streetRule, areaRule, tpoZoneRule, treeRule, fortyFiveRule, regulatoryRule, ...customRules];

/** Adds a rule at runtime. Returns a function that removes it again (handy in tests). */
export function registerRule(rule) {
  if (typeof rule?.run !== 'function' || !rule.id) throw new TypeError('A rule needs an id and a run(ctx, result) function.');
  SITE_RULES.push(rule);
  return () => { const i = SITE_RULES.indexOf(rule); if (i >= 0) SITE_RULES.splice(i, 1); };
}

/**
 * Runs every rule in order and RECORDS what each one did in result.trace.rules, so the "engine room" view can replay it:
 *   { id, title, question, data, thresholds, affectsVerdict, limits, ms, error?, added: [items it produced], measures: [what it measured] }
 * A rule that throws is caught and shown as an info line; the trace says which rule it was and why it failed.
 */
export function runRules(ctx, result, rules = SITE_RULES) {
  const trace = (result.trace ??= { rules: [] });
  for (const rule of rules) {
    const before = result.items.length, regBefore = result.regulatory?.length ?? 0, t0 = performance.now();
    let error = null;
    try { rule.run(ctx, result); }
    catch (e) {
      error = e.message;
      logger.warn({ rule: rule.id, err: e.message }, 'site rule failed');
      result.items.push({ status: 'info', message: `The "${rule.id}" check could not be completed.` });
    }
    const d = describeRule(rule.id), cat = RULE_CATALOG[rule.id];
    let measures = [];
    try { measures = cat?.measures ? cat.measures(result, ctx).slice(0, 14) : []; } catch { /* a measure line must never break the request */ }
    const added = cat?.added ? cat.added(result).slice(regBefore) : result.items.slice(before).map(({ status, message }) => ({ status, message }));
    trace.rules.push({ id: rule.id, title: d.title, question: d.question, data: d.data, thresholds: d.thresholds, affectsVerdict: d.affectsVerdict, limits: d.limits, ms: Math.round((performance.now() - t0) * 10) / 10, error, added, measures });
  }
}
