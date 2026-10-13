import { overpass } from './overpass.js';
import { haversine, pointInRing, ringAreaM2, ringCentroid } from '../utils/geo.js';

const ROADS = '^(residential|unclassified|tertiary|secondary|primary|living_street|service|road|pedestrian|trunk)$';

/**
 * Building outline (+ levels / roof / building type) and nearby roads from OpenStreetMap.
 * Roads tell us which side of the house is the FRONT, so we know where the "rear" is for the map overlay.
 * Free, but accuracy varies – every derived value is flagged `source: 'osm'` for the applicant to confirm.
 * Swap for OS NGD / Land Registry INSPIRE for authoritative outlines.
 */
export function createOsmBuildings() {
  return {
    name: 'osm-overpass',
    async findSite({ lat, lng }) {
      const q = `[out:json][timeout:10];(way(around:40,${lat},${lng})["building"];way(around:60,${lat},${lng})["highway"~"${ROADS}"];);out tags geom;`;
      const data = await overpass(q, { timeoutMs: 15000 });
      const els = data?.elements ?? [];
      const roads = els.filter((e) => e.tags?.highway && e.geometry?.length >= 2).map((e) => e.geometry.map((g) => [g.lon, g.lat]));
      const cands = els
        .filter((e) => e.tags?.building && e.geometry?.length >= 4)
        .map((w) => ({ w, ring: w.geometry.map((g) => [g.lon, g.lat]) }));
      if (!cands.length) return { footprint: null, roads, neighbours: [] };

      const pt = [lng, lat];
      const best =
        cands.find((c) => pointInRing(pt, c.ring)) ??
        cands.sort((a, b) => haversine({ lat, lng }, ringCentroid(a.ring)) - haversine({ lat, lng }, ringCentroid(b.ring)))[0];
      const t = best.w.tags;
      // every OTHER building nearby: used to warn when a proposal would overlap a neighbour
      const neighbours = cands.filter((c) => c !== best).slice(0, 40).map((c) => ({ osmId: c.w.id, ring: c.ring, buildingType: c.w.tags.building ?? null }));
      return {
        roads, neighbours,
        footprint: {
          source: 'osm', osmId: best.w.id, ring: best.ring, areaM2: Math.round(ringAreaM2(best.ring)),
          levels: t['building:levels'] ? Number(t['building:levels']) || null : null,
          roofShape: t['roof:shape'] ?? null, buildingType: t.building ?? null,
        },
      };
    },
  };
}
