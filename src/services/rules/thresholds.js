/** Tunable thresholds. Map data is only accurate to about a metre, so these deliberately ignore tiny overlaps. */
export const THRESHOLDS = {
  // neighbouring buildings
  neighbourOverlapM2: 0.5,   // overlap with a neighbouring building at or above this = "overlaps"
  adjoinM: 0.3,              // closer than this (but not overlapping) = "adjoins"
  closeM: 1.0,               // closer than this = "very close"
  rangeM: 8,                 // neighbours further away than this are not examined
  // wall safety (each new outside wall on its own)
  wallTouchM: 0.3,           // a wall this close to a neighbour's wall / the title line is "against" it (map accuracy)
  wallContactMinM: 0.5,      // ... for at least this much of its length (plus the 2 x tolerance at its ends), so a corner that merely kisses it is ignored
  wallFireM: 1.0,            // Approved Document B: walls closer than this to a boundary are limited in openings and fire resistance
  // title boundary
  boundaryToleranceM: 0.5,   // ignore anything within this of the title outline (data accuracy)
  boundaryCrossM2: 0.5,      // area beyond the title boundary at or above this = "crosses"
  // roads (OSM centreline + half the carriageway width)
  roadOverlapM: 0.5,         // reaching this far onto the mapped carriageway = "on the road"
  roadCloseM: 1.0,           // closer than this to the carriageway edge = "very close"
  roadRangeM: 30,            // roads further than this are not examined
  roadDrawM: 45,             // roads further than this from the site are not drawn
  // trees
  treeOnTrunkM: 0.5,         // trunk this close to (or inside) the footprint = "built on the tree"
  treeRangeM: 3,             // trees further than their root zone + this are not examined
  treeDrawM: 35,             // trees further than this from the site are not drawn
  // tree preservation zones (council TPO polygons)
  // street features: pavements, paths and obstructions (post boxes, poles, lamps...)
  obstacleBlockedM: 0.3,     // a post box / pole / lamp this close to (or inside) the footprint = "in the way"
  obstacleNearM: 1.5,        // closer than this = "keep clear" (access, cables, working space)
  obstacleListM: 12,         // street features further than this are not listed
  obstacleDrawM: 25,         // ... and not drawn
  powerLineOverM: 1,         // an overhead line this close to (or over) the work
  powerLineNearM: 5,         // ... and within this: ask the network operator before scaffolding / working at height
  pathRangeM: 15,            // pavements / paths further than this from the work are not examined
  tpoZoneNearM: 3,           // outside a zone but closer than this = "close to" (zone outlines are approximate)
};
