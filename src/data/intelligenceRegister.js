// AI4Planning v3 — Property Intelligence 228-parameter evidence register (v1.0, 15 Nov 2026).
// Generated from AI4Planning_228_Intelligence_Parameters_Evidence_Register_v1.docx. Names and IDs are unchanged from the source.
// This is a requirements catalogue (what evidence to obtain and how to accept it), NOT a set of findings.
export const DOMAINS = [
 {
  "no": "01",
  "name": "Property Identity",
  "family": "UPRN/address, georeferenced land references and authority geography",
  "reviewer": "Planning data analyst / GIS specialist",
  "gate": "Identity must be confirmed before any site-specific rule outcome."
 },
 {
  "no": "02",
  "name": "Title & Legal Restrictions",
  "family": "HM Land Registry official records, filed deeds and client conveyancing materials",
  "reviewer": "Conveyancer / title specialist",
  "gate": "Planning permission does not extinguish private restrictions or rights."
 },
 {
  "no": "03",
  "name": "Physical Property & Land",
  "family": "Measured surveys, site photography, mapping geometry and GSIE model",
  "reviewer": "Surveyor / architect",
  "gate": "Record survey tolerances and unresolved building geometry."
 },
 {
  "no": "04",
  "name": "Planning History",
  "family": "LPA planning portal, decision notices, stamped plans and enforcement records",
  "reviewer": "Planning consultant",
  "gate": "Historic decisions and conditions must be applied to the correct parcel."
 },
 {
  "no": "05",
  "name": "GPDO & Permitted Development",
  "family": "GPDO text as amended, Article 4 instruments, approved plans and measured design",
  "reviewer": "Planning consultant",
  "gate": "Test all class-specific conditions, limitations, exclusions and dates."
 },
 {
  "no": "06",
  "name": "Local Planning Policy",
  "family": "Adopted local plan, LPA map and supplementary design documents",
  "reviewer": "Planning consultant",
  "gate": "Clearly distinguish adopted policies, guidance and emerging proposals."
 },
 {
  "no": "07",
  "name": "Heritage",
  "family": "Historic England, LPA conservation/heritage records and specialist appraisal",
  "reviewer": "Heritage consultant",
  "gate": "Proximity does not establish an adverse heritage impact by itself."
 },
 {
  "no": "08",
  "name": "Flooding & Drainage",
  "family": "Environment Agency, LLFA, water undertaker and site drainage evidence",
  "reviewer": "Flood / drainage specialist",
  "gate": "Screening map classifications do not replace an FRA or site study."
 },
 {
  "no": "09",
  "name": "Mining & Geology",
  "family": "Mining Remediation Authority, BGS, historic maps and geotechnical reports",
  "reviewer": "Geotechnical engineer",
  "gate": "Site investigation is needed where mapped hazards could affect works."
 },
 {
  "no": "10",
  "name": "Electricity & Utilities",
  "family": "DNO/statutory undertaker records, utility survey, deeds and easements",
  "reviewer": "Utilities / MEP coordinator",
  "gate": "Underground asset locations need field validation before excavation."
 },
 {
  "no": "11",
  "name": "Street Furniture & Highways",
  "family": "Highway authority, traffic orders, street asset inventories and site survey",
  "reviewer": "Highway consultant / surveyor",
  "gate": "Public realm assets and access rights require direct authority checks."
 },
 {
  "no": "12",
  "name": "Trees & Ecology",
  "family": "LPA tree records, DEFRA data, surveys and professional ecology inputs",
  "reviewer": "Ecologist / arboriculturist",
  "gate": "Protected habitats and trees may require timed/specialist surveys."
 },
 {
  "no": "13",
  "name": "Environmental Hazards",
  "family": "EA, LPA environment registers, historic land use and site studies",
  "reviewer": "Environmental consultant",
  "gate": "Screening alone cannot certify the absence of hazardous conditions."
 },
 {
  "no": "14",
  "name": "Building Intelligence",
  "family": "ISIE E01/P02, measured drawings, structural / fire / MEP evidence",
  "reviewer": "Architect and building engineering specialists",
  "gate": "Model-derived changes require structural, life-safety and survey gates."
 },
 {
  "no": "15",
  "name": "Licensing & Lawful Use",
  "family": "LPA licensing designations, use history and local occupation standards",
  "reviewer": "Planning / housing-licensing specialist",
  "gate": "Licensing, lawful use and planning rights are different regimes."
 },
 {
  "no": "16",
  "name": "Development Context",
  "family": "Nearby LPA cases, highway programmes, surveys and scenario models",
  "reviewer": "Planning / design lead",
  "gate": "Compare alternative proposals with transparent assumptions."
 },
 {
  "no": "17",
  "name": "Evidence & Readiness",
  "family": "Evidence service, ingestion logs, versioned models and sign-off register",
  "reviewer": "QA lead / case owner",
  "gate": "A result without provenance or a release gate cannot be represented as verified."
 }
];

