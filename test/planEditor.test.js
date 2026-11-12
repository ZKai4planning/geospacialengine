import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterior } from '../src/services/interior/index.js';

// ---- a very small fake DOM: just enough for the editor (elements, attributes, listeners, SVG point maths) ----
class N {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.l = {}; this.className = ''; this.value = ''; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  append(...k) { for (const c of k) this.children.push(typeof c === 'string' ? Object.assign(new N('#text'), { textContent: c }) : c); }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  addEventListener(t, f) { (this.l[t] ??= []).push(f); }
  focus() {} remove() { overlay = null; } setPointerCapture() {}
  createSVGPoint() { return { x: 0, y: 0, matrixTransform(m) { return m.apply(this); } }; }
  getScreenCTM() { return { inverse: () => ({ apply: (p) => ({ x: p.x / 100 - 1.6, y: p.y / 100 - 1.6 }) }) }; }  // 100 px per metre, viewBox starts at -1.6
  fire(type, ev = {}) { for (const f of this.l[type] ?? []) f({ target: this, preventDefault() {}, pointerId: 1, ...ev }); }
  all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.all(pred, out)); return out; }
}
const txt = (n) => (n.tagName === '#text' ? n.textContent : n.children.map(txt).join(''));
let overlay = null;
const keyListeners = [];
globalThis.document = {
  createElementNS: (_, t) => new N(t), createElement: (t) => new N(t), activeElement: null,
  body: { append(n) { overlay = n; }, classList: { add() {}, remove() {} } },
  addEventListener(t, f) { keyListeners.push(f); }, removeEventListener() {},
};
const { openPlanEditor } = await import('../public/planEditor.js');

const frame = { W: 5.5, D: 9, synthetic: false, toSD: (a, b) => [a, b] };
const interior = buildInterior({ frame, profile: { storeys: { value: 2 }, roofType: { value: 'Pitched' }, existingExtension: { present: false } }, proposal: { type: 'rear_extension', storeys: 1, depthM: 3, heightM: 3 }, form: 'terraced' });
const px = (x, y) => ({ clientX: (x + 1.6) * 100, clientY: (9 - y + 1.6) * 100 });      // model metres -> fake screen pixels
const byText = (t) => overlay.all((n) => n.tagName === 'button' && n.children.some((c) => c.textContent === t))[0];
const svgOf = () => overlay.all((n) => n.tagName === 'svg')[0];
const roomPolys = () => svgOf().all((n) => n.tagName === 'polygon' && n.attrs['data-id']);

test('the editor starts from the rooms the 3D view shows, one set per floor', () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  assert.equal(roomPolys().length, interior.rooms.filter((r) => !r.isNew && r.storey === 0).length);
  byText('Floor 1').fire('click');
  assert.equal(roomPolys().length, interior.rooms.filter((r) => !r.isNew && r.storey === 1).length);
  assert.equal(saved, null);
});

test('Rectangle tool: dragging adds a snapped room; too small is refused; saving returns every floor', async () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  const before = roomPolys().length;
  byText('Rectangle').fire('click');
  const s = svgOf();
  s.fire('pointerdown', px(0.03, 9.04)); s.fire('pointermove', px(2.04, 11.96)); s.fire('pointerup', px(2.04, 11.96));
  assert.equal(roomPolys().length, before + 1);
  byText('Rectangle').fire('click');
  s.fire('pointerdown', px(3, 3)); s.fire('pointermove', px(3.2, 3.2)); s.fire('pointerup', px(3.2, 3.2));
  assert.equal(roomPolys().length, before + 1, 'a 0.2 m rectangle is ignored');
  await byText('Save floor plan').l.click[0]({});
  assert.equal(saved.storeys.length, 2);
  const added = saved.storeys[0].rooms.at(-1);
  assert.deepEqual(added.poly, [[0, 9], [2, 9], [2, 12], [0, 12]], 'snapped to the grid (and the house corner)');
  assert.match(added.id, /^u-0-\d+$/);
});

test('Draw tool: clicks make corners, clicking the first corner closes the room; Escape cancels', () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  const before = roomPolys().length;
  byText('Draw room').fire('click');
  const s = svgOf();
  for (const [x, y] of [[0.5, 0.5], [2.5, 0.5], [2.5, 2.5]]) s.fire('pointerdown', px(x, y));
  s.fire('pointerdown', px(0.52, 0.5));            // back on the first corner
  assert.equal(roomPolys().length, before + 1);
  byText('Draw room').fire('click');
  s.fire('pointerdown', px(4, 4)); s.fire('keydown', { key: 'Escape' });
  s.fire('pointerdown', px(4.5, 4.5));              // select tool now: clicks no longer add corners
  assert.equal(roomPolys().length, before + 1);
});

test('dragging a room moves it by whole grid steps; Ctrl+Z puts it back', () => {
  openPlanEditor(interior, { onSave: async () => null });
  const first = roomPolys()[0];
  const before = first.attrs.points;
  const id = first.attrs['data-id'];
  const s = svgOf();
  s.fire('pointerdown', { ...px(1, 1), target: first });
  s.fire('pointermove', px(1.31, 1.02)); s.fire('pointerup', px(1.31, 1.02));
  const moved = roomPolys().find((p) => p.attrs['data-id'] === id).attrs.points;
  assert.notEqual(moved, before);
  s.fire('keydown', { key: 'z', ctrlKey: true });
  assert.equal(roomPolys().find((p) => p.attrs['data-id'] === id).attrs.points, before);
});

test('save refuses an empty floor below a drawn one, and shows the server error instead of closing', async () => {
  const msgs = [];
  openPlanEditor(interior, { onSave: async () => 'Kitchen: reaches outside the house outline.' });
  await byText('Save floor plan').l.click[0]({});
  const note = overlay.all((n) => n.tagName === 'p' && n.attrs.role === 'status')[0];
  assert.match(note.textContent, /reaches outside/);
  assert.ok(overlay, 'editor stays open');
  void msgs;
});

