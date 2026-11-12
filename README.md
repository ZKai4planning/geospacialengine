# UK Planning Application Engine (Node.js)

Postcode / address look-up → applicant confirms → the engine captures **address, postcode, id/UPRN, coordinates**,
shows **street view** and an **aerial photo**, then draws the **proposed work on the map** (rear extension, side extension,
wraparound, porch, loft dormer, extra storey, garden outbuilding) next to the existing house outline, and screens it against
permitted-development rules.

## Quick start
```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000   (no keys needed – see "Providers")
MOCK_PROVIDERS=true npm run dev   # fully offline demo: postcode E6 2AA -> 22 Example Road
npm test
```
Without `DATABASE_URL` the app still runs locally (drafts in memory, no UPRN matching). To use Postgres and deploy, see **Deploy: Postgres + Vercel** below.

## Flow
1. `GET /api/address/search?q=` – full postcode (lists every address), partial postcode (suggests postcodes) or free-text address (type-ahead).
2. Applicant confirms → `POST /api/applications {"id":"<uprn or osm:way:123>"}`. The server re-fetches the address by id (never trusts client text), finds the building outline + nearby roads, planning constraints, planning authority, and street photo coverage.
3. Applicant picks a **type of work** (`GET /api/work-types` describes every type and its fields – the UI form is generated from it) → `PUT /api/applications/:id/proposal`.
4. Response contains the cards, the **map overlay** (`map.layers[].path` in the aerial image's pixel space + GeoJSON) and the **assessment**.

## How the map outline is drawn
- The house outline comes from OSM (or OS NGD if you add it). We fit the minimum-area rectangle to it.
- The **front** of the house is the side facing the nearest road (fallbacks: street-photo camera position → user choice → assumed south). The **rear** is the opposite side. `PATCH /profile {frontBearingDeg}` overrides it (the UI has a "Swap" link).
- Each work type has a geometry builder (`src/services/proposalGeometry.js`) that places a polygon relative to the rear wall: rear/side/wraparound/porch outside the house, dormer and extra storey on the roof (hatched), outbuilding in the garden at a set-back distance.
- An existing extension is drawn inside the outline (or beyond it if the outline excludes it) and new rear work starts after it.
- The aerial image and the overlay share one Web-Mercator `view`, so they line up exactly. Nothing is baked into the image – it is an SVG layer, so any map library can use `map.geojson` instead.
- If no outline exists, an indicative 5.5 × 9 m terrace is shown and flagged `indicative: true`.

## Providers – you do NOT need Google or OS keys
| Need | No key | With key / token |
|---|---|---|
| Addresses | **OpenStreetMap** (Photon type-ahead + Overpass by postcode) | OS Places (UPRN, official classification) |
| Aerial photo | **Esri World Imagery** | Google Maps Static |
| Street-level photo | **Mapillary** (free token) | Google Street View |
| Postcode → area, country | postcodes.io | – |
| Building outline / roads | OpenStreetMap Overpass | OS NGD (write one provider) |
| Constraints | planning.data.gov.uk | – |

Select with `ADDRESS_PROVIDER`, `AERIAL_PROVIDER`, `STREETVIEW_PROVIDER` (`auto` picks the best for the keys you set).
Other options you could add behind the same tiny interfaces: getAddress.io / Ideal Postcodes (addresses + UPRN), Mapbox / Bing (aerial), Geoapify / LocationIQ (geocoding).

Trade-offs of the keyless set-up:
- OSM addresses have **no UPRN** (the id is `osm:way:123`) and coverage is incomplete in places. Planning submissions normally want a UPRN – add OS Places, or enrich later via the council/Planning Portal.
- Public Photon/Overpass/Esri endpoints are shared services with fair-use limits and Esri/Mapillary have attribution & licence terms – self-host Photon/Overpass or buy a plan for production.
- Mapillary only has photos where contributors have driven; otherwise the card shows a "no photo found" placeholder.

## Deploy: Postgres + Vercel (nothing stored locally)

Vercel's filesystem is read-only and throw-away, so the app keeps **no state on disk**: `public/` is served from Vercel's CDN, the Express app runs as one serverless
function (`api/index.js`), and everything persistent lives in **Postgres** – the OS Open UPRN table (41.7M points for GB) and the application drafts.
Any standard Postgres works (DigitalOcean Managed Postgres, Neon, RDS, …); the steps below use DigitalOcean.

### 1. Create the database (once)
1. DigitalOcean → Databases → create a **PostgreSQL** cluster in the region nearest your Vercel region (`vercel.json` pins functions to London, `lhr1`; change `regions` to match, e.g. London `LON1` ↔ `lhr1`).
   Pick a plan with at least **10 GB disk**: the full GB dataset is roughly 4–5 GB including indexes (estimate; the importer prints the real size). To fit a smaller plan load one region with `--bbox` (London ≈ 6M rows).
2. Cluster → **Connection Pools** → create a pool (mode **Transaction**). Note both strings from *Connection details*:
   - **Direct** (port 25060) – used only by the importer on your machine.
   - **Pool** (port 25061) – used by Vercel.
3. Cluster → **Settings → Trusted sources**: Vercel functions have no fixed IP by default, so you must either allow all sources (rely on the strong password + TLS) or use Vercel's paid *Static IPs* and trust only those.
4. Create the tables and functions (after step 2 below has put the strings in `.env`): `npm run db:schema`
   (or, if you have `psql`: `psql "<DIRECT connection string>" -f db/schema.sql`).

### 2. Load the UPRN data (once, from your own machine)
```bash
npm install
# .env: DATABASE_DIRECT_URL=<direct string>, DATABASE_URL=<pool string>  (optionally DATABASE_CA_CERT, see .env.example)
npm run import:uprn -- --sqlite data/open-uprn.sqlite       # migrate the file you already built (needs Node 22.5+ or `npm i -D better-sqlite3`)
npm run import:uprn -- --csv "C:\data\osopenuprn_202609.csv" # or load straight from the OS CSV
npm run import:uprn -- --sqlite data/open-uprn.sqlite --bbox 51.28,-0.52,51.70,0.34   # one region only (London here)
npm run diagnose                                             # confirms the connection + shows UPRNs near a test postcode
```
After it finishes you can delete `data/open-uprn.sqlite` (1.7 GB) – it is never deployed (`.gitignore` / `.vercelignore`).

### 3. Vercel
1. Push the project to GitHub (`data/`, `.env`, `node_modules` are git-ignored) and **Import** it in Vercel. `vercel.json` already forces *Framework: Other* (so Vercel does not try to run the Express app itself) and serves `public/` as static files; leave the dashboard build/output settings alone. If the project was first imported with the *Express* preset, set **Settings → Build & Development → Framework Preset** to *Other* and redeploy.
2. **Settings → Environment Variables**: add `DATABASE_URL` (the **pool** string), `HTTP_USER_AGENT` (with a contact URL/email – Overpass blocks anonymous clients), and any of `DATABASE_CA_CERT`, `OS_DATA_HUB_KEY`, `MAPILLARY_TOKEN`, `GOOGLE_MAPS_API_KEY`, `CORS_ORIGINS`. Do **not** add `DATABASE_DIRECT_URL`.
3. Deploy. Check `https://<your-app>.vercel.app/health`. Or from the CLI: `npm i -g vercel && vercel --prod`.

**If the site shows `500 FUNCTION_INVOCATION_FAILED`:** open `https://<your-app>.vercel.app/health`. A startup problem now returns JSON such as
`{"error":"startup_failed","message":"..."}` naming the cause (a bad environment variable, an invalid `DATABASE_URL`, a missing package). The full error is also in
Vercel → your project → **Logs** (filter *Runtime Logs*; search `STARTUP FAILED`). Common causes: Framework Preset left on *Express*; a `DATABASE_URL` whose password has
unencoded special characters (`@` must be `%40`); a provider set to `google`/`mapillary` without its key. Once it works you can remove the JSON message from `api/index.js` if you prefer a generic error.

Notes for serverless:
- **Connections:** every warm instance holds its own small pool (`PG_POOL_MAX`, default 3). Always give Vercel the pooler string so many instances share a limited number of real database connections.
- **TLS:** the connection is encrypted. Without `DATABASE_CA_CERT` the server certificate is not verified; paste the cluster's CA certificate (DigitalOcean: *Download CA certificate*, newlines as `\n`) for full verification. `sslmode=` in the URL is ignored on purpose (see `src/utils/pgConfig.js`).
- Function timeout is 60 s (`vercel.json`) because the free OSM services can be slow. Hobby plans cap this; Pro/Fluid compute allow more.
- The in-memory cache (`lru-cache`) and rate limiter are **per instance** – fine for caching, but limits are not global. For strict limits use Vercel's firewall rate limiting or an external store.
- To purge old drafts, run `delete from applications where created_at < now() - interval '30 days';` on a schedule (see the end of `db/schema.sql`).

### OS Open UPRN – what it does
`osopenuprn_*.csv` (osdatahub.os.uk → OS Open UPRN) holds **UPRN + coordinates only – no address text**, so it cannot list addresses for a postcode.
When an applicant confirms an OpenStreetMap or typed address, the engine finds the UPRN point nearest the address point and attaches it. For address *lists* the whole list is matched in **one** batched database call.
Matching: `high` confidence = one UPRN within 8 m and the next is ≥5 m further; otherwise `low` (flats, tightly packed terraces) and the UI asks the applicant to confirm,
with the candidate list in `address.uprnMatch.candidates`. Manual (postcode-centre) addresses are never matched. Setting: `OPEN_UPRN_MAX_M`.

## Map checks: neighbours and plot boundary

After the applicant picks a work type, the map highlights conflicts and a **Map checks** list explains them (`src/services/siteChecks.js`):

| Check | Data | Result |
|---|---|---|
| Neighbouring buildings | OpenStreetMap outlines within 40 m (`osmBuildings.js`) | **Red** if the proposal overlaps one (≥ 0.5 m²), **amber** if within 1 m, grey "adjoins" if it only shares a wall (party wall note) |
| Plot boundary | HM Land Registry `title-boundary` polygon via planning.data.gov.uk (`titleBoundary.js`), or an **estimated** outline when none matches (see *Plot outline*) | Title: boundary turns **red** and **fails** if the proposal sticks out more than 0.5 m beyond it. Estimate: **warns** only |

Rules of thumb built in, to avoid crying wolf: overlaps under 0.5 m² and anything within 0.5 m of the title line are treated as map noise; duplicate/part-of-house outlines are ignored;
if the title found does not contain the house (shared or split titles) the boundary check is skipped; roof-level work (dormer, extra storey) skips both checks; with no building outline found, both are skipped.
All thresholds are in `THRESHOLDS` at the top of `siteChecks.js`. Results are shown as **indicative** with a disclaimer and attribution; they are not planning verdicts and do not change the permitted-development assessment.

Data notes:
- The title boundary is not the legal boundary, and the planning.data.gov.uk `title-boundary` dataset may not cover every area yet; when none is found the check is simply skipped.
  Confirm the licence/attribution terms for your use (the data carries HM Land Registry and Ordnance Survey crown copyright wording).
- Do not derive these overlays by analysing Google imagery or tiles: Google's terms restrict extracting or tracing data from its content. Google stays display-only (satellite background, Street View).

## Draw your own shape, and roads / trees checks

**Draw my own shape** (work type `custom_polygon`). Instead of filling in a form, the applicant clicks the corners of the new building on the aerial photo.
Corners snap to house, neighbour and boundary corners (9 px), the first corner closes the shape, `Esc` finishes, `Backspace` undoes. From 3 corners the map and checks update live.
The server never trusts the browser: the ring is validated with zod (3-50 corners inside Great Britain, no self-crossing edges, 0.5-1000 m², within 120 m of the address; see `src/utils/drawn.js`).

A drawn shape is **measured in the house's own frame** (`measureDrawn` in `proposalGeometry.js`: across the plot, and metres beyond the rear wall) and screened as the kind of work chosen under *Screen it as*
(rear extension / side extension / outbuilding) by `src/services/customProposal.js`:
- rear extension depth is counted from the ORIGINAL rear wall, taking an existing extension into account (whether or not the OSM outline includes it);
- distance to the boundary is measured from the title boundary unless the applicant types one in (it drives the 2 m / 3 m eaves rule);
- if the shape does not look like the chosen work (e.g. in front of the house, screened as a rear extension) the verdict is withheld and the applicant is told to check the setting;
- with no building outline, the site checks still run (the shape is a real position) but PD screening is skipped, because there is nothing to measure against.

| Check | Data | Result |
|---|---|---|
| Roads | OSM `highway` ways: centreline + half the `width` tag (else a typical width per road class, `ROAD_WIDTH_M` in `src/utils/osmTags.js`) | **Fail** if it reaches 0.5 m or more onto the carriageway, **warn** within 1 m of its edge. Private driveways (`service=driveway`) are ignored |
| Trees | OSM `natural=tree` nodes, in the same Overpass request as the building | **Fail** if the trunk is within 0.5 m of the footprint, **warn** inside the estimated root protection area |
| Tree preservation zones | council TPO polygons, dataset `tree-preservation-zone` (planning.data.gov.uk) | **Warn** if the footprint is inside a zone (area / group / woodland), info if within 3 m. A zone says protected trees are somewhere in it, not where |
| Protected trees | council individual protected trees, dataset `tree` (planning.data.gov.uk) | Same checks as OSM trees (fail on the trunk, warn inside the root zone) but worded as **protected** and mentioning consent. An OSM tree within 3 m of one is the same tree and is dropped |
| Tree preservation (flag only) | `flags.tpo` | Used only when no zone outline could be fetched: a general note that consent is needed to cut or prune protected trees |

Root protection radius = 12 x trunk diameter, limited to 2-15 m (the BS 5837 rule of thumb), from OSM `diameter` / `circumference`; if that is missing, half the `diameter_crown`; else a cautious 5 m.
Each tree says which of the three was used. Limits you should know about:
- OSM tree coverage is patchy, so "no trees mapped" is an *info* note, never a pass. A tree on site that is not in OSM will not be seen.
- Woods, hedges and tree rows are deliberately **not** fetched (their geometry can be huge and they are not single trees). Individual trees only.
- Road widths and tree sizes are estimates. Being near a tree is a *warning*, not a verdict: whether foundations are acceptable is for an arboriculturist.
- Council tree data depends on which councils publish it; "none found" never means "none exist". Zones are approximate outlines.
- Protected trees without a trunk size use the outline's size as a crown estimate, else the cautious 5 m default, and say so.
- Do not derive trees or roads from Google or Esri imagery (licence). Environment Agency LiDAR (open licence) would be the next data source if you want better tree coverage.

### Adding your own checks (your algorithm)
All site checks are rules in `src/services/rules/` and run in order: neighbours, boundary, roads, tree zones, trees, then yours. A rule is `{ id, run(ctx, result) }`:

```js
// src/services/rules/custom.js
import { polyArea } from '../../utils/polygons.js';
export const customRules = [{
  id: 'coverage',
  run({ P, H, plot }, result) {                       // everything is in local metres
    if (!plot || !H) return;
    if ((polyArea(P) + polyArea(H)) / plot.areaM2 > 0.6) result.items.push({ status: 'warn', message: 'Covers over 60% of the plot.' });
  },
}];
```
`ctx` holds the proposal `P`, house `H`, `neighbours`, `plot`, `roads`, `trees`, `flags` and `T` (thresholds); the full list and a worked example are in `custom.js`.
`registerRule(rule)` adds one at runtime (returns an "undo" function, handy in tests). A rule that throws is caught and shown as an info line, so a bug in your algorithm cannot break the request.
Tune the built-in limits in `src/services/rules/thresholds.js`. Statuses (`fail` / `warn` / `pass` / `info`) are what the UI colours.

## Map window and large buildings

`chooseView()` in `src/services/mapService.js` picks the map zoom:

1. **Whole building fits (`view.fit = "all"`):** the most zoomed-in level (20 down to **15**, about a 1.9 km wide window) where the house, existing extension and proposal all sit inside the padded window. Level 15 covers factories, hospitals and large estates.
2. **Bigger than any window (`view.fit = "focus"`):** previously the search stopped at level 17, so a building over roughly 400 m long was cropped on every side and you saw a zoomed-in picture with only the outline running across it.
   Now the map frames what matters: the proposal if there is one, otherwise 60 m around the address. A note in **Map checks** says the outline continues beyond the edges.
3. The **scale bar** picks a round length (5 m to 1 km) that fits the zoom, instead of a fixed 5 m.

Tune `MIN_ZOOM`, `MAX_ZOOM`, `FOCUS_ZOOM`, `FOCUS_HALF_M` and `PAD` at the top of `mapService.js`. Aerial imagery (Esri or Google) is fetched for whatever view is chosen; tests are in `test/mapFit.test.js`.

## Plot outline: registered title, or an estimate (the red line round the property)

The map now frames the whole **plot** (house, drive, front and rear garden) and draws its outline in red, like a site plan. Where the outline comes from (`src/utils/plotEstimate.js`):

1. **Registered boundary** - first from **your own database** (HM Land Registry INSPIRE parcels, see the next section), then from the live planning.data.gov.uk service - when one is found **and matches the house**: it must contain the house (a corner within 1 m of the title line counts as inside, because walls often sit on it and OSM / Land Registry differ by up to a metre) and be bigger than the house alone.
2. Otherwise an **estimated plot outline**, computed only from open data we already hold (OSM buildings and roads, no imagery):
   - sides and rear: half way between this house and the neighbouring homes (a party wall is the line itself),
   - front: the back of the pavement (road centreline + half the carriageway + 2 m footway),
   - nothing mapped on a side: a default reach (8 m sideways, 25 m behind the rear wall, 8 m in front when no road is mapped),
   - sheds, garages, greenhouses and tiny outlines are not treated as neighbours, so they do not carve up a garden.
   - **mapped fences, walls and hedges** (OSM `barrier=fence|wall|hedge|retaining_wall`, fetched in the same Overpass request) that run alongside an edge within 3 m pull that edge onto the real line. A barrier must be parallel (within 15°) and cover at least 4 m / 35% of the edge, so a fence across the middle of the garden or a hedge round a vegetable patch is ignored; a snap that would cut into the house or take in a neighbour's corner is refused.
   It is calculated in the house's own frame, so a normal rectangular plot comes out as a clean four-cornered outline. **Front/back swap** redraws it.

An estimate is drawn **dashed**, labelled *Plot outline (estimated)*, carries `confidence` (`high` when all four sides are bounded by data and two or more follow mapped fences / walls / hedges; `medium` when at least three sides are bounded by data; else `low`) and `basis` (what bounded each side), and is **never a verdict**: the boundary rule only *warns* or *informs* for it, never fails, and its distance is not fed into the permitted-development 2 m / 3 m eaves rule.
A registered title still produces the full pass / fail check.

Map framing: `chooseView()` now fits the plot outline (plus house and proposal) with a tighter margin and, when the aerial source allows it (Esri; **not** Google Static Maps, which only draws whole zoom levels), in quarter-zoom steps so the outline fills the picture. A plot bigger than about 170 m across (farm, estate) is not used for framing. `view.fit` is `"plot"` in this case.
The house outline is now **yellow** so it stays distinct from the red plot line.

Settings: `PLOT_SOURCE=auto` (default: title when it matches, else estimate) | `title` (title only, no estimate) | `estimate` (always estimate); `TITLE_SOURCE=auto` (default: local INSPIRE table when `DATABASE_URL` is set, then the live service) | `local` | `live`. Tune the distances in `PLOT_LIMITS` at the top of `plotEstimate.js`. Tests: `test/plotEstimate.test.js`.
Limits: an estimate cannot see fences, so it is roughly right for ordinary streets and wrong for unusual plots; OSM must have the neighbouring homes mapped; rear gardens that are much longer or shorter than the gap to the houses behind will be off.

## Registered boundaries from your own database (Land Registry INSPIRE parcels)

The live planning.data.gov.uk point query is slow, rate-limited and has gaps. HM Land Registry publishes the same cadastral polygons ("INSPIRE Index Polygons": England and Wales, one GML file per council, free under the Open Government Licence), so you can load them into the Postgres you already use and look boundaries up locally in milliseconds.

**One-off set-up**
1. `npm run db:schema` (adds `inspire_parcels`, `inspire_meta`, `inspire_parcels_at()`, `inspire_parts()`; plain Postgres, **no PostGIS needed**: it uses the built-in `box` type with a GiST index).
2. Download the council ZIPs you need from https://use-land-property-data.service.gov.uk/datasets/inspire (check the licence and attribution terms on that page; the app shows the attribution wording).
3. Load them (direct connection string in `.env`, as for UPRN):
```bash
npm run import:inspire -- "C:\data\Leicester_City_Council.zip"          # council name comes from the file name
npm run import:inspire -- a.zip b.zip c.zip --fast                          # several; --fast = build the indexes once at the end (first big load)
npm run import:inspire -- Leicester.zip --dry-run                           # read + convert only, prints the first polygon so you can sanity-check the position
npm run check:inspire -- "LE1 1AA"                                          # what is loaded, and which parcel covers this postcode
```
Re-importing a council replaces its rows. Storage is roughly 0.4 KB per parcel including indexes (my estimate, not measured; the importer prints the real size). England and Wales together are on the order of 24 million parcels, i.e. roughly 10 GB, so load the councils you serve first and check your plan's disk.

**How it is used:** `TITLE_SOURCE=auto` asks the local table first and the live service only when the local table has nothing there (or fails); a missing table or database is logged once and ignored. Multi-part registered extents return every piece. The plot outline rules above then apply (the parcel must match the house, otherwise the estimate is used).

**Coordinate accuracy (important).** The files are in British National Grid. The built-in conversion to WGS84 is good to about **2-5 m** (checked: 3.6 m from OS's high-precision answer for their published worked example). To stop that making a real parcel look wrong, a parcel that does not contain the house is **aligned**: shifted by up to 8 m to where the house fits, preferring the smallest move (a parcel that already contains the house is left exactly as it is). The boundary check also widens its tolerance to half the stated accuracy, says "accurate to about N m" in its message, and **does not feed that distance into the 2 m / 3 m eaves rule**.
For sub-metre positions convert with GDAL instead (it uses OS's OSTN15 grid when installed) and import the result; the importer then records `crs_method = external` and the app treats parcels as accurate to about 0.5 m:
```bash
ogr2ogr -f GeoJSONSeq parcels.geojsonl -t_srs EPSG:4326 Leicester.gml
npm run import:inspire -- parcels.geojsonl --council Leicester
```
INSPIRE polygons are *registered extents*: unregistered land, some public land and roads have none, and they are indicative, not the legal boundary. Files: `scripts/import-inspire.js`, `src/utils/inspireParse.js` (GML / GeoJSON readers), `src/utils/bng.js`, `src/utils/zipRead.js`, `src/providers/inspireLocal.js`. Tests: `test/inspire.test.js`, `test/plotFlow.test.js`.

## Title boundary and protected trees: live data

Both come from the planning.data.gov.uk API (`src/providers/titleBoundary.js`, `protectedTrees.js`, `planningData.js`; URL building in `src/utils/planningDataApi.js`, WKT reading in `src/utils/wkt.js`).
The code uses only parameters from the API documentation (https://www.planning.data.gov.uk/docs): `longitude`/`latitude` (point intersects), `geometry` + `geometry_relation=intersects` (area search), `field`/`exclude_field`.

- **Title boundary** (`dataset=title-boundary`): point query, the smallest current title containing the point wins. A title can be several pieces (MULTIPOLYGON, e.g. house + detached garage): all pieces are kept, so reaching into another piece of the same title is not reported as "outside".
  If the address point hits no title (it can sit on the pavement side), the lookup is repeated at the middle of the building outline.
- **Constraints** now ask the API to leave `geometry`/`point` out (`exclude_field`): we only need *which* constraints apply, and a conservation area outline can be tens of KB.
- **Protected trees**: one area search (60 m square) each on `tree-preservation-zone` and `tree`. Felled (`felled-date`) and ended records are skipped; a tree with only an outline gets its centre and a crown estimate from it.
- Everything is cached for 24 h per address and fails soft (a warning, never an error). The API has no batch endpoint and asks for polite request rates, so do not loop it over thousands of addresses; use the bulk downloads on each dataset page for that.

**Check it from your own machine** (this is the live test I could not run for you):
```bash
npm run check:title -- "E6 2AA"          # or: npm run check:title -- 51.539,0.059
```
It prints the raw API answer (real field names), what the parser makes of it, a 5 × 5 coverage grid around the point (how much of the area has title polygons) and the protected trees nearby. `npm run diagnose` also pings both datasets.
Coverage of `title-boundary` is still partial and growing; when none is found the boundary check is simply skipped.

## Is "live" working? Run the diagnostic
```bash
npm run diagnose                 # tests postcodes.io, Photon, each Overpass mirror, Esri, planning.data.gov.uk
npm run diagnose -- "IG6 2JE"    # use your own postcode
```
It prints pass/fail and latency for every external service **from your machine** and says what each failure means.
If the free address services are down or slow, the UI offers **"Enter it manually"** (first line + town) – the postcode is validated with postcodes.io,
the map is centred on the postcode and the app warns that the outline must be checked.

## Troubleshooting the free OpenStreetMap services
| Symptom | Cause | Fix |
|---|---|---|
| `Upstream returned 406` from `overpass-api.de` | Overpass rejects anonymous clients (generic/missing User-Agent) | Set `HTTP_USER_AGENT` to your app name + a real contact URL/email. The engine also sends `Accept: */*` and fails over to the mirrors in `OVERPASS_URLS` |
| Stuck on "Searching…" / `504` / aborted | Overpass is shared and slow. Postcode search used to scan the whole country | Now searches a ~220 m circle around the postcode (coordinates from postcodes.io) and races the mirrors; the UI gives up after 25 s with a clear message. For production use OS Places / getAddress.io / Ideal Postcodes or self-host Overpass |
| Address list is short for a postcode | OSM often has no `addr:postcode` tag. We include exact matches plus untagged addresses within ~100 m of the postcode centre | Use a proper address API for complete lists |
| Photon (`photon.komoot.io`) `operation was aborted` | Public instance slow or throttling | Type-ahead now degrades to "suggestions unavailable" instead of an error; entering a full postcode still works. Self-host Photon or use OS Places / getAddress.io for production |
| Esri aerial blank | Corporate proxy/firewall blocking `services.arcgisonline.com` | Allow the host, or set `AERIAL_PROVIDER=google` |

## Permitted-development engine
`assessProposal` covers GPDO 2015 Sch.2 Part 1: Class A (rear/side/wraparound extensions), B (dormers), D (porches), E (outbuildings),
plus gates for flats, listed buildings, Article 4, protected land, Green Belt, and England-only. Extra storeys are flagged as normally needing planning permission.
Verdicts: `permitted_development | prior_approval | planning_permission | listed_building_consent | not_applicable`.
It is **screening only** – keep the disclaimer and recommend a Lawful Development Certificate.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/address/search?q=&limit=` | Type-ahead |
| GET | `/api/address/postcode/:postcode` | All addresses at a postcode |
| GET | `/api/address/id/:id` | Single address |
| GET | `/api/work-types` | Types of work + form fields |
| POST | `/api/applications` | Confirm address → create draft + enrich |
| GET | `/api/applications/:id` | Cards, map, assessment |
| PATCH | `/api/applications/:id/profile` | Applicant-confirmed facts, existing extension, `frontBearingDeg` |
| PUT | `/api/applications/:id/proposal` | `{type, ...dimensions}` → map outline + assessment. For a drawn shape: `{type:'custom_polygon', ring:[[lng,lat],...], treatAs, heightM, ...}` |
| GET | `/api/applications/:id/map` | Overlay layers + GeoJSON |
| GET | `/api/applications/:id/media/street-view`, `/aerial` | Image proxy (keys stay server-side) |
| GET | `/api/applications/:id/export.json` | Everything entered + the engine's results as one JSON file (download) |
| POST | `/api/applications/import` | Body = an exported file → a new draft with the same answers (see below) |
| GET | `/health` | Mode + active providers |

## Production checklist
- Drafts are stored in Postgres (`src/store/pgStore.js`). Anyone holding an application's UUID can read it (as before) – add authentication if drafts contain personal data.
- Confirm imagery/licence terms for caching and attribution (don't store Google imagery long-term).
- OSM outlines can be wrong (e.g. a whole terrace as one polygon) – the UI asks the applicant to confirm; consider OS NGD / INSPIRE for authoritative outlines and plot area (`providers.parcels`).
- Wales, Scotland and Northern Ireland have different rules – the engine returns `not_applicable` outside England.

## Verification status (INSPIRE import, local lookup, fence snapping)
Verified: the grid conversion reproduces OS's published worked example (OSGB36 to 1e-7°, WGS84 within 3.6 m of the high-precision answer); the GML reader on both common layouts (`posList` and `coordinates`, polygon and multi-surface, holes dropped, awkward chunk boundaries); GeoJSON / GeoJSON-lines input; the ZIP reader (stored and deflated); the COPY line format; the provider against an in-memory fake (containing / smallest / edge tolerance / multi-part / missing table); the provider chain fallbacks; parcel alignment; the approximate-boundary rule; fence snapping including the refusals; the Overpass query and barrier parsing; and the whole flow through the application service in mock mode. The importer's `--dry-run` was run on a sample council ZIP.
**Not verified:** `db/schema.sql` section 7 and `scripts/import-inspire.js` against a real Postgres (no database was available: check the GiST `box` index and the COPY on your cluster with `npm run db:schema`, a small council, then `npm run check:inspire`); the GML tag layout of a real HM Land Registry download (the reader is tolerant, but I could not fetch one: run `--dry-run` first and check the printed position); real OSM barrier coverage and how the snapped outline lines up with imagery in a browser.

## Verification status (plot outline estimate and map framing)
Verified: 10 new tests (`test/plotEstimate.test.js`) covering party wall / gap / pavement / rear limits, outbuildings ignored, defaults, front-back swap, title-vs-estimate choice (including walls exactly on the title line), framing and fractional zoom, and the warn-only boundary rule; the real application flow in mock mode (title used and still **fails** when exceeded, estimate used when the title lookup fails, swap keeps a matching title); a schematic render of the framing. Existing tests still pass except the three that need `express` (`api`, `drawnApi`, `siteChecksApi`), which could not be run in the environment used (no network to install packages) - run `npm test` locally.
`test/tpoFlow.test.js` changed on purpose: when the title lookup fails there is now an *estimated* plot layer instead of none.
**Not verified:** a live `title-boundary` answer for real addresses (so why a title looked wrong for your address is not confirmed - run `npm run check:title`), the estimate on real OSM data, how it lines up with real Esri imagery in a browser, and the new red / yellow styling in a browser.

## Verification status (title boundary, protected trees)
**Checked against the live service (14 Oct 2026):** the `/entity.json` response shape (`entities[]`, hyphenated fields, `end-date: ""` for current records, `geometry`/`point` as WKT with `", "` separators, `count`, `links`) on a real point query;
the documented parameters above (from https://www.planning.data.gov.uk/docs); the field names of the tree datasets (from the official specification page); that real `title-boundary` records exist with MULTIPOLYGON geometry; and that the datasets are published under the Open Government Licence v3.0.
Tests use fixtures with exactly that shape (`test/planningDataApi.test.js`).
**Not checked:** a `title-boundary` *point query* result for a specific address (my tooling could not run it; use `npm run check:title`), real-world coverage of title polygons and council tree data in your areas, and the app in a browser.

## Verification status (drawing, roads, trees)
Verified: 68 automated tests pass, including the new rule tests (roads, trees, custom rules), the measurement arithmetic for drawn shapes with and without an existing extension, drawn-shape validation, the API against the offline mock
(mock mode now includes a tree 6 m behind the house), and the Overpass parsing against a fake response. The browser code was exercised end to end in a simulated browser (jsdom): drawing by clicking, snapping, closing, live preview, error messages.
**Not verified:** a real browser (layout, touch, the look of the road/tree overlays), the live Overpass response for the combined building + road + tree query, and real-world tree/road data quality. Try a few real addresses and adjust `thresholds.js`.
Known gaps: drawn corners cannot be dragged after placing (use Undo / Draw again); an applicant with a screen reader or keyboard only cannot place corners (a numeric corner entry would fix that).

## Verification status (Postgres / Vercel changes)
Verified: the JS side of the Postgres layer (UPRN provider, batch matching, draft store, connection-string handling, container wiring) against an in-memory fake pool, the importer's SQLite read query against the real 41.7M-row file, and syntax of all files.
**Not verified:** the live planning.data.gov.uk `title-boundary` response (the parser follows its published WKT format and fails safe to "no boundary"), `db/schema.sql` against a real Postgres, `scripts/import-uprn.js` against a real cluster, and the Vercel deployment itself – run steps 1–3 above and `npm run diagnose` to confirm.

## Verification status (original engine)
Verified here: 13 unit tests (postcode parsing, permitted-development rules per work type) and 6 geometry/map tests
(front detection, rear placement, every work type, existing-extension offset, label spacing), plus a visual check of the overlays.
**Not verified:** anything that talks to the internet (OS Places, Photon/Overpass, Esri export, Mapillary, planning.data.gov.uk, Google) and the Express routes/UI
(dependencies couldn't be installed offline) – the API shapes were written from documentation. After `npm install`, run `npm test` (includes an
end-to-end mock-mode test) and smoke-test each provider with a real postcode.



## Public land in front of the plot
The strip between the plot's road-facing boundary and the road (pavement, verge, carriageway) is **public land**, not the applicant's.
`src/services/rules/publicLand.js` measures how much of the proposal lies outside the plot and closer to the road than the plot's frontage is:
- **Registered title** → `fail` ("can't be built on"); porches get the plain "no private land in front of the door" message, every other footprint work gets a public-land blocker and a `planning_permission` verdict (`publicLandCheck` in `frontSpace.js`).
- **Estimated plot** → `warn` only (an estimate is never a verdict).
- Rear/side work is never closer to the road than the plot's frontage, so it is unaffected. Result is exposed as `map.siteChecks.publicLand`. Tests: `test/frontSpace.test.js`.

- **Drawn on the map:** `src/services/publicStrip.js` builds the strip between the plot's road-facing edges and the carriageway edge (any road angle); `mapService.js` adds it as a `public_land` layer (grey; red when the work is on it), with a legend entry in the UI. Tests: `test/publicStrip.test.js`.

## Local planning authority (LPA) rules
`src/data/lpaRules.js` holds each council's own numbers (with the document, URL and clause they come from). `src/services/lpaPolicy.js` measures plot area, house footprint, extension area and the garden left, then tests them against that council's guidance. It runs after the national (GPDO) screening: permitted development is not judged against local design guidance; otherwise the result is `likely_ok`, `at_risk` or `unlikely` (building outside the title / on public land). Councils with no entry say so rather than guessing. Waltham Forest is loaded from its 2010 Residential Extensions SPD (3 m rear guide, 15 m² garden per habitable room, 1 m side set-back). To add a council, copy its entry and fill in only what its guidance states.

Work outside the registered title now also decides the PD verdict (`outsidePlotCheck`), not just the Map checks list.

Council name lookup order: postcodes.io for the postcode -> the council on the address record -> nearest postcode to the point (`postcodes.io /postcodes?lon&lat`). Drafts saved without a council are re-checked when opened. `assessment.lpa.available === false` means the council is known (or not) but has no entry in `lpaRules.js`.
The plot / house / extension figures (with how each was worked out) are returned as `areas` and shown above the verdict, with or without a proposal or council rules.

## Two stages: project classifier and GPDO rule engine
1. **Project classifier** – `src/services/projectClassifier.js`. Says what the project is (development type + GPDO Class, e.g. Part 1 Class A), which approval routes could apply, the conditions to comply with, and the planning questions still unanswered (each tied to the provision that needs it and to where the person answers it). Output: `assessment.project`.
2. **Regulatory rule engine** – the provisions live as data in `src/data/gpdo.js` (Classes A, AA, B, D, E: limits, restrictions, conditions, with paragraph references). The decisions are made by `permittedDevelopment.js`; `src/services/gpdoEngine.js` lays the result out against every provision of the Class: met / not met / please confirm / condition / **not tested here** (a provision no check covers is never shown as a pass). Output: `assessment.gpdo`.
Paragraph letters follow the consolidated Order on legislation.gov.uk – verify before quoting them formally. Tests: `test/gpdoClassifier.test.js`.

## Pavements, paths and street furniture
The same Overpass request that fetches buildings, roads and trees now also returns pavements / footpaths / cycle paths / steps (60 m) and post boxes, electricity / telephone poles, pylons, street lamps, street cabinets, fire hydrants, bollards, bus stops and dropped kerbs (40 m) (`utils/osmTags.js`: `pathFromElement`, `obstacleFromElement`).
- `rules/streetFeatures.js` (thresholds in `thresholds.js`): an obstruction on / within 0.3 m of the footprint = in the way; within 1.5 m = keep clear (poles carry a note about overhead cables); a mapped path under the footprint is reported, and a **designated public right of way** under it is a hard stop. Results: `map.siteChecks.street`. Nothing mapped is an info note, never a pass.
- `frontSpace.js` `streetCheck` feeds the verdict: public right of way = certain (planning permission; the council must divert it first); an obstruction in the way or an undesignated path = likely (warning). GPDO trace gets a "public right of way" provision.
- Map: `pathway` and `obstacle` layers (legend, colours by kind; red when in the way). Block plan: dimension lines to the nearest obstructions and nearest pavement / path, and table rows for carriageway width, pavement width, public strip (plot to carriageway) and plot frontage facing the road. Widths are marked "as mapped" or "assumed".
- Drafts saved before this existed fetch the street features once when opened. OpenStreetMap coverage of street furniture is patchy and positions are a metre or two out: always check on site. Overhead cables are not mapped as lines (only the poles).
Tests: `test/street.test.js`.

## Measured facts, extra approvals, energy certificate and the 45-degree test
- **Measured, not asked** (`services/siteFacts.js`, registered title only): distance from the work to the rear / side / front boundary (which way each boundary faces is worked out from the house front bearing), and the area of the owner's own sheds / garages / earlier extensions (OSM buildings whose middle is inside the registered plot – they are drawn as "Existing outbuildings" and no longer treated as neighbours). `autoFacts` fills only EMPTY form fields (eaves-near-boundary distance, rear-boundary distance, buildings already on the plot), and the assessment says so; the applicant's own answer always wins. An estimated outline never produces a number.
- **Other approvals** (`rules/regulatory.js`, `map.siteChecks.regulatory`, shown as "Other approvals to think about"; never changes the verdict): Building Regulations reminder, Party Wall etc. Act (on / against the boundary, or within 3 m of a neighbour's building), Approved Document B (within 1 m of a boundary), Community Infrastructure Levy (footprint × storeys of 100 m² or more), and a "not checked" note about public sewers.
- **Energy certificate** (`providers/epc.js`, optional): habitable rooms, built form, property type, age band, floor area, extension count. Set `EPC_API_URL`, `EPC_API_EMAIL`, `EPC_API_KEY`; without a key it is off. Field names are read tolerantly; check the register's current endpoint and licence terms. It feeds the council garden test (real room count instead of a threshold), fills the house form when the map data did not say, warns if the property is a flat, and notes recorded extensions.
- **45-degree rule** (`services/fortyFive.js`, `rules/fortyFive.js`): the applicant marks the neighbour's nearest ground-floor window on the map ("Mark neighbour's window"); the line is drawn and the test runs. It is council guidance, so a breach is a warning and lowers the council outlook to "at risk"; it is not a permitted-development fail. Stored in `profile.neighbourWindow`.
Tests: `test/siteFacts.test.js`, `test/lpaPolicy.test.js`.

## Land Registry Price Paid Data (sale records)
`providers/landRegistry.js` queries HM Land Registry's open linked-data SPARQL service (`PPD_SPARQL_URL`, no key; Open Government Licence v3.0). For the home it returns every recorded sale with **property type** (detached / semi / terraced / flat-maisonette / other), **tenure** (freehold / leasehold) and the **new-build** flag, matched on house number + street so number 2 never matches 22 and a flat's sale never matches the house; plus **street comparables** (same type, same street and town, last 5 years: count, median, 25th and 75th percentile). Postcodes and street names are validated / stripped before they reach a query.
`services/ppdSignals.js` turns that into checks (never a verdict on its own): recorded as a flat or maisonette -> warning that householder rights do not apply; leasehold -> freeholder's consent and the lease; new-build sale -> check for a planning condition removing permitted development; disagreement with the energy certificate -> confirm the type. When the map data and the EPC both lack a house form, the Land Registry type fills it (order: map -> EPC -> Land Registry).
The result is `app.ppd`, shown as "From Land Registry sales records". Publication lags 1-3 months and some sales are missing, so "no sale found" is information, not a finding. Tests: `test/ppd.test.js`.

## Rough value of the extra space
`services/valueEstimate.js` (output `assessment.value`, card "Rough value of the extra space"): street sale price for the same property type (Land Registry) ÷ the home's floor area (energy certificate) × the new floor area (footprint × storeys), as a range using the street's own 25th and 75th percentile prices, rounded to £1,000. A second view from the home's own sale is shown when it was within 5 years. It needs the EPC floor area and at least 5 comparable sales, and says what is missing otherwise; it is only given for rear / side / wraparound extensions. Caveats are shown with it (big extensions overstate, approval assumed, comparables assumed similar in size). It is a rough guide, not a valuation. Tests: `test/valueEstimate.test.js`.

## Planning history (PlanIt)
`providers/planit.js` reads earlier planning applications from PlanIt (planit.org.uk), a public aggregator of council planning registers: `GET {PLANIT_URL}?lat&lng&krad=0.15&start_date=<10 years ago>&pg_sz=400`. **It is OFF unless `PLANNING_HISTORY_ENABLED=true`**, because PlanIt has its own terms (free for non-commercial use, commercial licence available) - check them for your use first. The records themselves are council data.
- Each application is classified from its description (rear / side / wraparound extension, porch, dormer or loft, outbuilding, extra storey; lawful-development certificate, prior approval, conversion to flats / HMO, new dwellings) and its state is mapped to approved / refused / withdrawn / pending.
- The register entries are split into: **this house** (house number + street match, abbreviations normalised, so number 2 never matches 22), **other flats in the same building**, and **similar work within 150 m**.
- `services/planningHistory.js` turns that into notes (never a verdict): an extension already approved here (permitted-development limits may already be used), an approved conversion to flats / HMO (not a single house), a new-build permission (look for a condition removing permitted development), a refusal of similar work, a lawful certificate for similar work, and **nearby precedent** - approved vs refused of the same kind in the last 10 years (lawful certificates and prior approvals are not counted; a percentage is only shown from 3 decided cases). `assessment.precedent` also feeds the council-guidance layer (supports when 70%+ approved, warns at 40% or less) when permission is needed.
- The list data does **not** include decision notices, so planning conditions are not shown; the card says to read them on the council register. Council registers differ in what they publish and PlanIt can lag. Description-based classification is a keyword heuristic and will miss or mislabel some applications.
- Result: `app.history`, shown as "Planning history". Drafts saved before this fetch it once when opened. Tests: `test/planningHistory.test.js`.

## Layers: everything drawn on the plan, switchable
The legend is now a **layer panel** (`legend()` in `public/app.js`): each kind of data on the plan has a checkbox, a swatch and a count, grouped as Plan / Street / Surroundings / Constraints / Analysis, with Show all / Hide all. Up to 27 layer types: house, existing extension, your proposal, title boundary; public land, roads, pavements and paths, post boxes / poles / lamps, overhead power lines; neighbouring buildings, existing outbuildings, trees, tree preservation zone; the neighbour's window and 45-degree line; and 13 constraint outlines drawn from planning.data.gov.uk (conservation area, listed building, Article 4 direction area, flood risk zone, Green Belt, national park, AONB, World Heritage Site, scheduled monument, SSSI, ancient woodland, registered park and garden, registered battlefield).
- **Constraint outlines** (`providers/constraintAreas.js`, stored as `app.outlines`): one area search for all datasets, outlines simplified (`utils/simplify.js`, 2 m tolerance, 300-point cap). `rules/areas.js` marks each inside / near (100 m) / clear and adds a plain note where the point lookup does not already drive a rule (flood zone, SSSI, scheduled monument, ancient woodland, park and garden, battlefield; listed building / monument / woodland nearby). The Article 4 direction's own wording (rights removed, notes, link) is shown when the register records it. Coverage varies by council.
- **Overhead power lines** (OSM `power=line|minor_line`): drawn, and flagged over / within 5 m of the work ("ask the network operator before scaffolding"); a line over the work is a likely blocker.
- **Road class**: A / B / C from the OSM reference; next to a classified road the other-approvals list notes that new vehicle access is not permitted development.
- **Existing height**: a community-entered OSM `height` tag is compared with the extension height (A.1(c)); it prompts a check, it never decides.
- **Habitable rooms without an energy certificate**: typed in (`profile.habitableRooms`), used by the council garden test.
- **Build quote**: type your quote on the value card to see the estimate net of cost (nothing is stored).
- **GPDO limits are data**: every number in `permittedDevelopment.js` now comes from `LIMITS` in `data/gpdo.js`.
- **Printable outputs** (`services/planExport.js`): `GET /api/applications/:id/block-plan.svg` (A4 landscape, sized in millimetres so it prints at the stated scale 1:100 ... 1:2500, with red site line, dimensions, scale bar, north point, title block) and `GET /api/applications/:id/ldc-pack` (draft Lawful Development Certificate supporting statement: project, GPDO provision table with how each is met, constraints, history, plan, council checklist, declaration; everything from outside is HTML-escaped). Both are drafts from open data: not a surveyed or Ordnance Survey-licensed plan, and no location plan is produced.
Tests: `test/layers.test.js`, `test/planExport.test.js`.

## Street and site dashboard (and a bug fix)
`services/dashboard.js` builds `map.dashboard`, shown as "Street and site dashboard" right after the "Land and building sizes" table. Every measured value is a tile `{ label, value, sub, status }` with status **ok** (measured), **check** (in the way / close / crossing), **info** (found nothing - "none mapped" is never a pass) or **na** (a placeholder: not available yet, saying what data it needs). Distances are from the proposed work when there is one, otherwise from the house, and each tile says which.
Sections: **Road** (nearest road, class, carriageway width as mapped / assumed, distance to the road edge, public strip, plot frontage), **Pavement and paths** (pavement width and distance, footpaths / cycle paths / steps, rights of way, crossings, dropped kerbs), **Street furniture** (post boxes, lamp posts, poles, street cabinets; hydrants, bollards, bus stops, pylons when present - each with a count and the nearest distance), **Cables** (overhead lines with voltage and distance, poles carrying cables, underground cables as a placeholder), **Site, boundaries and surroundings** (rear / side / front boundary, neighbours, your outbuildings, trees and protected trees, constraint outlines), and **Not available yet** (public sewers, roof and eaves height from LiDAR, ground conditions, coal mining risk, floor plans). Add a data source later by replacing the matching placeholder in `PLACEHOLDERS`.
UI fixes: the layer panel used the class `.layers`, which the Aerial / Map / Block plan switcher already uses, so it was squashed; it is now `.layerpanel` with a plain vertical list.
**Bug fixed in `siteFacts.boundaryDistances`**: the boundary facing the house front was reported as the rear and the reverse (earlier tests used a symmetric plot, so they could not see it). That fed the wrong distance into the two-storey rear-boundary rule's auto-filled value. Now covered by asymmetric tests; a wall exactly on the boundary line (a terrace) also counts as inside (0.3 m tolerance).
Tests: `test/dashboard.test.js`, `test/siteFacts.test.js`.

## Roof / eaves height (LiDAR), coal mining risk, boundary overhang
Three dashboard items that were "Not available yet" and now come from open data (`services/siteExtras.js` builds the tiles; `dashboard.js` places them).

**Roof and eaves height** - `providers/lidarHeights.js`, `services/roofHeight.js`. One `exportImage` request per layer (surface model DSM, ground model DTM; Environment Agency 1 m composite, England) returns a small GeoTIFF around the building. Nothing is stored; the result is kept on the draft as `app.lidar`.
- Height above ground = DSM minus DTM at each 1 m cell. **Ridge** = the 95th percentile inside the outline; **eaves** = the low edge of the roof (15th percentile of the cells 0.5-1.5 m inside the wall). Flat roofs (spread under 0.7 m) report one height. The ground fall under the building is shown when it is 0.3 m or more.
- **The outline is slid to fit.** OSM and the grid only agree to a few metres (the National Grid conversion in `utils/bngForward.js` is a Helmert shift, 2-5 m), so the outline is moved up to 5 m in each direction to where the most cells inside it are over 2 m tall and the fewest just outside it are. The shift used is shown ("outline moved 2.2 m to fit"). If no position gives a clear building the tile says "Not clear from LiDAR" and gives no number.
- It is an estimate (about +-0.5 m, and it reads eaves a little high on steep roofs). Surveys date from 2000-2022, so recent extensions may be missing. It is information only and is **not** fed into the permitted-development verdict.
- Setup: `npm i geotiff`. The old ArcGIS ImageServer URLs do not exist (`400 Invalid URL`); the provider now uses the EA's **WCS 2.0.1** services (`environment.data.gov.uk/geoservices/datasets/<id>/wcs`, coverages `..__Lidar_Composite_Elevation_DTM_1m` and `..__Lidar_Composite_Elevation_LZ_DSM_1m`). `npm run check:lidar` reads GetCapabilities and DescribeCoverage (axis labels) for both, and `npm run check:lidar -- 530000 180400` requests a 10 m window at that National Grid point. Override with `LIDAR_DTM_URL` / `LIDAR_DTM_COVERAGE` / `LIDAR_DSM_URL` / `LIDAR_DSM_COVERAGE` / `LIDAR_AXES`. The DSM is the last-return surface, so heights can read slightly low under trees.

**Coal mining risk** - `providers/coalRisk.js`, `db/schema-coal.sql`, `scripts/import-coal.js`. Point-in-polygon against the Mining Remediation Authority's Development High Risk Areas: inside = check, within 250 m = info, otherwise "Not in a high-risk area" (info, never a pass: it may still be in the coalfield's low-risk area, and it is not a Mining Report). No data loaded = "Not available yet", never "not in a risk area".
- **OFF unless `COAL_RISK_ENABLED=true`, because the licence is unclear** (data.gov.uk lists OGL; the dataset's own metadata says "Coal Authority data licence"). Ask the MRA before storing or serving it in a product. Free viewing is on their map viewer.
- Load: `ogr2ogr -f GeoJSONSeq dhra.geojsonl -t_srs EPSG:4326 DevelopmentHighRiskArea.shp`, run `db/schema-coal.sql`, then `npm run import:coal -- dhra.geojsonl --source "MRA download 2026-07"` (`--dry-run` first). Plain Postgres (a `box` + GiST index and JSON rings), no PostGIS, like the INSPIRE table. Or set `COAL_LIVE_URL` to a FeatureServer layer you may query.

**Boundary distances** - no new data: `siteFacts.boundaryDistances` already measures rear / side / front distances in code, so PostGIS is not needed. What was missing is the case where the work is not wholly inside the title: the tile used to say only that. It now says how far the work goes over (`boundaryOverhang`: corners outside the title, worst distance), measured to a registered title only, never an estimate. A wall exactly on the line (0.3 m) counts as inside.

Tests: `test/roofHeight.test.js` (projection against OS's worked example, roof analysis on synthetic grids incl. a mis-placed outline, provider with a fake service), `test/coalRisk.test.js`, `test/siteData.test.js`.
**Not verified:** the live EA services (DSM service name, `exportImage` returning a GeoTIFF with the size asked for, `geotiff` reading it); `scripts/import-coal.js` and the coal SQL against a real Postgres; any real coal data file (field names are read tolerantly, check `--dry-run` output); real-world accuracy of eaves heights against a measured house.


## Export everything as JSON, and attach it to the next application
After the applicant has filled everything in, **Save everything as JSON** (under "Take it with you", or `GET /api/applications/:id/export.json`) downloads one file, `uk-planning-engine/application` v1:
- `inputs` - what was entered: the confirmed address (`id`, or the manual address), the answers the applicant set (`profile`: original dwelling, existing extension, storeys, roof, site area, front bearing, rooms, neighbour window, is-it-a-house) and the `proposal` (type of work, dimensions or drawn ring). Engine estimates are not copied.
- `results` - what the engine worked out at that moment (authority, constraints, verdict and checks, areas, energy certificate, warnings). Read-only: for people and other tools.

To use it on the next application, choose **Load its JSON file** on the first screen (or `POST /api/applications/import` with the file as the body). The engine **replays `inputs` only**: it re-fetches the address by id, applies the saved answers, then the proposal, so the new draft gets fresh data and a fresh verdict. Editing `results` in the file changes nothing. A file with an unknown version, no address, or an out-of-range dimension is rejected with a 400 that names the problem. Body limit is 300 kb. Code: `src/services/applicationExport.js`; tests: `test/exportImport.test.js`.

## Engine room: see what the engine actually does, and wall safety
Under the verdict there is now an **Engine room** panel (`public/engine.js`, data from `src/services/engineTrace.js`, also `GET /api/applications/:id/engine`; every summary carries it as `engine`).
- **This run, step by step**: 8 stages (what the engine knew, house front/back, proposal footprint, **site rules**, permitted-development checks, every GPDO provision, how the verdict was reached, council guidance). The site rules expand into one step each. Each rule shows its question, the data it reads, **the numbers (thresholds) it used**, **what it measured**, what it said, whether it can change the verdict, and its run time. Click a step, use Previous / Next, or **Replay the run**; the plan beside it redraws what that rule was looking at (hover a measurement to highlight the wall). Skipped runs (roof-level work, no building outline, no proposal) say why.
- **The rulebook** tab (`GET /api/engine/rules`): every site rule with its thresholds, every GPDO limit and provision.
- Nothing is recomputed for the panel: `runRules` records each rule into `result.trace` as it runs (so your own rules in `rules/custom.js` appear too, and a rule that throws shows its error). Rules are described in `rules/catalog.js`.

**Wall safety** (`rules/wallSafety.js`) judges each new outside wall on its own: against a neighbour's building (Party Wall etc. Act, nothing fixed to their wall), on the registered boundary (fire-resistant wall, no openings, no overhang), within 1 m of a boundary or a neighbour (Approved Document B openings, maintenance access), or running into a neighbour (fail). Walls that continue your own house are skipped; an estimated plot is never used as a boundary; a corner that only meets a line is ignored. Flagged walls are drawn on the map (layer "Wall safety") and listed in `map.siteChecks.walls`. Guidance only: it never changes the permitted-development verdict. Thresholds: `wallTouchM`, `wallContactMinM`, `wallFireM` in `thresholds.js`. Tests: `test/wallSafety.test.js`, `test/engine.test.js`.
**Verified:** 247 tests, 245 pass; the browser panel was exercised in headless Chromium in mock mode (no page errors). **Not verified:** real-address data, mobile touch layout. Two older tests (`drawnApi`-style "measured from the plan" wording, tests 21 and 24) were already failing before this change.

## LiDAR heights now test the "no higher than the existing house" limits
`src/services/existingRoof.js` picks the existing roof height: Environment Agency LiDAR (high/medium confidence, ±0.5 / ±0.8 m) if available, else the OpenStreetMap height tag (ridge only, ±1 m), else nothing. `permittedDevelopment.js` then tests **A.1(c)** (extension no higher than the existing ridge) and **A.1(d)** (extension eaves no higher than the existing eaves), and adds an information line when the ground falls 0.5 m or more across the house.
- It only **fails** when the extension is more than twice the tolerance above the measured height with high confidence; inside the tolerance it says "too close to call" (warn); a map tag can only warn, as before.
- LiDAR is a survey, possibly older than the house's latest extension, so the message always says where the number came from.
- The "What the engine knew" step shows which source and tolerance were used. Mock mode now returns sample LiDAR heights so this can be seen without the EA service.
- Tests: `test/existingRoof.test.js`.

## Golden cases (`golden/`, `npm run golden`)
51 fixed scenarios, each with the answer the legislation gives and the paragraph it comes from: depth/height/eaves/width limits, protected land, gates (listed, flat, Wales), porches, dormers, outbuildings, LiDAR heights and wall safety. They run inside `npm test` too. `npm run golden` also prints which GPDO provisions **no case exercises yet**. These prove the engine follows the rules as written; they do not prove it agrees with councils. `golden/README.md` explains how to add real council decisions (kind `decision`, with the reference and date), which is the strongest evidence.

## What-if sliders (Engine room > "What if…")
Sliders for every number of the current proposal re-run the engine on each change (`POST /api/applications/:id/what-if`, nothing is saved, validated exactly like a save). "Find the limits" (`POST .../what-if/limits`, one field) samples the range and bisects every point where the route changes, and shows it as a coloured bar with the rule that causes each change (for example "Above 3 m: prior approval", "Above 6 m: planning permission"). "Use these values" saves them. Tests: `test/whatIf.test.js`.

## Inside the home: 3D interior engine
`src/services/interior/` builds the **inside** of the building in the same house frame as the map, and `public/viewer3d.js` shows it in 3D (plain canvas, no libraries, works with the existing content-security policy).
- **Model** (`layout.js`): rooms per floor, roof, and the rooms the proposal creates (rear / side / wraparound extension, porch, outbuilding, drawn shape, extra storey, loft dormer). Coordinates: x across, y front to rear, z up (metres). Output: `app.interior`, returned in the summary, plus `GET /api/applications/:id/interior`.
- **Existing rooms are a typical layout generated from the outline, flagged `assumed`, not a survey.** New rooms use the applicant's dimensions. Roof pitch comes from LiDAR when available, else 35 degrees (said in `assumptions`). The ridge is assumed to run across the house.
- **Checks** (`checks.js`, numbers and sources in `src/data/interiorStandards.js`): only new rooms are judged: bedroom size and width (NDSS), ceiling height, loft head height, protected stairway above 4.5 m, escape-window and stair reminders. Guidance only (warn / info); they never change the permitted-development verdict. Window sizes and the loft stair are not modelled, so those are reminders, not tests.
- **Edits**: `PATCH /api/applications/:id/interior` (storeys, ceiling height, stair side, loft use, room names / uses), saved in `interiorSetup` and included in the JSON export / import.
- **Viewer**: drag to turn, scroll / pinch to zoom, click a room, floor selector, roof / cut-away / pulled-apart floors, plot and neighbours (neighbour heights assumed). Without a browser: `npm run preview:interior -- --type rear_dormer --out dormer.svg`.
- Tests: `test/interior.test.js` (19, pure logic).

**Verification status:** the 19 interior tests pass, and the viewer was rendered through a recording canvas for each work type and checked by eye. **Not verified:** the full app (`npm install` was not possible offline, so the existing suite, the Express route, zod schema and `derive()` wiring were only syntax-checked), the UI in a real browser (touch, layout, performance), and the standards figures against the current published documents: check them before quoting.

### Floor-plan editor (draw the real rooms)
"Draw your own floor plan" on the 3D card opens `public/planEditor.js`: per-floor SVG plan inside the house outline with Select (move rooms, drag corners), Draw room (polygon) and Rectangle tools, 0.1 m grid and corner snapping (Alt = free), edge lengths, width / depth fields for rectangles, name and use, floor tabs (add / remove floors, copy to the floor above), undo / redo, and the new work shown faintly as a guide.
- Saved as `interiorSetup.layout` via `PATCH /api/applications/:id/interior` (`{ layout: { storeys: [{ index, rooms: [{ id, name, type, poly }] }] } }`; `null` returns to the typical layout). It also travels in the JSON export / import.
- The server re-checks every drawn room against the mapped house (`interior/geometry.js`): 3-16 corners, inside the outline (0.5 m margin), no crossing walls, at least 1 m², at most 60 rooms. A bad plan returns a 400 that names the room.
- With a drawn layout the rooms are no longer `assumed` (they are tagged "Drawn by you"), the floor count follows the drawing, and an extra storey copies the drawn top floor. Checks still judge only the rooms the proposal creates.
- **Doors and windows**: click a wall to place one (defaults: door 0.9 x 2.0 m, window 1.2 x 1.2 m with a 0.9 m sill), drag it along the wall, edit width / height / sill / fixed. They can also go on the walls of the proposal's new rooms (shown faint on that floor). Stored per floor as a segment on a wall; one that no longer lies on any wall (room moved, proposal changed) is dropped and said so in `assumptions`.
- **Stairs**: drag a rectangle, pick the direction up. Steps are worked out from floor-to-floor height (rise at most 220 mm), and the editor shows rise, going and pitch live.
- **Overlap**: rooms on one floor that overlap by more than 0.05 m2 are outlined in red with a message, saving is blocked, and the server rejects the same plan (`geometry.js`). A drawn room overlapping the proposal's new room is a check warning.
- **New checks** (`checks.js`), once doors / windows / stairs are drawn: door into every new room; escape window on new upper-floor bedrooms (clear opening >= 0.33 m2 and 450 mm each way, sill <= 1100 mm, not fixed; the clear opening is estimated as the glass size less 50 mm each way, so confirm on the real window); purge ventilation (openable area >= 1/20 of floor); each stair against Approved Document K private-stair limits (rise <= 220 mm, going >= 220 mm, pitch <= 42 degrees); head height where the floor above covers a stair (2.0 m); head height at the top of a loft stair (1.9 m at the centre line); a missing stair up to a loft or new floor. With nothing drawn, the old reminders stay and nothing claims a door or window is missing.
- Not yet: plan upload (next step), turning or landing stairs (flights are straight), dormer / rooflight windows in the loft, door swing and clearances, overlap between stairs and walls. Tests: `test/planEditor.test.js` runs the editor against a small fake DOM (drawing, snapping, dragging, doors, windows, stairs, overlap, undo, save errors).
**Not verified:** the editor in a real browser (touch, layout, look); only its logic was exercised.

## Provisions added: A.1(e), A.1(k), rights of way, B.1(a)/(b)/(e), E.1(g)/(j)

The form has new "More details" yes/no questions, and the engine fails the route when one is ticked:

- `beyondFront` (A.1(e)): reaches past the front wall or a wall facing a road.
- `hasProhibited` (A.1(k)): balcony, raised platform, antenna, chimney/flue/soil pipe or roof alteration.
- `crossesRightOfWay` (all work, and `flags.publicRightOfWay`): built over a public footpath or bridleway.
- `convertedUnderPart3` (A.1(a), B.1(a)): the house was created by a change-of-use right.
- Dormers: `higherThanRoof`, or `topHeightM` tested against the measured ridge (B.1(b)); `chimneyFlue` (B.1(e)).
- Outbuildings: `raisedPlatform` (E.1(g)); E.1(j) is now a fail, not a warning, when a building over 10 m² is more than 20 m from the house on protected land.



### Closing the gaps

- **A.2(a) cladding:** the `cladding` field (render, stone, artificial stone, pebble dash, tiles, timber, plastic). On article 2(3) land any of those on an extension is a fail. Elsewhere it is ignored.
- **Yes / No / Not checked:** the new questions are now three-way selects that default to "Not checked". "Yes" fails the route, "No" passes the check, and "Not checked" adds one `details-unconfirmed` warning naming what is open, so the result reads "needs confirmation". API callers that omit a field are not nagged; only an explicit `"unknown"` is.
- **Filled from data:** a mapped public right of way (OpenStreetMap `designation` / `prow_ref`) was already detected from the street data. A Part 3 origin is now read from the planning history: an approved change of use from an office, shop, barn or storage building into a home sets `flags.part3Conversion`. Both answers then stop being asked. What is still not available: the council's definitive map of rights of way, so an unmapped path is never assumed absent.
