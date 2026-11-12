/**
 * Numbers the interior checks use, each with where it comes from. They are GUIDANCE used for screening a layout,
 * not a Building Regulations approval: confirm the current wording before quoting any of them formally.
 *
 *  ndss     Nationally Described Space Standard (DCLG, March 2015). Only binding where the council has adopted it in
 *           its Local Plan, but it is the usual yardstick for "is this bedroom big enough".
 *  adK      Approved Document K (stairs): headroom over a stair.
 *  adB      Approved Document B (fire safety): escape from upper floors, loft conversions.
 *  adF      Approved Document F (ventilation): purge ventilation, as a share of the room's floor area.
 *  rule     A widely used rule of thumb, not a published limit. Said so wherever it is shown.
 */
export const STD = {
  // heights used to BUILD the indicative model (typical UK house), all in metres
  build: {
    ceilingM: 2.4,          // floor to ceiling
    slabM: 0.25,            // floor + ceiling build-up between two storeys
    roofBuildupM: 0.35,     // flat-roof build-up above an extension's ceiling
    defaultPitchDeg: 35,    // used when no LiDAR roof height is available
    hallWidthM: 0.95,
    wallThicknessM: 0.22,
  },
  ndss: {
    source: 'Nationally Described Space Standard (DCLG, 2015)',
    singleBedroom: { areaM2: 7.5, widthM: 2.15 },
    doubleBedroom: { areaM2: 11.5, widthM: 2.55 },
    ceilingM: 2.3,          // at least 75% of the floor area
    ceilingShare: 0.75,
    minHeadroomCountM: 1.5, // floor below a slope lower than this is not counted as floor area
  },
  adK: { source: 'Approved Document K (private stairs)', stairHeadroomM: 2.0, loftStairHeadroomCentreM: 1.9, maxRiserM: 0.22, minGoingM: 0.22, maxPitchDeg: 42, usualMinWidthM: 0.8 },
  adB: {
    source: 'Approved Document B (dwellings)',
    escapeWindow: { openableAreaM2: 0.33, minHeightM: 0.45, minWidthM: 0.45, maxSillM: 1.1 },
    protectedStairAboveM: 4.5,   // a floor higher than this above ground normally needs a protected stairway
  },
  adF: { source: 'Approved Document F', purgeVentilationShare: 1 / 20 },
  rule: {
    loftUsableHeadroomM: 2.2,    // the "about 2.2 m" most loft-conversion guides use for a usable room
  },
};

export const ROOM_TYPES = {
  hall: { label: 'Hall', habitable: false },
  landing: { label: 'Landing', habitable: false },
  living: { label: 'Living room', habitable: true },
  dining: { label: 'Dining room', habitable: true },
  kitchen: { label: 'Kitchen', habitable: true },
  kitchen_diner: { label: 'Kitchen / dining', habitable: true },
  bedroom: { label: 'Bedroom', habitable: true },
  study: { label: 'Study', habitable: true },
  bathroom: { label: 'Bathroom', habitable: false },
  utility: { label: 'Utility', habitable: false },
  porch: { label: 'Porch', habitable: false },
  storage: { label: 'Storage', habitable: false },
  garage: { label: 'Garage', habitable: false },
  garden_room: { label: 'Garden room', habitable: false },
  other: { label: 'Other', habitable: false },
};
