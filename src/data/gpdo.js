/**
 * GPDO 2015 (England) – Schedule 2, Part 1 "Development within the curtilage of a dwellinghouse".
 * The provisions (limits, restrictions and conditions) of each Class this tool screens, as DATA, with the paragraph they come from.
 *
 *   kind     'restriction' (development is not permitted if...), 'limit' (a measured limit), 'condition' (something to comply with)
 *   evidence ids of the checks in permittedDevelopment.js that test this provision (empty = the tool cannot test it from the data it has)
 *   needs    (p, ctx) => fact keys the applicant must supply for this provision to be tested (see FACTS)
 *   types    work types the provision applies to (omitted = every type in the Class)
 *   when     (p) => boolean: the provision only applies to work of this shape (e.g. the two-storey rules only bite on two storeys)
 *
 * References follow the paragraph lettering of the Order as consolidated on legislation.gov.uk – check them against the current text
 * before quoting them in a formal document. The decisions themselves are made in permittedDevelopment.js; this file makes the rule
 * set visible, so a person (or a reviewer) can see which provisions were tested and which were not.
 */
export const SCHEDULE = 'Schedule 2, Part 1, GPDO 2015 (England)';

/**
 * THE NUMBERS the decision code uses (permittedDevelopment.js reads every limit from here, so the data and the decisions cannot drift apart).
 * Distances in metres, areas in m², volumes in m³. Paragraph references are on the provisions in CLASSES below.
 */
export const LIMITS = {
  rearDepthM: { attached: 3, detached: 4 },                 // A.1(f): single-storey rear extension beyond the ORIGINAL rear wall
  rearDepthPriorM: { attached: 6, detached: 8 },            // A.1(g)/A.4: larger home extension, with neighbour consultation
  singleStoreyHeightM: 4,                                   // A.1(f)(ii)
  boundaryDistanceM: 2, eavesNearBoundaryM: 3,              // A.1(i): within 2 m of a boundary the eaves may be at most 3 m
  twoStoreyDepthM: 3, twoStoreyRearBoundaryM: 7,            // A.1(h)
  sideHeightM: 4, sideWidthFraction: 0.5,                   // A.1(j): beside the house: at most 4 m high, at most half the house width
  curtilageFraction: 0.5,                                   // A.1(b), E.1(b)
  porchAreaM2: 3, porchHeightM: 3, porchHighwayM: 2,        // D.1
  dormerVolumeM3: { terraced: 40, other: 50 },              // B.1(d)
  outbuildingHeightM: { pitched: 4, other: 3 }, outbuildingBoundaryM: 2, outbuildingBoundaryHeightM: 2.5, outbuildingEavesM: 2.5, // E.1(e)-(f)
  outbuildingFarAreaM2: 10, outbuildingFarDistanceM: 20,    // E.1(j): on article 2(3) land
};

/** Facts the rules need. `field` = the name of the form field that supplies it; `where: 'profile'` = the property details panel. */
export const FACTS = {
  originalDwelling: { where: 'profile', question: 'Is this the original house – not a home created by converting a shop, office or farm building?' },
  existingExtension: { where: 'profile', question: 'Has the house already been extended? If so, how far does it reach beyond the original back wall?' },
  eavesHeightM: { field: 'eavesHeightM', question: 'How high will the eaves be? (Within 2 m of a boundary they must be 3 m or less.)' },
  distanceToSideBoundaryM: { field: 'distanceToSideBoundaryM', question: 'How close is the work to the side boundary?' },
  distanceToRearBoundaryM: { field: 'distanceToRearBoundaryM', question: 'How far is the work from the rear boundary? (A two-storey extension must be at least 7 m away.)' },
  distanceToBoundaryM: { field: 'distanceToBoundaryM', question: 'How close is the building to the nearest boundary? (Within 2 m it may be no higher than 2.5 m.)' },
  distanceToHighwayM: { field: 'distanceToHighwayM', question: 'How far is the porch from the boundary next to the pavement or road? (It must be at least 2 m.)' },
  additionsAreaM2: { field: 'additionsAreaM2', question: 'What is the total area of all extensions and outbuildings on the plot, including this one and existing ones?' },
  volumeM3: { field: 'volumeM3', question: 'What volume will the dormer add to the roof space, including any earlier roof additions?' },
  prohibitedFeatures: { question: 'Does the work include a balcony, raised platform, chimney, flue or soil pipe, or any change to the roof of the house?' },
};

