-- Enable the native Supabase scheduler when the project supports pg_cron.
create extension if not exists pg_cron with schema pg_catalog;

do $migration$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'process-contest-voting-windows' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'process-contest-voting-windows',
    '* * * * *',
    'select public.process_contest_voting_windows();'
  );
end;
$migration$;
