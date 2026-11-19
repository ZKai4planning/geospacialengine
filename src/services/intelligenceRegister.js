import { CHECKS, DOMAINS } from '../data/intelligenceRegister.js';
import { COVERAGE_ROWS, ROUTES, ROUTE_BY_ID } from '../data/intelligenceCoverage.js';
import { lpaFor } from '../data/lpaRules.js';
import { titleOf } from './titleInfo.js';
import { LIVE_EXTRA, COVERAGE_OVERRIDES } from '../register/checks.js';
import { reviewStatus, activeEvidence } from '../register/evidence.js';
import { evaluateGate, gateReading, GATE_CHECK } from '../register/gate.js';

/**
 * THE 228-PARAMETER PROPERTY INTELLIGENCE REGISTER, wired to the engine.
 *
 *   catalogue   the 228 checks (id, name, evidence required, acceptance criterion)          data/intelligenceRegister.js
 *   coverage    which of them this engine has / partly has / does not have, and why         data/intelligenceCoverage.js
 *   live        for ONE application: what the engine found for every check it has          buildLiveRegister(app)
 *
 * Live states follow the register's own rules and are ENGINE-DERIVED, never reviewer-verified:
 *   pass          the engine ran the test and found nothing (limited to that test - "none recorded" is not "none exist")
 *   issue         the engine found something that needs attention
 *   info          the engine has a value to report that is neither a pass nor an issue
 *   awaiting      the engine has this check but no data came back (provider off, no coverage, or the applicant has not answered)
 *   not_built     the engine has no check for this parameter yet
 * Only a person can sign a check off: `signOff` is null until a named reviewer signs it (PI-17-11), and goes 'stale' if the reading or the evidence changes afterwards.
 */

export const STATUS_LABEL = { have: 'Have', partial: 'Partial', missing: 'Not built' };
export const LIVE_LABEL = { pass: 'Pass', issue: 'Issue', info: 'Info', awaiting: 'Awaiting data', not_built: 'Not built' };

/** Runtime capabilities a check can depend on. `cfg` = the config object. */
export function capabilities(cfg = {}) {
  return {
    osm: true, planningdata: true,
    db: !!cfg.databaseUrl, geo: !!cfg.databaseUrl && cfg.geoLayersEnabled !== false, reviewer: !!cfg.reviewerToken, osplaces: !!cfg.osKey,
    epc: !!(cfg.epcToken || (cfg.epcKey && cfg.epcEmail)),
    lidar: !!cfg.lidarEnabled, planit: !!cfg.planningHistoryEnabled, coal: !!cfg.coalEnabled, landfill: !!cfg.landfillEnabled,
  };
}
const SWITCH_HINT = {
  db: 'set DATABASE_URL', osplaces: 'set OS_DATA_HUB_KEY', epc: 'set EPC_API_TOKEN (or EPC_API_EMAIL + EPC_API_KEY)', lidar: 'set LIDAR_ENABLED=true',
  geo: 'set DATABASE_URL and load the datasets (npm run import:geo)', reviewer: 'set REVIEWER_TOKEN',
  planit: 'set PLANNING_HISTORY_ENABLED=true (check PlanIt terms first)', coal: 'set COAL_RISK_ENABLED=true and import the coal data (check licence first)', landfill: 'set LANDFILL_ENABLED=true (check EA licence first)',
};

/** 'on' | 'off' (built, but a switch it needs is off) | 'n/a' (not built). */
function runtimeOf(cov, caps) {
  if (cov.status === 'missing') return { runtime: 'n/a', off: [] };
  const off = (cov.needs ?? []).filter((expr) => !expr.split('|').some((t) => caps[t])).map((expr) => expr.split('|').map((t) => SWITCH_HINT[t] ?? t).join(' or '));
  return { runtime: off.length ? 'off' : 'on', off };
}

// The static audit rows are the baseline; the checks that src/register/checks.js actually implements override them, so the table can never claim more (or less) than the code does.
const OVERRIDE = new Map(COVERAGE_OVERRIDES.map(([id, status, needs, modules, note]) => [id, { status, needs, modules, note }]));
const COV = new Map(COVERAGE_ROWS.map(([id, status, needs, modules, note]) => [id, OVERRIDE.get(id) ?? { status, needs, modules, note }]));
const DOM = new Map(DOMAINS.map((d) => [d.no, d]));

/** The catalogue joined with coverage. Static: same for every application. */
export function buildCatalogue(cfg = {}) {
  const caps = capabilities(cfg);
  const rows = CHECKS.map((c) => {
    const cov = COV.get(c.id);
    const { runtime, off } = runtimeOf(cov, caps);
    return { ...c, domainName: DOM.get(c.domain).name, status: cov.status, statusLabel: STATUS_LABEL[cov.status], runtime, switchesNeeded: off, modules: cov.modules, note: cov.note, route: cov.status === 'missing' ? ROUTE_BY_ID[c.id] ?? null : null, routeLabel: cov.status === 'missing' ? ROUTES[ROUTE_BY_ID[c.id]] ?? null : null };
  });
  return { generatedAt: new Date().toISOString(), source: 'AI4Planning 228-Parameter Evidence Register v1.0 (15 Nov 2026)', summary: summarise(rows), domains: DOMAINS.map((d) => ({ ...d, summary: summarise(rows.filter((r) => r.domain === d.no)) })), checks: rows };
}

