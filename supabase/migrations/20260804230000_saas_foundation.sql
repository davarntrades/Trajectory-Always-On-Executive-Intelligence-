-- Trajectory SaaS foundation
-- Multi-user identity, persistent workspace data, connector lifecycle and
-- background intelligence. All user data is owner-scoped and RLS protected.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  provider text not null default 'auto'
    check (provider in ('auto', 'anthropic', 'openai', 'gemini', 'grok', 'local')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Europe/London',
  provider_mode text not null default 'auto'
    check (provider_mode in ('auto', 'anthropic', 'openai', 'gemini', 'grok', 'local')),
  voice_enabled boolean not null default true,
  background_intelligence_enabled boolean not null default true,
  daily_brief_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  status text not null default 'active' check (status in ('active', 'archived')),
  provider text check (provider in ('anthropic', 'openai', 'gemini', 'grok', 'local')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (id, user_id)
);

create index if not exists conversations_user_recent_idx
  on public.conversations (user_id, last_message_at desc nulls last, created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  provider text,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.conversations (id, user_id) on delete cascade
);

create index if not exists messages_conversation_time_idx
  on public.messages (user_id, conversation_id, created_at);

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  brief_date date not null,
  cadence text not null default 'morning'
    check (cadence in ('morning', 'midday', 'evening', 'on_demand')),
  title text not null,
  summary text not null,
  content jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  unique (user_id, brief_date, cadence)
);

create index if not exists daily_briefs_user_date_idx
  on public.daily_briefs (user_id, brief_date desc);

create table if not exists public.trajectory_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  observed_at timestamptz not null default now(),
  direction text not null check (direction in ('accelerating', 'steady', 'slipping', 'stalled')),
  score numeric,
  risk_level text not null check (risk_level in ('low', 'elevated', 'high', 'critical')),
  current_constraint text,
  recommendation text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  expected_impact numeric,
  urgency numeric check (urgency is null or (urgency >= 0 and urgency <= 1)),
  opportunity_cost numeric,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trajectory_history_user_time_idx
  on public.trajectory_history (user_id, observed_at desc);

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid,
  transcript text,
  response_text text,
  provider text,
  model text,
  duration_ms integer,
  status text not null default 'completed'
    check (status in ('started', 'completed', 'failed', 'cancelled')),
  error_code text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.conversations (id, user_id) on delete cascade
);

create index if not exists voice_sessions_user_time_idx
  on public.voice_sessions (user_id, created_at desc);

create table if not exists public.executive_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  highest_leverage_recommendation text not null,
  why_it_matters text not null,
  current_constraint text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  expected_trajectory_impact numeric,
  suggested_next_action text,
  urgency numeric check (urgency is null or (urgency >= 0 and urgency <= 1)),
  opportunity_cost numeric,
  source_fingerprint text not null,
  provider text,
  model text,
  generated_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index if not exists executive_signals_user_fingerprint_idx
  on public.executive_signals (user_id, source_fingerprint)
  where superseded_at is null;
create index if not exists executive_signals_user_recent_idx
  on public.executive_signals (user_id, generated_at desc);

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id text not null,
  state_hash text not null unique,
  code_verifier text,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_states_user_expiry_idx
  on public.oauth_states (user_id, expires_at desc);

alter table public.connector_accounts
  add column if not exists encrypted_credentials text,
  add column if not exists credential_iv text,
  add column if not exists credential_tag text,
  add column if not exists permissions text[] not null default '{}',
  add column if not exists oauth_scopes text[] not null default '{}',
  add column if not exists sync_status text not null default 'idle',
  add column if not exists last_health_at timestamptz,
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.connector_accounts
  drop constraint if exists connector_accounts_status_check;
alter table public.connector_accounts
  add constraint connector_accounts_status_check
  check (status in ('connected', 'disconnected', 'degraded', 'error'));

