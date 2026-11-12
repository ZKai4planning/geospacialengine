/**
 * Renders the 3D inside-the-home view to an SVG file without a browser (the same viewer code the page uses, drawn
 * through a recording canvas). Useful to check a layout or send a picture:
 *
 *   node scripts/preview-interior.js --type rear_dormer --out dormer.svg
 *   node scripts/preview-interior.js --type rear_extension --depth 4 --storeys 2 --yaw 150 --pitch 35 --roof
 *
 * Options: --W 5.5 --D 9 --form terraced|semi|detached --type <work type> --depth --width --height --storeys --floors 2
 *          --layout plan.json (rooms, doors, windows, stairs as saved by the editor) --yaw --pitch --zoom --floor <n|all> --roof --no-cut --exploded --existing-only --no-surroundings --out file.svg
 */
import fs from 'node:fs';
import { buildInterior } from '../src/services/interior/index.js';
import { createViewer } from '../public/viewer3d.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const W = Number(val('W', 5.5)), D = Number(val('D', 9)), type = val('type', 'rear_extension');
const num = (n, d) => (val(n) != null ? Number(val(n)) : d);

const proposals = {
  rear_extension: { type, storeys: num('storeys', 1), depthM: num('depth', 4), heightM: num('height', 3), widthM: val('width') ? Number(val('width')) : null, alignment: 'center' },
  side_extension: { type, side: 'right', widthM: num('width', 2.5), heightM: num('height', 3), storeys: num('storeys', 1) },
  wraparound_extension: { type, side: 'right', depthM: num('depth', 3), widthM: num('width', 2.5), heightM: num('height', 3) },
  front_porch: { type, widthM: 1.6, depthM: 1.5, heightM: 2.8 },
  rear_dormer: { type, widthM: num('width', 3.5), depthM: num('depth', 2.5), heightM: num('height', 2.3) },
  additional_storey: { type },
  outbuilding: { type, widthM: num('width', 3), depthM: num('depth', 4), heightM: num('height', 2.5), setbackM: 5 },
  none: null,
};
const frame = { W, D, synthetic: false, toSD: (lng, lat) => [lng, lat] };
const sd = (s0, s1, d0, d1) => [[s0, d0], [s1, d0], [s1, d1], [s0, d1], [s0, d0]];
const interior = buildInterior({
  frame, form: val('form', 'terraced'), proposal: proposals[type] ?? null, setup: val('layout') ? { layout: JSON.parse(fs.readFileSync(val('layout'), 'utf8')) } : {},
  profile: { storeys: { value: num('floors', 2) }, roofType: { value: val('roof', 'Pitched') }, existingExtension: { present: false } },
  plotRings: [sd(-W / 2 - 0.1, W / 2 + 0.1, -D - 4, 24)],
  neighbours: [{ ring: sd(-W / 2 - 5.6, -W / 2 - 0.1, -D, 0) }, { ring: sd(W / 2 + 0.1, W / 2 + 5.6, -D, 0) }],
});
if (!interior.available) { console.error(interior.reason); process.exit(1); }

// a canvas that records what is drawn, as SVG
const SIZE = { w: Number(val('w', 1000)), h: Number(val('h', 700)) };
const out = [];
let path = '', fillStyle = '#000', strokeStyle = '#000', lineWidth = 1, font = '12px sans-serif', textAlign = 'center';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ctx = {
  setTransform() {}, clearRect() {}, beginPath() { path = ''; }, moveTo(x, y) { path += `M${x.toFixed(1)} ${y.toFixed(1)}`; }, lineTo(x, y) { path += `L${x.toFixed(1)} ${y.toFixed(1)}`; }, closePath() { path += 'Z'; },
  fill() { out.push(`<path d="${path}" fill="${fillStyle}"/>`); },
  stroke() { out.push(`<path d="${path}" fill="none" stroke="${strokeStyle}" stroke-width="${lineWidth}" stroke-linejoin="round"/>`); },
  strokeText(t, x, y) { out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${/(\d+)px/.exec(font)[1]}" font-weight="${/^\d+/.exec(font)[0]}" fill="none" stroke="${strokeStyle}" stroke-width="${lineWidth}" stroke-linejoin="round">${esc(t)}</text>`); },
  fillText(t, x, y) { out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${/(\d+)px/.exec(font)[1]}" font-weight="${/^\d+/.exec(font)[0]}" fill="${fillStyle}">${esc(t)}</text>`); },
  set fillStyle(v) { fillStyle = v; }, set strokeStyle(v) { strokeStyle = v; }, set lineWidth(v) { lineWidth = v; }, set font(v) { font = v; }, set textAlign(v) { textAlign = v; }, set textBaseline(v) {}, set lineJoin(v) {},
};
const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: SIZE.w, height: SIZE.h, left: 0, top: 0 }), addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, width: 0, height: 0 };
const queue = [];
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = (fn) => queue.push(fn);
globalThis.cancelAnimationFrame = () => {};

const cam = {};
for (const k of ['yaw', 'pitch', 'zoom']) if (val(k) != null) cam[k] = Number(val(k));
const opts = { roof: flag('roof'), cut: !flag('no-cut'), exploded: flag('exploded'), storey: val('floor', 'all') === 'all' ? 'all' : Number(val('floor')), existingOnly: flag('existing-only'), surroundings: !flag('no-surroundings') };
const viewer = createViewer(canvas, interior, { initial: { cam, opt: opts } });
for (let i = 0; i < 4 && queue.length; i++) { out.length = 0; const q = queue.splice(0); q[q.length - 1](); }

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.w}" height="${SIZE.h}" viewBox="0 0 ${SIZE.w} ${SIZE.h}"><rect width="100%" height="100%" fill="#eef3fb"/>${out.join('')}</svg>`;
const file = val('out', 'interior-preview.svg');
fs.writeFileSync(file, svg);
console.log(`${file}: ${interior.rooms.length} rooms, ${out.length} shapes`);
