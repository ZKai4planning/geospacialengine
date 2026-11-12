import { lpaFor } from '../data/lpaRules.js';

/**
 * LPA screening: measure the plot, the house and the extension, then test them against the council's own guidance (src/data/lpaRules.js).
 * It runs AFTER the permitted-development screening:
 *   - PD work is not judged against local design guidance (only an Article 4 direction can change that), so the outlook is "not_needed".
 *   - Otherwise the council decides it. Guidance breaches make a refusal more likely ('at_risk'); building outside the title or on the
 *     public strip makes it 'unlikely' (needs the landowner / highway authority, not just a planning decision).
 *
 * Returns { available, authority, document, url, caution, measured, checks, outlook, headline }.
 */
const r1 = (n) => Math.round(n * 10) / 10;
const OUTLOOK = {
  not_needed: 'Local guidance is not needed – this looks like permitted development',
  likely_ok: 'No local-guidance problems found on the figures available',
  at_risk: 'Planning permission is needed and the council may well object',
  unlikely: 'Unlikely to be approved as drawn',
};

export function assessLpa({ authorityName, verdict, flags = {}, proposal, plotAreaM2 = null, houseFootprintM2 = null, proposalAreaM2 = null, existingDepthM = 0, outsidePlot = null, publicLand = null, habitableRooms = null, fortyFive = null, precedent = null, habitableRoomsSource = 'epc' }) {
  const entry = lpaFor(authorityName);
  if (!entry) return { available: false, authority: authorityName ?? null, headline: authorityName ? `No local rules loaded for ${authorityName} yet – only the national rules were applied.` : 'The planning authority is not known – only the national rules were applied.', checks: [] };

  const R = entry.rules, checks = [];
  const add = (status, message, ref = null) => checks.push({ status, message, ref });

  const house = houseFootprintM2 ?? null, ext = proposalAreaM2 ?? 0;
  const remaining = plotAreaM2 != null && house != null ? r1(plotAreaM2 - house - ext) : null;
  const measured = {
    plotAreaM2: plotAreaM2 != null ? r1(plotAreaM2) : null, houseFootprintM2: house != null ? r1(house) : null, extensionAreaM2: r1(ext),
    remainingGardenM2: remaining, coveragePct: plotAreaM2 && house != null ? Math.round(((house + ext) / plotAreaM2) * 100) : null,
  };

  // work that is not on the applicant's land is not a design question
  const landBlock = publicLand?.level === 'certain' || outsidePlot?.level === 'certain';
  if (landBlock) add('fail', publicLand?.level === 'certain' ? 'Part of the work is on public land (pavement / highway), which the applicant does not own.' : 'Part of the work is outside the registered title, on land the applicant does not own – it needs the owner\'s agreement and the correct ownership notice on the application.');

  if (verdict === 'permitted_development') {
    add('info', 'Permitted development is not judged against local design guidance. Confirm there is no Article 4 direction or planning condition removing the right.');
  } else {
    const type = proposal?.type;
    const rear = type === 'rear_extension' || type === 'wraparound_extension';
    if (rear && proposal.depthM != null && R.rearDepthGuideM) {
      const total = r1((existingDepthM ?? 0) + proposal.depthM), g = R.rearDepthGuideM.value;
      if (total <= g) add('pass', `Rear depth of ${total} m is within the Council's ${g} m guide.`, R.rearDepthGuideM.ref);
      else if (total <= 2 * g) add('warn', `Rear depth of ${total} m is more than the Council's ${g} m guide, which it says is likely to be too overbearing for neighbours.`, R.rearDepthGuideM.ref);
      else add('warn', `Rear depth of ${total} m is more than double the Council's ${g} m guide – refusal is likely unless the neighbours' layout clearly allows it.`, R.rearDepthGuideM.ref);
    }
    if (measured.remainingGardenM2 != null && R.gardenPerHabitableRoomM2 && type !== 'rear_dormer' && type !== 'additional_storey') {
      const per = R.gardenPerHabitableRoomM2.value, rooms = Math.max(0, Math.floor(measured.remainingGardenM2 / per));
      if (habitableRooms != null) {                                  // the energy certificate gives the real count: test it properly
        const need = habitableRooms * per, ok = measured.remainingGardenM2 >= need;
        measured.habitableRooms = habitableRooms; measured.gardenNeededM2 = need;
        add(ok ? 'pass' : 'warn', `${habitableRoomsSource === 'user' ? `You told us the house has ${habitableRooms} habitable rooms` : `The energy certificate records ${habitableRooms} habitable rooms`}, so the Council expects about ${need} m² of private garden (${per} m² each). About ${measured.remainingGardenM2} m² would be left (indicative – includes front garden and paths)${ok ? '.' : ', which is short. The extension may add rooms, which raises the figure.'}`, R.gardenPerHabitableRoomM2.ref);
      } else {
      const txt = `About ${measured.remainingGardenM2} m² of plot would be left after the house and this extension (indicative – it includes any front garden and paths). The Council expects ${per} m² per habitable room, so that supports about ${rooms} habitable room${rooms === 1 ? '' : 's'}.`;
      add(rooms < 4 ? 'warn' : 'pass', rooms < 4 ? `${txt} A family house usually has more, so the garden left may be judged too small.` : txt, R.gardenPerHabitableRoomM2.ref);
      }
    }
    if (type === 'side_extension' || type === 'wraparound_extension') {
      if (R.sideSetbackFromFrontM) add('info', `The Council expects a side extension to be set back ${R.sideSetbackFromFrontM.value} m from the front building line.`, R.sideSetbackFromFrontM.ref);
      R.notes.side?.forEach((m) => add('info', m));
    }
    if (precedent && precedent.decided >= 3 && precedent.approvalRate != null) {   // what the council has actually decided nearby
      const pctTxt = `${precedent.approved} of ${precedent.decided} similar applications within ${precedent.radiusM} m in ${precedent.years} years were approved`;
      measured.precedentApprovalRate = precedent.approvalRate;
      if (precedent.approvalRate >= 0.7) add('pass', `${pctTxt}, so similar work has usually been accepted here.`, 'Planning history');
      else if (precedent.approvalRate <= 0.4) add('warn', `Only ${pctTxt}, so similar work has often been refused here – read the refusal reasons.`, 'Planning history');
      else add('info', `${pctTxt}: a mixed record, so the details of the design matter.`, 'Planning history');
    }
    const measured45 = fortyFive && fortyFive.status !== 'unavailable';
    if (rear && measured45) {
      measured.fortyFive = fortyFive.status;
      add(fortyFive.status === 'breach' ? 'warn' : 'pass', fortyFive.status === 'breach'
        ? `The extension crosses the Council's 45-degree line from the neighbour's window you marked by about ${fortyFive.excessM} m – the Council applies this test and may refuse it.`
        : 'The extension stays within the Council\'s 45-degree line from the neighbour\'s window you marked.', R.notes.fortyFiveRef ?? 'SPD 5.2.1');
    }
    if (rear) R.notes.rear?.filter((m) => !(measured45 && /45 degree/.test(m))).forEach((m) => add('info', m));
    if (rear && (proposal.storeys ?? 1) > 1) R.notes.twoStorey?.forEach((m) => add('warn', m));
    if (type === 'front_porch') R.notes.porch?.forEach((m) => add('info', m));
    if (flags.conservationArea) R.notes.conservation?.forEach((m) => add('warn', m));
  }

  const fails = checks.some((c) => c.status === 'fail'), warns = checks.some((c) => c.status === 'warn');
  const outlook = fails ? 'unlikely' : verdict === 'permitted_development' ? 'not_needed' : warns ? 'at_risk' : 'likely_ok';
  return { available: true, authority: entry.name, document: entry.document, url: entry.url, caution: entry.caution ?? null, measured, checks, outlook, headline: OUTLOOK[outlook] };
}

