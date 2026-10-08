-- Storage remove requires SELECT visibility as well as DELETE visibility.
-- Keep this grant limited to Admins and objects in the current PENDING archive plan.
drop policy if exists admin_contest_archive_thumbnail_objects_select on storage.objects;
create policy admin_contest_archive_thumbnail_objects_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contest-thumbnails'
    and public._admin_archive_storage_delete_allowed(bucket_id, name)
  );
