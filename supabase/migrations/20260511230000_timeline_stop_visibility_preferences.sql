create table if not exists public.timeline_stop_visibility_preferences (
  owner_id uuid not null references auth.users (id) on delete cascade,
  line_id text not null,
  scenario_id text not null,
  visible_stop_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (owner_id, line_id, scenario_id)
);

create index if not exists timeline_stop_visibility_preferences_owner_idx
  on public.timeline_stop_visibility_preferences (owner_id, scenario_id, line_id);

alter table public.timeline_stop_visibility_preferences enable row level security;

create or replace function public.set_timeline_stop_visibility_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_timeline_stop_visibility_preferences_updated_at on public.timeline_stop_visibility_preferences;
create trigger set_timeline_stop_visibility_preferences_updated_at
before update on public.timeline_stop_visibility_preferences
for each row execute function public.set_timeline_stop_visibility_preferences_updated_at();

create policy "timeline_stop_visibility_preferences_owner_only"
on public.timeline_stop_visibility_preferences
for all
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
