/**
 * Attaches a UPRN to an address that has none (OpenStreetMap / manual addresses) by finding the OS Open UPRN
 * point nearest to the address point. Confidence is "high" only when one point is clearly the closest;
 * flats and tightly packed terraces give "low" and the applicant is asked to confirm.
 */
export function createUprnMatcher({ openUprn, maxM = 15 }) {
  const eligible = (a) => !a.uprn && !a.approximate && Number.isFinite(a.lat) && Number.isFinite(a.lng);

  const apply = (address, near) => {
    if (!near?.length) return address;
    const [a, b] = near;
    const confidence = a.distM <= 8 && (!b || b.distM - a.distM >= 5) ? 'high' : 'low';
    return {
      ...address,
      uprn: a.uprn,
      uprnMatch: {
        source: 'os-open-uprn', method: 'nearest-to-address-point', confidence, distanceM: a.distM,
        candidates: near.map((n) => ({ uprn: n.uprn, distM: n.distM })),
      },
    };
  };

  return {
    available: !!openUprn,

    async enrich(address) {
      if (!openUprn || !eligible(address)) return address;
      return apply(address, await openUprn.nearest(address.lat, address.lng, { maxM, limit: 5 }));
    },

    /** Same as enrich() for a whole list, using ONE batched database call instead of one per address. */
    async enrichMany(list) {
      if (!openUprn) return list;
      const todo = list.map((a, i) => (eligible(a) ? i : -1)).filter((i) => i >= 0);
      if (!todo.length) return list;
      const found = await openUprn.nearestMany(todo.map((i) => ({ lat: list[i].lat, lng: list[i].lng })), { maxM, limit: 5 });
      const out = [...list];
      todo.forEach((i, k) => { out[i] = apply(list[i], found[k]); });
      return out;
    },
  };
}