export const CHECKS = [
{
"id": "PI-01-01",
"domain": "01",
"seq": 1,
"name": "UPRN matching",
"evidence": "AddressBase/official UPRN match and selected property address",
"acceptance": "Confirm UPRN identifies the intended building/parcel and is unique"
},
{
"id": "PI-01-02",
"domain": "01",
"seq": 2,
"name": "Address normalisation",
"evidence": "Raw source address, postal record and standardised address output",
"acceptance": "Compare house number, street, unit, postcode and alias matches"
},
{
"id": "PI-01-03",
"domain": "01",
"seq": 3,
"name": "OS grid reference",
"evidence": "National Grid eastings/northings or authoritative georeferenced geometry",
"acceptance": "Confirm coordinate system, spatial accuracy and property match"
},
{
"id": "PI-01-04",
"domain": "01",
"seq": 4,
"name": "Parcel centroid",
"evidence": "Polygon centroid coordinates from authoritative property/site geometry",
"acceptance": "Confirm centroid sits within the selected parcel, not neighbouring land"
},
{
"id": "PI-01-05",
"domain": "01",
"seq": 5,
"name": "Title number matching",
"evidence": "Official register title number plus UPRN-to-title cross-reference",
"acceptance": "Check title corresponds to the intended legal parcel; flag split titles"
},
{
"id": "PI-01-06",
"domain": "01",
"seq": 6,
"name": "Building footprint",
"evidence": "Current building polygon from licensed mapping and survey evidence",
"acceptance": "Reconcile footprint, outbuildings and observed building outline"
},
{
"id": "PI-01-07",
"domain": "01",
"seq": 7,
"name": "Local authority boundary",
"evidence": "Administrative boundary map and relevant LPA jurisdiction record",
"acceptance": "Spatially intersect location with planning authority boundaries"
},
{
"id": "PI-01-08",
"domain": "01",
"seq": 8,
"name": "Ward boundary",
"evidence": "Official ward geography and dated boundary definition",
"acceptance": "Resolve the electoral/admin ward for the selected address"
},
{
"id": "PI-01-09",
"domain": "01",
"seq": 9,
"name": "Property classification",
"evidence": "Address/land-use classification record and observed property type",
"acceptance": "Confirm single house, flat, maisonette or other type for route screening"
},
{
"id": "PI-01-10",
"domain": "01",
"seq": 10,
"name": "Property identity confidence",
"evidence": "UPRN, title, polygon and address match results with confidence notes",
"acceptance": "Record mismatches, source quality and required manual reconciliation"
},
{
"id": "PI-02-01",
"domain": "02",
"seq": 1,
"name": "Registered proprietor",
"evidence": "Current HM Land Registry official register and proprietor section",
"acceptance": "Check proprietor details and date of register; do not infer consent rights"
},
{
"id": "PI-02-02",
"domain": "02",
"seq": 2,
"name": "Freehold or leasehold",
"evidence": "Register tenure entries and lease documents where applicable",
"acceptance": "Establish tenure, lease term and affected interests"
},
{
"id": "PI-02-03",
"domain": "02",
"seq": 3,
"name": "Title boundary alignment",
"evidence": "HMLR title plan, OS backdrop and surveyed site boundary",
"acceptance": "Overlay general boundary and survey; escalate any material differences"
},
{
"id": "PI-02-04",
"domain": "02",
"seq": 4,
"name": "Title plan reference",
"evidence": "Official title plan with edition date, title reference and scale",
"acceptance": "Confirm document version and correspondence with register"
},
{
"id": "PI-02-05",
"domain": "02",
"seq": 5,
"name": "Restrictive covenants",
"evidence": "Charges register plus referenced transfers and covenant wording",
"acceptance": "Extract burdened land, beneficiaries and whether proposed works are affected"
},
{
"id": "PI-02-06",
"domain": "02",
"seq": 6,
"name": "Easements",
"evidence": "Deeds or agreements granting or reserving easements",
"acceptance": "Map easement route and test conflict with footprint/access"
},
{
"id": "PI-02-07",
"domain": "02",
"seq": 7,
"name": "Rights of way",
"evidence": "Title entries and deeds identifying rights of passage",
"acceptance": "Map right of way, width and affected owners/users"
},
{
"id": "PI-02-08",
"domain": "02",
"seq": 8,
"name": "Access reservations",
"evidence": "Transfer/reservation clauses and site access plan",
"acceptance": "Identify retained access and whether proposal obstructs it"
},
{
"id": "PI-02-09",
"domain": "02",
"seq": 9,
"name": "Rentcharges",
"evidence": "Charges register and rentcharge deed where present",
"acceptance": "Confirm liability, enforcement implications and current terms"
},
{
"id": "PI-02-10",
"domain": "02",
"seq": 10,
"name": "Restrictions on disposition",
"evidence": "Restrictions entries and supporting certificates/consents",
"acceptance": "Identify any condition restricting dispositions or relevant dealings"
},
{
"id": "PI-02-11",
"domain": "02",
"seq": 11,
"name": "Adverse possession indicators",
"evidence": "Possession evidence, boundary correspondence and legal review",
"acceptance": "Flag occupation/title discrepancy; do not decide ownership automatically"
},
{
"id": "PI-02-12",
"domain": "02",
"seq": 12,
"name": "Historic conveyances",
"evidence": "Filed conveyance/transfer deeds and historic plans",
"acceptance": "Reconstruct original rights and parcel obligations over time"
},
{
"id": "PI-02-13",
"domain": "02",
"seq": 13,
"name": "Overage clauses",
"evidence": "Overage or uplift deeds and triggers in transfer documents",
"acceptance": "Identify development/payment trigger, obligations and beneficiaries"
},
{
"id": "PI-02-14",
"domain": "02",
"seq": 14,
"name": "Service media rights",
"evidence": "Service rights, pipe/cable route deeds and utility easements",
"acceptance": "Locate rights for installations, access and maintenance"
},
{
"id": "PI-02-15",
"domain": "02",
"seq": 15,
"name": "Unregistered interests",
"evidence": "Client declarations, unregistered deeds and conveyancer enquiries",
"acceptance": "Record unregistered claims/rights and legal review requirement"
},
{
"id": "PI-03-01",
"domain": "03",
"seq": 1,
"name": "Site area",
"evidence": "Measured topographic survey and agreed project-site polygon",
"acceptance": "Calculate site area with units, boundary basis and tolerance"
},
{
"id": "PI-03-02",
"domain": "03",
"seq": 2,
"name": "Building footprint area",
"evidence": "Surveyed building footprint including extensions/outbuildings",
"acceptance": "Calculate area and compare with aerial/OS polygon"
},
{
"id": "PI-03-03",
"domain": "03",
"seq": 3,
"name": "Existing building height",
"evidence": "Measured elevation, LiDAR or survey section with vertical datum",
"acceptance": "Record ridge/eaves heights and source precision"
},
{
"id": "PI-03-04",
"domain": "03",
"seq": 4,
"name": "Roof type",
"evidence": "Site photographs, roof survey and measured drawings",
"acceptance": "Classify pitch, form, coverings and changes over time"
},
{
"id": "PI-03-05",
"domain": "03",
"seq": 5,
"name": "Site gradient",
"evidence": "Topographic levels at multiple points and slope calculation",
"acceptance": "Quantify gradient and impact on access, drainage and height tests"
},
{
"id": "PI-03-06",
"domain": "03",
"seq": 6,
"name": "Ground levels",
"evidence": "Level survey with benchmarks, thresholds and datum",
"acceptance": "Compare existing ground to proposed finished levels"
},
{
"id": "PI-03-07",
"domain": "03",
"seq": 7,
"name": "Rear garden depth",
"evidence": "Measured rear plot line, original rear wall and boundary offset",
"acceptance": "Calculate usable garden depth with confidence bounds"
},
{
"id": "PI-03-08",
"domain": "03",
"seq": 8,
"name": "Side passage width",
"evidence": "Dimensioned side passage with site photographs",
"acceptance": "Assess access, construction space and relevant design clearances"
},
{
"id": "PI-03-09",
"domain": "03",
"seq": 9,
"name": "Boundary structures",
"evidence": "Boundary survey, photographs and wall/fence ownership notes",
"acceptance": "Record height, type, condition and responsibility if known"
},
{
"id": "PI-03-10",
"domain": "03",
"seq": 10,
"name": "Neighbouring offsets",
"evidence": "Measured distances to neighbouring building elevations",
"acceptance": "Confirm separation, privacy and overshading input distances"
},
{
"id": "PI-03-11",
"domain": "03",
"seq": 11,
"name": "Plot orientation",
"evidence": "True-north survey, site plan and orientation bearing",
"acceptance": "Record aspect used in sunlight and design studies"
},
{
"id": "PI-03-12",
"domain": "03",
"seq": 12,
"name": "Public realm interface",
"evidence": "Photographs and street/site interface plan",
"acceptance": "Identify public footway, access, verge and street assets"
},
{
"id": "PI-03-13",
"domain": "03",
"seq": 13,
"name": "Site access width",
"evidence": "Measured entrance/crossover and bottleneck dimensions",
"acceptance": "Check width against access and construction requirements"
},
{
"id": "PI-03-14",
"domain": "03",
"seq": 14,
"name": "Survey evidence completeness",
"evidence": "Survey checklist, photo log and signed survey provenance",
"acceptance": "List missing measurements and confidence/validation gates"
},
{
"id": "PI-04-01",
"domain": "04",
"seq": 1,
"name": "Planning application search",
"evidence": "Dated LPA planning portal search with full address/parcel queries",
"acceptance": "Log search terms, references, date and completeness limits"
},
{
"id": "PI-04-02",
"domain": "04",
"seq": 2,
"name": "Previous approvals",
"evidence": "Decision notices and approved-plan schedules for granted applications",
"acceptance": "Check dates, approved works and operative conditions"
},
{
"id": "PI-04-03",
"domain": "04",
"seq": 3,
"name": "Previous refusals",
"evidence": "Refusal notices with reasons and appeal history",
"acceptance": "Extract refusal grounds applicable to current proposal"
},
{
"id": "PI-04-04",
"domain": "04",
"seq": 4,
"name": "Condition discharge",
"evidence": "Condition discharge submissions and authority decisions",
"acceptance": "Reconcile condition number, status and approved evidence"
},
{
"id": "PI-04-05",
"domain": "04",
"seq": 5,
"name": "Enforcement notices",
"evidence": "Enforcement register notices and compliance correspondence",
"acceptance": "Confirm current/enforced restrictions and outstanding matters"
},
{
"id": "PI-04-06",
"domain": "04",
"seq": 6,
"name": "Lawful development certificates",
"evidence": "Issued lawful development certificates and certified plans",
"acceptance": "Check precise lawful use/operations and certificate limitations"
},
{
"id": "PI-04-07",
"domain": "04",
"seq": 7,
"name": "Prior approval history",
"evidence": "Prior approval submissions, notices and decisions",
"acceptance": "Confirm prior approval scope, conditions and timing"
},
{
"id": "PI-04-08",
"domain": "04",
"seq": 8,
"name": "Appeal decisions",
"evidence": "Planning Inspectorate decision notices and linked appeal plans",
"acceptance": "Record appeal outcomes and relevance to proposed scheme"
},
{
"id": "PI-04-09",
"domain": "04",
"seq": 9,
"name": "Historic site use",
"evidence": "Historic maps, use records, LPA files and client evidence",
"acceptance": "Reconstruct actual lawful-use chronology; flag gaps"
},
{
"id": "PI-04-10",
"domain": "04",
"seq": 10,
"name": "Planning obligations",
"evidence": "Planning obligation schedules and linked title entries",
"acceptance": "Identify obligations binding land and project triggers"
},
{
"id": "PI-04-11",
"domain": "04",
"seq": 11,
"name": "Section 106 agreements",
"evidence": "Executed Section 106 deed and variation/discharge instruments",
"acceptance": "Identify obligations, parties, covenants and compliance dates"
},
{
"id": "PI-04-12",
"domain": "04",
"seq": 12,
"name": "CIL liability",
"evidence": "LPA CIL charging schedule, calculation and notices",
"acceptance": "Assess potential liability/exemption subject to authority verification"
},
{
"id": "PI-04-13",
"domain": "04",
"seq": 13,
"name": "Implementation status",
"evidence": "Commencement evidence, inspections and completion documents",
"acceptance": "Determine whether permitted development/application was implemented"
},
{
"id": "PI-04-14",
"domain": "04",
"seq": 14,
"name": "Condition compliance",
"evidence": "Condition-monitoring correspondence and certificate evidence",
"acceptance": "Flag non-compliance and outstanding pre-commencement conditions"
},
{
"id": "PI-04-15",
"domain": "04",
"seq": 15,
"name": "Approved plan matching",
"evidence": "Stamped approved drawings and measured existing building model",
"acceptance": "Test whether existing works correspond with lawful approvals"
},
{
"id": "PI-04-16",
"domain": "04",
"seq": 16,
"name": "Planning history completeness",
"evidence": "Chronological search audit, property aliases and authority replies",
"acceptance": "Record missing records, gaps and reliable coverage statement"
},
{
"id": "PI-05-01",
"domain": "05",
"seq": 1,
"name": "GPDO eligibility",
"evidence": "Property status, original house evidence, GPDO text as amended and site inputs",
"acceptance": "Establish whether the relevant development right can apply at all"
},
{
"id": "PI-05-02",
"domain": "05",
"seq": 2,
"name": "Article 4 Direction",
"evidence": "LPA Article 4 direction instrument, map and commencement date",
"acceptance": "Test parcel boundary, withdrawn class and effective dates"
},
{
"id": "PI-05-03",
"domain": "05",
"seq": 3,
"name": "Permitted development class",
"evidence": "Class-specific GPDO Schedule 2 provision and proposal description",
"acceptance": "Select relevant class and record limitations, exclusions and conditions"
},
{
"id": "PI-05-04",
"domain": "05",
"seq": 4,
"name": "Rear projection depth",
"evidence": "Measured original rear wall and proposed furthest projection",
"acceptance": "Calculate projection and compare with applicable class threshold"
},
{
"id": "PI-05-05",
"domain": "05",
"seq": 5,
"name": "Single-storey height",
"evidence": "Proposed dimensioned elevations and site ground reference",
"acceptance": "Check proposed total height against route-specific limits"
},
{
"id": "PI-05-06",
"domain": "05",
"seq": 6,
"name": "Eaves height",
"evidence": "Dimensioned eaves on relevant boundaries and datum",
"acceptance": "Test eaves height using current applicable provision"
},
{
"id": "PI-05-07",
"domain": "05",
"seq": 7,
"name": "Boundary proximity",
"evidence": "Measured boundary-to-building distances and project footprint",
"acceptance": "Check side/rear proximity and height-related rules"
},
{
"id": "PI-05-08",
"domain": "05",
"seq": 8,
"name": "Original dwellinghouse test",
"evidence": "Historic original-house drawings, historic photos and decisions",
"acceptance": "Establish the lawful original dwellinghouse baseline"
},
{
"id": "PI-05-09",
"domain": "05",
"seq": 9,
"name": "Previous extensions",
"evidence": "Previous and current enlargement drawings, approvals and dates",
"acceptance": "Aggregate extensions where relevant to cumulative restrictions"
},
{
"id": "PI-05-10",
"domain": "05",
"seq": 10,
"name": "Side extension criteria",
"evidence": "Proposed side elevation and original width measurements",
"acceptance": "Assess side extension width, height and location criteria"
},
{
"id": "PI-05-11",
"domain": "05",
"seq": 11,
"name": "Roof alteration allowance",
"evidence": "Existing/proposed roof plans, sections and volume calculations",
"acceptance": "Test relevant roof alteration dimensions and exclusions"
},
{
"id": "PI-05-12",
"domain": "05",
"seq": 12,
"name": "Materials similarity",
"evidence": "Materials specification, photographs and approved/local design context",
"acceptance": "Compare external material appearance where condition applies"
},
{
"id": "PI-05-13",
"domain": "05",
"seq": 13,
"name": "Principal elevation restriction",
"evidence": "Site plan identifying highway and principal elevation",
"acceptance": "Assess whether development faces the relevant highway/elevation"
},
{
"id": "PI-05-14",
"domain": "05",
"seq": 14,
"name": "Curtilage coverage",
"evidence": "Site/curtilage area and total proposed building/coverage polygons",
"acceptance": "Calculate site coverage and retain traceable geometry inputs"
},
{
"id": "PI-05-15",
"domain": "05",
"seq": 15,
"name": "Protected land exceptions",
"evidence": "Designated land/conservation map and applicable restriction text",
"acceptance": "Apply extra restrictions with effective designation dates"
},
{
"id": "PI-05-16",
"domain": "05",
"seq": 16,
"name": "Prior approval trigger",
"evidence": "Proposal height/depth/type and relevant prior approval conditions",
"acceptance": "Check whether prior approval process is required before work"
},
{
"id": "PI-05-17",
"domain": "05",
"seq": 17,
"name": "Neighbour consultation trigger",
"evidence": "Neighbour consultation applicability evidence and LPA procedure",
"acceptance": "Identify statutory notification/consultation trigger and limits"
},
{
"id": "PI-05-18",
"domain": "05",
"seq": 18,
"name": "PD conclusion and caveats",
"evidence": "Versioned rule evaluation, evidence references and exception schedule",
"acceptance": "State preliminary route, unresolved issues and why no approval is implied"
},
{
"id": "PI-06-01",
"domain": "06",
"seq": 1,
"name": "Development plan designation",
"evidence": "Adopted development plan designation map and authority reference",
"acceptance": "Intersect plot with applicable area allocations/designations"
},
{
"id": "PI-06-02",
"domain": "06",
"seq": 2,
"name": "Local plan policies",
"evidence": "Adopted local plan policy text, adoption dates and policy matrix",
"acceptance": "Identify relevant policy tests and current development plan weight"
},
{
"id": "PI-06-03",
"domain": "06",
"seq": 3,
"name": "Supplementary planning documents",
"evidence": "LPA supplementary planning document and status/date",
"acceptance": "Cite non-statutory guidance relevant to specific proposal"
},
{
"id": "PI-06-04",
"domain": "06",
"seq": 4,
"name": "Residential design guide",
"evidence": "Current residential design guide and local design code",
"acceptance": "Map massing, materials, design and location tests"
},
{
"id": "PI-06-05",
"domain": "06",
"seq": 5,
"name": "Residential amenity",
"evidence": "Neighbouring windows, amenity space and policy thresholds",
"acceptance": "Assess adverse effect using measured and visual evidence"
},
{
"id": "PI-06-06",
"domain": "06",
"seq": 6,
"name": "Overshadowing policy",
"evidence": "Sun/daylight study, neighbour geometry and policy benchmark",
"acceptance": "Check likely overshadowing and need for detailed study"
},
{
"id": "PI-06-07",
"domain": "06",
"seq": 7,
"name": "Overlooking and privacy",
"evidence": "Window positions, separation measurements and privacy standards",
"acceptance": "Assess overlooking and mitigation options"
},
{
"id": "PI-06-08",
"domain": "06",
"seq": 8,
"name": "Density considerations",
"evidence": "Site area, density indicators and local plan context",
"acceptance": "Check density implications where the proposal makes this relevant"
},
{
"id": "PI-06-09",
"domain": "06",
"seq": 9,
"name": "Parking standards",
"evidence": "Parking layout, existing provision and adopted standards",
"acceptance": "Identify net change and compliance case for proposed use"
},
{
"id": "PI-06-10",
"domain": "06",
"seq": 10,
"name": "Cycle parking",
"evidence": "Cycle storage plan and adopted cycle parking standards",
"acceptance": "Assess capacity, access and practical layout"
},
{
"id": "PI-06-11",
"domain": "06",
"seq": 11,
"name": "Sustainable drainage policy",
"evidence": "Drainage concept and current local SuDS policy",
"acceptance": "Check runoff hierarchy and policy-led supporting documents"
},
{
"id": "PI-06-12",
"domain": "06",
"seq": 12,
"name": "Policy review date",
"evidence": "Policy register with retrieval date, adoption and emerging-plan status",
"acceptance": "Record which version was checked and when it changes"
},
{
"id": "PI-07-01",
"domain": "07",
"seq": 1,
"name": "Listed building status",
"evidence": "Official listed building designation record and map",
"acceptance": "Check asset listing, curtilage implications and relevant consents"
},
{
"id": "PI-07-02",
"domain": "07",
"seq": 2,
"name": "Conservation area",
"evidence": "LPA conservation area map and designation date",
"acceptance": "Confirm parcel inclusion and applicable character requirements"
},
{
"id": "PI-07-03",
"domain": "07",
"seq": 3,
"name": "Scheduled monument",
"evidence": "Scheduled monument record and legally defined extent",
"acceptance": "Test site intersection and possible setting implications"
},
{
"id": "PI-07-04",
"domain": "07",
"seq": 4,
"name": "Historic park and garden",
"evidence": "Historic England registered park/garden boundaries",
"acceptance": "Assess proximity and potential effects on significance"
},
{
"id": "PI-07-05",
"domain": "07",
"seq": 5,
"name": "Locally listed assets",
"evidence": "LPA local heritage list and mapped assets",
"acceptance": "Identify non-designated heritage constraints"
},
{
"id": "PI-07-06",
"domain": "07",
"seq": 6,
"name": "Archaeological priority area",
"evidence": "Historic environment record and archaeological area maps",
"acceptance": "Establish archaeology screening or investigation trigger"
},
{
"id": "PI-07-07",
"domain": "07",
"seq": 7,
"name": "Heritage setting",
"evidence": "Site photos, sightlines and heritage significance appraisal",
"acceptance": "Assess effects on setting, not only straight-line distance"
},
{
"id": "PI-07-08",
"domain": "07",
"seq": 8,
"name": "Protected views",
"evidence": "Local protected view corridor policy/map and elevations",
"acceptance": "Check visual corridor or landmark effect"
},
{
"id": "PI-07-09",
"domain": "07",
"seq": 9,
"name": "Designated heritage buffer",
"evidence": "Mapped heritage geometries and transparent buffer assumptions",
"acceptance": "Record buffer method and refer to expert for impacts"
},
{
"id": "PI-07-10",
"domain": "07",
"seq": 10,
"name": "Heritage statement requirement",
"evidence": "Heritage screening result and specialist opinion requirement",
"acceptance": "Justify whether a statement or further assessment is necessary"
},
{
"id": "PI-08-01",
"domain": "08",
"seq": 1,
"name": "Flood Zone classification",
"evidence": "Environment Agency flood-zone map with site polygon and date",
"acceptance": "Classify zone; distinguish mapped probability from site-level risk"
},
{
"id": "PI-08-02",
"domain": "08",
"seq": 2,
"name": "Surface water risk",
"evidence": "EA long-term surface water flood mapping and contours",
"acceptance": "Identify flow pathways and affected footprint/entrances"
},
{
"id": "PI-08-03",
"domain": "08",
"seq": 3,
"name": "Historic flooding",
"evidence": "LPA/EA historic incident records and client declarations",
"acceptance": "Reconcile known past events with mapping limitations"
},
{
"id": "PI-08-04",
"domain": "08",
"seq": 4,
"name": "Groundwater flooding",
"evidence": "Groundwater susceptibility map and geotechnical findings",
"acceptance": "Flag groundwater risk and need for specialist advice"
},
{
"id": "PI-08-05",
"domain": "08",
"seq": 5,
"name": "Reservoir inundation",
"evidence": "Reservoir flood risk map with relevant scenario information",
"acceptance": "Record mapped extent and scenario limitations"
},
{
"id": "PI-08-06",
"domain": "08",
"seq": 6,
"name": "Flood defence proximity",
"evidence": "Defence asset map, condition information and proximity",
"acceptance": "Note influence of defences without assuming adequate protection"
},
{
"id": "PI-08-07",
"domain": "08",
"seq": 7,
"name": "Main river proximity",
"evidence": "EA main-river network and measured proposal offsets",
"acceptance": "Check proximity and potential permitting/consent triggers"
},
{
"id": "PI-08-08",
"domain": "08",
"seq": 8,
"name": "Ordinary watercourse",
"evidence": "Ordinary watercourse map and site inspection",
"acceptance": "Identify drainage consent and buffer constraints"
},
{
"id": "PI-08-09",
"domain": "08",
"seq": 9,
"name": "Drainage capacity",
"evidence": "Water utility capacity records, drainage survey and network plans",
"acceptance": "Check outfall capacity and request sewer/drainage advice"
},
{
"id": "PI-08-10",
"domain": "08",
"seq": 10,
"name": "Public sewer proximity",
"evidence": "Sewer undertaker maps and surveyed site geometry",
"acceptance": "Check separation, build-over considerations and verification need"
},
{
"id": "PI-08-11",
"domain": "08",
"seq": 11,
"name": "SuDS feasibility",
"evidence": "Site infiltration tests, soil and drainage concept layout",
"acceptance": "Review feasible sustainable drainage options"
},
{
"id": "PI-08-12",
"domain": "08",
"seq": 12,
"name": "Flood Risk Assessment trigger",
"evidence": "Proposed development and verified flood screening result",
"acceptance": "Decide whether FRA must be prepared for the actual application"
},
{
"id": "PI-08-13",
"domain": "08",
"seq": 13,
"name": "Sequential test trigger",
"evidence": "Relevant policy framework and proposal vulnerability class",
"acceptance": "Assess if sequential-test reasoning is potentially required"
},
{
"id": "PI-08-14",
"domain": "08",
"seq": 14,
"name": "Drainage easement",
"evidence": "Drainage deed/wayleave, title data and pipe geometry",
"acceptance": "Identify access restrictions and legal rights near works"
},
{
"id": "PI-08-15",
"domain": "08",
"seq": 15,
"name": "Climate change allowance",
"evidence": "Current EA climate allowances and design assumptions",
"acceptance": "Apply relevant allowance to drainage/flood design modelling"
},
{
"id": "PI-09-01",
"domain": "09",
"seq": 1,
"name": "Coal mining reporting area",
"evidence": "Mining Remediation Authority reporting-area spatial record",
"acceptance": "Check address/site intersection and map publication date"
},
{
"id": "PI-09-02",
"domain": "09",
"seq": 2,
"name": "Development high-risk area",
"evidence": "Development high-risk area map and coordinates",
"acceptance": "Determine if mining risk assessment or consultation is triggered"
},
{
"id": "PI-09-03",
"domain": "09",
"seq": 3,
"name": "Recorded mine entry",
"evidence": "Recorded mine-entry register and survey evidence",
"acceptance": "Assess mapped entry position, uncertainty and influence zone"
},
{
"id": "PI-09-04",
"domain": "09",
"seq": 4,
"name": "Mine shaft proximity",
"evidence": "Mine-shaft locations and exclusion/investigation guidance",
"acceptance": "Determine proximity and need for ground investigation"
},
{
"id": "PI-09-05",
"domain": "09",
"seq": 5,
"name": "Past underground workings",
"evidence": "Historical mine plans, authority mining record and specialist view",
"acceptance": "Identify underground workings and reliability of records"
},
{
"id": "PI-09-06",
"domain": "09",
"seq": 6,
"name": "Shallow mine risk",
"evidence": "Shallow working records, ground reports and geology",
"acceptance": "Screen collapse/subsidence potential and specialist testing needs"
},
{
"id": "PI-09-07",
"domain": "09",
"seq": 7,
"name": "Ground stability",
"evidence": "BGS hazards mapping and ground investigation where available",
"acceptance": "Record potential instability mechanisms and confidence"
},
{
"id": "PI-09-08",
"domain": "09",
"seq": 8,
"name": "Geological faults",
"evidence": "BGS geological fault datasets and structural/geotech opinion",
"acceptance": "Assess relevance of mapped faults at site scale"
},
{
"id": "PI-09-09",
"domain": "09",
"seq": 9,
"name": "Landslip susceptibility",
"evidence": "Geological landslide susceptibility map and site slope",
"acceptance": "Evaluate slope stability investigation need"
},
{
"id": "PI-09-10",
"domain": "09",
"seq": 10,
"name": "Radon potential",
"evidence": "UK radon potential dataset and testing/building guidance",
"acceptance": "Establish relevant probability band and design response"
},
{
"id": "PI-09-11",
"domain": "09",
"seq": 11,
"name": "Made ground",
"evidence": "Historic land-use mapping and site investigation evidence",
"acceptance": "Identify artificial fill and consequences for foundations"
},
{
"id": "PI-09-12",
"domain": "09",
"seq": 12,
"name": "Contamination indicators",
"evidence": "Historic uses, environmental records and sample results",
"acceptance": "Screen plausible contamination pathways and tests"
},
{
"id": "PI-09-13",
"domain": "09",
"seq": 13,
"name": "Landfill proximity",
"evidence": "Historic/current landfill datasets and site proximity",
"acceptance": "Evaluate ground gas, stability and contamination concerns"
},
{
"id": "PI-09-14",
"domain": "09",
"seq": 14,
"name": "Ground investigation need",
"evidence": "Ground risk screening, site history and engineering scope",
"acceptance": "Define investigations, locations and outputs before design sign-off"
},
{
"id": "PI-09-15",
"domain": "09",
"seq": 15,
"name": "Foundation sensitivity",
"evidence": "Foundation drawings, soils, trees and neighbouring structures",
"acceptance": "Assess site-specific bearing/settlement and design sensitivity"
},
{
"id": "PI-09-16",
"domain": "09",
"seq": 16,
"name": "Mining report requirement",
"evidence": "Official mining report and supporting authority responses",
"acceptance": "Record report requirement, reference, conclusions and caveats"
},
{
"id": "PI-10-01",
"domain": "10",
"seq": 1,
"name": "Overhead power lines",
"evidence": "DNO overhead network plans, voltage data and site photographs",
"acceptance": "Confirm span location, ground clearance and corridor conflicts"
},
{
"id": "PI-10-02",
"domain": "10",
"seq": 2,
"name": "Underground electricity cables",
"evidence": "DNO buried cable plans and PAS 128/utility survey where needed",
"acceptance": "Verify route/depth before excavation; plans are indicative"
},
{
"id": "PI-10-03",
"domain": "10",
"seq": 3,
"name": "Distribution substation",
"evidence": "DNO substation asset plan, access and land rights",
"acceptance": "Locate compound and check safe access/service restrictions"
},
{
"id": "PI-10-04",
"domain": "10",
"seq": 4,
"name": "Electricity easement",
"evidence": "Title/deed electricity easement and network plan",
"acceptance": "Check legal corridor, beneficiary and conflict with extension"
},
{
"id": "PI-10-05",
"domain": "10",
"seq": 5,
"name": "DNO asset proximity",
"evidence": "DNO equipment inventory and nearest-asset coordinates",
"acceptance": "Measure offset and obtain operator review where necessary"
},
{
"id": "PI-10-06",
"domain": "10",
"seq": 6,
"name": "Minimum electrical clearances",
"evidence": "DNO electrical safety guidance and surveyed clearances",
"acceptance": "Test design against operator-specific safe clearance criteria"
},
{
"id": "PI-10-07",
"domain": "10",
"seq": 7,
"name": "High voltage route",
"evidence": "High-voltage route maps, voltage classification and survey",
"acceptance": "Establish corridor and required operational clearances"
},
{
"id": "PI-10-08",
"domain": "10",
"seq": 8,
"name": "Low voltage route",
"evidence": "Low-voltage cable drawings and service layout survey",
"acceptance": "Check affected lines and diversion/connection conditions"
},
{
"id": "PI-10-09",
"domain": "10",
"seq": 9,
"name": "Gas mains",
"evidence": "Gas network operator main plans and onsite utility scan",
"acceptance": "Identify route, pressure and excavation constraints"
},
{
"id": "PI-10-10",
"domain": "10",
"seq": 10,
"name": "Water mains",
"evidence": "Water company mains plan, easements and meter/service location",
"acceptance": "Check build-over/clearance, access and need for consent"
},
{
"id": "PI-10-11",
"domain": "10",
"seq": 11,
"name": "Surface water sewer",
"evidence": "Water company surface water sewer plan and CCTV if required",
"acceptance": "Trace route and determine build-over/diversion requirement"
},
{
"id": "PI-10-12",
"domain": "10",
"seq": 12,
"name": "Foul sewer",
"evidence": "Water company foul sewer plan and drainage records",
"acceptance": "Locate affected sewer and access/maintenance corridor"
},
{
"id": "PI-10-13",
"domain": "10",
"seq": 13,
"name": "Telecommunication duct",
"evidence": "Telecom operator duct mapping and utility survey",
"acceptance": "Identify ducts, chamber access and protection measures"
},
{
"id": "PI-10-14",
"domain": "10",
"seq": 14,
"name": "Broadband connectivity",
"evidence": "Operator service-availability check and installation constraints",
"acceptance": "Record connectivity evidence without treating it as planning consent"
},
{
"id": "PI-10-15",
"domain": "10",
"seq": 15,
"name": "District heating network",
"evidence": "District heating concession/network records where applicable",
"acceptance": "Check routes, connections and easements; record not applicable if absent"
},
{
"id": "PI-10-16",
"domain": "10",
"seq": 16,
"name": "Utility wayleave",
"evidence": "Wayleave agreement, land deed and operator rights",
"acceptance": "Determine duration, equipment rights and works restrictions"
},
{
"id": "PI-10-17",
"domain": "10",
"seq": 17,
"name": "Existing service entry",
"evidence": "Site service-entry photographs and MEP inspection records",
"acceptance": "Map gas/electric/water/telecom entry points to proposed works"
},
{
"id": "PI-10-18",
"domain": "10",
"seq": 18,
"name": "Utilities survey required",
"evidence": "Combined statutory utility drawings, survey and method statement",
"acceptance": "Identify outstanding detection/excavation verification before works"
},
{
"id": "PI-11-01",
"domain": "11",
"seq": 1,
"name": "Postbox location",
"evidence": "Postal operator street asset record and site photograph",
"acceptance": "Confirm postbox position and access/protection requirements"
},
{
"id": "PI-11-02",
"domain": "11",
"seq": 2,
"name": "Street lighting columns",
"evidence": "Highway lighting inventory and topographic survey",
"acceptance": "Map poles, cable routes and working clearances"
},
{
"id": "PI-11-03",
"domain": "11",
"seq": 3,
"name": "Traffic signals",
"evidence": "Traffic signal authority drawings and street observation",
"acceptance": "Check signals, chambers, cables and access obstruction"
},
{
"id": "PI-11-04",
"domain": "11",
"seq": 4,
"name": "Utility cabinets",
"evidence": "Cabinet asset list, utility ownership and street photo",
"acceptance": "Verify cabinet position, access and diversion constraints"
},
{
"id": "PI-11-05",
"domain": "11",
"seq": 5,
"name": "Bus stop proximity",
"evidence": "Bus stop inventory, stops and associated shelter geometry",
"acceptance": "Assess visibility, access, pedestrian/crossover conflicts"
},
{
"id": "PI-11-06",
"domain": "11",
"seq": 6,
"name": "Road classification",
"evidence": "Adopted road classification map and road authority record",
"acceptance": "Confirm road category, responsible authority and restrictions"
},
{
"id": "PI-11-07",
"domain": "11",
"seq": 7,
"name": "Adopted highway boundary",
"evidence": "Highway extent/adoption plan and site/title survey",
"acceptance": "Compare highway boundary to proposed works and access"
},
{
"id": "PI-11-08",
"domain": "11",
"seq": 8,
"name": "Vehicle crossover",
"evidence": "Existing crossover approval and driveway/footway layout",
"acceptance": "Identify whether new/altered vehicle crossing consent needed"
},
{
"id": "PI-11-09",
"domain": "11",
"seq": 9,
"name": "Footway obstruction",
"evidence": "Pavement widths, street photograph and obstruction survey",
"acceptance": "Check pedestrian clear width and construction staging impact"
},
{
"id": "PI-11-10",
"domain": "11",
"seq": 10,
"name": "Visibility splays",
"evidence": "Sightline geometry, speed context and highway guidance",
"acceptance": "Assess safe access/egress at the location"
},
{
"id": "PI-11-11",
"domain": "11",
"seq": 11,
"name": "Parking restrictions",
"evidence": "Traffic order, signs, road markings and permit records",
"acceptance": "Record restrictions affecting deliveries, parking and access"
},
{
"id": "PI-11-12",
"domain": "11",
"seq": 12,
"name": "Highways dedication",
"evidence": "Highway dedication/conveyance plans and adopted-area details",
"acceptance": "Identify public rights that must not be obstructed"
},
{
"id": "PI-11-13",
"domain": "11",
"seq": 13,
"name": "Road opening constraints",
"evidence": "Street works permits and network/authority road opening rules",
"acceptance": "Assess excavation permission and timing constraints"
},
{
"id": "PI-11-14",
"domain": "11",
"seq": 14,
"name": "Construction access",
"evidence": "Vehicle swept-path analysis, delivery plan and site access survey",
"acceptance": "Determine feasible construction and emergency access"
},
{
"id": "PI-12-01",
"domain": "12",
"seq": 1,
"name": "Tree Preservation Order",
"evidence": "LPA TPO schedule, mapped tree ID and site/tree survey",
"acceptance": "Match protected tree to actual location and proposed work area"
},
{
"id": "PI-12-02",
"domain": "12",
"seq": 2,
"name": "Conservation area trees",
"evidence": "Conservation designation, existing tree inventory and notice rules",
"acceptance": "Check tree notice requirements and exceptions"
},
{
"id": "PI-12-03",
"domain": "12",
"seq": 3,
"name": "Root Protection Area",
"evidence": "BS 5837 tree survey, stem location and RPA calculation",
"acceptance": "Overlay root protection with foundation and access proposals"
},
{
"id": "PI-12-04",
"domain": "12",
"seq": 4,
"name": "Neighbouring trees",
"evidence": "Adjacent land tree records, crown extents and survey",
"acceptance": "Assess offsite RPA and overhang affecting scheme"
},
{
"id": "PI-12-05",
"domain": "12",
"seq": 5,
"name": "Ancient woodland proximity",
"evidence": "Ancient woodland inventory map and site/project proximity",
"acceptance": "Assess potential buffer/design implications"
},
{
"id": "PI-12-06",
"domain": "12",
"seq": 6,
"name": "Protected species potential",
"evidence": "Preliminary ecological appraisal and habitat records",
"acceptance": "Identify species risk and need for protected-species surveys"
},
{
"id": "PI-12-07",
"domain": "12",
"seq": 7,
"name": "Bat habitat",
"evidence": "Roost suitability survey and bat activity evidence as advised",
"acceptance": "Screen roof/tree works and licensing/mitigation triggers"
},
{
"id": "PI-12-08",
"domain": "12",
"seq": 8,
"name": "Breeding birds",
"evidence": "Bird habitat survey and proposed work season",
"acceptance": "Assess nesting risk and legal protection controls"
},
{
"id": "PI-12-09",
"domain": "12",
"seq": 9,
"name": "Biodiversity Net Gain applicability",
"evidence": "Current statutory BNG applicability tests and habitat baseline",
"acceptance": "Determine whether development is exempt or metric required"
},
{
"id": "PI-12-10",
"domain": "12",
"seq": 10,
"name": "Ecological network",
"evidence": "Local nature recovery/ecological network map and policy",
"acceptance": "Assess connection/corridor effects and opportunities"
},
{
"id": "PI-12-11",
"domain": "12",
"seq": 11,
"name": "Green belt designation",
"evidence": "Adopted Green Belt boundary and national/local policy tests",
"acceptance": "Confirm designation and relevant development restrictions"
},
{
"id": "PI-12-12",
"domain": "12",
"seq": 12,
"name": "Landscape designation",
"evidence": "National/local landscape designation and landscape study",
"acceptance": "Assess character, visibility and design implications"
},
{
"id": "PI-12-13",
"domain": "12",
"seq": 13,
"name": "Ecology survey trigger",
"evidence": "Screening records and ecology professional survey scope",
"acceptance": "Document seasonal, statutory and site-specific survey needs"
},
{
"id": "PI-13-01",
"domain": "13",
"seq": 1,
"name": "Air Quality Management Area",
"evidence": "LPA Air Quality Management Area polygon and current action plan",
"acceptance": "Check site location and relevant assessment trigger"
},
{
"id": "PI-13-02",
"domain": "13",
"seq": 2,
"name": "Noise exposure",
"evidence": "Noise maps, transport/industrial sources and acoustic survey",
"acceptance": "Assess exposure and where acoustic report is needed"
},
{
"id": "PI-13-03",
"domain": "13",
"seq": 3,
"name": "Contaminated land register",
"evidence": "Local authority contaminated-land records and site history",
"acceptance": "Distinguish designated sites from preliminary risk screening"
},
{
"id": "PI-13-04",
"domain": "13",
"seq": 4,
"name": "Historic industrial use",
"evidence": "Historical land use, archive maps and contamination assessment",
"acceptance": "Identify plausible pollutants and investigation requirement"
},
{
"id": "PI-13-05",
"domain": "13",
"seq": 5,
"name": "Hazardous installation proximity",
"evidence": "HSE or relevant hazard installation consultation zone mapping",
"acceptance": "Record safeguarding/consultation implications when applicable"
},
{
"id": "PI-13-06",
"domain": "13",
"seq": 6,
"name": "Waste site proximity",
"evidence": "Permitted waste site records and proximity mapping",
"acceptance": "Assess disturbance, odour, noise and contamination pathways"
},
{
"id": "PI-13-07",
"domain": "13",
"seq": 7,
"name": "Ground gases",
"evidence": "Landfill/ground gas records and on-site gas monitoring if needed",
"acceptance": "Decide whether gas protection design is required"
},
{
"id": "PI-13-08",
"domain": "13",
"seq": 8,
"name": "Asbestos survey need",
"evidence": "Building age/asbestos survey records and demolition/refurb scope",
"acceptance": "Determine survey type needed before intrusive works"
},
{
"id": "PI-13-09",
"domain": "13",
"seq": 9,
"name": "Light pollution",
"evidence": "Nighttime lighting source survey and environmental context",
"acceptance": "Assess light spill and mitigation where relevant"
},
{
"id": "PI-13-10",
"domain": "13",
"seq": 10,
"name": "Heat stress",
"evidence": "Overheating risk model, orientation and fabric description",
"acceptance": "Assess comfort/heat resilience design response"
},
{
"id": "PI-13-11",
"domain": "13",
"seq": 11,
"name": "Environmental permits",
"evidence": "EA or relevant regulator environmental permit register",
"acceptance": "Identify permitted operations nearby and planning relevance"
},
{
"id": "PI-14-01",
"domain": "14",
"seq": 1,
"name": "Existing floorplan confidence",
"evidence": "Existing plan E01, site measurements and source drawing register",
"acceptance": "Assess fit between plan geometry and reality; flag unknowns"
},
{
"id": "PI-14-02",
"domain": "14",
"seq": 2,
"name": "Measured gross internal area",
"evidence": "Measured survey floor areas and consistent area standard",
"acceptance": "Recalculate GIA and retain measurement convention"
},
{
"id": "PI-14-03",
"domain": "14",
"seq": 3,
"name": "Room dimensions",
"evidence": "Room-by-room measurements, photos and model dimensions",
"acceptance": "Verify room length, width, headroom and uncertainty"
},
{
"id": "PI-14-04",
"domain": "14",
"seq": 4,
"name": "Loadbearing wall location",
"evidence": "Structural survey, beam layout and wall investigation",
"acceptance": "Classify walls as structural/nonstructural before removal"
},
{
"id": "PI-14-05",
"domain": "14",
"seq": 5,
"name": "Roof structure",
"evidence": "Roof survey, sections and structural engineer assessment",
"acceptance": "Identify rafters, trusses, loads and loft change limitations"
},
{
"id": "PI-14-06",
"domain": "14",
"seq": 6,
"name": "Stair configuration",
"evidence": "Surveyed staircase, dimensions and compliant design criteria",
"acceptance": "Check access, headroom, dimensions and proposed alterations"
},
{
"id": "PI-14-07",
"domain": "14",
"seq": 7,
"name": "Fire compartmentation",
"evidence": "Fire strategy, survey and compartment layout model",
"acceptance": "Verify separation, fire doors and fire-resisting elements"
},
{
"id": "PI-14-08",
"domain": "14",
"seq": 8,
"name": "Means of escape",
"evidence": "Escape routes, exits, occupancy and fire safety design review",
"acceptance": "Evaluate safe escape and record professional sign-off needs"
},
{
"id": "PI-14-09",
"domain": "14",
"seq": 9,
"name": "Thermal performance",
"evidence": "EPC/fabric data, thermal survey or building-services calculations",
"acceptance": "Assess energy-upgrade implications and design requirements"
},
{
"id": "PI-14-10",
"domain": "14",
"seq": 10,
"name": "MEP route mapping",
"evidence": "MEP survey, utility layouts and ISIE routing drawing",
"acceptance": "Detect service routes impacted by partitions/alterations"
},
{
"id": "PI-14-11",
"domain": "14",
"seq": 11,
"name": "Building condition",
"evidence": "Condition survey, defects register and dated photographs",
"acceptance": "Identify defects that make proposed work unsafe or impractical"
},
{
"id": "PI-14-12",
"domain": "14",
"seq": 12,
"name": "Internal model quality gate",
"evidence": "Versioned E01/P02 model, QA checklist and reviewer validation",
"acceptance": "Record model reliability before issuing construction-ready drawings"
},
{
"id": "PI-15-01",
"domain": "15",
"seq": 1,
"name": "Existing use class",
"evidence": "LPA use-class evidence, lawful-use records and planning history",
"acceptance": "Validate existing use; do not infer from occupancy alone"
},
{
"id": "PI-15-02",
"domain": "15",
"seq": 2,
"name": "HMO licensing area",
"evidence": "LPA mandatory HMO licensing and geographical coverage records",
"acceptance": "Assess scheme/occupancy applicability for actual property"
},
{
"id": "PI-15-03",
"domain": "15",
"seq": 3,
"name": "Additional licensing scheme",
"evidence": "LPA additional licensing designation and effective dates",
"acceptance": "Check occupancy/type against live scheme boundaries"
},
{
"id": "PI-15-04",
"domain": "15",
"seq": 4,
"name": "Selective licensing",
"evidence": "LPA selective licensing designation, dates and exemptions",
"acceptance": "Check applicability to tenure/use and property location"
},
{
"id": "PI-15-05",
"domain": "15",
"seq": 5,
"name": "Article 4 HMO",
"evidence": "Article 4 HMO direction instrument and map",
"acceptance": "Determine whether C3/C4 rights have been removed at site"
},
{
"id": "PI-15-06",
"domain": "15",
"seq": 6,
"name": "Occupancy standards",
"evidence": "Occupancy plan, household composition and council standards",
"acceptance": "Determine threshold, amenity and management obligations"
},
{
"id": "PI-15-07",
"domain": "15",
"seq": 7,
"name": "Minimum room size",
"evidence": "Measured room dimensions and current statutory/local thresholds",
"acceptance": "Calculate usable floor area and compare to applicable standard"
},
{
"id": "PI-15-08",
"domain": "15",
"seq": 8,
"name": "Amenity standards",
"evidence": "Council HMO amenity standards and fitted room schedules",
"acceptance": "Check shared facilities, fire protections and amenities"
},
{
"id": "PI-15-09",
"domain": "15",
"seq": 9,
"name": "Lawful use evidence",
"evidence": "Tenancy/occupancy records, council tax and lawful-use certificates",
"acceptance": "Create a defensible use chronology for planning review"
},
{
"id": "PI-15-10",
"domain": "15",
"seq": 10,
"name": "Licensing requirement conclusion",
"evidence": "Licensing scheme, proposed occupancy and evidence summary",
"acceptance": "Conclude licences potentially needed separately from planning"
},
{
"id": "PI-16-01",
"domain": "16",
"seq": 1,
"name": "Neighbouring planning proposals",
"evidence": "Nearby LPA applications map, approved plans and decision dates",
"acceptance": "Identify adjacent schemes and relevant cumulative impacts"
},
{
"id": "PI-16-02",
"domain": "16",
"seq": 2,
"name": "Nearby construction constraints",
"evidence": "Street works programmes and construction/logistics surveys",
"acceptance": "Flag site access, working hour and compound constraints"
},
{
"id": "PI-16-03",
"domain": "16",
"seq": 3,
"name": "Infrastructure projects",
"evidence": "Public infrastructure scheme maps and project timetables",
"acceptance": "Record announced works that may affect buildability/access"
},
{
"id": "PI-16-04",
"domain": "16",
"seq": 4,
"name": "Transport accessibility",
"evidence": "Public transport, route/stop proximity and accessibility analysis",
"acceptance": "Evaluate site access options and relevant local standards"
},
{
"id": "PI-16-05",
"domain": "16",
"seq": 5,
"name": "Local market context",
"evidence": "Market/valuation comparables with date and basis noted",
"acceptance": "Record commercial context separately from planning feasibility"
},
{
"id": "PI-16-06",
"domain": "16",
"seq": 6,
"name": "Environmental impact context",
"evidence": "Noise, ecology, access and environmental baseline comparison",
"acceptance": "Assess local impacts and where professional studies are needed"
},
{
"id": "PI-16-07",
"domain": "16",
"seq": 7,
"name": "Site opportunity envelope",
"evidence": "Constraint-free envelope polygon and candidate design dimensions",
"acceptance": "Trace usable buildable zone after all confirmed setbacks"
},
{
"id": "PI-16-08",
"domain": "16",
"seq": 8,
"name": "Design alternatives",
"evidence": "Versioned alternatives and comparative rule/impact assessment",
"acceptance": "Show design choices, trade-offs and issues resolved/not resolved"
},
{
"id": "PI-16-09",
"domain": "16",
"seq": 9,
"name": "Buildability conditions",
"evidence": "Construction access, materials, structural and services plan",
"acceptance": "Identify programme/cost feasibility gating risks"
},
{
"id": "PI-16-10",
"domain": "16",
"seq": 10,
"name": "Development risk register",
"evidence": "Risk register with likelihood, effect, owner and mitigations",
"acceptance": "Maintain mitigations and residual risks through decision changes"
},
{
"id": "PI-17-01",
"domain": "17",
"seq": 1,
"name": "Evidence source coverage",
"evidence": "Dataset/source coverage matrix for all applicable checks",
"acceptance": "Quantify gaps and ensure absent records are not treated as passes"
},
{
"id": "PI-17-02",
"domain": "17",
"seq": 2,
"name": "Source publication date",
"evidence": "Provider publication/edition date recorded with each result",
"acceptance": "Identify stale inputs and policy/version validity"
},
{
"id": "PI-17-03",
"domain": "17",
"seq": 3,
"name": "Retrieval timestamp",
"evidence": "Timestamped API/portal retrieval logs with timezone",
"acceptance": "Prove when evidence was actually accessed"
},
{
"id": "PI-17-04",
"domain": "17",
"seq": 4,
"name": "Evidence licence",
"evidence": "Dataset licence and permitted reuse conditions",
"acceptance": "Check redistribution, caching and export rights"
},
{
"id": "PI-17-05",
"domain": "17",
"seq": 5,
"name": "Geospatial confidence",
"evidence": "Geospatial accuracy metadata and geometry reconciliation checks",
"acceptance": "Record scale, CRS, tolerance and boundary uncertainty"
},
{
"id": "PI-17-06",
"domain": "17",
"seq": 6,
"name": "Property match confidence",
"evidence": "UPRN/address/title identity match metrics and mismatch notes",
"acceptance": "Define confidence threshold for proceeding to rules"
},
{
"id": "PI-17-07",
"domain": "17",
"seq": 7,
"name": "Rule applicability",
"evidence": "Rule-id/version, facts, applicability reasons and exclusions",
"acceptance": "Record exact logic and sufficient explanation of verdict"
},
{
"id": "PI-17-08",
"domain": "17",
"seq": 8,
"name": "Conflict escalation",
"evidence": "Conflict queue, severity, owner and review decision log",
"acceptance": "Escalate red findings and preserve reviewer rationale"
},
{
"id": "PI-17-09",
"domain": "17",
"seq": 9,
"name": "Missing documents",
"evidence": "Missing-file list, source owner and requested due date",
"acceptance": "Track required record acquisition to closure"
},
{
"id": "PI-17-10",
"domain": "17",
"seq": 10,
"name": "Survey request",
"evidence": "Physical/digital survey brief, booking, scope and evidence return",
"acceptance": "Match survey deliverables to the outstanding check list"
},
{
"id": "PI-17-11",
"domain": "17",
"seq": 11,
"name": "Professional sign-off",
"evidence": "Named competent reviewer, review notes and dated approval",
"acceptance": "Record sign-off and explicit limitations for issued findings"
},
{
"id": "PI-17-12",
"domain": "17",
"seq": 12,
"name": "Officer review queue",
"evidence": "LPA case/consultation reference and officer review outcome",
"acceptance": "Separate officer feedback from issued statutory decisions"
},
{
"id": "PI-17-13",
"domain": "17",
"seq": 13,
"name": "Report version control",
"evidence": "Model, dataset, rules and report version history",
"acceptance": "Reproduce the report and identify what changed since prior issue"
},
{
"id": "PI-17-14",
"domain": "17",
"seq": 14,
"name": "Planning readiness gate",
"evidence": "Completed checklist, exception register and sign-off summary",
"acceptance": "Prevent release while mandatory inputs or critical issues remain"
}
];
