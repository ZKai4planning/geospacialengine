import { wallContacts, pointInPoly, centroid } from '../../utils/polygons.js';
import { dirOf, r1 } from './util.js';

/**
 * WALL SAFETY. Looks at each NEW outside wall of the proposal on its own (not the footprint as a whole) and asks three questions:
 *   1. Is it built hard against a neighbour's building?          -> Party Wall etc. Act notice, no fixing into / cutting into their wall, roof junction to agree
 *   2. Is it on the (registered) boundary line?                  -> fire-resistant wall, no openings, nothing may overhang or lean on their land, foundations on your side
 *   3. Is it within 1 m of the boundary / a neighbour's wall?    -> Building Regulations (Approved Document B): limits on windows / doors ("unprotected area"), maintenance access
 * A wall that simply continues the applicant's own house ("internal": it lies against the house outline) is not an outside wall and is skipped.
 *
 * Only a REGISTERED title boundary is used for questions 2 and 3; an estimated plot outline is never a boundary, so it is never used here (neighbour outlines still are).
 * These are guidance notes ('warn' / 'info' / 'pass'): they never change the permitted-development verdict. The per-wall records go to result.walls (drawn on the map and in the engine view).
 *
 * result.walls[i] = { index, from, to, lengthM, facing, kind: 'internal' | 'external', status, neighbour?, boundary?, notes[] }
 *   status: internal | overlaps_neighbour | touches_neighbour | on_boundary | within_1m | close_neighbour | clear | unchecked
 */
export const WALL_STATUS_ORDER = ['overlaps_neighbour', 'touches_neighbour', 'on_boundary', 'within_1m', 'close_neighbour', 'clear', 'unchecked', 'internal'];

