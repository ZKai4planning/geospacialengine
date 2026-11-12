import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressService } from '../src/services/addressService.js';

const down = async () => { throw new Error('upstream down'); };
const info = { lat: 51.5, lng: 0.05, adminDistrict: 'Newham', region: 'London', country: 'England' };

test('full postcode with every address source down -> manual entry, not "unavailable"', async () => {
  const svc = createAddressService({ providers: { address: { byPostcode: down, find: down }, postcodes: { lookup: async () => info } } });
  const r = await svc.search('E6 2AA');
  assert.equal(r.type, 'postcode');
  assert.equal(r.manual, true);
  assert.deepEqual(r.suggestions, []);
  assert.match(r.message, /temporarily unavailable/);
});

test('UPRN database failure does not break the address list', async () => {
  const addr = { id: 'osm:way:1', uprn: null, fullAddress: '1 Test Road, E6 2AA', postcode: 'E6 2AA', lat: 1, lng: 1, classification: { propertyType: 'House' } };
  const svc = createAddressService({
    providers: { address: { byPostcode: async () => [addr], find: down }, postcodes: { lookup: async () => info } },
    uprnMatcher: { available: true, enrichMany: down },
  });
  const r = await svc.search('E6 2AA');
  assert.equal(r.type, 'postcode');
  assert.equal(r.suggestions.length, 1);
});

test('postcode search falls back to text search when the postcode list fails', async () => {
  const addr = { id: 'osm:way:2', uprn: null, fullAddress: '2 Test Road, N1 9GU', postcode: 'N1 9GU', lat: 1, lng: 1, classification: { propertyType: 'House' } };
  const svc = createAddressService({ providers: { address: { byPostcode: down, find: async () => [addr] }, postcodes: { lookup: async () => info } } });
  const r = await svc.search('N1 9GU');
  assert.equal(r.type, 'address');
  assert.equal(r.suggestions.length, 1);
});
