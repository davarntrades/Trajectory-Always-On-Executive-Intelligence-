begin;

alter table public.profiles
  add column if not exists pronouns text,
  add column if not exists timezone text not null default 'Europe/London',
  add column if not exists wake_time time not null default '08:00',
  add column if not exists bedtime time,
  add column if not exists involvement_level text not null default 'balanced'
    check (involvement_level in ('minimal', 'balanced', 'proactive')),
  add column if not exists notification_preferences jsonb not null default '{"daily_brief":true,"executive_signals":true}'::jsonb,
  add column if not exists voice_preferences jsonb not null default '{"enabled":true,"rate":1.01,"pitch":0.96,"language":"en-GB"}'::jsonb,
  add column if not exists priority_areas text[] not null default '{}',
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_version integer not null default 1;

create table if not exists public.morning_check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  timezone text not null,
  capacity text not null check (capacity in ('high', 'normal', 'low')),
  rejuvenation text not null check (rejuvenation in ('fully_restored', 'okay', 'drained')),
  sleep_quality text not null check (sleep_quality in ('great', 'okay', 'poor')),
  factors text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

alter table public.morning_check_ins enable row level security;

revoke all on table public.morning_check_ins from anon;
grant select, insert, update, delete on table public.morning_check_ins to authenticated;

drop policy if exists "morning_check_ins_select_own" on public.morning_check_ins;
create policy "morning_check_ins_select_own"
on public.morning_check_ins for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "morning_check_ins_insert_own" on public.morning_check_ins;
create policy "morning_check_ins_insert_own"
on public.morning_check_ins for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "morning_check_ins_update_own" on public.morning_check_ins;
create policy "morning_check_ins_update_own"
on public.morning_check_ins for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "morning_check_ins_delete_own" on public.morning_check_ins;
create policy "morning_check_ins_delete_own"
on public.morning_check_ins for delete to authenticated
using ((select auth.uid()) = user_id);

create index if not exists morning_check_ins_user_date_idx
  on public.morning_check_ins (user_id, local_date desc);

alter table public.executive_signals
  add column if not exists current_observation text,
  add column if not exists reasoning text,
  add column if not exists request_id uuid,
  add column if not exists morning_check_in_id uuid references public.morning_check_ins(id) on delete set null;

create unique index if not exists executive_signals_user_request_idx
  on public.executive_signals (user_id, request_id)
  where request_id is not null;

commit;
