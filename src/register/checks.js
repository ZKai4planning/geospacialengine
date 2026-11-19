import { CHECKS } from '../data/intelligenceRegister.js';
import { DATASET_BY_KEY } from './datasets.js';
import { rankOf } from './geo.js';
import { activeEvidence } from './evidence.js';
import { localProjector, pointInRing, ringDistance, ringToLineDistance, touchesTriangle, nearestOnLine, openRing } from './planar.js';
import { ringCentroid } from '../utils/geo.js';

/**
 * THE REMAINING 112 CHECKS of the 228-parameter register, as live readings.  Each check is fed one of four ways, and says which:
 *
 *   logic      computed from what the application already holds (rules written out below, with their sources)
 *   layer      read from a dataset YOU loaded onto your server (src/register/datasets.js, npm run import:geo). Not loaded = "awaiting", never "pass".
 *   standards  a council's own numbers (parking, cycle, density, SuDS) loaded per authority (src/register/standards.js)
 *   evidence   something only a person or a document can supply: deeds, surveys, specialist reports. Entered through the evidence API, reviewed by a named person.
 *
 * Readings are { state, value }: pass | issue | info | awaiting. A pass is limited to the test that was run; the engine never verifies (see evidence.js).
 */
export const CHECK_BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
const awaiting = (value) => ({ state: 'awaiting', value }), info = (value) => ({ state: 'info', value }), pass = (value) => ({ state: 'pass', value }), issue = (value) => ({ state: 'issue', value });
const r1 = (n) => Math.round(n * 10) / 10;
const AS_OF = '2026-11-16';

// ----------------------------------------------------------------------------------------------------------------------------- helpers
const flags = (a) => a.constraints?.flags ?? {};
/** The constraint flags only cover nine datasets; national park, AONB and World Heritage Site come from the point lookup items or the area outlines. */
const inDataset = (a, dataset) => (a.constraints?.items ?? []).some((i) => i.dataset === dataset) || (a.map?.siteChecks?.areas ?? []).some((x) => x.dataset === dataset && x.status === 'inside');
const sensitive = (a) => ({ nationalPark: inDataset(a, 'national-park'), aonb: inDataset(a, 'area-of-outstanding-natural-beauty'), worldHeritageSite: inDataset(a, 'world-heritage-site') });
const England = (a) => !a.country || a.country === 'England';
const proposalRing = (a) => a.map?.layers?.find((l) => l.kind === 'proposal')?.ring ?? null;
const houseRing = (a) => a.footprint?.ring ?? null;
const ptype = (a) => a.proposal?.type ?? null;
const ROOF_WORK = ['rear_dormer', 'additional_storey'];
const isRoofWork = (a) => ROOF_WORK.includes(ptype(a)) || a.proposal?.type === 'custom_polygon' && /dormer|storey/i.test(a.proposal?.workAs ?? '');
const isUpper = (a) => isRoofWork(a) || Number(a.proposal?.storeys) >= 2;
const age = (a) => { const m = String(a.epc?.ageBand ?? '').match(/(\d{4})\s*[-–]\s*(\d{4})|before\s*(\d{4})|(\d{4})\s*onwards|(\d{4})/i); if (!m) return null; const nums = m.slice(1).filter(Boolean).map(Number); return { from: nums[0], to: nums[1] ?? nums[0], band: a.epc.ageBand }; };
const lpaCode = (a) => a.authority?.code ?? null;

/** Evidence on file for a check: entries (oldest first) and their values merged, newest winning. */
export const evidenceOf = (a, id) => activeEvidence(a, id);
export const evVals = (a, id) => Object.assign({}, ...evidenceOf(a, id).map((e) => e.values ?? {}));
const evTag = (e) => `${e.kind.replace('_', ' ')} from ${e.source}${e.effectiveDate ? `, dated ${e.effectiveDate}` : `, recorded ${String(e.recordedAt).slice(0, 10)}`}; unreviewed`;

/** Reading for a check that rests on evidence. `read(values, entries, a)` may return a reading, or null for the plain summary. */
function fromEvidence(a, id, read) {
  const list = evidenceOf(a, id);
  if (!list.length) return awaiting(`No evidence on file. Needs: ${CHECK_BY_ID[id].evidence}`);
  const r = read ? read(evVals(a, id), list, a) : null;
  const last = list[list.length - 1];
  return r ?? info(`${list.length} piece${list.length > 1 ? 's' : ''} of evidence on file (${evTag(last)}): ${last.summary}`);
}
const tagged = (r, a, id) => { const last = evidenceOf(a, id).at(-1); return last ? { ...r, value: `${r.value} [${evTag(last)}]` } : r; };

/** Looks up one loaded dataset on the application. Returns { r } or { missing: 'why' }. */
function layer(a, key) {
  const def = DATASET_BY_KEY[key];
  if (!a.geo) return { missing: `${def.title}: geo layers are off (set DATABASE_URL, then npm run import:geo -- --dataset ${key} --file ...)` };
  const r = a.geo.results?.[key];
  if (!r || r.status === 'unavailable') return { missing: `${def.title} is not loaded${def.scope === 'authority' ? ` for ${a.authority?.name ?? 'this authority'}` : ''}${r?.reason ? ` (${r.reason})` : ''} - load it with: npm run import:geo -- --dataset ${key} --file ...${def.scope === 'authority' ? ' --authority <code>' : ''}` };
  return { r };
}
/** Wraps a reading over one or more datasets: all missing -> awaiting; otherwise `f(results, a, missing)`. Evidence on the check refines it. */
const over = (keys, f) => (a) => {
  const got = {}, missing = [];
  for (const k of keys) { const l = layer(a, k); if (l.missing) missing.push(l.missing); else got[k] = l.r; }
  if (missing.length === keys.length) return awaiting(missing.join('; '));
  return f(got, a, missing);
};
const src = (r) => `${r.source ?? ''}${r.loadedAt ? `, loaded ${r.loadedAt}` : ''}`.trim();
const where = (r) => (r.measuredFrom === 'building outline' ? 'from the building outline' : 'from the address point');
const feat = (f) => `${f.name ?? f.ref ?? 'feature'}${f.distanceM ? ` (${f.distanceM} m)` : ''}`;
const hits = (r, pred = () => true) => (r.features ?? []).filter((f) => pred(f.props ?? {}, f));
const prop = (f, ...ks) => { for (const k of ks) if (f.props?.[k] != null) return f.props[k]; return null; };
const within = (r, m, pred) => hits(r, pred).filter((f) => f.distanceM <= m);
const NONE = (what, r) => pass(`No ${what} (${src(r)}); limited to the loaded data - absence of a record is not proof`);
const parseDay = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? null : t; };

// -------------------------------------------------------------------------------------------------------------------------------------
// LOGIC CHECKS
// -------------------------------------------------------------------------------------------------------------------------------------
const hist = (a) => a.history ?? null;

/** PI-04-16 - how complete is the planning history we hold? Never "complete" unless a search audit says the council's own register was searched. */
function historyCompleteness(a) {
  const h = hist(a);
  const audit = evVals(a, 'PI-04-16');
  const audited = evidenceOf(a, 'PI-04-16').length > 0 && audit.councilRegisterSearched === true;
  if (!h && !audited) return awaiting('Planning history is switched off or returned nothing, and no council-register search audit is on file');
  const rows = [...(h?.here ?? []), ...(h?.nearby ?? [])];
  const dates = rows.map((r) => String(r.receivedOn ?? r.decidedOn ?? '').slice(0, 10)).filter(Boolean).sort();
  const decided = rows.filter((r) => ['approved', 'refused'].includes(r.outcome)).length;
  const ag = age(a), earliest = dates[0] ?? null;
  const gaps = [];
  if (h && !(h.here ?? []).length) gaps.push('no application found at this address');
  if (earliest && ag && Number(earliest.slice(0, 4)) - ag.to > 30) gaps.push(`earliest record ${earliest.slice(0, 4)} is long after the building was put up (${ag.band}) - older records are usually not online`);
  if (h && rows.length && decided / rows.length < 0.5) gaps.push('over half the records have no recorded decision');
  const searched = `searched: ${[a.address?.fullAddress?.split(',')[0], a.address?.postcode, a.address?.uprn ? `UPRN ${a.address.uprn}` : null].filter(Boolean).join('; ')}`;
  const base = h ? `PlanIt (an aggregator; coverage varies by council): ${(h.here ?? []).length} at this address, ${(h.nearby ?? []).length} within ${h.radiusM ?? 150} m; ${searched}${earliest ? `; earliest ${earliest.slice(0, 4)}` : ''}` : 'No automated history';
  if (audited) return info(`Completeness: audited. ${base}. Council register searched${audit.aliasesSearched ? ', aliases searched' : ''}${audit.authorityReplyReceived ? ', authority reply on file' : ''} (unreviewed).`);
  return info(`Completeness: PARTIAL - not audited. ${base}.${gaps.length ? ` Gaps: ${gaps.join('; ')}.` : ''} A chronological search of the council's own register (with property aliases) is needed to call it complete.`);
}

/** PI-06-07 - overlooking and privacy. Window positions are not known to the engine, so this measures SEPARATION and says so. */
function privacy(a) {
  const P = proposalRing(a);
  if (!a.proposal || !P) return awaiting('Needs a proposal with a position on the plan');
  const std = a.geo?.standards?.privacy?.data ?? null;
  const backToBack = Number(std?.backToBackM) || 21, flank = Number(std?.windowToBlankM) || 12;
  const c = ringCentroid(P), proj = localProjector(c.lat, c.lng), Pm = openRing(P.map(proj));
  const nbs = (a.neighbours ?? []).filter((n) => n.ring?.length > 3).map((n) => ({ id: n.id, d: ringDistance(Pm, openRing(n.ring.map(proj))) })).sort((x, y) => x.d - y.d);
  const near = nbs[0];
  const basis = std ? `${a.geo.standards.privacy.source ?? 'the council\'s standard'}` : 'common design-guide figures (21 m between facing habitable-room windows; about 12 m window to blank wall) - not an adopted policy for this council';
  const win = a.profile?.neighbourWindow?.value, w = win ? Math.hypot(...proj([win.lng, win.lat]).map((v, i) => v - (i ? 0 : 0))) : null;
  const note = 'Window positions are not known to the engine, so this is a separation check only.';
  if (!isUpper(a)) return info(`Ground-floor work: ${near ? `nearest neighbouring building ${r1(near.d)} m away. ` : ''}Overlooking turns on boundary screening (fence/wall height), which is not verified. ${note}`);
  if (!near) return awaiting(`Upper-level work, but no neighbouring buildings are mapped to measure against. ${note}`);
  const win45 = a.map?.siteChecks?.fortyFive?.status;
  if (near.d < flank) return issue(`Upper-level work is ${r1(near.d)} m from the nearest neighbouring building - under ${flank} m, so overlooking/privacy is likely to be raised wherever a window faces it. Basis: ${basis}. ${note}`);
  if (near.d < backToBack) return info(`Upper-level work is ${r1(near.d)} m from the nearest neighbouring building: between ${flank} m and ${backToBack} m, so privacy depends on which way windows face. Basis: ${basis}.${win45 ? ` The 45-degree light test on the marked neighbour window: ${win45}.` : ''} ${note}`);
  return pass(`Upper-level work is ${r1(near.d)} m from the nearest neighbouring building (over ${backToBack} m). Basis: ${basis}. ${note}`);
}

