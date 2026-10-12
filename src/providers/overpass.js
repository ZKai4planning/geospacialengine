import { fetchJson } from '../utils/http.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { upstream } from '../utils/errors.js';

/**
 * Runs an Overpass QL query against several public mirrors ("hedged" requests):
 *  - a mirror that fails (406/429/504/timeout) is replaced by the next one immediately;
 *  - a mirror that is merely slow gets a second mirror started after `hedgeMs`;
 *  - the first successful answer wins and the remaining requests are cancelled.
 * Always sends a descriptive User-Agent (HTTP_USER_AGENT) – anonymous clients are rejected with 406.
 */
export function overpass(query, { timeoutMs = config.overpassTimeoutMs, hedgeMs = 4000 } = {}) {
  const urls = config.overpassUrls;
  return new Promise((resolve, reject) => {
    const ctls = [];
    let started = 0, pending = 0, done = false, lastErr, timer;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctls.forEach((c) => c.abort());
      fn(value);
    };

    const startNext = () => {
      if (done) return;
      clearTimeout(timer);
      if (started >= urls.length) {
        if (pending === 0) finish(reject, lastErr ?? upstream('Overpass is unavailable'));
        return;
      }
      const url = urls[started++];
      const ctl = new AbortController();
      ctls.push(ctl);
      pending++;
      timer = setTimeout(startNext, hedgeMs); // slow? also try the next mirror
      fetchJson(url, {
        method: 'POST', body: new URLSearchParams({ data: query }),
        headers: { accept: '*/*' }, timeoutMs, retries: 0, signal: ctl.signal,
      })
        .then((data) => { if (!data) throw new Error('empty response'); finish(resolve, data); })
        .catch((e) => {
          if (done) return;
          lastErr = e;
          logger.warn({ url, err: e.message }, 'overpass mirror failed');
          pending--;
          startNext();
        });
    };
    startNext();
  });
}
