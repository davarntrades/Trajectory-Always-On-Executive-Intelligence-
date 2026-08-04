-- Trajectory — core schema
-- Append-only where it matters: events and state_snapshots are never mutated,
-- so any past day can be replayed exactly as Trajectory saw it.

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Entity graph
-- ---------------------------------------------------------------------------

create type entity_kind as enum (
  'person', 'company', 'project', 'product', 'tool', 'topic'
);

create table entities (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null,
  kind          entity_kind not null,
  name          text not null,
  aliases       text[] not null default '{}',
  summary       text,
  attributes    jsonb not null default '{}',
  embedding     vector(1536),
  salience      real not null default 0.5,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (owner_id, kind, name)
);

create index entities_owner_kind_idx on entities (owner_id, kind);
create index entities_embedding_idx on entities
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table relationships (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null,
  from_id     uuid not null references entities (id) on delete cascade,
  to_id       uuid not null references entities (id) on delete cascade,
  kind        text not null,          -- works_at | blocks | owns | stakeholder_of | ...
  strength    real not null default 0.5,
  attributes  jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (from_id, to_id, kind)
);

create index relationships_from_idx on relationships (from_id);
create index relationships_to_idx on relationships (to_id);

-- ---------------------------------------------------------------------------
-- Intent: goals, projects, tasks, opportunities
-- ---------------------------------------------------------------------------

