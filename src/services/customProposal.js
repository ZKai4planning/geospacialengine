/**
 * Turns a polygon the applicant DREW into the standard proposal the permitted-development engine understands,
 * by measuring it in the house's frame (see measureDrawn). Pure function: easy to test and easy to change.
 *
 *   p       the custom_polygon proposal ({ treatAs, heightM, ... })
 *   m       measureDrawn() result: sMin/sMax (across), dMin/dMax (beyond the rear wall), widthM, lengthM
 *   ctx     { houseWidthM, existingDepthM, existingBeyondOutline, boundaryM }
 *           existingBeyondOutline = the OSM outline does NOT include the existing extension (so it sits beyond d = 0)
 *           boundaryM = distance to the registered title boundary, or null when unknown
 *
 * Returns { proposal, notes } – notes are shown at the top of the assessment so the applicant can see what was measured.
 */
const r1 = (n) => Math.round(n * 10) / 10;

export function standardiseDrawn(p, m, { houseWidthM, existingDepthM = 0, existingBeyondOutline = false, boundaryM = null }) {
  const notes = [];
  const info = (message) => notes.push({ id: 'drawn-measure', status: 'info', message });
  const warn = (message) => notes.push({ id: 'drawn-warning', status: 'warn', message });
  const common = { storeys: p.storeys ?? 1, heightM: p.heightM, eavesHeightM: p.eavesHeightM, additionsAreaM2: p.additionsAreaM2 };
  const boundary = (given) => {
    if (given != null) return given;
    if (boundaryM != null) {
      info(`Distance to the boundary (${boundaryM <= 0.5 ? 'right up to it' : `about ${r1(boundaryM)} m`}) was measured from the registered title boundary – override it under "More details" if you know better.`);
      return r1(boundaryM);
    }
    return null;
  };

  switch (p.treatAs) {
    case 'side_extension': {
      const right = m.sMax - houseWidthM / 2, left = -houseWidthM / 2 - m.sMin;
      const side = right >= left ? 'right' : 'left';
      const width = Math.max(right, left);
      if (width < 0.1) warn('The shape you drew does not extend sideways beyond the house walls, so side-extension rules may not describe it.');
      info(`Measured as a ${side}-hand side extension ${r1(Math.max(width, 0.1))} m wide and ${r1(m.lengthM)} m long.`);
      return { notes, proposal: { type: 'side_extension', side, ...common, widthM: r1(Math.max(width, 0.1)), lengthM: r1(m.lengthM), distanceToSideBoundaryM: boundary(p.distanceToSideBoundaryM) } };
    }
    case 'outbuilding': {
      info(`Measured as an outbuilding ${r1(m.widthM)} m × ${r1(m.lengthM)} m (overall size of the shape), about ${r1(Math.max(0, m.dMin))} m behind the back of the house.`);
      return { notes, proposal: { type: 'outbuilding', ...common, widthM: r1(m.widthM), depthM: r1(m.lengthM), roof: p.roof ?? 'flat', setbackM: r1(Math.max(0, m.dMin)), distanceToBoundaryM: boundary(p.distanceToBoundaryM), usedAsHome: !!p.usedAsHome } };
    }
    default: { // rear_extension
      // Depth is counted from the ORIGINAL rear wall. The engine adds the existing extension itself, so give it only the NEW part.
      const fromOriginal = m.dMax + (existingBeyondOutline ? 0 : existingDepthM);
      const depth = Math.max(0.1, r1(fromOriginal - existingDepthM));
      if (m.dMax < 0.1) warn('The shape you drew does not reach beyond the back wall of the house, so rear-extension rules may not describe it.');
      info(`Measured as a rear extension reaching ${r1(Math.max(0, fromOriginal))} m beyond the original rear wall${existingDepthM ? ' (existing extension included)' : ''}.`);
      return { notes, proposal: { type: 'rear_extension', ...common, depthM: depth, widthM: r1(m.widthM), distanceToSideBoundaryM: boundary(p.distanceToSideBoundaryM), distanceToRearBoundaryM: p.distanceToRearBoundaryM } };
    }
  }
}