/**
 * The plot / house / extension figures, with HOW each was worked out, so a person can check them. Always shown, with or without LPA rules.
 *   left over = plot - house footprint - extension footprint   (indicative: includes front garden, paths, sheds)
 *   plot covered = (house + extension) / plot
 */
export function buildAreas({ plotAreaM2 = null, plotKind = null, houseFootprintM2 = null, extensionAreaM2 = null, extensionDims = null, extensionLabel = null }) {
  const m = (n) => (n == null ? null : `${r1(n)} m²`);
  const plotHow = { title: 'Area of the HM Land Registry registered title polygon (indicative – not the legal boundary).', estimate: 'Area of the outline estimated from neighbouring buildings, roads and fences – not a confirmed boundary.', user: 'The figure you entered.' }[plotKind] ?? 'Area of the plot outline.';
  const ext = extensionAreaM2 ?? 0;
  const left = plotAreaM2 != null && houseFootprintM2 != null ? plotAreaM2 - houseFootprintM2 - ext : null;
  const rows = [
    { label: 'Plot (land) area', value: m(plotAreaM2), how: plotAreaM2 == null ? 'No plot outline or site area found.' : plotHow },
    { label: 'House footprint', value: m(houseFootprintM2), how: houseFootprintM2 == null ? 'No building outline found.' : 'Area of the building outline from OpenStreetMap (includes any extension already drawn in it).' },
    { label: 'Proposed extension', value: extensionAreaM2 == null ? null : m(ext), how: extensionAreaM2 == null ? 'No proposal chosen yet.' : `Footprint of the shape on the plan${extensionDims ? ` (${extensionDims})` : ''}${extensionLabel ? ` – ${extensionLabel}` : ''}. Roof-only work adds no footprint.` },
    { label: 'House + extension', value: houseFootprintM2 == null ? null : m(houseFootprintM2 + ext), how: 'House footprint + proposed extension.' },
    { label: 'Left over (garden, indicative)', value: left == null ? null : m(left), how: 'Plot area − house footprint − extension. Includes the front garden, paths and any sheds.' },
    { label: 'Plot covered', value: plotAreaM2 && houseFootprintM2 != null ? `${Math.round(((houseFootprintM2 + ext) / plotAreaM2) * 100)}%` : null, how: '(House + extension) ÷ plot area.' },
  ].filter((r) => r.value != null || r.label === 'Plot (land) area' || r.label === 'House footprint');
  return { rows };
}