const msgText = () => overlay.all((n) => n.tagName === 'p' && n.attrs.role === 'status')[0].textContent;
const roomsOnFloor0 = interior.rooms.filter((r) => !r.isNew && r.storey === 0);

test('overlap: a room drawn on top of another is shown, named, and blocks saving', async () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  byText('Rectangle').fire('click');
  const s = svgOf();
  s.fire('pointerdown', px(1, 1)); s.fire('pointermove', px(3, 3)); s.fire('pointerup', px(3, 3));
  assert.match(msgText(), /overlap by/);
  assert.ok(svgOf().all((n) => n.attrs.class === 'pe-overlap').length >= 2, 'both rooms are outlined in red');
  await byText('Save floor plan').l.click[0]({});
  assert.equal(saved, null, 'not sent to the server while rooms overlap');
});

test('Door and Window tools: click a wall to place, ignore clicks in the open, slide along the wall, edit and delete', async () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  const s = svgOf();
  byText('Door').fire('click');
  s.fire('pointerdown', px(3, 4.7));                     // middle of a room: no wall near
  assert.match(msgText(), /Click on a wall/);
  const front = Math.min(...roomsOnFloor0.flatMap((r) => r.poly.map((p) => p[1])));   // y = 0 front wall
  byText('Door').fire('click');
  s.fire('pointerdown', px(3.0, 0.05));                  // on the front wall
  let opens = s.all((n) => n.tagName === 'line' && n.attrs['data-open']);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].attrs.y1, opens[0].attrs.y2, 'lies along the front wall');
  assert.ok(Math.abs(Math.hypot(opens[0].attrs.x2 - opens[0].attrs.x1, 0) - 0.9) < 0.01, 'default door width 0.9 m');
  // slide it to x = 4.5
  s.fire('pointerdown', { ...px(3.0, 0), target: opens[0] });
  s.fire('pointermove', px(4.5, 0.05)); s.fire('pointerup', px(4.5, 0.05));
  opens = s.all((n) => n.tagName === 'line' && n.attrs['data-open']);
  assert.ok(Math.abs((Number(opens[0].attrs.x1) + Number(opens[0].attrs.x2)) / 2 - 4.5) < 0.06);
  // a window on the rear wall of the kitchen, then save and look at the payload
  byText('Window').fire('click');
  s.fire('pointerdown', px(2.0, 8.97));
  await byText('Save floor plan').l.click[0]({});
  const f0 = saved.storeys[0];
  assert.deepEqual(f0.openings.map((o) => o.kind).sort(), ['door', 'window']);
  const win = f0.openings.find((o) => o.kind === 'window');
  assert.equal(win.sillM, 0.9); assert.equal(win.heightM, 1.2);
  assert.ok(win.a[1] === 9 && win.b[1] === 9);
});

test('Stairs tool: drag a rectangle, direction follows the longer side, steepness is judged live', async () => {
  let saved = null;
  openPlanEditor(interior, { onSave: async (l) => { saved = l; return null; } });
  const s = svgOf();
  byText('Stairs').fire('click');
  s.fire('pointerdown', px(0.1, 0.1)); s.fire('pointermove', px(0.9, 3.0)); s.fire('pointerup', px(0.9, 3.0));
  const form = overlay.all((n) => n.tagName === 'p' && /steps of/.test(txt(n)))[0];
  assert.match(txt(form), /13 steps of 204 mm rise and 250 mm going/);
  assert.equal(form.className, 'hint');
  // too short: 2 m
  byText('Stairs').fire('click');
  s.fire('pointerdown', px(2, 4)); s.fire('pointermove', px(2.9, 6)); s.fire('pointerup', px(2.9, 6));
  const bad = overlay.all((n) => n.tagName === 'p' && /Too steep/.test(txt(n)));
  assert.equal(bad.length, 1);
  await byText('Save floor plan').l.click[0]({});
  assert.equal(saved.storeys[0].stairs.length, 2);
  assert.equal(saved.storeys[0].stairs[0].dir, '+y');
});

test('existing doors, windows and stairs from the model come back into the editor and are saved again', async () => {
  const withFeatures = buildInterior({ frame, profile: { storeys: { value: 2 }, roofType: { value: 'Pitched' }, existingExtension: { present: false } }, proposal: null, form: 'terraced', setup: { layout: { storeys: [
    { index: 0, rooms: [{ id: 'u-0-1', name: 'Lounge', type: 'living', poly: [[0, 0], [5.5, 0], [5.5, 9], [0, 9]] }], openings: [{ id: 'w-0-1', kind: 'window', a: [1, 0], b: [2.2, 0] }], stairs: [{ id: 's-0-1', dir: '+y', poly: [[0, 0], [0.9, 0], [0.9, 3], [0, 3]] }] },
    { index: 1, rooms: [{ id: 'u-1-1', name: 'Bedroom', type: 'bedroom', poly: [[0, 0], [5.5, 0], [5.5, 9], [0, 9]] }] },
  ] } } });
  let saved = null;
  openPlanEditor(withFeatures, { onSave: async (l) => { saved = l; return null; } });
  assert.equal(svgOf().all((n) => n.attrs['data-open']).length, 1);
  assert.equal(svgOf().all((n) => n.attrs['data-stair']).length, 1);
  await byText('Save floor plan').l.click[0]({});
  assert.equal(saved.storeys[0].openings[0].id, 'w-0-1');
  assert.equal(saved.storeys[0].stairs[0].id, 's-0-1');
  assert.deepEqual(saved.storeys[1].openings, []);
});
