import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.MOCK_PROVIDERS = 'true';
const { createApp } = await import('../src/app.js');

test('the register screen is served and its script never writes API data as HTML', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/register.html', /html/], ['/register.js', /javascript/], ['/register.css', /css/]]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type') ?? '', type, path);
  }
  const js = fs.readFileSync(new URL('../public/register.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), 'register.js must build the page with textContent only');
  assert.ok(!/localStorage|sessionStorage/.test(js), 'the reviewer token must not be stored in the browser');
  assert.match(fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /register\.html\?app=/);
});