/** PI-07-10 - does the application need a heritage statement, and from whom? */
function heritageStatement(a) {
  if (!a.constraints) return awaiting('Constraints were not checked');
  const f = { ...flags(a), ...sensitive(a) }, near = (a.outlines ?? []).filter((o) => ['listed-building-outline', 'conservation-area', 'scheduled-monument', 'park-and-garden', 'battlefield'].includes(o.dataset));
  const why = [f.listedBuilding && 'the building is listed', f.conservationArea && 'the site is in a conservation area', f.scheduledMonument && 'the site is on a scheduled monument', f.worldHeritageSite && 'the site is in a World Heritage Site'].filter(Boolean);
  if (why.length) return issue(`A heritage statement is needed: ${why.join(' and ')}. It must describe the significance of the asset and the effect of the work (NPPF, chapter "Conserving and enhancing the historic environment"; councils' validation lists ask for it). ${f.listedBuilding || f.scheduledMonument ? 'Specialist heritage input is expected (conservation officer / heritage consultant; Historic England for a scheduled monument).' : 'A proportionate statement by the applicant or agent is usually enough; use a heritage consultant if the work is visible from the street.'}`);
  if (near.length) return info(`${near.length} designated heritage asset(s) within 250 m (${[...new Set(near.map((o) => o.label))].join(', ')}). A statement is not automatic, but the setting of those assets may need to be addressed - check the council's validation list. Proximity alone does not show harm.`);
  return pass('No heritage designation on or within 250 m of the site in the national data, so no heritage statement is triggered (council local lists are checked separately, PI-07-05)');
}

/** PI-08-13 - is a sequential test needed? Minor / householder development is normally exempt; new homes and changes of use are not. */
function sequentialTest(a) {
  if (!a.constraints) return awaiting('Constraints were not checked');
  const zones = (a.constraints.items ?? []).filter((i) => i.dataset === 'flood-risk-zone');
  if (!zones.length) return pass('Not in flood zone 2 or 3 in the national data, so no sequential test is triggered (flood zone 1; surface-water and other risks are separate checks)');
  const txt = zones.map((z) => `${z.name ?? ''} ${z.reference ?? ''}`).join(' ') + (a.outlines ?? []).filter((o) => o.dataset === 'flood-risk-zone').map((o) => ` ${o.details?.level ?? ''}`).join('');
  const zone = /3/.test(txt) ? 'zone 3' : /2/.test(txt) ? 'zone 2' : 'zone 2 or 3';
  const cls = a.address?.classification;
  const newHome = a.proposal?.usedAsHome === true || (hist(a)?.here ?? []).some((r) => r.flats && r.outcome === 'approved') || cls?.use === 'non_residential';
  const vuln = cls?.use === 'non_residential' ? 'depends on the use (check the NPPF/PPG flood risk vulnerability table)' : 'more vulnerable (dwelling)';
  if (!a.proposal) return info(`In flood ${zone}; vulnerability class: ${vuln}. Householder extensions and other minor development do not normally need the sequential test (the flood-risk standing advice applies); a new home or change of use does. Needs a proposal to decide.`);
  if (newHome) return issue(`In flood ${zone} and the proposal is, or creates, a ${cls?.use === 'non_residential' ? 'non-residential-to-residential change' : 'separate dwelling'} (vulnerability: ${vuln}) - the sequential test is likely to be required. Rules as understood on ${AS_OF}; confirm against the current NPPF and PPG flood-risk sections.`);
  return info(`In flood ${zone}; the work is householder/minor development to an existing dwelling (vulnerability: ${vuln}), which does not normally need the sequential test. Follow the Environment Agency's flood-risk standing advice (floor levels, resilience); confirm with the council. Rules as understood on ${AS_OF}.`);
}

/** PI-10-06 - overhead line clearances. The engine's buffers are SCREENING distances, not a DNO or HSE standard. */
export const CLEARANCE_SCREEN_M = { minor_line: 6, line: 15 };
function clearances(a) {
  const lines = a.powerLines ?? [];
  const ev = evVals(a, 'PI-10-06');
  if (ev.surveyedClearanceM != null && ev.dnoMinimumM != null) {
    const ok = Number(ev.surveyedClearanceM) >= Number(ev.dnoMinimumM);
    return tagged((ok ? pass : issue)(`Surveyed clearance ${ev.surveyedClearanceM} m ${ok ? 'meets' : 'is BELOW'} the DNO's stated minimum of ${ev.dnoMinimumM} m`), a, 'PI-10-06');
  }
  const R = proposalRing(a) ?? houseRing(a);
  if (!lines.length) return info('No overhead lines mapped within 60 m (OSM coverage is incomplete; underground cables are PI-10-02). No clearance to test.');
  if (!R) return awaiting('No building or proposal outline to measure from');
  const c = ringCentroid(R), proj = localProjector(c.lat, c.lng), Rm = openRing(R.map(proj));
  const m = lines.map((l) => ({ l, d: ringToLineDistance(Rm, l.line.map(proj)) })).sort((x, y) => x.d - y.d)[0];
  const lim = CLEARANCE_SCREEN_M[m.l.kind] ?? 6, what = `${m.l.label ?? 'Overhead line'}${m.l.voltage ? ` (${m.l.voltage} V)` : ''}`;
  const from = proposalRing(a) ? 'the proposal' : 'the existing building';
  const tail = 'Safe clearance depends on voltage, conductor height and sag; the DNO sets it. The buffer used here is the engine\'s own screening distance, not a DNO or HSE standard.';
  return m.d <= lim ? issue(`${what} is ${r1(m.d)} m from ${from} - inside the ${lim} m screening buffer. Ask the DNO for its minimum clearance and survey the actual clearance. ${tail}`) : info(`${what} is ${r1(m.d)} m from ${from}, outside the ${lim} m screening buffer. ${tail}`);
}

/** PI-11-10 - visibility splays from the frontage, using Manual for Streets figures (x = 2.4 m; y = 25 m at 20 mph, 43 m at 30 mph). */
export const SPLAY_Y_M = { 20: 25, 30: 43 };
function visibilitySplays(a) {
  const ev = evVals(a, 'PI-11-10');
  const H = houseRing(a);
  const roads = (a.roads ?? []).filter((r) => !r.ignore && r.line?.length > 1);
  if (!H || !roads.length) return awaiting('Needs a building outline and a mapped road to draw the splays');
  const c = ringCentroid(H), proj = localProjector(c.lat, c.lng), Hm = openRing(H.map(proj)), cm = [0, 0];
  const rp = roads.map((r) => ({ r, n: nearestOnLine(cm, r.line.map(proj)) })).sort((x, y) => x.n.d - y.n.d)[0];
  const kerbUnits = (a.obstacles ?? []).filter((o) => o.kind === 'dropped_kerb').map((o) => proj([o.lng, o.lat])).sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
  const access = kerbUnits[0] ?? rp.n.q, usingKerb = !!kerbUnits[0];
  const near = nearestOnLine(access, rp.r.line.map(proj));
  const toPlot = [cm[0] - near.q[0], cm[1] - near.q[1]], len = Math.hypot(...toPlot) || 1, nrm = [toPlot[0] / len, toPlot[1] / len];
  const K = [near.q[0] + nrm[0] * ((rp.r.widthM ?? 5.5) / 2), near.q[1] + nrm[1] * ((rp.r.widthM ?? 5.5) / 2)];
  const speed = ev.speedMph != null ? Number(ev.speedMph) : !rp.r.classified ? 30 : null;
  const speedNote = ev.speedMph != null ? `${speed} mph (survey)` : speed ? '30 mph (ASSUMED for a local road - OSM speed limits are not held)' : null;
  if (speed == null) return awaiting('The nearest road is a classified/main road: the highway authority sets the visibility standard from the measured speed. Supply the speed (evidence value speedMph) to draw the splays');
  const x = Number(ev.xM) || 2.4, y = Number(ev.yM) || SPLAY_Y_M[speed];
  if (!y) return awaiting(`No splay length is held for ${speed} mph - supply the highway authority's figure (evidence value yM)`);
  const t = near.dir, E = [K[0] + nrm[0] * x, K[1] + nrm[1] * x];
  const tris = [[E, K, [K[0] + t[0] * y, K[1] + t[1] * y]], [E, K, [K[0] - t[0] * y, K[1] - t[1] * y]]];
  const blocked = [];
  const test = (label, pts, closed, own = false) => { if (tris.some((tr) => touchesTriangle(pts, tr, closed))) blocked.push({ label, own }); };
  test('the existing house', Hm, true, true);
  const P = proposalRing(a); if (P) test('the proposal', openRing(P.map(proj)), true, true);
  (a.barriers ?? []).forEach((b) => test(`a mapped ${b.kind}`, b.line.map(proj), false));
  (a.trees ?? []).forEach((tr) => { const p = proj([tr.lng, tr.lat]); if (tris.some((q) => touchesTriangle([p], q, false))) blocked.push({ label: 'a mapped tree' }); });
  (a.neighbours ?? []).forEach((n) => test('a neighbouring building', openRing(n.ring.map(proj)), true));
  const unique = [...new Set(blocked.map((b) => b.label))];
  const head = `Splay ${x} m x ${y} m both ways from ${usingKerb ? 'the mapped dropped kerb' : 'the frontage point nearest the road'}, ${speedNote}`;
  const tail = 'The splay must be clear above 0.6 m; heights of mapped fences, hedges and trees are not known, so a listed item is a possible obstruction to check on site. Figures from Manual for Streets; the highway authority\'s own standard governs.';
  return unique.length ? issue(`${head}: ${unique.join(', ')} lie${unique.length === 1 ? 's' : ''} inside it. ${tail}`) : info(`${head}: nothing mapped inside it. ${tail}`);
}

/** PI-12-02 - works to trees in a conservation area need six weeks' notice (section 211, Town and Country Planning Act 1990). */
function conservationTrees(a) {
  if (!a.constraints) return awaiting('Constraints were not checked');
  const ev = evVals(a, 'PI-12-02');
  const tpo = (a.protectedTrees?.zones?.length ?? 0) + (a.protectedTrees?.trees?.length ?? 0);
  if (!flags(a).conservationArea) return pass(`Not in a conservation area in the national data, so the six-week tree notice does not apply${tpo ? ` (but ${tpo} protected-tree record(s) nearby: a tree preservation order needs consent instead)` : ''}`);
  const n = (a.trees ?? []).length;
  const noted = ev.noticeGiven === true ? ` Notice recorded${ev.noticeDate ? ` on ${ev.noticeDate}` : ''} (unreviewed).` : '';
  return issue(`In a conservation area: give the council six weeks' written notice before cutting down or lopping any tree with a trunk over 75 mm diameter (measured 1.5 m up), unless an exemption applies. ${n ? `${n} tree(s) mapped within 60 m (OSM; a tree inventory on site is needed).` : 'No trees are mapped, but OSM coverage is incomplete - a tree inventory on site is needed.'}${noted}`);
}

/** PI-12-09 - does statutory Biodiversity Net Gain apply? Rules as understood on AS_OF, including the changes for applications from 6 August 2026. */
function bng(a) {
  if (!England(a)) return info(`Statutory 10% BNG is an England-only regime (${a.country}): Wales and Scotland have their own biodiversity policies - check the national and local rules`);
  const cls = a.address?.classification, verdict = a.assessment?.verdict;
  const householder = !!a.proposal && cls?.use !== 'non_residential' && a.proposal.usedAsHome !== true;
  const basis = `Rules as understood on ${AS_OF} (gov.uk "Biodiversity net gain: exempt developments"; amendments in force for applications from 6 August 2026) - confirm before relying on it.`;
  if (verdict === 'permitted' || verdict === 'pd') return pass(`Exempt: permitted development is outside the statutory BNG requirement. ${basis}`);
  if (householder) return pass(`Exempt: householder applications (works to an existing home within its curtilage) are exempt from statutory BNG. ${basis}`);
  if (!a.proposal) return awaiting('Needs a proposal and use to decide whether an exemption applies');
  const plot = a.plot?.areaM2 && !a.plot.estimated ? a.plot.areaM2 : null;
  const ev = evVals(a, 'PI-12-09');
  const small = plot != null && plot <= 2000 ? `The registered site is ${Math.round(plot)} m² (0.2 ha or less): the small-sites exemption may apply for applications from 6 August 2026 if no on-site priority habitat is affected. ` : '';
  const deMin = ev.habitatAffectedM2 != null && Number(ev.habitatAffectedM2) < 25 && Number(ev.hedgerowAffectedM ?? 0) < 5 ? 'The recorded habitat impact is under 25 m² (and under 5 m of hedgerow): the de minimis exemption may apply. ' : '';
  return issue(`Mandatory 10% BNG likely applies unless an exemption is shown. ${small}${deMin}A habitat baseline (statutory metric) is needed. ${basis}`);
}

