import { upstream } from './errors.js';
import { config } from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Never leak API keys / signatures into logs or error payloads
export const redact = (u) => String(u).replace(/([?&](?:key|signature)=)[^&]+/gi, '$1***');

async function request(url, { method = 'GET', body, headers = {}, timeoutMs = 8000, retries = 1, signal } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, body, headers: { 'user-agent': config.userAgent, ...headers }, signal: ctl.signal });
      if (res.status < 500) return res; // don't retry 4xx
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(250 * (attempt + 1));
  }
  throw upstream(`Upstream request failed: ${lastErr?.message}`, { url: redact(url) });
}

/** JSON GET/POST. Returns null on 404. */
export async function fetchJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  if (res.status === 404) return null;
  if (!res.ok) throw upstream(`Upstream returned ${res.status}`, { url: redact(url) });
  return res.json();
}

/** Binary GET (images). */
export async function fetchBuffer(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) throw upstream(`Image upstream returned ${res.status}`, { url: redact(url) });
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  };
}
