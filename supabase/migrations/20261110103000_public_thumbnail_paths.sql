-- Expose only the resolved thumbnail coordinate on the already-public media
-- surface. This removes speculative .webp/.jpg probing without exposing
-- Storage objects or administrative metadata.
drop view public.published_submission_media;

create view public.published_submission_media as
select
  sp.id as publication_id,
  sp.submission_id,
  sp.media_id,
  cc.contest_id,
  s.category_id,
  s.contestant_display_name,
  cc.name as category_name,
  sp.published_at,
  sm.storage_bucket,
  sm.storage_path,
  case when tw.name is not null or tj.name is not null then 'contest-thumbnails' end as thumbnail_bucket,
  coalesce(tw.name, tj.name) as thumbnail_path
from public.submission_publications sp
join public.submission_media sm on sm.id = sp.media_id
join public.submissions s on s.id = sp.submission_id
join public.contest_categories cc on cc.id = s.category_id
join public.contest_participations cp on cp.id = s.participation_id and cp.contest_id = cc.contest_id
join public.contests c on c.id = cc.contest_id
left join storage.objects tw
  on tw.bucket_id = 'contest-thumbnails'
 and tw.name = 'submission-thumbnails/' || sp.submission_id::text || '/' || sp.media_id::text || '.webp'
left join storage.objects tj
  on tw.id is null
 and tj.bucket_id = 'contest-thumbnails'
 and tj.name = 'submission-thumbnails/' || sp.submission_id::text || '/' || sp.media_id::text || '.jpg'
where sp.revoked_at is null
  and sm.status = 'FINALIZED'
  and sm.is_current
  and c.archived_at is null
  and c.deletion_locked_at is null;

revoke all on public.published_submission_media from public, anon, authenticated, service_role;
grant select on public.published_submission_media to anon, authenticated;