/** PI-12-13 - what in the data triggers an ecology survey. Never a clearance: the absence of a trigger is not "no ecology". */
function ecologyTrigger(a) {
  if (!a.constraints) return awaiting('Constraints were not checked');
  const f = flags(a), why = [];
  if (f.sssi) why.push('the site is on an SSSI');
  if ((a.outlines ?? []).some((o) => o.dataset === 'ancient-woodland')) why.push('ancient woodland within 250 m');
  if (isRoofWork(a)) why.push('roof/loft work (bats and nesting birds) - a preliminary roost assessment is advised for roofs of older buildings, especially near trees or water');
  const ag = age(a); if (isRoofWork(a) && ag && ag.to < 1960) why.push(`the building dates from ${ag.band} (older roofs more often hold roosts)`);
  const trees = (a.map?.siteChecks?.trees ?? []).filter((t) => t.distanceM != null && t.distanceM <= 15).length;
  if (trees) why.push(`${trees} mapped tree(s) within 15 m of the work`);
  const species = a.geo?.results?.['species-records'];
  if (species?.status && species.status !== 'unavailable' && species.features?.some((s) => s.props?.protected !== false)) why.push(`${species.features.length} protected-species record(s) within ${species.nearM} m`);
  if (why.length) return issue(`An ecological survey or assessment is likely to be asked for: ${why.join('; ')}. Natural England's standing advice and the council's validation list decide. Surveys have seasons - plan ahead.`);
  return info('No automatic ecology trigger found in the data held (designations, woodland, roof work, trees, species records). That is not a clearance: ecology depends on the site - check the council\'s validation list.');
}

/** PI-13-08 - asbestos survey trigger: building age plus the work touching existing fabric. */
function asbestos(a) {
  const ev = evVals(a, 'PI-13-08');
  const year = ev.builtYear != null ? { to: Number(ev.builtYear), band: `built ${ev.builtYear} (evidence)` } : age(a);
  const touches = a.proposal && !['outbuilding'].includes(ptype(a));
  if (!year) return awaiting('Building age unknown (no energy certificate, and no builtYear in evidence). Asbestos was in common use until the 1990s and fully banned in 1999');
  if (year.to >= 2000) return pass(`Built ${year.band}: after the 1999 asbestos ban, so no asbestos survey trigger`);
  if (!a.proposal) return info(`Built ${year.band}: asbestos may be present. A refurbishment/demolition survey is needed before work that disturbs the fabric; needs a proposal to say whether it does`);
  return touches
    ? issue(`Built ${year.band} and the work joins onto or alters the existing building: an asbestos survey of the affected fabric should be done before work starts (a refurbishment survey is a legal requirement for non-domestic premises under the Control of Asbestos Regulations 2012 and the HSE expects the same care for homes)${ev.asbestosSurveyRef ? `; survey reference on file: ${ev.asbestosSurveyRef}` : ''}`)
    : info(`Built ${year.band}; the proposal is a separate new outbuilding, so existing fabric is not disturbed - no survey triggered by this work`);
}

/** PI-15-10 - licensing conclusion, from the designations loaded for this council and the occupancy declared. */
function licensing(a) {
  const ev = evVals(a, 'PI-15-10');
  const occ = ev.occupants != null ? Number(ev.occupants) : null, hh = ev.households != null ? Number(ev.households) : null;
  const mandatory = occ != null && hh != null ? occ >= 5 && hh >= 2 : null;
  const add = layer(a, 'licensing-additional'), sel = layer(a, 'licensing-selective');
  const live = (l) => l.r && l.r.features?.filter((f) => f.inside && !(prop(f, 'effectiveTo') && parseDay(prop(f, 'effectiveTo')) < Date.now()));
  const reasons = [];
  if (England(a) && mandatory) reasons.push(`mandatory HMO licensing (${occ} occupants in ${hh} households; the threshold is 5 or more people in 2 or more households)`);
  if (add.r?.status === 'inside' && live(add)?.length) reasons.push(`inside the council's additional HMO licensing designation${prop(live(add)[0], 'effectiveFrom') ? ` (from ${prop(live(add)[0], 'effectiveFrom')})` : ''}`);
  if (sel.r?.status === 'inside' && live(sel)?.length) reasons.push(`inside the council's selective licensing designation (privately rented homes)${prop(live(sel)[0], 'exemptions') ? `; exemptions listed: ${prop(live(sel)[0], 'exemptions')}` : ''}`);
  if (reasons.length) return issue(`A licence is likely to be required: ${reasons.join('; ')}. Confirm with the housing authority.`);
  const missing = [add.missing && 'additional licensing', sel.missing && 'selective licensing'].filter(Boolean);
  if (missing.length === 2 && mandatory == null) return awaiting(`Cannot conclude: no ${missing.join(' or ')} designation data is loaded for ${a.authority?.name ?? 'this council'} and no occupancy is on file (needs occupants and households as evidence values)`);
  if (missing.length) return info(`No licensing requirement indicated, but ${missing.join(' and ')} data is not loaded for this council, so the conclusion is incomplete${mandatory === false ? '; declared occupancy is below the mandatory threshold' : ''}`);
  return mandatory === null ? info('Not inside an additional or selective licensing designation. The mandatory test needs the number of occupants and households (evidence values occupants, households)') : pass('Not inside an additional or selective licensing designation, and the declared occupancy is below the mandatory HMO threshold (limited to the data and declaration on file)');
}

/** PI-16-06 - EIA screening and environmental context. */
function environmentalContext(a) {
  if (!a.constraints) return awaiting('Constraints were not checked');
  const f = { ...flags(a), ...sensitive(a) }, ctx = [];
  if (f.sssi || f.nationalPark || f.aonb || f.worldHeritageSite) ctx.push('on or in a sensitive area (SSSI / national park / AONB / World Heritage Site)');
  if (f.floodZone) ctx.push('flood zone 2/3');
  const aq = a.geo?.results?.aqma; if (aq?.status === 'inside') ctx.push('inside an Air Quality Management Area');
  const nz = a.geo?.results?.['noise-strategic']; const lden = Math.max(0, ...(nz?.features ?? []).filter((x) => x.inside).map((x) => Number(prop(x, 'lden')) || 0)); if (lden >= 55) ctx.push(`strategic noise ${lden} dB Lden`);
  if ((a.roads ?? []).some((r) => r.classified && !r.ignore)) ctx.push('next to a classified road (access)');
  const missing = ['aqma', 'noise-strategic'].filter((k) => layer(a, k).missing);
  const context = `Context: ${ctx.length ? ctx.join('; ') : 'nothing notable in the data held'}${missing.length ? `; ${missing.join(' and ')} not loaded` : ''}.`;
  if (a.address?.classification?.use === 'non_residential') return info(`Possible Schedule 2 project: screen against the Environmental Impact Assessment Regulations 2017 thresholds. ${context}`);
  return pass(`EIA screening: householder work to a dwelling is not a Schedule 1 or Schedule 2 project under the EIA Regulations 2017, so no screening opinion is triggered (limited to that test). ${context}`);
}

// ------------------------------------------------------------------------------------------------------------------------ workflow
const WORKFLOW = {
  'PI-17-10': (a) => { const s = a.surveys ?? []; return s.length ? info(`${s.length} survey request(s): ${['draft', 'requested', 'booked', 'returned', 'cancelled'].map((k) => [k, s.filter((x) => x.status === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}`) : info('Survey-request workflow is available (POST /api/applications/:id/surveys); none requested yet'); },
  'PI-17-11': (a, cfg) => {
    if (!cfg?.reviewerToken) return awaiting('Reviewer sign-off is switched off: set REVIEWER_TOKEN so named reviewers can sign checks');
    const n = Object.keys(a.signOffs ?? {}).length;
    return info(n ? `${n} check(s) have a reviewer sign-off on record (see each check's review status; stale ones need re-review)` : 'Sign-off is available to named reviewers; nothing signed yet');
  },
  'PI-17-12': (a) => { const r = a.officerReviews ?? [], p = r.filter((x) => x.status === 'pending').length, last = r.filter((x) => x.outcome).at(-1); return r.length ? info(`${r.length} officer review(s): ${p} pending${last ? `; last outcome "${last.outcome.outcome}" (${last.outcome.officer})` : ''}${r.find((x) => x.lpaReference) ? `; LPA reference ${r.find((x) => x.lpaReference).lpaReference}` : ''}`) : info('The officer review queue is available (POST /api/applications/:id/officer-reviews); not yet submitted'); },
};

