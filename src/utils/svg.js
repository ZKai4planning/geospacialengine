export const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** Simple SVG placeholder image returned when imagery is unavailable / keys are missing. */
export function svgImage({ w, h, title, subtitle = '' }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="#dfe6f5"/>
<g fill="#1f2a6b" font-family="system-ui,sans-serif" text-anchor="middle">
<text x="${w / 2}" y="${h / 2 - 6}" font-size="${Math.max(14, w / 28)}" font-weight="600">${esc(title)}</text>
<text x="${w / 2}" y="${h / 2 + 18}" font-size="${Math.max(11, w / 40)}" opacity=".75">${esc(subtitle)}</text></g></svg>`;
  return { buffer: Buffer.from(svg), contentType: 'image/svg+xml' };
}
