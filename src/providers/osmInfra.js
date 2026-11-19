import { overpass as defaultOverpass } from './overpass.js';

/**
 * Three small OpenStreetMap questions in ONE Overpass request: watercourses (150 m), electricity substations (100 m), traffic signals (60 m).
 * OSM is community-mapped and incomplete. A waterway here is NOT the Environment Agency's "main river" designation, and a substation here is
 * NOT the network operator's asset register. Treat results as pointers, never as "none exist".
 */
const WATER = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'brook']);
const metres = (lat0, lng0) => { const kx = 111320 * Math.cos((lat0 * Math.PI) / 180); return (g) => [(g.lon - lng0) * kx, (g.lat - lat0) * 110540]; };
const dSeg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / L)) : 0; return Math.hypot(a[0] + t * dx, a[1] + t * dy); };
const distTo = (e, m) => {
  if (e.type === 'node') return Math.hypot(...m(e));
  const g = (e.geometry ?? []).map(m);
  if (g.length === 1) return Math.hypot(g[0][0], g[0][1]);
  return g.length ? Math.min(...g.slice(1).map((p, i) => dSeg(g[i], p))) : Infinity;
};

export function createOsmInfra({ overpass = defaultOverpass } = {}) {
  return {
    name: 'osm-infrastructure',
    async check({ lat, lng }) {
      const q = `[out:json][timeout:10];(way(around:150,${lat},${lng})["waterway"~"^(river|stream|canal|ditch|drain|brook)$"];`
        + `node(around:100,${lat},${lng})["power"="substation"];way(around:100,${lat},${lng})["power"="substation"];`
        + `node(around:60,${lat},${lng})["highway"="traffic_signals"];);out geom;`;
      const data = await overpass(q, { timeoutMs: 15000 });
      const m = metres(lat, lng), out = { watercourses: [], substations: [], signals: [], source: 'OpenStreetMap contributors (ODbL)' };
      for (const e of data?.elements ?? []) {
        const t = e.tags ?? {}, d = distTo(e, m);
        if (!Number.isFinite(d)) continue;
        if (WATER.has(t.waterway)) out.watercourses.push({ kind: t.waterway, name: t.name ?? null, culverted: t.tunnel === 'culvert' || t.tunnel === 'yes', distanceM: Math.round(d) });
        else if (t.power === 'substation') out.substations.push({ name: t.name ?? null, operator: t.operator ?? null, kind: t.substation ?? null, distanceM: Math.round(d) });
        else if (t.highway === 'traffic_signals') out.signals.push({ distanceM: Math.round(d) });
      }
      for (const k of ['watercourses', 'substations', 'signals']) out[k].sort((a, b) => a.distanceM - b.distanceM);
      out.watercourses = out.watercourses.slice(0, 6); out.substations = out.substations.slice(0, 4); out.signals = out.signals.slice(0, 4);
      return out;
    },
  };
}
