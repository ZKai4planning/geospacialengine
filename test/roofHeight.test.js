import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseRoof, gridFor } from '../src/services/roofHeight.js';
import { osgb36ToBng, wgs84ToBng } from '../src/utils/bngForward.js';
import { createLidarHeights, flipRows, exportUrl } from '../src/providers/lidarHeights.js';

const X = 530000, Y = 180000;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

/** Synthetic surroundings: ground falling 0.4 m west->east, a gabled house (eaves 4.8, ridge 7.4, ridge runs east-west) and a neighbour 3 m away. */
function world({ house, neighbour = null, flat = false, none = false }) {
  const footprint = house;
  const grid = gridFor(rect(X - 2, Y - 2, X + 10, Y + 8));
  const dsm = new Float64Array(grid.cells), dtm = new Float64Array(grid.cells);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const x = grid.x0 + i + 0.5, y = grid.y0 + j + 0.5, ground = 20 + 0.02 * (x - X);
    let h = 0.3;                                                              // shrubs and fences
    for (const b of [house, neighbour].filter(Boolean)) {
      const [bx0, by0] = b[0], [bx1, by1] = b[2];
      if (!none && x > bx0 && x < bx1 && y > by0 && y < by1) {
        const mid = (by0 + by1) / 2, half = (by1 - by0) / 2;
        h = flat ? 5.5 : 4.8 + 2.6 * (1 - Math.abs(y - mid) / half);
      }
    }
    dtm[j * grid.nx + i] = ground; dsm[j * grid.nx + i] = ground + h;
  }
  return { grid, dsm, dtm, footprint };
}

test('National Grid conversion reproduces the OS worked example to the millimetre, and WGS84 lands near a known spot', () => {
  const o = osgb36ToBng(52.657570301933, 1.717921580645);
  assert.ok(Math.abs(o.e - 651409.903) < 0.005 && Math.abs(o.n - 313177.27) < 0.005);
  const t = wgs84ToBng(51.50808, -0.12803);                                    // Nelson's Column, about TQ 2980 8040
  assert.ok(Math.hypot(t.e - 529800, t.n - 180400) < 40);
});

test('roof height: eaves and ridge are read from the surface and ground models', () => {
  const house = rect(X, Y, X + 8, Y + 6);
  const { grid, dsm, dtm, footprint } = world({ house, neighbour: rect(X, Y + 9, X + 8, Y + 15) });
  const r = analyseRoof({ footprint, grid, dsm, dtm });
  assert.equal(r.status, 'ok'); assert.equal(r.roofShape, 'pitched'); assert.equal(r.confidence, 'high');
  assert.ok(r.ridgeM >= 7.0 && r.ridgeM <= 7.5, `ridge ${r.ridgeM}`);
  assert.ok(r.eavesM >= 4.8 && r.eavesM <= 5.6, `eaves ${r.eavesM}`);          // reads a little high: the cells are inside the wall, on the slope
  assert.ok(r.groundFallM > 0.05 && r.groundFallM < 0.3);
});

test('alignment: an outline that is 3 m east and 2 m south of the real house is slid back onto it', () => {
  const real = rect(X, Y, X + 8, Y + 6), off = rect(X + 3, Y - 2, X + 11, Y + 4);
  const { grid, dsm, dtm } = world({ house: real });
  const r = analyseRoof({ footprint: off, grid, dsm, dtm });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.shift, { x: -3, y: 2 });
  assert.ok(r.ridgeM >= 7.0 && r.ridgeM <= 7.5);
});

test('a flat roof has eaves = roof height', () => {
  const house = rect(X, Y, X + 8, Y + 6), w = world({ house, flat: true });
  const r = analyseRoof({ footprint: w.footprint, grid: w.grid, dsm: w.dsm, dtm: w.dtm });
  assert.equal(r.roofShape, 'flat'); assert.equal(r.eavesM, r.ridgeM); assert.ok(Math.abs(r.ridgeM - 5.5) < 0.2);
});

test('no building in the LiDAR: says so and gives no heights', () => {
  const house = rect(X, Y, X + 8, Y + 6), w = world({ house, none: true });
  const r = analyseRoof({ footprint: w.footprint, grid: w.grid, dsm: w.dsm, dtm: w.dtm });
  assert.equal(r.status, 'unclear'); assert.equal(r.eavesM, undefined);
});

test('missing data (NaN everywhere) is unavailable, never a number', () => {
  const house = rect(X, Y, X + 8, Y + 6), w = world({ house });
  const r = analyseRoof({ footprint: w.footprint, grid: w.grid, dsm: new Float64Array(w.grid.cells).fill(NaN), dtm: w.dtm });
  assert.equal(r.status, 'unavailable');
});

test('provider: builds one export per layer on the same grid, flips rows, and degrades quietly when the service errors', async () => {
  // a real-looking outline near Nelson's Column; the fake service returns a flat 3 m building everywhere (top row first, like a real raster)
  const lat = 51.50808, lng = -0.12803, d = 0.00004;
  const ring = [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
  const calls = [];
  const decode = async (buf) => { const { nx, ny, layer } = JSON.parse(Buffer.from(buf).toString()); return { width: nx, height: ny, values: new Float64Array(nx * ny).fill(layer === 'dsm' ? 23 : 20) }; };
  const fetchImpl = async (url) => {
    calls.push(url); const u = new URL(url), [sx, sy] = u.searchParams.getAll('subset').map((t) => t.match(/\((\d+),(\d+)\)/).slice(1).map(Number)), nx = sx[1] - sx[0], ny = sy[1] - sy[0], layer = /DSM/.test(url) ? 'dsm' : 'dtm';
    return { ok: true, status: 200, headers: { get: () => 'image/tiff' }, arrayBuffer: async () => Buffer.from(JSON.stringify({ nx, ny, layer })) };
  };
  const p = createLidarHeights({ fetchImpl, decode });
  const r = await p.measure({ ring });
  assert.equal(calls.length, 2); assert.ok(calls.some((c) => /DSM/.test(c)) && calls.some((c) => /DTM/.test(c)));
  assert.deepEqual(new URL(calls[0]).searchParams.getAll('subset'), new URL(calls[1]).searchParams.getAll('subset'));
  assert.equal(new URL(calls[0]).searchParams.get('request'), 'GetCoverage');
  assert.ok(['unclear', 'ok', 'unavailable'].includes(r.status));               // uniform 3 m everywhere = no contrast between building and surroundings
  assert.equal(r.status, 'unclear');

  const bad = createLidarHeights({ fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => '' } }), decode });
  const rb = await bad.measure({ ring });
  assert.equal(rb.status, 'unavailable'); assert.match(rb.reason, /could not be read/);

  assert.deepEqual([...flipRows({ width: 2, height: 2, values: Float64Array.from([1, 2, 3, 4]) })], [3, 4, 1, 2]);
  const u = decodeURIComponent(exportUrl({ url: 'https://x/wcs', coverage: 'cov' }, { x0: 1, y0: 2, nx: 3, ny: 4 }));
  assert.match(u, /^https:\/\/x\/wcs\?service=WCS&version=2\.0\.1&request=GetCoverage&coverageId=cov&format=image\/tiff/);
  assert.match(u, /subset=E\(1,4\)&subset=N\(2,6\)/);
});
