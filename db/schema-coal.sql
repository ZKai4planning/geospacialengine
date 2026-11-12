-- Coal mining Development High Risk Areas (Mining Remediation Authority). Plain Postgres, no PostGIS: same approach as inspire_parcels.
-- Append this to db/schema.sql (or run it once with psql). Safe to re-run.
create table if not exists coal_risk_areas (
  id     bigserial primary key,
  kind   text    not null default 'high',          -- 'high' = Development High Risk Area
  ref    text,
  name   text,
  bbox   box     not null,                          -- (maxLng,maxLat),(minLng,minLat); GiST-indexed for the "near this point" lookup
  parts  jsonb   not null                           -- [ polygon, ... ]  polygon = [ outerRing, hole, ... ]  ring = [[lng,lat], ...] (WGS84)
);
create index if not exists coal_risk_areas_bbox on coal_risk_areas using gist (bbox);
create table if not exists coal_risk_meta (
  kind      text primary key,
  features  integer     not null,
  source    text,
  loaded_at timestamptz not null default now()
);
