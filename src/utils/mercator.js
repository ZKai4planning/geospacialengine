const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const toMerc = (lng, lat) => [R * rad(lng), R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
export const fromMerc = (x, y) => [deg(x / R), deg(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2)];
export const resolution = (zoom) => (2 * Math.PI * R) / (256 * 2 ** zoom); // Web-Mercator metres per pixel

/** A map view: centre + zoom + pixel size. Aerial providers render it, the SVG overlay is projected into it. */
export function makeView({ lat, lng, zoom, w = 640, h = 400 }) {
  const [cx, cy] = toMerc(lng, lat);
  const res = resolution(zoom);
  return {
    lat, lng, zoom, w, h, cx, cy, res,
    bboxMerc: [cx - (w / 2) * res, cy - (h / 2) * res, cx + (w / 2) * res, cy + (h / 2) * res],
    groundMPerPx: res * Math.cos(rad(lat)),
  };
}

/** lng/lat -> pixel [x,y] inside the view */
export function project(view, lng, lat) {
  const [mx, my] = toMerc(lng, lat);
  return [(mx - view.cx) / view.res + view.w / 2, view.h / 2 - (my - view.cy) / view.res];
}
