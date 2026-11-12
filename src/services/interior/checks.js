import { STD } from '../../data/interiorStandards.js';
import { headAt } from './layout.js';
import { overlapM2, pointInPoly } from './geometry.js';

/**
 * Checks on the INSIDE of the proposal. Two rules keep them honest:
 *  1. Only rooms the proposal creates are judged (`isNew`). The existing layout is a generated typical plan, and
 *     calling a made-up bedroom too small would be wrong.
 *  2. These are guidance (NDSS, Approved Documents), shown as warn / info, never as a planning or Building
 *     Regulations verdict. They never change the permitted-development result.
 * Statuses match the rest of the engine: fail / warn / pass / info.
 */
const m1 = (n) => `${Math.round(n * 10) / 10}`;
const m2 = (n) => `${Math.round(n * 100) / 100}`;

export function interiorChecks(model) {
  const items = [];
  const push = (status, id, message, extra = {}) => items.push({ status, id, message, ...extra });
  const news = model.rooms.filter((r) => r.isNew);
  if (!news.length) return items;
  const openings = model.openings ?? [], stairs = model.stairs ?? [];
  const modelled = openings.length > 0;                       // the applicant has drawn doors / windows, so they can be tested

  for (const r of news) {
    // --- bedrooms: size and width (NDSS) ---
    if (r.type === 'bedroom') {
      const s = STD.ndss.singleBedroom, d = STD.ndss.doubleBedroom;
      const area = r.areaM2;
      if (area >= d.areaM2 && r.widthM >= d.widthM) push('pass', `bed-size-${r.id}`, `${r.name}: ${m1(area)} m² and ${m2(r.widthM)} m wide is big enough for a double bedroom (${d.areaM2} m², ${d.widthM} m wide).`, { roomId: r.id, basis: STD.ndss.source });
      else if (area >= s.areaM2 && r.widthM >= s.widthM) push('info', `bed-size-${r.id}`, `${r.name}: ${m1(area)} m² and ${m2(r.widthM)} m wide suits a single bedroom (${s.areaM2} m², ${s.widthM} m wide) but is below the double bedroom size (${d.areaM2} m², ${d.widthM} m wide).`, { roomId: r.id, basis: STD.ndss.source });
      else push('warn', `bed-size-${r.id}`, `${r.name}: ${m1(area)} m² and ${m2(r.widthM)} m wide is below the single bedroom size (${s.areaM2} m², ${s.widthM} m wide).`, { roomId: r.id, basis: STD.ndss.source });
    }

    // --- ceiling height (NDSS: 2.3 m over at least 75% of the floor) ---
    if (r.slopedCeiling && r.headroom) {
      const h = r.headroom, counted = h.over1_5;
      const share = counted ? h.over2_3 / counted : 0;
      if (share >= STD.ndss.ceilingShare) push('pass', `head-${r.id}`, `${r.name}: ${Math.round(share * 100)}% of the floor has ${STD.ndss.ceilingM} m or more head height (guidance is ${Math.round(STD.ndss.ceilingShare * 100)}%).`, { roomId: r.id, basis: STD.ndss.source });
      else push('warn', `head-${r.id}`, `${r.name}: only ${Math.round(share * 100)}% of the floor has ${STD.ndss.ceilingM} m head height; ${m1(h.over2_2)} m² of ${m1(counted)} m² reaches about ${STD.rule.loftUsableHeadroomM} m, the usual height for a usable loft room.`, { roomId: r.id, basis: `${STD.ndss.source}; ${STD.rule.loftUsableHeadroomM} m is a rule of thumb` });
      if (h.over2_2 < 7.5 && r.type === 'bedroom') push('warn', `loft-usable-${r.id}`, `Only ${m1(h.over2_2)} m² of the loft has about ${STD.rule.loftUsableHeadroomM} m head height, less than a single bedroom needs (${STD.ndss.singleBedroom.areaM2} m²).`, { roomId: r.id, basis: 'rule of thumb' });
    } else if (r.ceilingM < STD.ndss.ceilingM && !['porch', 'garden_room', 'garage', 'storage'].includes(r.type)) {
      push('warn', `ceiling-${r.id}`, `${r.name}: ceiling about ${m2(r.ceilingM)} m, below the ${STD.ndss.ceilingM} m guidance. The height of the extension (${m1(r.ceilingM + STD.build.roofBuildupM)} m or so overall) leaves little room for floor and roof build-up.`, { roomId: r.id, basis: STD.ndss.source });
    }
  }

  // --- fire and stairs for work on upper floors ---
  const upperNew = news.filter((r) => r.storey >= 1 && r.habitable);
  const topFloorZ = Math.max(0, ...upperNew.map((r) => r.z0));
  if (upperNew.length) {
    const high = topFloorZ > STD.adB.protectedStairAboveM;
    push(high ? 'warn' : 'info', 'fire-protected-stair', high
      ? `The new floor is about ${m1(topFloorZ)} m above the ground, over ${STD.adB.protectedStairAboveM} m. A floor that high normally needs a protected stairway (fire-resisting walls and doors round the stairs down to the front door), which can take space from the rooms below. Ask Building Control early.`
      : `New rooms on an upper floor need a way out in a fire: a protected route or escape windows. Ask Building Control which applies.`, { basis: STD.adB.source });
    const w = STD.adB.escapeWindow;
    if (!modelled && upperNew.some((r) => r.type === 'bedroom')) push('info', 'escape-window', `Each new bedroom needs an escape window or door: opening of at least ${w.openableAreaM2} m², at least ${w.minHeightM * 1000} mm high and ${w.minWidthM * 1000} mm wide, with the bottom edge no more than ${w.maxSillM * 1000} mm above the floor. Window sizes are not drawn yet, so this is not tested.`, { basis: STD.adB.source });
  }
  if (model.loft && !stairs.length) {
    push('info', 'loft-stair', `A loft room needs a new stair. It usually takes floor space from the landing or a bedroom below, and needs at least ${STD.adK.stairHeadroomM} m head height over the stair (${STD.adK.loftStairHeadroomCentreM} m at the centre line is accepted in a loft conversion where space is tight). The stair is not drawn yet, so this is not tested.`, { basis: STD.adK.source });
  }
  if (model.loft) {
    if (model.proposal?.balcony) push('info', 'loft-balcony', 'A dormer with a balcony or terrace normally needs planning permission, and a balcony over a neighbour\u2019s garden raises privacy questions.', { basis: 'planning practice' });
  }

  // --- doors and windows the applicant drew: tested on the new rooms ---
  const on = (room, kind) => openings.filter((o) => o.roomIds.includes(room.id) && o.kind === kind);
  const clear = (o) => ({ w: Math.max(0, o.widthM - 0.1), h: Math.max(0, o.heightM - 0.1) });   // frame allowance: clear opening is about 50 mm smaller each way
  if (modelled) {
    for (const r of news.filter((q) => !q.slopedCeiling)) {
      const wins = on(r, 'window'), opens = wins.filter((o) => !o.fixed);
      if (!on(r, 'door').length && r.type !== 'garden_room') push('warn', `door-${r.id}`, `${r.name}: no door drawn, so there is no way in. Add a door (or a doorway) on one of its walls.`, { roomId: r.id });
      if (r.type === 'bedroom' && r.storey >= 1) {
        const e = STD.adB.escapeWindow;
        const good = opens.some((o) => { const c = clear(o); return o.sillM <= e.maxSillM && c.w >= e.minWidthM && c.h >= e.minHeightM && c.w * c.h >= e.openableAreaM2; });
        if (good) push('pass', `escape-${r.id}`, `${r.name}: has a window that can serve as an escape window (about ${e.openableAreaM2} m² clear, sill no higher than ${e.maxSillM * 1000} mm). Confirm the real opening size on the window you choose.`, { roomId: r.id, basis: STD.adB.source });
        else push('warn', `escape-${r.id}`, wins.length
          ? `${r.name}: none of its windows meets the escape window size (opening of at least ${e.openableAreaM2} m², ${e.minHeightM * 1000} mm high and wide, sill no higher than ${e.maxSillM * 1000} mm). Check the sill height and that the window opens.`
          : `${r.name}: no window drawn. An upper-floor bedroom needs an escape window (opening of at least ${e.openableAreaM2} m², sill no higher than ${e.maxSillM * 1000} mm).`, { roomId: r.id, basis: STD.adB.source });
      }
      if (r.habitable) {
        const purge = opens.reduce((a, o) => { const c = clear(o); return a + c.w * c.h; }, 0), need = r.areaM2 * STD.adF.purgeVentilationShare;
        if (purge >= need) push('pass', `vent-${r.id}`, `${r.name}: openable windows give about ${m2(purge)} m², above the ${m2(need)} m² (1/20 of the floor) suggested for purge ventilation.`, { roomId: r.id, basis: STD.adF.source });
        else push('warn', `vent-${r.id}`, `${r.name}: openable windows give about ${m2(purge)} m², below the ${m2(need)} m² (1/20 of the floor) suggested for purge ventilation. Add or enlarge an opening window.`, { roomId: r.id, basis: STD.adF.source });
      }
    }
  }

  // --- stairs the applicant drew ---
  const A = STD.adK, topIdx = model.nStoreys - 1;
  for (const t of stairs) {
    const issues = [];
    if (t.goingM < A.minGoingM) issues.push(`each step is only ${m2(t.goingM)} m deep (at least ${A.minGoingM} m)`);
    if (t.pitchDeg > A.maxPitchDeg) issues.push(`it climbs at ${t.pitchDeg}° (at most ${A.maxPitchDeg}°)`);
    const label = `Stair from ${model.storeys[t.storey]?.label.toLowerCase() ?? 'floor ' + t.storey}`;
    if (issues.length) push('warn', `stair-${t.id}`, `${label}: ${issues.join(' and ')}. ${t.steps} steps of ${m2(t.riserM)} m rise are needed over ${m2(t.lengthM)} m; lengthen it or make it turn.`, { basis: A.source });
    else push('pass', `stair-${t.id}`, `${label}: ${t.steps} steps of ${m2(t.riserM)} m rise and ${m2(t.goingM)} m going over ${m2(t.lengthM)} m, ${t.pitchDeg}° pitch, within the private-stair limits.`, { basis: A.source });
    if (t.widthM < A.usualMinWidthM) push('info', `stair-width-${t.id}`, `${label} is ${m2(t.widthM)} m wide; about ${A.usualMinWidthM} m is the usual minimum.`, { basis: 'rule of thumb' });
    // head height under the floor above, along the line of travel (only where that floor is a drawn full floor)
    const above = model.rooms.filter((r) => r.storey === t.storey + 1 && !r.slopedCeiling);
    if (above.length) {
      const tanP = Math.tan((t.pitchDeg * Math.PI) / 180), c = [(t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2];
      const sgn = t.dir[0] === '+' ? 1 : -1, alongX = t.dir[1] === 'x';
      const start = alongX ? [sgn > 0 ? t.box.x0 : t.box.x1, c[1]] : [c[0], sgn > 0 ? t.box.y0 : t.box.y1];
      let bad = null;
      for (let d = 0.05; d < t.lengthM && bad == null; d += 0.05) {
        if (d * tanP <= model.ceilingM - A.stairHeadroomM) continue;      // pitch line still low enough: 2.0 m clear under the soffit
        const p = alongX ? [start[0] + sgn * d, start[1]] : [start[0], start[1] + sgn * d];
        if (above.some((r) => pointInPoly(p, r.poly))) bad = d;
      }
      if (bad != null) push('warn', `stair-head-${t.id}`, `${label}: the floor above covers the stair from about ${m2(bad)} m along it, where head height drops below ${A.stairHeadroomM} m. Leave an opening in the floor above (draw the upper rooms around the stairwell).`, { basis: A.source });
    }
    // arriving in a new loft: head height at the top of the flight
    if (t.storey === topIdx && model.loft) {
      const D = model.D, c = [(t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2];
      const topY = t.dir === '+y' ? t.box.y1 : t.dir === '-y' ? t.box.y0 : c[1];
      let head = headAt(topY, D, model.roof.pitchDeg);
      const dm = model.loft.dormer;
      if (dm && c[0] >= dm.x0 && c[0] <= dm.x1 && topY >= dm.y0) head = Math.max(head, dm.heightM);
      if (head < A.loftStairHeadroomCentreM) push('warn', `loft-stair-head-${t.id}`, `The stair reaches the loft where the roof leaves only about ${m2(head)} m head height (${A.loftStairHeadroomCentreM} m at the centre line is the loft conversion minimum). Move the stair towards the ridge or under the dormer.`, { basis: A.source });
      else push('pass', `loft-stair-head-${t.id}`, `The stair reaches the loft with about ${m2(head)} m head height at the top (${A.loftStairHeadroomCentreM} m needed at the centre line).`, { basis: A.source });
    }
  }
  const needsStair = model.loft ? topIdx : model.proposal?.kind === 'additional_storey' ? topIdx : null;
  if (needsStair != null && stairs.length && !stairs.some((t) => t.storey === needsStair)) {
    push('warn', 'stair-missing', `No stair is drawn up to the ${model.loft ? 'loft' : 'new floor'}. Draw one on the ${model.storeys[needsStair]?.label.toLowerCase()} plan; it normally takes space from a room or the landing.`, { basis: A.source });
  }

  // --- the applicant's drawn rooms against the new work ---
  for (const r of model.rooms.filter((q) => q.userDrawn)) for (const n of news.filter((q) => q.storey === r.storey && !q.slopedCeiling)) {
    const o = overlapM2(r.poly, n.poly);
    if (o > 0.05) push('warn', `overlap-${r.id}-${n.id}`, `${r.name} (drawn) overlaps ${n.name.toLowerCase()} by ${m2(o)} m². Move the drawn wall back to the edge of the existing house.`, { roomId: r.id });
  }

  // --- extension joined to the house ---
  const ground = news.filter((r) => r.storey === 0 && ['kitchen_diner', 'utility'].includes(r.type) && r.id !== 'new-outbuilding' && r.id !== 'new-drawn');
  if (ground.length && model.proposal && ['rear_extension', 'wraparound_extension'].includes(model.proposal.kind)) {
    push('info', 'borrowed-light', 'The extension covers the back wall of the house, so the existing rear windows become internal. The room behind them now gets its light and air through the extension, so check the glazing and rooflights serve both, and ventilation (purge ventilation is about 1/20 of the floor area, Approved Document F).', { basis: STD.adF.source });
  }
  if (model.proposal?.kind === 'outbuilding') {
    push('info', 'outbuilding-use', 'A garden outbuilding under permitted development must stay incidental to the house (a home office, gym or store). Sleeping or a self-contained annexe normally needs planning permission.', { basis: 'GPDO Part 1 Class E' });
  }
  if (model.proposal?.kind === 'additional_storey') {
    push('info', 'storey-structure', 'The walls and foundations must carry an extra storey, and the roof is rebuilt. A structural engineer\u2019s report is normally part of the application.', { basis: 'Building Regulations Part A' });
  }
  return items;
}

/** Floor areas worth showing next to the verdict. Existing figures come from the generated layout and say so. */
export function interiorTotals(model) {
  const sum = (rs) => Math.round(rs.reduce((a, r) => a + r.areaM2, 0) * 10) / 10;
  const existing = model.rooms.filter((r) => !r.isNew && r.storey < model.nStoreys);
  const news = model.rooms.filter((r) => r.isNew);
  const beds = (rs) => rs.filter((r) => r.type === 'bedroom').length;
  const loft = model.rooms.find((r) => r.id === 'new-loft');
  return {
    existingFloorM2: sum(existing), existingBasis: existing.some((r) => r.userDrawn) ? 'rooms as drawn by you' : 'typical layout from the outline (not surveyed)',
    newFloorM2: sum(news), newRooms: news.length,
    bedroomsBefore: beds(existing), bedroomsAfter: beds(existing) + beds(news),
    loftUsableM2: loft?.headroom?.over2_2 ?? null,
  };
}
