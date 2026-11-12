import { PUBLIC_LAND, OUTSIDE_PLOT } from './frontSpace.js';
import { LIMITS as L } from '../data/gpdo.js';
/**
 * Householder permitted-development (PD) SCREENING for England, per type of work.
 * GPDO 2015 Sch.2 Part 1: Class A (extensions), B (roof / dormers), D (porches), E (outbuildings).
 * Screening only – the output always recommends confirming with the council / a Lawful Development Certificate.
 */
const LABELS = {
  permitted_development: 'Likely permitted development',
  prior_approval: 'Larger home extension – prior approval route',
  planning_permission: 'Householder planning permission required',
  not_a_house: 'Not a house – this tool does not apply',
  house_unconfirmed: 'Please confirm this is a house',
  listed_building_consent: 'Listed building consent required',
  not_applicable: 'Outside England – different rules apply',
};
const DISCLAIMER =
  'Automated screening only. Rules have exceptions (removed rights, planning conditions, Article 4 directions, previous work). Confirm with your local planning authority or apply for a Lawful Development Certificate.';
const r1 = (n) => Math.round(n * 10) / 10;

/** A yes/no answer from the form ('yes' | 'no' | 'unknown') or a plain boolean from an API caller. Missing = the caller did not ask. */
const ans = (v) => (v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : v === 'unknown' ? 'unknown' : null);
const CLADDING = { render: 'render', stone: 'stone', artificial_stone: 'artificial stone', pebble_dash: 'pebble dash', tile: 'tiles', timber: 'timber', plastic: 'plastic' };

