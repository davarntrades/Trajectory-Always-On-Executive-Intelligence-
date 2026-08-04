-- Production hardening after first deployment to trajectory-prod.
-- Resolve Supabase security-advisor findings and add covering indexes for
-- foreign keys used by tenant-scoped cascade/update paths.

create schema if not exists extensions;

alter extension vector set schema extensions;

alter function public.match_memories(
  extensions.vector,
  uuid,
  integer,
  real
) set search_path = public, extensions;

create index if not exists actions_snapshot_id_idx
  on public.actions (snapshot_id);
create index if not exists audit_log_action_id_idx
  on public.audit_log (action_id);
create index if not exists connector_sync_runs_account_id_idx
  on public.connector_sync_runs (connector_account_id);
create index if not exists memories_source_event_idx
  on public.memories (source_event);
create index if not exists memories_superseded_by_idx
  on public.memories (superseded_by);
create index if not exists messages_conversation_owner_idx
  on public.messages (conversation_id, user_id);
create index if not exists opportunities_company_id_idx
  on public.opportunities (company_id);
create index if not exists opportunities_contact_id_idx
  on public.opportunities (contact_id);
create index if not exists projects_entity_id_idx
  on public.projects (entity_id);
create index if not exists projects_goal_id_idx
  on public.projects (goal_id);
create index if not exists tasks_project_id_idx
  on public.tasks (project_id);
create index if not exists tasks_waiting_on_idx
  on public.tasks (waiting_on);
create index if not exists voice_sessions_conversation_owner_idx
  on public.voice_sessions (conversation_id, user_id);
