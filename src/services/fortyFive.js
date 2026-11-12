/**
 * The council's "45-degree rule" (Waltham Forest SPD 5.2.1, and most London boroughs): from the middle of the neighbour's nearest
 * ground-floor habitable-room window, draw a line at 45 degrees to the back wall in plan. A rear extension should not cross it.
 * So at a sideways distance u from the window, the extension may reach no further than u beyond the wall; directly in front of the window, not at all.
 *
 * Pure geometry in local metres (x east, y north). The window point is taken to be on the plane of the neighbour's back wall.
 *   P              proposal polygon [[x,y],...] (open)
 *   window         [x,y] of the marked window
 *   rearBearingDeg compass bearing of "away from the house front" (the direction the garden lies)
 * Returns { status: 'clear' | 'breach', excessM, dir: [dx,dy] unit vector of the 45-degree line, allowedAtWorstM }.
 */
export function fortyFiveTest({ P, window, rearBearingDeg }) {
  const a = (rearBearingDeg * Math.PI) / 180, rear = [Math.sin(a), Math.cos(a)];
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  let side = [rear[1], -rear[0]];
  if ((cx - window[0]) * side[0] + (cy - window[1]) * side[1] < 0) side = [-side[0], -side[1]];   // towards the proposal
  let excess = 0, allowedAtWorst = null;
  for (const p of P) {
    const dx = p[0] - window[0], dy = p[1] - window[1], v = dx * rear[0] + dy * rear[1], u = dx * side[0] + dy * side[1];
    if (v <= 0) continue;                                                                          // not beyond the neighbour's back wall
    const allowed = Math.max(u, 0), over = v - allowed;
    if (over > excess) { excess = over; allowedAtWorst = allowed; }
  }
  const s = Math.SQRT1_2;
  return { status: excess > 0.05 ? 'breach' : 'clear', excessM: Math.round(excess * 10) / 10, allowedAtWorstM: allowedAtWorst == null ? null : Math.round(allowedAtWorst * 10) / 10, dir: [rear[0] * s + side[0] * s, rear[1] * s + side[1] * s] };
}
