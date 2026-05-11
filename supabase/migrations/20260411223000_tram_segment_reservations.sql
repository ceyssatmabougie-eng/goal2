create table if not exists public.tram_segment_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  scenario_id text not null check (scenario_id in ('weekday', 'saturday', 'sunday', 'pvs')),
  line_id text not null default 'A',
  run_id text not null,
  run_label text,
  vehicle_label text,
  direction_label text,
  start_stop_id text not null,
  start_stop_label text,
  end_stop_id text not null,
  end_stop_label text,
  start_minute integer not null check (start_minute >= 0),
  end_minute integer not null check (end_minute > start_minute),
  mediator_count integer not null check (mediator_count between 1 and 2),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, scenario_id, line_id, run_id, start_stop_id, end_stop_id)
);

create table if not exists public.tram_segment_reservation_mediators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  reservation_id uuid not null references public.tram_segment_reservations (id) on delete cascade,
  mediator_id uuid not null references public.mediators (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (reservation_id, mediator_id)
);

create index if not exists tram_segment_reservations_owner_idx
  on public.tram_segment_reservations (owner_id, scenario_id, start_minute);

create index if not exists tram_segment_reservation_mediators_owner_idx
  on public.tram_segment_reservation_mediators (owner_id, reservation_id, mediator_id);

drop trigger if exists set_tram_segment_reservations_updated_at on public.tram_segment_reservations;
create trigger set_tram_segment_reservations_updated_at
before update on public.tram_segment_reservations
for each row execute function public.handle_updated_at();

alter table public.tram_segment_reservations enable row level security;
alter table public.tram_segment_reservation_mediators enable row level security;

create policy "tram_segment_reservations_owner_only" on public.tram_segment_reservations
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "tram_segment_reservation_mediators_owner_only" on public.tram_segment_reservation_mediators
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
