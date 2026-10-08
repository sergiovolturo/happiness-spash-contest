-- Tranche 4: retain only the definitive winner media when a Contest is archived.
-- Historical rows remain untouched; Storage objects and media lifecycle flags are
-- changed only after the two-phase delete has completed.

create or replace function public._archive_contest_winner_media(p_contest_id uuid)
returns table (
  winner_id uuid,
  category_id uuid,
  submission_id uuid,
  media_id uuid,
  storage_bucket text,
  storage_path text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct cw.id, cw.category_id, cw.submission_id,
    sm.id, sm.storage_bucket, sm.storage_path
  from public.contest_winners cw
  join public.contest_categories cc on cc.id = cw.category_id and cc.contest_id = cw.contest_id
  join public.contest_finalists cf
    on cf.id = cw.finalist_id
   and cf.contest_id = cw.contest_id
   and cf.category_id = cw.category_id
   and cf.submission_id = cw.submission_id
   and cf.published_at is not null
   and cf.published_by_auth_user_id is not null
  join public.contest_result_snapshots crs
    on crs.id = cf.snapshot_id
   and crs.contest_id = cw.contest_id
   and crs.category_id = cw.category_id
   and crs.status = 'PUBLISHED'
   and crs.invalidated_at is null
  join public.submissions s on s.id = cw.submission_id and s.category_id = cw.category_id
  join public.submission_publications sp on sp.submission_id = s.id and sp.revoked_at is null
  join public.submission_media sm
    on sm.id = sp.media_id
   and sm.submission_id = s.id
   and sm.status = 'FINALIZED'
   and sm.is_current
   and sm.storage_deleted_at is null
  where cw.contest_id = p_contest_id
    and exists (
      select 1 from storage.objects so
       where so.bucket_id = sm.storage_bucket
         and so.name = sm.storage_path
    );
$function$;

create or replace function public.admin_prepare_contest_archive(p_contest_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_existing public.contest_archive_requests%rowtype;
  v_request uuid;
  v_plan jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
  if v_contest.archived_at is not null then
    return jsonb_build_object('status', 'COMPLETED', 'contest_id', p_contest_id);
  end if;
  if v_contest.deletion_locked_at is not null then
    select * into v_existing from public.contest_archive_requests
     where contest_id = p_contest_id and status = 'PENDING'
     order by created_at desc limit 1 for update;
    if not found then raise exception using errcode = 'P0001', message = 'archive_in_progress'; end if;
    return v_existing.plan || jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status);
  end if;
  if v_contest.status <> 'CLOSED' then
    raise exception using errcode = 'P0001', message = 'contest_not_archivable';
  end if;
  if exists (
    select 1 from public.contest_categories cc
     where cc.contest_id = p_contest_id
       and not exists (select 1 from public._current_contest_result_snapshots(p_contest_id) rs
                        where rs.category_id = cc.id and rs.status = 'PUBLISHED' and rs.invalidated_at is null)
  ) then raise exception using errcode = 'P0001', message = 'results_not_published'; end if;
  if exists (
    select 1 from public.contest_categories cc
     where cc.contest_id = p_contest_id and cc.is_active and cc.winner_required
       and not exists (select 1 from public.contest_winners cw
                        where cw.contest_id = p_contest_id and cw.category_id = cc.id)
  ) then raise exception using errcode = 'P0001', message = 'winner_required_missing'; end if;
  if exists (
    select 1 from public.contest_winners cw
     where cw.contest_id = p_contest_id
       and not exists (select 1 from public._archive_contest_winner_media(p_contest_id) wm where wm.winner_id = cw.id)
  ) then raise exception using errcode = 'P0001', message = 'winner_not_valid_published_finalist_media'; end if;

  v_plan := jsonb_build_object(
    'contest_id', p_contest_id,
    'contest_name', v_contest.name,
    'media_count', (select count(*) from public.submission_media sm join public.submissions s on s.id=sm.submission_id
                    join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id),
    'retained_media_ids', coalesce((select jsonb_agg(wm.media_id order by wm.media_id) from public._archive_contest_winner_media(p_contest_id) wm), '[]'::jsonb),
    'deleted_media_ids', coalesce((select jsonb_agg(sm.id order by sm.id)
      from public.submission_media sm join public.submissions s on s.id=sm.submission_id
      join public.contest_categories cc on cc.id=s.category_id
      where cc.contest_id=p_contest_id
        and not exists (select 1 from public._archive_contest_winner_media(p_contest_id) wm where wm.media_id=sm.id)), '[]'::jsonb),
    'retained_objects', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket, 'path', o.path) order by o.bucket,o.path)
      from (select distinct wm.storage_bucket bucket, wm.storage_path path from public._archive_contest_winner_media(p_contest_id) wm
            union select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
              from public._archive_contest_winner_media(p_contest_id) wm join storage.objects so on so.bucket_id='contest-thumbnails' and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
            union select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
              from public._archive_contest_winner_media(p_contest_id) wm join storage.objects so on so.bucket_id='contest-thumbnails' and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg') o), '[]'::jsonb),
    'objects', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket, 'path', o.path) order by o.bucket,o.path)
      from (
        select distinct sm.storage_bucket bucket, sm.storage_path path from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id
        union select distinct 'contest-thumbnails', 'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.webp' from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id
        union select distinct 'contest-thumbnails', 'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.jpg' from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id
        union select distinct 'contest-videos', 'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.webp' from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id
        union select distinct 'contest-videos', 'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.jpg' from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id
        except select distinct wm.storage_bucket, wm.storage_path from public._archive_contest_winner_media(p_contest_id) wm
        except select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp' from public._archive_contest_winner_media(p_contest_id) wm join storage.objects so on so.bucket_id='contest-thumbnails' and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
        except select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg' from public._archive_contest_winner_media(p_contest_id) wm join storage.objects so on so.bucket_id='contest-thumbnails' and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
      ) o), '[]'::jsonb)
  );
  insert into public.contest_archive_requests(contest_id, requested_by, plan) values (p_contest_id, auth.uid(), v_plan) returning id into v_request;
  update public.contests set deletion_locked_at=now(), updated_at=now() where id=p_contest_id;
  return v_plan || jsonb_build_object('request_id', v_request, 'status', 'PENDING');