export function assessProposal(input) {
  const {
    country = 'England', houseForm = 'other', flags = {}, proposal: p, houseWidthM = null,
    existingExtensionDepthM = null, plotAreaM2 = null, isOriginalDwelling = true, frontSpace = null, publicLand = null, outsidePlot = null, street = null, existingHeightM = null, existingRoof = null, useGate = null, frontCheck = null,
  } = input;

  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const art23 = !!flags.article23Land;
  let prior = false;
  let forced = null;
  let blocker = null; // set when a front porch has no private land in front of the door (see frontSpace.js)
  const finish = (verdict, summary, confidence = 'high') => ({
    verdict, label: LABELS[verdict], summary, confidence, workType: p.type, checks, ...(blocker ? { blocker } : {}),
    ruleset: 'GPDO 2015 Sch.2 Part 1 (England)', assessedAt: new Date().toISOString(), disclaimer: DISCLAIMER,
  });

  // ---- gates that apply to every type of work ----
  if (country !== 'England') {
    add('jurisdiction', 'fail', `${country} has its own permitted-development rules.`);
    return finish('not_applicable', 'This screening only covers England.');
  }
  // this engine is built for HOUSES: for anything else we say so plainly instead of giving a householder verdict
  if (useGate && useGate.state !== 'soft') {
    blocker = { id: 'not-a-house', level: useGate.level, basis: useGate.state, headline: useGate.headline, reason: useGate.reason };
    add('not-a-house', useGate.state === 'stop' ? 'fail' : 'warn', `${useGate.headline} ${useGate.reason}`);
    return useGate.state === 'stop' ? finish('not_a_house', useGate.headline) : finish('house_unconfirmed', useGate.reason, 'needs_confirmation');
  }
  if (useGate?.state === 'soft') add('use-unconfirmed', 'warn', "We couldn't confirm the property type. This screening only applies to houses – please check before relying on it.");
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
    if (boundary == null) add('eaves', 'warn', `If any part is within ${L.boundaryDistanceM} m of a boundary, eaves must not exceed ${L.eavesNearBoundaryM} m – please confirm.`);
    else if (boundary < L.boundaryDistanceM) {
      if (eaves == null) add('eaves', 'warn', `Within ${L.boundaryDistanceM} m of a boundary: eaves must be ${L.eavesNearBoundaryM} m or less – please provide the eaves height.`);
      else if (eaves > L.eavesNearBoundaryM) add('eaves', 'fail', `Eaves of ${eaves} m exceed ${L.eavesNearBoundaryM} m within ${L.boundaryDistanceM} m of a boundary.`);
      else add('eaves', 'pass', `Eaves of ${eaves} m are within the ${L.eavesNearBoundaryM} m limit near the boundary.`);
    } else add('eaves', 'pass', `More than ${L.boundaryDistanceM} m from the boundary – the ${L.eavesNearBoundaryM} m eaves limit is not triggered.`);
  };

  const rearBlock = ({ storeys = 1, depthM, heightM, eavesHeightM, distanceToSideBoundaryM, distanceToRearBoundaryM }) => {
    const detached = houseForm === 'detached';
    if (storeys === 1) {
      const pdLimit = detached ? L.rearDepthM.detached : L.rearDepthM.attached, paLimit = detached ? L.rearDepthPriorM.detached : L.rearDepthPriorM.attached;
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
      if (heightM > L.singleStoreyHeightM) add('height', 'fail', `Single-storey rear extensions are limited to ${L.singleStoreyHeightM} m in height.`);
      else add('height', 'pass', `Height of ${heightM} m is within the ${L.singleStoreyHeightM} m limit.`);
      eavesRule(eavesHeightM, distanceToSideBoundaryM);
    } else {
      if (art23) add('two-storey', 'fail', 'Rear extensions on protected land must be single storey.');
      if (depthM > L.twoStoreyDepthM) add('rear-depth', 'fail', `Two-storey rear extensions may extend at most ${L.twoStoreyDepthM} m (proposed ${depthM} m).`);
      else add('rear-depth', 'pass', `Two-storey depth is within ${L.twoStoreyDepthM} m.`);
      if (distanceToRearBoundaryM == null) add('rear-boundary', 'warn', `Two-storey extensions must be at least ${L.twoStoreyRearBoundaryM} m from the rear boundary – please confirm.`);
      else if (distanceToRearBoundaryM < L.twoStoreyRearBoundaryM) add('rear-boundary', 'fail', `Only ${distanceToRearBoundaryM} m from the rear boundary; at least ${L.twoStoreyRearBoundaryM} m is required.`);
      else add('rear-boundary', 'pass', `At least ${L.twoStoreyRearBoundaryM} m from the rear boundary.`);
    }
  };

  const sideBlock = ({ storeys = 1, widthM, heightM, eavesHeightM, distanceToSideBoundaryM }) => {
    if (art23) add('side', 'fail', 'Side extensions are not permitted development on protected land.');
    if (storeys !== 1) add('side-storeys', 'fail', 'Side extensions must be single storey.');
    if (heightM > L.sideHeightM) add('side-height', 'fail', `Side extensions are limited to ${L.sideHeightM} m in height.`);
    else if (storeys === 1) add('side-height', 'pass', `Height of ${heightM} m is within the ${L.sideHeightM} m limit.`);
    if (houseWidthM == null) add('side-width', 'warn', 'Side extension width must not exceed half the width of the original house – please confirm.');
    else if (widthM > houseWidthM * L.sideWidthFraction) add('side-width', 'fail', `Width ${widthM} m is more than half the house width (${r1(houseWidthM * L.sideWidthFraction)} m).`);
    else add('side-width', 'pass', `Width ${widthM} m is within half the house width (${r1(houseWidthM * L.sideWidthFraction)} m).`);
    eavesRule(eavesHeightM, distanceToSideBoundaryM);
  };

  // A.1(c) ridge and A.1(d) eaves: no part higher than the highest part of the existing roof, and the eaves no higher than the existing eaves.
  // With a measured roof (LiDAR) these can be tested; with only a community map tag, or nothing, they prompt. The tolerance comes from existingRoof.toleranceM.
  const roof = existingRoof ?? (existingHeightM != null ? { source: 'osm', confidence: 'low', toleranceM: 1, ridgeM: existingHeightM, eavesM: null } : null);
  const srcWord = roof?.source === 'survey' ? `from a measured survey (about ±${roof.toleranceM} m)` : roof?.source === 'lidar' ? `measured from LiDAR (about ±${roof.toleranceM} m)` : 'recorded in the map data (community-entered, rough)';
  const existingHeightRule = (heightM) => {
    if (!roof || heightM == null) return;
    const over = Math.round((heightM - roof.ridgeM) * 100) / 100, tol = roof.toleranceM;
    if (roof.source === 'osm') {   // unchanged behaviour: the map tag can only prompt
      if (heightM > roof.ridgeM + 0.2) add('existing-height', 'warn', `The extension is ${heightM} m high, above the ${roof.ridgeM} m building height recorded in the map data. No part may be higher than the highest part of the existing roof – check the real ridge height.`);
      else add('existing-height', 'pass', `Extension height of ${heightM} m is not above the ${roof.ridgeM} m building height recorded in the map data (community-entered – confirm the real ridge height).`);
      return;
    }
    if (over > 2 * tol && roof.confidence === 'high') add('existing-height', 'fail', `The extension is ${heightM} m high, about ${over} m above the existing ridge (${roof.ridgeM} m, ${srcWord}). No part may be higher than the highest part of the existing roof (A.1(c)).`);
    else if (over > -tol) add('existing-height', 'warn', `The extension is ${heightM} m high and the existing ridge is about ${roof.ridgeM} m (${srcWord}): too close to call. No part may be higher than the highest part of the existing roof – check the real ridge height.`);
    else add('existing-height', 'pass', `Extension height of ${heightM} m is clearly below the existing ridge (about ${roof.ridgeM} m, ${srcWord}).`);
  };
  const existingEavesRule = (eavesM) => {
    if (!roof || roof.source === 'osm' || roof.eavesM == null || eavesM == null) return;
    const over = Math.round((eavesM - roof.eavesM) * 100) / 100, tol = roof.toleranceM;
    if (over > 2 * tol && roof.confidence === 'high') add('existing-eaves', 'fail', `The extension's eaves (${eavesM} m) are about ${over} m above the existing house's eaves (${roof.eavesM} m, ${srcWord}). The eaves may be no higher than the existing eaves (A.1(d)).`);
    else if (over > -tol) add('existing-eaves', 'warn', `The extension's eaves (${eavesM} m) are close to the existing eaves (about ${roof.eavesM} m, ${srcWord}): too close to call. They may be no higher than the existing eaves (A.1(d)).`);
    else add('existing-eaves', 'pass', `The extension's eaves (${eavesM} m) are clearly below the existing eaves (about ${roof.eavesM} m, ${srcWord}).`);
  };
  // Height limits are measured from the highest ground next to the building, so a sloping site changes what "4 m" means in practice.
  const groundNote = () => { if (roof?.groundFallM >= 0.5) add('ground-level', 'info', `The ground falls about ${roof.groundFallM} m across the house (LiDAR). Height limits are measured from the highest ground next to the extension, so check which level you are measuring from.`); };

  const curtilageBlock = () => {
    if (plotAreaM2 && p.additionsAreaM2 != null) {
      const limit = plotAreaM2 * L.curtilageFraction;
      if (p.additionsAreaM2 > limit) add('curtilage', 'fail', `Additions (${p.additionsAreaM2} m²) exceed ~50% of the plot (${Math.round(limit)} m²).`);
      else add('curtilage', 'pass', 'Additions are within ~50% of the plot (approximate – excludes the original house footprint).');
    } else add('curtilage', 'warn', 'Confirm that extensions and outbuildings together cover no more than 50% of the garden/curtilage.');
  };

  // work on the strip between the plot and the road (public land) – applies to every type of footprint work except porches (see frontSpace.js)
  if (publicLand) {
    blocker = { id: 'public-land', level: publicLand.level, basis: 'public-land', headline: PUBLIC_LAND, reason: publicLand.reason };
    add('public-land', publicLand.level === 'certain' ? 'fail' : 'warn', publicLand.message);
  }

  // work outside the registered title (a different direction from the road strip above, which has its own wording)
  if (outsidePlot && !publicLand) {
    blocker = { id: 'outside-plot', level: outsidePlot.level, basis: 'outside-plot', headline: OUTSIDE_PLOT, reason: outsidePlot.reason };
    add('outside-plot', outsidePlot.level === 'certain' ? 'fail' : 'warn', outsidePlot.message);
  } else if (outsidePlot) add('outside-plot', outsidePlot.level === 'certain' ? 'fail' : 'warn', outsidePlot.message);

  // pavements, paths and street furniture under the work
  if (street) add('street', street.level === 'certain' ? 'fail' : 'warn', street.message);

  // where the drawing puts the work depends on which side is the FRONT of the house
  if (frontCheck?.corner && frontCheck.source !== 'user') add('front-corner', 'warn', `This house is on a corner. Confirm which side the front door is on – the drawing assumes the front faces ${frontCheck.facing}.`);
  else if (frontCheck?.source === 'assumed') add('front-assumed', 'warn', "We couldn't tell which side is the front of the house, so the position of the work is a guess – set the direction the front door faces.");


  // ---- provisions that need a yes/no from the applicant ----
  // Public right of way (Highways Act / TCPA s.257): permitted development never overrides it.
  if (ans(p.crossesRightOfWay) === 'yes' || flags.publicRightOfWay === true) add('public-right-of-way', 'fail', 'The work is over a public right of way (footpath or bridleway). Permitted development does not override it: the council must divert the path first.');
  else if (flags.publicRightOfWay === 'possible') add('public-right-of-way', 'warn', 'A public right of way may cross the site – check the council\'s definitive map before building.');
  // A.1(a) / B.1(a): a house that only exists because of a Part 3 change-of-use right has no Class A or B rights.
  const classAorB = ['rear_extension', 'side_extension', 'wraparound_extension', 'rear_dormer'].includes(p.type);
  if (classAorB && (ans(p.convertedUnderPart3) === 'yes' || flags.part3Conversion === true)) add('dwelling-origin', 'fail', `This house was created under a Part 3 change-of-use right (e.g. from an office, shop or agricultural building), so Class ${p.type === 'rear_dormer' ? 'B.1(a)' : 'A.1(a)'} removes these rights.`);
  // A.1(e): no part beyond the principal elevation, or a side wall that fronts a highway.
  const frontRule = () => {
    if (ans(p.beyondFront) === 'yes') add('principal-elevation', 'fail', 'Part of the work reaches beyond the wall forming the front (principal) elevation, or a side wall facing a road. That is not permitted development (A.1(e)).');
    else if (ans(p.beyondFront) === 'no') add('principal-elevation', 'pass', 'Confirmed: nothing reaches in front of the front wall or a wall facing a road (A.1(e)).');
    else add('principal-elevation', 'info', 'Whether the work reaches in front of the front wall or a wall facing a road has not been confirmed (A.1(e)).');
  };
  // A.1(k): no verandah, balcony or raised platform, antenna, chimney/flue/soil pipe, or roof alteration.
  const featuresRule = () => {
    if (ans(p.hasProhibited) === 'yes') add('prohibited-features', 'fail', 'The work includes a verandah, balcony, raised platform, microwave antenna, chimney, flue, soil pipe or a change to the roof of the house. None of those are permitted development under Class A (A.1(k)).');
    else if (ans(p.hasProhibited) === 'no') add('prohibited-features', 'pass', 'Confirmed: no balcony, raised platform, antenna, chimney, flue, soil pipe or roof alteration (A.1(k)).');
    else add('prohibited-features', 'info', 'Not confirmed whether it includes a balcony, raised platform, antenna, chimney, flue, soil pipe or roof alteration (A.1(k)).');
  };

  // ---- rules per type of work ----
  switch (p.type) {
    case 'rear_extension':
      rearBlock(p); existingHeightRule(p.heightM); existingEavesRule(p.eavesHeightM); groundNote(); curtilageBlock(); frontRule(); featuresRule();
      add('materials', 'info', 'Materials should be of similar appearance to the existing house.');
      break;
    case 'side_extension':
      sideBlock(p); existingHeightRule(p.heightM); existingEavesRule(p.eavesHeightM); groundNote(); curtilageBlock(); frontRule(); featuresRule();
      add('materials', 'info', 'Materials should be of similar appearance to the existing house.');
      break;
    case 'wraparound_extension':
      rearBlock({ storeys: 1, depthM: p.depthM, heightM: p.heightM, eavesHeightM: p.eavesHeightM, distanceToSideBoundaryM: p.distanceToSideBoundaryM });
      sideBlock({ storeys: 1, widthM: p.widthM, heightM: p.heightM, eavesHeightM: p.eavesHeightM, distanceToSideBoundaryM: p.distanceToSideBoundaryM });
      existingHeightRule(p.heightM); existingEavesRule(p.eavesHeightM); groundNote(); curtilageBlock(); frontRule(); featuresRule();
      break;
    case 'front_porch': {
      if (frontSpace) {
        blocker = { id: 'no-front-space', level: frontSpace.level, basis: frontSpace.basis, headline: frontSpace.headline, reason: frontSpace.reason };
        add('porch-no-space', frontSpace.level === 'certain' ? 'fail' : 'warn', frontSpace.message);
      }
      const area = r1(p.widthM * p.depthM);
      if (area > L.porchAreaM2) add('porch-area', 'fail', `Porch ground area of ${area} m² exceeds the ${L.porchAreaM2} m² limit.`); else add('porch-area', 'pass', `Ground area of ${area} m² is within ${L.porchAreaM2} m².`);
      if (p.heightM > L.porchHeightM) add('porch-height', 'fail', `Porches may be no higher than ${L.porchHeightM} m.`); else add('porch-height', 'pass', `Height of ${p.heightM} m is within ${L.porchHeightM} m.`);
      if (frontSpace?.level === 'certain') { /* the no-front-space check above already covers the highway rule */ }
      else if (p.distanceToHighwayM == null) add('porch-highway', 'warn', 'No part may be within 2 m of a boundary that adjoins a highway – please confirm.');
      else if (p.distanceToHighwayM < L.porchHighwayM) add('porch-highway', 'fail', `Only ${p.distanceToHighwayM} m from the highway boundary; at least ${L.porchHighwayM} m is required.`);
      else add('porch-highway', 'pass', `At least ${L.porchHighwayM} m from the highway boundary.`);
      break;
    }
    case 'rear_dormer': {
      if (art23) add('roof-protected', 'fail', 'Roof enlargements (dormers) are not permitted development on protected land.');
      if (p.balcony) add('roof-balcony', 'fail', 'Balconies, verandas and raised platforms are not permitted development.');
      add('roof-slope', 'pass', 'Rear roof slope (not the slope facing the highway).');
      const limit = houseForm === 'terraced' ? L.dormerVolumeM3.terraced : L.dormerVolumeM3.other;
      const vol = p.volumeM3 ?? r1(0.5 * p.widthM * p.depthM * p.heightM);
      if (vol > limit) add('roof-volume', 'fail', `Added roof volume ${p.volumeM3 == null ? '(estimated) ' : ''}${vol} m³ exceeds the ${limit} m³ allowance.`);
      else add('roof-volume', p.volumeM3 == null ? 'warn' : 'pass', `Added roof volume ${p.volumeM3 == null ? '(estimated) ' : ''}${vol} m³ is within ${limit} m³${p.volumeM3 == null ? ' – confirm; previous roof additions count too' : ''}.`);
      if (ans(p.chimneyFlue) === 'yes') add('roof-features', 'fail', 'A new, altered or replaced chimney, flue or soil pipe is not permitted development under Class B (B.1(e)).');
      if (ans(p.higherThanRoof) === 'yes') add('roof-height', 'fail', 'Part of the dormer would be higher than the highest part of the existing roof (B.1(b)).');
      else if (p.topHeightM != null && roof) { existingHeightRule(p.topHeightM); add('roof-height', 'info', `The dormer must not be higher than the highest part of the existing roof (B.1(b)).`); }
      else add('roof-height', 'info', `The dormer must not be higher than the highest part of the existing roof${roof?.source === 'lidar' ? ` (the ridge measures about ${roof.ridgeM} m, ${srcWord})` : ''}; side windows must be obscure-glazed.`);
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
      const maxH = p.roof === 'pitched' ? L.outbuildingHeightM.pitched : L.outbuildingHeightM.other;
      if (p.heightM > maxH) add('out-height', 'fail', `Overall height ${p.heightM} m exceeds ${maxH} m for a ${p.roof === 'pitched' ? 'dual-pitched' : 'flat / mono-pitch'} roof.`);
      else add('out-height', 'pass', `Overall height ${p.heightM} m is within ${maxH} m.`);
      if (p.distanceToBoundaryM == null) add('out-boundary', 'warn', 'Within 2 m of a boundary, the overall height must be 2.5 m or less – please confirm distance.');
      else if (p.distanceToBoundaryM < L.outbuildingBoundaryM && p.heightM > L.outbuildingBoundaryHeightM) add('out-boundary', 'fail', `Within ${L.outbuildingBoundaryM} m of a boundary the height limit is ${L.outbuildingBoundaryHeightM} m (proposed ${p.heightM} m).`);
      else add('out-boundary', 'pass', 'Boundary height rule satisfied.');
      if (p.eavesHeightM != null && p.eavesHeightM > L.outbuildingEavesM) add('out-eaves', 'fail', `Eaves of ${p.eavesHeightM} m exceed the ${L.outbuildingEavesM} m limit.`);
      if (art23 && (p.setbackM ?? 0) > L.outbuildingFarDistanceM && p.widthM * p.depthM > L.outbuildingFarAreaM2) add('out-20m', 'fail', `On protected land, buildings more than ${L.outbuildingFarDistanceM} m from the house are limited to ${L.outbuildingFarAreaM2} m² of ground area (E.1(j)); this one covers ${r1(p.widthM * p.depthM)} m².`);
      curtilageBlock();
      if (ans(p.raisedPlatform) === 'yes') add('out-platforms', 'fail', 'Verandas, balconies and raised platforms are not permitted with an outbuilding (E.1(g)).');
      else add('out-platforms', 'info', 'No verandas, balconies or raised platforms higher than 0.3 m.');
      break;
    }
    default:
      add('unknown', 'warn', 'No rules available for this type of work.');
  }

  // A.2(a): on protected land, cladding any part of the outside in stone, artificial stone, pebble dash, render, timber, plastic or tiles is not permitted
  if (art23 && ['rear_extension', 'side_extension', 'wraparound_extension'].includes(p.type) && p.cladding in CLADDING) add('cladding', 'fail', `The extension is to be faced in ${CLADDING[p.cladding]}. On protected land, cladding with ${Object.values(CLADDING).join(', ')} is not permitted development (A.2(a)).`);
  // questions the form showed but the applicant has not answered: one consolidated warning, so the verdict says it is unconfirmed
  const QUESTIONS = { beyondFront: 'whether it reaches in front of the front wall (A.1(e))', hasProhibited: 'whether it includes a balcony, platform, chimney, flue or antenna (A.1(k))', convertedUnderPart3: 'whether the house was created by a change-of-use right (A.1(a) / B.1(a))', crossesRightOfWay: 'whether it is over a public right of way', higherThanRoof: 'whether it is higher than the existing ridge (B.1(b))', chimneyFlue: 'whether it adds a chimney or flue (B.1(e))', raisedPlatform: 'whether it has a veranda or raised platform (E.1(g))' };
  const open = Object.entries(QUESTIONS).filter(([k]) => ans(p[k]) === 'unknown' && !(k === 'crossesRightOfWay' && flags.publicRightOfWay != null) && !(k === 'convertedUnderPart3' && flags.part3Conversion != null)).map(([, v]) => v);
  if (art23 && p.cladding === 'unknown' && ['rear_extension', 'side_extension', 'wraparound_extension'].includes(p.type)) open.push('the outer finish: render, stone, pebble dash, tiles, timber and plastic cladding are not allowed on protected land (A.2(a))');
  if (open.length) add('details-unconfirmed', 'warn', `Not yet answered: ${open.join('; ')}. The result cannot be fully confirmed until these are.`);

  const warns = checks.some((c) => c.status === 'warn');
  const fails = checks.filter((c) => c.status === 'fail');
  if (fails.length) return finish('planning_permission', publicLand?.level === 'certain' ? `${PUBLIC_LAND} ${publicLand.reason}` : (outsidePlot?.level === 'certain' ? `${OUTSIDE_PLOT} ${outsidePlot.reason}` : street?.level === 'certain' ? street.message : fails.map((c) => c.message).join(' ')));
  if (forced) return finish(forced.verdict, forced.summary, forced.confidence);
  if (prior) return finish('prior_approval', 'Exceeds standard limits but may qualify for prior approval.', 'needs_confirmation');
  return finish('permitted_development', 'No limits breached on the information provided.', warns ? 'needs_confirmation' : 'high');
}
