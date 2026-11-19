# Loading data for the 228-parameter register

47 datasets feed 53 checks. Every dataset is loaded **once, onto your own server** (the Postgres behind `DATABASE_URL`), then looked up per application. The engine never downloads anything itself and never treats a dataset that is not loaded as "clear": the check says *awaiting data* until the data is there.

## How to load a dataset (about ten minutes each, on the VPS or your own machine)

1. **Once:** `npm run db:schema:geo` creates the tables (`geo_features`, `geo_meta`, `lpa_standards`). Plain Postgres, no PostGIS. Use the *direct* connection string in `DATABASE_DIRECT_URL`, not the pooler.
2. Download the dataset from its publisher (see below) and copy it to the machine that runs the import (`scp file.zip you@vps:/data/`).
3. Convert it to GeoJSON or newline-delimited GeoJSON in WGS84, or leave it in British National Grid and pass `--crs 27700`. For shapefiles / GeoPackage: `ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 out.geojsonl Source.shp`. CSVs with a postcode column need no conversion.
4. Check it first: add `--dry-run`. It prints the row count, the first row and the bounding box (should be inside Great Britain: longitude about -8 to 2, latitude about 50 to 59).
5. Load it: run the command shown for the dataset. Re-running **replaces** that dataset (and council) in one transaction. If the file covers only part of the country add `--partial`, so a point outside the extract stays *unavailable* rather than *outside*.
6. No restart needed: the app re-reads what is loaded within a minute. Open `/api/applications/<id>/intelligence` and the checks move from *awaiting data* to a real reading.

Banded datasets (flood risk, shrink-swell, landslide, night lights, heat) need `--rating-field` pointing at the band column, otherwise every feature ranks as unknown. Council standards (parking, cycle, density, SuDS, privacy) are numbers, not maps: see the last section.

## A. Open national datasets - load once for the whole country (or the region you serve)

