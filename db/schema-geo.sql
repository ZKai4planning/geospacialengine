-- Geo layers: every register dataset that is loaded onto YOUR server (flood maps, BGS geology, utility records, council registers ...).
-- Plain Postgres, no PostGIS (same approach as inspire_parcels and coal_risk_areas). Safe to re-run.
--   psql "$DATABASE_DIRECT_URL" -f db/schema-geo.sql        (or: npm run db:schema:geo)
create table if not exists geo_features (
  id        bigserial primary key,
  dataset   text  not null,                -- key from src/register/datasets.js
  authority text  not null default '',     -- '' = national dataset, otherwise the planning authority code the council data belongs to
  ref       text,
  name      text,
  key       text,                          -- normalised postcode or UPRN for keyed datasets (exact match)
  props     jsonb not null default '{}',   -- everything the check needs to read (risk band, status, dates, url ...)
  bbox      box,                           -- (maxLng,maxLat),(minLng,minLat); GiST-indexed - finds candidates near a point
  geom      jsonb                          -- GeoJSON geometry in WGS84; null for purely keyed rows
);
create index if not exists geo_features_bbox on geo_features using gist (bbox);
create index if not exists geo_features_ds   on geo_features (dataset, authority);
create index if not exists geo_features_key  on geo_features (dataset, authority, key) where key is not null;

create table if not exists geo_meta (
  dataset   text not null,
  authority text not null default '',
  features  integer not null,
  source    text,                          -- who published it and when (shown next to every finding)
  licence   text,
  coverage  jsonb,                         -- [minLng,minLat,maxLng,maxLat] when only part of the country was loaded (a point outside it is 'unavailable', not 'outside')
  loaded_at timestamptz not null default now(),
  primary key (dataset, authority)
);

-- Council planning standards (parking, cycle parking, density, SuDS ...) that are numbers and rules, not maps.
create table if not exists lpa_standards (
  authority    text not null,              -- planning authority code
  topic        text not null,              -- parking | cycle | density | suds | privacy | ...
  data         jsonb not null,             -- see src/register/standards.js for the shapes
  source       text,
  url          text,
  retrieved_on date,
  primary key (authority, topic)
);
