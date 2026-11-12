// Diagnoses the Environment Agency LiDAR WCS 2.0.1 services (DTM + DSM).
//   npm run check:lidar                       -> GetCapabilities + DescribeCoverage for both layers (coverage ids, axis labels)
//   npm run check:lidar -- 530000 180400      -> also requests a 10 m GeoTIFF at that National Grid point from each layer
import { decodeTiff, exportUrl, LIDAR_DEFAULTS as D } from '../src/providers/lidarHeights.js';

const UA = process.env.HTTP_USER_AGENT ?? 'Mozilla/5.0 (compatible; uk-planning-engine-check)';
const get = (u) => fetch(u, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
const brief = (t) => t.replace(/\s+/g, ' ').slice(0, 260);
const axesEnv = process.env.LIDAR_AXES ? process.env.LIDAR_AXES.split(',').map((x) => x.trim()) : null;
const layers = [
  { label: 'DTM', url: process.env.LIDAR_DTM_URL || D.dtmUrl, coverage: process.env.LIDAR_DTM_COVERAGE || D.dtmCoverage },
  { label: 'DSM', url: process.env.LIDAR_DSM_URL || D.dsmUrl, coverage: process.env.LIDAR_DSM_COVERAGE || D.dsmCoverage },
];

const usable = [];
for (const L of layers) {
  console.log(`\n${L.label}  ${L.url}\n     coverage ${L.coverage}`);
  try {
    const caps = await (await get(`${L.url}?service=WCS&version=2.0.1&request=GetCapabilities`)).text();
    const ids = [...caps.matchAll(/<wcs:CoverageId>([^<]+)</g)].map((m) => m[1]);
    console.log(ids.includes(L.coverage) ? ' OK  coverage listed in GetCapabilities' : ` x   coverage NOT listed. Available: ${ids.join(', ') || brief(caps)}`);
    const desc = await (await get(`${L.url}?service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=${encodeURIComponent(L.coverage)}`)).text();
    // the Envelope's axisLabels are the map axes (E N, x y, Lat Long ...); the <gml:axisLabels> element inside the grid is the pixel axes (i j) and is not usable
    const env = desc.match(/<gml:Envelope[^>]*>/)?.[0] ?? '';
    const axisLabels = (env.match(/axisLabels="([^"]+)"/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
    console.log(' ..  Envelope:', brief(env));
    const res = desc.match(/<gml:offsetVector[^>]*>([^<]+)</g)?.map((x) => x.replace(/<[^>]+>/g, '').trim());
    console.log(` OK  map axisLabels: ${axisLabels.join(' ') || '(not found)'}   offsetVectors: ${res?.join(' | ') ?? '?'}`);
    L.axes = axesEnv ?? (axisLabels.length >= 2 ? axisLabels.slice(0, 2) : D.axes);
    if (ids.includes(L.coverage)) usable.push(L);
  } catch (e) { console.log(' x  ', e.message); }
}

const [e, n] = process.argv.slice(2).map(Number);
if (Number.isFinite(e) && Number.isFinite(n)) {
  const grid = { x0: Math.floor(e), y0: Math.floor(n), nx: 10, ny: 10 };
  console.log('\nGetCoverage, 10 m x 10 m window at', grid.x0, grid.y0);
  for (const L of (usable.length ? usable : layers)) {
    const axesTried = [L.axes, D.axes, ['x', 'y'], ['Long', 'Lat'], ['Easting', 'Northing']].filter((a) => a?.length === 2 && !/^[ij]$/.test(a[0])).filter((a, i, all) => all.findIndex((b) => b.join() === a.join()) === i);
    let done = false;
    for (const [axes, subsettingCrs] of axesTried.flatMap((a) => [[a, true], [a, false]])) {
      if (done) break;
      try {
        const url = exportUrl({ ...L, axes, subsettingCrs }, grid);
        const res = await get(url), type = res.headers.get('content-type') ?? '';
        if (res.ok && /tif|image|octet/.test(type)) {
          const t = await decodeTiff(await res.arrayBuffer()), ok = [...t.values].filter(Number.isFinite);
          console.log(` OK  ${L.label} axes ${axes.join(',')}${subsettingCrs ? '' : ' (no subsettingCrs)'}: ${t.width}x${t.height}, valid ${ok.length}, range ${Math.min(...ok).toFixed(1)}..${Math.max(...ok).toFixed(1)} m${t.width !== grid.nx || t.height !== grid.ny ? '   (!) size differs from 10x10' : ''}`);
          done = true; console.log('     ->', url);
          break;
        }
        console.log(` x   ${L.label} axes ${axes.join(',')}${subsettingCrs ? '' : ' (no subsettingCrs)'}: ${res.status} ${type} ${brief(await res.text())}`);
      } catch (err) { console.log(` x   ${L.label} axes ${axes.join(',')}: ${err.message}`); }
    }
  }
}
