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
| PUT | `/api/applications/:id/proposal` | `{type, ...dimensions}` → map outline + assessment |
| GET | `/api/applications/:id/map` | Overlay layers + GeoJSON |
| GET | `/api/applications/:id/media/street-view`, `/aerial` | Image proxy (keys stay server-side) |
| GET | `/health` | Mode + active providers |

## Production checklist
- Drafts are stored in Postgres (`src/store/pgStore.js`). Anyone holding an application's UUID can read it (as before) – add authentication if drafts contain personal data.
- Confirm imagery/licence terms for caching and attribution (don't store Google imagery long-term).
- OSM outlines can be wrong (e.g. a whole terrace as one polygon) – the UI asks the applicant to confirm; consider OS NGD / INSPIRE for authoritative outlines and plot area (`providers.parcels`).
- Wales, Scotland and Northern Ireland have different rules – the engine returns `not_applicable` outside England.

## Verification status (Postgres / Vercel changes)
Verified: the JS side of the Postgres layer (UPRN provider, batch matching, draft store, connection-string handling, container wiring) against an in-memory fake pool, the importer's SQLite read query against the real 41.7M-row file, and syntax of all files.
**Not verified:** `db/schema.sql` against a real Postgres, `scripts/import-uprn.js` against a real cluster, and the Vercel deployment itself – run steps 1–3 above and `npm run diagnose` to confirm.

## Verification status (original engine)
Verified here: 13 unit tests (postcode parsing, permitted-development rules per work type) and 6 geometry/map tests
(front detection, rear placement, every work type, existing-extension offset, label spacing), plus a visual check of the overlays.
**Not verified:** anything that talks to the internet (OS Places, Photon/Overpass, Esri export, Mapillary, planning.data.gov.uk, Google) and the Express routes/UI
(dependencies couldn't be installed offline) – the API shapes were written from documentation. After `npm install`, run `npm test` (includes an
end-to-end mock-mode test) and smoke-test each provider with a real postcode.
