// import { cached } from '../utils/cache.js';
// import { logger } from '../utils/logger.js';
// import { classifyOsm } from '../providers/classification.js';
// import { badRequest, notFound } from '../utils/errors.js';
// import { parsePostcode, extractPostcode, looksLikePartialPostcode } from '../utils/postcode.js';

// const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
// const sortAddresses = (list) =>
//   [...list].sort(
//     (a, b) =>
//       collator.compare(a.thoroughfare || '', b.thoroughfare || '') ||
//       collator.compare(a.buildingNumber || a.buildingName || '', b.buildingNumber || b.buildingName || '') ||
//       collator.compare(a.subBuilding || '', b.subBuilding || ''),
//   );
// const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// const matchesAll = (text, tokens) => tokens.every((t) => new RegExp(`\\b${esc(t)}`, 'i').test(text));

// const summarise = (a) => ({
//   id: a.id, uprn: a.uprn, fullAddress: a.fullAddress, postcode: a.postcode,
//   propertyType: a.classification.propertyType, lat: a.lat, lng: a.lng,
// });

// export function createAddressService({ providers, uprnMatcher = null }) {
//   const { address: os, postcodes } = providers;

//   const postcodeAddresses = (pc) => cached(`addr:pc:${pc}`, () => os.byPostcode(pc));

//   return {
//     postcodeInfo: (pc) => cached(`pcinfo:${pc}`, () => postcodes.lookup(pc), 86400),

//     /** Enter a full postcode -> list every address at it. */
//     async byPostcode(input) {
//       const pc = parsePostcode(input);
//       if (!pc) throw badRequest('Enter a valid UK postcode, for example E6 2AA.');
//       const info = await this.postcodeInfo(pc).catch(() => null);
//       let list = [], note = null;
//       try { list = await postcodeAddresses(pc); }
//       catch (e) {
//         logger.warn({ err: e.message, pc }, 'address list unavailable');
//         if (!info) throw e;
//         note = 'The address list is temporarily unavailable. Try typing the first line of your address instead.';
//       }
//       if (!list.length && !info) throw notFound(`We could not find postcode ${pc}.`);
//       return {
//         postcode: pc, note,
//         area: info ? { district: info.adminDistrict, region: info.region, country: info.country } : null,
//         addresses: sortAddresses(list).map(summarise),
//       };
//     },

//     /**
//      * One search box: full postcode, partial postcode or free-text address.
//      * Type-ahead must never hard-fail: if an upstream is slow/blocked we return no suggestions plus a message.
//      */
//     async search(q, limit = 10) {
//       const query = (q || '').trim();
//       const compact = query.replace(/^([A-Za-z]{1,2})\s(\d{1,2}[A-Za-z]?)$/, '$1$2'); // "AB 1" -> "AB1"
//       const isPostcodeLike = !!extractPostcode(query) || looksLikePartialPostcode(compact);
//       if (query.length < 3 || (!isPostcodeLike && !/\d/.test(query) && query.length < 4)) return { type: 'none', suggestions: [] };

//       try {
//         const ex = extractPostcode(query);
//         if (ex) {
//           let list = await postcodeAddresses(ex.postcode);
//           if (ex.rest) {
//             const tokens = ex.rest.split(' ');
//             list = list.filter((a) => matchesAll(a.fullAddress, tokens));
//           }
//           return { type: 'postcode', postcode: ex.postcode, suggestions: sortAddresses(list).slice(0, 100).map(summarise) };
//         }
//         if (looksLikePartialPostcode(compact)) {
//           const pcs = await cached(`pcauto:${compact.toUpperCase()}`, () => postcodes.autocomplete(compact.toUpperCase()), 3600);
//           return { type: 'postcode_partial', suggestions: (pcs ?? []).map((postcode) => ({ postcode })) };
//         }
//         const list = await cached(`addr:find:${query.toLowerCase()}:${limit}`, () => os.find(query, { limit }), 600);
//         return { type: 'address', suggestions: list.map(summarise) };
//       } catch (e) {
//         logger.warn({ err: e.message }, 'address search degraded');
//         return { type: 'unavailable', suggestions: [], message: 'Address suggestions are temporarily unavailable. Try again, or enter a full postcode.' };
//       }
//     },

