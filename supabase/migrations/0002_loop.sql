-- Continuous executive loop: delivered notifications.
-- Append-only, like every other log in the system, so "what did Trajectory tell
-- me and when" is answerable after the fact.

create table notifications (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid not null,
  at           timestamptz not null default now(),
  channel      text not null,              -- interrupt | digest
  cadence      text,                       -- morning | midday | evening
  title        text not null,
  body         text,
  salience     real not null default 0,
  change_kinds text[] not null default '{}',
  speech       text,
  delivered    boolean not null default false
);

create index notifications_owner_time_idx on notifications (owner_id, at desc);

alter table notifications enable row level security;
create policy notifications_owner on notifications
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
