// Tests the EPC service with your settings.   npm run check:epc -- "SW1A 2AA" ["10 Downing Street"]
// Prints the HTTP status, the top-level shape of the answer, the first row's field names, and what our code makes of it.
import { createEpc, epcAuthHeader, extractRows, normaliseEpcRow } from '../src/providers/epc.js';

const url = process.env.EPC_API_URL ?? 'https://epc.opendatacommunities.org/api/v1/domestic/search';
const auth = epcAuthHeader({ email: process.env.EPC_API_EMAIL, key: process.env.EPC_API_KEY, token: process.env.EPC_API_TOKEN });
const param = process.env.EPC_POSTCODE_PARAM ?? 'postcode';
const [postcode, line1 = ''] = process.argv.slice(2);
if (!postcode) { console.log('Usage: npm run check:epc -- "<postcode>" ["<first address line>"]'); process.exit(1); }
if (!auth) { console.log('No credentials: set EPC_API_TOKEN (new service) or EPC_API_EMAIL + EPC_API_KEY (old register).'); process.exit(1); }

const full = `${url}${url.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(postcode)}&size=5`;
console.log('GET', full, '\nauth:', auth.split(' ')[0]);
const res = await fetch(full, { headers: { authorization: auth, accept: 'application/json', 'User-Agent': process.env.HTTP_USER_AGENT ?? 'uk-planning-engine-check' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
console.log('status', res.status, res.headers.get('content-type') ?? '', res.headers.get('location') ? `-> redirect to ${res.headers.get('location')}` : '');
const text = await res.text();
let data; try { data = JSON.parse(text); } catch { console.log('Not JSON:', text.replace(/\s+/g, ' ').slice(0, 300)); process.exit(0); }
console.log('top-level keys:', Array.isArray(data) ? `array(${data.length})` : Object.keys(data).join(', '));
const rows = extractRows(data);
console.log('rows found:', rows.length);
if (rows[0]) { console.log('first row fields:', Object.keys(rows[0]).join(', ')); console.log('as our record:', normaliseEpcRow(rows[0])); }
else console.log('No rows. Raw start:', text.replace(/\s+/g, ' ').slice(0, 300));
if (line1) console.log('\nfindByAddress ->', await createEpc({ url, email: process.env.EPC_API_EMAIL, key: process.env.EPC_API_KEY, token: process.env.EPC_API_TOKEN, postcodeParam: param }).findByAddress({ postcode, line1 }));