export function summarise(rows) {
  const n = (f) => rows.filter(f).length, total = rows.length;
  const have = n((r) => r.status === 'have'), partial = n((r) => r.status === 'partial'), missing = n((r) => r.status === 'missing');
  const haveOff = n((r) => r.status === 'have' && r.runtime === 'off'), partialOff = n((r) => r.status === 'partial' && r.runtime === 'off');
  const pct = (x) => (total ? Math.round((x / total) * 1000) / 10 : 0);
  const routes = Object.fromEntries(Object.keys(ROUTES).map((k) => [k, n((r) => r.status === 'missing' && r.route === k)]));
  return { total, have, partial, missing, routes, built: have + partial, builtPct: pct(have + partial), havePct: pct(have), partialPct: pct(partial), missingPct: pct(missing), haveSwitchedOff: haveOff, partialSwitchedOff: partialOff };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// LIVE EVALUATION. Each function reads what the application already holds (nothing is fetched here) and returns { state, value }.
// ---------------------------------------------------------------------------------------------------------------------------------------
const r1 = (n) => Math.round(n * 10) / 10;
const awaiting = (value) => ({ state: 'awaiting', value });
const info = (value) => ({ state: 'info', value });
const pass = (value) => ({ state: 'pass', value });
const issue = (value) => ({ state: 'issue', value });

const flag = (a, key, yes, no) => {
  if (!a.constraints) return awaiting('Constraints were not checked for this application');
  return a.constraints.flags?.[key] ? issue(yes) : pass(`${no} (national data - coverage varies by council)`);
};
const dataset = (a, d) => (a.constraints?.items ?? []).filter((i) => i.dataset === d);
const areaSet = (a, ds) => (a.outlines ?? []).filter((x) => ds.includes(x.dataset));
const provenance = (s) => (s === 'user' ? 'entered by applicant' : s === 'unconfirmed' || s == null || s === 'unset' ? null : String(s));
const hist = (a) => (a.history ? a.history : null);
const histOff = 'Planning history is switched off or returned nothing for this address';
const sales = (a) => a.ppd?.sales ?? [];
const obstacles = (a, ...kinds) => (a.obstacles ?? []).filter((o) => kinds.includes(o.kind));
const countObs = (a, label, ...kinds) => { const n = obstacles(a, ...kinds).length; return n ? info(`${n} ${label} mapped within 40 m`) : info(`No ${label} mapped within 40 m (map coverage is incomplete)`); };
/** The council's own guidance, only when rules for THIS authority are actually loaded (assessLpa returns available:false otherwise). */
const lpaOf = (a) => (a.assessment?.lpa?.available ? a.assessment.lpa : null);
const noLpa = (a) => (assessed(a) ? `No local rules loaded for ${a.authority?.name ?? 'this authority'} - only national rules applied` : 'Needs a proposal, and local rules for this authority');
const checkById = (a, id) => (a.assessment?.checks ?? []).find((c) => c.id === id);
const assessed = (a) => !!a.assessment;
const RANK = { fail: 3, warn: 2, info: 1, pass: 0 };
/** Reads the assessment's own checks (permittedDevelopment.js ids). Worst status wins. */
function byIds(a, ids, none = 'Not applicable to this work type, or needs a proposal') {
  const hits = (a.assessment?.checks ?? []).filter((c) => ids.includes(c.id));
  if (!hits.length) return awaiting(none);
  const worst = hits.reduce((w, c) => ((RANK[c.status] ?? 1) > (RANK[w.status] ?? 1) ? c : w), hits[0]);
  const msg = String(worst.message ?? '').slice(0, 220);
  return worst.status === 'fail' || worst.status === 'warn' ? issue(msg) : worst.status === 'pass' ? pass(msg) : info(msg);
}

const LIVE_BASE = {
  'PI-01-01': (a) => (a.address?.uprn ? (a.address.uprnMatch?.confidence === 'low' ? issue(`UPRN ${a.address.uprn} - LOW match confidence, applicant must confirm`) : pass(`UPRN ${a.address.uprn}${a.address.uprnMatch ? ` (${a.address.uprnMatch.confidence} confidence, ${r1(a.address.uprnMatch.distanceM)} m)` : ''}`)) : awaiting('No UPRN (OSM address or Open UPRN not loaded)')),
  'PI-01-02': (a) => (a.address?.fullAddress && a.address?.postcode ? pass(`${a.address.fullAddress}`) : awaiting('Address incomplete')),
  'PI-01-03': (a) => (a.address?.easting != null ? info(`E ${a.address.easting}, N ${a.address.northing}`) : awaiting('No easting/northing on the address (OS Places not used)')),
  'PI-01-04': (a) => (a.plot?.ring ? info('Plot outline present: centroid can be derived (not stored)') : awaiting('No plot outline')),
  'PI-01-05': (a) => (a.title?.titleNumber ? info(`Title ${a.title.titleNumber} recorded against UPRN ${a.title.uprn ?? 'n/a (no UPRN yet)'} - entered by the applicant, not checked against the register${a.plot?.reference ? `; INSPIRE polygon ${a.plot.reference}` : ''}`) : a.plot?.reference ? info(`Title polygon reference ${a.plot.reference}; title number not captured`) : awaiting('No registered title polygon matched')),
  'PI-01-06': (a) => (a.footprint?.areaM2 ? pass(`${Math.round(a.footprint.areaM2)} m² outline from ${a.footprint.source ?? 'map data'}`) : awaiting('No building outline found')),
  'PI-01-07': (a) => (a.authority?.name ? info(`${a.authority.name}${a.authority.code ? ` (${a.authority.code})` : ''} - from postcode, not a boundary intersection`) : awaiting('Council not resolved')),
  'PI-01-08': () => awaiting('Ward is returned by the postcode lookup but not stored on the application'),
  'PI-01-09': (a) => (a.address?.classification ? (a.address.classification.use === 'non_residential' ? issue(`${a.address.classification.type ?? 'Non-residential'} - householder rights do not apply`) : a.address.classification.form === 'flat' ? issue('Flat / maisonette - no householder rights') : pass(`${a.address.classification.type ?? 'Residential'} (${a.address.classification.form})`)) : awaiting('Not classified')),
  'PI-01-10': (a) => (a.address?.uprnMatch ? info(`UPRN match ${a.address.uprnMatch.confidence}; no title/polygon/address combined score`) : awaiting('No UPRN match record')),

  'PI-02-02': (a) => { const t = titleOf(a); if (t.tenure) return info(`${t.tenureLabel}${t.leaseYearsRemaining != null ? `, about ${t.leaseYearsRemaining} years left on the lease` : ''} (${t.tenureSource}); not verified against the register`); const s = sales(a)[0]; return s ? info(`Last sale ${String(s.date).slice(0, 4)} recorded as ${s.tenure ?? 'unknown tenure'} (Price Paid Data, not the register)`) : awaiting('No sale record, or Land Registry lookup returned nothing'); },
  'PI-02-03': (a) => { const b = a.map?.siteChecks?.boundary; return b ? (b.status === 'crosses' ? issue('Proposal crosses the title boundary') : b.estimated ? info('Plot outline is an estimate - boundary not tested') : pass(`Proposal ${b.status ?? 'tested'} against registered title (indicative)`)) : awaiting('No proposal yet, or no registered title'); },
  'PI-02-04': (a) => (a.plot?.reference ? info(`Boundary reference ${a.plot.reference}; no edition date`) : awaiting('No registered title polygon matched')),

  'PI-03-01': (a) => (a.plot?.areaM2 ? (a.plot.estimated ? info(`${Math.round(a.plot.areaM2)} m² - ESTIMATED, not registered`) : pass(`${Math.round(a.plot.areaM2)} m² from registered title`)) : (a.profile?.siteAreaM2?.value ? info(`${a.profile.siteAreaM2.value} m² (${provenance(a.profile.siteAreaM2.source) ?? 'source unknown'})`) : awaiting('No site area'))),
  'PI-03-02': (a) => (a.footprint?.areaM2 ? pass(`${Math.round(a.footprint.areaM2)} m²`) : awaiting('No building outline')),
  'PI-03-03': (a) => (a.lidar && a.lidar.status !== 'unavailable' && a.lidar.ridgeM != null ? pass(`Ridge ${a.lidar.ridgeM} m${a.lidar.eavesM != null ? `, eaves ${a.lidar.eavesM} m` : ''} (LiDAR, ${a.lidar.confidence ?? 'n/a'} confidence)`) : a.footprint?.heightM ? info(`${a.footprint.heightM} m (OSM height tag, community-entered)`) : awaiting('No LiDAR or tagged height')),
  'PI-03-04': (a) => { const v = a.profile?.roofType?.value; return v ? info(`${v} (${provenance(a.profile.roofType.source) ?? 'source unknown'})`) : awaiting('Roof type unknown'); },
  'PI-03-05': (a) => (a.lidar?.groundFallM != null ? info(`Ground falls ${r1(a.lidar.groundFallM)} m under the building`) : awaiting('No LiDAR ground model')),
  'PI-03-06': (a) => (a.lidar?.groundFallM != null ? info(`Ground fall ${r1(a.lidar.groundFallM)} m (LiDAR DTM)`) : awaiting('No LiDAR ground model')),
  'PI-03-07': (a) => { const d = a.map?.siteFacts?.boundary; return d?.rearM != null ? info(`${d.rearM} m from the proposal to the rear boundary`) : awaiting('Needs a proposal inside a registered title'); },
  'PI-03-08': (a) => { const d = a.map?.siteFacts?.boundary; return d?.sideM != null ? info(`${d.sideM} m from the proposal to the side boundary`) : awaiting('Needs a proposal and a registered title'); },
  'PI-03-09': (a) => ((a.barriers ?? []).length ? info(`${a.barriers.length} mapped fence/wall/hedge segments nearby`) : info('No boundary structures mapped (OSM coverage is patchy)')),
  'PI-03-10': (a) => { const n = a.neighbours ?? []; return n.length ? info(`${n.length} neighbouring buildings within 40 m`) : awaiting('No neighbouring buildings found'); },
  'PI-03-11': (a) => (a.map?.frame?.frontBearingDeg != null ? info(`Front faces ${Math.round(a.map.frame.frontBearingDeg)}° (${a.map.frame.frontSource ?? 'auto'})`) : a.profile?.frontBearingDeg?.value != null ? info(`Front bearing ${a.profile.frontBearingDeg.value}°`) : awaiting('Front direction not yet worked out')),
  'PI-03-12': (a) => { const s = a.map?.siteChecks?.publicLand; return s ? (s.status === 'on_public_land' ? issue('Proposal is on public land') : pass('Proposal does not sit on the public strip')) : awaiting('Needs a proposal and a plot outline'); },
  'PI-03-13': (a) => ((a.roads ?? []).length ? info('Road and frontage measured; vehicular access width not measured') : awaiting('No road mapped')),
  'PI-03-14': (a) => { const n = ['footprint', 'plot', 'lidar', 'constraints', 'history', 'ppd', 'epc'].filter((k) => a[k]).length; return info(`${n} of 7 evidence families returned data (no scoring model)`); },

  'PI-04-01': (a) => (hist(a) ? info(`${hist(a).here?.length ?? 0} application(s) at this address, ${hist(a).nearby?.length ?? 0} nearby`) : awaiting(histOff)),
  'PI-04-02': (a) => (hist(a) ? info(`${(hist(a).here ?? []).filter((r) => r.outcome === 'approved').length} approved at this address`) : awaiting(histOff)),
  'PI-04-03': (a) => { if (!hist(a)) return awaiting(histOff); const n = (hist(a).here ?? []).filter((r) => r.outcome === 'refused').length; return n ? issue(`${n} refused at this address`) : pass('No refusals found at this address'); },
  'PI-04-06': (a) => (hist(a) ? info(`${(hist(a).here ?? []).filter((r) => r.lawful).length} lawful-development certificate(s) at this address`) : awaiting(histOff)),
  'PI-04-07': (a) => (hist(a) ? info(`${(hist(a).here ?? []).filter((r) => r.prior).length} prior-approval application(s) at this address`) : awaiting(histOff)),
  'PI-04-09': (a) => { if (!hist(a)) return awaiting(histOff); const f = (hist(a).here ?? []).some((r) => r.flats && r.outcome === 'approved'); return f ? issue('Approved conversion to flats/HMO in the history') : info('No change of use found in the application descriptions'); },
  'PI-04-12': (a) => { const c = (a.map?.siteChecks?.regulatory ?? a.assessment?.regulatory ?? []).find((x) => x.id === 'cil'); return c ? issue(c.message) : assessed(a) ? info('New floor area below the 100 m² warning level (no charging-schedule lookup)') : awaiting('Needs a proposal'); },

  'PI-05-01': (a) => (a.useGate && a.useGate.state !== undefined ? issue(a.useGate.headline ?? 'Householder rights not confirmed') : assessed(a) ? pass('Householder rules apply to this property type') : a.address?.classification ? info('Gate not yet run (needs a proposal)') : awaiting('Not classified')),
  'PI-05-02': (a) => flag(a, 'article4', 'Article 4 direction applies - permitted development may be withdrawn', 'No Article 4 direction found'),
  'PI-05-03': (a) => (a.assessment?.gpdo ? info(`Class ${a.assessment.gpdo.class} - ${a.assessment.gpdo.title}`) : awaiting('Needs a proposal')),
  'PI-05-04': (a) => byIds(a, ['rear-depth', 'existing-extension']),
  'PI-05-05': (a) => byIds(a, ['height', 'side-height', 'out-height', 'porch-height']),
  'PI-05-06': (a) => byIds(a, ['eaves', 'existing-eaves', 'out-eaves']),
  'PI-05-07': (a) => byIds(a, ['rear-boundary', 'out-boundary', 'eaves']),
  'PI-05-08': (a) => (a.profile?.originalDwelling?.value === false ? issue('Applicant says this is not the original dwellinghouse') : a.profile?.originalDwelling?.value === true ? pass('Confirmed original dwellinghouse (applicant)') : awaiting('Applicant has not confirmed')),
  'PI-05-09': (a) => { const e = a.profile?.existingExtension; return e?.present != null ? info(e.present ? `Existing extension ${e.depthM ?? '?'} m deep (${provenance(e.source) ?? 'unknown source'})` : 'No existing extension (applicant)') : a.epc?.extensionCount > 0 ? info(`EPC records ${a.epc.extensionCount} extension(s) - applicant to confirm`) : awaiting('Not confirmed'); },
  'PI-05-10': (a) => byIds(a, ['side', 'side-storeys', 'side-height', 'side-width'], 'No side or wraparound proposal'),
  'PI-05-11': (a) => byIds(a, ['roof-height', 'roof-volume', 'roof-slope', 'roof-features', 'roof-balcony'], 'No roof proposal'),
  'PI-05-12': (a) => (checkById(a, 'materials') ? info(checkById(a, 'materials').message) : assessed(a) ? info('Condition stated; materials cannot be tested') : awaiting('Needs a proposal')),
  'PI-05-13': (a) => byIds(a, ['principal-elevation', 'location', 'front-corner', 'front-assumed']),
  'PI-05-14': (a) => { const c = checkById(a, 'curtilage'); if (c) return c.status === 'fail' || c.status === 'warn' ? issue(c.message) : pass(c.message); const k = a.map?.siteFacts?.curtilage; return k?.pct != null ? info(`${k.pct}% of the curtilage covered`) : awaiting('Needs a proposal and a registered plot'); },
  'PI-05-15': (a) => flag(a, 'article23Land', 'On protected (Article 2(3)) land', 'Not on Article 2(3) land'),
  'PI-05-16': (a) => (assessed(a) ? (a.assessment.verdict === 'prior_approval' ? issue('Prior approval route applies (larger home extension)') : pass('Prior approval not triggered')) : awaiting('Needs a proposal')),
  'PI-05-17': (a) => (assessed(a) ? (a.assessment.verdict === 'prior_approval' ? issue('Neighbour consultation applies (prior-approval route)') : pass('No neighbour consultation triggered')) : awaiting('Needs a proposal')),
  'PI-05-18': (a) => (assessed(a) ? info(`${a.assessment.label ?? a.assessment.verdict} (confidence: ${a.assessment.confidence ?? 'not stated'})`) : awaiting('Needs a proposal')),

  'PI-06-01': (a) => flag(a, 'greenBelt', 'In the Green Belt', 'Not in the Green Belt'),
  'PI-06-02': (a) => (lpaOf(a) ? info(`${lpaOf(a).authority}: ${lpaOf(a).document}`) : awaiting(noLpa(a))),
  'PI-06-03': (a) => (lpaOf(a) ? info(`SPD: ${lpaOf(a).document}`) : awaiting(noLpa(a))),
  'PI-06-04': (a) => (lpaOf(a) ? info(`Design-guide figures applied from ${lpaOf(a).document}`) : awaiting(noLpa(a))),
  'PI-06-05': (a) => (lpaOf(a) ? info(`Garden space and 45° test reported (${lpaOf(a).headline})`) : awaiting(noLpa(a))),
  'PI-06-06': (a) => (a.profile?.neighbourWindow?.value ? info('45° test run against the marked neighbour window') : awaiting('Applicant has not marked a neighbour window')),
  'PI-06-12': (a) => { const e = lpaFor(a.authority?.name); return e?.retrievedAt ? info(`Guidance retrieved ${e.retrievedAt}${e.caution ? ` - ${e.caution}` : ''}`) : awaiting('No local rules loaded for this authority'); },

  'PI-07-01': (a) => flag(a, 'listedBuilding', 'LISTED BUILDING - listed building consent needed', 'Not a listed building'),
  'PI-07-02': (a) => flag(a, 'conservationArea', 'In a conservation area', 'Not in a conservation area'),
  'PI-07-03': (a) => flag(a, 'scheduledMonument', 'On a scheduled monument', 'Not on a scheduled monument'),
  'PI-07-04': (a) => { if (!a.outlines) return awaiting('Constraint outlines not collected'); const n = areaSet(a, ['park-and-garden', 'battlefield']).length; return n ? issue(`${n} registered park/garden/battlefield within 250 m`) : pass('None within 250 m'); },
  'PI-07-07': (a) => { if (!a.outlines) return awaiting('Constraint outlines not collected'); const n = areaSet(a, ['listed-building-outline', 'conservation-area', 'scheduled-monument', 'park-and-garden']).length; return n ? info(`${n} designated asset(s) within 250 m - setting not assessed`) : pass('None within 250 m'); },
  'PI-07-09': (a) => { if (!a.outlines) return awaiting('Constraint outlines not collected'); const n = (a.map?.siteChecks?.areas ?? []).length; return info(`${n} area(s) within 250 m; no buffer rule applied`); },

  'PI-08-01': (a) => { if (!a.constraints) return awaiting('Constraints were not checked'); const f = dataset(a, 'flood-risk-zone'); return f.length ? issue(`In a flood risk zone${f[0].name ? ` (${f[0].name})` : ''}`) : pass('Not in a mapped flood risk zone (national data)'); },
  'PI-08-12': (a) => { const sw = a.flood?.surfaceWater; const high = sw?.status === 'ok' && ['high', 'medium'].includes(sw.band); return a.constraints?.flags?.floodZone ? issue('An FRA may be needed (flood zone applies)') : high ? issue(`Surface water risk is ${sw.band}: a flood risk assessment or drainage strategy may be asked for`) : a.constraints ? info('No flood zone or medium/high surface water risk found; no other FRA trigger logic') : awaiting('Constraints were not checked'); },

  'PI-09-01': (a) => (a.coal && a.coal.status !== 'unavailable' ? (a.coal.details?.reportingArea ? issue('In the coal mining reporting area') : info('Not flagged as a reporting area')) : awaiting('Coal risk is switched off or unavailable')),
  'PI-09-02': (a) => (a.coal && a.coal.status !== 'unavailable' ? (a.coal.status === 'inside' ? issue('Inside a Development High Risk Area') : a.coal.status === 'near' ? issue(`${a.coal.distanceM} m from a Development High Risk Area`) : pass('Outside the mapped high-risk areas')) : awaiting('Coal risk is switched off or unavailable')),
  'PI-09-03': (a) => { if (!a.coal || a.coal.status === 'unavailable') return awaiting('Coal risk is switched off or unavailable'); const n = a.coal.details?.mineEntry?.length ?? 0; return n ? issue(`${n} recorded mine entr${n === 1 ? 'y' : 'ies'} within ${a.coal.details.mineEntryWithinM} m`) : pass('No recorded mine entry nearby'); },
  'PI-09-04': (a) => { if (!a.coal || a.coal.status === 'unavailable') return awaiting('Coal risk is switched off or unavailable'); const n = a.coal.details?.mineEntry?.length ?? 0; return n ? issue(`Mine entry within ${a.coal.details.mineEntryWithinM} m`) : pass('No mine entry within the search distance'); },
  'PI-09-05': (a) => { if (!a.coal || a.coal.status === 'unavailable') return awaiting('Coal risk is switched off or unavailable'); const d = a.coal.details ?? {}; return d.pastWorkings || d.probableWorkings ? issue('Past or probable shallow coal workings') : pass('No coal workings recorded here'); },
  'PI-09-06': (a) => { if (!a.coal || a.coal.status === 'unavailable') return awaiting('Coal risk is switched off or unavailable'); const d = a.coal.details ?? {}; return d.pastWorkings || d.probableWorkings || d.fissures || d.outcrop ? issue('Shallow-mining indicators present') : pass('No shallow-mining indicator recorded'); },
  'PI-09-11': (a) => (a.landfill && a.landfill.status !== 'unavailable' ? (a.landfill.status === 'inside' ? issue('On a recorded historic landfill (made ground)') : a.landfill.status === 'near' ? issue(`Historic landfill within ${a.landfill.nearM} m`) : pass('No recorded landfill nearby (unrecorded fill not shown)')) : awaiting('Landfill check is switched off or unavailable')),
  'PI-09-12': (a) => (a.landfill && a.landfill.status !== 'unavailable' ? (a.landfill.status === 'none' || !a.landfill.status ? info('No landfill indicator; no contaminated-land data') : issue('Landfill indicator present')) : awaiting('Landfill check is switched off or unavailable')),
  'PI-09-13': (a) => (a.landfill && a.landfill.status !== 'unavailable' ? (a.landfill.status === 'inside' || a.landfill.status === 'near' ? issue(`${a.landfill.status === 'inside' ? 'Inside' : `Within ${a.landfill.nearM} m of`} a recorded landfill`) : pass('None recorded within the search distance')) : awaiting('Landfill check is switched off or unavailable')),
  'PI-09-14': (a) => (a.landfill?.status === 'inside' || a.landfill?.status === 'near' || a.coal?.status === 'inside' ? issue('Ground investigation likely (landfill or coal risk)') : a.landfill || a.coal ? info('No landfill or coal trigger; no other ground-investigation logic') : awaiting('Landfill and coal checks are off')),
  'PI-09-16': (a) => (a.coal && a.coal.status !== 'unavailable' ? (a.coal.status === 'inside' || a.coal.details?.reportingArea ? issue('A Mining Report is advisable') : pass('No Mining Report trigger found')) : awaiting('Coal risk is switched off or unavailable')),

  'PI-10-01': (a) => { const n = (a.powerLines ?? []).length; return n ? issue(`${n} overhead line segment(s) mapped within 60 m`) : info('No overhead lines mapped (OSM coverage is incomplete)'); },
  'PI-10-05': (a) => countObs(a, 'pole/pylon(s)', 'pole', 'pylon'),
  'PI-10-07': (a) => { const n = (a.powerLines ?? []).filter((l) => l.kind === 'line').length; return n ? issue(`${n} high-voltage overhead segment(s)`) : info('No overhead HV mapped; underground HV not covered'); },
  'PI-10-08': (a) => { const n = (a.powerLines ?? []).filter((l) => l.kind === 'minor_line').length; return n ? info(`${n} local overhead segment(s)`) : info('No overhead LV mapped; underground LV not covered'); },
  'PI-10-18': () => info('A utility record search is always advised (not conditional on findings)'),

  'PI-11-01': (a) => countObs(a, 'post box(es)', 'post_box'),
  'PI-11-02': (a) => countObs(a, 'street light(s)', 'lamp'),
  'PI-11-04': (a) => countObs(a, 'cabinet(s)', 'cabinet'),
  'PI-11-05': (a) => countObs(a, 'bus stop(s)', 'bus_stop'),
  'PI-11-06': (a) => { const r = (a.roads ?? []).find((x) => !x.ignore); return r ? info(`${r.classLabel ?? 'Local road'}${r.name ? ` - ${r.name}` : ''} (from OSM class)`) : awaiting('No road mapped'); },
  'PI-11-07': (a) => (a.map?.siteChecks?.publicLand ? info('Public strip estimated from plot and carriageway; adopted boundary not known') : awaiting('Needs a plot outline')),
  'PI-11-08': (a) => countObs(a, 'dropped kerb(s)', 'dropped_kerb'),
  'PI-11-09': (a) => { const n = (a.pathways ?? []).length; return n ? info(`${n} pavement/path segment(s) mapped`) : info('No pavement or path mapped'); },
  'PI-11-14': (a) => ((a.roads ?? []).some((r) => r.classified && !r.ignore) ? issue('Next to a classified road - construction traffic and access need highway consent') : info('Not next to a classified road (OSM)')),

  'PI-12-01': (a) => { if (!a.protectedTrees) return awaiting('Tree preservation data not collected'); const n = (a.protectedTrees.zones?.length ?? 0) + (a.protectedTrees.trees?.length ?? 0); return n ? issue(`${n} protected tree record(s) nearby`) : pass('None recorded nearby (council coverage varies)'); },
  'PI-12-03': (a) => { const t = (a.trees ?? []).length; return t ? info(`${t} tree(s) within 60 m; root zones tested against the proposal`) : info('No trees mapped (OSM coverage is incomplete)'); },
  'PI-12-04': (a) => { const t = (a.trees ?? []).length; return t ? info(`${t} mapped tree(s) within 60 m`) : info('No trees mapped'); },
  'PI-12-05': (a) => { if (!a.outlines) return awaiting('Constraint outlines not collected'); const n = areaSet(a, ['ancient-woodland']).length; return n ? issue('Ancient woodland within 250 m') : pass('None within 250 m'); },
  'PI-12-10': (a) => flag(a, 'sssi', 'On a Site of Special Scientific Interest', 'Not on an SSSI'),
  'PI-12-11': (a) => flag(a, 'greenBelt', 'In the Green Belt', 'Not in the Green Belt'),
  'PI-12-12': (a) => { if (!a.constraints) return awaiting('Constraints were not checked'); const d = ['national-park', 'area-of-outstanding-natural-beauty', 'world-heritage-site'].filter((x) => dataset(a, x).length); return d.length ? issue(`Landscape designation: ${d.join(', ')}`) : pass('No landscape designation found'); },

  'PI-13-06': (a) => (a.landfill && a.landfill.status !== 'unavailable' ? (a.landfill.status === 'inside' || a.landfill.status === 'near' ? issue('Historic landfill nearby (permitted waste sites not covered)') : info('No historic landfill nearby; permitted waste sites not covered')) : awaiting('Landfill check is switched off or unavailable')),
  'PI-13-07': (a) => (a.landfill?.sites?.some((s) => s.gasControl) ? issue('Landfill gas control recorded nearby') : a.landfill ? info('No gas control recorded; no ground-gas assessment') : awaiting('Landfill check is switched off or unavailable')),

  'PI-14-01': (a) => (a.interior?.available ? info(a.interiorSetup?.layout ? 'Floor plan drawn by the applicant' : 'Typical generated layout - not a survey') : awaiting('No interior model')),
  'PI-14-02': (a) => (a.epc?.floorAreaM2 ? info(`${a.epc.floorAreaM2} m² (EPC, not measured)`) : awaiting('No energy certificate')),
  'PI-14-03': (a) => (a.interior?.available ? info(a.interiorSetup?.layout ? 'Room sizes from the applicant-drawn plan' : 'Room sizes from a generated layout') : awaiting('No interior model')),
  'PI-14-05': (a) => (a.lidar?.roofShape ? info(`Roof ${a.lidar.roofShape} (LiDAR); structure not known`) : awaiting('No LiDAR roof data')),
  'PI-14-06': (a) => (a.interior?.available ? info('Stairs modelled') : awaiting('No interior model')),
  'PI-14-08': (a) => (a.interior?.checks?.some?.((c) => /escape|fire/.test(c.id)) ? issue('Fire escape advice raised for new upper-floor rooms') : a.interior?.available ? info('No upper-floor rooms to test') : awaiting('No interior model')),
  'PI-14-09': (a) => (a.epc?.rating ? info(`EPC band ${a.epc.rating}`) : awaiting('No energy certificate')),
  'PI-14-12': (a) => (a.interior?.available ? info('Guidance checks run on new rooms only') : awaiting('No interior model')),

  'PI-15-01': (a) => (a.address?.classification ? info(`Use: ${a.address.classification.use ?? 'unknown'}`) : awaiting('Not classified')),
  'PI-15-05': (a) => flag(a, 'article4', 'An Article 4 direction applies - check whether it covers HMO use', 'No Article 4 direction found'),
  'PI-15-06': (a) => (a.interior?.available ? info('Bedroom space standards applied to new rooms') : awaiting('No interior model')),
  'PI-15-07': (a) => (a.interior?.available ? info('Bedroom size checks applied to new rooms') : awaiting('No interior model')),
  'PI-15-08': (a) => (lpaOf(a) ? info('Garden-space guidance reported') : awaiting(noLpa(a))),
  'PI-15-09': (a) => (hist(a) ? info(`${(hist(a).here ?? []).filter((r) => r.lawful).length} certificate(s) of lawfulness found`) : awaiting(histOff)),

  'PI-16-01': (a) => (hist(a)?.nearby ? info(`${hist(a).nearby.length} similar application(s) within ${hist(a).radiusM ?? 150} m`) : awaiting(histOff)),
  'PI-16-02': (a) => info(`${(a.neighbours ?? []).length} neighbouring building(s), ${(a.obstacles ?? []).length} street feature(s) mapped`),
  'PI-16-04': (a) => countObs(a, 'bus stop(s)', 'bus_stop'),
  'PI-16-05': (a) => { const s = sales(a)[0]; return s ? info(`Last recorded sale ${String(s.date).slice(0, 4)}; ${sales(a).length} sale(s) on record`) : awaiting('No sale record'); },
  'PI-16-07': (a) => (assessed(a) ? info('What-if limits available for the chosen work type') : awaiting('Needs a proposal')),
  'PI-16-08': (a) => (assessed(a) ? info('What-if sliders available; no generated alternatives') : awaiting('Needs a proposal')),
  'PI-16-09': (a) => { const r = a.map?.siteChecks?.regulatory ?? a.assessment?.regulatory ?? []; return r.length ? info(`${r.length} building-regulations / party-wall / CIL reminder(s)`) : awaiting('Needs a proposal'); },
  'PI-16-10': (a) => (assessed(a) ? info(`${(a.assessment.checks ?? []).filter((c) => c.status === 'fail' || c.status === 'warn').length} warning/failing check(s) in the assessment`) : awaiting('Needs a proposal')),

  'PI-17-01': () => info('Provenance table available (services/sources)'),
  'PI-17-02': () => info('Only some sources carry a date'),
  'PI-17-03': (a) => (a.constraints?.checkedAt ? info(`Constraints checked ${String(a.constraints.checkedAt).slice(0, 10)}; other sources undated`) : awaiting('No retrieval timestamps')),
  'PI-17-04': () => info('Attribution strings on several providers; no licence register'),
  'PI-17-05': (a) => (a.plot?.estimated ? issue('Plot outline is an estimate') : a.lidar?.confidence === 'low' ? issue('LiDAR confidence is low') : info('Confidence is per source; not aggregated')),
  'PI-17-06': (a) => (a.address?.uprnMatch ? (a.address.uprnMatch.confidence === 'high' ? pass('High-confidence UPRN match') : issue('Low-confidence UPRN match')) : awaiting('No UPRN match')),
  'PI-17-07': (a) => (a.useGate ? issue(a.useGate.headline ?? 'Householder rules may not apply') : assessed(a) ? pass('Householder rules apply') : awaiting('Needs a proposal')),
  'PI-17-08': (a) => { const c = checkById(a, 'ppd-epc-mismatch'); return c ? issue(c.message) : info('No source conflicts detected'); },
  'PI-17-09': (a) => { const q = a.assessment?.checks?.filter?.((c) => c.id === 'unanswered-questions')?.length ?? 0; return q ? issue('Unanswered questions remain') : info('"Not available yet" tiles list data the engine cannot supply'); },
  'PI-17-13': (a) => info(`Export schema version ${a.exportVersion ?? 1}`),
};

/** Both sets of readings: the original checks (above) and the ones src/register/checks.js adds. Same signature: (app, cfg) -> { state, value }. */
const LIVE = { ...LIVE_BASE, ...LIVE_EXTRA };

/**
 * What the engine found for every check, for ONE application.
 * `app` should already carry what the register needs beyond the stored draft (see services/registerService.js `enrich`): `geo` (loaded datasets and council
 * standards) and `extras` (OSM substations / traffic signals). Without them those checks say "awaiting", never "pass".
 */
export function buildLiveRegister(app, cfg = {}) {
  const cat = buildCatalogue(cfg);
  const a = app ?? {};
  const checks = cat.checks.map((c) => {
    let live;
    if (c.status === 'missing') live = { state: 'not_built', value: c.note };
    else if (c.id === GATE_CHECK) live = { state: 'awaiting', value: 'Computed below, once every other reading is in' };
    else {
      try { live = LIVE[c.id] ? LIVE[c.id](a, cfg) : { state: 'info', value: 'Built; no per-application reading is exposed yet' }; }
      catch (e) { live = { state: 'awaiting', value: `Could not read this application (${e.message})` }; }
    }
    const row = { ...c, live: { ...live, label: LIVE_LABEL[live.state], basis: 'engine-derived', signOff: null }, evidenceCount: activeEvidence(a, c.id).length };
    row.live.signOff = reviewStatus(a, c.id, live);
    row.review = row.live.signOff;
    return row;
  });

  // The readiness gate (PI-17-14) reads every other row, so it is computed last.
  const gateRow = checks.find((c) => c.id === GATE_CHECK);
  const gate = evaluateGate(a, checks);
  if (gateRow && gateRow.status !== 'missing') {
    const g = gateReading(gate);
    gateRow.live = { ...g, label: LIVE_LABEL[g.state], basis: 'engine-derived', signOff: reviewStatus(a, GATE_CHECK, g) };
    gateRow.review = gateRow.live.signOff;
  }

  const count = (st) => checks.filter((c) => c.live.state === st).length;
  return {
    generatedAt: new Date().toISOString(), applicationId: app?.id ?? null, address: app?.address?.fullAddress ?? null,
    notice: 'Engine-derived readings. A reading becomes a verified finding only when a named reviewer signs it (PI-17-11); a sign-off goes stale if the reading or the evidence changes afterwards. A pass is limited to its own test, and "no record" is never "none exists".',
    coverage: cat.summary,
    live: { pass: count('pass'), issue: count('issue'), info: count('info'), awaiting: count('awaiting'), not_built: count('not_built') },
    readiness: gate,
    domains: cat.domains.map((d) => ({ ...d, summary: summarise(checks.filter((c) => c.domain === d.no)) })),
    checks,
  };
}

// ------------------------------------------------------------------------------------------------------------- output formats
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows, columns) { return [columns.map((c) => c[0]).join(','), ...rows.map((r) => columns.map((c) => csvCell(c[1](r))).join(','))].join('\r\n'); }

