import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostcode, extractPostcode, looksLikePartialPostcode } from '../src/utils/postcode.js';

test('parsePostcode normalises', () => {
  assert.equal(parsePostcode('e62aa'), 'E6 2AA');
  assert.equal(parsePostcode(' sw1a 2aa '), 'SW1A 2AA');
  assert.equal(parsePostcode('hello'), null);
});
test('extractPostcode finds postcode in free text', () => {
  assert.deepEqual(extractPostcode('22 e6 2aa'), { postcode: 'E6 2AA', rest: '22' });
});
test('partial postcode detection', () => {
  assert.ok(looksLikePartialPostcode('E6'));
  assert.ok(looksLikePartialPostcode('SW1A 2'));
  assert.ok(!looksLikePartialPostcode('22 Example Road'));
});
