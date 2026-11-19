import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveRegister } from '../src/services/intelligenceRegister.js';

const row = (doc, id) => doc.checks.find((c) => c.id === id);
const flood = {
  surfaceWater: { status: 'ok', band: 'high', mapped: true, text: 'High (3.3% or more a year, 1 in 30)' },
  recorded: { status: 'inside', events: [{ source: 'river', start: '2007-07-20' }], nearM: 250 },
  reservoir: { status: 'outside', events: [], nearM: 250 },
};
const infra = { watercourses: [{ kind: 'river', name: 'River Test', distanceM: 5 }], substations: [{ distanceM: 40, operator: 'UKPN' }], signals: [] };

test('open flood data answers when the dataset is not loaded, and says where it came from', () => {
  const doc = buildLiveRegister({ id: 'a', flood, infra, address: { lat: 51, lng: 0 } }, {});
  assert.equal(row(doc, 'PI-08-02').live.state, 'issue');
  assert.match(row(doc, 'PI-08-02').live.value, /open data/);
  assert.equal(row(doc, 'PI-08-03').live.state, 'issue');
  assert.equal(row(doc, 'PI-08-05').live.state, 'pass');
  assert.equal(row(doc, 'PI-08-07').live.state, 'issue');
  assert.equal(row(doc, 'PI-10-03').live.state, 'info');
  assert.equal(row(doc, 'PI-08-12').live.state, 'issue');
});

test('without flood or infra data the checks stay awaiting, never pass', () => {
  const doc = buildLiveRegister({ id: 'a', address: { lat: 51, lng: 0 } }, {});
  for (const id of ['PI-08-02', 'PI-08-03', 'PI-08-05', 'PI-08-07', 'PI-08-08']) assert.equal(row(doc, id).live.state, 'awaiting', id);
});

test('a loaded dataset wins over the open fallback', () => {
  const geo = { results: { 'ea-rofsw': { status: 'ok', features: [], source: 'EA RoFSW, test' } }, standards: {} };
  const doc = buildLiveRegister({ id: 'a', flood, geo, address: { lat: 51, lng: 0 } }, {});
  assert.equal(row(doc, 'PI-08-02').live.state, 'pass');
  assert.match(row(doc, 'PI-08-02').live.value, /EA RoFSW, test/);
});
