import { fetchJson, fetchBuffer } from '../utils/http.js';
import { bearing, haversine } from '../utils/geo.js';

const GRAPH = 'https://graph.mapillary.com';
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Mapillary street-level photos (crowd-sourced, CC BY-SA). Free client token from mapillary.com/developer.
 * Picks a photo taken near the house whose camera is actually pointing at it.
 * Coverage is patchier than Google – when nothing suitable exists we report `available: false`.
 */
export function createMapillary({ token }) {
  return {
    name: 'mapillary',
    attribution: 'Street imagery © Mapillary contributors (CC BY-SA)',

    async streetViewMetadata({ lat, lng }) {
      const d = 0.0004;
      const u = new URL(`${GRAPH}/images`);
      u.searchParams.set('access_token', token);
      u.searchParams.set('fields', 'id,captured_at,compass_angle,computed_compass_angle,geometry,is_pano');
      u.searchParams.set('bbox', [lng - d, lat - d, lng + d, lat + d].join(','));
      u.searchParams.set('limit', '100');
      const data = await fetchJson(u.toString());
      const target = { lat, lng };
      const scored = (data?.data ?? [])
        .filter((i) => !i.is_pano && i.geometry?.coordinates)
        .map((i) => {
          const cam = { lat: i.geometry.coordinates[1], lng: i.geometry.coordinates[0] };
          const dist = haversine(cam, target);
          const facing = angDiff(i.computed_compass_angle ?? i.compass_angle ?? 0, bearing(cam, target));
          return { i, cam, dist, score: facing + Math.abs(dist - 15) * 1.2 - (i.captured_at ?? 0) / 1e14, facing };
        })
        .filter((s) => s.facing <= 50 && s.dist >= 4 && s.dist <= 45)
        .sort((a, b) => a.score - b.score);
      const best = scored[0];
      if (!best) return { available: false, status: 'ZERO_RESULTS' };
      return {
        available: true, panoId: best.i.id, location: best.cam,
        date: best.i.captured_at ? new Date(best.i.captured_at).toISOString().slice(0, 10) : null,
      };
    },

    async renderStreetView({ panoId }) {
      // image URLs are short-lived signed CDN links, so resolve a fresh one each time
      const meta = await fetchJson(`${GRAPH}/${encodeURIComponent(panoId)}?access_token=${encodeURIComponent(token)}&fields=thumb_1024_url`);
      if (!meta?.thumb_1024_url) throw new Error('Mapillary image not found');
      return fetchBuffer(meta.thumb_1024_url);
    },
  };
}
