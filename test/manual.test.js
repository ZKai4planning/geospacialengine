import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressService } from '../src/services/addressService.js';

const svc = createAddressService({ providers: {
  address: {}, postcodes: { lookup: async (pc) => (pc === 'IG6 2JE' ? { lat: 51.59, lng: 0.09, adminDistrict: 'Redbridge' } : null) },
} });

test('manual address is validated and located at the postcode centre', async () => {
  const a = await svc.manual({ line1: ' 22 Example Road<script>', town: '', postcode: 'ig62je' });
  assert.equal(a.postcode, 'IG6 2JE');
  assert.equal(a.buildingNumber, '22');
  assert.equal(a.thoroughfare, 'Example Roadscript');
  assert.equal(a.postTown, 'Redbridge');
  assert.equal(a.approximate, true);
  assert.equal(a.uprn, null);
  assert.match(a.fullAddress, /IG6 2JE$/);
});
test('manual address rejects bad input', async () => {
  await assert.rejects(() => svc.manual({ line1: '1 High St', postcode: 'nope' }), /valid UK postcode/);
  await assert.rejects(() => svc.manual({ line1: '', postcode: 'IG6 2JE' }), /first line/);
  await assert.rejects(() => svc.manual({ line1: '1 High St', postcode: 'ZZ9 9ZZ' }), /could not find/);
});