create table if not exists public.connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_account_id uuid not null references public.connector_accounts (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  source_fingerprint text,
  events_observed integer not null default 0,
  events_added integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists connector_sync_runs_user_time_idx
  on public.connector_sync_runs (user_id, started_at desc);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_type text not null,
  source_fingerprint text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  result jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, job_type, source_fingerprint)
);

create index if not exists background_jobs_user_time_idx
  on public.background_jobs (user_id, started_at desc);

create table if not exists public.provider_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  task_type text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  estimated_cost_usd numeric,
  success boolean not null,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists provider_usage_user_time_idx
  on public.provider_usage (user_id, created_at desc);

-- Existing core ownership constraints and indexes become tenant-safe.
alter table public.events drop constraint if exists events_source_external_id_key;
alter table public.events
  add constraint events_owner_source_external_id_key
  unique (owner_id, source, external_id);

-- Profile creation is the one deliberate SECURITY DEFINER boundary. It lives
-- outside exposed schemas, has an empty search path and is not user-callable.
create or replace function private.handle_new_trajectory_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_trajectory_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_trajectory on auth.users;
create trigger on_auth_user_created_trajectory
  after insert on auth.users
  for each row execute function private.handle_new_trajectory_user();

-- Add missing profiles for users created before this migration.
insert into public.profiles (id, display_name, avatar_url, created_at)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
  u.created_at
from auth.users u
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- RLS for all SaaS tables. Ownership is derived only from auth.uid(); user
-- metadata is intentionally never used for authorization.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_settings', 'user_preferences', 'conversations', 'messages',
    'daily_briefs', 'trajectory_history', 'voice_sessions', 'executive_signals',
    'oauth_states', 'connector_sync_runs', 'background_jobs', 'provider_usage'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = %I) with check ((select auth.uid()) = %I)',
      table_name || '_owner', table_name,
      case when table_name in ('profiles') then 'id' else 'user_id' end,
      case when table_name in ('profiles') then 'id' else 'user_id' end
    );
  end loop;
end $$;

-- Replace broad legacy policies with explicit authenticated owner policies.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'entities', 'relationships', 'goals', 'projects', 'tasks', 'opportunities',
    'events', 'memories', 'state_snapshots', 'connector_accounts', 'actions',
    'audit_log', 'permission_policies', 'notifications'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      table_name || '_owner', table_name
    );
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles, public.user_settings, public.user_preferences,
  public.conversations, public.messages, public.daily_briefs,
  public.trajectory_history, public.voice_sessions, public.executive_signals,
  public.connector_sync_runs, public.background_jobs,
  public.provider_usage, public.entities, public.relationships, public.goals,
  public.projects, public.tasks, public.opportunities, public.events,
  public.memories, public.state_snapshots,
  public.actions, public.audit_log, public.permission_policies,
  public.notifications
to authenticated;

grant usage, select on sequence public.audit_log_id_seq to authenticated;

-- OAuth state, refresh tokens and encrypted connector material are server-only.
-- RLS remains enabled as defence in depth, but neither browser role can query
-- these tables through the Data API.
revoke all on table public.oauth_states, public.connector_accounts from anon, authenticated;

revoke all on table
  public.profiles, public.user_settings, public.user_preferences,
  public.conversations, public.messages, public.daily_briefs,
  public.trajectory_history, public.voice_sessions, public.executive_signals,
  public.oauth_states, public.connector_sync_runs, public.background_jobs,
  public.provider_usage, public.entities, public.relationships, public.goals,
  public.projects, public.tasks, public.opportunities, public.events,
  public.memories, public.state_snapshots, public.connector_accounts,
  public.actions, public.audit_log, public.permission_policies,
  public.notifications
from anon;

comment on table public.profiles is 'One automatically-created Trajectory workspace identity per Supabase Auth user.';
comment on column public.connector_accounts.encrypted_credentials is 'AES-256-GCM ciphertext; keys remain in server environment variables.';
