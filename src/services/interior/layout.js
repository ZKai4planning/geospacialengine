import { STD, ROOM_TYPES } from '../../data/interiorStandards.js';
import { attachOpenings, buildStairs } from './features.js';

/**
 * Interior model in the HOUSE frame, in metres:
 *   x = across the house (0 = left edge of the main block, W = right edge)
 *   y = from the FRONT wall (0) to the REAR wall (D); beyond the rear wall y > D
 *   z = up, 0 = ground floor level
 * (x = s + W/2 and y = d + D, where s and d are the map engine's own frame coordinates, so the 3D model and the
 *  map overlay always line up.)
 *
 * Nothing in here is surveyed. The existing rooms are a TYPICAL layout generated from the outline (flagged `assumed`)
 * so the proposal can be seen in context; the rooms the PROPOSAL creates are exact in size, because they come from the
 * dimensions the applicant typed or drew. Checks therefore only judge the new rooms (see checks.js).
 */
const r2 = (n) => Math.round(n * 100) / 100;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const centroid = (pts) => {
  const b = bbox(pts);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return Math.abs(a) < 1e-9 ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [cx / (3 * a), cy / (3 * a)];
};
/** A room's "width": the shorter side of its bounding box for a rectangle, a plain-average estimate for an L-shape. */
const roomWidth = (pts) => {
  const b = bbox(pts), w = b.x1 - b.x0, h = b.y1 - b.y0, area = polyArea(pts);
  return Math.abs(area - w * h) < 0.05 ? Math.min(w, h) : area / Math.max(w, h);
};

function makeRoom({ id, name, type, storey, poly, ceilingM, z0, isNew = false, assumed = false, note = null, extra = {} }) {
  const area = polyArea(poly), c = centroid(poly);
  return {
    id, name: name ?? ROOM_TYPES[type]?.label ?? 'Room', type, storey, poly: poly.map(([x, y]) => [r2(x), r2(y)]),
    areaM2: Math.round(area * 10) / 10, widthM: r2(roomWidth(poly)), centre: [r2(c[0]), r2(c[1])],
    z0: r2(z0), ceilingM: r2(ceilingM), isNew, assumed, habitable: ROOM_TYPES[type]?.habitable ?? false, note, ...extra,
  };
}

/** Storey floor levels: storey i has its floor at z = i * (ceiling + slab). */
export const storeyZ = (i, ceilingM = STD.build.ceilingM) => i * (ceilingM + STD.build.slabM);
const STOREY_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor'];

/** A typical UK house plan inside a W x D block. Used only to give the proposal a context. */
function typicalPlan({ W, D, storeys, ceilingM, exInside }) {
  const hallW = W >= 3.6 ? STD.build.hallWidthM : 0;
  const depthExt = exInside ? Math.min(exInside, D * 0.45) : 0;
  const yK = r2(D * 0.62);                         // where the kitchen starts
  const yMid = r2(D * 0.38);
  const hasDining = D >= 7.5;
  const out = [];
  const add = (storey, id, name, type, poly) => out.push(makeRoom({ id, name, type, storey, poly, ceilingM, z0: storeyZ(storey, ceilingM), assumed: true }));

  // ground floor
  if (hallW) add(0, 'ex-g-hall', 'Hall and stairs', 'hall', rect(0, 0, hallW, yK));
  const gx0 = hallW;
  if (hasDining) {
    add(0, 'ex-g-living', 'Living room', 'living', rect(gx0, 0, W, yMid));
    add(0, 'ex-g-dining', 'Dining room', 'dining', rect(gx0, yMid, W, yK));
  } else add(0, 'ex-g-living', 'Living room', 'living', rect(gx0, 0, W, yK));
  const kitchenEnd = D - depthExt;
  add(0, 'ex-g-kitchen', 'Kitchen', 'kitchen', rect(0, yK, W, kitchenEnd));
  if (depthExt > 0) add(0, 'ex-g-ext', 'Existing rear extension', 'utility', rect(0, kitchenEnd, W, D));

  // upper floors (everything above the ground floor repeats the same pattern)
  const upperD = D - depthExt;                        // a single-storey rear extension has no floor above it
  for (let s = 1; s < storeys; s++) {
    const p = s === 1 ? '1' : String(s);
    const bathD = Math.min(2.3, upperD * 0.28);
    const yBath = r2(upperD - bathD);
    const yBed = r2(upperD * 0.5);
    if (hallW) add(s, `ex-${p}-landing`, 'Landing', 'landing', rect(0, 0, hallW, yBath));
    const x0 = hallW;
    add(s, `ex-${p}-bed1`, 'Bedroom 1', 'bedroom', rect(x0, 0, W, yBed));
    add(s, `ex-${p}-bed2`, 'Bedroom 2', 'bedroom', rect(x0, yBed, W, yBath));
    add(s, `ex-${p}-bath`, 'Bathroom', 'bathroom', rect(hallW ? 0 : x0, yBath, W, upperD));
    if (!hallW) { /* very narrow house: no hall strip, the stairs sit inside the rooms (not modelled) */ }
  }
  return { rooms: out, hallW, exDepth: depthExt };
}

