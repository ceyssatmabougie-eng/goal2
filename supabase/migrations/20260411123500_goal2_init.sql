create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  organization_name text default 'Goal 2',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mediators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  home_sector text,
  can_drive boolean not null default false,
  shift_start time,
  shift_end time,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  area_label text,
  max_mediators integer not null default 2 check (max_mediators between 1 and 2),
  status text not null default 'draft' check (status in ('draft', 'published', 'issue')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  service_date date not null default current_date,
  line_hint text,
  origin_label text,
  destination_label text,
  start_time time,
  end_time time,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'issue')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.roadmap_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps (id) on delete cascade,
  mediator_id uuid not null references public.mediators (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  role text default 'mediator',
  created_at timestamptz not null default timezone('utc', now()),
  unique (roadmap_id, mediator_id)
);

create table if not exists public.gtfs_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_url text not null,
  imported_at timestamptz not null default timezone('utc', now()),
  valid_from date,
  valid_to date,
  note text
);

create table if not exists public.gtfs_routes (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null references public.gtfs_imports (id) on delete cascade,
  route_id text not null,
  agency_id text,
  route_short_name text,
  route_long_name text,
  route_desc text,
  route_type integer,
  route_color text,
  route_text_color text,
  route_sort_order integer,
  unique (owner_id, import_id, route_id)
);

create table if not exists public.gtfs_stops (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null references public.gtfs_imports (id) on delete cascade,
  stop_id text not null,
  stop_code text,
  stop_name text not null,
  stop_lat double precision,
  stop_lon double precision,
  location_type integer,
  parent_station text,
  unique (owner_id, import_id, stop_id)
);

create table if not exists public.gtfs_trips (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null references public.gtfs_imports (id) on delete cascade,
  trip_id text not null,
  service_id text,
  route_id text,
  trip_headsign text,
  trip_short_name text,
  direction_id integer,
  shape_id text,
  unique (owner_id, import_id, trip_id)
);

create table if not exists public.gtfs_stop_times (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null references public.gtfs_imports (id) on delete cascade,
  trip_id text not null,
  stop_id text not null,
  stop_sequence integer not null,
  arrival_time text,
  departure_time text,
  stop_headsign text,
  pickup_type integer,
  drop_off_type integer,
  shape_dist_traveled numeric,
  unique (owner_id, import_id, trip_id, stop_sequence)
);

create index if not exists mediators_owner_idx on public.mediators (owner_id);
create index if not exists vehicles_owner_idx on public.vehicles (owner_id);
create index if not exists roadmaps_owner_date_idx on public.roadmaps (owner_id, service_date desc);
create index if not exists assignments_owner_idx on public.roadmap_assignments (owner_id, roadmap_id, vehicle_id);
create index if not exists gtfs_imports_owner_idx on public.gtfs_imports (owner_id, imported_at desc);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.handle_updated_at();

drop trigger if exists set_mediators_updated_at on public.mediators;
create trigger set_mediators_updated_at
before update on public.mediators
for each row execute function public.handle_updated_at();

drop trigger if exists set_vehicles_updated_at on public.vehicles;
create trigger set_vehicles_updated_at
before update on public.vehicles
for each row execute function public.handle_updated_at();

drop trigger if exists set_roadmaps_updated_at on public.roadmaps;
create trigger set_roadmaps_updated_at
before update on public.roadmaps
for each row execute function public.handle_updated_at();

create or replace function public.enforce_vehicle_capacity()
returns trigger
language plpgsql
as $$
declare
  capacity_limit integer := 2;
  current_assignments integer := 0;
begin
  if new.vehicle_id is null then
    return new;
  end if;

  select max_mediators
  into capacity_limit
  from public.vehicles
  where id = new.vehicle_id;

  capacity_limit := coalesce(capacity_limit, 2);

  select count(*)
  into current_assignments
  from public.roadmap_assignments
  where roadmap_id = new.roadmap_id
    and vehicle_id = new.vehicle_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if current_assignments >= capacity_limit then
    raise exception 'Goal 2: impossible d''affecter plus de % mediateurs au véhicule % pour cette feuille.', capacity_limit, new.vehicle_id;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_vehicle_capacity_before_write on public.roadmap_assignments;
create trigger enforce_vehicle_capacity_before_write
before insert or update on public.roadmap_assignments
for each row execute function public.enforce_vehicle_capacity();

alter table public.profiles enable row level security;
alter table public.mediators enable row level security;
alter table public.vehicles enable row level security;
alter table public.roadmaps enable row level security;
alter table public.roadmap_assignments enable row level security;
alter table public.gtfs_imports enable row level security;
alter table public.gtfs_routes enable row level security;
alter table public.gtfs_stops enable row level security;
alter table public.gtfs_trips enable row level security;
alter table public.gtfs_stop_times enable row level security;

create policy "profiles_owner_only" on public.profiles
for all
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "mediators_owner_only" on public.mediators
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "vehicles_owner_only" on public.vehicles
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "roadmaps_owner_only" on public.roadmaps
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "roadmap_assignments_owner_only" on public.roadmap_assignments
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "gtfs_imports_owner_only" on public.gtfs_imports
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "gtfs_routes_owner_only" on public.gtfs_routes
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "gtfs_stops_owner_only" on public.gtfs_stops
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "gtfs_trips_owner_only" on public.gtfs_trips
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "gtfs_stop_times_owner_only" on public.gtfs_stop_times
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
