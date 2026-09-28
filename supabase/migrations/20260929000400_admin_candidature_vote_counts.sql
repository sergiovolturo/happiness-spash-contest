-- Admin-only read model for candidature cards. It keeps uploader metadata and
-- vote aggregates server-side without exposing either to the public surface.
create or replace function public.admin_list_contest_submission_cards(p_contest_id uuid)
returns table(
  submission_id uuid,
  contestant_display_name text,
  category_id uuid,
  category_name text,
  submission_status public.submission_status,
  rejection_reason text,
  submitted_at timestamptz,
  uploader_name text,
  uploader_email text,
  media_id uuid,
  media_status text,
  media_bucket text,
  media_path text,
  publication_status text,
  vote_count bigint
)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  return query
  select s.id,s.contestant_display_name,cc.id,cc.name,s.status,s.rejection_reason,s.created_at,
    nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name','')), ''),
    nullif(lower(btrim(u.email)), ''),
    media.id,media.status,media.storage_bucket,media.storage_path,
    case when publication.id is not null then 'PUBBLICATO' when media.id is not null then 'NON PUBBLICATO' else 'NESSUN VIDEO' end,
    (select count(*) from public.contest_votes cv where cv.submission_id=s.id and cv.category_id=s.category_id)
  from public.submissions s
  join public.contest_categories cc on cc.id=s.category_id and cc.contest_id=p_contest_id
  left join auth.users u on u.id=s.created_by_auth_user_id
  left join lateral(
    select sm.id,sm.status,sm.storage_bucket,sm.storage_path
    from public.submission_media sm
    where sm.submission_id=s.id and sm.status='FINALIZED' and sm.is_current
    order by sm.created_at desc limit 1
  ) media on true
  left join lateral(
    select sp.id
    from public.submission_publications sp
    where sp.submission_id=s.id and sp.media_id=media.id and sp.revoked_at is null
    order by sp.published_at desc limit 1
  ) publication on true
  order by cc.display_order, s.created_at;
end;
$function$;

revoke execute on function public.admin_list_contest_submission_cards(uuid) from public,anon,service_role;
grant execute on function public.admin_list_contest_submission_cards(uuid) to authenticated;
