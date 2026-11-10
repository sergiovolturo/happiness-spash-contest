-- Performance-only hardening.  The policy predicates are unchanged; wrapping
-- auth.uid() in a scalar SELECT lets PostgreSQL evaluate it once per statement
-- instead of once per candidate row.
do $migration$
declare
  p record;
  optimized_using text;
  optimized_check text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual like '%auth.uid()%' and qual not like '%( SELECT auth.uid()%')
        or
        (with_check is not null and with_check like '%auth.uid()%' and with_check not like '%( SELECT auth.uid()%')
      )
  loop
    optimized_using := case
      when p.qual is null then null
      else replace(p.qual, 'auth.uid()', '(select auth.uid())')
    end;
    optimized_check := case
      when p.with_check is null then null
      else replace(p.with_check, 'auth.uid()', '(select auth.uid())')
    end;

    if optimized_using is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        p.policyname, p.schemaname, p.tablename, optimized_using
      );
    end if;
    if optimized_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        p.policyname, p.schemaname, p.tablename, optimized_check
      );
    end if;
  end loop;
end
$migration$;

-- These indexes cover the public/results joins observed in the live RPCs.
-- Existing primary/unique indexes already cover the other hot paths.
create index if not exists contest_finalists_contest_category_idx
  on public.contest_finalists (contest_id, category_id);

create index if not exists contest_result_entries_submission_idx
  on public.contest_result_entries (submission_id);

create index if not exists contest_result_snapshots_category_idx
  on public.contest_result_snapshots (category_id, status, published_at desc);
