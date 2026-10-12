import { ringAreaM2, ringCentroid } from '../utils/geo.js';
import { WORK_TYPES } from './workTypes.js';

const M_PER_DEG = 111320;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const norm = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function localConverter(lat0, lng0) {
  const kx = M_PER_DEG * Math.cos(rad(lat0));
  return {
    toLocal: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG],
    toLngLat: (x, y) => [lng0 + x / kx, lat0 + y / M_PER_DEG],
  };
}

/** Minimum-area oriented rectangle of a point set (tries every edge direction). */
export function minAreaRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const u = norm([b[0] - a[0], b[1] - a[1]]);
    const v = [-u[1], u[0]];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      const pu = dot(p, u), pv = dot(p, v);
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu); minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { area, u, v, extU: maxU - minU, extV: maxV - minV, center: [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv] };
    }
  }
  return best;
}

function nearestRoadDirection(center, roadsLocal) {
  let best = null;
  for (const line of roadsLocal) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((center[0] - ax) * dx + (center[1] - ay) * dy) / len2));
      const p = [ax + t * dx, ay + t * dy];
      const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
      if (!best || d < best.d) best = { d, p };
    }
  }
  return best ? norm([best.p[0] - center[0], best.p[1] - center[1]]) : null;
}

const SYNTHETIC = { widthM: 5.5, depthM: 9 }; // typical terrace when no outline exists

/**
 * Builds the site frame: which way the house faces, its width/depth, and a function P(s,d)
 *   s = metres to the right when standing in the street facing the house
 *   d = metres beyond the REAR wall (negative = inside the house, -D = front wall)
 */
export function buildFrame({ address, footprint, roads = [], camera = null, frontBearingDeg = null }) {
  const ring = footprint?.ring;
  const origin = ring ? ringCentroid(ring) : { lat: address.lat, lng: address.lng };
  const { toLocal, toLngLat } = localConverter(origin.lat, origin.lng);

  const pts = ring ? ring.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat)) : null;
  const rect = pts ? minAreaRect(pts) : null;
  const center = rect ? rect.center : [0, 0];

  // 1. which way is the FRONT of the house facing?
  let f = null, frontSource = 'assumed';
  if (frontBearingDeg != null) { f = [Math.sin(rad(frontBearingDeg)), Math.cos(rad(frontBearingDeg))]; frontSource = 'user'; }
  if (!f && roads.length) {
    const roadsLocal = roads.map((line) => line.map(([lng, lat]) => toLocal(lng, lat)));
    f = nearestRoadDirection(center, roadsLocal);
    if (f) frontSource = 'road';
  }
  if (!f && camera) {
    const c = toLocal(camera.lng, camera.lat);
    f = norm([c[0] - center[0], c[1] - center[1]]);
    frontSource = 'camera';
  }
  if (!f) f = [0, -1]; // assume the house faces south

  // 2. depth axis = the rectangle axis most aligned with the front direction; rear points away from the road
  let r, W, D;
  if (rect) {
    const [axisD, extD, extW] = Math.abs(dot(rect.u, f)) >= Math.abs(dot(rect.v, f)) ? [rect.u, rect.extU, rect.extV] : [rect.v, rect.extV, rect.extU];
    r = dot(axisD, f) <= 0 ? axisD : [-axisD[0], -axisD[1]];
    W = extW; D = extD;
  } else {
    r = [-f[0], -f[1]]; W = SYNTHETIC.widthM; D = SYNTHETIC.depthM;
  }
  const t = [r[1], -r[0]]; // right-hand direction when facing the rear
  const rearMid = [center[0] + r[0] * (D / 2), center[1] + r[1] * (D / 2)];
  const P = (s, d) => [rearMid[0] + t[0] * s + r[0] * d, rearMid[1] + t[1] * s + r[1] * d];

  return {
    origin, toLocal, toLngLat, P, W, D, synthetic: !rect, frontSource,
    frontBearingDeg: Math.round((deg(Math.atan2(f[0], f[1])) + 360) % 360),
  };
}

const spanS = (width, alignment, W) => {
  if (alignment === 'full' || width == null || width >= W) return [-W / 2, W / 2];
  if (alignment === 'left') return [-W / 2, -W / 2 + width];
  if (alignment === 'right') return [W / 2 - width, W / 2];
  return [-width / 2, width / 2];
};
const rect = (s0, s1, d0, d1) => [[s0, d0], [s1, d0], [s1, d1], [s0, d1]];
const polyArea = (pts) => Math.abs(pts.reduce((a, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + (x1 * y2 - x2 * y1); }, 0) / 2);