//     /**
//      * Fallback when the address list is unavailable or the address is missing: the applicant types it in.
//      * The location is the postcode centre (approximate) – the application warns about this.
//      */
//     async manual({ line1, line2, town, postcode }) {
//       const pc = parsePostcode(postcode);
//       if (!pc) throw badRequest('Enter a valid UK postcode, for example E6 2AA.');
//       const info = await this.postcodeInfo(pc);
//       if (!info) throw notFound(`We could not find postcode ${pc}.`);
//       const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
//       const l1 = clean(line1, 80);
//       if (!l1) throw badRequest('Enter the first line of the address.');
//       const t = clean(town, 60) || info.adminDistrict || null;
//       const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(l1);
//       return {
//         id: `manual-${pc.replace(' ', '')}`, uprn: null, approximate: true,
//         fullAddress: [l1, clean(line2, 80), t, pc].filter(Boolean).join(', '),
//         organisation: null, subBuilding: null, buildingName: m ? null : l1, buildingNumber: m?.[1] ?? null,
//         thoroughfare: m?.[2] ?? null, dependentLocality: null, postTown: t, postcode: pc,
//         lat: info.lat, lng: info.lng, easting: null, northing: null, localCustodian: null,
//         classification: classifyOsm(null),
//       };
//     },

//     /** Authoritative record for a confirmed address id (UPRN, or osm:<type>:<id>) – never trust address text from the client. */
//     async getById(id) {
//       if (!/^(\d{1,12}|osm:(node|way|relation):\d{1,12})$/.test(String(id))) throw badRequest('Invalid address id.');
//       const a = await cached(`addr:id:${id}`, () => os.byId(String(id)), 86400);
//       if (!a) throw notFound(`No address found for ${id}.`);
//       return uprnMatcher ? uprnMatcher.enrich(a) : a;
//     },
//   };
// }

import { cached } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { classifyOsm } from '../providers/classification.js';
import { badRequest, notFound } from '../utils/errors.js';
import { parsePostcode, extractPostcode, looksLikePartialPostcode } from '../utils/postcode.js';

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
const sortAddresses = (list) =>
  [...list].sort(
    (a, b) =>
      collator.compare(a.thoroughfare || '', b.thoroughfare || '') ||
      collator.compare(a.buildingNumber || a.buildingName || '', b.buildingNumber || b.buildingName || '') ||
      collator.compare(a.subBuilding || '', b.subBuilding || ''),
  );
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchesAll = (text, tokens) => tokens.every((t) => new RegExp(`\\b${esc(t)}`, 'i').test(text));

const summarise = (a) => ({
  id: a.id, uprn: a.uprn, fullAddress: a.fullAddress, postcode: a.postcode,
  propertyType: a.classification.propertyType, lat: a.lat, lng: a.lng,
});

