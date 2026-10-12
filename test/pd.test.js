import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProposal } from '../src/services/permittedDevelopment.js';

const rear = (o = {}) => ({ type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3, distanceToSideBoundaryM: 3, ...o });
const base = { houseForm: 'terraced', existingExtensionDepthM: 0 };

test('3 m rear extension on a terrace, no existing -> PD', () => {
  assert.equal(assessProposal({ ...base, proposal: rear() }).verdict, 'permitted_development');
});
test('5 m on a terrace -> prior approval', () => {
  assert.equal(assessProposal({ ...base, proposal: rear({ depthM: 5 }) }).verdict, 'prior_approval');
});
test('existing 2.8 m + proposed 4.0 m on a terrace -> planning permission', () => {
  assert.equal(assessProposal({ ...base, existingExtensionDepthM: 2.8, proposal: rear({ depthM: 4 }) }).verdict, 'planning_permission');
});
test('protected land removes prior approval route', () => {
  assert.equal(assessProposal({ ...base, flags: { article23Land: true }, proposal: rear({ depthM: 5 }) }).verdict, 'planning_permission');
});
test('flats, listed buildings, outside England', () => {
  assert.equal(assessProposal({ ...base, houseForm: 'flat', proposal: rear() }).verdict, 'planning_permission');
  assert.equal(assessProposal({ ...base, flags: { listedBuilding: true }, proposal: rear() }).verdict, 'listed_building_consent');
  assert.equal(assessProposal({ ...base, country: 'Wales', proposal: rear() }).verdict, 'not_applicable');
});
test('side extension: more than half the house width fails', () => {
  const p = { type: 'side_extension', side: 'right', storeys: 1, widthM: 3, heightM: 3, distanceToSideBoundaryM: 3 };
  assert.equal(assessProposal({ ...base, houseWidthM: 5, proposal: p }).verdict, 'planning_permission');
  assert.equal(assessProposal({ ...base, houseWidthM: 7, proposal: p }).verdict, 'permitted_development');
});
test('porch limits', () => {
  assert.equal(assessProposal({ ...base, proposal: { type: 'front_porch', widthM: 1.6, depthM: 1.5, heightM: 2.8, distanceToHighwayM: 3 } }).verdict, 'permitted_development');
  assert.equal(assessProposal({ ...base, proposal: { type: 'front_porch', widthM: 2.5, depthM: 1.5, heightM: 2.8, distanceToHighwayM: 3 } }).verdict, 'planning_permission');
});
test('loft dormer: terrace 40 m³ allowance, protected land and balcony fail', () => {
  const d = { type: 'rear_dormer', widthM: 3.5, depthM: 2.5, heightM: 2.3, balcony: false };
  assert.equal(assessProposal({ ...base, proposal: d }).verdict, 'permitted_development');
  assert.equal(assessProposal({ ...base, proposal: { ...d, volumeM3: 55 } }).verdict, 'planning_permission');
  assert.equal(assessProposal({ ...base, flags: { article23Land: true }, proposal: d }).verdict, 'planning_permission');
  assert.equal(assessProposal({ ...base, proposal: { ...d, balcony: true } }).verdict, 'planning_permission');
});
test('outbuilding height rules', () => {
  const o = { type: 'outbuilding', widthM: 3, depthM: 4, heightM: 2.5, roof: 'flat', setbackM: 5, distanceToBoundaryM: 1 };
  assert.equal(assessProposal({ ...base, proposal: o }).verdict, 'permitted_development');
  assert.equal(assessProposal({ ...base, proposal: { ...o, heightM: 3 } }).verdict, 'planning_permission');
});
test('extra storey needs planning permission', () => {
  assert.equal(assessProposal({ ...base, proposal: { type: 'additional_storey', storeys: 1, heightM: 2.7 } }).verdict, 'planning_permission');
});