| Dataset | Feeds checks | Publisher | Licence | What to ask for |
|---|---|---|---|---|
| `pins-appeals` Planning Inspectorate appeal decisions | PI-04-08 Appeal decisions | Planning Inspectorate | Open Government Licence v3.0 (check the publisher's current terms) | CONFIRMED: gov.uk "Planning Inspectorate Casework Database" (Excel, about 21 MB, 5-year rolling, updated about monthly; page https://www.gov.uk/government/publications/planning-inspectorate-appeals-database). It has site addresses but no coordinates: run npm run prepare:open-data -- appeals --file <xlsx> --out appeals.geojsonl, which places each appeal at its postcode centre (props: appealRef, decision, decidedOn, appealType, lpa, address, postcode, locationBasis). |
| `ea-rofsw` Risk of Flooding from Surface Water | PI-08-02 Surface water risk | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA "Risk of Flooding from Surface Water" extents. Import with --rating-field to the band column (Very low/Low/Medium/High). |
| `ea-historic-flood` Recorded flood outlines / Historic Flood Map | PI-08-03 Historic flooding | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA Recorded Flood Outlines (and Historic Flood Map). props: source, startDate, cause. |
| `ea-reservoir-flood` Reservoir flood extents | PI-08-05 Reservoir inundation | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA "Risk of Flooding from Reservoirs" (wet day / dry day). props: scenario. |
| `ea-flood-defences` Flood defence assets | PI-08-06 Flood defence proximity | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA Spatial Flood Defences (including standardised attributes): ALSO READ LIVE from https://environment.data.gov.uk/spatialdata/spatial-flood-defences-including-standardised-attributes/ogc/features/v1 when this dataset is not loaded. Load it only to use your own extract. props: type, condition, standardOfProtection. |
| `ea-main-river` Main river network | PI-08-07 Main river proximity | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA Statutory Main River Map: ALSO READ LIVE from https://environment.data.gov.uk/spatialdata/statutory-main-river-map/ogc/features/v1 when this dataset is not loaded. Load it only to use your own extract. props: tidal (true/false), name. |
| `ea-climate-allowance` Climate change allowances by management catchment | PI-08-15 Climate change allowance | Environment Agency | Open Government Licence v3.0 (check the publisher's current terms) | EA climate change allowances: management-catchment polygons with the allowance values as props (e.g. central2080, higher2080, upper2080). |
| `ofcom-broadband` Broadband availability by postcode | PI-10-14 Broadband connectivity | Ofcom (Connected Nations) | Open Government Licence v3.0 (check the publisher's current terms) | CONFIRMED: Ofcom Connected Nations fixed coverage by postcode, 121 CSV files (one per postcode area, e.g. 202601_fixed_postcode_coverage_r2_XX.csv), Open Government Licence, key column postcode_space. Unzip the folder, then npm run prepare:open-data -- ofcom --dir <folder> --out ofcom-fixed.csv; the coverage columns are kept with their published names and shown as they are. |
| `heat-networks` Heat network projects (DESNZ Heat Networks Planning Database) | PI-10-15 District heating network | DESNZ | Open Government Licence v3.0 (check the publisher's current terms) | CONFIRMED: DESNZ Heat Networks Planning Database (HNPD) on data.gov.uk, quarterly CSV or Excel, OGL, with National Grid X/Y per project. It lists PROJECTS (points), not zoned areas: npm run prepare:open-data -- hnpd --file <csv/xlsx> --out heat.geojsonl. Heat network zoning polygons can still be loaded here too (props: operator, status) where a council or DESNZ publishes them. |
| `aqma` Air Quality Management Areas | PI-13-01 Air Quality Management Area | DEFRA (UK-AIR) / local authorities | Open Government Licence v3.0 (check the publisher's current terms) | CONFIRMED and ALSO READ LIVE: planning.data.gov.uk dataset air-quality-management-area (Defra, OGL, about 500 areas, still being completed). Bulk files: https://files.planning.data.gov.uk/dataset/air-quality-management-area.geojson . Load it to use your own copy or to add council-declared areas. props: name, reference, documentation-url. |
| `noise-strategic` Strategic noise maps | PI-13-02 Noise exposure | DEFRA | Open Government Licence v3.0 (check the publisher's current terms) | Defra strategic noise mapping round 4 (2022) is published as a RASTER (WCS), which the engine samples live for road noise (see providers/openLayers.js). To use vector contours instead (earlier rounds are on the EA/Defra OGC API, or your own conversion), load polygons with numeric props.lden (dB) and props.source. |
| `heat-stress` Urban heat / overheating risk | PI-13-10 Heat stress | UKCP / Met Office / local climate adaptation data | Open Government Licence v3.0 (check the publisher's current terms) | Urban heat-island or overheating-risk bands as polygons with a risk column. |
| `env-permits` Environmental permits | PI-13-11 Environmental permits | Environment Agency | Environment Agency CONDITIONAL licence for the industrial-installations download (not the Open Government Licence): read https://www.gov.uk/government/publications/environment-agency-conditional-licence/environment-agency-conditional-licence before loading | EA "Environmental Permitting Regulations - Industrial Sites" (quarterly ZIP in a GIS/Access format on environment.data.gov.uk: convert with ogr2ogr first) and the Waste Operations download. Both are published under EA licences, check which applies. props: permitType, operator, status. |
| `infrastructure-projects` Infrastructure projects | PI-16-03 Infrastructure projects | Planning Inspectorate (NSIP) / HS2 / councils | Open Government Licence v3.0 (check the publisher's current terms) | NSIP project boundaries, HS2 safeguarding, council regeneration schemes. props: project, stage, expectedStart. |

```
npm run import:geo -- --dataset pins-appeals --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-rofsw --file <file.geojsonl> --rating-field <risk column> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-historic-flood --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-reservoir-flood --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-flood-defences --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-main-river --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ea-climate-allowance --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset ofcom-broadband --file <file.csv> --key-field <postcode column> --source "<publisher, version/date>"
npm run import:geo -- --dataset heat-networks --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset aqma --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset noise-strategic --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset heat-stress --file <file.geojsonl> --rating-field <risk column> --source "<publisher, version/date>"
npm run import:geo -- --dataset env-permits --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset infrastructure-projects --file <file.geojsonl> --source "<publisher, version/date>"
```

## B. National datasets with their own re-use terms - confirm the terms, then load

| Dataset | Feeds checks | Publisher | Licence | What to ask for |
|---|---|---|---|---|
| `comah-sites` Hazardous installations (COMAH) and consultation zones | PI-13-05 Hazardous installation proximity | HSE | HSE data - confirm re-use terms | NOT CONFIRMED as a national open dataset: HSE offers a public search of COMAH establishments, and some councils publish zones. Load only a file whose licence you have checked. Put the consultation-zone radius in props.radiusM. |
| `night-lights` Night-time light levels | PI-13-09 Light pollution | CPRE | CPRE - confirm re-use terms | CPRE night blight / dark skies data banded to a band column. |

```
npm run import:geo -- --dataset comah-sites --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset night-lights --file <file.geojsonl> --rating-field <band column> --source "<publisher, version/date>"
```

## C. Council data - one load PER council (--authority <code>)

| Dataset | Feeds checks | Publisher | Licence | What to ask for |
|---|---|---|---|---|
| `council-conditions` Planning conditions and discharge records | PI-04-04 Condition discharge<br>PI-04-14 Condition compliance | Local planning authority | Council-published: check each council's licence and whether it publishes the dataset at all | Decision-notice conditions and discharge decisions from the council register. One row per condition. props: appRef, condition, status (discharged / pending / breached / part-discharged), decidedOn, url. |
| `council-enforcement` Enforcement notices | PI-04-05 Enforcement notices | Local planning authority | Council-published: check each council's licence and whether it publishes the dataset at all | Enforcement register. props: noticeType, issuedOn, status (live / complied / withdrawn / appealed), ref, url. |
| `council-obligations` Planning obligations and Section 106 agreements | PI-04-10 Planning obligations<br>PI-04-11 Section 106 agreements | Local planning authority | Council-published: check each council's licence and whether it publishes the dataset at all | Section 106 / legal agreement register. props: type (s106 / unilateral undertaking / s278 ...), dated, obligations, status, ref, url. |
| `council-commencements` Commencement and building-control start records | PI-04-13 Implementation status | Local planning authority / building control | Council-published: check each council's licence and whether it publishes the dataset at all | Commencement notices, building-control initial notices/completion. props: appRef, commencedOn, completedOn, status. |
| `local-list` Locally listed heritage assets | PI-07-05 Locally listed assets | Local planning authority | Council-published: check each council's licence and whether it publishes the dataset at all | Local heritage list (points or outlines). props: assetName, criteria. |
| `archaeological-priority` Archaeological priority areas / HER | PI-07-06 Archaeological priority area | Historic Environment Record / local authority | Council-published: check each council's licence and whether it publishes the dataset at all | APA / archaeological notification area boundaries. props: tier, description. |
| `protected-views` Protected view corridors | PI-07-08 Protected views | Local planning authority / GLA (LVMF) | Council-published: check each council's licence and whether it publishes the dataset at all | Protected vista / view-corridor polygons (e.g. LVMF). props: viewName, heightLimitM. |
| `ordinary-watercourse` Ordinary watercourses | PI-08-08 Ordinary watercourse | Lead Local Flood Authority | Council-published: check each council's licence and whether it publishes the dataset at all | LLFA ordinary-watercourse / culvert map. props: name, culverted. |
| `traffic-orders` Traffic regulation orders and CPZ | PI-11-11 Parking restrictions | Highway authority | Council-published: check each council's licence and whether it publishes the dataset at all | TRO / CPZ extents and restrictions. props: type (CPZ / double yellow / resident bay ...), hours, orderRef. |
| `highway-adoption` Adopted highway extent | PI-11-12 Highways dedication | Highway authority (adoption records) | Council-published: check each council's licence and whether it publishes the dataset at all | Adopted highway boundary polygons (the extent the council maintains). props: street, adoptedOn. |
| `street-works-restrictions` Street works and road-opening restrictions | PI-11-13 Road opening constraints | Highway authority (permit scheme / embargo) | Council-published: check each council's licence and whether it publishes the dataset at all | Protected streets, embargoes, permit-scheme coverage. props: restriction, from, to. |
| `species-records` Protected species records | PI-12-06 Protected species potential | Local Environmental Records Centre | LERC data-sharing terms (usually paid / conditional) | Records centre extract (points). props: species, protected (true/false), recordedOn. |
| `contaminated-land` Contaminated land register / potentially contaminated sites | PI-13-03 Contaminated land register | Local authority (Part 2A register) | Council-published: check each council's licence and whether it publishes the dataset at all | Part 2A register and council potentially-contaminated-land inventory. props: status, determinedOn, contaminant. |
| `hmo-register` Licensed HMO register | PI-15-02 HMO licensing area | Local housing authority | Council-published: check each council's licence and whether it publishes the dataset at all | Public HMO licence register. props: licenceNo, maxOccupants, expires. |
| `licensing-additional` Additional HMO licensing designation | PI-15-03 Additional licensing scheme<br>PI-15-10 Licensing requirement conclusion | Local housing authority | Council-published: check each council's licence and whether it publishes the dataset at all | Designation boundary. props: effectiveFrom, effectiveTo, scope. |
| `licensing-selective` Selective licensing designation | PI-15-04 Selective licensing<br>PI-15-10 Licensing requirement conclusion | Local housing authority | Council-published: check each council's licence and whether it publishes the dataset at all | Designation boundary. props: effectiveFrom, effectiveTo, exemptions. |

```
npm run import:geo -- --dataset council-conditions --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset council-enforcement --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset council-obligations --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset council-commencements --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset local-list --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset archaeological-priority --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset protected-views --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset ordinary-watercourse --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset traffic-orders --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset highway-adoption --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset street-works-restrictions --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset species-records --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset contaminated-land --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset hmo-register --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset licensing-additional --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
npm run import:geo -- --dataset licensing-selective --file <file.geojsonl> --authority <code> --source "<publisher, version/date>"
```

## D. Licensed / paid / utility data - only under your own licence agreement

| Dataset | Feeds checks | Publisher | Licence | What to ask for |
|---|---|---|---|---|
| `bgs-groundwater-flood` Groundwater flooding susceptibility | PI-08-04 Groundwater flooding | British Geological Survey | Licensed / paid - load only under your own licence agreement | BGS Groundwater Flooding Susceptibility. rating text containing: limited / below ground / at surface. |
| `water-capacity` Drainage / water network capacity | PI-08-09 Drainage capacity | Water company | Licensed / paid - load only under your own licence agreement | Water-company capacity or drainage-area records as polygons. props: capacityStatus (available / constrained / upgrade-required), catchment. |
| `sewers` Public sewer network | PI-08-10 Public sewer proximity<br>PI-10-11 Surface water sewer<br>PI-10-12 Foul sewer | Water company / sewerage undertaker | Licensed / paid - load only under your own licence agreement | Sewer records (lines). props: type (foul / surface / combined), diameterMm, adopted (true/false). |
| `drainage-easements` Drainage easements | PI-08-14 Drainage easement | Water company / HM Land Registry deeds | Licensed / paid - load only under your own licence agreement | Easement strips or centrelines. props: width, deedRef. |
| `bgs-shrink-swell` Shrink-swell clay (GeoSure) | PI-09-07 Ground stability<br>PI-09-15 Foundation sensitivity | British Geological Survey | Licensed / paid - load only under your own licence agreement | BGS GeoSure shrink-swell hazard A (lowest) to E (highest). |
| `bgs-faults` Geological faults | PI-09-08 Geological faults | British Geological Survey | Licensed / paid - load only under your own licence agreement | BGS 1:50,000 fault lines. props: name, type. |
| `bgs-landslide` Landslide susceptibility (GeoSure) | PI-09-09 Landslip susceptibility | British Geological Survey | Licensed / paid - load only under your own licence agreement | BGS GeoSure landslide hazard A to E. |
| `radon` Radon potential | PI-09-10 Radon potential | UKHSA / BGS | Licensed / paid - load only under your own licence agreement | UK Radon potential map. Numeric props.percent = highest % of homes above the action level in the band. |
| `dno-cables` Underground electricity cables | PI-10-02 Underground electricity cables | Distribution Network Operator | Licensed / paid - load only under your own licence agreement | DNO record plans (digitised lines). props: voltage, owner. Always field-verify before digging. |
| `dno-easements` Electricity easements and wayleaves held by the DNO | PI-10-04 Electricity easement | Distribution Network Operator | Licensed / paid - load only under your own licence agreement | DNO easement / wayleave extents. props: deedRef, width. |
| `gas-mains` Gas mains | PI-10-09 Gas mains | Gas network operator | Licensed / paid - load only under your own licence agreement | Gas distribution main plans (lines). props: pressure, material. |
| `water-mains` Water mains | PI-10-10 Water mains | Water company | Licensed / paid - load only under your own licence agreement | Water mains plans (lines). props: diameterMm, material. |
| `telecom-ducts` Telecommunications ducts | PI-10-13 Telecommunication duct | Openreach / telecoms operators | Licensed / paid - load only under your own licence agreement | Duct/cable route records. props: operator. |
| `utility-wayleaves` Utility wayleave agreements | PI-10-16 Utility wayleave | Utility operators | Licensed / paid - load only under your own licence agreement | Wayleave agreement extents. props: operator, agreementRef. |
| `historic-industrial` Historic industrial land use | PI-13-04 Historic industrial use | OS historic mapping / Landmark / Groundsure | Licensed / paid - load only under your own licence agreement | Digitised historic land-use polygons/points. props: use, era. |

```
npm run import:geo -- --dataset bgs-groundwater-flood --file <file.geojsonl> --rating-field <rating column> --source "<publisher, version/date>"
npm run import:geo -- --dataset water-capacity --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset sewers --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset drainage-easements --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset bgs-shrink-swell --file <file.geojsonl> --rating-field <rating column> --source "<publisher, version/date>"
npm run import:geo -- --dataset bgs-faults --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset bgs-landslide --file <file.geojsonl> --rating-field <rating column> --source "<publisher, version/date>"
npm run import:geo -- --dataset radon --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset dno-cables --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset dno-easements --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset gas-mains --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset water-mains --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset telecom-ducts --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset utility-wayleaves --file <file.geojsonl> --source "<publisher, version/date>"
npm run import:geo -- --dataset historic-industrial --file <file.geojsonl> --source "<publisher, version/date>"
```

## Council standards (parking, cycle parking, density, SuDS, privacy)

These are numbers from each council's adopted documents, loaded per council with `npm run import:geo -- --standards standards.json --authority <code>`. Topics: `parking`, `cycle`, `density`, `suds`, `privacy`. Every topic must name its **source** (the policy or document) so each figure can be traced; the file format is documented at the top of `src/register/standards.js`. A council with no row gets *awaiting data*, never a guessed number.

## Not loaded, by design

Registered proprietor, covenants, easements, rights of way, deeds, load-bearing walls, bat and bird surveys and similar checks cannot come from a dataset: they come from documents and people. The engine takes them as **evidence** (`POST /api/applications/:id/evidence/:checkId`), shows what the evidence says, and only a **named reviewer** can verify it (`POST /api/applications/:id/sign-off/:checkId`, needs `REVIEWER_TOKEN`).

## Suggested order

1. Environment Agency flood datasets (surface water, historic floods, reservoirs, defences, main river, climate allowances): six checks from one publisher.
2. Your pilot councils' council data (conditions, enforcement, S106, local list, archaeology, traffic orders, HMO / selective licensing) - these decide most real-world refusals.
3. DEFRA noise and AQMA, HSE COMAH, Ofcom broadband, then the licensed BGS / utility data once the licence is signed.