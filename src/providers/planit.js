import { fetchJson } from '../utils/http.js';
import { haversine } from '../utils/geo.js';

/**
 * PLANNING HISTORY via PlanIt (planit.org.uk), a public aggregator of council planning registers.
 * One call returns the applications around a point: what was applied for, whether it was approved, refused or withdrawn, when,
 * and a link to the council's own register entry. The records are council data; PlanIt has its own terms of use (free for
 * non-commercial use, commercial licence available) - so this provider is OFF unless PLANNING_HISTORY_ENABLED=true.
 *
 * What it can and cannot tell you: titles, descriptions, outcomes and dates. It does NOT contain the decision notice, so the
 * wording of planning conditions (the ones that remove permitted development) is not in it - it can only point you to look.
 * Council registers differ in how much they publish, and PlanIt can lag behind them.
 */
const NEARBY_M = 150, YEARS = 10, MAX_HERE = 40, MAX_NEARBY = 200;
const ABBREV = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', ln: 'lane', dr: 'drive', cl: 'close', ct: 'court', pl: 'place', cres: 'crescent', gdns: 'gardens', ter: 'terrace', sq: 'square', gr: 'grove', pk: 'park' };
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((t) => ABBREV[t] ?? t).join(' ');
const get = (r, ...keys) => keys.map((k) => r[k]).find((v) => v != null && v !== '');
const day = (v) => (v ? String(v).slice(0, 10) : null);

export const outcomeOf = (state) => { const s = String(state ?? '').toLowerCase(); return /permit|approv|grant|condition/.test(s) ? 'approved' : /reject|refus/.test(s) ? 'refused' : /withdraw/.test(s) ? 'withdrawn' : /undecided|pending|referred|unresolved/.test(s) ? 'pending' : 'unknown'; };

/** What kind of work an application was for, from its description. */
export function classifyApplication(description, appType = '') {
  const d = `${description ?? ''}`.toLowerCase(), t = `${appType ?? ''}`.toLowerCase();
  const lawful = /certificate of (lawfulness|lawful)|lawful development/.test(d) || /lawful/.test(t);
  const prior = /prior approval|larger home extension|\bgpdo\b/.test(d) || /prior/.test(t);
  const flats = /conver(sion|t).*(flat|apartment|maisonette|self.contained)|sub.?division.*(flat|dwelling)|\bhmo\b|house in multiple occupation|change of use.*(flat|hmo|dwellings)/.test(d);
  const newDwelling = !flats && /(erection|construction|redevelopment|demolition).*(dwelling|house|flat|apartment|building)|residential development|new dwelling/.test(d) && !/(extension|porch|dormer|outbuilding|garage|loft)/.test(d.split(/ and |,/)[0]);
  const rear = /(rear|back).{0,40}(extension|addition)|extension.{0,40}\brear\b|single.?storey rear|two.?storey rear/.test(d), side = /side.{0,20}(extension|addition)|extension.{0,40}\bside\b/.test(d);
  const kind = /wrap.?around/.test(d) || (rear && side) ? 'wraparound' : rear ? 'rear' : side ? 'side' : /\bporch\b/.test(d) ? 'porch'
    : /dormer|loft conversion|roof (extension|conversion)|mansard|roof ?lights?/.test(d) ? 'dormer'
    : /(additional|extra|second|third) (storey|floor)|upward extension|raising the roof/.test(d) ? 'storey'
    : /outbuilding|garden room|summer ?house|\bshed\b|studio|garage/.test(d) ? 'outbuilding' : /\bextension\b|\bextend/.test(d) ? 'extension' : null;
  // a house that exists because of a Part 3 change-of-use right (office / shop / barn / storage to a home) has no Class A or B rights
  const part3 = /change of use.{0,120}(office|shop|retail|agricultur|barn|storage|light industrial|commercial|launderette|betting|casino|amusement|hot food|takeaway|financial|professional).{0,160}(dwelling|residential|house|\bhome\b)|\bclass (ma|m|n|o|p|pa|q|r|s)\b.{0,80}(dwelling|residential)|(office|shop|retail|barn|storage).{0,40}to (a )?(dwelling|house|residential|home)/.test(d) && !flats;
  return { kind, lawful, prior, flats, newDwelling, part3 };
}

