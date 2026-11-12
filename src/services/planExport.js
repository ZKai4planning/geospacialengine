/**
 * Printable outputs built from a derived application:
 *   buildBlockPlanSvg(app)   a block plan on A4 landscape at a TRUE printed scale (the SVG is sized in millimetres), with the red site line,
 *                            the work, neighbours, roads, pavements, street furniture, dimensions, north point, scale bar and a title block.
 *   buildLdcPackHtml(app)    a draft "supporting statement" for a Lawful Development Certificate (proposed development): the project, the
 *                            GPDO provisions and how each is met, constraints, history, the plan, and a submission checklist.
 *
 * Both are DRAFTS prepared from public data. The plan is NOT a surveyed or OS-licensed plan, and a location plan (1:1250 on licensed mapping)
 * is not produced: councils set their own validation rules, so check them. Nothing here is legal advice.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
const SCALES = [100, 200, 250, 500, 1000, 1250, 2500];
const PAGE = { w: 297, h: 210, margin: 10, titleH: 30 };

/** Smallest standard scale at which the whole map fits the drawing area of an A4 landscape sheet. */
export function chooseScale(map) {
  const mPerPx = map.scale.metres / map.scale.px, groundW = map.view.w * mPerPx, groundH = map.view.h * mPerPx;
  const maxW = PAGE.w - 2 * PAGE.margin, maxH = PAGE.h - 2 * PAGE.margin - PAGE.titleH;
  const n = SCALES.find((s) => (groundW / s) * 1000 <= maxW && (groundH / s) * 1000 <= maxH) ?? SCALES.at(-1);
  return { n, mPerPx, widthMm: (groundW / n) * 1000, heightMm: (groundH / n) * 1000 };
}

const STYLE = {
  plot: { fill: 'none', stroke: '#d40000', mm: 0.6 }, building: { fill: '#d9dde6', stroke: '#111', mm: 0.35 }, existing_extension: { fill: '#e8c9a0', stroke: '#111', mm: 0.3 },
  proposal: { fill: 'rgba(47,84,214,0.25)', stroke: '#1f3fbf', mm: 0.5 }, neighbour: { fill: '#f1f2f5', stroke: '#8a8f9c', mm: 0.2 }, outbuilding: { fill: '#fbe9c4', stroke: '#c98a00', mm: 0.25 },
  public_land: { fill: '#eef0f5', stroke: 'none', mm: 0 },
};
const upright = (deg) => (deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg);

