import { buildFrame, buildLayers } from './proposalGeometry.js';
import { makeView, project } from '../utils/mercator.js';

const VIEW_W = 640, VIEW_H = 400, PAD = 44;

/**
 * Builds everything the UI needs to draw the proposal on the aerial photo:
 * layers (lng/lat + SVG path in the view's pixel space), labels, scale bar and GeoJSON.
 * The aerial image and the overlay share the same `view`, so they line up exactly.
 */
export function buildMap({ address, footprint, roads, camera, profile, proposal }) {
  const frame = buildFrame({ address, footprint, roads, camera, frontBearingDeg: profile.frontBearingDeg?.value ?? null });
  const layers = buildLayers({ frame, footprint, existing: profile.existingExtension, proposal });

  const all = layers.flatMap((l) => l.ring);
  const lngs = all.map((p) => p[0]), lats = all.map((p) => p[1]);
  const centre = { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };

  // largest zoom (max 20) at which every layer fits inside the padded view
  let view;
  for (let z = 20; z >= 17; z--) {
    view = makeView({ ...centre, zoom: z, w: VIEW_W, h: VIEW_H });
    const px = all.map(([lng, lat]) => project(view, lng, lat));
    if (px.every(([x, y]) => x >= PAD && x <= VIEW_W - PAD && y >= PAD && y <= VIEW_H - PAD)) break;
  }

  const r1 = (n) => Math.round(n * 10) / 10;
  const out = layers.map((l) => {
    const px = l.ring.map(([lng, lat]) => project(view, lng, lat));
    const c = px.slice(0, -1).reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((v) => v / (px.length - 1));
    return {
      id: l.id, kind: l.kind, label: l.label, workType: l.workType ?? null, style: l.style ?? 'solid',
      indicative: !!l.indicative, areaM2: l.areaM2, dims: l.dims ?? null,
      path: `M${px.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L')} Z`,
      labelAt: { x: r1(c[0]), y: r1(c[1]) },
      dimsText: l.dims ? `${r1(l.dims.widthM)} × ${r1(l.dims.depthM)} m` : null,
      ring: l.ring,
    };
  });

  // keep labels from overlapping when outlines sit on top of each other (e.g. dormer over an existing extension)
  const labelled = out.filter((l) => l.kind !== 'building').sort((a, b) => a.labelAt.y - b.labelAt.y);
  for (let i = 1; i < labelled.length; i++) {
    const gap = labelled[i].labelAt.y - labelled[i - 1].labelAt.y;
    if (gap < 34) labelled[i].labelAt.y = r1(labelled[i - 1].labelAt.y + 34);
  }

  return {
    frame: { frontBearingDeg: frame.frontBearingDeg, frontSource: frame.frontSource, houseWidthM: r1(frame.W), houseDepthM: r1(frame.D), indicative: frame.synthetic },
    view: { lat: view.lat, lng: view.lng, zoom: view.zoom, w: view.w, h: view.h },
    scale: { metres: 5, px: r1(5 / view.groundMPerPx) },
    layers: out,
    geojson: {
      type: 'FeatureCollection',
      features: out.map((l) => ({ type: 'Feature', properties: { id: l.id, kind: l.kind, label: l.label, areaM2: l.areaM2 }, geometry: { type: 'Polygon', coordinates: [l.ring] } })),
    },
  };
}
