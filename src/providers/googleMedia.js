import crypto from 'node:crypto';
import { fetchJson, fetchBuffer } from '../utils/http.js';

const SV = 'https://maps.googleapis.com/maps/api/streetview';
const SM = 'https://maps.googleapis.com/maps/api/staticmap';

/** Optional: Google Street View Static API + Maps Static API. Keys stay server-side. */
export function createGoogleMedia({ apiKey, signingSecret }) {
  function sign(urlString) {
    if (!signingSecret) return urlString;
    const u = new URL(urlString);
    const key = Buffer.from(signingSecret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const sig = crypto.createHmac('sha1', key).update(u.pathname + u.search).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return `${urlString}&signature=${sig}`;
  }
  const build = (base, params) => sign(`${base}?${new URLSearchParams({ ...params, key: apiKey })}`);

  return {
    name: 'google-maps',
    attribution: '© Google',

    async streetViewMetadata({ lat, lng }) {
      const data = await fetchJson(build(`${SV}/metadata`, { location: `${lat},${lng}`, radius: '50', source: 'outdoor' }));
      if (!data || data.status !== 'OK') return { available: false, status: data?.status ?? 'UNKNOWN' };
      return { available: true, panoId: data.pano_id, date: data.date ?? null, location: data.location };
    },

    renderStreetView({ panoId, heading, w, h }) {
      return fetchBuffer(build(SV, { size: `${w}x${h}`, pano: panoId, heading: String(Math.round(heading ?? 0)), pitch: '5', fov: '80' }));
    },

    /** Satellite image for the view. The proposal outline is drawn as an SVG overlay, not baked in. */
    renderAerial({ view }) {
      return fetchBuffer(build(SM, {
        center: `${view.lat},${view.lng}`, zoom: String(view.zoom), size: `${view.w}x${view.h}`,
        scale: '2', maptype: 'satellite', format: 'jpg',
      }));
    },
  };
}
