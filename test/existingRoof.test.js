import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { resolveExistingRoof, describeExistingRoof } from '../src/services/existingRoof.js';
import { traceGpdo } from '../src/services/gpdoEngine.js';

const LIDAR = { status: 'ok', roofShape: 'pitched', eavesM: 5.2, ridgeM: 8.1, confidence: 'high', groundFallM: 0.2 };

test('resolveExistingRoof: LiDAR (high/medium) wins; low confidence is not used; the map tag is the fallback; nothing = null', () => {
  assert.deepEqual(resolveExistingRoof({ lidar: LIDAR }), { source: 'lidar', confidence: 'high', toleranceM: 0.5, ridgeM: 8.1, eavesM: 5.2, roofShape: 'pitched', groundFallM: 0.2 });
  assert.equal(resolveExistingRoof({ lidar: { ...LIDAR, confidence: 'medium' } }).toleranceM, 0.8);
  const low = resolveExistingRoof({ lidar: { ...LIDAR, confidence: 'low' }, footprint: { heightM: 7 } });
  assert.equal(low.source, 'osm'); assert.equal(low.ridgeM, 7); assert.equal(low.eavesM, null);
  assert.equal(resolveExistingRoof({ lidar: { status: 'unclear' } }), null);
  assert.equal(resolveExistingRoof({}), null);
  assert.match(describeExistingRoof(resolveExistingRoof({ lidar: LIDAR })), /ridge 8\.1 m, eaves 5\.2 m.*high confidence/);
});

const go = (proposal, roof) => assessProposal({ country: 'England', houseForm: 'terraced', proposal: { type: 'rear_extension', storeys: 1, depthM: 2, widthM: 3, distanceToSideBoundaryM: 3, ...proposal }, existingExtensionDepthM: 0, existingRoof: roof, plotAreaM2: 100 });
const chk = (a, id) => a.checks.find((c) => c.id === id);
const roof = resolveExistingRoof({ lidar: LIDAR });

test('A.1(c) ridge: clearly below passes; within tolerance is "too close to call"; clearly above FAILS and changes the verdict', () => {
  assert.equal(chk(go({ heightM: 3.5 }, roof), 'existing-height').status, 'pass');
  assert.equal(chk(go({ heightM: 7.8 }, roof), 'existing-height').status, 'warn');             // 0.3 m under the ridge: inside the +-0.5 m tolerance
  const hi = go({ heightM: 9.5 }, roof);                                                          // 1.4 m above: more than twice the tolerance
  assert.equal(chk(hi, 'existing-height').status, 'fail');
  assert.match(chk(hi, 'existing-height').message, /about 1\.4 m above the existing ridge.*LiDAR/);
  assert.equal(hi.verdict, 'planning_permission');
});

test('a medium-confidence LiDAR reading can warn but never fail', () => {
  const med = resolveExistingRoof({ lidar: { ...LIDAR, confidence: 'medium' } });
  assert.equal(chk(go({ heightM: 12 }, med), 'existing-height').status, 'warn');
});

test('A.1(d) eaves: tested against the measured eaves; unknown extension eaves = no check', () => {
  assert.equal(chk(go({ heightM: 3, eavesHeightM: 2.6 }, roof), 'existing-eaves').status, 'pass');
  assert.equal(chk(go({ heightM: 3, eavesHeightM: 5 }, roof), 'existing-eaves').status, 'warn');
  assert.equal(chk(go({ heightM: 3, eavesHeightM: 6.6 }, roof), 'existing-eaves').status, 'fail');
  assert.equal(chk(go({ heightM: 3 }, roof), 'existing-eaves'), undefined);
  const osmOnly = resolveExistingRoof({ footprint: { heightM: 7 } });
  assert.equal(chk(go({ heightM: 3, eavesHeightM: 6.6 }, osmOnly), 'existing-eaves'), undefined, 'a map tag has no eaves, so nothing is invented');
});

test('the map-tag path is unchanged (prompt only, never a fail)', () => {
  const osm = resolveExistingRoof({ footprint: { heightM: 3 } });
  const a = go({ heightM: 3.5 }, osm);
  assert.equal(chk(a, 'existing-height').status, 'warn');
  assert.notEqual(a.verdict, 'planning_permission');
});

test('sloping ground adds an information line only when the fall is 0.5 m or more', () => {
  assert.equal(chk(go({ heightM: 3 }, roof), 'ground-level'), undefined);
  const a = go({ heightM: 3 }, { ...roof, groundFallM: 0.9 });
  assert.equal(chk(a, 'ground-level').status, 'info');
  assert.match(chk(a, 'ground-level').message, /falls about 0\.9 m/);
});

test('the GPDO provision shows how it was decided: tested (pass/fail) when LiDAR is there, not assessed when there is no height', () => {
  const prov = (a) => traceGpdo({ workType: 'rear_extension', checks: a.checks, proposal: {} }).provisions.find((p) => p.id === 'roof-height');
  assert.equal(prov(go({ heightM: 3, eavesHeightM: 2.6 }, roof)).status, 'pass');
  assert.equal(prov(go({ heightM: 9.5 }, roof)).status, 'fail');
  assert.equal(prov(go({ heightM: 3 }, null)).status, 'not_assessed');
});
