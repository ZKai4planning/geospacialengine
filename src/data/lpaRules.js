/**
 * LOCAL PLANNING AUTHORITY (LPA) RULES.
 *
 * National permitted-development (PD) limits come from the GPDO (see permittedDevelopment.js). When work is NOT permitted
 * development, the council decides it against its own policy and design guidance (a Supplementary Planning Document, SPD).
 * This file holds the NUMBERS from those documents, one entry per authority, each with its source so a person can check it.
 *
 * To add a council: copy the entry below, change the key (lower case, no "London Borough of") and fill in only what the
 * council's guidance actually says. Leave a value null/undefined when the guidance gives no number – that rule is then skipped.
 * Values are GUIDANCE, not law: breaking one makes a refusal more likely, it does not make the work unlawful.
 */
export const LPA_RULES = {
  'waltham forest': {
    name: 'Waltham Forest',
    document: 'Residential Extensions and Alterations SPD (adopted February 2010)',
    url: 'https://www.walthamforest.gov.uk/sites/default/files/2022-08/residential-extensionsfeb10%20AA.pdf',
    retrievedAt: '2026-10-21',
    caution: 'This is the 2010 SPD. The council has been preparing a newer one – check the current guidance before relying on it.',
    rules: {
      rearDepthGuideM: { value: 3, ref: 'SPD 5.2.1 "The 3 metre rule": up to 3 m generally acceptable; more is likely to be too overbearing (conservatories may be judged case by case).' },
      gardenPerHabitableRoomM2: { value: 15, ref: 'SPD 5.1.5: 15 m² of remaining usable private garden per habitable room (kitchens of 13 m² or more count as habitable).' },
      sideSetbackFromFrontM: { value: 1, ref: 'SPD 5.2.2: a side extension should be subordinate and set back 1 m from the main building line fronting the street.' },
      notes: {
        rear: [
          'The Council applies the "45 degree rule" to the nearest ground-floor habitable-room window of the neighbour (SPD 5.2.1) – this tool cannot see neighbours\' windows, so check it on a plan.',
          'Infilling the "L-shape" at the back of a Victorian/Edwardian terrace is usually refused (tunnel effect) unless the neighbour extends in the same way at the same time (SPD 5.2.1).',
        ],
        twoStorey: ['Two-storey rear extensions are "not always appropriate" on standard Victorian/Edwardian houses (SPD 5.2.1).'],
        side: ['Large side extensions may be refused where gaps between houses are a feature of the street; side windows are generally not permitted if they overlook a neighbour (SPD 5.2.2).'],
        porch: ['Porches are closely scrutinised and may not suit Victorian/Edwardian houses; other front extensions are normally refused (SPD 5.2.3, UDP PSC5).'],
        conservation: ['In conservation areas there is no PD for side extensions or rear extensions of more than one storey; in Browning Road and Walthamstow Village all rear extensions need permission (SPD Appendix 3).'],
      },
    },
  },
};

export const lpaKey = (name) => String(name ?? '').toLowerCase().replace(/^(london )?(borough|city|royal borough) of\s+/, '').replace(/\s+(london )?(borough )?(council)?$/, '').replace(/\s+/g, ' ').trim();
export const lpaFor = (name) => LPA_RULES[lpaKey(name)] ?? null;
