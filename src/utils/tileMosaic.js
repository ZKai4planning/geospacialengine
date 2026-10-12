import { fetchBuffer } from './http.js';

const HALF_WORLD = 20037508.342789244; // metres, Web-Mercator half-circumference

/** Fetch every 256px tile (in parallel) needed to cover `view` at zoom z. `urlFor({z,x,y})` builds each tile URL. */
export async function fetchTiles(view, z, urlFor, { timeoutMs, retries = 1 } = {}) {
  const size = (2 * HALF_WORLD) / 2 ** z; // tile edge in metres
  const [minX, minY, maxX, maxY] = view.bboxMerc;
  const x0 = Math.floor((minX + HALF_WORLD) / size), x1 = Math.floor((maxX + HALF_WORLD) / size);
  const y0 = Math.floor((HALF_WORLD - maxY) / size), y1 = Math.floor((HALF_WORLD - minY) / size);
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push({ x, y });
  if (jobs.length > 36) throw new Error('too many tiles for this view');
  const got = await Promise.all(jobs.map(async ({ x, y }) => ({ x, y, ...(await fetchBuffer(urlFor({ z, x, y }), { timeoutMs, retries })) })));
  return { size, got };
}

/**
 * Stitch fetched tiles into one SVG image (tiles embedded as data URIs, so it works inside an <img>).
 * The SVG's coordinate system is the view's pixel space (w x h), drawn at 2x for sharpness, so anything in `overlay`
 * can be positioned with the same pixel coordinates the app's own map overlay uses.
 */
export function mosaicSvg(view, { size, got }, overlay = '') {
  const px = (m) => m / view.res; // metres -> view pixels
  const images = got.map((t) => {
    const left = px(t.x * size - HALF_WORLD - view.bboxMerc[0]);
    const top = view.h - px(HALF_WORLD - t.y * size - view.bboxMerc[1]); // tile's top edge in view pixels
    const w = px(size);
    return `<image x="${(left - 0.4).toFixed(2)}" y="${(top - 0.4).toFixed(2)}" width="${(w + 0.8).toFixed(2)}" height="${(w + 0.8).toFixed(2)}" preserveAspectRatio="none" href="data:${t.contentType};base64,${t.buffer.toString('base64')}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${view.w * 2}" height="${view.h * 2}" viewBox="0 0 ${view.w} ${view.h}"><rect width="100%" height="100%" fill="#dfe6f5"/>${images.join('')}${overlay}</svg>`;
  return { buffer: Buffer.from(svg), contentType: 'image/svg+xml' };
}
