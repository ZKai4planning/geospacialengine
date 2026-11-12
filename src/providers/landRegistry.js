import { fetchJson } from '../utils/http.js';

/**
 * HM Land Registry PRICE PAID DATA (England & Wales), via the open linked-data SPARQL service. No key needed.
 * Every residential sale records the property type (detached / semi / terraced / flat-maisonette / other), tenure
 * (freehold / leasehold) and whether it was a new build - exactly the facts that decide whether householder rights apply.
 * Publication lags by 1-3 months and some sales are missing (e.g. cash-only transfers recorded late). Open Government Licence v3.0.
 */
const esc = (s) => String(s).replace(/[^A-Za-z0-9 '&.,-]/g, '').toUpperCase().trim();
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const PREFIXES = `prefix lrppi: <http://landregistry.data.gov.uk/def/ppi/>
prefix lrcommon: <http://landregistry.data.gov.uk/def/common/>
prefix skos: <http://www.w3.org/2004/02/skos/core#>
prefix xsd: <http://www.w3.org/2001/XMLSchema#>`;
const SELECT = `SELECT ?tid ?amount ?date ?ptype ?estate ?new ?paon ?saon ?street ?town ?postcode WHERE {
  ?tx lrppi:transactionId ?tid ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ; lrppi:propertyAddress ?addr ;
      lrppi:propertyType/skos:prefLabel ?ptype ; lrppi:estateType/skos:prefLabel ?estate ; lrppi:newBuild ?new .
  ?addr lrcommon:postcode ?postcode .
  OPTIONAL { ?addr lrcommon:paon ?paon } OPTIONAL { ?addr lrcommon:saon ?saon } OPTIONAL { ?addr lrcommon:street ?street } OPTIONAL { ?addr lrcommon:town ?town }`;

/** "e62aa" / "E6  2AA" -> "E6 2AA"; null when it is not a UK postcode shape (so nothing odd ever reaches the query). */
export function cleanPostcode(pc) {
  const s = String(pc ?? '').toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(s) ? `${s.slice(0, -3)} ${s.slice(-3)}` : null;
}

export const postcodeQuery = (postcode) => `${PREFIXES}\n${SELECT}\n  ?addr lrcommon:postcode "${postcode}"^^xsd:string .\n} ORDER BY DESC(?date) LIMIT 300`;
export function streetQuery({ street, town, since }) {
  return `${PREFIXES}\n${SELECT}\n  ?addr lrcommon:street "${esc(street)}"^^xsd:string ; lrcommon:town "${esc(town)}"^^xsd:string .\n  FILTER (?date >= "${since}"^^xsd:date)\n} ORDER BY DESC(?date) LIMIT 400`;
}

export const typeKey = (label) => { const b = String(label ?? '').toLowerCase(); return /flat|maisonette/.test(b) ? 'flat' : /semi/.test(b) ? 'semi_detached' : /terrace/.test(b) ? 'terraced' : /detached/.test(b) ? 'detached' : 'other'; };
/** Land Registry type -> our house form ('detached' | 'semi' | 'terraced'), or null for flats / other. */
export const formFromPpd = (t) => ({ detached: 'detached', semi_detached: 'semi', terraced: 'terraced' }[t] ?? null);

/** SPARQL JSON bindings -> sale records (one per transaction id). */
export function parseSales(json) {
  const seen = new Set(), out = [];
  for (const b of json?.results?.bindings ?? []) {
    const v = (k) => b[k]?.value ?? null, id = v('tid');
    if (!id || seen.has(id) || !Number.isFinite(Number(v('amount')))) continue;
    seen.add(id);
    out.push({
      transactionId: id, priceGbp: Number(v('amount')), date: String(v('date') ?? '').slice(0, 10),
      propertyType: typeKey(v('ptype')), tenure: /lease/i.test(v('estate') ?? '') ? 'leasehold' : 'freehold', newBuild: /^(true|y|1)$/i.test(v('new') ?? ''),
      paon: v('paon'), saon: v('saon'), street: v('street'), town: v('town'), postcode: v('postcode'),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The sales of THIS home (not the flat upstairs, not number 22 when we want 2): same house number / name and street, no flat part. */
export function salesOfAddress(sales, line1) {
  const want = norm(line1);
  if (!want) return [];
  return sales.filter((s) => !s.saon && norm(`${s.paon ?? ''} ${s.street ?? ''}`) === want);
}

const pct = (sorted, p) => { if (!sorted.length) return null; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)); };
/** Price statistics for a set of sales: count, median and the 25th / 75th percentile. */
export function priceStats(sales) {
  const p = sales.map((s) => s.priceGbp).sort((a, b) => a - b);
  return p.length ? { count: p.length, medianGbp: pct(p, 0.5), p25Gbp: pct(p, 0.25), p75Gbp: pct(p, 0.75), minGbp: p[0], maxGbp: p.at(-1) } : null;
}

export function createLandRegistry({ url }) {
  const run = async (query) => parseSales(await fetchJson(`${url}?query=${encodeURIComponent(query)}&output=json`, { headers: { accept: 'application/sparql-results+json' }, timeoutMs: 15000 }));
  return {
    name: 'land-registry-ppd',
    /**
     * { sales: this home's sales, street: { name, town, years, type, stats, count } | null, attribution }.
     * Street comparables are the same property type on the same street and town over the last 5 years.
     */
    async findSales({ postcode, line1 = '', town = null, now = new Date() }) {
      const pc = cleanPostcode(postcode);
      if (!pc || !url) return null;
      const here = await run(postcodeQuery(pc));
      const sales = salesOfAddress(here, line1);
      const sample = sales[0] ?? here.find((s) => norm(`${s.paon ?? ''} ${s.street ?? ''}`).endsWith(norm(line1).replace(/^\d+[a-z]? /, '')));
      const street = sample?.street ?? null, tn = sample?.town ?? town;
      let comps = null;
      if (street && tn) {
        try {
          const since = new Date(now.getTime() - 5 * 365.25 * 86400000).toISOString().slice(0, 10);
          const all = (await run(streetQuery({ street, town: tn, since }))).filter((s) => !s.saon);
          const type = sales[0]?.propertyType && sales[0].propertyType !== 'other' ? sales[0].propertyType : null;
          const same = type ? all.filter((s) => s.propertyType === type) : all.filter((s) => s.propertyType !== 'flat');
          comps = { name: street, town: tn, years: 5, type, stats: priceStats(same), allTypesStats: priceStats(all) };
        } catch { comps = null; }                       // comparables are a bonus: never fail the lookup for them
      }
      return { sales, street: comps, source: 'land-registry-ppd', attribution: 'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.' };
    },
  };
}
