import test from 'node:test';
import assert from 'node:assert/strict';
import { appealsFromRows, hnpdFromRows, rowsFromCsv, ofcomColumns, ofcomRowsToCsv, postcodeIn, PrepError } from '../src/register/openDataPrep.js';
import { parseGeoFile, buildRows } from '../src/register/geoParse.js';
import { evaluateDataset } from '../src/register/geo.js';
import { DATASET_BY_KEY } from '../src/register/datasets.js';

test('postcodeIn finds a postcode inside an address', () => {
  assert.equal(postcodeIn('1 High Street, Hull, HU1 2AB'), 'HU1 2AB');
  assert.equal(postcodeIn('Land at Foo, SW1A1AA'), 'SW1A 1AA');
  assert.equal(postcodeIn('no postcode here'), null);
});

test('appeals: placed at the postcode, undecided and unplaceable rows counted not guessed', async () => {
  const rows = [
    { Reference: '3300001', 'Type of Appeal': 'Planning Appeal (S78)', 'LPA Name': 'Hull', 'Site Address': '1 High St, Hull, HU1 2AB', Decision: 'Dismissed', 'Decision Date': '12/03/2025', 'LPA Decision Date': '01/01/2025' },
    { Reference: '3300002', 'Site Address': '2 High St, Hull', Decision: 'Allowed', 'Decision Date': '2025-04-01' },
    { Reference: '3300003', 'Site Address': '3 High St, HU1 2AB', Decision: '' },
    { Reference: '3300004', 'Site Address': '4 High St, ZZ9 9ZZ', Decision: 'Allowed' },
  ];
  const { features, stats } = await appealsFromRows(rows, async () => new Map([['HU1 2AB', { lat: 53.74, lng: -0.33 }]]));
  assert.equal(features.length, 1);
  assert.deepEqual([stats.noPostcode, stats.noDecision, stats.notPlaced, stats.written], [1, 1, 1, 1]);
  assert.equal(features[0].properties.decidedOn, '2025-03-12'); // the appeal decision date, not the LPA's
  assert.equal(features[0].properties.locationBasis, 'postcode');
  await assert.rejects(() => appealsFromRows([{ Foo: 'x' }], async () => new Map()), PrepError);
});

test('heat networks: National Grid X/Y converted, gone projects dropped', () => {
  const rows = rowsFromCsv('Ref ID,Operator (or Applicant),Site Name,Development Status (short),Address,Post Code,X-coordinate,Y-coordinate\n8281,GT Energy,Etruria Geothermal,Awaiting Construction,"Land Off Festival Way, Stoke",ST1 5PU,386852,347977\n1,Old Co,Gone,Decommissioned / Abandoned,x,y,386852,347977\n2,No Coords,x,Operational,x,y,,\n');
  const { features, stats } = hnpdFromRows(rows);
  assert.equal(features.length, 1); assert.equal(stats.inactive, 1); assert.equal(stats.noCoordinates, 1);
  const [lng, lat] = features[0].geometry.coordinates;
  assert.ok(lat > 52.9 && lat < 53.1 && lng > -2.3 && lng < -2.0, `${lat},${lng}`);
  // and the register loader accepts the output and finds it within 250 m
  const row = buildRows(parseGeoFile(JSON.stringify(features[0]) + '\n' + JSON.stringify(features[0]), { format: 'jsonl' }), {});
  assert.equal(row.rows.length, 2); assert.ok(row.rows[0].geom.type === 'Point');
});

test('ofcom: key plus coverage columns kept with their published names', () => {
  const rows = rowsFromCsv('postcode,postcode_space,All Matched Premises,All Premises with >=300Mbit/s,Gigabit availability (% premises),Something else\nHU12AB,HU1 2AB,40,"55",12,x\n');
  const cols = ofcomColumns(Object.keys(rows[0]));
  assert.equal(cols.key, 'postcode_space');
  assert.ok(cols.keep.includes('Gigabit availability (% premises)') && !cols.keep.includes('Something else'));
  assert.match(ofcomRowsToCsv(rows, cols), /^postcode,.*\nHU1 2AB,/);
  assert.throws(() => ofcomColumns(['postcode_space', 'nothing']), PrepError);
});

test('catalogue: the corrected dataset definitions', () => {
  assert.match(DATASET_BY_KEY['env-permits'].licence, /CONDITIONAL/);
  assert.equal(DATASET_BY_KEY['heat-networks'].geom, 'point');
  assert.match(DATASET_BY_KEY.aqma.obtain, /planning\.data\.gov\.uk/);
  assert.ok(evaluateDataset); // loader path unchanged
});