export function createAddressService({ providers, uprnMatcher = null }) {
  const { address: os, postcodes } = providers;

  // Attach OS Open UPRNs (one batched database call for the whole list) so lists show the UPRN too, not only the confirmed address.
  const withUprn = (list) => (uprnMatcher?.available ? uprnMatcher.enrichMany(list) : list);
  const postcodeAddresses = (pc) => cached(`addr:pc:${pc}`, async () => withUprn(await os.byPostcode(pc)));

  return {
    postcodeInfo: (pc) => cached(`pcinfo:${pc}`, () => postcodes.lookup(pc), 86400),

    /** Enter a full postcode -> list every address at it. */
    async byPostcode(input) {
      const pc = parsePostcode(input);
      if (!pc) throw badRequest('Enter a valid UK postcode, for example E6 2AA.');
      const info = await this.postcodeInfo(pc).catch(() => null);
      let list = [], note = null;
      try { list = await postcodeAddresses(pc); }
      catch (e) {
        logger.warn({ err: e.message, pc }, 'address list unavailable');
        if (!info) throw e;
        note = 'The address list is temporarily unavailable. Try typing the first line of your address instead.';
      }
      if (!list.length && !info) throw notFound(`We could not find postcode ${pc}.`);
      return {
        postcode: pc, note,
        area: info ? { district: info.adminDistrict, region: info.region, country: info.country } : null,
        addresses: sortAddresses(list).map(summarise),
      };
    },

    /**
     * One search box: full postcode, partial postcode or free-text address.
     * Type-ahead must never hard-fail: if an upstream is slow/blocked we return no suggestions plus a message.
     */
    async search(q, limit = 10) {
      const query = (q || '').trim();
      const compact = query.replace(/^([A-Za-z]{1,2})\s(\d{1,2}[A-Za-z]?)$/, '$1$2'); // "AB 1" -> "AB1"
      const isPostcodeLike = !!extractPostcode(query) || looksLikePartialPostcode(compact);
      if (query.length < 3 || (!isPostcodeLike && !/\d/.test(query) && query.length < 4)) return { type: 'none', suggestions: [] };

      try {
        const ex = extractPostcode(query);
        if (ex) {
          let list = await postcodeAddresses(ex.postcode);
          if (ex.rest) {
            const tokens = ex.rest.split(' ');
            list = list.filter((a) => matchesAll(a.fullAddress, tokens));
          }
          return { type: 'postcode', postcode: ex.postcode, suggestions: sortAddresses(list).slice(0, 100).map(summarise) };
        }
        if (looksLikePartialPostcode(compact)) {
          const pcs = await cached(`pcauto:${compact.toUpperCase()}`, () => postcodes.autocomplete(compact.toUpperCase()), 3600);
          return { type: 'postcode_partial', suggestions: (pcs ?? []).map((postcode) => ({ postcode })) };
        }
        const list = await cached(`addr:find:${query.toLowerCase()}:${limit}`, async () => withUprn(await os.find(query, { limit })), 600);
        return { type: 'address', suggestions: list.map(summarise) };
      } catch (e) {
        logger.warn({ err: e.message }, 'address search degraded');
        return { type: 'unavailable', suggestions: [], message: 'Address suggestions are temporarily unavailable. Try again, or enter a full postcode.' };
      }
    },

    /**
     * Fallback when the address list is unavailable or the address is missing: the applicant types it in.
     * The location is the postcode centre (approximate) – the application warns about this.
     */
    async manual({ line1, line2, town, postcode }) {
      const pc = parsePostcode(postcode);
      if (!pc) throw badRequest('Enter a valid UK postcode, for example E6 2AA.');
      const info = await this.postcodeInfo(pc);
      if (!info) throw notFound(`We could not find postcode ${pc}.`);
      const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
      const l1 = clean(line1, 80);
      if (!l1) throw badRequest('Enter the first line of the address.');
      const t = clean(town, 60) || info.adminDistrict || null;
      const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(l1);
      return {
        id: `manual-${pc.replace(' ', '')}`, uprn: null, approximate: true,
        fullAddress: [l1, clean(line2, 80), t, pc].filter(Boolean).join(', '),
        organisation: null, subBuilding: null, buildingName: m ? null : l1, buildingNumber: m?.[1] ?? null,
        thoroughfare: m?.[2] ?? null, dependentLocality: null, postTown: t, postcode: pc,
        lat: info.lat, lng: info.lng, easting: null, northing: null, localCustodian: null,
        classification: classifyOsm(null),
      };
    },

    /** Authoritative record for a confirmed address id (UPRN, or osm:<type>:<id>) – never trust address text from the client. */
    async getById(id) {
      if (!/^(\d{1,12}|osm:(node|way|relation):\d{1,12})$/.test(String(id))) throw badRequest('Invalid address id.');
      const a = await cached(`addr:id:${id}`, () => os.byId(String(id)), 86400);
      if (!a) throw notFound(`No address found for ${id}.`);
      return uprnMatcher ? uprnMatcher.enrich(a) : a;
    },
  };
}