// Spatial grid used by the OS Open UPRN database: 0.002° cells (~220 m N-S, ~140 m E-W in southern England).
export const CELLS_PER_DEGREE = 500;
export const LAT_STRIDE = 10000;
export const latIdx = (lat) => Math.floor(lat * CELLS_PER_DEGREE);
export const lngIdx = (lng) => Math.floor((lng + 10) * CELLS_PER_DEGREE); // GB spans lng -9 … 2
export const cellKey = (lat, lng) => latIdx(lat) * LAT_STRIDE + lngIdx(lng);
