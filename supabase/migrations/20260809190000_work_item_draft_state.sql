-- Draft state is source metadata, not a status.
--
-- Draft pull requests previously normalised to `blocked`, which read to the
-- reasoning layer as an unresolved external obstacle and produced advice like
-- "write PR #12's blocker in one sentence" for a pull request that was simply
-- still being written. `blocked` now means an obstruction has actually been
-- recorded — a blocked label at the source, or a local blocked_by link — and
-- draft-ness travels beside the status instead of being encoded as one.
--
-- Additive and backwards compatible: one nullable-free boolean with a default.
-- No status values change, no constraint changes, and no existing row needs
-- rewriting. Existing rows default to false, which is correct for every row
-- written before this column existed except drafts, and those are corrected by
-- the next ingestion because GitHub remains authoritative for its own items.
--
-- Deployment ordering: apply this migration before deploying the code that
-- writes the column. A deployment that upserts `draft` against a table without
-- it fails the whole sync.

begin;

alter table public.work_items
  add column if not exists draft boolean not null default false;

comment on column public.work_items.draft is
  'Source metadata: the item is still being written. Unfinished, not obstructed. Never a reason to treat an item as blocked.';

commit;
