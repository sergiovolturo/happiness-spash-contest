-- Keep the administrative Contest listing behind an authenticated Admin session.
revoke execute on function public.admin_list_contests() from public, anon, service_role;
grant execute on function public.admin_list_contests() to authenticated;
