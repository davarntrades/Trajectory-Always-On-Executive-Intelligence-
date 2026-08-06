-- Live open-work ingestion.
--
-- One canonical table for every unit of launch work, whether typed by hand or
-- ingested from GitHub. Trajectory previously had no authoritative record of
-- what was still open, which is what allowed completed work to be recycled as
-- advice. Status is constrained at the database level so a terminal item
-- cannot be written back into an open state by accident.

begin;

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable identity from the source, e.g. github_pull_request:owner/repo#11.
  -- Manual launch tasks generate their own.
  canonical_id text not null,
  title text not null,
  detail text,
  status text not null default 'open'
    check (status in ('open', 'active', 'blocked', 'completed', 'superseded')),
  source text not null default 'launch_backlog'
    check (source in ('launch_backlog', 'github_issue', 'github_pull_request')),
  external_repository text,
  external_number integer,
  external_url text,
  blocked_by text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  superseded_at timestamptz,
  superseded_by text,
  reopened_at timestamptz,
  unique (user_id, canonical_id),
  -- A completed item must carry the timestamp that proves it, and an open one
  -- must not claim completion. This is the invariant the whole slice rests on.
  constraint work_items_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint work_items_supersession_consistent check (
    (status = 'superseded' and superseded_at is not null)
    or (status <> 'superseded' and superseded_at is null)
  )
);

create index if not exists work_items_user_status_idx
  on public.work_items (user_id, status, updated_at desc);

alter table public.work_items enable row level security;

revoke all on table public.work_items from anon;
grant select, insert, update, delete on table public.work_items to authenticated;

drop policy if exists "work_items_select_own" on public.work_items;
create policy "work_items_select_own"
on public.work_items for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "work_items_insert_own" on public.work_items;
create policy "work_items_insert_own"
on public.work_items for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "work_items_update_own" on public.work_items;
create policy "work_items_update_own"
on public.work_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "work_items_delete_own" on public.work_items;
create policy "work_items_delete_own"
on public.work_items for delete to authenticated
using ((select auth.uid()) = user_id);

commit;