const ART = 'On land in a conservation area, national park, AONB or World Heritage Site (article 2(3) land) these rights are cut back.';

export const CLASSES = {
  A: {
    part: 1, class: 'A', title: 'Enlargement, improvement or other alteration of a dwellinghouse', workTypes: ['rear_extension', 'side_extension', 'wraparound_extension'],
    developmentType: 'Householder extension',
    provisions: [
      { id: 'dwellinghouse', ref: 'A.1(a)', kind: 'restriction', text: 'Not permitted if the house only became a dwellinghouse through a Part 3 change-of-use right (Classes M, N, P, PA, Q). Flats and maisonettes have no householder rights.', evidence: ['original-dwelling', 'dwelling-origin', 'dwellinghouse', 'jurisdiction', 'not-a-house', 'use-unconfirmed'], needs: () => ['originalDwelling'] },
      { id: 'curtilage', ref: 'A.1(b)', kind: 'limit', text: 'Buildings, enclosures and containers (other than the original house) may cover no more than 50% of the curtilage.', evidence: ['curtilage'], needs: (p) => (p.additionsAreaM2 == null ? ['additionsAreaM2'] : []) },
      { id: 'roof-height', ref: 'A.1(c)–(d)', kind: 'limit', text: 'No higher than the highest part of the existing roof, and the eaves no higher than the existing eaves. (Tested against the roof measured from LiDAR, or the map\'s building height if that is all there is; otherwise not tested.)', evidence: ['existing-height', 'existing-eaves'] },
      { id: 'public-right-of-way', ref: 'Highways Act / TCPA s.257', kind: 'restriction', text: 'A public right of way (footpath, bridleway) cannot be built over; the council must divert it first. Permitted development does not override it.', evidence: ['street', 'public-right-of-way'] },
      { id: 'principal-elevation', ref: 'A.1(e)', kind: 'restriction', text: 'Must not extend beyond the wall forming the principal (front) elevation, or a side wall that fronts a highway.', evidence: ['principal-elevation', 'front-corner', 'front-assumed'] },
      { id: 'rear-depth', ref: 'A.1(f)–(g), A.4', kind: 'limit', text: 'Single-storey rear extensions: up to 3 m beyond the original rear wall (4 m if detached); up to 6 m (8 m if detached) through the prior-approval neighbour-consultation route.', evidence: ['rear-depth', 'existing-extension'], types: ['rear_extension', 'wraparound_extension'], needs: () => ['existingExtension'] },
      { id: 'single-storey-height', ref: 'A.1(f)(ii)', kind: 'limit', text: 'A single-storey rear extension may be no more than 4 m high.', evidence: ['height'], types: ['rear_extension', 'wraparound_extension'], when: (p) => (p.storeys ?? 1) === 1 },
      { id: 'two-storey', ref: 'A.1(h)', kind: 'limit', text: 'More than one storey: no more than 3 m beyond the rear wall and at least 7 m from the rear boundary.', evidence: ['two-storey', 'rear-boundary'], types: ['rear_extension'], when: (p) => (p.storeys ?? 1) > 1, needs: (p) => (p.distanceToRearBoundaryM == null ? ['distanceToRearBoundaryM'] : []) },
      { id: 'boundary-eaves', ref: 'A.1(i)', kind: 'limit', text: 'Within 2 m of a boundary the eaves may be no higher than 3 m.', evidence: ['eaves'], needs: (p) => (p.distanceToSideBoundaryM == null ? ['distanceToSideBoundaryM'] : p.distanceToSideBoundaryM < 2 && p.eavesHeightM == null ? ['eavesHeightM'] : []) },
      { id: 'side-limits', ref: 'A.1(j)', kind: 'limit', text: 'Beside the house: single storey only, no more than 4 m high, and no wider than half the width of the original house.', evidence: ['side', 'side-storeys', 'side-height', 'side-width'], types: ['side_extension', 'wraparound_extension'] },
      { id: 'prohibited-features', ref: 'A.1(k)', kind: 'restriction', text: 'No verandah, balcony or raised platform; no microwave antenna; no chimney, flue or soil pipe; no alteration to the roof of the house.', evidence: ['prohibited-features'], needs: (p) => (['yes', 'no', true, false].includes(p.hasProhibited) ? [] : ['prohibitedFeatures']) },
      { id: 'protected-land', ref: 'A.2', kind: 'restriction', text: `${ART} Side extensions, cladding and rear extensions of more than one storey are not permitted development.`, evidence: ['protected-land', 'side', 'two-storey', 'cladding'] },
      { id: 'article-4', ref: 'Art. 4 / conditions', kind: 'restriction', text: 'The council may have withdrawn these rights with an Article 4 direction, or a planning condition on the house may have removed them.', evidence: ['article4'] },
      { id: 'listed', ref: 'Listed Buildings Act', kind: 'restriction', text: 'A listed building has no householder permitted development; listed building consent is needed.', evidence: ['listed'] },
      { id: 'materials', ref: 'A.3(a)', kind: 'condition', text: 'Materials must be of a similar appearance to those of the existing house.', evidence: ['materials'] },
      { id: 'side-windows', ref: 'A.3(b)', kind: 'condition', text: 'Upper-floor windows in a side wall must be obscure-glazed and non-opening unless more than 1.7 m above the floor.', evidence: [], types: ['rear_extension', 'side_extension'], when: (p) => (p.storeys ?? 1) > 1 },
    ],
  },
  AA: {
    part: 1, class: 'AA', title: 'Enlargement of a dwellinghouse by additional storeys', workTypes: ['additional_storey'], developmentType: 'Upward extension',
    provisions: [
      { id: 'upward', ref: 'AA', kind: 'restriction', text: 'A narrow prior-approval route exists, only for certain houses built between 1 July 1948 and 5 March 2018 and subject to height limits. Otherwise planning permission is needed.', evidence: ['upward'] },
    ],
  },
  B: {
    part: 1, class: 'B', title: 'Additions to the roof of a dwellinghouse', workTypes: ['rear_dormer'], developmentType: 'Loft conversion / roof addition',
    provisions: [
      { id: 'dwellinghouse', ref: 'B.1(a)', kind: 'restriction', text: 'Not permitted if the house only became a dwellinghouse through a Part 3 change-of-use right.', evidence: ['original-dwelling', 'dwelling-origin', 'dwellinghouse', 'jurisdiction', 'not-a-house', 'use-unconfirmed'], needs: () => ['originalDwelling'] },
      { id: 'roof-height', ref: 'B.1(b)', kind: 'limit', text: 'No part may be higher than the highest part of the existing roof.', evidence: ['roof-height', 'existing-height'] },
      { id: 'roof-slope', ref: 'B.1(c)', kind: 'restriction', text: 'No part may extend beyond the plane of a roof slope that forms the front of the house and faces a highway.', evidence: ['roof-slope'] },
      { id: 'roof-volume', ref: 'B.1(d)', kind: 'limit', text: 'The roof space may grow by no more than 40 m³ (terraced house) or 50 m³ (any other house), counting earlier roof additions.', evidence: ['roof-volume'], needs: (p) => (p.volumeM3 == null ? ['volumeM3'] : []) },
      { id: 'roof-features', ref: 'B.1(e)', kind: 'restriction', text: 'No verandah, balcony or raised platform; no new, altered or replaced chimney, flue or soil pipe.', evidence: ['roof-balcony', 'roof-features'] },
      { id: 'roof-protected', ref: 'B.1(f)', kind: 'restriction', text: 'Not permitted on article 2(3) land (conservation area, national park, AONB, World Heritage Site).', evidence: ['roof-protected'] },
      { id: 'article-4', ref: 'Art. 4 / conditions', kind: 'restriction', text: 'The council may have withdrawn these rights with an Article 4 direction, or a planning condition may have removed them.', evidence: ['article4'] },
      { id: 'listed', ref: 'Listed Buildings Act', kind: 'restriction', text: 'A listed building has no householder permitted development; listed building consent is needed.', evidence: ['listed'] },
      { id: 'roof-conditions', ref: 'B.2', kind: 'condition', text: 'Similar materials; set back at least 0.2 m from the original eaves where practicable; side windows obscure-glazed and non-opening unless more than 1.7 m above the floor.', evidence: [] },
    ],
  },
  D: {
    part: 1, class: 'D', title: 'Porches', workTypes: ['front_porch'], developmentType: 'Front porch',
    provisions: [
      { id: 'porch-space', ref: 'D.1(c)', kind: 'restriction', text: 'No part of the porch may be within 2 m of a boundary of the curtilage that fronts a highway – so it needs private land of its own in front of the door.', evidence: ['porch-no-space', 'porch-highway'], needs: (p, ctx) => (p.distanceToHighwayM == null && !ctx.frontSpaceKnown ? ['distanceToHighwayM'] : []) },
      { id: 'porch-area', ref: 'D.1(a)', kind: 'limit', text: 'Ground area (measured externally) no more than 3 m².', evidence: ['porch-area'] },
      { id: 'porch-height', ref: 'D.1(b)', kind: 'limit', text: 'No part more than 3 m above ground level.', evidence: ['porch-height'] },
      { id: 'article-4', ref: 'Art. 4 / conditions', kind: 'restriction', text: 'An Article 4 direction or planning condition may have removed these rights.', evidence: ['article4'] },
      { id: 'listed', ref: 'Listed Buildings Act', kind: 'restriction', text: 'A listed building has no householder permitted development.', evidence: ['listed'] },
    ],
  },
  E: {
    part: 1, class: 'E', title: 'Buildings etc. incidental to the enjoyment of a dwellinghouse', workTypes: ['outbuilding'], developmentType: 'Garden outbuilding',
    provisions: [
      { id: 'incidental', ref: 'E.3', kind: 'restriction', text: 'Must be used for purposes incidental to the house (office, gym, store). A separate home or sleeping accommodation is not.', evidence: ['incidental'] },
      { id: 'curtilage', ref: 'E.1(b)', kind: 'limit', text: 'Buildings, enclosures and containers (other than the original house) may cover no more than 50% of the curtilage.', evidence: ['curtilage'], needs: (p) => (p.additionsAreaM2 == null ? ['additionsAreaM2'] : []) },
      { id: 'forward', ref: 'E.1(c)', kind: 'restriction', text: 'No part may be in front of a wall forming the principal elevation of the house.', evidence: ['location'] },
      { id: 'out-height', ref: 'E.1(e)', kind: 'limit', text: 'Overall height no more than 4 m (dual-pitched roof) or 3 m (any other roof); 2.5 m if within 2 m of a boundary.', evidence: ['out-height', 'out-boundary'], needs: (p) => (p.distanceToBoundaryM == null ? ['distanceToBoundaryM'] : []) },
      { id: 'out-eaves', ref: 'E.1(f)', kind: 'limit', text: 'Eaves no higher than 2.5 m.', evidence: ['out-eaves'] },
      { id: 'platforms', ref: 'E.1(g)', kind: 'restriction', text: 'No verandah, balcony or raised platform of any kind.', evidence: ['out-platforms'] },
      { id: 'out-20m', ref: 'E.1(j)', kind: 'restriction', text: 'On article 2(3) land, buildings more than 20 m from the house may cover no more than 10 m².', evidence: ['out-20m'] },
      { id: 'article-4', ref: 'Art. 4 / conditions', kind: 'restriction', text: 'An Article 4 direction or planning condition may have removed these rights.', evidence: ['article4'] },
      { id: 'listed', ref: 'Listed Buildings Act', kind: 'restriction', text: 'Within the curtilage of a listed building, outbuildings need listed building consent.', evidence: ['listed'] },
    ],
  },
};

export const classForType = (type) => Object.values(CLASSES).find((c) => c.workTypes.includes(type)) ?? null;