/** Is this register entry for THIS house, for another flat in the same building, or for somewhere else? */
export function addressMatch(address, line1) {
  const a = norm(address), want = norm(line1);
  if (!want || !a) return null;
  const at = a.search(new RegExp(`(^| )${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`));
  if (at < 0) return null;
  return /(^| )(flat|apartment|unit|room|basement|ground floor|first floor|second floor|top floor)( |\d)/.test(a.slice(0, at + 1)) ? 'building' : 'house';
}

/** PlanIt JSON (or GeoJSON) -> normalised records. */
export function parsePlanit(json) {
  const raw = json?.records ?? (json?.features ? json.features.map((f) => ({ ...f.properties, lng: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] })) : []);
  return raw.map((r) => {
    const description = get(r, 'description') ?? '', appType = get(r, 'app_type') ?? null, state = get(r, 'app_state') ?? null;
    return {
      ref: get(r, 'uid', 'reference', 'name', 'altid') ?? null, council: get(r, 'area_name', 'council') ?? null, address: get(r, 'address') ?? null, postcode: get(r, 'postcode') ?? null,
      description, appType, size: get(r, 'app_size') ?? null, state, outcome: outcomeOf(state),
      receivedOn: day(get(r, 'start_date', 'date_received', 'received_date')), decidedOn: day(get(r, 'decided_date', 'decision_date')),
      lat: Number(get(r, 'lat', 'latitude')), lng: Number(get(r, 'lng', 'longitude')),
      councilUrl: get(r, 'url', 'council_url', 'source_url') ?? null, planitUrl: get(r, 'link', 'planit_url') ?? null,
      ...classifyApplication(description, appType),
    };
  }).filter((r) => r.description || r.address);
}

/** { here: this house's applications, building: same building (flats), nearby: similar work within 150 m }. */
export function splitHistory(records, { lat, lng, line1 }) {
  const here = [], building = [], nearby = [];
  for (const r of records) {
    const m = addressMatch(r.address, line1);
    const distanceM = Number.isFinite(r.lat) && Number.isFinite(r.lng) ? Math.round(haversine({ lat, lng }, { lat: r.lat, lng: r.lng })) : null;
    const rec = { ...r, distanceM };
    if (m === 'house') here.push(rec); else if (m === 'building') building.push(rec);
    else if (distanceM != null && distanceM <= NEARBY_M && (r.kind || r.lawful || r.prior || r.flats)) nearby.push(rec);
  }
  const newest = (a, b) => String(b.decidedOn ?? b.receivedOn ?? '').localeCompare(String(a.decidedOn ?? a.receivedOn ?? ''));
  return { here: here.sort(newest).slice(0, MAX_HERE), building: building.sort(newest).slice(0, 20), nearby: nearby.sort(newest).slice(0, MAX_NEARBY) };
}

export function createPlanit({ url, enabled = false }) {
  return {
    name: 'planit',
    async findHistory({ lat, lng, line1 = '', now = new Date() }) {
      if (!enabled || !url || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const since = new Date(now.getTime() - YEARS * 365.25 * 86400000).toISOString().slice(0, 10);
      const q = new URLSearchParams({ lat: String(lat), lng: String(lng), krad: String(NEARBY_M / 1000), start_date: since, pg_sz: '400' });
      const data = await fetchJson(`${url}?${q}`, { headers: { 'user-agent': 'planning-screening/1.0 (householder permitted-development checker)' }, timeoutMs: 15000 });
      const parts = splitHistory(parsePlanit(data), { lat, lng, line1 });
      return { ...parts, radiusM: NEARBY_M, years: YEARS, source: 'planit', attribution: 'Planning application data from council registers, aggregated by PlanIt (planit.org.uk). Check PlanIt\'s terms of use.' };
    },
  };
}
