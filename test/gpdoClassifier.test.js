import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProject } from '../src/services/projectClassifier.js';
import { traceGpdo } from '../src/services/gpdoEngine.js';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { CLASSES, classForType } from '../src/data/gpdo.js';

const profile = { originalDwelling: { value: null, source: 'unconfirmed' }, existingExtension: { present: null, source: 'unconfirmed' } };

test('every work type the tool screens maps to one GPDO Class, and every provision has a paragraph reference', () => {
  for (const t of ['rear_extension', 'side_extension', 'wraparound_extension', 'front_porch', 'rear_dormer', 'additional_storey', 'outbuilding']) assert.ok(classForType(t), t);
  for (const c of Object.values(CLASSES)) for (const p of c.provisions) assert.ok(p.ref && p.text && Array.isArray(p.evidence), `${c.class} ${p.id}`);
});

test('classifier: a rear extension is Class A householder development; unanswered facts become questions, answered ones are marked', () => {
  const c = classifyProject({ proposal: { type: 'rear_extension', storeys: 1, depthM: 4, heightM: 3, additionsAreaM2: 40 }, profile });
  assert.equal(c.gpdo.class, 'A'); assert.match(c.developmentType, /Householder extension/);
  const by = Object.fromEntries(c.questions.map((q) => [q.fact, q]));
  assert.equal(by.originalDwelling.status, 'needed'); assert.equal(by.existingExtension.status, 'needed');
  assert.equal(by.additionsAreaM2?.status ?? 'answered', 'answered');
  assert.ok(by.prohibitedFeatures, 'balcony / chimney / roof alteration question is asked');
  assert.ok(c.routes.some((r) => r.id === 'prior_approval'));
  assert.ok(c.conditions.some((x) => /A\.3\(a\)/.test(x.ref)));
  assert.ok(c.needed >= 3);
});

test('classifier: eaves are only asked about when the work is within 2 m of a boundary', () => {
  const far = classifyProject({ proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3, distanceToSideBoundaryM: 5 }, profile });
  assert.ok(!far.questions.some((q) => q.fact === 'eavesHeightM'));
  const near = classifyProject({ proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3, distanceToSideBoundaryM: 1 }, profile });
  assert.equal(near.questions.find((q) => q.fact === 'eavesHeightM').status, 'needed');
});

test('classifier: porch = Class D, dormer = Class B, outbuilding = Class E, extra storey = Class AA; side extension has no prior-approval route', () => {
  const cls = (proposal) => classifyProject({ proposal, profile });
  assert.equal(cls({ type: 'front_porch', widthM: 1.6, depthM: 1.5, heightM: 2.8 }).gpdo.class, 'D');
  assert.equal(cls({ type: 'rear_dormer', widthM: 3, depthM: 2, heightM: 2 }).gpdo.class, 'B');
  assert.equal(cls({ type: 'outbuilding', widthM: 3, depthM: 4, heightM: 2.5, roof: 'flat' }).gpdo.class, 'E');
  assert.equal(cls({ type: 'additional_storey', storeys: 1, heightM: 2.7 }).gpdo.class, 'AA');
  assert.ok(!cls({ type: 'side_extension', widthM: 2, heightM: 3, storeys: 1 }).routes.some((r) => r.id === 'prior_approval'));
  assert.match(classifyProject({ proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, original: { type: 'custom_polygon' }, profile }).developmentType, /drawn shape/);
});

test('rule trace: a 7 m single-storey rear extension fails A.1(f)-(g); untested provisions are reported as not tested, never as a pass', () => {
  const proposal = { type: 'rear_extension', storeys: 1, depthM: 7, heightM: 3, widthM: 4 };
  const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal, existingExtensionDepthM: 0, plotAreaM2: 180 });
  assert.equal(a.verdict, 'planning_permission');
  const t = traceGpdo({ workType: 'rear_extension', checks: a.checks, route: a.verdict, proposal });
  const by = Object.fromEntries(t.provisions.map((p) => [p.id, p]));
  assert.equal(by['rear-depth'].status, 'fail'); assert.match(by['rear-depth'].ref, /A\.1\(f\)/);
  assert.equal(by['rear-depth'].evidence[0].id, 'rear-depth');
  assert.equal(by['roof-height'].status, 'not_assessed');
  assert.equal(by['prohibited-features'].status, 'not_assessed');
  assert.equal(by.materials.status, 'condition');
  assert.ok(!t.provisions.some((p) => p.id === 'side-limits' || p.id === 'two-storey'), 'side-extension and two-storey provisions are not listed for a one-storey rear extension');
  assert.ok(t.counts.fail >= 1);
  const two = traceGpdo({ workType: 'rear_extension', checks: [], proposal: { type: 'rear_extension', storeys: 2, depthM: 3, heightM: 5 } });
  assert.ok(two.provisions.some((p) => p.id === 'two-storey') && !two.provisions.some((p) => p.id === 'single-storey-height'));
});

test('rule trace: porch checks map to Class D and a 3.5 m² porch fails D.1(a)', () => {
  const a = assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'front_porch', widthM: 2.5, depthM: 1.5, heightM: 2.8, distanceToHighwayM: 5 }, plotAreaM2: 100 });
  const t = traceGpdo({ workType: 'front_porch', checks: a.checks });
  assert.equal(t.class, 'D');
  assert.equal(t.provisions.find((p) => p.id === 'porch-area').status, 'fail');
  assert.equal(t.provisions.find((p) => p.id === 'porch-height').status, 'pass');
});

import { LIMITS } from '../src/data/gpdo.js';
test('the numbers in the decision code come from the data table, and match the Order', () => {
  assert.deepEqual([LIMITS.rearDepthM, LIMITS.rearDepthPriorM], [{ attached: 3, detached: 4 }, { attached: 6, detached: 8 }]);
  assert.deepEqual([LIMITS.singleStoreyHeightM, LIMITS.boundaryDistanceM, LIMITS.eavesNearBoundaryM, LIMITS.twoStoreyDepthM, LIMITS.twoStoreyRearBoundaryM], [4, 2, 3, 3, 7]);
  assert.deepEqual([LIMITS.porchAreaM2, LIMITS.porchHeightM, LIMITS.porchHighwayM, LIMITS.curtilageFraction, LIMITS.sideWidthFraction], [3, 3, 2, 0.5, 0.5]);
  assert.deepEqual(LIMITS.dormerVolumeM3, { terraced: 40, other: 50 });
  // changing the table changes the decision: proves the code reads it rather than carrying its own copy
  const run = () => assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', storeys: 1, depthM: 3.5, widthM: 3, heightM: 3 }, existingExtensionDepthM: 0, plotAreaM2: 100 }).checks.find((c) => c.id === 'rear-depth').status;
  assert.equal(run(), 'warn');                                                      // 3.5 m: above 3 m, within the 6 m prior-approval route
  const saved = LIMITS.rearDepthM.attached; LIMITS.rearDepthM.attached = 4;
  try { assert.equal(run(), 'pass'); } finally { LIMITS.rearDepthM.attached = saved; }
});
