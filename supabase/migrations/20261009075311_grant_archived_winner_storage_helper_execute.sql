-- Storage SELECT policies evaluate this helper for both public roles.  The
-- helper remains SECURITY DEFINER; only policy evaluation roles receive EXECUTE.
revoke all on function public._storage_object_is_archived_winner(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public._storage_object_is_archived_winner(text, text)
  to anon, authenticated;
