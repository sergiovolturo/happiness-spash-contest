-- The storage.objects policy is evaluated for authenticated requests. Keep
-- the internal Storage grant and also permit the policy role to execute the
-- helper; the helper itself remains Admin- and exact-path-scoped.

grant execute on function public._admin_submission_storage_delete_allowed(text,text)
  to authenticated;
grant execute on function public._admin_submission_storage_delete_allowed(text,text)
  to supabase_storage_admin;