// ------------------------------------------------------------------------------------------------------------------------- evidence
const rights = (noun) => (v) => (v.present === true && v.affectsProposal === true ? issue(`${noun} declared and it affects the proposal - not legally verified; the conveyancer must confirm`) : v.present === true ? info(`${noun} declared; effect on the proposal not stated (unreviewed)`) : v.present === false ? info(`No ${noun} declared in the evidence on file (declared, not independently verified)`) : null);
const EVIDENCE = {
  'PI-02-01': (v, list) => { const d = list.filter((e) => e.kind === 'official_record').map((e) => e.effectiveDate).filter(Boolean).sort().at(-1); const old = d ? (Date.now() - parseDay(d)) / 864e5 : null; return v.proprietor ? (old != null && old > 90 ? issue(`Official copy is ${Math.round(old)} days old (dated ${d}); the proprietor shown (${v.proprietor}) must be re-checked against a current copy`) : info(`Proprietor per the Land Registry official copy${d ? ` dated ${d}` : ''}: ${v.proprietor}${v.titleNumber ? ` (title ${v.titleNumber})` : ''}${v.tenure ? `, ${v.tenure}` : ''}. Unreviewed.`)) : null; },
  'PI-02-05': rights('restrictive covenant'), 'PI-02-06': rights('easement'), 'PI-02-07': rights('private right of way'), 'PI-02-08': rights('access reservation'),
  'PI-02-09': (v) => (v.present === true ? info(`Rentcharge declared${v.amount ? ` (${v.amount})` : ''}: check whether it can be redeemed or affects a sale/lease`) : v.present === false ? info('No rentcharge declared (not independently verified)') : null),
  'PI-02-10': (v) => (v.present === true && v.consentObtained !== true ? issue('A restriction on disposition is declared and its consent/certificate is not recorded - dealings may be blocked') : v.present === true ? info('Restriction declared and consent recorded (unreviewed)') : v.present === false ? info('No restriction declared (not independently verified)') : null),
  'PI-02-11': (v) => (v.indicatorsFound === true ? issue('Possession indicators declared: needs legal review. The engine never decides adverse possession') : info('No possession indicators declared. This is never concluded automatically: a legal review is the only basis for any finding')),
  'PI-02-12': (v) => (v.historicRestrictionsFound === true ? issue('Restrictions found in the historic conveyances: the conveyancer must confirm whether they still bind') : v.filed === true ? info('Historic conveyances filed and read; no restriction recorded (unreviewed)') : null),
  'PI-02-13': (v) => (v.present === true && v.triggered === true ? issue(`Overage/uplift clause declared and triggered by this development${v.amount ? ` (${v.amount})` : ''}`) : v.present === true ? info('Overage/uplift clause declared; not triggered on the facts given (unreviewed)') : v.present === false ? info('No overage declared (not independently verified)') : null),
  'PI-02-14': rights('service media right'),
  'PI-02-15': (v) => (v.interestsDeclared === true ? issue('Unregistered interests declared: conveyancer enquiries needed') : v.conveyancerEnquiriesComplete === true ? info('Client declarations on file and conveyancer enquiries complete (unreviewed)') : null),
  'PI-08-11': (v, list, a) => {
    const rate = v.infiltrationRateMmHr != null ? Number(v.infiltrationRateMmHr) : null, gw = v.groundwaterDepthM != null ? Number(v.groundwaterDepthM) : null;
    if (rate == null) return null;
    const ok = rate >= 3.6 && (gw == null || gw >= 1);
    return (ok ? info : issue)(`Infiltration ${rate} mm/h${gw != null ? `, groundwater ${gw} m below the base` : ''}: soakaway drainage is ${ok ? 'feasible on these results (1 x 10^-6 m/s or faster, with at least 1 m to groundwater; CIRIA C753 / BRE 365 style test)' : 'NOT feasible on these results - attenuation or a controlled discharge is needed'}.`);
  },
  'PI-10-17': (v) => { const f = ['gasMeter', 'electricMeter', 'waterStopTap', 'telecomsEntry'].filter((k) => v[k]); return f.length ? info(`Service entries recorded: ${f.map((k) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v[k]}`).join('; ')} (unreviewed)`) : null; },
  'PI-14-04': (v) => (v.loadbearingKnown === true ? info(`Load-bearing walls identified${v.engineerReportRef ? ` (engineer report ${v.engineerReportRef})` : ''} (unreviewed)`) : null),
  'PI-14-10': (v) => (v.surveyed === true ? info(`MEP survey on file${v.drawingRef ? ` (${v.drawingRef})` : ''}; routes recorded (unreviewed)`) : null),
  'PI-14-11': (v) => (['poor', 'unsafe'].includes(String(v.overallCondition).toLowerCase()) ? issue(`Condition survey records the building as ${v.overallCondition}${v.defectsRegisterRef ? ` (defects register ${v.defectsRegisterRef})` : ''}`) : v.overallCondition ? info(`Condition survey: ${v.overallCondition} (unreviewed)`) : null),
};
/** Reads the evidence-only checks, adding what the engine can say on its own where it can. */
const EVIDENCE_LIVE = {};
for (const id of ['PI-02-01', 'PI-02-05', 'PI-02-06', 'PI-02-07', 'PI-02-08', 'PI-02-09', 'PI-02-10', 'PI-02-11', 'PI-02-12', 'PI-02-13', 'PI-02-14', 'PI-02-15', 'PI-10-17', 'PI-14-10', 'PI-14-11']) EVIDENCE_LIVE[id] = (a) => fromEvidence(a, id, EVIDENCE[id]);
EVIDENCE_LIVE['PI-02-11'] = (a) => (evidenceOf(a, 'PI-02-11').length ? fromEvidence(a, 'PI-02-11', EVIDENCE['PI-02-11']) : awaiting(`No evidence on file. Never decided automatically. Needs: ${CHECK_BY_ID['PI-02-11'].evidence}`));
EVIDENCE_LIVE['PI-08-11'] = (a) => {
  const l = layer(a, 'bgs-groundwater-flood'), gw = l.r?.features?.[0];
  if (evidenceOf(a, 'PI-08-11').length) return fromEvidence(a, 'PI-08-11', EVIDENCE['PI-08-11']);
  if (gw && /surface|below/i.test(String(prop(gw, 'rating')))) return issue('Groundwater flooding potential is mapped here, which usually rules out soakaways - infiltration tests and a drainage concept are needed to confirm');
  return awaiting(`No infiltration test or drainage concept on file. Needs: ${CHECK_BY_ID['PI-08-11'].evidence}`);
};
EVIDENCE_LIVE['PI-14-04'] = (a) => {
  const t = ['rear_extension', 'wraparound_extension', 'side_extension', 'additional_storey'].includes(ptype(a)) ? ' The work opens up or loads existing walls, so a structural engineer is normally needed.' : '';
  return evidenceOf(a, 'PI-14-04').length ? fromEvidence(a, 'PI-14-04', EVIDENCE['PI-14-04']) : awaiting(`No structural survey on file.${t} Needs: ${CHECK_BY_ID['PI-14-04'].evidence}`);
};
EVIDENCE_LIVE['PI-14-07'] = (a) => {
  const f = a.interior?.checks?.some?.((c) => /escape|fire/.test(c.id));
  if (evidenceOf(a, 'PI-14-07').length) return fromEvidence(a, 'PI-14-07', (v) => (v.fireStrategyAvailable === true ? info('Fire strategy / compartment layout on file (unreviewed)') : null));
  return f ? issue('Fire-protection advice has been raised for new upper-floor rooms (Approved Document B). A fire strategy and compartment layout are needed; none is on file') : awaiting(`No fire strategy on file. Needs: ${CHECK_BY_ID['PI-14-07'].evidence}`);
};
EVIDENCE_LIVE['PI-12-07'] = (a) => {
  const v = evVals(a, 'PI-12-07'), s = String(v.roostSuitability ?? '').toLowerCase();
  if (['moderate', 'high', 'confirmed'].includes(s)) return tagged(issue(`Bat roost suitability recorded as ${s}: activity surveys (in season) and likely a licence are needed before roof work`), a, 'PI-12-07');
  if (s) return tagged(info(`Bat roost suitability recorded as ${s} (unreviewed)`), a, 'PI-12-07');
  return isRoofWork(a) ? awaiting('Roof/loft work is proposed and no roost suitability assessment is on file - a preliminary roost assessment by a licensed ecologist is advised (see PI-12-13 for the triggers)') : awaiting(`No bat survey on file. Needs: ${CHECK_BY_ID['PI-12-07'].evidence}`);
};
EVIDENCE_LIVE['PI-12-08'] = (a) => {
  const v = evVals(a, 'PI-12-08'), d = v.plannedStart ? parseDay(v.plannedStart) : null;
  if (d == null) return awaiting('Needs the planned start date of the work. Birds nest from about March to August; roof, hedge and tree work in that period needs a survey (Wildlife and Countryside Act 1981)');
  const m = new Date(d).getUTCMonth() + 1, inSeason = m >= 3 && m <= 8;
  return tagged(inSeason ? issue(`Work is planned to start ${v.plannedStart}, inside the main nesting season (March to August): a check for nests before work, and avoidance of active nests, is required`) : info(`Work is planned to start ${v.plannedStart}, outside the main nesting season; birds can still nest early or late, so check before clearing vegetation`), a, 'PI-12-08');
};
EVIDENCE_LIVE['PI-09-15'] = (a) => {
  const l = layer(a, 'bgs-shrink-swell'), tr = (a.map?.siteChecks?.trees ?? []).filter((t) => t.distanceM != null && t.distanceM <= 15), n = tr.length;
  const band = l.r?.features?.find((f) => f.inside), rank = band ? rankOf(DATASET_BY_KEY['bgs-shrink-swell'], prop(band, 'rating')) : -1;
  if (evidenceOf(a, 'PI-09-15').length) return fromEvidence(a, 'PI-09-15');
  if (l.missing && !n) return awaiting(`${l.missing}. No foundation drawings or soils evidence either`);
  if (rank >= 2 && n) return issue(`Shrink-swell clay is rated ${String(prop(band, 'rating')).toUpperCase()} (C to E) and ${n} mapped tree(s) are within 15 m of the work: foundations need design for clay and tree influence (NHBC Standards, building near trees). Foundation drawings and soils data are needed`);
  if (rank >= 2) return info(`Shrink-swell clay is rated ${String(prop(band, 'rating')).toUpperCase()}; no mapped tree within 15 m, but OSM tree coverage is incomplete. Foundation depth should be checked`);
  if (l.missing) return info(`${n} mapped tree(s) within 15 m of the work; shrink-swell data is not loaded, so foundation sensitivity cannot be rated`);
  return n ? info(`Low shrink-swell rating but ${n} tree(s) within 15 m: check tree influence on foundations`) : pass('Shrink-swell rating is low (A or B) and no mapped tree is within 15 m (screening only)');
};
EVIDENCE_LIVE['PI-04-15'] = (a) => {
  const v = evVals(a, 'PI-04-15'), fp = a.footprint?.areaM2;
  if (!evidenceOf(a, 'PI-04-15').length) return awaiting(`No approved plans on file. Needs: ${CHECK_BY_ID['PI-04-15'].evidence}`);
  if (v.approvedFootprintM2 == null) return fromEvidence(a, 'PI-04-15');
  if (!fp) return info(`Approved footprint ${v.approvedFootprintM2} m² recorded, but there is no measured/mapped footprint to compare with`);
  const diff = (fp - Number(v.approvedFootprintM2)) / Number(v.approvedFootprintM2);
  return tagged((Math.abs(diff) > 0.15 ? issue : pass)(`Existing footprint ${Math.round(fp)} m² (map outline) vs ${v.approvedFootprintM2} m² on the approved plans: ${Math.abs(Math.round(diff * 100))}% ${diff > 0 ? 'larger' : 'smaller'} (tolerance 15%; the map outline is not a survey)`), a, 'PI-04-15');
};

// ------------------------------------------------------------------------------------------------------------------------------ layers
const worstBand = (def, r) => { const f = (r.features ?? []).filter((x) => x.inside).sort((x, y) => rankOf(def, prop(y, def.ratingProp)) - rankOf(def, prop(x, def.ratingProp)))[0]; return f ? { f, band: String(prop(f, def.ratingProp)), rank: rankOf(def, prop(f, def.ratingProp)) } : null; };
const recs = (r, pred) => hits(r, pred);
const list = (fs, n = 3) => fs.slice(0, n).map(feat).join('; ');
const status = (s) => String(s ?? '').toLowerCase();

const LAYER_LIVE = {
  'PI-04-08': over(['pins-appeals'], ({ 'pins-appeals': r }) => { const f = recs(r); if (!f.length) return NONE('appeal decisions near the site', r); const dis = f.filter((x) => /dismiss/i.test(String(prop(x, 'decision')))); const pcBasis = f.some((x) => prop(x, 'locationBasis') === 'postcode'); return (dis.length ? issue : info)(`${f.length} appeal decision(s) at or near the site${dis.length ? `, ${dis.length} dismissed` : ''}: ${list(f.map((x) => ({ ...x, name: `${prop(x, 'appealRef') ?? x.ref ?? 'appeal'} ${prop(x, 'decision') ?? ''}${prop(x, 'decidedOn') ? ` ${prop(x, 'decidedOn')}` : ''}`.trim() })))} (${src(r)}). ${pcBasis ? 'Appeals are placed at their postcode centre, so they may be a few doors away or at a neighbour: check the address in the decision. ' : ''}Read the decision notice and its plans; only decisions of the last 5 years carry an address.`); }),
  'PI-08-02': over(['ea-rofsw'], ({ 'ea-rofsw': r }) => { const w = worstBand(DATASET_BY_KEY['ea-rofsw'], r); if (!w) return pass(`Outside the mapped surface-water flood extents (${src(r)}); screening map, not a site study`); return (w.rank >= 2 ? issue : info)(`${w.band} risk of flooding from surface water (${src(r)}). Screening map classification - it does not replace a site flood risk assessment.`); }),
  'PI-08-03': over(['ea-historic-flood'], ({ 'ea-historic-flood': r }) => { const i = hits(r).filter((f) => f.inside); if (i.length) return issue(`Inside a recorded historic flood outline (${i.map((f) => prop(f, 'startDate') ?? f.name ?? 'undated').slice(0, 3).join(', ')}; ${src(r)}). Ask the owner and the council for incident records.`); return r.status === 'near' ? info(`A recorded flood outline lies ${r.features[0].distanceM} m away (${src(r)})`) : NONE('recorded flood outline at the site', r); }),
  'PI-08-05': over(['ea-reservoir-flood'], ({ 'ea-reservoir-flood': r }) => (r.status === 'inside' ? issue(`Inside a reservoir flood extent${prop(r.features[0], 'scenario') ? ` (${prop(r.features[0], 'scenario')})` : ''} (${src(r)}). Reservoir flooding is rare; the extent shows the worst case for a dam failure.`) : pass(`Outside the mapped reservoir flood extents (${src(r)})`))),
  'PI-08-06': over(['ea-flood-defences'], ({ 'ea-flood-defences': r }) => { const f = hits(r); if (!f.length) return NONE('flood defence asset within 250 m', r); const poor = f.some((x) => /poor|very poor/i.test(String(prop(x, 'condition')))); return (poor ? issue : info)(`${f.length} flood defence asset(s) within ${r.nearM} m: ${list(f.map((x) => ({ ...x, name: prop(x, 'type') ?? x.name })))}${poor ? ' - one is recorded in poor condition' : ''} (${src(r)})`); }),
  'PI-08-07': over(['ea-main-river'], ({ 'ea-main-river': r }) => { const f = hits(r)[0]; if (!f) return NONE('main river within 50 m', r); const lim = prop(f, 'tidal') === true ? 16 : 8; return f.distanceM <= lim ? issue(`Main river ${f.distanceM} m away ${where(r)} - within ${lim} m: an Environment Agency flood risk activity permit is needed for work in, over, under or within ${lim} m of the river bank (8 m; 16 m if tidal). Distance is to the mapped centreline, so check the bank. (${src(r)})`) : info(`Main river ${f.distanceM} m away ${where(r)} (the permit zone is ${lim} m from the bank) (${src(r)})`); }),
  'PI-08-15': over(['ea-climate-allowance'], ({ 'ea-climate-allowance': r }) => { const f = r.features?.[0]; if (!f) return info(`Outside the loaded management catchments (${src(r)})`); const nums = Object.entries(f.props ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}%`).join(', '); return info(`Management catchment ${f.name ?? f.ref ?? ''}: ${nums || 'allowance values not in the data loaded'} (${src(r)}). Use the current Environment Agency allowances in the site flood risk assessment.`); }),
  'PI-10-14': over(['ofcom-broadband'], ({ 'ofcom-broadband': r }) => { const f = r.features?.[0]; if (!f) return info(`No record for this postcode in the loaded Ofcom data (${src(r)})`); const keep = Object.entries(f.props ?? {}).filter(([k]) => /gigabit|full.?fibre|fttp|superfast|sfbb|ufbb|>=?\s*300/i.test(k)).slice(0, 4).map(([k, v]) => `${k}: ${v}`); return info(`Postcode ${a_pc(f)}: ${keep.length ? keep.join('; ') : 'record found'} (${src(r)}). Ofcom figures are the share of premises in the postcode that can get the service, not a promise for this address: check with the operator`); }),
  'PI-10-15': over(['heat-networks'], ({ 'heat-networks': r }) => { const z = r.features?.find((f) => f.inside && f.props?.heatNetworkRef == null); if (z) return info(`Inside a heat network zone${prop(z, 'operator') ? ` (${prop(z, 'operator')})` : ''}: local policy may require connection or a connection-ready design (${src(r)})`); const f = hits(r); if (!f.length) return NONE(`heat network project within ${r.nearM} m (the database lists projects, not zones)`, r); return info(`${f.length} heat network project(s) within ${r.nearM} m: ${list(f.map((x) => ({ ...x, name: `${prop(x, 'siteName') ?? x.name ?? 'project'}${prop(x, 'operator') ? `, ${prop(x, 'operator')}` : ''}${prop(x, 'status') ? ` (${prop(x, 'status')})` : ''}` })), 3)} (${src(r)}). Policy may ask for a connection or a connection-ready design: ask the council and the operator`); }),
  'PI-13-01': over(['aqma'], ({ aqma: r }) => (r.status === 'inside' ? issue(`Inside an Air Quality Management Area${prop(r.features[0], 'pollutant') ? ` (${prop(r.features[0], 'pollutant')})` : ''}: an air quality assessment or mitigation may be asked for, mainly for new homes and larger schemes (${src(r)})`) : r.status === 'near' ? info(`An Air Quality Management Area lies ${r.features[0].distanceM} m away (${src(r)})`) : NONE('Air Quality Management Area at the site', r))),
  'PI-13-02': over(['noise-strategic'], ({ 'noise-strategic': r }) => { const v = Math.max(0, ...hits(r).filter((f) => f.inside).map((f) => Number(prop(f, 'lden')) || 0)); if (v >= 65) return issue(`Strategic noise level about ${v} dB Lden: an acoustic assessment is advisable for new habitable rooms (${src(r)}; mapped sources only)`); if (v >= 55) return info(`Strategic noise level about ${v} dB Lden (${src(r)}); mapped road/rail/industry sources only`); return pass(`Below 55 dB Lden or outside the mapped noise contours (${src(r)}); local sources such as pubs and plant are not in this map`); }),
  'PI-13-05': over(['comah-sites'], ({ 'comah-sites': r }) => { const i = hits(r).find((f) => f.inside); if (i) return issue(`Inside the HSE consultation zone of ${i.name ?? 'a hazardous installation'}: the council must consult the HSE on planning applications here (${src(r)})`); const n = hits(r)[0]; return n ? info(`Nearest hazardous installation: ${feat(n)} (${src(r)})`) : NONE('hazardous installation within 1 km', r); }),
  'PI-13-09': over(['night-lights'], ({ 'night-lights': r }) => { const f = r.features?.[0]; return info(f ? `Night-time light level: ${prop(f, 'band') ?? 'recorded'} (${src(r)}). Relevant to external lighting and dark-sky policy.` : `No night-light band for this location in the loaded data (${src(r)})`); }),
  'PI-13-10': over(['heat-stress'], ({ 'heat-stress': r }) => { const w = worstBand(DATASET_BY_KEY['heat-stress'], r); if (!w) return info(`No overheating-risk band for this location (${src(r)})`); return (w.rank >= 2 ? issue : w.rank === 1 ? info : pass)(`Overheating risk: ${w.band} (${src(r)}). Orientation, glazing and ventilation of new rooms matter (Building Regulations Part O).`); }),
  'PI-13-11': over(['env-permits'], ({ 'env-permits': r }) => { const f = hits(r); return f.length ? info(`${f.length} environmental permit(s) within ${r.nearM} m: ${list(f.map((x) => ({ ...x, name: `${prop(x, 'permitType') ?? ''} ${prop(x, 'operator') ?? x.name ?? ''}`.trim() })))} (${src(r)})`) : NONE('permitted site within 250 m', r); }),
  'PI-16-03': over(['infrastructure-projects'], ({ 'infrastructure-projects': r }) => { const f = hits(r), i = f.filter((x) => x.inside); if (i.length) return issue(`Inside the boundary/safeguarding area of ${i.map((x) => x.name ?? x.ref).slice(0, 2).join(', ')} (${src(r)}): the scheme promoter may need to be consulted`); return f.length ? info(`${f.length} infrastructure scheme(s) within ${r.nearM} m: ${list(f)} (${src(r)})`) : NONE('infrastructure scheme within 500 m', r); }),
  // ---- council data
  'PI-04-04': over(['council-conditions'], ({ 'council-conditions': r }) => { const f = recs(r); if (!f.length) return pass(`No condition records for this address in the loaded council register (${src(r)}); limited to that register`); const open = f.filter((x) => !/discharged/i.test(status(prop(x, 'status'))) || /part/i.test(status(prop(x, 'status')))); return open.length ? issue(`${open.length} of ${f.length} planning condition(s) not recorded as fully discharged: ${open.slice(0, 3).map((x) => `${prop(x, 'appRef') ?? ''} ${String(prop(x, 'condition') ?? '').slice(0, 70)} (${prop(x, 'status') ?? 'status unknown'})`).join('; ')} (${src(r)})`) : pass(`All ${f.length} recorded condition(s) are discharged (${src(r)}); check the decision notices for conditions not in the register`); }),
  'PI-04-05': over(['council-enforcement'], ({ 'council-enforcement': r }) => { const f = recs(r), live = f.filter((x) => /live|served|open|appeal/i.test(status(prop(x, 'status')))); if (live.length) return issue(`${live.length} live enforcement notice(s) at or near the address: ${live.slice(0, 2).map((x) => `${prop(x, 'noticeType') ?? 'notice'} issued ${prop(x, 'issuedOn') ?? '?'}`).join('; ')} (${src(r)}). A notice can bind later owners.`); return f.length ? info(`${f.length} past enforcement record(s), none live (${src(r)})`) : pass(`No enforcement notice recorded at this address in the loaded register (${src(r)}); limited to that register`); }),
  'PI-04-10': over(['council-obligations'], ({ 'council-obligations': r }) => { const f = recs(r); return f.length ? issue(`${f.length} planning obligation(s) recorded: ${list(f.map((x) => ({ ...x, name: `${prop(x, 'type') ?? 'obligation'} ${prop(x, 'dated') ?? ''}`.trim() })))}. The obligations bind the land: read the deed and any title entry (${src(r)}).`) : pass(`No planning obligation recorded at this address in the loaded register (${src(r)}); limited to that register`); }),
  'PI-04-11': over(['council-obligations'], ({ 'council-obligations': r }) => { const f = recs(r, (p) => /106/.test(String(p.type ?? ''))); return f.length ? issue(`${f.length} Section 106 agreement(s) recorded${prop(f[0], 'dated') ? `, latest dated ${prop(f[0], 'dated')}` : ''}${prop(f[0], 'status') ? ` (${prop(f[0], 'status')})` : ''}. Check for variation or discharge deeds (${src(r)}).`) : pass(`No Section 106 agreement recorded at this address in the loaded register (${src(r)}); limited to that register`); }),
  'PI-04-13': over(['council-commencements'], ({ 'council-commencements': r }) => { const f = recs(r); if (!f.length) return info(`No commencement or building-control start record for this address in the loaded data (${src(r)}); this does not show that work did not start`); const x = f[0]; return info(`Commenced ${prop(x, 'commencedOn') ?? 'date not recorded'}${prop(x, 'completedOn') ? `, completed ${prop(x, 'completedOn')}` : ', no completion recorded'} (${src(r)}). A permission that was not implemented in time may have lapsed.`); }),
  'PI-04-14': over(['council-conditions'], ({ 'council-conditions': r }) => { const f = recs(r); if (!f.length) return info(`No condition-monitoring records for this address in the loaded register (${src(r)})`); const bad = f.filter((x) => /breach|non-?compl|not complied/i.test(status(prop(x, 'status')))), pend = f.filter((x) => /pending|outstanding/i.test(status(prop(x, 'status')))); return bad.length ? issue(`${bad.length} condition(s) recorded as breached / not complied with (${src(r)})`) : pend.length ? issue(`${pend.length} condition(s) still outstanding - compliance cannot be shown yet (${src(r)})`) : pass(`No breach or outstanding condition recorded among ${f.length} (${src(r)}); evidence of compliance (certificates, correspondence) is still needed to prove it`); }),
  'PI-07-05': over(['local-list'], ({ 'local-list': r }) => (r.status === 'inside' ? issue(`On or part of a locally listed (non-designated) heritage asset: ${r.features[0].name ?? r.features[0].ref ?? ''}. Its significance is a material consideration (${src(r)}).`) : r.status === 'near' ? info(`A locally listed asset lies ${r.features[0].distanceM} m away (${src(r)}): its setting may be relevant`) : NONE('locally listed asset at or near the site', r))),
  'PI-07-06': over(['archaeological-priority'], ({ 'archaeological-priority': r }) => (r.status === 'inside' ? issue(`Inside an archaeological priority area${prop(r.features[0], 'tier') ? ` (tier ${prop(r.features[0], 'tier')})` : ''}: groundworks may need an archaeological desk-based assessment or watching brief (${src(r)})`) : r.status === 'near' ? info(`An archaeological priority area lies ${r.features[0].distanceM} m away (${src(r)})`) : NONE('archaeological priority area at the site', r))),
  'PI-07-08': over(['protected-views'], ({ 'protected-views': r }) => (r.status === 'inside' ? issue(`Inside a protected view corridor${prop(r.features[0], 'viewName') ? ` (${prop(r.features[0], 'viewName')})` : ''}${prop(r.features[0], 'heightLimitM') ? `, height limit ${prop(r.features[0], 'heightLimitM')} m` : ''}: compare the proposed height with the policy (${src(r)})`) : pass(`Not inside a mapped protected view corridor (${src(r)}); limited to the corridors loaded`))),
  'PI-08-08': over(['ordinary-watercourse'], ({ 'ordinary-watercourse': r }) => { const f = hits(r)[0]; if (!f) return NONE('ordinary watercourse within 30 m', r); return f.distanceM <= 8 ? issue(`Ordinary watercourse ${f.distanceM} m away ${where(r)}${prop(f, 'culverted') === true ? ' (culverted)' : ''}: land drainage consent from the Lead Local Flood Authority may be needed for work in, over or near it (byelaw distances are typically 3 to 9 m) (${src(r)})`) : info(`Ordinary watercourse ${f.distanceM} m away ${where(r)} (${src(r)})`); }),
  'PI-11-11': over(['traffic-orders'], ({ 'traffic-orders': r }) => { const f = hits(r); return f.length ? info(`${list(f.map((x) => ({ ...x, name: `${prop(x, 'type') ?? 'order'}${prop(x, 'hours') ? ` ${prop(x, 'hours')}` : ''}` })), 4)} (${src(r)}). Affects construction parking and any new access.`) : NONE('traffic order or controlled parking zone at the site', r); }),
  'PI-11-12': over(['highway-adoption'], ({ 'highway-adoption': r }) => (r.status === 'inside' ? issue(`On or overlapping the adopted highway${prop(r.features[0], 'street') ? ` (${prop(r.features[0], 'street')})` : ''}: the highway authority controls this land, and work on it needs its consent (${src(r)})`) : r.status === 'near' ? info(`Adopted highway ${r.features[0].distanceM} m from the site ${where(r)} (${src(r)})`) : pass(`Clear of the adopted highway extent loaded (${src(r)}); a title/dedication check is still needed for the exact boundary`))),
  'PI-11-13': over(['street-works-restrictions'], ({ 'street-works-restrictions': r }) => { const f = hits(r); return f.length ? issue(`Street-works restriction at or near the frontage: ${list(f.map((x) => ({ ...x, name: prop(x, 'restriction') ?? x.name })))} (${src(r)}). Check before any road opening or crossover.`) : NONE('street-works restriction at the frontage', r); }),
  'PI-12-06': over(['species-records'], ({ 'species-records': r }) => { const f = hits(r, (p) => p.protected !== false); return f.length ? issue(`${f.length} protected-species record(s) within ${r.nearM} m: ${[...new Set(f.map((x) => prop(x, 'species') ?? x.name).filter(Boolean))].slice(0, 5).join(', ')} (${src(r)}). A preliminary ecological appraisal is advised.`) : pass(`No protected-species record within ${r.nearM} m (${src(r)}); the absence of records is not the absence of species`); }),
  'PI-13-03': over(['contaminated-land'], ({ 'contaminated-land': r }) => (r.status === 'inside' ? issue(`On or inside a recorded contaminated / potentially contaminated site${prop(r.features[0], 'status') ? ` (${prop(r.features[0], 'status')})` : ''}: a ground contamination assessment is normally conditioned (${src(r)})`) : r.status === 'near' ? info(`A recorded contaminated-land site lies ${r.features[0].distanceM} m away (${src(r)})`) : NONE('contaminated-land record at the site', r))),
  'PI-15-02': (a) => { const l = layer(a, 'hmo-register'); const base = England(a) ? 'Mandatory HMO licensing applies in England to a home let to 5 or more people from 2 or more households' : 'HMO licensing in Wales is run through Rent Smart Wales and the local authority'; if (l.missing) return info(`${base}. ${l.missing}`); return l.r.status === 'inside' ? issue(`Listed on the council's HMO licence register${prop(l.r.features[0], 'maxOccupants') ? ` (up to ${prop(l.r.features[0], 'maxOccupants')} occupants)` : ''} (${src(l.r)})`) : info(`${base}. Not on the loaded HMO licence register (${src(l.r)}).`); },
  'PI-15-03': over(['licensing-additional'], ({ 'licensing-additional': r }) => { const f = hits(r).filter((x) => x.inside); return f.length ? issue(`Inside the council's additional HMO licensing designation${prop(f[0], 'effectiveFrom') ? ` (from ${prop(f[0], 'effectiveFrom')}${prop(f[0], 'effectiveTo') ? ` to ${prop(f[0], 'effectiveTo')}` : ''})` : ''} (${src(r)})`) : NONE('additional licensing designation at the site', r); }),
  'PI-15-04': over(['licensing-selective'], ({ 'licensing-selective': r }) => { const f = hits(r).filter((x) => x.inside); return f.length ? issue(`Inside the council's selective licensing designation${prop(f[0], 'effectiveFrom') ? ` (from ${prop(f[0], 'effectiveFrom')}${prop(f[0], 'effectiveTo') ? ` to ${prop(f[0], 'effectiveTo')}` : ''})` : ''}${prop(f[0], 'exemptions') ? `; exemptions: ${prop(f[0], 'exemptions')}` : ''} (${src(r)})`) : NONE('selective licensing designation at the site', r); }),
  // ---- licensed / utility data
  'PI-08-04': over(['bgs-groundwater-flood'], ({ 'bgs-groundwater-flood': r }) => { const w = worstBand(DATASET_BY_KEY['bgs-groundwater-flood'], r); if (!w) return pass(`Outside the mapped groundwater-flooding susceptibility areas (${src(r)})`); return (w.rank >= 1 ? issue : info)(`Groundwater flooding susceptibility: ${w.band} (${src(r)}). Basements and soakaways are the usual concern; a ground investigation settles it.`); }),
  'PI-08-09': over(['water-capacity'], ({ 'water-capacity': r }) => { const f = r.features?.[0]; if (!f) return info(`No capacity record for this location (${src(r)})`); const s = status(prop(f, 'capacityStatus')); return (/constrain|upgrade|limited|no capacity/.test(s) ? issue : /avail/.test(s) ? pass : info)(`Drainage/water network capacity: ${prop(f, 'capacityStatus') ?? 'recorded'}${prop(f, 'catchment') ? ` (${prop(f, 'catchment')})` : ''} (${src(r)}). The water company's own capacity check is still needed for new connections.`); }),
  'PI-08-10': over(['sewers'], ({ sewers: r }) => { const f = hits(r)[0]; if (!f) return NONE('public sewer within 30 m', r); return f.distanceM <= 3 ? issue(`Public sewer ${f.distanceM === 0 ? 'under or touching the building outline' : `${f.distanceM} m from the building outline`}${prop(f, 'diameterMm') ? ` (${prop(f, 'diameterMm')} mm ${prop(f, 'type') ?? ''})` : ''}: building over or within 3 m of a public sewer needs the sewerage undertaker's agreement (${src(r)})`) : info(`Nearest public sewer ${f.distanceM} m away ${where(r)} (${src(r)}); the 3 m build-over rule is not triggered on this map, but sewer records omit private sewers and lateral drains`); }),
  'PI-08-14': over(['drainage-easements'], ({ 'drainage-easements': r }) => { const f = hits(r)[0]; if (!f) return NONE('drainage easement within 10 m', r); return (f.inside || f.distanceM === 0 ? issue : info)(`Drainage easement ${f.inside || f.distanceM === 0 ? 'overlaps the building outline' : `${f.distanceM} m away`}${prop(f, 'deedRef') ? ` (deed ${prop(f, 'deedRef')})` : ''} (${src(r)}). Building over an easement needs the benefiting party's consent.`); }),
  'PI-09-07': over(['bgs-shrink-swell'], ({ 'bgs-shrink-swell': r }) => { const w = worstBand(DATASET_BY_KEY['bgs-shrink-swell'], r); if (!w) return info(`No shrink-swell rating for this location (${src(r)})`); return (w.rank >= 3 ? issue : w.rank === 2 ? info : pass)(`Shrink-swell clay hazard ${w.band.toUpperCase()} on a scale of A (lowest) to E (highest) (${src(r)}). ${w.rank >= 2 ? 'Foundation depth and nearby trees matter (see PI-09-15).' : 'Low hazard; screening only.'}`); }),
  'PI-09-08': over(['bgs-faults'], ({ 'bgs-faults': r }) => { const f = hits(r)[0]; return f ? info(`Mapped geological fault ${f.distanceM} m away${prop(f, 'name') ? ` (${prop(f, 'name')})` : ''} (${src(r)}): relevant to mining subsidence and foundations only if other ground hazards are present`) : NONE('mapped geological fault within 100 m', r); }),
  'PI-09-09': over(['bgs-landslide'], ({ 'bgs-landslide': r }) => { const w = worstBand(DATASET_BY_KEY['bgs-landslide'], r); if (!w) return info(`No landslide rating for this location (${src(r)})`); return (w.rank >= 2 ? issue : w.rank === 1 ? info : pass)(`Landslide hazard ${w.band.toUpperCase()} on a scale of A (lowest) to E (highest) (${src(r)}). ${w.rank >= 2 ? 'A slope stability assessment is advisable.' : ''}`.trim()); }),
  'PI-09-10': over(['radon'], ({ radon: r }) => { const p = Math.max(0, ...hits(r).filter((f) => f.inside).map((f) => Number(prop(f, 'percent')) || 0)); if (p >= 10) return issue(`Radon: ${p}% or more of homes here exceed the action level - full radon protection is required in new construction (BRE 211) (${src(r)})`); if (p >= 3) return issue(`Radon: ${p}% of homes here exceed the action level - basic radon protection is required in new construction (BRE 211) (${src(r)})`); return pass(`Radon potential below the 3% level at which protection is required in new buildings (${src(r)})`); }),
  'PI-10-02': over(['dno-cables'], ({ 'dno-cables': r }) => { const f = hits(r)[0]; return f ? issue(`Underground electricity cable ${f.distanceM === 0 ? 'under the building outline' : `${f.distanceM} m from the building outline`}${prop(f, 'voltage') ? ` (${prop(f, 'voltage')})` : ''}: locate it by survey before digging (HSG47). Record plans are indicative (${src(r)}).`) : NONE('DNO cable within 10 m', r); }),
  'PI-10-04': over(['dno-easements'], ({ 'dno-easements': r }) => { const f = hits(r)[0]; return f ? issue(`DNO easement/wayleave ${f.inside || f.distanceM === 0 ? 'overlaps the building outline' : `${f.distanceM} m away`}${prop(f, 'deedRef') ? ` (deed ${prop(f, 'deedRef')})` : ''}: building over it needs the operator's consent (${src(r)})`) : NONE('DNO easement within 10 m', r); }),
  'PI-10-09': over(['gas-mains'], ({ 'gas-mains': r }) => { const f = hits(r)[0]; return f ? issue(`Gas main ${f.distanceM === 0 ? 'under the building outline' : `${f.distanceM} m from the building outline`}${prop(f, 'pressure') ? ` (${prop(f, 'pressure')})` : ''}: consult the gas network operator before work; building over or close to a main is restricted (${src(r)})`) : NONE('gas main within 10 m', r); }),
  'PI-10-10': over(['water-mains'], ({ 'water-mains': r }) => { const f = hits(r)[0]; return f ? issue(`Water main ${f.distanceM === 0 ? 'under the building outline' : `${f.distanceM} m from the building outline`}${prop(f, 'diameterMm') ? ` (${prop(f, 'diameterMm')} mm)` : ''}: the water company's consent or a diversion may be needed (${src(r)})`) : NONE('water main within 10 m', r); }),
  'PI-10-11': over(['sewers'], ({ sewers: r }) => { const f = hits(r, (p) => /surface|combined/i.test(String(p.type)))[0]; if (!f) return NONE('public surface-water or combined sewer within 30 m', r); return f.distanceM <= 3 ? issue(`Surface-water/combined sewer ${f.distanceM} m from the building outline: agreement with the sewerage undertaker needed (${src(r)})`) : info(`Nearest surface-water/combined sewer ${f.distanceM} m away (${src(r)}); CCTV survey if connecting`); }),
  'PI-10-12': over(['sewers'], ({ sewers: r }) => { const f = hits(r, (p) => /foul|combined/i.test(String(p.type)))[0]; if (!f) return NONE('public foul or combined sewer within 30 m', r); return f.distanceM <= 3 ? issue(`Foul/combined sewer ${f.distanceM} m from the building outline: agreement with the sewerage undertaker needed (${src(r)})`) : info(`Nearest foul/combined sewer ${f.distanceM} m away (${src(r)})`); }),
  'PI-10-13': over(['telecom-ducts'], ({ 'telecom-ducts': r }) => { const f = hits(r)[0]; return f ? info(`Telecoms duct/cable ${f.distanceM} m away${prop(f, 'operator') ? ` (${prop(f, 'operator')})` : ''}: locate before digging (${src(r)})`) : NONE('telecoms duct within 10 m', r); }),
  'PI-10-16': over(['utility-wayleaves'], ({ 'utility-wayleaves': r }) => { const f = hits(r)[0]; return f ? issue(`Utility wayleave${prop(f, 'operator') ? ` (${prop(f, 'operator')})` : ''} ${f.inside || f.distanceM === 0 ? 'overlaps the building outline' : `${f.distanceM} m away`}: the operator's rights bind the land - read the agreement (${src(r)})`) : NONE('utility wayleave within 10 m', r); }),
  'PI-13-04': over(['historic-industrial'], ({ 'historic-industrial': r }) => (r.status === 'inside' ? issue(`Historic industrial use recorded on the site${prop(r.features[0], 'use') ? ` (${prop(r.features[0], 'use')}${prop(r.features[0], 'era') ? `, ${prop(r.features[0], 'era')}` : ''})` : ''}: possible contamination - a desk study is advisable (${src(r)})`) : r.status === 'near' ? info(`Historic industrial use ${r.features[0].distanceM} m away (${src(r)})`) : NONE('historic industrial use at the site', r))),
};
function a_pc(f) { return f.key ?? f.ref ?? ''; }

