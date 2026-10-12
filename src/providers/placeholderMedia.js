import { svgImage } from '../utils/svg.js';

/** Used in mock mode / when no imagery provider is configured, so the whole flow still works. */
export function createPlaceholderMedia() {
  return {
    name: 'placeholder',
    attribution: null,
    async streetViewMetadata({ lat, lng }) {
      return { available: true, panoId: 'placeholder', date: null, location: { lat: lat - 0.0001, lng } };
    },
    async renderStreetView({ w, h, label = '', note }) {
      return svgImage({ w, h, title: note ? 'Street photo unavailable' : 'Street view placeholder', subtitle: note ?? (label || 'Set MAPILLARY_TOKEN in .env for street photos') });
    },
    async renderAerial({ view, note }) {
      return svgImage({ w: view.w * 2, h: view.h * 2, title: note ? 'Aerial photo unavailable' : 'Aerial placeholder', subtitle: note ?? 'Configure an aerial provider (Esri needs no key)' });
    },
  };
}
