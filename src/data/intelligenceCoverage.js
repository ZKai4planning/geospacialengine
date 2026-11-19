/**
 * WHAT THE ENGINE DOES TODAY for each of the 228 register checks (src/data/intelligenceRegister.js).
 * Audited against the source code of this project, not against the product brief.
 *
 *   have    the engine produces a result for this check from real data or real logic (source quality may still be below what the register asks for - see `note`)
 *   partial some real data or logic contributes, but the check cannot be answered in full (proxy data, one council only, one aspect only, optional switch)
 *   missing nothing in the engine produces this result. `note` says what data/source it needs. (A fixed reminder with no data behind it counts as missing.)
 *
 * `needs` = runtime capabilities the check depends on (see CAPABILITIES in services/intelligenceRegister.js): a check can be BUILT but switched OFF.
 * Row: [id, status, needs, modules, note]
 *
 * THIS FILE IS THE BASELINE AUDIT (66 have / 67 partial / 95 missing) from before src/register/ existed. The checks src/register/checks.js implements override their row at
 * runtime (see COVERAGE_OVERRIDES), so the coverage the API reports follows the code; change a check's behaviour there, not here. Rows still marked 'missing' below are history.
 */
const H = 'have', P = 'partial', N = 'missing';

export const COVERAGE_ROWS = [
  // 01 Property Identity
  ['PI-01-01', H, ['db|osplaces'], 'providers/openUprn, osPlaces; services/uprnMatcher', 'UPRN from OS Places, or nearest OS Open UPRN point (high/low confidence + candidate list).'],
  ['PI-01-02', H, [], 'providers/addressModel, osmAddress, osPlaces; utils/postcode', 'Address model with postcode validation. No alias / postal-record comparison.'],
  ['PI-01-03', P, ['osplaces'], 'providers/addressModel; utils/bng, bngForward', 'Easting/northing only when OS Places is used (null for OSM addresses). WGS84 to BNG converter exists but is not stored on the record.'],
  ['PI-01-04', P, [], 'utils/geo (ringCentroid); services/siteFacts', 'Centroids are computed inside the geometry code but never stored or reported as a result.'],
  ['PI-01-05', P, ['db'], 'providers/titleBoundary, inspireLocal', 'Title polygon reference is captured; no title number, no UPRN-to-title cross-reference, split titles only skipped.'],
  ['PI-01-06', H, ['osm'], 'providers/osmBuildings, nominatimFootprint', 'Footprint from OpenStreetMap, not licensed OS mapping; no survey reconciliation.'],
  ['PI-01-07', P, [], 'providers/postcodesIo; services/applicationService (findAuthority)', 'Council taken from the postcode - the app itself says it is not the exact boundary line. No spatial intersection with LPA polygons.'],
  ['PI-01-08', P, [], 'providers/postcodesIo', 'Ward is returned by the postcode lookup but is not stored on the application or shown.'],
  ['PI-01-09', H, [], 'providers/classification; services/useGate; ppdSignals', 'Form + use from OS AddressBase codes / OSM tags, cross-checked against EPC and Land Registry type.'],
  ['PI-01-10', P, ['db'], 'services/uprnMatcher', 'UPRN match confidence only. No combined UPRN + title + polygon + address score.'],

  // 02 Title & Legal Restrictions
  ['PI-02-01', N, [], '', 'Needs HM Land Registry official copy (register) - paid service, not open data.'],
  ['PI-02-02', P, [], 'services/ppdSignals; providers/landRegistry', 'Tenure inferred from the last recorded sale (Price Paid Data), not the register.'],
  ['PI-02-03', H, ['db|planningdata'], 'services/siteChecks; services/siteExtras (boundaryOverhang); utils/plotEstimate', 'Title polygon overlaid on building and proposal; overhang flagged. Title is indicative, not a surveyed boundary.'],
  ['PI-02-04', P, ['db|planningdata'], 'providers/titleBoundary', 'Boundary reference captured. No edition date, scale or register correspondence.'],
  ['PI-02-05', N, [], '', 'Needs charges register + covenant deeds (HMLR documents, conveyancer).'],
  ['PI-02-06', N, [], '', 'Needs deeds / register entries granting or reserving easements.'],
  ['PI-02-07', N, [], '', 'Needs private rights of passage from title/deeds. (Public rights of way are only drawn as paths, see PI-11-09.)'],
  ['PI-02-08', N, [], '', 'Needs transfer/reservation clauses and an access plan.'],
  ['PI-02-09', N, [], '', 'Needs charges register / rentcharge deed.'],
  ['PI-02-10', N, [], '', 'Needs restriction entries from the register.'],
  ['PI-02-11', N, [], '', 'Needs possession evidence and legal review; must never be decided automatically.'],
  ['PI-02-12', N, [], '', 'Needs filed historic conveyances and plans.'],
  ['PI-02-13', N, [], '', 'Needs overage/uplift clauses from transfer documents.'],
  ['PI-02-14', N, [], '', 'Needs service-media rights from deeds / utility easements.'],
  ['PI-02-15', N, [], '', 'Needs client declarations and conveyancer enquiries.'],

  // 03 Physical Property & Land
  ['PI-03-01', H, ['db|planningdata'], 'utils/plotEstimate; services/propertyService (buildProfile)', 'Registered title area when matched, otherwise an estimate (flagged, never used for boundary numbers).'],
  ['PI-03-02', H, ['osm'], 'providers/osmBuildings; services/propertyService', 'Footprint area from the building outline.'],
  ['PI-03-03', H, ['lidar'], 'providers/lidarHeights; services/existingRoof, roofHeight', 'Ridge and eaves from EA LiDAR (+-0.5 m), OSM height tag as fallback.'],
  ['PI-03-04', H, ['osm|lidar'], 'providers/osmBuildings; providers/lidarHeights', 'Roof shape from OSM tags / LiDAR; pitch from LiDAR.'],
  ['PI-03-05', P, ['lidar'], 'providers/lidarHeights (groundFallM)', 'Ground fall under the building only, not site gradient.'],
  ['PI-03-06', P, ['lidar'], 'providers/lidarHeights; services/siteExtras', 'LiDAR DTM ground fall at the building; no site level grid or datum.'],
  ['PI-03-07', P, ['db|planningdata'], 'services/siteFacts (boundaryDistances)', 'Distance from the proposal to the rear boundary; not a stand-alone garden depth for the house.'],
  ['PI-03-08', P, ['osm'], 'services/rules/wallSafety, neighbours; siteFacts', 'Gap to the neighbour / side boundary near the proposal; no side-passage width measurement as such.'],
  ['PI-03-09', H, ['osm'], 'utils/osmTags (barrierFromElement); services/rules/wallSafety', 'Fences, walls, hedges, retaining walls from OSM (coverage is patchy).'],
  ['PI-03-10', H, ['osm'], 'services/rules/neighbours; providers/osmBuildings', 'Neighbouring buildings within 40 m: distance, overlap, party-wall adjoining.'],
  ['PI-03-11', H, ['osm'], 'services/mapService (buildFrame); profile.frontBearingDeg', 'Front bearing from nearest road / street-photo camera, user override.'],
  ['PI-03-12', H, ['osm'], 'services/publicStrip; services/rules/publicLand, roads', 'Pavement / verge between plot and carriageway; public-land and road checks.'],
  ['PI-03-13', P, ['osm'], 'services/dashboard; services/rules/roads', 'Plot frontage and road width only; no vehicular access width.'],
  ['PI-03-14', P, [], 'services/sources (buildSources)', 'Per-item provenance (measured / official / mapped / estimated / you / assumed). No completeness score.'],

  // 04 Planning History
  ['PI-04-01', H, ['planit'], 'providers/planit; services/planningHistory', 'PlanIt search at this address and within 150 m. OFF by default (PLANNING_HISTORY_ENABLED).'],
  ['PI-04-02', H, ['planit'], 'providers/planit (outcome); services/planningHistory', 'Approved applications, classified by kind of work.'],
  ['PI-04-03', H, ['planit'], 'providers/planit; services/planningHistory (history-refused)', 'Refusals of similar work flagged.'],
  ['PI-04-04', N, [], '', 'PlanIt has no decision notices or discharge records. Needs council register / decision notices.'],
  ['PI-04-05', N, [], '', 'Needs council enforcement register (no open national dataset).'],
  ['PI-04-06', H, ['planit'], 'providers/planit (lawful); services/planningHistory (history-lawful)', 'Certificates of lawfulness detected from description/type.'],
  ['PI-04-07', H, ['planit'], 'providers/planit (prior); services/planningHistory', 'Prior-approval applications detected from description/type.'],
  ['PI-04-08', N, [], '', 'Needs Planning Inspectorate appeal decisions - not queried.'],
  ['PI-04-09', P, ['planit'], 'services/planningHistory (history-flats, history-new-dwelling)', 'Infers flats/HMO/new-dwelling past use from application descriptions only.'],
  ['PI-04-10', N, [], '', 'Needs decision notices / legal agreement register.'],
  ['PI-04-11', N, [], '', 'Needs council Section 106 register / agreements.'],
  ['PI-04-12', P, [], 'services/rules/regulatory (cil)', 'Warns when new floor area is 100 m2 or more. No charging-schedule lookup or liability amount.'],
  ['PI-04-13', N, [], '', 'Needs commencement notices / building control start records.'],
  ['PI-04-14', N, [], '', 'Needs discharge evidence and condition wording (decision notices).'],
  ['PI-04-15', N, [], '', 'Needs approved plans and comparison with the current model.'],
  ['PI-04-16', N, [], '', 'No completeness measure; PlanIt coverage varies by council.'],

  // 05 GPDO & Permitted Development
  ['PI-05-01', H, [], 'services/permittedDevelopment, gpdoEngine, useGate', 'Householder rights gate: house vs flat, use, England only, Part 3 conversions.'],
  ['PI-05-02', H, ['planningdata'], 'services/constraintsService; providers/constraintAreas; services/rules/areas', 'Article 4 direction areas (point check + outline); rights removed and document link when recorded.'],
  ['PI-05-03', H, [], 'data/gpdo (Classes A, AA, B, D, E); services/projectClassifier', 'Work type mapped to GPDO class.'],
  ['PI-05-04', H, [], 'services/permittedDevelopment (rear-depth)', '3 m / 4 m limits, 6 m / 8 m prior-approval limits, existing extension counted.'],
  ['PI-05-05', H, [], 'services/permittedDevelopment; data/gpdo LIMITS', 'Single-storey height limits.'],
  ['PI-05-06', H, ['lidar'], 'services/permittedDevelopment; existingRoof', 'Eaves limits (3 m within 2 m of boundary; not above existing eaves).'],
  ['PI-05-07', H, ['db|planningdata'], 'services/siteFacts; permittedDevelopment', 'Distance to rear/side boundary measured from a registered title (never from an estimated outline).'],
  ['PI-05-08', H, [], 'services/permittedDevelopment; profile.originalDwelling', 'Original-dwelling question; EPC/history hints.'],
  ['PI-05-09', H, ['epc|planit'], 'services/permittedDevelopment; profile.existingExtension; epc.extensionCount', 'Existing extension depth counted towards the limit.'],
  ['PI-05-10', H, [], 'services/permittedDevelopment', 'Side extension: single storey, half width, Article 2(3) land.'],
  ['PI-05-11', H, [], 'data/gpdo Class B; services/fortyFive', 'Dormer volume limits, no higher than ridge, 20 cm set-back, prohibited features.'],
  ['PI-05-12', P, [], 'services/permittedDevelopment (materials)', 'States the similar-appearance condition; cannot test materials.'],
  ['PI-05-13', H, [], 'services/frontSpace; services/permittedDevelopment', 'Extension beyond the principal elevation / front wall.'],
  ['PI-05-14', H, ['db|planningdata'], 'services/siteFacts (curtilageCover)', '50% curtilage coverage from the registered plot and outbuildings.'],
  ['PI-05-15', H, ['planningdata'], 'services/constraintsService (article23Land)', 'Conservation area, National Park, AONB, World Heritage Site.'],
  ['PI-05-16', H, [], 'services/permittedDevelopment', 'Larger home extension prior-approval route.'],
  ['PI-05-17', H, [], 'services/permittedDevelopment', 'Neighbour-consultation route attached to the prior-approval verdict.'],
  ['PI-05-18', H, [], 'services/permittedDevelopment; summary; goldenRunner', 'Verdict, label, confidence, summary and caveats; regression-tested by the golden cases (golden/cases).'],

  // 06 Local Planning Policy
  ['PI-06-01', P, ['planningdata'], 'services/constraintsService', 'Green Belt only. No local-plan allocations / designations.'],
  ['PI-06-02', P, [], 'data/lpaRules; services/lpaPolicy', 'Policy references for Waltham Forest only.'],
  ['PI-06-03', P, [], 'data/lpaRules', 'One SPD (Waltham Forest 2010).'],
  ['PI-06-04', P, [], 'data/lpaRules', 'Rear depth, side set-back guidance for one council.'],
  ['PI-06-05', P, [], 'services/lpaPolicy; services/rules/fortyFive', 'Garden space per habitable room and 45-degree test (one council).'],
  ['PI-06-06', P, [], 'services/rules/fortyFive', '45-degree test against a neighbour window marked by the applicant. No sun-path study.'],
  ['PI-06-07', N, [], '', 'Only a text note about side windows for one council. Needs window positions and distance rules.'],
  ['PI-06-08', N, [], '', 'Needs local-plan density policy and site capacity logic.'],
  ['PI-06-09', N, [], '', 'Needs LPA parking standards and layout.'],
  ['PI-06-10', N, [], '', 'Needs LPA cycle parking standards.'],
  ['PI-06-11', N, [], '', 'Needs LPA SuDS policy and local flood data.'],
  ['PI-06-12', P, [], 'data/lpaRules (retrievedAt, caution)', 'Retrieval date and currency caution per council entry; no policy review calendar.'],

  // 07 Heritage
  ['PI-07-01', H, ['planningdata'], 'services/constraintsService; providers/constraintAreas', 'Listed building outline, grade where recorded.'],
  ['PI-07-02', H, ['planningdata'], 'services/constraintsService; providers/constraintAreas', 'Conservation area point check + outline.'],
  ['PI-07-03', H, ['planningdata'], 'services/constraintsService; providers/constraintAreas', 'Scheduled monument.'],
  ['PI-07-04', H, ['planningdata'], 'providers/constraintAreas (park-and-garden, battlefield)', 'Registered parks/gardens and battlefields within 250 m.'],
  ['PI-07-05', N, [], '', 'Needs council local list data (not national).'],
  ['PI-07-06', N, [], '', 'Needs Historic Environment Record / APA boundaries.'],
  ['PI-07-07', P, ['planningdata'], 'providers/constraintAreas (250 m search)', 'Designated assets near the site are found; no setting assessment.'],
  ['PI-07-08', N, [], '', 'Needs protected view corridors (London View Management Framework, local).'],
  ['PI-07-09', P, ['planningdata'], 'services/rules/areas', 'Distance to designated areas within 250 m; no defined buffer rule.'],
  ['PI-07-10', N, [], '', 'No heritage-statement trigger logic.'],

  // 08 Flooding & Drainage
  ['PI-08-01', H, ['planningdata'], 'services/constraintsService; providers/constraintAreas', 'Flood zone from planning.data.gov.uk flood-risk-zone.'],
  ['PI-08-02', N, [], '', 'Needs EA Risk of Flooding from Surface Water.'],
  ['PI-08-03', N, [], '', 'Needs EA Recorded Flood Outlines / Historic Flood Map.'],
  ['PI-08-04', N, [], '', 'Needs groundwater flood susceptibility (BGS).'],
  ['PI-08-05', N, [], '', 'Needs EA reservoir flood extents.'],
  ['PI-08-06', N, [], '', 'Needs EA flood-defence asset data.'],
  ['PI-08-07', N, [], '', 'Needs EA main-river network.'],
  ['PI-08-08', N, [], '', 'Needs ordinary-watercourse data (LLFA / OS).'],
  ['PI-08-09', N, [], '', 'Needs water-company capacity data.'],
  ['PI-08-10', N, [], '', 'Fixed reminder only ("not checked"). Needs the water company sewer records.'],
  ['PI-08-11', N, [], '', 'Needs soil permeability, groundwater depth and site layout.'],
  ['PI-08-12', P, ['planningdata'], 'services/constraintsService (impact text)', 'Says an FRA may be needed when a flood zone applies; no zone-3 / area / change-of-use trigger logic.'],
  ['PI-08-13', N, [], '', 'No sequential-test logic.'],
  ['PI-08-14', N, [], '', 'Needs drainage easements from sewer records / deeds.'],
  ['PI-08-15', N, [], '', 'Needs EA climate-change allowances for the catchment.'],

  // 09 Mining & Geology
  ['PI-09-01', H, ['coal'], 'providers/coalRisk; services/siteExtras (coalTile)', 'Coal reporting area. OFF by default (COAL_RISK_ENABLED) and needs the imported dataset.'],
  ['PI-09-02', H, ['coal'], 'providers/coalRisk; db/schema-coal.sql; scripts/import-coal', 'Development High Risk Area inside / near. OFF by default.'],
  ['PI-09-03', H, ['coal'], 'providers/coalRisk (details.mineEntry)', 'Recorded mine entries with type and distance. OFF by default.'],
  ['PI-09-04', H, ['coal'], 'providers/coalRisk (mineEntryWithinM)', 'Distance to nearest mine entry. OFF by default.'],
  ['PI-09-05', P, ['coal'], 'providers/coalRisk (pastWorkings, probableWorkings)', 'Coal workings only; no other mineral workings.'],
  ['PI-09-06', P, ['coal'], 'providers/coalRisk', 'Shallow coal workings, fissures, outcrop; no risk scoring.'],
  ['PI-09-07', N, [], '', 'Placeholder tile only ("Ground conditions and subsidence"). Needs BGS GeoSure / shrink-swell data.'],
  ['PI-09-08', N, [], '', 'Needs BGS geological fault data.'],
  ['PI-09-09', N, [], '', 'Needs BGS landslide susceptibility.'],
  ['PI-09-10', N, [], '', 'Needs UKHSA/BGS radon potential.'],
  ['PI-09-11', P, ['landfill'], 'providers/landfill; services/siteExtras (landfillTile)', 'Historic landfill as the proxy for made ground. OFF by default.'],
  ['PI-09-12', P, ['landfill'], 'providers/landfill', 'Landfill proximity as indicator only. No contaminated-land data.'],
  ['PI-09-13', H, ['landfill'], 'providers/landfill', 'Inside / within distance of a recorded historic landfill. OFF by default (licence condition).'],
  ['PI-09-14', P, ['landfill|coal'], 'services/siteExtras', 'Advises a ground investigation when landfill or coal risk applies; no general trigger.'],
  ['PI-09-15', N, [], '', 'Needs shrink-swell / ground data and tree proximity.'],
  ['PI-09-16', H, ['coal'], 'services/siteExtras (coalTile)', 'States when a Mining Report is advisable. OFF by default.'],

  // 10 Electricity & Utilities
  ['PI-10-01', H, ['osm'], 'utils/osmTags (powerLineFromElement); services/dashboard (cables)', 'Overhead lines from OSM (high-voltage and minor lines), distance to proposal.'],
  ['PI-10-02', N, [], '', 'Placeholder tile only. Needs DNO / utility record search.'],
  ['PI-10-03', N, [], '', 'OSM power=substation is not queried. Needs DNO asset data.'],
  ['PI-10-04', N, [], '', 'Needs DNO easement / wayleave records.'],
  ['PI-10-05', P, ['osm'], 'utils/osmTags (poles, pylons); providers/osmBuildings', 'Poles and pylons from OSM only; no DNO asset register.'],
  ['PI-10-06', N, [], '', 'No clearance distance logic for overhead lines.'],
  ['PI-10-07', P, ['osm'], 'utils/osmTags (power=line, voltage)', 'Overhead HV only; underground HV not covered.'],
  ['PI-10-08', P, ['osm'], 'utils/osmTags (power=minor_line)', 'Overhead LV only; underground LV not covered.'],
  ['PI-10-09', N, [], '', 'Needs gas network record search.'],
  ['PI-10-10', N, [], '', 'Needs water-company mains records.'],
  ['PI-10-11', N, [], '', 'Needs water-company sewer records.'],
  ['PI-10-12', N, [], '', 'Needs water-company sewer records.'],
  ['PI-10-13', N, [], '', 'Needs Openreach / telecoms duct records.'],
  ['PI-10-14', N, [], '', 'Needs Ofcom / broadband availability data.'],
  ['PI-10-15', N, [], '', 'Needs heat network zoning / operator data.'],
  ['PI-10-16', N, [], '', 'Needs utility wayleave agreements.'],
  ['PI-10-17', N, [], '', 'Needs survey or utility records.'],
  ['PI-10-18', P, [], 'services/dashboard (PLACEHOLDERS); rules/regulatory', 'Always says a utility record search / sewer check is needed; not conditional on findings.'],

  // 11 Street Furniture & Highways
  ['PI-11-01', H, ['osm'], 'utils/osmTags; services/rules/streetFeatures', 'Post boxes from OSM, blocking test against the proposal.'],
  ['PI-11-02', H, ['osm'], 'utils/osmTags; services/rules/streetFeatures', 'Street lamps from OSM.'],
  ['PI-11-03', N, [], '', 'highway=traffic_signals is not queried.'],
  ['PI-11-04', H, ['osm'], 'utils/osmTags', 'Street cabinets from OSM.'],
  ['PI-11-05', H, ['osm'], 'utils/osmTags', 'Bus stops within 40 m from OSM.'],
  ['PI-11-06', P, ['osm'], 'utils/osmTags; services/rules/regulatory (classified-road)', 'Class inferred from OSM highway tag ("probably classified"); no A/B/C register.'],
  ['PI-11-07', P, ['osm'], 'services/publicStrip', 'Public strip between plot and carriageway estimated; no highway authority boundary.'],
  ['PI-11-08', P, ['osm'], 'utils/osmTags (dropped_kerb); rules/regulatory', 'Dropped kerbs shown; classified-road consent warning. No crossover assessment.'],
  ['PI-11-09', H, ['osm'], 'utils/osmTags (pathFromElement); services/rules/streetFeatures', 'Pavements, paths, rights-of-way designations, obstacles blocking footway.'],
  ['PI-11-10', N, [], '', 'No visibility-splay geometry.'],
  ['PI-11-11', N, [], '', 'Needs traffic regulation order / CPZ data.'],
  ['PI-11-12', N, [], '', 'Needs highway authority adoption records.'],
  ['PI-11-13', N, [], '', 'Needs street-works / road-opening restrictions.'],
  ['PI-11-14', P, [], 'services/rules/regulatory (classified-road)', 'Mentions construction traffic next to classified roads; no access assessment.'],

  // 12 Trees & Ecology
  ['PI-12-01', H, ['planningdata'], 'providers/protectedTrees; services/rules/tpoZones', 'TPO zones and individual protected trees (council coverage varies).'],
  ['PI-12-02', N, [], '', 'Conservation-area flag exists, but no tree-notice logic.'],
  ['PI-12-03', H, ['osm'], 'utils/trees; services/rules/trees', 'Root zone radius per tree; distance to proposal.'],
  ['PI-12-04', H, ['osm'], 'providers/osmBuildings; services/rules/trees', 'Trees within 60 m from OSM (incomplete mapping).'],
  ['PI-12-05', H, ['planningdata'], 'providers/constraintAreas (ancient-woodland)', 'Ancient woodland within 250 m.'],
  ['PI-12-06', N, [], '', 'Needs protected-species records / habitat data.'],
  ['PI-12-07', N, [], '', 'Needs bat records and roof/habitat survey.'],
  ['PI-12-08', N, [], '', 'Needs nesting records / survey.'],
  ['PI-12-09', N, [], '', 'No BNG exemption/applicability logic.'],
  ['PI-12-10', P, ['planningdata'], 'services/constraintsService (sssi)', 'SSSI only; no local nature reserves or corridors.'],
  ['PI-12-11', H, ['planningdata'], 'services/constraintsService (greenBelt)', 'Green Belt flag with impact note.'],
  ['PI-12-12', H, ['planningdata'], 'services/constraintsService', 'National Park, AONB, World Heritage Site.'],
  ['PI-12-13', N, [], '', 'No ecology-survey trigger logic.'],

  // 13 Environmental Hazards
  ['PI-13-01', N, [], '', 'Needs AQMA boundaries (DEFRA / local).'],
  ['PI-13-02', N, [], '', 'Needs DEFRA strategic noise maps.'],
  ['PI-13-03', N, [], '', 'Needs council contaminated-land register.'],
  ['PI-13-04', N, [], '', 'Needs historic OS mapping / industrial land-use records.'],
  ['PI-13-05', N, [], '', 'Needs HSE COMAH / hazardous installations data.'],
  ['PI-13-06', P, ['landfill'], 'providers/landfill', 'Historic landfill only; no permitted waste sites.'],
  ['PI-13-07', P, ['landfill'], 'services/siteExtras (landfillTile)', 'Notes landfill gas control records; no ground-gas assessment.'],
  ['PI-13-08', N, [], '', 'No asbestos-survey trigger (needs building age/use).'],
  ['PI-13-09', N, [], '', 'Needs CPRE night-light data.'],
  ['PI-13-10', N, [], '', 'Needs urban heat-island / climate data.'],
  ['PI-13-11', N, [], '', 'Needs EA permit registers.'],

  // 14 Building Intelligence
  ['PI-14-01', H, [], 'services/interior (index, schema); services/sources', 'Interior flagged "typical layout" vs "drawn by you" with source.'],
  ['PI-14-02', P, ['epc'], 'providers/epc (floorAreaM2); propertyService', 'EPC floor area; no measured GIA.'],
  ['PI-14-03', H, [], 'services/interior/layout, geometry', 'Room areas and widths from the model / applicant-drawn plan.'],
  ['PI-14-04', N, [], '', 'No structural wall classification. Needs survey / structural engineer.'],
  ['PI-14-05', P, ['lidar'], 'services/existingRoof; interior/layout', 'Roof shape and pitch from LiDAR; no structural roof form.'],
  ['PI-14-06', H, [], 'services/interior/features (buildStairs)', 'Stair position/side modelled; headroom checks.'],
  ['PI-14-07', N, [], '', 'No compartmentation model.'],
  ['PI-14-08', P, [], 'services/interior/checks (fire-protected-stair, escape-window)', 'Advisory checks for new upper-floor rooms only.'],
  ['PI-14-09', P, ['epc'], 'providers/epc (rating)', 'EPC band only; no thermal model.'],
  ['PI-14-10', N, [], '', 'No MEP data or routing.'],
  ['PI-14-11', N, [], '', 'Needs a condition survey.'],
  ['PI-14-12', P, [], 'services/interior/checks', 'Guidance checks (NDSS, Approved Docs) on NEW rooms; no overall model quality gate.'],

  // 15 Licensing & Lawful Use
  ['PI-15-01', P, [], 'providers/classification; services/useGate', 'Residential / non-residential / unknown; no use-class designation.'],
  ['PI-15-02', N, [], '', 'Needs council HMO licensing areas.'],
  ['PI-15-03', N, [], '', 'Needs additional-licensing scheme boundaries.'],
  ['PI-15-04', N, [], '', 'Needs selective-licensing scheme boundaries.'],
  ['PI-15-05', P, ['planningdata'], 'providers/constraintAreas (article-4-direction-area)', 'Generic Article 4; does not say whether it removes the C3 to C4 HMO right.'],
  ['PI-15-06', P, [], 'data/interiorStandards (NDSS)', 'Space standards for new bedrooms; no HMO occupancy limits.'],
  ['PI-15-07', P, [], 'services/interior/checks', 'NDSS single/double bedroom sizes for new rooms; not HMO room minimums.'],
  ['PI-15-08', P, [], 'services/lpaPolicy', 'Garden space per habitable room for one council.'],
  ['PI-15-09', P, ['planit'], 'services/planningHistory (history-lawful); ppdSignals', 'Lawful-development certificates and sale type; no use evidence file.'],
  ['PI-15-10', N, [], '', 'No licensing conclusion without the scheme data above.'],

  // 16 Development Context
  ['PI-16-01', H, ['planit'], 'services/planningHistory (precedent)', 'Similar applications within 150 m over 10 years with approval rate.'],
  ['PI-16-02', P, ['osm'], 'services/rules/neighbours, streetFeatures', 'Neighbours and street obstacles around the site; no wider construction constraints.'],
  ['PI-16-03', N, [], '', 'Needs infrastructure pipeline data (HS2, NSIPs, council schemes).'],
  ['PI-16-04', P, ['osm'], 'utils/osmTags (bus stops)', 'Bus stops within 40 m only; no PTAL / station distances.'],
  ['PI-16-05', H, [], 'providers/landRegistry; services/valueEstimate', 'Recorded sales and an indicative value uplift.'],
  ['PI-16-06', N, [], '', 'No EIA screening / environmental context.'],
  ['PI-16-07', P, [], 'services/whatIf; frontSpace; siteFacts', 'What-if limits for a given work type; no site-wide opportunity envelope.'],
  ['PI-16-08', P, [], 'services/whatIf; services/workTypes', 'Seven work types plus a drawn shape, and slider what-if; no generated alternatives.'],
  ['PI-16-09', P, [], 'services/rules/regulatory, wallSafety', 'Party wall, fire boundary, building-regs reminders; no buildability assessment.'],
  ['PI-16-10', P, [], 'services/engineTrace; summary', 'Engine trace and checks list per application; no scored risk register.'],

  // 17 Evidence & Readiness
  ['PI-17-01', H, [], 'services/sources (buildSources)', 'Topic-by-topic provenance table.'],
  ['PI-17-02', P, [], 'data/lpaRules (retrievedAt); planit', 'Only some sources carry a date; no publication date per dataset.'],
  ['PI-17-03', P, ['planningdata'], 'services/constraintsService (checkedAt)', 'Constraints carry checkedAt; other providers do not.'],
  ['PI-17-04', P, [], 'provider attribution fields; README', 'Attribution strings on several providers; no licence register.'],
  ['PI-17-05', P, [], 'lidar confidence; plot.estimated; uprnMatch', 'Confidence exists per source but is not aggregated.'],
  ['PI-17-06', H, ['db|osplaces'], 'services/uprnMatcher', 'High / low match confidence with candidate list.'],
  ['PI-17-07', H, [], 'services/useGate; permittedDevelopment', 'Rule applicability gates (flat, listed, Wales, Article 4).'],
  ['PI-17-08', P, [], 'services/ppdSignals (ppd-epc-mismatch); assessment confidence', 'Flags EPC / Land Registry disagreement and needs_confirmation; no escalation queue.'],
  ['PI-17-09', P, [], 'services/dashboard (PLACEHOLDERS); assessment unanswered questions', 'Shows "not available yet" tiles and unanswered questions; no missing-document list.'],
  ['PI-17-10', N, [], '', 'No survey-request workflow.'],
  ['PI-17-11', N, [], '', 'No reviewer sign-off storage. Needs evidence service + auth.'],
  ['PI-17-12', N, [], '', 'No officer review queue.'],
  ['PI-17-13', P, [], 'services/applicationExport (EXPORT_VERSION, exportedAt)', 'Export schema version and timestamp; no report revision history.'],
  ['PI-17-14', N, [], '', 'No release gate: a verdict is always produced.'],
];

