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
  -- Lock the category before validating it. Snapshot writers use the same
  -- parent lock, so a concurrent category move cannot pass this check.
  select cc.contest_id
    into v_category_contest_id
    from public.contest_categories cc
   where cc.id = new.category_id
   for update;

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
  -- Child writes lock category, then participation, in this fixed order.
  select cc.contest_id
    into v_category_contest_id
    from public.contest_categories cc
   where cc.id = new.category_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'submission_category_not_found';
  end if;

  select cp.contest_id
    into v_participation_contest_id
    from public.contest_participations cp
   where cp.id = new.participation_id
   for update;
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
  -- Lock the referenced snapshot and submission before comparing identities.
  select rs.contest_id, rs.category_id
    into v_snapshot_contest_id, v_snapshot_category_id
    from public.contest_result_snapshots rs
   where rs.id = new.snapshot_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'result_entry_snapshot_not_found';
  end if;

  select s.category_id, cp.contest_id
    into v_submission_category_id, v_submission_contest_id
    from public.submissions s
    join public.contest_participations cp on cp.id = s.participation_id
   where s.id = new.submission_id
   for update of s;
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

create or replace function public._validate_participation_contest_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Participation updates already hold the participation row lock. Lock all
  -- referenced categories before checking existing submissions. A concurrent
  -- submission writer must acquire the same category/participation sequence.
  perform 1
    from public.contest_categories cc
    join public.submissions s on s.category_id = cc.id
   where s.participation_id = new.id
   order by cc.id
   for update of cc;

  if exists (
    select 1
      from public.submissions s
      join public.contest_categories cc on cc.id = s.category_id
     where s.participation_id = new.id
       and cc.contest_id is distinct from new.contest_id
  ) then
    raise exception using errcode = 'P0001', message = 'participation_contest_change_would_break_submission_integrity';
  end if;

  return new;
end;
$function$;

create or replace function public._validate_category_contest_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Category updates already hold the category row lock. Lock referenced
  -- participations before checking submissions, in deterministic id order.
  perform 1
    from public.contest_participations cp
    join public.submissions s on s.participation_id = cp.id
   where s.category_id = new.id
   order by cp.id
   for update of cp;

  if exists (
    select 1
      from public.submissions s
      join public.contest_participations cp on cp.id = s.participation_id
     where s.category_id = new.id
       and cp.contest_id is distinct from new.contest_id
  ) then
    raise exception using errcode = 'P0001', message = 'category_contest_change_would_break_submission_integrity';
  end if;

  if exists (
    select 1
      from public.contest_result_snapshots rs
     where rs.category_id = new.id
       and rs.contest_id is distinct from new.contest_id
  ) then
    raise exception using errcode = 'P0001', message = 'category_contest_change_would_break_snapshot_integrity';
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

drop trigger if exists contest_participations_contest_integrity_trg on public.contest_participations;
create trigger contest_participations_contest_integrity_trg
before update of contest_id
on public.contest_participations
for each row execute function public._validate_participation_contest_integrity();

drop trigger if exists contest_categories_contest_integrity_trg on public.contest_categories;
create trigger contest_categories_contest_integrity_trg
before update of contest_id
on public.contest_categories
for each row execute function public._validate_category_contest_integrity();

revoke all on function public._validate_result_snapshot_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_submission_contest_category_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_result_entry_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_participation_contest_integrity() from public, anon, authenticated, service_role;
revoke all on function public._validate_category_contest_integrity() from public, anon, authenticated, service_role;
