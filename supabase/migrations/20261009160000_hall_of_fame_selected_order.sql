create or replace function public.get_public_hall_of_fame()
returns table (contest_name text, category_name text, winner_name text, selected_at timestamptz, media_bucket text, media_path text, thumbnail_bucket text, thumbnail_path text)
language sql stable security definer set search_path=''
as $function$
  select c.name, cd.name, coalesce(nullif(btrim(s.contestant_display_name),''),'Vincitore senza nome'), cw.selected_at, sm.storage_bucket, sm.storage_path,
    case when thumb_webp.name is not null or thumb_jpg.name is not null then 'contest-thumbnails' end, coalesce(thumb_webp.name,thumb_jpg.name)
  from public.contest_winners cw
  join public.contests c on c.id=cw.contest_id and c.status='CLOSED' and c.deletion_locked_at is null
  join public.contest_categories cc on cc.id=cw.category_id and cc.contest_id=c.id
  join public.contest_category_definitions cd on cd.id=cc.category_definition_id
  join public.contest_finalists cf on cf.id=cw.finalist_id and cf.contest_id=cw.contest_id and cf.category_id=cw.category_id and cf.submission_id=cw.submission_id and cf.published_at is not null and cf.published_by_auth_user_id is not null
  join public.contest_result_snapshots crs on crs.id=cf.snapshot_id and crs.contest_id=c.id and crs.category_id=cc.id and crs.status='PUBLISHED' and crs.invalidated_at is null
  join public.submissions s on s.id=cw.submission_id and s.category_id=cc.id
  join public.submission_publications sp on sp.submission_id=s.id and sp.revoked_at is null
  join public.submission_media sm on sm.id=sp.media_id and sm.submission_id=s.id and sm.status='FINALIZED' and sm.is_current and sm.storage_deleted_at is null
  left join storage.objects thumb_webp on thumb_webp.bucket_id='contest-thumbnails' and thumb_webp.name='submission-thumbnails/'||s.id::text||'/'||sm.id::text||'.webp'
  left join storage.objects thumb_jpg on thumb_jpg.bucket_id='contest-thumbnails' and thumb_jpg.name='submission-thumbnails/'||s.id::text||'/'||sm.id::text||'.jpg'
  order by cw.selected_at desc, cw.contest_id asc, cw.category_id asc;
$function$;

revoke execute on function public.get_public_hall_of_fame() from public, anon, service_role;
grant execute on function public.get_public_hall_of_fame() to anon, authenticated;
