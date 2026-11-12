-- =====================================================================================
-- UK Planning Engine – Postgres schema (works on any standard Postgres 12+: DigitalOcean, Neon, RDS, ...)
-- Run once:   psql "$DATABASE_URL" -f db/schema.sql      (or paste into your provider's SQL console)
-- Safe to re-run (everything is "if not exists" / "or replace").
-- =====================================================================================

-- ---------- 1. OS Open UPRN (≈41.7M rows for all of Great Britain) ------------------
-- No indexes here on purpose: scripts/import-uprn.js bulk-loads first and builds the
-- indexes afterwards (much faster than loading into an indexed table).
create table if not exists uprn (
  uprn   bigint  not null,   -- becomes the primary key after import
  lat_e7 integer not null,   -- latitude  * 1e7
  lng_e7 integer not null,   -- longitude * 1e7
  cell   integer not null    -- spatial grid cell, identical to src/utils/uprnGrid.js (0.002° cells)
);

create table if not exists uprn_meta (
  key   text primary key,
  value text
);

-- ---------- 2. Application drafts ---------------------------------------------------
create table if not exists applications (
  id         uuid primary key,
  data       jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_created_at_idx on applications (created_at);

-- ---------- 3. All UPRN points within p_radius_m metres, nearest first --------------
-- Walks the grid rows covering the circle's bounding box, then filters by exact haversine distance
-- (earth radius 6371008.8 m, same as src/utils/geo.js). Radius is capped at 1000 m.
create or replace function uprn_within(
  p_lat double precision, p_lng double precision, p_radius_m double precision
)
returns table (uprn bigint, lat_e7 integer, lng_e7 integer, dist_m double precision)
language sql stable
as $$
  with box as (
    select
      p_lat as lat, p_lng as lng,
      least(greatest(p_radius_m, 0), 1000) as r,
      floor((p_lat - least(greatest(p_radius_m, 0), 1000) / 111320.0) * 500)::integer as row0,
      floor((p_lat + least(greatest(p_radius_m, 0), 1000) / 111320.0) * 500)::integer as row1,
      floor((p_lng - least(greatest(p_radius_m, 0), 1000) / (111320.0 * cos(radians(p_lat))) + 10) * 500)::integer as col0,
      floor((p_lng + least(greatest(p_radius_m, 0), 1000) / (111320.0 * cos(radians(p_lat))) + 10) * 500)::integer as col1
  )
  select u.uprn, u.lat_e7, u.lng_e7, d.dist_m
  from box b
  cross join lateral generate_series(b.row0, b.row1) as g(row_idx)
  join uprn u
    on u.cell between g.row_idx * 10000 + b.col0 and g.row_idx * 10000 + b.col1
  cross join lateral (
    select 2 * 6371008.8 * asin(sqrt(least(1.0::double precision,
             power(sin(radians(u.lat_e7::double precision / 1e7 - b.lat) / 2), 2)
           + cos(radians(b.lat)) * cos(radians(u.lat_e7::double precision / 1e7))
             * power(sin(radians(u.lng_e7::double precision / 1e7 - b.lng) / 2), 2)))) as dist_m
  ) d
  where d.dist_m <= b.r
  order by d.dist_m;
$$;

-- ---------- 4. Batch version: one round-trip for a whole postcode's address list ----
-- p_points = [{"idx":0,"lat":51.5,"lng":0.05}, ...]  (max 500 points)
-- Returns up to p_limit nearest UPRNs within p_max_m for each idx.
create or replace function uprn_nearest_batch(
  p_points jsonb, p_max_m double precision default 15, p_limit integer default 5
)
returns table (idx integer, uprn bigint, lat_e7 integer, lng_e7 integer, dist_m double precision)
language sql stable
as $$
  select p.idx, n.uprn, n.lat_e7, n.lng_e7, n.dist_m
  from jsonb_to_recordset(
         case when jsonb_array_length(p_points) <= 500 then p_points else '[]'::jsonb end
       ) as p(idx integer, lat double precision, lng double precision)
  cross join lateral (
    select w.uprn, w.lat_e7, w.lng_e7, w.dist_m
    from uprn_within(p.lat, p.lng, p_max_m) w
    order by w.dist_m
    limit least(greatest(p_limit, 1), 20)
  ) n;
$$;

-- ---------- 5. Atomic shallow merge for application drafts --------------------------
-- Equivalent to the old memory store's {...current, ...patch}.
create or replace function application_patch(p_id uuid, p_patch jsonb)
returns jsonb
language sql
as $$
  update applications
     set data = data || p_patch,
         updated_at = now()
   where id = p_id
  returning data;
$$;

-- ---------- 6. OPTIONAL: delete drafts older than 30 days ----------------------------
-- Run from a daily scheduler (e.g. a Vercel Cron hitting a protected route, or your provider's job runner):
--   delete from applications where created_at < now() - interval '30 days';

-- ---------- 7. HM Land Registry INSPIRE parcels (cadastral polygons, England & Wales) -----------
-- Loaded by scripts/import-inspire.js (one council file at a time). Uses Postgres's built-in `box` type and a GiST index,
-- so it needs NO PostGIS. One row per polygon; a registered extent made of several pieces has `parts` > 1 (same inspire_id).
-- ring_e7 is the outer ring flattened as [lng_e7, lat_e7, lng_e7, lat_e7, ...] (degrees * 1e7), closed.
create table if not exists inspire_parcels (
  id          bigserial,
  inspire_id  text,
  council     text      not null,
  parts       smallint  not null default 1,
  area_m2     real      not null,
  bbox        box       not null,        -- ((max_lng,max_lat),(min_lng,min_lat))
  ring_e7     integer[] not null
);
create index if not exists inspire_parcels_bbox_idx    on inspire_parcels using gist (bbox);
create index if not exists inspire_parcels_council_idx on inspire_parcels (council);
create index if not exists inspire_parcels_inspire_idx on inspire_parcels (inspire_id, council);

create table if not exists inspire_meta (
  key   text primary key,
  value text
);

-- Parcels whose bounding box touches a small box (p_pad_m metres each way, max 20) around the point. The caller does the exact
-- point-in-polygon test (src/providers/inspireLocal.js), so this stays a cheap index-only lookup.
create or replace function inspire_parcels_at(
  p_lat double precision, p_lng double precision, p_pad_m double precision default 1.5
)
returns table (id bigint, inspire_id text, council text, parts smallint, area_m2 real, ring_e7 integer[])
language sql stable
as $$
  select p.id, p.inspire_id, p.council, p.parts, p.area_m2, p.ring_e7
  from inspire_parcels p
  where p.bbox && box(
    point(p_lng - least(greatest(p_pad_m, 0), 20) / (111320.0 * cos(radians(p_lat))), p_lat - least(greatest(p_pad_m, 0), 20) / 111320.0),
    point(p_lng + least(greatest(p_pad_m, 0), 20) / (111320.0 * cos(radians(p_lat))), p_lat + least(greatest(p_pad_m, 0), 20) / 111320.0))
  limit 40;
$$;

-- The other pieces of a multi-part registered extent.
create or replace function inspire_parts(p_inspire_id text, p_council text)
returns table (id bigint, inspire_id text, council text, parts smallint, area_m2 real, ring_e7 integer[])
language sql stable
as $$
  select p.id, p.inspire_id, p.council, p.parts, p.area_m2, p.ring_e7
  from inspire_parcels p
  where p.inspire_id = p_inspire_id and p.council = p_council
  limit 40;
$$;

