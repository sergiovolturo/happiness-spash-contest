-- Add the public Contest/category context required by the gallery.
-- The joins are server-side; private relations remain inaccessible to clients.
drop view public.published_submission_media;

create view public.published_submission_media as
select
  sp.id as publication_id,
  sp.submission_id,
  sp.media_id,
  cc.contest_id,
  s.category_id,
  sp.published_at,
  sm.storage_bucket,
  sm.storage_path
from public.submission_publications sp
join public.submission_media sm
  on sm.id = sp.media_id
join public.submissions s
  on s.id = sp.submission_id
join public.contest_categories cc
  on cc.id = s.category_id
join public.contest_participations cp
  on cp.id = s.participation_id
 and cp.contest_id = cc.contest_id
where sp.revoked_at is null
  and sm.status = 'FINALIZED'
  and sm.is_current;

revoke all on public.published_submission_media from public, anon, authenticated, service_role;
grant select on public.published_submission_media to anon, authenticated;