export const CATALOGUE_COLUMNS = [
  ['Check ID', (r) => r.id], ['Domain', (r) => `${r.domain} ${r.domainName}`], ['Parameter', (r) => r.name], ['Engine status', (r) => r.statusLabel],
  ['Runtime', (r) => r.runtime], ['Switches needed', (r) => r.switchesNeeded.join('; ')], ['Engine modules', (r) => r.modules], ['What the engine does / what it needs', (r) => r.note], ['Suggested route to close', (r) => r.routeLabel ?? ''],
  ['Evidence required (register)', (r) => r.evidence], ['Acceptance criterion (register)', (r) => r.acceptance],
];
export const LIVE_COLUMNS = [
  ['Check ID', (r) => r.id], ['Domain', (r) => `${r.domain} ${r.domainName}`], ['Parameter', (r) => r.name], ['Engine status', (r) => r.statusLabel],
  ['Live result', (r) => r.live.label], ['Finding', (r) => r.live.value], ['Engine modules', (r) => r.modules], ['Evidence required (register)', (r) => r.evidence], ['Acceptance criterion (register)', (r) => r.acceptance],
  ['Evidence on file', (r) => r.evidenceCount ?? 0], ['Reviewer sign-off', (r) => (r.review ? `${r.review.status}: ${r.review.reviewer} (${r.review.role}), ${String(r.review.at).slice(0, 10)}` : '')],
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** One self-contained HTML page: headline counts, a per-domain table, then every check. `doc` is buildCatalogue() or buildLiveRegister(). */
export function renderHtml(doc) {
  const s = doc.summary ?? doc.coverage, live = !!doc.live;
  const badge = (st) => `<span class="b ${st}">${esc(STATUS_LABEL[st])}</span>`;
  const liveBadge = (l) => `<span class="b l-${l.state}">${esc(l.label)}</span>`;
  const rows = doc.checks.map((c) => `<tr class="${c.status}"><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${badge(c.status)}${c.runtime === 'off' ? ' <span class="b off">switched off</span>' : ''}</td>${live ? `<td>${liveBadge(c.live)}</td><td>${esc(c.live.value)}</td>` : ''}<td>${esc(c.note)}</td></tr>`).join('');
  const dom = doc.domains.map((d) => `<tr><td>${esc(d.no)}</td><td>${esc(d.name)}</td><td>${d.summary.total}</td><td>${d.summary.have}</td><td>${d.summary.partial}</td><td>${d.summary.missing}</td><td>${d.summary.builtPct}%</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>228-parameter intelligence register - engine coverage</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#1a1d21;--mut:#5b6470;--line:#d9dde3;--have:#1b7f4b;--partial:#b7791f;--missing:#b42318}@media(prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e8eaed;--mut:#9aa3ad;--line:#2d333a}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}h1{font-size:22px;margin:0 0 4px}p.m{color:var(--mut);margin:0 0 16px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.card{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:130px}.card b{display:block;font-size:28px}
table{border-collapse:collapse;width:100%;margin:12px 0 28px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--bg)}.w{overflow-x:auto}
.b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid currentColor}.b.have,.b.l-pass{color:var(--have)}.b.partial,.b.l-info,.b.off{color:var(--partial)}.b.missing,.b.l-issue,.b.l-not_built{color:var(--missing)}.b.l-awaiting{color:var(--mut)}</style></head><body>
<h1>228-parameter intelligence register: engine coverage</h1><p class="m">${esc(doc.source ?? doc.notice ?? '')}${doc.address ? ` &middot; ${esc(doc.address)}` : ''} &middot; generated ${esc(doc.generatedAt)}</p>
<div class="cards"><div class="card"><b>${s.total}</b>checks in the register</div><div class="card"><b style="color:var(--have)">${s.have}</b>have (${s.havePct}%)</div><div class="card"><b style="color:var(--partial)">${s.partial}</b>partial (${s.partialPct}%)</div><div class="card"><b style="color:var(--missing)">${s.missing}</b>not built (${s.missingPct}%)</div><div class="card"><b>${s.built}</b>built in some form (${s.builtPct}%)</div></div>
${live ? `<p>This application: ${doc.live.pass} pass, ${doc.live.issue} issue, ${doc.live.info} info, ${doc.live.awaiting} awaiting data, ${doc.live.not_built} not built. ${esc(doc.notice)}</p>` : ''}
<div class="w"><table><thead><tr><th>#</th><th>Domain</th><th>Checks</th><th>Have</th><th>Partial</th><th>Not built</th><th>Built</th></tr></thead><tbody>${dom}</tbody></table></div>
<div class="w"><table><thead><tr><th>ID</th><th>Parameter</th><th>Engine</th>${live ? '<th>Result</th><th>Finding</th>' : ''}<th>What the engine does / needs</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`;
}