end;
$function$;

create or replace function public.admin_finalize_contest_archive(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_request public.contest_archive_requests%rowtype; v_contest public.contests%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select * into v_request from public.contest_archive_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0001',message='archive_request_not_found'; end if;
  if v_request.status='COMPLETED' then return jsonb_build_object('status','COMPLETED','contest_id',v_request.contest_id); end if;
  select * into v_contest from public.contests where id=v_request.contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if exists (select 1 from jsonb_array_elements(v_request.plan->'objects') object_row join storage.objects so on so.bucket_id=object_row->>'bucket' and so.name=object_row->>'path') then
    raise exception using errcode='P0001',message='storage_delete_required';
  end if;
  update public.submission_media sm set storage_deleted_at=coalesce(sm.storage_deleted_at,now()), storage_deleted_by=coalesce(sm.storage_deleted_by,auth.uid()), is_current=false
   where sm.id in (select value::text::uuid from jsonb_array_elements_text(coalesce(v_request.plan->'deleted_media_ids','[]'::jsonb)) value)
     and exists (select 1 from public.submissions s join public.contest_categories cc on cc.id=s.category_id where s.id=sm.submission_id and cc.contest_id=v_request.contest_id);
  update public.contests set archived_at=coalesce(archived_at,now()), deletion_locked_at=null, updated_at=now() where id=v_request.contest_id;
  update public.contest_archive_requests set status='COMPLETED',completed_at=now() where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','contest_id',v_request.contest_id);
end;
$function$;

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
  order by c.created_at desc,cc.display_order asc,cc.id asc;
$function$;

create or replace function public._storage_object_is_archived_winner(p_bucket_id text,p_object_name text)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists (select 1 from public.contest_winners cw join public.contests c on c.id=cw.contest_id and c.archived_at is not null and c.deletion_locked_at is null
    join public.contest_finalists cf on cf.id=cw.finalist_id and cf.contest_id=cw.contest_id and cf.category_id=cw.category_id and cf.submission_id=cw.submission_id and cf.published_at is not null
    join public.contest_result_snapshots crs on crs.id=cf.snapshot_id and crs.status='PUBLISHED' and crs.invalidated_at is null
    join public.submission_publications sp on sp.submission_id=cw.submission_id and sp.revoked_at is null
    join public.submission_media sm on sm.id=sp.media_id and sm.submission_id=cw.submission_id and sm.status='FINALIZED' and sm.is_current and sm.storage_deleted_at is null
    where (sm.storage_bucket=p_bucket_id and sm.storage_path=p_object_name)
      or (p_bucket_id='contest-thumbnails' and p_object_name in (
        'submission-thumbnails/'||cw.submission_id::text||'/'||sm.id::text||'.webp',
        'submission-thumbnails/'||cw.submission_id::text||'/'||sm.id::text||'.jpg'
      )));
$function$;

create or replace function public.storage_object_is_published(p_bucket_id text,p_object_name text)
returns boolean language sql security definer set search_path=''
as $function$
  select exists (select 1 from public.submission_publications sp join public.submission_media sm on sm.id=sp.media_id
    join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id join public.contests c on c.id=cc.contest_id
   where sp.revoked_at is null and sm.status='FINALIZED' and sm.is_current and sm.storage_deleted_at is null and sm.storage_bucket=p_bucket_id and sm.storage_path=p_object_name
     and ((c.archived_at is null and c.deletion_locked_at is null) or public._storage_object_is_archived_winner(p_bucket_id,p_object_name)));
$function$;

drop policy if exists published_contest_thumbnail_bucket_objects_select on storage.objects;
create policy published_contest_thumbnail_bucket_objects_select on storage.objects for select to anon,authenticated using (
  bucket_id='contest-thumbnails' and (name like 'submission-thumbnails/%.webp' or name like 'submission-thumbnails/%.jpg')
  and (exists (select 1 from public.published_submission_media pm where pm.media_id::text=split_part(split_part(name,'/',3),'.',1)
    and name in ('submission-thumbnails/'||pm.submission_id::text||'/'||pm.media_id::text||'.webp','submission-thumbnails/'||pm.submission_id::text||'/'||pm.media_id::text||'.jpg'))
    or public._storage_object_is_archived_winner('contest-thumbnails',name)));

revoke all on function public._archive_contest_winner_media(uuid), public._storage_object_is_archived_winner(text,text) from public,anon,authenticated,service_role;
grant execute on function public.storage_object_is_published(text,text) to anon,authenticated;
revoke execute on function public.admin_prepare_contest_archive(uuid), public.admin_finalize_contest_archive(uuid), public.get_public_hall_of_fame() from public,anon,service_role;
grant execute on function public.admin_prepare_contest_archive(uuid), public.admin_finalize_contest_archive(uuid) to authenticated;
grant execute on function public.get_public_hall_of_fame() to anon,authenticated;
