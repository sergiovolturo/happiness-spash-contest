-- Public media resolution for the Step 4 gallery.
-- Only active, current, finalized publications are exposed.
create or replace view public.published_submission_media as
select
  sp.id as publication_id,
  sp.submission_id,
  sp.media_id,
  sp.published_at,
  sm.storage_bucket,
  sm.storage_path
from public.submission_publications sp
join public.submission_media sm on sm.id = sp.media_id
where sp.revoked_at is null
  and sm.status = 'FINALIZED'
  and sm.is_current;

revoke all on public.published_submission_media from public, anon, authenticated, service_role;
grant select on public.published_submission_media to anon, authenticated;