// OSM extras (live Overpass)
const EXTRAS_LIVE = {
  'PI-10-03': (a) => { const e = a.extras; if (!e) return awaiting('Substations were not looked up (OpenStreetMap extras off or failed)'); const s = e.substations ?? []; return s.length ? info(`${s.length} electricity substation(s) mapped within ${e.substationRadiusM} m: nearest ${s[0].distanceM} m${s[0].voltage ? ` (${s[0].voltage} V)` : ''}${s[0].operator ? `, ${s[0].operator}` : ''}. OpenStreetMap, not a DNO asset record: ask the DNO for its asset plan and access rights.`) : info(`No substation mapped within ${e.substationRadiusM} m (OpenStreetMap coverage is incomplete; not a DNO record)`); },
  'PI-11-03': (a) => { const e = a.extras; if (!e) return awaiting('Traffic signals were not looked up (OpenStreetMap extras off or failed)'); const s = e.signals ?? []; return s.length ? info(`${s.length} traffic signal(s)/signal crossing(s) mapped within ${e.signalRadiusM} m: nearest ${s[0].distanceM} m (${s[0].kind}). Signal heads and detector loops affect any new access or street works (OpenStreetMap).`) : info(`No traffic signals mapped within ${e.signalRadiusM} m (OpenStreetMap coverage is incomplete)`); },
};

