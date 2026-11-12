const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Compass word for a local-metres offset (x = east, y = north). */
export const dirOf = (dx, dy) => DIRS[Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 / 45) % 8];
export const r1 = (n) => Math.round(n * 10) / 10;