/** Local (s,d) polygon for each work type. Returns { pts, dims, label } */
const BUILDERS = {
  rear_extension: (p, { W }, off) => {
    const [s0, s1] = spanS(p.widthM, p.alignment, W);
    return { pts: rect(s0, s1, off, off + p.depthM), dims: { widthM: s1 - s0, depthM: p.depthM } };
  },
  side_extension: (p, { W, D }) => {
    const len = p.lengthM ?? D;
    const [s0, s1] = p.side === 'left' ? [-W / 2 - p.widthM, -W / 2] : [W / 2, W / 2 + p.widthM];
    return { pts: rect(s0, s1, -D, -D + len), dims: { widthM: p.widthM, depthM: len } };
  },
  wraparound_extension: (p, { W }, off) => {
    const sl = p.sideLengthM ?? 4, sw = p.widthM;
    const R = p.side !== 'left';
    const a = R ? -W / 2 : W / 2, b = R ? W / 2 + sw : -W / 2 - sw, c = R ? W / 2 : -W / 2;
    return {
      pts: [[a, off], [a, off + p.depthM], [b, off + p.depthM], [b, -sl], [c, -sl], [c, off]],
      dims: { widthM: W + sw, depthM: p.depthM },
    };
  },
  front_porch: (p, { W, D }) => ({ pts: rect(-p.widthM / 2, p.widthM / 2, -D - p.depthM, -D), dims: { widthM: p.widthM, depthM: p.depthM } }),
  rear_dormer: (p, { W, D }) => {
    const depth = Math.min(p.depthM, D / 2);
    const [s0, s1] = spanS(Math.min(p.widthM, W * 0.9), 'center', W);
    return { pts: rect(s0, s1, -depth, 0), dims: { widthM: s1 - s0, depthM: depth }, style: 'roof' };
  },
  additional_storey: (p, { W, D }) => ({ pts: rect(-W / 2, W / 2, -D, 0), dims: { widthM: W, depthM: D }, style: 'roof' }),
  outbuilding: (p, { W }, off) => {
    const [s0, s1] = spanS(p.widthM, p.alignment, Math.max(W, p.widthM + 0.1));
    const d0 = off + (p.setbackM ?? 5);
    return { pts: rect(s0, s1, d0, d0 + p.depthM), dims: { widthM: p.widthM, depthM: p.depthM } };
  },
};

/**
 * Turns the footprint, the existing extension and the applicant's proposal into map layers (lng/lat rings).
 * `existing.inOutline === false` means the OSM outline does NOT yet include the existing extension, so the
 * extension is drawn beyond the outline and new rear work starts after it.
 */
export function buildLayers({ frame, footprint, existing, proposal }) {
  const layers = [];
  const toRing = (sd) => {
    const ring = sd.map(([s, d]) => frame.toLngLat(...frame.P(s, d)));
    return [...ring, ring[0]];
  };

  const buildingRing = footprint?.ring ?? toRing(rect(-frame.W / 2, frame.W / 2, -frame.D, 0));
  layers.push({
    id: 'building', kind: 'building', label: frame.synthetic ? 'Indicative house outline' : 'Existing house',
    ring: buildingRing, areaM2: Math.round(footprint?.areaM2 ?? ringAreaM2(buildingRing)), indicative: frame.synthetic,
  });

  const exDepth = existing?.present ? existing.depthM ?? 0 : 0;
  let off = 0;
  if (exDepth > 0) {
    const [s0, s1] = spanS(existing.widthM, 'center', frame.W);
    const inside = existing.inOutline !== false;
    if (!inside) off = exDepth;
    const pts = inside ? rect(s0, s1, -exDepth, 0) : rect(s0, s1, 0, exDepth);
    layers.push({
      id: 'existing', kind: 'existing_extension', label: `Existing extension (c. ${exDepth} m)`,
      ring: toRing(pts), areaM2: Math.round(polyArea(pts)), indicative: true, dims: { widthM: s1 - s0, depthM: exDepth },
    });
  }

  if (proposal) {
    const b = BUILDERS[proposal.type](proposal, frame, off);
    layers.push({
      id: 'proposal', kind: 'proposal', workType: proposal.type, label: WORK_TYPES[proposal.type].label,
      ring: toRing(b.pts), areaM2: Math.round(polyArea(b.pts) * 10) / 10, dims: b.dims, style: b.style ?? 'solid',
    });
  }
  return layers;
}