// ------------------------------------------------------------------------------------------------------------------------ open-data fallback
// FREE LIVE DATA (no loading): Environment Agency surface water / recorded flooding / reservoirs (providers/floodSources -> a.flood) and OpenStreetMap
// watercourses, substations, signals (providers/osmInfra -> a.infra). They answer ONLY when the matching dataset on YOUR server is not loaded: a loaded
// dataset is authoritative and always wins. Every reading names its source and keeps the caveat that these are screening indicators.
const OPEN_NOTE = ' (live open data, not a loaded dataset)';
const OPEN_LIVE = {
  'PI-08-02': (a) => {
    const sw = a.flood?.surfaceWater;
    if (!sw || sw.status !== 'ok') return null;
    const note = `Environment Agency open data${OPEN_NOTE}. Screening map: the EA says it is not for property-level decisions.`;
    if (sw.band === 'high' || sw.band === 'medium') return issue(`Surface water risk ${sw.text}. ${note}`);
    if (sw.band === 'low') return info(`Surface water risk ${sw.text}. ${note}`);
    return pass(`${sw.text}${sw.mapped ? '' : ' (not in a mapped extent)'}. ${note}`);
  },
  'PI-08-03': (a) => {
    const r = a.flood?.recorded;
    if (!r || r.status === 'unavailable') return null;
    const what = (r.events ?? []).map((e) => [e.source, e.start?.slice(0, 4)].filter(Boolean).join(' ')).filter(Boolean).slice(0, 3).join('; ');
    if (r.status === 'inside') return issue(`On land with a recorded past flood${what ? ` (${what})` : ''}. A recorded outline does not prove a property flooded. Environment Agency open data${OPEN_NOTE}.`);
    if (r.status === 'near') return issue(`Recorded past flooding within ${r.nearestM} m${what ? ` (${what})` : ''}. A recorded outline does not prove a property flooded. Environment Agency open data${OPEN_NOTE}.`);
    return pass(`No recorded flood outline within ${r.nearM} m (records are incomplete; Environment Agency open data${OPEN_NOTE})`);
  },
  'PI-08-05': (a) => {
    const r = a.flood?.reservoir;
    if (!r || r.status === 'unavailable') return null;
    if (r.status === 'inside') return issue(`Inside a reservoir flood extent (wet-day scenario). Reservoir failure is very unlikely but can be severe. Environment Agency open data${OPEN_NOTE}.`);
    if (r.status === 'near') return info(`A reservoir flood extent (wet-day scenario) lies ${r.nearestM} m away (Environment Agency open data${OPEN_NOTE})`);
    return pass(`Outside reservoir flood extents (wet-day scenario) within ${r.nearM} m (Environment Agency open data${OPEN_NOTE})`);
  },
  'PI-08-07': (a) => {
    const mr = a.layers?.mainRiver;
    if (mr && mr.status !== 'unavailable') {
      const r = mr.rivers?.[0];
      if (!r) return info(`No Environment Agency statutory main river within ${mr.nearM} m (Environment Agency open data${OPEN_NOTE}). The map is the designation, but a watercourse that is not on it can still need other consents.`);
      const lim = r.tidal ? 16 : 8;
      return r.distanceM <= lim ? issue(`Statutory main river${r.name ? ` ${r.name}` : ''} ${r.distanceM} m away (mapped centreline) - within ${lim} m: an Environment Agency flood risk activity permit is needed for work in, over, under or within ${lim} m of the bank (8 m; 16 m if tidal). Check the bank, not the centreline. (Environment Agency open data${OPEN_NOTE})`) : info(`Statutory main river${r.name ? ` ${r.name}` : ''} ${r.distanceM} m away (the permit zone is ${lim} m from the bank; Environment Agency open data${OPEN_NOTE})`);
    }
    if (!a.infra) return null;
    const r = (a.infra.watercourses ?? []).filter((w) => w.kind === 'river');
    if (!r.length) return info('No river mapped within 150 m (OpenStreetMap). This is not the Environment Agency main-river designation: load "ea-main-river" for that.');
    const n = r[0];
    return n.distanceM <= 8 ? issue(`River${n.name ? ` ${n.name}` : ''} ${n.distanceM} m away: work within 8 m of a main river bank can need an Environment Agency permit. OpenStreetMap does not say whether it is a designated main river.`) : info(`River${n.name ? ` ${n.name}` : ''} ${n.distanceM} m away (OpenStreetMap; main-river status unknown)`);
  },
  'PI-08-06': (a) => {
    const d = a.layers?.defences;
    if (!d || d.status === 'unavailable') return null;
    if (!d.assets?.length) return pass(`No Environment Agency flood defence asset within ${d.nearM} m (Environment Agency open data${OPEN_NOTE}); the dataset covers assets the EA owns, manages or inspects, not private or council defences`);
    const poor = d.assets.some((x) => /poor|very poor|^[45]$/i.test(String(x.condition ?? '')));
    const desc = d.assets.slice(0, 3).map((x) => `${x.type ?? 'defence'} ${x.distanceM} m${x.standardOfProtection ? `, standard ${x.standardOfProtection}` : ''}${x.condition ? `, condition ${x.condition}` : ''}`).join('; ');
    return (poor ? issue : info)(`${d.count} flood defence asset(s) within ${d.nearM} m: ${desc}${poor ? ' - one is recorded in poor condition' : ''} (Environment Agency open data${OPEN_NOTE}). A defence reduces, but does not remove, flood risk.`);
  },
  'PI-13-01': (a) => {
    const q = a.layers?.aqma;
    if (!q || q.status === 'unavailable') return null;
    if (q.status === 'inside') { const n = q.areas[0]; return issue(`Inside an Air Quality Management Area${n?.name ? ` (${n.name}${n.reference ? `, Defra ref ${n.reference}` : ''})` : ''}: an air quality assessment or mitigation may be asked for, mainly for new homes and larger schemes${n?.url ? `. Details: ${n.url}` : ''} (Defra via planning.data.gov.uk${OPEN_NOTE})`); }
    return pass(`Not inside an Air Quality Management Area in the national dataset (Defra via planning.data.gov.uk${OPEN_NOTE}); the dataset is still being completed and a council may have declared or amended an area since, so a missing record is not proof`);
  },
  'PI-13-02': (a) => {
    const n = a.layers?.noise;
    if (!n || n.status === 'unavailable' || n.status === 'no_value') return null;
    const v = n.lden, how = `Defra strategic noise map, 2022, ${n.source}${n.sources?.length > 1 ? 's' : ''} (10 m cell${OPEN_NOTE}); modelled, not measured, and mapped road${n.sources?.some((s) => s.source === 'rail') ? '/rail' : ''} sources only`;
    if (v >= 65) return issue(`Strategic noise level about ${v} dB Lden: an acoustic assessment is advisable for new habitable rooms (${how})`);
    if (v >= 55) return info(`Strategic noise level about ${v} dB Lden (${how})`);
    return pass(`About ${v} dB Lden, below the 55 dB screening level (${how}); pubs, plant and other local sources are not in this map`);
  },
  'PI-08-08': (a) => {
    if (!a.infra) return null;
    const w = (a.infra.watercourses ?? []).filter((x) => x.kind !== 'river');
    if (!w.length) return info('No stream, ditch, drain or canal mapped within 150 m (OpenStreetMap is incomplete; the council register of ordinary watercourses is not loaded)');
    const n = w[0];
    return n.distanceM <= 8 ? issue(`${n.kind}${n.culverted ? ' (culverted)' : ''} ${n.distanceM} m away: works in or near an ordinary watercourse can need council consent. OpenStreetMap is incomplete.`) : info(`${n.kind}${n.culverted ? ' (culverted)' : ''} ${n.distanceM} m away (OpenStreetMap)`);
  },
};
for (const [id, open] of Object.entries(OPEN_LIVE)) {
  const loaded = LAYER_LIVE[id];
  LAYER_LIVE[id] = (a) => { const r = loaded(a); if (r.state !== 'awaiting') return r; const o = open(a); return o ?? r; };
}
// Substations and traffic signals: the dedicated Overpass lookup (a.extras) wins; the combined infrastructure lookup (a.infra) fills in when it is absent.
const EXTRAS_OPEN = {
  'PI-10-03': (a) => { const s = a.infra?.substations; if (!a.infra) return null; return s?.length ? info(`${s.length} electricity substation(s) mapped within 100 m, nearest ${s[0].distanceM} m${s[0].operator ? ` (${s[0].operator})` : ''}. OpenStreetMap, not a DNO asset record: ask the DNO for its asset plan.`) : info('No substation mapped within 100 m (OpenStreetMap coverage is incomplete; not a DNO record)'); },
  'PI-11-03': (a) => { const s = a.infra?.signals; if (!a.infra) return null; return s?.length ? info(`${s.length} set(s) of traffic signals mapped within 60 m, nearest ${s[0].distanceM} m (OpenStreetMap)`) : info('No traffic signals mapped within 60 m (OpenStreetMap coverage is incomplete)'); },
};
for (const [id, open] of Object.entries(EXTRAS_OPEN)) {
  const dedicated = EXTRAS_LIVE[id];
  EXTRAS_LIVE[id] = (a) => { if (a.extras) return dedicated(a); return open(a) ?? dedicated(a); };
}