create table goals (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null,
  title       text not null,
  description text,
  horizon     text not null default 'quarter',  -- week | month | quarter | year
  target      text,
  priority    int not null default 3,           -- 1 highest
  status      text not null default 'active',   -- active | achieved | abandoned
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table projects (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null,
  goal_id       uuid references goals (id) on delete set null,
  entity_id     uuid references entities (id) on delete set null,
  name          text not null,
  description   text,
  status        text not null default 'active', -- active | paused | shipped | dropped
  priority      int not null default 3,
  value_score   real not null default 0.5,      -- 0..1 strategic value
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index projects_owner_status_idx on projects (owner_id, status);

create table tasks (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null,
  project_id    uuid references projects (id) on delete cascade,
  title         text not null,
  detail        text,
  status        text not null default 'open',   -- open | in_progress | blocked | waiting | done
  effort_hours  real not null default 1,
  impact        real not null default 0.5,      -- 0..1
  due_at        timestamptz,
  blocked_by    uuid[] not null default '{}',   -- task ids
  waiting_on    uuid references entities (id) on delete set null,
  waiting_since timestamptz,
  source        text,                            -- connector id that created it
  external_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tasks_owner_status_idx on tasks (owner_id, status);
create index tasks_due_idx on tasks (due_at) where due_at is not null;

create table opportunities (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null,
  company_id         uuid references entities (id) on delete set null,
  contact_id         uuid references entities (id) on delete set null,
  name               text not null,
  stage              text not null default 'discovery',
  value              numeric not null default 0,
  currency           text not null default 'GBP',
  probability        real not null default 0.2,
  last_contact_at    timestamptz,
  expected_reply_days int not null default 5,
  next_step          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index opportunities_owner_stage_idx on opportunities (owner_id, stage);

-- ---------------------------------------------------------------------------
-- Observation log — append only
-- ---------------------------------------------------------------------------

create table events (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null,
  source       text not null,          -- connector id
  type         text not null,          -- email.received | github.pr_merged | ...
  title        text not null,
  body         text,
  occurred_at  timestamptz not null,
  entity_ids   uuid[] not null default '{}',
  project_id   uuid references projects (id) on delete set null,
  external_id  text,
  payload      jsonb not null default '{}',
  ingested_at  timestamptz not null default now(),
  unique (source, external_id)
);

create index events_owner_time_idx on events (owner_id, occurred_at desc);
create index events_project_time_idx on events (project_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Memory
-- ---------------------------------------------------------------------------

create type memory_kind as enum ('episodic', 'semantic', 'decision', 'preference', 'mistake');

create table memories (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null,
  kind         memory_kind not null,
  content      text not null,
  entity_ids   uuid[] not null default '{}',
  source_event uuid references events (id) on delete set null,
  confidence   real not null default 0.7,
  salience     real not null default 0.5,
  embedding    vector(1536),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  superseded_by uuid references memories (id) on delete set null
);

create index memories_owner_kind_idx on memories (owner_id, kind);
create index memories_embedding_idx on memories
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Hybrid retrieval: vector similarity, filtered to live memories.
create or replace function match_memories (
  query_embedding vector(1536),
  match_owner     uuid,
  match_count     int default 12,
  min_similarity  real default 0.5
)
returns table (
  id         uuid,
  kind       memory_kind,
  content    text,
  entity_ids uuid[],
  salience   real,
  occurred_at timestamptz,
  similarity real
)
language sql stable
as $$
  select m.id, m.kind, m.content, m.entity_ids, m.salience, m.occurred_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.owner_id = match_owner
    and m.superseded_by is null
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > min_similarity
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Computed state — append only
-- ---------------------------------------------------------------------------

create table state_snapshots (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null,
  computed_at        timestamptz not null default now(),
  trajectory         text not null,          -- accelerating | steady | slipping | stalled
  risk_level         text not null,          -- low | elevated | high | critical
  commercial_momentum real not null,
  project_momentum   jsonb not null default '{}',
  bottleneck         jsonb,
  recommended_action jsonb,
  reasoning          text,
  signals            jsonb not null default '{}',  -- every input that produced this
  model              text
);

create index state_owner_time_idx on state_snapshots (owner_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- Connectors + audit
-- ---------------------------------------------------------------------------

create table connector_accounts (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null,
  connector_id  text not null,
  display_name  text,
  status        text not null default 'disconnected',
  credentials   jsonb,                  -- encrypted at rest via Supabase Vault
  sync_cursor   text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (owner_id, connector_id)
);

create type action_tier as enum ('observe', 'recommend', 'draft', 'approve', 'execute');
create type action_status as enum ('proposed', 'awaiting_approval', 'approved', 'rejected', 'executed', 'failed');

create table actions (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null,
  connector_id  text,
  capability    text not null,
  tier          action_tier not null,
  status        action_status not null default 'proposed',
  summary       text not null,
  payload       jsonb not null default '{}',
  rationale     text,
  snapshot_id   uuid references state_snapshots (id) on delete set null,
  decided_at    timestamptz,
  decided_by    text,
  executed_at   timestamptz,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

create index actions_owner_status_idx on actions (owner_id, status);

-- Immutable audit trail. Every transition on `actions` lands here.
create table audit_log (
  id          bigserial primary key,
  owner_id    uuid not null,
  action_id   uuid references actions (id) on delete set null,
  at          timestamptz not null default now(),
  actor       text not null,           -- 'trajectory' | 'davarn' | connector id
  event       text not null,           -- proposed | approved | executed | ...
  tier        action_tier,
  detail      jsonb not null default '{}'
);

create index audit_owner_time_idx on audit_log (owner_id, at desc);

create table permission_policies (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null,
  connector_id text,                    -- null = applies to all
  capability   text not null,
  max_tier     action_tier not null default 'recommend',
  updated_at   timestamptz not null default now(),
  unique (owner_id, connector_id, capability)
);

-- ---------------------------------------------------------------------------
-- Row level security — every table is owner-scoped
-- ---------------------------------------------------------------------------

alter table entities             enable row level security;
alter table relationships        enable row level security;
alter table goals                enable row level security;
alter table projects             enable row level security;
alter table tasks                enable row level security;
alter table opportunities        enable row level security;
alter table events               enable row level security;
alter table memories             enable row level security;
alter table state_snapshots      enable row level security;
alter table connector_accounts   enable row level security;
alter table actions              enable row level security;
alter table audit_log            enable row level security;
alter table permission_policies  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'entities','relationships','goals','projects','tasks','opportunities',
    'events','memories','state_snapshots','connector_accounts','actions',
    'audit_log','permission_policies'
  ]
  loop
    execute format(
      'create policy %I_owner on %I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t, t
    );
  end loop;
end $$;
