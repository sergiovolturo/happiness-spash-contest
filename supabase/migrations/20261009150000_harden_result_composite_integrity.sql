-- Enforce the Contest/category/submission relationships used by results.
-- Triggers are used because the current tables do not duplicate all identity
-- columns needed for native composite foreign keys. This preserves the schema
-- shape and requires no data backfill or RPC signature changes.

create or replace function public._validate_result_snapshot_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_category_contest_id uuid;
begin
  select cc.contest_id
    into v_category_contest_id
    from public.contest_categories cc
   where cc.id = new.category_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'result_snapshot_category_not_found';
  end if;

  if v_category_contest_id is distinct from new.contest_id then
    raise exception using errcode = 'P0001', message = 'result_snapshot_contest_category_mismatch';
  end if;

  return new;
end;
$function$;

create or replace function public._validate_submission_contest_category_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_category_contest_id uuid;
  v_participation_contest_id uuid;
begin
  select cc.contest_id
    into v_category_contest_id
    from public.contest_categories cc
   where cc.id = new.category_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'submission_category_not_found';
  end if;

  select cp.contest_id
    into v_participation_contest_id
    from public.contest_participations cp
   where cp.id = new.participation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'submission_participation_not_found';
  end if;

  if v_category_contest_id is distinct from v_participation_contest_id then
    raise exception using errcode = 'P0001', message = 'submission_contest_category_mismatch';
  end if;

  return new;
end;
$function$;

create or replace function public._validate_result_entry_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot_contest_id uuid;
  v_snapshot_category_id uuid;
  v_submission_category_id uuid;
  v_submission_contest_id uuid;
begin
  select rs.contest_id, rs.category_id
    into v_snapshot_contest_id, v_snapshot_category_id
    from public.contest_result_snapshots rs
   where rs.id = new.snapshot_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'result_entry_snapshot_not_found';
  end if;

  select s.category_id, cp.contest_id
    into v_submission_category_id, v_submission_contest_id
    from public.submissions s
    join public.contest_participations cp on cp.id = s.participation_id
   where s.id = new.submission_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'result_entry_submission_not_found';
  end if;

  if v_submission_category_id is distinct from v_snapshot_category_id then
    raise exception using errcode = 'P0001', message = 'result_entry_category_mismatch';
  end if;

  if v_submission_contest_id is distinct from v_snapshot_contest_id then
    raise exception using errcode = 'P0001', message = 'result_entry_contest_mismatch';
  end if;

  return new;
end;
$function$;

drop trigger if exists contest_result_snapshots_integrity_trg on public.contest_result_snapshots;
create trigger contest_result_snapshots_integrity_trg
before insert or update of contest_id, category_id
on public.contest_result_snapshots
for each row execute function public._validate_result_snapshot_integrity();

drop trigger if exists submissions_contest_category_integrity_trg on public.submissions;
create trigger submissions_contest_category_integrity_trg
before insert or update of participation_id, category_id
on public.submissions
for each row execute function public._validate_submission_contest_category_integrity();

drop trigger if exists contest_result_entries_integrity_trg on public.contest_result_entries;
create trigger contest_result_entries_integrity_trg
before insert or update of snapshot_id, submission_id
on public.contest_result_entries
for each row execute function public._validate_result_entry_integrity();

revoke all on function public._validate_result_snapshot_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_submission_contest_category_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_result_entry_integrity() from public, anon, authenticated, service_role;
