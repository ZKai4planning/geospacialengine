import { classForType, FACTS, SCHEDULE } from '../data/gpdo.js';

/**
 * STAGE 1 – PROJECT CLASSIFIER.
 * Says WHAT the project is (development type and the GPDO Class that governs it), which approval routes could apply,
 * and which planning questions still need an answer before the rules can be tested properly.
 * It does not decide the outcome – that is the rule engine (permittedDevelopment.js + gpdoEngine.js).
 *
 * classifyProject({ proposal, original, houseForm, flags, profile, constraintsChecked, frontSpaceKnown })
 *   proposal = the work as screened (a drawn shape is already standardised to a rear/side extension or outbuilding)
 *   original = what the person actually chose (e.g. 'custom_polygon') - for the wording only
 */
const ROUTES = {
  permitted_development: 'Permitted development (no application, optionally a Lawful Development Certificate)',
  prior_approval: 'Prior approval – neighbour consultation (larger home extension)',
  householder_planning: 'Householder planning application',
  listed_building_consent: 'Listed building consent',
};

export function classifyProject({ proposal, original = null, houseForm = 'other', flags = {}, profile = null, constraintsChecked = true, frontSpaceKnown = false }) {
  if (!proposal) return null;
  const cls = classForType(proposal.type);
  if (!cls) return { workType: proposal.type, developmentType: 'Unclassified work', gpdo: null, routes: [], questions: [], conditions: [] };

  const ctx = { profile, flags, constraintsChecked, frontSpaceKnown };
  const known = (key) => {
    if (key === 'originalDwelling') { const v = profile?.originalDwelling; return v?.value != null ? (v.source === 'user' ? 'answered' : 'known') : null; }
    if (key === 'existingExtension') { const e = profile?.existingExtension; return e?.present != null ? (e.source === 'user' ? 'answered' : 'known') : null; }
    const f = FACTS[key]?.field;
    return f && proposal[f] != null ? (proposal._auto?.includes(f) ? 'known' : 'answered') : null;
  };

  // which facts do the provisions that apply to this work need, and which of those do we already hold?
  const wanted = new Map(); // fact -> provision ref(s)
  for (const pr of cls.provisions) {
    if ((pr.types && !pr.types.includes(proposal.type)) || (pr.when && !pr.when(proposal))) continue;
    for (const key of pr.needs?.(proposal, ctx) ?? []) wanted.set(key, [...(wanted.get(key) ?? []), pr.ref]);
  }
  // facts that were already supplied still deserve a line ("answered"), so the person can see what the result rests on
  const questions = [];
  for (const [key, refs] of wanted) {
    const st = known(key);
    questions.push({ fact: key, question: FACTS[key].question, field: FACTS[key].field ?? null, where: FACTS[key].where ?? 'form', refs, status: st ?? 'needed' });
  }
  for (const pr of cls.provisions) { // answered facts that the provision would have needed under other circumstances
    if (pr.types && !pr.types.includes(proposal.type)) continue;
    for (const key of ['eavesHeightM', 'distanceToSideBoundaryM', 'distanceToRearBoundaryM', 'distanceToBoundaryM', 'distanceToHighwayM', 'additionsAreaM2', 'volumeM3']) {
      if (pr.needs && FACTS[key]?.field && proposal[FACTS[key].field] != null && !questions.some((q) => q.fact === key) && pr.evidence.length) {
        questions.push({ fact: key, question: FACTS[key].question, field: FACTS[key].field, where: 'form', refs: [pr.ref], status: known(key) ?? 'answered' });
      }
    }
  }
  questions.sort((a, b) => (a.status === 'needed' ? 0 : 1) - (b.status === 'needed' ? 0 : 1));

  // approval routes that could apply to this kind of work
  const routes = ['permitted_development'];
  if (cls.class === 'A' && proposal.type !== 'side_extension') routes.push('prior_approval');
  if (cls.class === 'AA') routes.push('prior_approval');
  routes.push('householder_planning');
  if (flags.listedBuilding) routes.unshift('listed_building_consent');

  const drawn = original?.type === 'custom_polygon';
  return {
    workType: proposal.type, drawn,
    developmentType: `${cls.developmentType}${drawn ? ' (drawn shape, screened as this)' : ''}`,
    gpdo: { schedule: SCHEDULE, part: cls.part, class: cls.class, title: cls.title },
    routes: routes.map((id) => ({ id, label: ROUTES[id] })),
    questions,
    needed: questions.filter((q) => q.status === 'needed').length,
    conditions: cls.provisions.filter((p) => p.kind === 'condition' && (!p.types || p.types.includes(proposal.type)) && (!p.when || p.when(proposal))).map((p) => ({ ref: p.ref, text: p.text })),
  };
}
