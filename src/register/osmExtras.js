import { haversine } from '../utils/geo.js';

/**
 * Two things the main OSM site query does not ask for: electricity substations (PI-10-03) and traffic signals / signal crossings (PI-11-03).
 * One small Overpass request around the address. `run(query)` is the Overpass runner (providers/overpass.js), injected so this can be tested offline.
 * OSM only maps what contributors mapped: "none found" is never "none exist", and it is not a DNO asset record.
 */
const centre = (e) => (e.type === 'node' ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : e.geometry?.length ? { lat: e.geometry.reduce((s, g) => s + g.lat, 0) / e.geometry.length, lng: e.geometry.reduce((s, g) => s + g.lon, 0) / e.geometry.length } : null);

export function parseExtras(data, at) {
  const substations = [], signals = [];
  for (const e of data?.elements ?? []) {
    const t = e.tags ?? {}, c = centre(e);
    if (!c) continue;
    const distanceM = Math.round(haversine(at, c));
    if (t.power === 'substation') substations.push({ osmId: `${e.type}/${e.id}`, name: t.name ?? null, kind: t.substation ?? null, voltage: t.voltage ?? null, operator: t.operator ?? null, distanceM });
    else if (t.highway === 'traffic_signals' || (t.highway === 'crossing' && /traffic_signals/.test(t.crossing ?? ''))) signals.push({ osmId: `${e.type}/${e.id}`, kind: t.highway === 'crossing' ? 'signal crossing' : 'traffic signals', distanceM });
  }
  const byDist = (a, b) => a.distanceM - b.distanceM;
  return { substations: substations.sort(byDist), signals: signals.sort(byDist) };
}

export function createOsmExtras({ run, substationRadiusM = 150, signalRadiusM = 100 } = {}) {
  return {
    name: 'osm-extras',
    async find({ lat, lng }) {
      const q = `[out:json][timeout:15];(node["power"="substation"](around:${substationRadiusM},${lat},${lng});way["power"="substation"](around:${substationRadiusM},${lat},${lng});`
        + `node["highway"="traffic_signals"](around:${signalRadiusM},${lat},${lng});node["highway"="crossing"]["crossing"~"traffic_signals"](around:${signalRadiusM},${lat},${lng}););out center tags;`;
      const out = parseExtras(await run(q), { lat, lng });
      return { ...out, substationRadiusM, signalRadiusM, source: '© OpenStreetMap contributors', checkedAt: new Date().toISOString() };
    },
  };
}