// ------------------------------------------------------------------------------------------------------------------------ standards
const std = (a, topic) => a.geo?.standards?.[topic] ?? null;
const noStd = (a, topic) => awaiting(`No ${topic} standard is loaded for ${a.authority?.name ?? 'this authority'} - load it with: npm run import:geo -- --standards <file.json> --authority <code>`);
const beds = (a) => { const v = evVals(a, 'PI-06-09').bedrooms ?? evVals(a, 'PI-06-10').bedrooms; if (v != null) return { n: Number(v), basis: 'evidence' }; const i = a.interior?.totals?.bedroomsAfter; if (i != null) return { n: i, basis: 'the generated/drawn floor plan (not a survey)' }; if (a.epc?.habitableRooms) return { n: Math.max(1, a.epc.habitableRooms - 1), basis: `energy certificate (${a.epc.habitableRooms} habitable rooms, one assumed to be a living room)` }; return null; };
const STANDARDS_LIVE = {
  'PI-06-08': (a) => { const s = std(a, 'density'); if (!s) return noStd(a, 'density'); const d = s.data; return info(`${a.authority?.name} density policy: ${d.minDwellingsPerHa != null || d.maxDwellingsPerHa != null ? `${d.minDwellingsPerHa ?? '-'} to ${d.maxDwellingsPerHa ?? '-'} dwellings per hectare` : 'see the policy'}${d.notes ? `; ${d.notes}` : ''} (${s.source ?? 'council policy'}${s.retrievedOn ? `, retrieved ${s.retrievedOn}` : ''}). ${a.proposal?.usedAsHome ? 'The proposal creates a separate dwelling, so density applies.' : 'The work does not create a new dwelling, so density policy is not engaged unless the home is subdivided.'}`); },
  'PI-06-09': (a) => { const s = std(a, 'parking'); if (!s) return noStd(a, 'parking'); const b = beds(a), table = s.data.bedrooms ?? s.data.perDwelling ?? {}; const key = b ? String(Math.min(b.n, Math.max(...Object.keys(table).map(Number)))) : null; const need = key ? table[key] : null; const have = evVals(a, 'PI-06-09').proposedSpaces; const t = s.data.type === 'maximum' ? 'maximum' : 'minimum'; if (need == null) return info(`${a.authority?.name} parking standard loaded (${t} spaces by bedrooms: ${JSON.stringify(table)}) but the number of bedrooms is not known`); const r = `${b.n} bedroom(s) (from ${b.basis}) -> ${need} space(s) ${t} (${s.source ?? 'council standard'})`; if (have == null) return info(`${r}. The parking layout (spaces provided) is needed to compare.`); return ((t === 'minimum' ? Number(have) >= need : Number(have) <= need) ? pass : issue)(`${r}; ${have} provided`); },
  'PI-06-10': (a) => { const s = std(a, 'cycle'); if (!s) return noStd(a, 'cycle'); const b = beds(a), t = s.data.perDwelling; const need = typeof t === 'object' && b ? t[String(Math.min(b.n, Math.max(...Object.keys(t).map(Number))))] : typeof t === 'number' ? t : null; const have = evVals(a, 'PI-06-10').proposedSpaces; if (need == null) return info(`${a.authority?.name} cycle parking standard loaded (${JSON.stringify(t)}) but cannot be applied without the bedroom count`); const r = `Standard: ${need} secure cycle space(s) for this home (${s.source ?? 'council standard'})`; return have == null ? info(`${r}. The cycle storage plan is needed to compare.`) : (Number(have) >= need ? pass : issue)(`${r}; ${have} provided`); },
  'PI-06-11': (a) => { const s = std(a, 'suds'); if (!s) return noStd(a, 'suds'); const d = s.data, curt = a.map?.siteFacts?.curtilage; const fz = flags(a).floodZone; return info(`${a.authority?.name} SuDS policy: ${d.policy ?? 'see the policy'}${d.requiresSudsFor ? `; applies to ${d.requiresSudsFor} development` : ''}${d.greenfieldRunoffRequired ? '; greenfield run-off rates expected' : ''} (${s.source ?? 'council policy'}${s.retrievedOn ? `, retrieved ${s.retrievedOn}` : ''}).${curt?.pct != null ? ` ${curt.pct}% of the registered curtilage would be covered.` : ''}${fz ? ' In a flood zone: the flood risk assessment must cover drainage.' : ''} A drainage concept is needed for the application.`); },
};

