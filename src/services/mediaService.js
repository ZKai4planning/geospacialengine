import { bearing } from '../utils/geo.js';
import { makeView } from '../utils/mercator.js';
import { createPlaceholderMedia } from '../providers/placeholderMedia.js';
import { logger } from '../utils/logger.js';

const clamp = (n, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : d));

/**
 * osmMap: fallback map renderer (see providers/osmMap.js). Pass null to disable (mock mode / tests) – the plain
 * placeholder pictures are used instead.
 */
export function createMediaService({ providers, osmMap = null }) {
  const street = providers.streetView;
  const aerial = providers.aerial;
  const placeholder = createPlaceholderMedia();

  return {
    /** Street-level coverage near the property + the camera position (used to work out which side is the front). */
    async prepare(address) {
      const sv = await street.streetViewMetadata({ lat: address.lat, lng: address.lng });
      const fallbackNote = osmMap?.attribution ? ` · fallback map ${osmMap.attribution}` : '';
      return {
        streetView: sv.available
          ? {
              available: true, panoId: sv.panoId, capturedAt: sv.date, camera: sv.location,
              heading: Math.round(bearing(sv.location, address)), attribution: street.attribution ?? null, provider: street.name,
            }
          : { available: false, status: sv.status, provider: street.name },
        aerial: { available: true, attribution: `${aerial.attribution ?? ''}${aerial.attribution ? fallbackNote : fallbackNote.replace(/^ · /, '')}` || null, provider: aerial.name },
      };
    },

    size(q) { return { w: clamp(Number(q.w), 200, 640, 640), h: clamp(Number(q.h), 150, 640, 400) }; },

    /** Street photo; when there is none (no coverage, provider not set up, or the photo fails to load) show a map with a pin. */
    async streetViewImage(app, { w, h }) {
      const sv = app.media.streetView;
      const label = app.address.fullAddress;
      const mapInstead = async (caption, note) => {
        if (osmMap) {
          try {
            return await osmMap.render({ view: makeView({ lat: app.address.lat, lng: app.address.lng, zoom: 19, w, h }), pin: true, caption });
          } catch (e) { logger.warn({ err: e.message }, 'fallback map failed to load'); }
        }
        return placeholder.renderStreetView({ w, h, label, note });
      };
      if (street.name === 'placeholder') return mapInstead('Street photos not set up – map shown instead', undefined);
      if (!sv?.available) return mapInstead('No street photo for this address – map shown instead', 'No street-level photo found for this address');
      try {
        return await street.renderStreetView({ panoId: sv.panoId, heading: sv.heading, w, h, label });
      } catch (e) {
        logger.warn({ err: e.message, provider: street.name }, 'street photo failed to load');
        return mapInstead('Street photo could not be loaded – map shown instead', 'The photo could not be loaded – try again shortly');
      }
    },

    /** Same view the overlay was projected into, so photo and outlines line up exactly. */
    async aerialImage(app) {
      const v = app.map?.view ?? { lat: app.address.lat, lng: app.address.lng, zoom: 20, w: 640, h: 400 };
      const view = makeView(v);
      try {
        return await aerial.renderAerial({ view });
      } catch (e) {
        logger.warn({ err: e.message, provider: aerial.name }, 'aerial photo failed to load');
      }
      if (osmMap) {
        try { return await osmMap.render({ view, caption: 'Aerial photo unavailable – map shown instead' }); }
        catch (e) { logger.warn({ err: e.message }, 'fallback map failed to load'); }
      }
      return placeholder.renderAerial({ view, note: 'Could not reach the imagery service – the outlines below are still correct' });
    },
  };
}
