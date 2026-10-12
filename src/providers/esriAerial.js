import { fetchBuffer } from '../utils/http.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { fetchTiles, mosaicSvg } from '../utils/tileMosaic.js';

const BASE = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer';
const MAX_TILE_ZOOM = 19;
const BLANK_TILE_BYTES = 3000; // Esri answers "map data not yet available" with a tiny tile

/**
 * Esri World Imagery – works without an API key, so it is the default aerial source.
 * Check Esri's terms before commercial production use; attribution is required.
 *
 * Two ways to get the picture, tried in order:
 *  1. one on-demand "export" request (sharp, but rendered live so it can be slow or time out on poor networks);
 *  2. the pre-rendered 256px map tiles, fetched in parallel and stitched into one SVG with the tiles embedded
 *     (small, cached, and far more reliable). The overlay still lines up because both use the same view.
 */
export function createEsriAerial() {
  async function viaExport(view) {
    const u = new URL(`${BASE}/export`);
    u.searchParams.set('bbox', view.bboxMerc.join(','));
    u.searchParams.set('bboxSR', '3857');
    u.searchParams.set('imageSR', '3857');
    u.searchParams.set('size', `${view.w * 2},${view.h * 2}`);
    u.searchParams.set('format', 'jpg');
    u.searchParams.set('f', 'image');
    const img = await fetchBuffer(u.toString(), { timeoutMs: Math.min(config.imageryTimeoutMs, 15000), retries: 0 });
    if (!img.contentType.startsWith('image/') || img.buffer.length < 1500) throw new Error(`export returned an unusable image (${img.buffer.length} bytes)`);
    return img;
  }

  const tileUrl = ({ z, x, y }) => `${BASE}/tile/${z}/${y}/${x}`;
  async function viaTiles(view) {
    let z = Math.min(Math.round(view.zoom), MAX_TILE_ZOOM);
    const opts = { timeoutMs: config.imageryTimeoutMs, retries: 1 };
    let res = await fetchTiles(view, z, tileUrl, opts);
    // no real imagery at this zoom (all tiles are the tiny "not available" image)? step back one level
    if (res.got.every((t) => t.buffer.length < BLANK_TILE_BYTES) && z > 17) res = await fetchTiles(view, --z, tileUrl, opts);
    return mosaicSvg(view, res);
  }

  return {
    name: 'esri-world-imagery',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    async renderAerial({ view }) {
      try {
        return await viaExport(view);
      } catch (e) {
        logger.warn({ err: e.message }, 'Esri export failed – falling back to map tiles');
        return viaTiles(view);
      }
    },
  };
}
