import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProposal } from '../src/services/permittedDevelopment.js';
import { classifyApplication } from '../src/providers/planit.js';

const rear = (extra = {}, input = {}) => assessProposal({ country: 'England', houseForm: 'semi-detached', existingExtensionDepthM: 0, plotAreaM2: 200,
  proposal: { type: 'rear_extension', storeys: 1, depthM: 3, widthM: 4, heightM: 3.4, eavesHeightM: 2.8, distanceToSideBoundaryM: 3, additionsAreaM2: 15, ...extra }, ...input });
const status = (a, id) => a.checks.find((c) => c.id === id)?.status;

test('A.2(a): cladding on protected land fails, and the same finish elsewhere does not', () => {
  assert.equal(status(rear({ cladding: 'render' }, { flags: { article23Land: true } }), 'cladding'), 'fail');
  assert.equal(rear({ cladding: 'render' }, { flags: { article23Land: true } }).verdict, 'planning_permission');
  assert.equal(status(rear({ cladding: 'render' }), 'cladding'), undefined);
  assert.equal(status(rear({ cladding: 'none' }, { flags: { article23Land: true } }), 'cladding'), undefined);
});

test('unanswered form questions give one warning that names them; answered ones pass or fail', () => {
  const open = rear({ beyondFront: 'unknown', hasProhibited: 'unknown', crossesRightOfWay: 'unknown', convertedUnderPart3: 'unknown' });
  assert.equal(status(open, 'details-unconfirmed'), 'warn');
  assert.match(open.checks.find((c) => c.id === 'details-unconfirmed').message, /A\.1\(e\).*A\.1\(k\)/);
  assert.equal(open.confidence, 'needs_confirmation');
  const done = rear({ beyondFront: 'no', hasProhibited: 'no', crossesRightOfWay: 'no', convertedUnderPart3: 'no' });
  assert.equal(status(done, 'details-unconfirmed'), undefined);
  assert.equal(status(done, 'principal-elevation'), 'pass');
  assert.equal(status(done, 'prohibited-features'), 'pass');
  assert.equal(done.verdict, 'permitted_development');
  assert.equal(rear({ beyondFront: 'yes' }).verdict, 'planning_permission');
});

test('a house the planning history shows was created under a Part 3 right has no Class A rights', () => {
  const a = rear({ convertedUnderPart3: 'unknown' }, { flags: { part3Conversion: true } });
  assert.equal(status(a, 'dwelling-origin'), 'fail');
  assert.equal(a.verdict, 'planning_permission');
});

test('planning history: office / shop / barn to home is recognised as a Part 3 change of use; ordinary work is not', () => {
  assert.equal(classifyApplication('Prior approval for change of use from office (Class B1a) to 4 dwellinghouses', 'Prior').part3, true);
  assert.equal(classifyApplication('Change of use of agricultural barn to a dwelling (Class Q)', 'Prior').part3, true);
  assert.equal(classifyApplication('Single storey rear extension', 'Full').part3, false);
  assert.equal(classifyApplication('Conversion of house to 3 flats', 'Full').part3, false);
});