// -------------------------------------------------------------------------------------------------------------------------------------
export const LIVE_EXTRA = {
  'PI-04-16': historyCompleteness, 'PI-06-07': privacy, 'PI-07-10': heritageStatement, 'PI-08-13': sequentialTest, 'PI-10-06': clearances, 'PI-11-10': visibilitySplays,
  'PI-12-02': conservationTrees, 'PI-12-09': bng, 'PI-12-13': ecologyTrigger, 'PI-13-08': asbestos, 'PI-15-10': licensing, 'PI-16-06': environmentalContext,
  ...WORKFLOW, ...EVIDENCE_LIVE, ...LAYER_LIVE, ...EXTRAS_LIVE, ...STANDARDS_LIVE,
};

// ------------------------------------------------------------------------------------------------------------------------ coverage plan
const ds = (id) => Object.values(DATASET_BY_KEY).filter((d) => d.checks.includes(id));
const layerNote = (id) => { const d = ds(id); return `Reads ${d.map((x) => `"${x.key}" (${x.publisher})`).join(' + ')} from your own server; needs the dataset loaded (npm run import:geo -- --dataset ${d[0].key}). Not loaded = "awaiting", never a pass.`; };
const LOGIC_NOTES = {
  'PI-04-16': 'Completeness band (partial / audited) from the PlanIt search, gaps flagged (no record at address, old building with young records, undecided records); "audited" only when a council-register search audit is on file.',
  'PI-06-07': 'Separation from the proposal to neighbouring buildings against 21 m / 12 m design-guide figures (or the council\'s own if loaded). Window positions are not known, so it is a separation check only.',
  'PI-07-10': 'Heritage-statement trigger from listing, conservation area, scheduled monument and nearby designated assets; says when specialist input is expected.',
  'PI-08-13': 'Sequential-test trigger from flood zone, use and vulnerability class; householder/minor development normally exempt, new homes and changes of use not.',
  'PI-10-06': 'Distance from the proposal to mapped overhead lines against SCREENING buffers (not a DNO standard); compares surveyed vs DNO minimum when both are in evidence.',
  'PI-11-10': 'Visibility splays (2.4 m x 25 m at 20 mph / 43 m at 30 mph, Manual for Streets) drawn from the frontage; mapped fences, trees, buildings and the proposal tested against them. Speed assumed 30 mph on local roads unless surveyed.',
  'PI-12-02': 'Section 211 six-week notice trigger for trees in a conservation area, with mapped tree count.',
  'PI-12-09': 'BNG applicability: England only; permitted development and householder exempt; otherwise small-site (0.2 ha, from 6 Aug 2026) and de minimis tests. Dated rules, verify before relying.',
  'PI-12-13': 'Ecology-survey triggers: SSSI, ancient woodland, roof work, older roofs, nearby trees, species records. No trigger is never a clearance.',
  'PI-13-08': 'Asbestos-survey trigger from building age (EPC band or evidence) and whether the work disturbs existing fabric.',
  'PI-15-10': 'Licensing conclusion from the additional/selective designations loaded for the council and declared occupancy (mandatory: 5+ people, 2+ households).',
  'PI-16-06': 'EIA screening (householder work is not a Schedule 1/2 project) plus an environmental-context summary from flood, designations, AQMA, noise and road class.',
  'PI-17-10': 'Survey-request workflow: briefs built from the register\'s own evidence wording, status draft > requested > booked > returned, returned results become evidence.',
  'PI-17-11': 'Named-reviewer sign-off with role and notes, tied to the engine reading and the evidence on file (goes stale if either changes). Needs REVIEWER_TOKEN.',
  'PI-17-12': 'Officer review queue: submit with the LPA case/consultation reference, officer records an outcome; cross-application queue for the council.',
};
const EVID_NOTES = (id) => `Evidence intake (deeds, surveys, specialist reports) through the evidence API; the engine summarises it and flags what it says, but only a named reviewer can verify it.`;
const mods = (...x) => x.join('; ');

/** Coverage overrides for the checks this module feeds: [id, status, needs, modules, note]. */
export const COVERAGE_OVERRIDES = [];
const add = (id, status, needs, modules, note) => COVERAGE_OVERRIDES.push([id, status, needs, modules, note]);
for (const id of ['PI-04-16', 'PI-06-07', 'PI-07-10', 'PI-08-13', 'PI-10-06', 'PI-11-10', 'PI-12-02', 'PI-12-09', 'PI-12-13', 'PI-13-08', 'PI-16-06']) add(id, 'have', [], 'register/checks', LOGIC_NOTES[id]);
add('PI-15-10', 'have', ['geo'], 'register/checks (licensing)', LOGIC_NOTES['PI-15-10']);
add('PI-17-10', 'have', [], 'register/evidence (requestSurvey, updateSurvey)', LOGIC_NOTES['PI-17-10']);
add('PI-17-11', 'have', ['reviewer'], 'register/evidence (signOff, reviewStatus); routes/applications', LOGIC_NOTES['PI-17-11']);
add('PI-17-12', 'have', [], 'register/evidence (submitOfficerReview, recordOfficerOutcome); GET /api/review-queue', LOGIC_NOTES['PI-17-12']);
add('PI-17-14', 'have', [], 'register/gate', 'Readiness gate: held until identity is confirmed, every issue is accepted by a named reviewer or recorded as an exception, mandatory checks have data, and the verdict is signed. Optional enforcement on exports (READINESS_ENFORCE).');
for (const id of Object.keys(LAYER_LIVE)) { const d = ds(id), parts = d.length ? d : []; add(id, 'have', ['geo'], mods('register/geo', ...parts.map((x) => `dataset ${x.key}`)), (parts.length ? layerNote(id) : 'Reads loaded datasets.') + (OPEN_LIVE[id] ? ' If the dataset is not loaded it falls back to free live open data (providers/floodSources or providers/osmInfra) and says so; run npm run verify:open-data once.' : '')); }
for (const id of Object.keys(EXTRAS_LIVE)) add(id, 'have', ['osm'], 'register/osmExtras (live Overpass); providers/osmInfra (fallback)', id === 'PI-10-03' ? 'Substations from OpenStreetMap (power=substation within 150 m); not a DNO asset record - the DNO plan is evidence.' : 'Traffic signals and signal crossings from OpenStreetMap within 100 m.');
for (const id of Object.keys(STANDARDS_LIVE)) add(id, 'have', ['geo'], 'register/standards (lpa_standards table)', `Reads the council's own ${id === 'PI-06-08' ? 'density' : id === 'PI-06-09' ? 'parking' : id === 'PI-06-10' ? 'cycle parking' : 'SuDS'} standard where one is loaded for the authority, and applies it where the inputs exist.`);
for (const id of Object.keys(EVIDENCE_LIVE)) if (!COVERAGE_OVERRIDES.some((r) => r[0] === id)) add(id, 'partial', [], 'register/evidence; register/checks', `${EVID_NOTES(id)}${['PI-08-11', 'PI-09-15', 'PI-12-07', 'PI-12-08', 'PI-14-04', 'PI-14-07', 'PI-04-15'].includes(id) ? ' The engine also reads what it can from its own data (see the live finding).' : ''}`);
