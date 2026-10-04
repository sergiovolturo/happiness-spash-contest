-- Remove only the legacy thumbnail policies created on contest-videos.
-- The video bucket and all pre-existing video policies remain untouched.

drop policy if exists submission_thumbnail_objects_insert on storage.objects;
drop policy if exists published_submission_thumbnail_objects_select on storage.objects;
