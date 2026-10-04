-- Optional, non-blocking public video thumbnails.
-- The video media lifecycle remains authoritative; thumbnails are derived
-- artifacts stored by deterministic media-id paths and may be absent.

create policy submission_thumbnail_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id='contest-videos'
    and (name like 'submission-thumbnails/%.webp' or name like 'submission-thumbnails/%.jpg')
    and exists (
      select 1
      from public.submission_media sm
      join public.submissions s on s.id=sm.submission_id
      join public.contest_participations cp on cp.id=s.participation_id
      join public.platform_identities pi on pi.id=cp.identity_id
      where name in (
        'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.webp',
        'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.jpg'
      )
      and sm.status='FINALIZED'
      and sm.is_current
      and (pi.auth_user_id=auth.uid() or exists(select 1 from public.admin_users au where au.user_id=auth.uid()))
    )
  );

create policy published_submission_thumbnail_objects_select
  on storage.objects for select to anon,authenticated
  using (
    bucket_id='contest-videos'
    and (name like 'submission-thumbnails/%.webp' or name like 'submission-thumbnails/%.jpg')
    and exists (
      select 1
      from public.published_submission_media pm
      where pm.media_id::text = split_part(split_part(name,'/',3),'.',1)
        and name in (
          'submission-thumbnails/'||pm.submission_id::text||'/'||pm.media_id::text||'.webp',
          'submission-thumbnails/'||pm.submission_id::text||'/'||pm.media_id::text||'.jpg'
        )
    )
  );