/** Mirrors a polygon left-right inside a block of width W (used when the stairs are on the other side). */
const mirrorX = (poly, W) => poly.map(([x, y]) => [W - x, y]).reverse();

/** Roof over the main block. Ridge runs ACROSS the house (parallel to the street): slopes face front and rear. */
function roofFor({ W, D, topZ, roofType, lidar, extraRaiseM = 0 }) {
  const type = roofType === 'Flat' ? 'flat' : roofType === 'Hipped' ? 'hipped' : 'pitched';
  const eavesZ = topZ;                                 // top of the highest ceiling + slab = wall plate
  let pitchDeg = STD.build.defaultPitchDeg, source = 'assumed';
  const lidarOk = lidar && lidar.status !== 'unavailable' && lidar.status !== 'unclear' && Number.isFinite(lidar.eavesM) && Number.isFinite(lidar.ridgeM);
  if (type !== 'flat' && lidarOk && lidar.roofShape === 'pitched' && lidar.ridgeM > lidar.eavesM + 0.3) {
    pitchDeg = (Math.atan((lidar.ridgeM - lidar.eavesM) / (D / 2)) * 180) / Math.PI;
    pitchDeg = Math.min(60, Math.max(15, pitchDeg));
    source = 'lidar';
  }
  const rise = (D / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  return {
    type, eavesM: r2(eavesZ + extraRaiseM), ridgeM: r2(type === 'flat' ? eavesZ + extraRaiseM + 0.15 : eavesZ + extraRaiseM + rise),
    pitchDeg: Math.round(pitchDeg * 10) / 10, ridgeAxis: 'x', source,
  };
}

/** Head height under a pitched roof at depth y, measured from the loft floor (taken at the eaves line). */
export const headAt = (y, D, pitchDeg) => Math.max(0, Math.min(y, D - y)) * Math.tan((pitchDeg * Math.PI) / 180);

/** Floor area of a loft with the given pitch, split by head height; dormer raises its own footprint to `dormerH`. */
export function loftHeadroom({ W, D, pitchDeg, dormer = null }) {
  const step = 0.1;
  let over15 = 0, over20 = 0, over22 = 0, over23 = 0, ridge = 0;
  for (let x = step / 2; x < W; x += step) {
    for (let y = step / 2; y < D; y += step) {
      let h = headAt(y, D, pitchDeg);
      if (dormer && x >= dormer.x0 && x <= dormer.x1 && y >= dormer.y0) h = Math.max(h, dormer.heightM);
      const a = step * step;
      if (h >= 1.5) over15 += a; if (h >= 2.0) over20 += a; if (h >= STD.rule.loftUsableHeadroomM) over22 += a; if (h >= STD.ndss.ceilingM) over23 += a;
      ridge = Math.max(ridge, h);
    }
  }
  const r = (n) => Math.round(n * 10) / 10;
  return { over1_5: r(over15), over2_0: r(over20), over2_2: r(over22), over2_3: r(over23), maxHeadM: r2(ridge) };
}

/** Ceiling height inside an extension of overall height `heightM` with `n` storeys. */
const extCeiling = (heightM, n) => Math.max(1.8, (heightM - STD.build.roofBuildupM - (n - 1) * STD.build.slabM) / n);

/**
 * @param {object} i
 * @param {number} i.W,D            house block width / depth (m) from the map frame
 * @param {number|null} i.storeys   storeys in the main house (null = assume 2, said in `assumptions`)
 * @param {string|null} i.roofType  'Pitched' | 'Flat' | 'Hipped' | 'Mixed' | null
 * @param {string} i.form           'detached' | 'semi' | 'terraced' | 'other'
 * @param {object|null} i.lidar     roof analysis (eavesM, ridgeM, roofShape, status)
 * @param {object|null} i.existing  profile.existingExtension { present, depthM, widthM, inOutline }
 * @param {object|null} i.proposal  the applicant's proposal (work type + dimensions), already in house-frame terms
 * @param {(ring:number[][])=>number[][]} i.ringToSD  drawn ring (lng,lat) -> (s,d) points, for custom shapes
 */
export function buildLayout({ W, D, storeys, roofType, form = 'other', lidar = null, existing = null, proposal = null, ringToSD = null, setup = {} }) {
  const assumptions = [];
  const drawn = setup.layout?.storeys?.length ? setup.layout : null;     // rooms the applicant drew in the floor-plan editor
  const nStoreys = drawn ? Math.min(4, Math.max(...drawn.storeys.map((s) => s.index)) + 1) : Math.min(4, Math.max(1, Math.round(setup.storeys ?? storeys ?? 2)));
  if (!drawn && setup.storeys == null && storeys == null) assumptions.push('Number of storeys not confirmed: two assumed.');
  const ceilingM = setup.ceilingM ?? STD.build.ceilingM;
  const exPresent = !!existing?.present && (existing.depthM ?? 0) > 0;
  const exDepth = exPresent ? Math.min(existing.depthM, 12) : 0;
  const exInside = exPresent && existing.inOutline !== false;
  const exOutside = exPresent && existing.inOutline === false;
  const exWidth = Math.min(W, existing?.widthM ?? W);
  if (!drawn && exPresent && exWidth < W - 0.3) assumptions.push('The existing extension is drawn the full width of the house.');
  assumptions.push(drawn ? 'Rooms are as you drew them. Walls are drawn at room edges; only the doors, windows and stairs you add are shown.' : 'Existing rooms are a typical layout generated from the outline, not a survey.');

  // ---------- existing house ----------
  const plan = drawn
    ? { hallW: 0, exDepth: 0, rooms: drawn.storeys.flatMap((st) => st.rooms.map((r) => makeRoom({ id: r.id, name: r.name || undefined, type: r.type, storey: st.index, poly: r.poly, ceilingM, z0: storeyZ(st.index, ceilingM), extra: { userDrawn: true } }))) }
    : typicalPlan({ W, D, storeys: nStoreys, ceilingM, exInside: exInside ? exDepth : 0 });
  let rooms = plan.rooms;
  if (!drawn && setup.hallSide === 'right') rooms = rooms.map((r) => ({ ...r, poly: mirrorX(r.poly, W), centre: [r2(W - r.centre[0]), r.centre[1]] }));
  if (exOutside && !drawn) {
    rooms.push(makeRoom({ id: 'ex-g-ext', name: 'Existing rear extension', type: 'utility', storey: 0, poly: rect(0, D, W, D + exDepth), ceilingM, z0: 0, assumed: true }));
  }

  const topZ = storeyZ(nStoreys, ceilingM) - 0.0;           // wall plate: top of the highest ceiling + slab
  let raise = 0;
  const added = [];                                          // rooms the proposal creates
  const volumes = [];                                        // extra solid shapes to draw (roof dormer shell, new storey, porch roof...)
  let proposalInfo = null;
  const off = exOutside ? exDepth : 0;
  const span = (width, alignment) => {
    if (alignment === 'full' || width == null || width >= W) return [0, W];
    if (alignment === 'left') return [0, width];
    if (alignment === 'right') return [W - width, W];
    return [(W - width) / 2, (W + width) / 2];
  };
  const newRoom = (o) => added.push(makeRoom({ ...o, isNew: true }));

  if (proposal) {
    const p = proposal, type = p.type;
    const n = Math.min(2, Math.max(1, p.storeys ?? 1));
    const label = p.label ?? type;
    if (type === 'rear_extension') {
      const [x0, x1] = span(p.widthM, p.alignment);
      const c = extCeiling(p.heightM ?? 3, n);
      for (let s = 0; s < n; s++) newRoom({ id: `new-ext-${s}`, name: s === 0 ? 'New rear extension' : 'New rear extension (first floor)', type: s === 0 ? 'kitchen_diner' : 'bedroom', storey: s, poly: rect(x0, D + off, x1, D + off + p.depthM), ceilingM: c, z0: storeyZ(s, ceilingM) });
      proposalInfo = { kind: type, label: 'Rear extension', heightM: p.heightM ?? 3, eavesM: p.eavesHeightM ?? null, storeys: n, roof: n === 1 ? 'flat' : 'pitched-or-flat' };
    } else if (type === 'side_extension') {
      const len = p.lengthM ?? D, [x0, x1] = p.side === 'left' ? [-p.widthM, 0] : [W, W + p.widthM];
      const c = extCeiling(p.heightM ?? 3, n);
      for (let s = 0; s < n; s++) newRoom({ id: `new-side-${s}`, name: s === 0 ? 'New side extension' : 'New side extension (first floor)', type: s === 0 ? 'utility' : 'bedroom', storey: s, poly: rect(x0, 0, x1, len), ceilingM: c, z0: storeyZ(s, ceilingM) });
      proposalInfo = { kind: type, label: 'Side extension', heightM: p.heightM ?? 3, storeys: n, side: p.side ?? 'right' };
    } else if (type === 'wraparound_extension') {
      const sl = p.sideLengthM ?? 4, sw = p.widthM, R = p.side !== 'left';
      const a = R ? 0 : W, b = R ? W + sw : -sw, c0 = R ? W : 0;
      const poly = [[a, D + off], [a, D + off + p.depthM], [b, D + off + p.depthM], [b, D - sl], [c0, D - sl], [c0, D + off]];
      newRoom({ id: 'new-wrap-0', name: 'New wraparound extension', type: 'kitchen_diner', storey: 0, poly, ceilingM: extCeiling(p.heightM ?? 3, 1), z0: 0 });
      proposalInfo = { kind: type, label: 'Wraparound extension', heightM: p.heightM ?? 3, storeys: 1, side: p.side ?? 'right' };
    } else if (type === 'front_porch') {
      newRoom({ id: 'new-porch', name: 'New porch', type: 'porch', storey: 0, poly: rect((W - p.widthM) / 2, -p.depthM, (W + p.widthM) / 2, 0), ceilingM: Math.max(1.8, (p.heightM ?? 2.8) - 0.3), z0: 0 });
      proposalInfo = { kind: type, label: 'Front porch', heightM: p.heightM ?? 2.8, storeys: 1 };
    } else if (type === 'outbuilding') {
      const [x0, x1] = span(p.widthM, p.alignment ?? 'center');
      const xs0 = x1 - x0 < p.widthM ? (W - p.widthM) / 2 : x0, xs1 = xs0 + p.widthM;
      const y0 = D + off + (p.setbackM ?? 5);
      newRoom({ id: 'new-outbuilding', name: 'New garden outbuilding', type: 'garden_room', storey: 0, poly: rect(xs0, y0, xs1, y0 + p.depthM), ceilingM: Math.max(1.8, (p.heightM ?? 2.5) - 0.3), z0: 0 });
      proposalInfo = { kind: type, label: 'Garden outbuilding', heightM: p.heightM ?? 2.5, storeys: 1 };
    } else if (type === 'additional_storey' && drawn) {
      const s = nStoreys, topRooms = rooms.filter((r) => r.storey === s - 1);
      topRooms.forEach((r, i) => newRoom({ id: `new-storey-${i}`, name: `New ${r.name.toLowerCase()}`, type: r.type, storey: s, poly: r.poly, ceilingM, z0: storeyZ(s, ceilingM) }));
      raise = ceilingM + STD.build.slabM;
      proposalInfo = { kind: type, label: 'Additional storey', heightM: p.heightM ?? null, storeys: 1, raisesRoofM: r2(raise) };
    } else if (type === 'additional_storey') {
      const s = nStoreys;
      const bathD = Math.min(2.3, (D - plan.exDepth) * 0.28), upperD = D - plan.exDepth, yBath = upperD - bathD, yBed = upperD * 0.5, h = plan.hallW;
      const mk = (id, name, t, poly) => newRoom({ id, name, type: t, storey: s, poly: setup.hallSide === 'right' ? mirrorX(poly, W) : poly, ceilingM, z0: storeyZ(s, ceilingM) });
      if (h) mk('new-storey-landing', 'New landing', 'landing', rect(0, 0, h, yBath));
      mk('new-storey-bed1', 'New bedroom 1', 'bedroom', rect(h, 0, W, yBed));
      mk('new-storey-bed2', 'New bedroom 2', 'bedroom', rect(h, yBed, W, yBath));
      mk('new-storey-bath', 'New bathroom', 'bathroom', rect(h ? 0 : h, yBath, W, upperD));
      raise = ceilingM + STD.build.slabM;
      proposalInfo = { kind: type, label: 'Additional storey', heightM: p.heightM ?? null, storeys: 1, raisesRoofM: r2(raise) };
    } else if (type === 'rear_dormer') {
      // handled below: needs the roof pitch
    } else if (type === 'custom_polygon' && ringToSD) {
      const sd = ringToSD(p.ring).map(([s, d]) => [s + W / 2, d + D]);
      const treat = p.treatAs ?? 'rear_extension';
      const c = extCeiling(p.heightM ?? 3, 1);
      newRoom({ id: 'new-drawn', name: 'New drawn building', type: treat === 'outbuilding' ? 'garden_room' : 'kitchen_diner', storey: 0, poly: sd, ceilingM: c, z0: 0 });
      proposalInfo = { kind: type, label: 'Drawn shape', heightM: p.heightM ?? 3, storeys: 1, treatAs: treat };
    }
  }

  // ---------- roof (after any extra storey) ----------
  const topZNow = topZ + raise;
  const roof = roofFor({ W, D, topZ, roofType, lidar, extraRaiseM: raise });
  if (roofType == null) assumptions.push('Roof type not confirmed: a pitched roof with the ridge along the street is assumed.');
  if (roof.source === 'assumed' && roof.type !== 'flat') assumptions.push(`Roof pitch assumed at ${roof.pitchDeg} degrees (no LiDAR roof height available).`);
  if (form === 'detached' || form === 'semi') assumptions.push('The roof ridge is assumed to run across the house (parallel to the street); gable-to-street roofs are not modelled.');

  // rear dormer: needs the roof pitch for head heights
  let loft = null;
  if (proposal?.type === 'rear_dormer' && roof.type !== 'flat') {
    const p = proposal;
    const dw = Math.min(p.widthM, W * 0.9), dd = Math.min(p.depthM, D / 2);
    const dx0 = (W - dw) / 2, dx1 = (W + dw) / 2;
    const dormer = { x0: dx0, x1: dx1, y0: D - dd, heightM: p.heightM ?? 2.3 };
    const hr = loftHeadroom({ W, D, pitchDeg: roof.pitchDeg, dormer });
    // loft floor plan: the part of the roof space with at least 1.5 m head height, plus the dormer's footprint
    const t = Math.tan((roof.pitchDeg * Math.PI) / 180), yLo = 1.5 / t, yHi = D - 1.5 / t;
    const yB = Math.max(yHi, dormer.y0);
    const poly = dw >= W - 0.05 ? rect(0, yLo, W, D)
      : [[0, yLo], [W, yLo], [W, yB], [dx1, yB], [dx1, D], [dx0, D], [dx0, yB], [0, yB]];
    const room = makeRoom({
      id: 'new-loft', name: 'New loft room', type: setup.loftUse === 'study' ? 'study' : setup.loftUse === 'storage' ? 'storage' : 'bedroom',
      storey: nStoreys, poly, ceilingM: Math.max(hr.maxHeadM, dormer.heightM), z0: topZ, isNew: true,
      extra: { headroom: hr, slopedCeiling: true, floorAboveGroundM: r2(topZ) },
    });
    added.push(room);
    loft = { ...hr, dormer: { widthM: r2(dw), depthM: r2(dd), heightM: dormer.heightM, x0: r2(dx0), x1: r2(dx1), y0: r2(dormer.y0) }, floorAboveGroundM: r2(topZ) };
    proposalInfo = { kind: 'rear_dormer', label: 'Loft dormer', heightM: dormer.heightM, storeys: 1, balcony: !!p.balcony };
  } else if (proposal?.type === 'rear_dormer') {
    assumptions.push('A dormer needs a pitched roof: the roof is flat or unknown, so no loft room is drawn.');
  }

  rooms = [...rooms, ...added];

  // names and uses the applicant changed
  if (setup.rooms) {
    rooms = rooms.map((r) => {
      const o = setup.rooms[r.id];
      if (!o) return r;
      const type = o.type && ROOM_TYPES[o.type] ? o.type : r.type;
      return { ...r, name: o.name?.trim() || (o.type ? ROOM_TYPES[type].label : r.name), type, habitable: ROOM_TYPES[type].habitable, userEdited: true };
    });
  }

  const storeyList = [];
  const maxStorey = Math.max(nStoreys - 1 + (loft ? 1 : 0) + (raise ? 1 : 0), ...rooms.map((r) => r.storey));
  for (let s = 0; s <= maxStorey; s++) {
    const isLoft = loft && s === nStoreys && !raise;
    storeyList.push({ index: s, label: isLoft ? 'Loft' : STOREY_NAMES[s] ?? `Floor ${s}`, z0: r2(isLoft ? topZ : storeyZ(s, ceilingM)), ceilingM: r2(ceilingM), roomIds: rooms.filter((r) => r.storey === s).map((r) => r.id) });
  }

  // doors, windows and stairs (only the applicant can draw these; the typical layout has none)
  const { openings, orphans } = attachOpenings(drawn, rooms);
  const stairs = buildStairs(drawn, { ceilingM });
  if (orphans) assumptions.push(`${orphans} door${orphans > 1 ? 's or windows' : ' or window'} no longer sit on a wall (a room or the proposal moved) and were left out.`);

  return {
    W: r2(W), D: r2(D), nStoreys, ceilingM: r2(ceilingM), form, rooms, storeys: storeyList, openings, stairs,
    shell: { outline: rect(0, 0, W, D), wallTopM: r2(topZNow), exOutsideDepthM: exOutside ? r2(exDepth) : 0, partyWalls: form === 'terraced' ? ['left', 'right'] : form === 'semi' ? ['one side'] : [] },
    roof, loft, volumes, proposal: proposalInfo, assumptions,
  };
}

export { rect, centroid, bbox, makeRoom };
