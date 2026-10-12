/**
 * Householder permitted-development (PD) SCREENING for England, per type of work.
 * GPDO 2015 Sch.2 Part 1: Class A (extensions), B (roof / dormers), D (porches), E (outbuildings).
 * Screening only – the output always recommends confirming with the council / a Lawful Development Certificate.
 */
const LABELS = {
  permitted_development: 'Likely permitted development',
  prior_approval: 'Larger home extension – prior approval route',
  planning_permission: 'Householder planning permission required',
  listed_building_consent: 'Listed building consent required',
  not_applicable: 'Outside England – different rules apply',
};
const DISCLAIMER =
  'Automated screening only. Rules have exceptions (removed rights, planning conditions, Article 4 directions, previous work). Confirm with your local planning authority or apply for a Lawful Development Certificate.';
const r1 = (n) => Math.round(n * 10) / 10;

export function assessProposal(input) {
  const {
    country = 'England', houseForm = 'other', flags = {}, proposal: p, houseWidthM = null,
    existingExtensionDepthM = null, plotAreaM2 = null, isOriginalDwelling = true,
  } = input;

  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const art23 = !!flags.article23Land;
  let prior = false;
  let forced = null;
  const finish = (verdict, summary, confidence = 'high') => ({
    verdict, label: LABELS[verdict], summary, confidence, workType: p.type, checks,
    ruleset: 'GPDO 2015 Sch.2 Part 1 (England)', assessedAt: new Date().toISOString(), disclaimer: DISCLAIMER,
  });

  // ---- gates that apply to every type of work ----
  if (country !== 'England') {
    add('jurisdiction', 'fail', `${country} has its own permitted-development rules.`);
    return finish('not_applicable', 'This screening only covers England.');
  }
  if (flags.listedBuilding) {
    add('listed', 'fail', 'Listed buildings have no householder permitted-development rights – listed building consent (and usually planning permission) is required.');
    return finish('listed_building_consent', 'The property appears to be listed.');
  }
  if (houseForm === 'flat') {
    add('dwellinghouse', 'fail', 'Flats and maisonettes have no householder permitted-development rights.');
    return finish('planning_permission', 'Householder permitted development does not apply to flats.');
  }
  if (!isOriginalDwelling) add('original-dwelling', 'warn', 'Not an original single dwellinghouse (e.g. converted) – rights may have been removed.');
  if (flags.article4) add('article4', 'warn', 'An Article 4 direction applies here – the council may have withdrawn these rights. Check the direction wording.');
  if (art23) add('protected-land', 'warn', 'Protected land (conservation area / national park / AONB / World Heritage Site): extra restrictions apply.');
  if (flags.greenBelt) add('green-belt', 'warn', 'Green Belt: if planning permission is needed, "disproportionate addition" policy will matter.');

  // ---- shared rule blocks ----
  const eavesRule = (eaves, boundary) => {
    if (boundary == null) add('eaves', 'warn', 'If any part is within 2 m of a boundary, eaves must not exceed 3 m – please confirm.');
    else if (boundary < 2) {
      if (eaves == null) add('eaves', 'warn', 'Within 2 m of a boundary: eaves must be 3 m or less – please provide the eaves height.');
      else if (eaves > 3) add('eaves', 'fail', `Eaves of ${eaves} m exceed 3 m within 2 m of a boundary.`);
      else add('eaves', 'pass', `Eaves of ${eaves} m are within the 3 m limit near the boundary.`);
    } else add('eaves', 'pass', 'More than 2 m from the boundary – the 3 m eaves limit is not triggered.');
  };

  const rearBlock = ({ storeys = 1, depthM, heightM, eavesHeightM, distanceToSideBoundaryM, distanceToRearBoundaryM }) => {
    const detached = houseForm === 'detached';
    if (storeys === 1) {
      const pdLimit = detached ? 4 : 3, paLimit = detached ? 8 : 6;
      if (existingExtensionDepthM === null) add('existing-extension', 'warn', 'Existing extension not confirmed – assumed none. Depth is measured from the ORIGINAL rear wall, so existing extensions count.');
      const total = r1((existingExtensionDepthM ?? 0) + depthM);
      if (total <= pdLimit) add('rear-depth', 'pass', `Total ${total} m beyond the original rear wall is within the ${pdLimit} m limit.`);
      else if (total <= paLimit && !art23 && !flags.sssi) {
        add('rear-depth', 'warn', `Total ${total} m exceeds ${pdLimit} m but is within ${paLimit} m: the larger home extension prior-approval route (neighbour consultation) may be used.`);
        prior = true;
      } else {
        const protectedLand = art23 || flags.sssi;
        add('rear-depth', 'fail', `Total ${total} m exceeds the ${protectedLand ? pdLimit : paLimit} m limit${protectedLand ? ' (prior-approval route is not available on protected land / SSSIs)' : ''}.`);
      }
      if (heightM > 4) add('height', 'fail', 'Single-storey rear extensions are limited to 4 m in height.');
      else add('height', 'pass', `Height of ${heightM} m is within the 4 m limit.`);
      eavesRule(eavesHeightM, distanceToSideBoundaryM);
    } else {
      if (art23) add('two-storey', 'fail', 'Rear extensions on protected land must be single storey.');
      if (depthM > 3) add('rear-depth', 'fail', `Two-storey rear extensions may extend at most 3 m (proposed ${depthM} m).`);
      else add('rear-depth', 'pass', 'Two-storey depth is within 3 m.');
      if (distanceToRearBoundaryM == null) add('rear-boundary', 'warn', 'Two-storey extensions must be at least 7 m from the rear boundary – please confirm.');
      else if (distanceToRearBoundaryM < 7) add('rear-boundary', 'fail', `Only ${distanceToRearBoundaryM} m from the rear boundary; at least 7 m is required.`);
      else add('rear-boundary', 'pass', 'At least 7 m from the rear boundary.');
    }
  };

  const sideBlock = ({ storeys = 1, widthM, heightM, eavesHeightM, distanceToSideBoundaryM }) => {
    if (art23) add('side', 'fail', 'Side extensions are not permitted development on protected land.');
    if (storeys !== 1) add('side-storeys', 'fail', 'Side extensions must be single storey.');
    if (heightM > 4) add('side-height', 'fail', 'Side extensions are limited to 4 m in height.');
    else if (storeys === 1) add('side-height', 'pass', `Height of ${heightM} m is within the 4 m limit.`);
    if (houseWidthM == null) add('side-width', 'warn', 'Side extension width must not exceed half the width of the original house – please confirm.');
    else if (widthM > houseWidthM / 2) add('side-width', 'fail', `Width ${widthM} m is more than half the house width (${r1(houseWidthM / 2)} m).`);
    else add('side-width', 'pass', `Width ${widthM} m is within half the house width (${r1(houseWidthM / 2)} m).`);
    eavesRule(eavesHeightM, distanceToSideBoundaryM);
  };

  const curtilageBlock = () => {
    if (plotAreaM2 && p.additionsAreaM2 != null) {
      const limit = plotAreaM2 * 0.5;
      if (p.additionsAreaM2 > limit) add('curtilage', 'fail', `Additions (${p.additionsAreaM2} m²) exceed ~50% of the plot (${Math.round(limit)} m²).`);
      else add('curtilage', 'pass', 'Additions are within ~50% of the plot (approximate – excludes the original house footprint).');
    } else add('curtilage', 'warn', 'Confirm that extensions and outbuildings together cover no more than 50% of the garden/curtilage.');
  };

  // ---- rules per type of work ----
  switch (p.type) {
    case 'rear_extension':
      rearBlock(p); curtilageBlock();
      add('materials', 'info', 'Materials should be of similar appearance to the existing house.');
      break;
    case 'side_extension':
      sideBlock(p); curtilageBlock();
      add('materials', 'info', 'Materials should be of similar appearance to the existing house.');
      break;
    case 'wraparound_extension':
      rearBlock({ storeys: 1, depthM: p.depthM, heightM: p.heightM, eavesHeightM: p.eavesHeightM, distanceToSideBoundaryM: p.distanceToSideBoundaryM });
      sideBlock({ storeys: 1, widthM: p.widthM, heightM: p.heightM, eavesHeightM: p.eavesHeightM, distanceToSideBoundaryM: p.distanceToSideBoundaryM });
      curtilageBlock();
      break;
    case 'front_porch': {
      const area = r1(p.widthM * p.depthM);
      if (area > 3) add('porch-area', 'fail', `Porch ground area of ${area} m² exceeds the 3 m² limit.`); else add('porch-area', 'pass', `Ground area of ${area} m² is within 3 m².`);
      if (p.heightM > 3) add('porch-height', 'fail', 'Porches may be no higher than 3 m.'); else add('porch-height', 'pass', `Height of ${p.heightM} m is within 3 m.`);
      if (p.distanceToHighwayM == null) add('porch-highway', 'warn', 'No part may be within 2 m of a boundary that adjoins a highway – please confirm.');
      else if (p.distanceToHighwayM < 2) add('porch-highway', 'fail', `Only ${p.distanceToHighwayM} m from the highway boundary; at least 2 m is required.`);
      else add('porch-highway', 'pass', 'At least 2 m from the highway boundary.');
      break;
    }
    case 'rear_dormer': {
      if (art23) add('roof-protected', 'fail', 'Roof enlargements (dormers) are not permitted development on protected land.');
      if (p.balcony) add('roof-balcony', 'fail', 'Balconies, verandas and raised platforms are not permitted development.');
      add('roof-slope', 'pass', 'Rear roof slope (not the slope facing the highway).');
      const limit = houseForm === 'terraced' ? 40 : 50;
      const vol = p.volumeM3 ?? r1(0.5 * p.widthM * p.depthM * p.heightM);
      if (vol > limit) add('roof-volume', 'fail', `Added roof volume ${p.volumeM3 == null ? '(estimated) ' : ''}${vol} m³ exceeds the ${limit} m³ allowance.`);
      else add('roof-volume', p.volumeM3 == null ? 'warn' : 'pass', `Added roof volume ${p.volumeM3 == null ? '(estimated) ' : ''}${vol} m³ is within ${limit} m³${p.volumeM3 == null ? ' – confirm; previous roof additions count too' : ''}.`);
      add('roof-height', 'info', 'The dormer must not be higher than the highest part of the existing roof; side windows must be obscure-glazed.');
      break;
    }
    case 'additional_storey':
      add('upward', 'warn', 'Adding storeys normally needs planning permission. A few narrow prior-approval rights exist for upward extensions – ask the council whether any apply to this house.');
      forced = { verdict: 'planning_permission', summary: 'Upward extensions usually need planning permission.', confidence: 'needs_confirmation' };
      break;
    case 'outbuilding': {
      if (p.usedAsHome) add('incidental', 'fail', 'Outbuildings must be incidental to the house – a separate home or sleeping accommodation is not.');
      else add('incidental', 'pass', 'Used incidentally to the house (e.g. office, gym, store).');
      add('location', 'pass', 'Sited behind the principal elevation of the house.');
      const maxH = p.roof === 'pitched' ? 4 : 3;
      if (p.heightM > maxH) add('out-height', 'fail', `Overall height ${p.heightM} m exceeds ${maxH} m for a ${p.roof === 'pitched' ? 'dual-pitched' : 'flat / mono-pitch'} roof.`);
      else add('out-height', 'pass', `Overall height ${p.heightM} m is within ${maxH} m.`);
      if (p.distanceToBoundaryM == null) add('out-boundary', 'warn', 'Within 2 m of a boundary, the overall height must be 2.5 m or less – please confirm distance.');
      else if (p.distanceToBoundaryM < 2 && p.heightM > 2.5) add('out-boundary', 'fail', `Within 2 m of a boundary the height limit is 2.5 m (proposed ${p.heightM} m).`);
      else add('out-boundary', 'pass', 'Boundary height rule satisfied.');
      if (p.eavesHeightM != null && p.eavesHeightM > 2.5) add('out-eaves', 'fail', `Eaves of ${p.eavesHeightM} m exceed the 2.5 m limit.`);
      if (art23 && (p.setbackM ?? 0) > 20 && p.widthM * p.depthM > 10) add('out-20m', 'warn', 'On protected land, buildings more than 20 m from the house are limited to 10 m² of ground area.');
      curtilageBlock();
      add('out-platforms', 'info', 'No verandas, balconies or raised platforms higher than 0.3 m.');
      break;
    }
    default:
      add('unknown', 'warn', 'No rules available for this type of work.');
  }

  const warns = checks.some((c) => c.status === 'warn');
  const fails = checks.filter((c) => c.status === 'fail');
  if (fails.length) return finish('planning_permission', fails.map((c) => c.message).join(' '));
  if (forced) return finish(forced.verdict, forced.summary, forced.confidence);
  if (prior) return finish('prior_approval', 'Exceeds standard limits but may qualify for prior approval.', 'needs_confirmation');
  return finish('permitted_development', 'No limits breached on the information provided.', warns ? 'needs_confirmation' : 'high');
}
