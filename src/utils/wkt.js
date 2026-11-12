/**
 * Minimal WKT readers for the planning.data.gov.uk API (`geometry` and `point` come back as WKT strings, lng-lat order).
 */

/** Parses a WKT POLYGON / MULTIPOLYGON into an array of OUTER rings ([lng, lat] pairs, closed). Holes are ignored. */
export function parseWktPolygons(wkt) {
  if (!wkt || typeof wkt !== 'string' || !/^\s*(MULTI)?POLYGON/i.test(wkt)) return [];
  const s = wkt.slice(wkt.indexOf('('));
  let i = 0;
  const parse = () => {
    const arr = [];
    let buf = '';
    i++; // skip '('
    while (i < s.length) {
      const c = s[i];
      if (c === '(') { arr.push(parse()); continue; }
      if (c === ')') { if (buf.trim()) arr.push(buf.trim()); i++; return arr; }
      if (c === ',') { if (buf.trim()) arr.push(buf.trim()); buf = ''; i++; continue; }
      buf += c; i++;
    }
    return arr;
  };
  const tree = parse();
  const polygons = /^\s*MULTIPOLYGON/i.test(wkt) ? tree : [tree];
  return polygons
    .map((p) => (Array.isArray(p[0]) ? p[0] : []).map((pt) => String(pt).split(/\s+/).map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)))
    .filter((r) => r.length >= 4)
    .map((r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]]));
}

/** "POINT (-0.681152 52.762892)" -> [lng, lat] (or null). */
export function parseWktPoint(wkt) {
  const m = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** A square of half-side `rM` metres around a point, as a WKT POLYGON string (lng lat order). */
export function wktSquare(lat, lng, rM) {
  const dLat = rM / 111320, dLng = rM / (111320 * Math.cos((lat * Math.PI) / 180));
  const f = (n) => Number(n.toFixed(7));
  const [w, e, s, n] = [f(lng - dLng), f(lng + dLng), f(lat - dLat), f(lat + dLat)];
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}