export const wallSafetyRule = {
  id: 'wall-safety',
  run({ P, H, from, T, neighbours, plot }, result) {
    // contact is measured within wallTouchM of the line, so a wall that only meets the line at a corner already shows up to 2 x wallTouchM; real contact must exceed that
    const minContact = T.wallContactMinM + 2 * T.wallTouchM;
    const real = plot && !plot.estimated ? plot.parts ?? [plot.local] : null;     // registered title only
    const centre = centroid(P);
    const house = H ? wallContacts(P, [H], { touchM: T.adjoinM, nearM: T.adjoinM }) : null;
    // neighbours that are the same building as the house (OSM duplicates) or far away are not examined (same rule as the neighbours check)
    const nbRecs = neighbours.map((n, i) => ({ n, rec: result.neighbours[i] })).filter(({ rec }) => rec && rec.status !== 'ignored' && rec.distanceM != null && rec.distanceM <= T.rangeM);
    const nbContacts = nbRecs.map(({ n, rec }) => ({ id: n.id, rec, walls: wallContacts(P, [n.local], { touchM: T.wallTouchM, nearM: T.wallFireM }) }));
    const bdContacts = real ? wallContacts(P, real, { touchM: T.wallTouchM, nearM: T.wallFireM, solid: false }) : null;

    const walls = result.walls = [];
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length];
      const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const w = { index: i, from: a, to: b, lengthM: r1(lengthM), facing: dirOf(mid[0] - centre[0], mid[1] - centre[1]), kind: 'external', status: 'unchecked', notes: [] };
      walls.push(w);
      if (lengthM < 0.3) { w.status = 'clear'; return; }                              // a sliver from a drawn corner, not a wall
      const h = house?.[i];
      if (h && h.contactM >= lengthM * 0.6) { w.kind = 'internal'; w.status = 'internal'; w.notes.push('Joins the existing house: not a new outside wall.'); return; }

      // 1. against a neighbour's building
      let bestNb = null;
      for (const c of nbContacts) { const x = c.walls[i]; if (!bestNb || x.nearestM < bestNb.w.nearestM) bestNb = { c, w: x }; }
      if (bestNb) {
        const dir = bestNb.c.rec.direction;
        w.neighbour = { id: bestNb.c.id, distanceM: r1(bestNb.w.nearestM), contactM: r1(bestNb.w.contactM), insideM: r1(bestNb.w.insideM), within1mM: r1(bestNb.w.nearM), direction: dir ?? null, line: bestNb.w.pair };
      }
      // 2 and 3: the registered boundary
      if (bdContacts) {
        const x = bdContacts[i];
        w.boundary = { distanceM: r1(x.nearestM), contactM: r1(x.contactM), within1mM: r1(x.nearM), line: x.pair };
      }

      const touchNb = w.neighbour && w.neighbour.contactM >= minContact && w.neighbour.distanceM <= T.wallTouchM;
      const onB = w.boundary && w.boundary.contactM >= minContact && w.boundary.distanceM <= T.wallTouchM;
      const nearB = w.boundary && w.boundary.distanceM < T.wallFireM && w.boundary.within1mM >= Math.max(T.wallContactMinM, 0.5 * lengthM);   // half the wall, so a corner near a side boundary does not count
      const nearNb = w.neighbour && w.neighbour.distanceM > T.wallTouchM && w.neighbour.distanceM < T.wallFireM && w.neighbour.within1mM >= Math.max(T.wallContactMinM, 0.5 * lengthM);
      if (w.neighbour && w.neighbour.insideM >= T.wallContactMinM) w.status = 'overlaps_neighbour';   // already a fail under 'neighbours'; shown here so the wall is coloured
      else if (touchNb) w.status = 'touches_neighbour';
      else if (onB) w.status = 'on_boundary';
      else if (nearB) w.status = 'within_1m';
      else if (nearNb) w.status = 'close_neighbour';
      else w.status = nbContacts.length || bdContacts ? 'clear' : 'unchecked';
    });

    // ---- messages (one per problem wall, worst first, merged when several walls share the same problem) ----
    const side = (ws) => ws.map((w) => `${w.facing} wall (${w.lengthM} m)`).join(' and ');
    const group = (status) => walls.filter((w) => w.status === status);
    const overlapping = group('overlaps_neighbour');
    if (overlapping.length) result.items.push({ status: 'fail', message: `Wall safety: the ${side(overlapping)} runs into the neighbouring building (see the overlap above) – the work cannot be built where the neighbour's building stands.` });
    const touching = group('touches_neighbour'), onBoundary = group('on_boundary'), within = group('within_1m'), close = group('close_neighbour');
    if (touching.length) {
      const m = touching.reduce((s, w) => s + w.neighbour.contactM, 0);
      result.items.push({ status: 'warn', message: `Wall safety: the ${side(touching)} is built hard against the neighbouring building (about ${r1(m)} m of it touching). You may not fix anything to, or cut into, their wall without their agreement; a Party Wall etc. Act 1996 notice is needed, and the roof edge, gutters and flashing at that joint must stay on your side.` });
    }
    if (onBoundary.length) {
      const m = onBoundary.reduce((s, w) => s + w.boundary.contactM, 0);
      result.items.push({ status: 'warn', message: `Wall safety: the ${side(onBoundary)} sits on the registered boundary line (about ${r1(m)} m of it). Footings, eaves and gutters must not extend over the neighbour's land; Building Regulations (Approved Document B) normally need a fire-resistant wall with no windows or doors in it; a Party Wall etc. Act notice may be needed.` });
    }
    if (within.length) {
      const d = Math.min(...within.map((w) => w.boundary.distanceM));
      result.items.push({ status: 'warn', message: `Wall safety: the ${side(within)} is within 1 m of the boundary (closest about ${d} m). Windows and doors in it are limited under Building Regulations (Approved Document B), and a gap this narrow is hard to maintain – check you can still reach the wall.` });
    }
    if (close.length) {
      const d = Math.min(...close.map((w) => w.neighbour.distanceM));
      result.items.push({ status: 'warn', message: `Wall safety: the ${side(close)} is only about ${d} m from the neighbouring building. That is too narrow to maintain easily and can let fire spread between the two walls – avoid openings in it and check access for repairs.` });
    }
    const external = walls.filter((w) => w.kind === 'external');
    const checked = external.some((w) => w.status !== 'unchecked');
    if (!overlapping.length && !touching.length && !onBoundary.length && !within.length && !close.length) {
      if (!external.length) result.items.push({ status: 'info', message: 'Wall safety: no new outside walls to examine.' });
      else if (!checked) result.items.push({ status: 'info', message: 'Wall safety: not checked – no neighbouring building or registered boundary was found close enough to compare with.' });
      else result.items.push({ status: 'pass', message: `Wall safety: none of the ${external.length} new outside walls touches a neighbour or sits within 1 m of a neighbour's wall${real ? ' or the registered boundary' : ''}. (${real ? '' : 'No registered boundary was available, so only neighbouring buildings were compared. '}Map data can be a metre out.)` });
    }
    result.wallSafety = {
      status: overlapping.length ? 'blocked' : touching.length || onBoundary.length ? 'attention' : within.length || close.length ? 'close' : checked ? 'ok' : 'unchecked',
      boundaryUsed: !!real, overlapping: overlapping.length, touching: touching.length, onBoundary: onBoundary.length, within1m: within.length, closeToNeighbour: close.length, walls: external.length,
    };
  },
};
