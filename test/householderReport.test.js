import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportModel, renderReportHtml, planSvgFor, STATES } from '../src/services/householderReport.js';

process.env.MOCK_PROVIDERS = 'true';
const { createContainer } = await import('../src/container.js');
const { createMockProviders } = await import('../src/providers/mock.js');
const b = createMockProviders();
const mk = () => createContainer({ providers: { ...b, streetView: { name: 'x' }, aerial: { name: 'x' }, uprn: null }, db: null });

test('report: every one of the 228 checks lands in exactly one status bucket, and the headline follows the readiness gate', async () => {
  const { applicationService: svc, registerService: reg } = mk();
  let app = await svc.create({ id: '1234567890' });
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  const { model, planSvg } = await reg.report(app.id);
  assert.equal(model.position.total, 228);
  assert.equal(STATES.reduce((n, [k]) => n + model.position.counts[k], 0), 228);
  assert.equal(model.domains.length, 17);
  assert.equal(model.domains.reduce((n, d) => n + d.total, 0), 228);
  assert.equal(model.position.headline, model.position.state === 'ready' ? 'READY FOR REVIEW' : 'VERIFICATION REQUIRED');
  assert.ok(model.priority.length <= 8 && model.actions.length <= 8);
  assert.ok(model.priority.every((x) => x.next && x.finding), 'each finding says what the engine found and what to do next');
  assert.ok(planSvg.startsWith('<svg'), 'the block plan is embedded without its XML prolog');
});

test('report: the HTML has all nine pages, escapes text, never calls a pass an approval, and works with no proposal', async () => {
  const { applicationService: svc, registerService: reg } = mk();
  const app = await svc.create({ id: '1234567886' });            // no proposal yet
  const { model, planSvg } = await reg.report(app.id);
  assert.equal(model.route, null);
  model.property.address = '<script>alert(1)</script> 1 Test Road';
  const html = renderReportHtml(model, { planSvg });
  assert.equal((html.match(/class="pg/g) ?? []).length, 9);
  assert.ok(!html.includes('<script>alert(1)'), 'address is escaped');
  for (const s of ['Your property.', 'Your three biggest questions', 'The alerts that deserve your attention.', 'never means the work has been authorised', 'HOUSEHOLDER REPORT 9 / 9']) assert.ok(html.includes(s), s);
  assert.match(html, /No work has been chosen yet/);
});

test('report: with a proposal the route page lists the PD provisions and the plan is drawn', async () => {
  const { applicationService: svc, registerService: reg } = mk();
  let app = await svc.create({ id: '1234567892' });
  app = await svc.setProposal(app.id, { type: 'rear_extension', depthM: 3, heightM: 3 });
  const { model, planSvg } = await reg.report(app.id);
  assert.ok(model.route?.provisions.length > 0);
  const html = renderReportHtml(model, { planSvg });
  assert.match(html, /Can I build without permission\?/); assert.match(html, /<svg/);
  assert.ok(planSvgFor(await svc.load(app.id)).includes('BLOCK PLAN'));
});

test('title: the number is normalised, validated and recorded against the UPRN; tenure falls back to the Price Paid sale and says so', async () => {
  const { applicationService: svc, registerService: reg } = mk();
  let app = await svc.create({ id: '1234567886' });
  const before = (await reg.report(app.id)).model.property;
  assert.equal(before.titleNumber, null);
  assert.match(before.tenureSource ?? 'none', /Price Paid|none/);                       // never "entered by applicant" before anyone entered it
  await assert.rejects(() => svc.setTitle(app.id, { titleNumber: 'hello world' }), /does not look like a title number/);
  app = await svc.setTitle(app.id, { titleNumber: ' tgl 123456 ', tenure: 'leasehold', leaseYearsRemaining: 82 });
  assert.equal(app.title.titleNumber, 'TGL123456'); assert.equal(app.title.uprn, app.address.uprn);
  const doc = (await reg.live(app.id)).checks;
  assert.match(doc.find((c) => c.id === 'PI-01-05').live.value, /TGL123456.*UPRN/);
  assert.match(doc.find((c) => c.id === 'PI-02-02').live.value, /Leasehold, about 82 years.*entered by applicant/);
  const { model, planSvg } = await reg.report(app.id);
  const html = renderReportHtml(model, { planSvg });
  assert.match(html, /Title TGL123456/); assert.match(html, /Leasehold/); assert.match(html, /print-color-adjust:exact/);
  app = await svc.setTitle(app.id, { tenure: 'freehold' });
  assert.equal(app.title.leaseYearsRemaining, undefined, 'lease years are dropped when it is not leasehold');
});

test('title: it survives the JSON export / import round trip', async () => {
  const svc = mk().applicationService;
  const app = await svc.create({ id: '1234567886' });
  await svc.setTitle(app.id, { titleNumber: 'EGL500', tenure: 'freehold' });
  const doc = await svc.exportJson(app.id);
  assert.deepEqual(doc.inputs.title, { titleNumber: 'EGL500', tenure: 'freehold', leaseYearsRemaining: null });
  const again = await svc.importJson(JSON.parse(JSON.stringify(doc)));
  assert.equal(again.title.titleNumber, 'EGL500');
});
