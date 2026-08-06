begin;

revoke all privileges on table public.morning_check_ins from anon;
revoke all privileges on table public.morning_check_ins from authenticated;
grant select, insert, update, delete on table public.morning_check_ins to authenticated;

create index if not exists executive_signals_morning_check_in_idx
  on public.executive_signals (morning_check_in_id)
  where morning_check_in_id is not null;

commit;
