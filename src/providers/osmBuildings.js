import { pickUseTags } from './classification.js';
import { overpass } from './overpass.js';
import { haversine, pointInRing, ringAreaM2, ringCentroid } from '../utils/geo.js';
import { roadFromElement, treeFromElement, barrierFromElement, pathFromElement, obstacleFromElement, powerLineFromElement, parseMetres, BOUNDARY_BARRIERS, PATH_HIGHWAYS } from '../utils/osmTags.js';

/** Pavements / paths (60 m) and street furniture and utilities (40 m): post boxes, poles, lamps, cabinets, hydrants, bollards, bus stops, dropped kerbs. */
const STREET = (lat, lng) => `way(around:60,${lat},${lng})["highway"~"^(${PATH_HIGHWAYS.join('|')})$"];`
  + `node(around:40,${lat},${lng})["amenity"="post_box"];node(around:40,${lat},${lng})["power"~"^(pole|tower)$"];node(around:40,${lat},${lng})["highway"~"^(street_lamp|bus_stop)$"];`
  + `way(around:60,${lat},${lng})["power"~"^(line|minor_line)$"];`
  + `node(around:40,${lat},${lng})["man_made"="street_cabinet"];node(around:40,${lat},${lng})["emergency"="fire_hydrant"];node(around:40,${lat},${lng})["barrier"~"^(bollard|kerb)$"];`;

const ROADS = '^(residential|unclassified|tertiary|secondary|primary|living_street|service|road|pedestrian|trunk)$';

/**
 * Building outline (+ levels / roof / building type), nearby roads (with widths) and nearby trees from OpenStreetMap.
 * Roads tell us which side of the house is the FRONT, so we know where the "rear" is for the map overlay.
 * Free, but accuracy varies – every derived value is flagged `source: 'osm'` for the applicant to confirm.
 * Swap for OS NGD / Land Registry INSPIRE for authoritative outlines.
 */
export function createOsmBuildings() {
  return {
    name: 'osm-overpass',
    async findSite({ lat, lng }) {
      // buildings (40 m), roads (60 m) and individual mapped trees (60 m) in ONE request. Woods/hedges are left out on purpose:
      // their geometry can be huge and they are not individual trees.
      // Fences / walls / hedges (40 m) ride in the same request: the plot outline snaps to them where they are mapped.
      const q = `[out:json][timeout:10];(way(around:40,${lat},${lng})["building"];way(around:60,${lat},${lng})["highway"~"${ROADS}"];node(around:60,${lat},${lng})["natural"="tree"];node(around:30,${lat},${lng})[~"^(amenity|shop|office|craft|healthcare|tourism|leisure)$"~"."];way(around:40,${lat},${lng})["barrier"~"^(${BOUNDARY_BARRIERS.join('|')})$"];${STREET(lat, lng)});out tags geom;`;
      const data = await overpass(q, { timeoutMs: 15000 });
      const els = data?.elements ?? [];
      const roadDetails = els.map(roadFromElement).filter(Boolean);
      const roads = roadDetails.map((r) => r.line);
      const trees = els.map(treeFromElement).filter(Boolean).slice(0, 80);
      const barriers = els.map(barrierFromElement).filter(Boolean).slice(0, 150);
      const pathways = els.map(pathFromElement).filter(Boolean).slice(0, 60);
      const obstacles = els.map(obstacleFromElement).filter(Boolean).slice(0, 80);
      const powerLines = els.map(powerLineFromElement).filter(Boolean).slice(0, 20);
      const cands = els
        .filter((e) => e.tags?.building && e.geometry?.length >= 4)
        .map((w) => ({ w, ring: w.geometry.map((g) => [g.lon, g.lat]) }));
      if (!cands.length) return { footprint: null, roads, roadDetails, trees, neighbours: [], barriers, pathways, obstacles, powerLines };

      const pt = [lng, lat];
      const best =
        cands.find((c) => pointInRing(pt, c.ring)) ??
        cands.sort((a, b) => haversine({ lat, lng }, ringCentroid(a.ring)) - haversine({ lat, lng }, ringCentroid(b.ring)))[0];
      const t = best.w.tags;
      // what the building is USED for: tags on the building itself, or on a mapped point (pub, shop, office...) inside it
      const useTags = els.filter((e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon) && pointInRing([e.lon, e.lat], best.ring))
        .reduce((a, e) => ({ ...pickUseTags(e.tags), ...a }), pickUseTags(t)); // each point is filtered on its own, so a bench cannot hide a pub
      // every OTHER building nearby: used to warn when a proposal would overlap a neighbour
      const neighbours = cands.filter((c) => c !== best).slice(0, 40).map((c) => ({ osmId: c.w.id, ring: c.ring, buildingType: c.w.tags.building ?? null }));
      return {
        roads, roadDetails, trees, neighbours, barriers, pathways, obstacles, powerLines,
        footprint: {
          source: 'osm', osmId: best.w.id, ring: best.ring, areaM2: Math.round(ringAreaM2(best.ring)),
          levels: t['building:levels'] ? Number(t['building:levels']) || null : null,
          heightM: (() => { const h = parseMetres(t.height); return h && h >= 2 && h <= 60 ? h : null; })(),   // community-entered: used only as a prompt to check, never as a fact
          roofShape: t['roof:shape'] ?? null, buildingType: t.building ?? null, useTags,
        },
      };
    },
  };
}
