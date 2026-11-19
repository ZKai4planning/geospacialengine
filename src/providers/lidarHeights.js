import { wgs84ToBng } from '../utils/bngForward.js';
import { gridFor, analyseRoof, ROOF } from '../services/roofHeight.js';
import { logger } from '../utils/logger.js';

/**
 * Roof / eaves height from Environment Agency LiDAR composites (1 m, England), read through the EA's WCS 2.0.1 services (Defra Data Services Platform).
 * One `GetCoverage` request per layer returns a small GeoTIFF of height values for the building's surroundings; nothing is stored.
 * (The older ArcGIS "image/rest/services/SURVEY/..." ImageServer URLs do not exist - they answer 400 "Invalid URL".)
 *
 *   DTM (bare ground)        : dataset 13787b9a-...  coverage  Lidar_Composite_Elevation_DTM_1m
 *   DSM (surface, last return): dataset 9ba4d5ac-...  coverage  Lidar_Composite_Elevation_LZ_DSM_1m      (both read from the services' GetCapabilities)
 *
 * Needs the `geotiff` package (`npm i geotiff`); without it the provider says so instead of crashing. Coverage: England only (~99%).
 */
const WCS = 'https://environment.data.gov.uk/geoservices/datasets';
export const LIDAR_DEFAULTS = {
  dtmUrl: `${WCS}/13787b9a-26a4-4775-8523-806d13af58fc/wcs`,
  dtmCoverage: '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
  dsmUrl: `${WCS}/9ba4d5ac-d596-445a-9056-dae3ddec0178/wcs`,
  dsmCoverage: '9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m',
  axes: ['E', 'N'],      // WCS axis labels for EPSG:27700; `npm run check:lidar` prints the real ones from DescribeCoverage
};
const NODATA_LIMIT = 1000;      // heights outside +-1000 m are no-data markers (-9999, 3.4e38 ...)

/** Reads a GeoTIFF (ArrayBuffer) into { width, height, values } with no-data as NaN. Replaceable for tests. */
export async function decodeTiff(buffer) {
  let GeoTIFF;
  try { GeoTIFF = await import('geotiff'); } catch { throw Object.assign(new Error('The "geotiff" package is not installed (run: npm i geotiff).'), { code: 'NO_GEOTIFF' }); }
  const tiff = await GeoTIFF.fromArrayBuffer(buffer), image = await tiff.getImage();
  const raster = (await image.readRasters({ interleave: true }));
  const noData = image.getGDALNoData?.();
  const values = Float64Array.from(raster, (v) => (Number.isFinite(v) && Math.abs(v) < NODATA_LIMIT && v !== noData ? v : NaN));
  return { width: image.getWidth(), height: image.getHeight(), values };
}

/** WCS 2.0.1 GetCoverage (KVP) for a grid in National Grid metres; `layer` = { url, coverage, axes }. */
export function exportUrl(layer, grid) {
  const [ax, ay] = layer.axes ?? LIDAR_DEFAULTS.axes;
  const q = new URLSearchParams({ service: 'WCS', version: '2.0.1', request: 'GetCoverage', coverageId: layer.coverage, format: layer.format ?? 'image/tiff' });
  q.append('subset', `${ax}(${grid.x0},${grid.x0 + grid.nx})`);
  q.append('subset', `${ay}(${grid.y0},${grid.y0 + grid.ny})`);
  if (layer.scaleFactor) q.append('scaleFactor', String(layer.scaleFactor));
  if (layer.subsettingCrs !== false) q.append('subsettingCrs', 'http://www.opengis.net/def/crs/EPSG/0/27700');
  return `${layer.url}?${q}`;
}

/** The server draws the top row first; our grids run south to north, so flip the rows. */
export function flipRows({ width, height, values }) {
  const out = new Float64Array(values.length);
  for (let j = 0; j < height; j++) out.set(values.subarray((height - 1 - j) * width, (height - j) * width), j * width);
  return out;
}

export function createLidarHeights({ dsmUrl = LIDAR_DEFAULTS.dsmUrl, dtmUrl = LIDAR_DEFAULTS.dtmUrl, dsmCoverage = LIDAR_DEFAULTS.dsmCoverage, dtmCoverage = LIDAR_DEFAULTS.dtmCoverage, axes = LIDAR_DEFAULTS.axes, fetchImpl = globalThis.fetch, decode = decodeTiff, userAgent = 'uk-planning-engine', timeoutMs = 20000 } = {}) {
  let warned = false;
  const warnOnce = (msg, extra) => { if (!warned) { warned = true; logger.warn(extra ?? {}, msg); } };

  async function fetchGrid(layer, grid) {
    const res = await fetchImpl(exportUrl(layer, grid), { headers: { 'User-Agent': userAgent, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`LiDAR service answered ${res.status}`), { code: 'HTTP', status: res.status });
    const type = res.headers?.get?.('content-type') ?? '';
    if (/json|html|text/i.test(type)) throw Object.assign(new Error(`LiDAR service returned an error instead of a raster (${type})`), { code: 'NOT_A_RASTER' });
    const t = await decode(await res.arrayBuffer());
    if (t.width !== grid.nx || t.height !== grid.ny) throw Object.assign(new Error(`LiDAR raster is ${t.width}x${t.height}, expected ${grid.nx}x${grid.ny}`), { code: 'SIZE' });
    return flipRows(t);
  }

  return {
    name: 'ea-lidar-1m',
    /** ring: [[lng, lat], ...] building outline. Never throws for "no data": returns { status: 'unavailable' | 'unclear' | 'ok', ... }. */
    async measure({ ring }) {
      if (!ring || ring.length < 4) return { status: 'unavailable', reason: 'No building outline to measure.' };
      const footprint = ring.map(([lng, lat]) => { const p = wgs84ToBng(lat, lng); return [p.e, p.n]; });
      const grid = gridFor(footprint);
      if (grid.cells > ROOF.maxCells) return { status: 'unavailable', reason: 'The building is too large for the automatic height check.' };
      try {
        const [dsm, dtm] = await Promise.all([fetchGrid({ url: dsmUrl, coverage: dsmCoverage, axes }, grid), fetchGrid({ url: dtmUrl, coverage: dtmCoverage, axes }, grid)]);
        return { ...analyseRoof({ footprint, grid, dsm, dtm }), source: 'Environment Agency LiDAR composite, 1 m' };
      } catch (e) {
        if (e.code === 'NO_GEOTIFF') { warnOnce(e.message); return { status: 'unavailable', reason: 'The LiDAR reader is not installed on this server.' }; }
        if (e.code === 'HTTP' || e.code === 'NOT_A_RASTER' || e.code === 'SIZE') { warnOnce('LiDAR height lookup failed - check the LIDAR_* settings with `npm run check:lidar`', { err: e.message }); return { status: 'unavailable', reason: 'The LiDAR service could not be read.' }; }
        throw e;       // timeouts and network errors: let the caller's safe() wrapper report a temporary failure
      }
    },
  };
}