export function buildBlockPlanSvg(app) {
  const map = app.map;
  if (!map?.layers || !map.scale) throw new Error('No map to draw yet.');
  const { n, mPerPx, widthMm, heightMm } = chooseScale(map);
  const mmPerPx = widthMm / map.view.w, px = (mm) => r1((mm / mmPerPx) * 100) / 100;        // millimetres on paper -> drawing units
  const ox = PAGE.margin + (PAGE.w - 2 * PAGE.margin - widthMm) / 2, oy = PAGE.margin;
  const L = map.layers, body = [];

  const drawn = [...L].sort((a, b) => ['public_land', 'road', 'pathway', 'plot', 'neighbour', 'outbuilding', 'powerline', 'obstacle', 'tree', 'building', 'existing_extension', 'proposal'].indexOf(a.kind) - ['public_land', 'road', 'pathway', 'plot', 'neighbour', 'outbuilding', 'powerline', 'obstacle', 'tree', 'building', 'existing_extension', 'proposal'].indexOf(b.kind));
  for (const l of drawn) {
    const st = STYLE[l.kind];
    if (st && l.path) body.push(`<path d="${esc(l.path)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${px(st.mm)}" fill-rule="evenodd"/>`);
    else if ((l.kind === 'road' || l.kind === 'pathway') && l.path) body.push(`<path d="${esc(l.path)}" fill="none" stroke="${l.kind === 'road' ? '#d3d7e0' : '#e8dfc8'}" stroke-width="${l.strokePx}" stroke-linecap="round"/>`);
    else if (l.kind === 'powerline' && l.path) body.push(`<path d="${esc(l.path)}" fill="none" stroke="#c47a00" stroke-width="${px(0.3)}" stroke-dasharray="${px(2)} ${px(1)}"/>`);
    else if (l.kind === 'obstacle' && l.path) body.push(`<path d="${esc(l.path)}" fill="${l.status === 'clear' ? '#e0242b' : '#ff3b3b'}" stroke="#555" stroke-width="${px(0.15)}"/>`);
    else if (l.kind === 'tree' && l.path) body.push(`<path d="${esc(l.path)}" fill="rgba(60,140,60,0.15)" stroke="#2f7d2f" stroke-width="${px(0.2)}"/>`);
  }
  const bp = map.blockPlan;
  const fs = px(2.2), text = (x, y, t, deg = 0, extra = '') => `<text x="${r1(x)}" y="${r1(y)}" font-size="${fs}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" ${deg ? `transform="rotate(${r1(deg)} ${r1(x)} ${r1(y)})"` : ''} ${extra}>${esc(t)}</text>`;
  if (bp) {
    for (const e of bp.edges ?? []) body.push(text(e.x, e.y - px(0.8), `${e.metres} m`, upright(e.angle), 'fill="#111"'));
    for (const d of bp.dims ?? []) {
      const [x1, y1] = d.a, [x2, y2] = d.b, a = Math.atan2(y2 - y1, x2 - x1), tx = -Math.sin(a) * px(1), ty = Math.cos(a) * px(1);
      body.push(`<g stroke="#8a2be2" stroke-width="${px(0.2)}" fill="none"><line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/><line x1="${r1(x1 - tx)}" y1="${r1(y1 - ty)}" x2="${r1(x1 + tx)}" y2="${r1(y1 + ty)}"/><line x1="${r1(x2 - tx)}" y1="${r1(y2 - ty)}" x2="${r1(x2 + tx)}" y2="${r1(y2 + ty)}"/></g>`);
      body.push(text((x1 + x2) / 2 - Math.sin(a) * px(2.4), (y1 + y2) / 2 + Math.cos(a) * px(2.4) + px(0.8), d.label, upright((a * 180) / Math.PI), 'fill="#5b1fa6"'));
    }
  }

  // scale bar: a round ground length that is 15-40 mm on paper
  const bars = [1, 2, 5, 10, 20, 50, 100, 200], bar = [...bars].reverse().find((m) => (m / n) * 1000 <= 40) ?? bars[0], barMm = (bar / n) * 1000;
  const sheet = [];
  sheet.push(`<rect x="0.5" y="0.5" width="${PAGE.w - 1}" height="${PAGE.h - 1}" fill="#fff" stroke="#000" stroke-width="0.3"/>`);
  sheet.push(`<svg x="${r1(ox)}" y="${oy}" width="${r1(widthMm)}" height="${r1(heightMm)}" viewBox="0 0 ${map.view.w} ${map.view.h}" overflow="hidden"><rect width="${map.view.w}" height="${map.view.h}" fill="#fff"/>${body.join('')}</svg>`);
  sheet.push(`<rect x="${r1(ox)}" y="${oy}" width="${r1(widthMm)}" height="${r1(heightMm)}" fill="none" stroke="#000" stroke-width="0.25"/>`);
  const ty0 = PAGE.h - PAGE.margin - PAGE.titleH + 4, t = (x, y, s, size = 3.2, w = 'normal', anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${w}" font-family="Arial,Helvetica,sans-serif" text-anchor="${anchor}">${esc(s)}</text>`;
  sheet.push(`<rect x="${PAGE.margin}" y="${PAGE.h - PAGE.margin - PAGE.titleH}" width="${PAGE.w - 2 * PAGE.margin}" height="${PAGE.titleH}" fill="none" stroke="#000" stroke-width="0.25"/>`);
  sheet.push(t(PAGE.margin + 3, ty0 + 3, app.address?.fullAddress ?? 'Site address', 4.2, 'bold'));
  sheet.push(t(PAGE.margin + 3, ty0 + 9, `BLOCK PLAN – ${app.cards?.proposal?.title ?? 'proposed work'}`, 3.4));
  sheet.push(t(PAGE.margin + 3, ty0 + 15, `Scale 1:${n} at A4 · Drawn ${new Date().toISOString().slice(0, 10)} · DRAFT`, 3));
  sheet.push(t(PAGE.margin + 3, ty0 + 20, 'Prepared from open map data (OpenStreetMap, HM Land Registry INSPIRE). Not a surveyed plan; positions can be a metre or more out.', 2.4));
  sheet.push(`<g transform="translate(${PAGE.w - PAGE.margin - 70},${ty0 + 6})"><rect x="0" y="0" width="${r1(barMm)}" height="1.4" fill="#000"/><rect x="${r1(barMm / 2)}" y="0" width="${r1(barMm / 2)}" height="1.4" fill="#fff" stroke="#000" stroke-width="0.2"/>${t(0, 5, '0', 2.6)}${t(r1(barMm), 5, `${bar} m`, 2.6, 'normal', 'end')}</g>`);
  sheet.push(`<g transform="translate(${PAGE.w - PAGE.margin - 12},${ty0 + 12})"><line x1="0" y1="8" x2="0" y2="-4" stroke="#000" stroke-width="0.4"/><path d="M0,-8 L-2.2,-3 L2.2,-3 Z" fill="#000"/>${t(0, 13, 'N', 3.4, 'bold', 'middle')}</g>`);
  sheet.push(`<g transform="translate(${PAGE.margin + 3},${PAGE.h - PAGE.margin - 3.5})"><rect width="5" height="2" fill="none" stroke="#d40000" stroke-width="0.5"/>${t(7, 1.8, 'Application site (title boundary, indicative)', 2.4)}<rect x="75" width="5" height="2" fill="rgba(47,84,214,0.25)" stroke="#1f3fbf" stroke-width="0.4"/>${t(82, 1.8, 'Proposed work', 2.4)}<rect x="108" width="5" height="2" fill="#d9dde6" stroke="#111" stroke-width="0.3"/>${t(115, 1.8, 'Existing house', 2.4)}</g>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}"><title>Block plan 1:${n} – ${esc(app.address?.fullAddress ?? '')}</title>${sheet.join('')}</svg>`;
}

const VERDICT = { permitted_development: 'appears to be permitted development', prior_approval: 'may qualify for the prior-approval route', planning_permission: 'appears to need planning permission', listed_building_consent: 'needs listed building consent', not_a_house: 'is not a house, so householder rights do not apply', house_unconfirmed: 'could not be confirmed as a house', not_applicable: 'is outside the area these rules cover' };
const STATUS = { pass: ['Met', 'ok'], fail: ['Not met', 'bad'], uncertain: ['Applicant to confirm', 'warn'], condition: ['Condition to comply with', 'info'], not_assessed: ['Not tested here – applicant to confirm', 'warn'] };
const WORD = { rear_extension: 'single or two-storey rear extension', side_extension: 'side extension', wraparound_extension: 'wraparound (rear and side) extension', front_porch: 'front porch', rear_dormer: 'rear dormer', outbuilding: 'garden outbuilding', additional_storey: 'additional storey' };

export function buildLdcPackHtml(app) {
  const a = app.assessment, p = a?.project, g = a?.gpdo;
  if (!a || !p || !g) throw new Error('Choose the work first: the statement is built from the permitted-development check.');
  const prop = app.proposal ?? {}, std = a.proposal ?? prop, layer = app.map?.layers?.find((l) => l.kind === 'proposal');
  const dims = [std.widthM && `${std.widthM} m wide`, std.depthM && `${std.depthM} m deep`, std.heightM && `${std.heightM} m high`, std.storeys && `${std.storeys} storey${std.storeys > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  const rows = (app.areas?.rows ?? []).map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value ?? 'not available')}<div class="how">${esc(r.how)}</div></td></tr>`).join('');
  const prov = g.provisions.map((x) => {
    const [label, cls] = STATUS[x.status] ?? [x.status, 'info'];
    return `<tr class="${cls}"><td><strong>${esc(x.ref)}</strong></td><td>${esc(x.text)}</td><td>${esc(label)}${x.evidence.map((e) => `<div class="how">${esc(e.message)}</div>`).join('')}</td></tr>`;
  }).join('');
  const constraints = (app.constraints?.items ?? []).map((i) => `<li><strong>${esc(i.label)}</strong>${i.name ? ` – ${esc(i.name)}` : ''}. ${esc(i.impact ?? '')}</li>`).join('');
  const art4 = a.checks.filter((c) => c.id === 'article4-details').map((c) => `<li>${esc(c.message)}</li>`).join('');
  const hist = (app.history?.here ?? []).slice(0, 8).map((h) => `<li>${esc((h.decidedOn ?? h.receivedOn ?? '').slice(0, 10))} – ${esc(h.outcome)}: ${esc(h.description)}</li>`).join('');
  const regs = (app.map?.siteChecks?.regulatory ?? []).map((r) => `<li>${esc(r.message)}</li>`).join('');
  const checks = a.checks.filter((c) => c.status === 'warn' || c.status === 'fail').map((c) => `<li class="${c.status}">${esc(c.message)}</li>`).join('');
  let plan = '';
  try { plan = buildBlockPlanSvg(app).replace(/^<\?xml[^>]*>\s*/, ''); } catch { plan = '<p class="how">No map is available for this property yet.</p>'; }
  const epc = app.epc;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draft LDC supporting statement – ${esc(app.address?.fullAddress ?? '')}</title>
<style>body{font:14px/1.5 Arial,Helvetica,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px}h2{font-size:17px;margin:26px 0 6px;border-bottom:1px solid #ccd;padding-bottom:3px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccd;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f3f5fa;width:30%}.how{font-size:12px;color:#556}
tr.bad td:nth-child(3){background:#fde8e8}tr.warn td:nth-child(3){background:#fff6e0}tr.ok td:nth-child(3){background:#e6f6ec}.box{border:2px solid #c0392b;padding:8px 12px;background:#fff5f5;margin:10px 0}
li.fail{color:#a12}li.warn{color:#7a5300}.plan svg{width:100%;height:auto;border:1px solid #ccd}.todo{background:#fffbe0;padding:0 3px}@media print{body{margin:0}h2{break-after:avoid}.plan{break-inside:avoid}}</style></head><body>
<h1>Draft supporting statement – Lawful Development Certificate (proposed development)</h1>
<p><strong>${esc(app.address?.fullAddress ?? '')}</strong> · prepared ${new Date().toISOString().slice(0, 10)} · ${esc(app.authority?.name ?? 'local planning authority to be confirmed')}</p>
<div class="box"><strong>Read this first.</strong> This statement was prepared automatically from public data (OpenStreetMap, HM Land Registry, planning.data.gov.uk, energy certificate and other registers). It is a draft to help you prepare an application, not legal or planning advice and not a determination. Positions and figures can be a metre or more out. Items marked <span class="todo">applicant to confirm</span> were not, or could not be, tested. Check every figure against your own survey and plans.</div>

<h2>1. The application</h2>
<table><tr><th>Site address</th><td>${esc(app.address?.fullAddress ?? '')}${app.address?.uprn ? `<div class="how">UPRN ${esc(app.address.uprn)}</div>` : ''}</td></tr>
<tr><th>Local planning authority</th><td>${esc(app.authority?.name ?? '')}</td></tr><tr><th>Applicant</th><td><span class="todo">to be completed</span></td></tr><tr><th>Agent (if any)</th><td><span class="todo">to be completed</span></td></tr></table>

<h2>2. The proposed development</h2>
<p>${esc(p.developmentType)}: ${esc(WORD[std.type] ?? std.type)}${dims ? ` (${esc(dims)})` : ''}${layer?.areaM2 ? `, ground area ${esc(layer.areaM2)} m²` : ''}. It is assessed under <strong>${esc(p.gpdo.schedule)}, Class ${esc(p.gpdo.class)}</strong> – ${esc(p.gpdo.title)}.</p>
<p>On the information available the development <strong>${esc(VERDICT[a.verdict] ?? a.verdict)}</strong>. ${esc(a.summary ?? '')}</p>
${checks ? `<p><strong>Points that need attention before applying:</strong></p><ul>${checks}</ul>` : ''}

<h2>3. The site and the house</h2>
<table>${rows}${epc ? `<tr><th>Energy certificate</th><td>${[epc.propertyType, epc.builtForm, epc.ageBand, epc.floorAreaM2 && `${epc.floorAreaM2} m²`, epc.habitableRooms && `${epc.habitableRooms} habitable rooms`].filter(Boolean).map(esc).join(' · ')}</td></tr>` : ''}</table>

<h2>4. How each permitted-development provision is met</h2>
<table><tr><th style="width:12%">Paragraph</th><th style="width:44%">Requirement</th><th>Position</th></tr>${prov}</table>
${p.conditions?.length ? `<p><strong>Conditions that apply once built:</strong></p><ul>${p.conditions.map((c) => `<li>${esc(c.ref)} – ${esc(c.text)}</li>`).join('')}</ul>` : ''}

<h2>5. Constraints, history and other approvals</h2>
${constraints ? `<p>Constraints recorded at this address:</p><ul>${constraints}</ul>` : '<p>No national planning constraints were found at this address (coverage varies by council).</p>'}
${art4 ? `<ul>${art4}</ul>` : ''}
${hist ? `<p>Earlier applications at this address (from council registers; decision notices and conditions are not included – read them on the council's register):</p><ul>${hist}</ul>` : '<p>No earlier applications were found for this address in the data used.</p>'}
${regs ? `<p>Other approvals and notices to think about (these do not change whether this is permitted development):</p><ul>${regs}</ul>` : ''}

<h2>6. Block plan</h2>
<div class="plan">${plan}</div>
<p class="how">Drawn at a true printed scale on A4 landscape when printed at 100%. Prepared from open map data, not a surveyed or Ordnance Survey-licensed plan.</p>

<h2>7. What the council will normally want with the application</h2>
<ul><li>The council's application form for a Lawful Development Certificate (proposed use or development), and the fee – check the current fee and form on the council's website or the Planning Portal.</li>
<li>A <strong>location plan</strong> (usually 1:1250 or 1:2500, on up-to-date licensed mapping, with a north point, the application site edged in red) – <span class="todo">not produced by this tool</span>.</li>
<li>A <strong>block plan</strong> (usually 1:200 or 1:500) showing the site, the existing building and the proposal – a draft is in section 6.</li>
<li><strong>Existing and proposed floor plans and elevations</strong> with dimensions, showing heights, eaves and ridge, and the materials – <span class="todo">to be drawn</span>.</li>
<li>This statement, after you have checked and corrected it.</li></ul>
<p class="how">Councils set their own validation requirements; check theirs before submitting. A Lawful Development Certificate is optional but gives legal certainty that the work is permitted development as described.</p>

<h2>8. Declaration</h2>
<p>I confirm that the information in this statement is true to the best of my knowledge.</p>
<p>Name: <span class="todo">__________________</span> &nbsp; Signed: <span class="todo">__________________</span> &nbsp; Date: <span class="todo">__________</span></p>
</body></html>`;
}
