import { config } from '../config.js';
import { esc } from '../utils/svg.js';
import { fetchTiles, mosaicSvg } from '../utils/tileMosaic.js';

/**
 * Plain OpenStreetMap-style map picture, used as a fallback when an aerial or street photo is not available.
 * Tiles come from MAP_TILE_URL (default: OSM's own server – fine for development, use a paid/own tile server in production).
 * The attribution is drawn into the picture itself, so it is correct wherever the image ends up.
 */
export function createOsmMap({ tileUrl = config.mapTileUrl, attribution = config.mapTileAttribution, maxZoom = config.mapTileMaxZoom } = {}) {
  const urlFor = ({ z, x, y }) => tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  return {
    name: 'openstreetmap',
    attribution,
    /** view = makeView(...). pin: marker at the view centre. caption: short note drawn along the bottom edge. */
    async render({ view, pin = false, caption = null }) {
      const z = Math.min(Math.round(view.zoom), maxZoom);
      const tiles = await fetchTiles(view, z, urlFor, { timeoutMs: config.imageryTimeoutMs, retries: 1 });
      const { w, h } = view;
      const bar = `<rect x="0" y="${h - 22}" width="${w}" height="22" fill="#fff" fill-opacity=".88"/>`
        + (caption ? `<text x="8" y="${h - 7}" font-family="system-ui,sans-serif" font-size="12" fill="#1f2a6b">${esc(caption)}</text>` : '')
        + `<text x="${w - 6}" y="${h - 7}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#333">${esc(attribution)}</text>`;
      const marker = pin
        ? `<g transform="translate(${w / 2} ${h / 2})"><path d="M0 0 L-9 -18 A10 10 0 1 1 9 -18 Z" fill="#d93025" stroke="#fff" stroke-width="2"/><circle cx="0" cy="-22" r="3.5" fill="#fff"/></g>`
        : '';
      return mosaicSvg(view, tiles, marker + bar);
    },
  };
}
