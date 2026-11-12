import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockPlanSvg, buildLdcPackHtml, chooseScale } from '../src/services/planExport.js';

process.env.MOCK_PROVIDERS = 'true';
const { createContainer } = await import('../src/container.js');
const { createMockProviders } = await import('../src/providers/mock.js');
const b = createMockProviders();
const mkSvc = () => createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null }, db: null }).applicationService;

test('scale: the smallest standard scale at which the whole map fits A4 landscape', () => {
  const map = (mPerPx, w = 640, h = 400) => ({ view: { w, h }, scale: { metres: 10, px: 10 / mPerPx } });
  const s = chooseScale(map(0.1));                                            // 64 m x 40 m of ground
  assert.equal(s.n, 250); assert.ok(s.widthMm <= 277 && s.heightMm <= 160.01);   // 1:200 would need 320 mm
  assert.equal(chooseScale(map(0.5)).n, 1250);                                // 320 m wide
  assert.equal(chooseScale(map(0.02)).n, 100);                                // very small site: 1:100 fits
});

test('flow: the block plan SVG is A4 in millimetres, carries the scale, title block, north point and dimensions', async () => {
  const svc = mkSvc();
  let app = await svc.create({ id: '1234567886' });
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  const svg = await svc.blockPlanSvg(app.id);
  assert.match(svg, /^<\?xml/); assert.match(svg, /width="297mm" height="210mm"/);
  assert.match(svg, /Scale 1:\d+ at A4/); assert.match(svg, /BLOCK PLAN/); assert.match(svg, /EXAMPLE ROAD/i); assert.match(svg, /DRAFT/);
  assert.match(svg, />N</); assert.match(svg, /Not a surveyed plan/);
  const w = Number(/<svg x="[\d.]+" y="10" width="([\d.]+)"/.exec(svg)[1]), n = Number(/1:(\d+) at A4/.exec(svg)[1]);
  const groundW = app.map.view.w * (app.map.scale.metres / app.map.scale.px);
  assert.ok(Math.abs(w - (groundW / n) * 1000) < 0.2, `drawing is ${w} mm for ${groundW.toFixed(1)} m at 1:${n}`);   // a true scale
  assert.ok(/stroke="#d40000"/.test(svg) || !app.map.layers.some((l) => l.kind === 'plot'), 'the red site line is drawn when there is a plot');
  assert.ok(svg.includes(' m</text>'), 'dimensions are written on the plan');
});

test('flow: the LDC statement has every section, the provision table, the plan, and the applicant\'s to-do markers', async () => {
  const svc = mkSvc();
  let app = await svc.create({ id: '1234567888' });
  await assert.rejects(() => svc.ldcPack(app.id), /Choose the work first/);
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  const html = await svc.ldcPack(app.id);
  for (const h of ['1. The application', '2. The proposed development', '3. The site and the house', '4. How each permitted-development provision is met', '5. Constraints, history and other approvals', '6. Block plan', '7. What the council will normally want', '8. Declaration']) assert.ok(html.includes(h), h);
  assert.match(html, /Part 1, GPDO 2015 \(England\), Class A/); assert.match(html, /A\.1\(f\)–\(g\), A\.4/); assert.match(html, /<svg[^>]*width="297mm"/);
  assert.match(html, /Not tested here – applicant to confirm/); assert.match(html, /Condition to comply with/);
  assert.match(html, /Read this first/); assert.match(html, /not legal or planning advice/); assert.match(html, /not produced by this tool/);
  assert.match(html, /Article 4 direction/);                                    // the mock site is in an Article 4 area: its details are in the statement
  assert.ok(!/undefined|\[object Object\]/.test(html));
});

test('the statement escapes anything that came from outside (addresses, descriptions)', () => {
  const app = {
    address: { fullAddress: '1 <script>alert(1)</script> Road & Co', uprn: '1' }, authority: { name: 'X<b>' },
    assessment: { verdict: 'permitted_development', summary: 'ok', checks: [{ id: 'x', status: 'warn', message: 'a <img src=x onerror=alert(1)> b' }], project: { developmentType: 'Householder extension', gpdo: { schedule: 'Schedule', class: 'A', title: 't' }, conditions: [] },
      gpdo: { provisions: [{ ref: 'A.1', text: 't <i>', status: 'pass', evidence: [{ message: 'e <u>' }] }] }, proposal: { type: 'rear_extension', widthM: 3, depthM: 3, heightM: 3, storeys: 1 } },
    areas: { rows: [{ label: 'Plot', value: '1 m²', how: '<b>' }] }, map: null, history: { here: [{ description: '<script>', outcome: 'approved', decidedOn: '2020-01-01' }] },
  };
  const html = buildLdcPackHtml(app);
  assert.ok(!/<script>|<img |<u>|<i>|<b>/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'no raw tags from the data');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Road &amp; Co/); assert.match(html, /No map is available/);
  assert.throws(() => buildBlockPlanSvg({ map: null }), /No map/);
});