/**
 * SUGGESTED ROUTE to close each "missing" check (a planning judgement, not a commitment - check licences and prices before committing):
 *   logic         build it in the engine from data it already holds, or as a workflow (no new data source)
 *   open          add an open / free national dataset
 *   council       needs council / local-authority / local-records data (no national feed)
 *   licensed      needs licensed, paid or utility-company data (HM Land Registry, BGS, water / gas / electricity / telecoms)
 *   professional  needs a survey, a specialist, deeds or client-supplied evidence
 */
export const ROUTES = {
  logic: 'Build in the engine (no new data)', open: 'Add an open national dataset', council: 'Council / local data',
  licensed: 'Licensed, paid or utility data', professional: 'Survey, specialist or client evidence',
};
const R = (route, ...ids) => ids.map((id) => [id, route]);
export const ROUTE_BY_ID = Object.fromEntries([
  ...R('licensed', 'PI-02-01'),
  ...R('professional', ...['05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'].map((n) => `PI-02-${n}`)),
  ...R('council', 'PI-04-04', 'PI-04-05', 'PI-04-10', 'PI-04-11', 'PI-04-13', 'PI-04-14', 'PI-04-15'), ...R('open', 'PI-04-08'), ...R('logic', 'PI-04-16'),
  ...R('logic', 'PI-06-07'), ...R('council', 'PI-06-08', 'PI-06-09', 'PI-06-10', 'PI-06-11'),
  ...R('council', 'PI-07-05', 'PI-07-06', 'PI-07-08'), ...R('logic', 'PI-07-10'),
  ...R('open', 'PI-08-02', 'PI-08-03', 'PI-08-05', 'PI-08-06', 'PI-08-07', 'PI-08-15'), ...R('licensed', 'PI-08-04', 'PI-08-09', 'PI-08-10', 'PI-08-14'),
  ...R('council', 'PI-08-08'), ...R('professional', 'PI-08-11'), ...R('logic', 'PI-08-13'),
  ...R('licensed', 'PI-09-07', 'PI-09-08', 'PI-09-09', 'PI-09-10'), ...R('professional', 'PI-09-15'),
  ...R('licensed', 'PI-10-02', 'PI-10-04', 'PI-10-09', 'PI-10-10', 'PI-10-11', 'PI-10-12', 'PI-10-13', 'PI-10-16'),
  ...R('open', 'PI-10-03', 'PI-10-14', 'PI-10-15'), ...R('logic', 'PI-10-06'), ...R('professional', 'PI-10-17'),
  ...R('open', 'PI-11-03'), ...R('logic', 'PI-11-10'), ...R('council', 'PI-11-11', 'PI-11-12', 'PI-11-13'),
  ...R('logic', 'PI-12-02', 'PI-12-09', 'PI-12-13'), ...R('council', 'PI-12-06'), ...R('professional', 'PI-12-07', 'PI-12-08'),
  ...R('open', 'PI-13-01', 'PI-13-02', 'PI-13-05', 'PI-13-09', 'PI-13-10', 'PI-13-11'), ...R('council', 'PI-13-03'), ...R('licensed', 'PI-13-04'), ...R('logic', 'PI-13-08'),
  ...R('professional', 'PI-14-04', 'PI-14-07', 'PI-14-10', 'PI-14-11'),
  ...R('council', 'PI-15-02', 'PI-15-03', 'PI-15-04'), ...R('logic', 'PI-15-10'),
  ...R('open', 'PI-16-03'), ...R('logic', 'PI-16-06'),
  ...R('logic', 'PI-17-10', 'PI-17-11', 'PI-17-12', 'PI-17-14'),
]);
