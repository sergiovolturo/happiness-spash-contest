-- Global category library and Contest/category associations.
-- Existing contest_categories rows remain the historical association records.

create table if not exists public.contest_category_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  image_path text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contest_categories add column if not exists category_definition_id uuid;

insert into public.contest_category_definitions(name, slug)
select min(btrim(cc.name)), lower(regexp_replace(regexp_replace(btrim(cc.slug), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
from public.contest_categories cc
group by lower(regexp_replace(regexp_replace(btrim(cc.slug), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
on conflict (slug) do update set name=excluded.name, updated_at=now();

update public.contest_categories cc
set category_definition_id=d.id, name=d.name, slug=d.slug, updated_at=now()
from public.contest_category_definitions d
where d.slug=lower(regexp_replace(regexp_replace(btrim(cc.slug), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
  and cc.category_definition_id is null;

alter table public.contest_categories alter column category_definition_id set not null;

do $$ begin
  alter table public.contest_categories add constraint contest_categories_definition_fk
    foreign key (category_definition_id) references public.contest_category_definitions(id) on delete restrict;
exception when duplicate_object then null; end $$;

create unique index if not exists contest_categories_contest_definition_uidx
  on public.contest_categories(contest_id, category_definition_id);
create index if not exists contest_categories_definition_idx
  on public.contest_categories(category_definition_id);

alter table public.contest_category_definitions enable row level security;
revoke all on public.contest_category_definitions from public, anon, authenticated;
grant select on public.contest_category_definitions to authenticated;
drop policy if exists contest_category_definitions_admin_read on public.contest_category_definitions;
create policy contest_category_definitions_admin_read on public.contest_category_definitions
  for select to authenticated using (exists(select 1 from public.admin_users au where au.user_id=auth.uid()));

create or replace function public.category_definition_slug(p_name text)
returns text language sql immutable set search_path=''
as $$
  select left(coalesce(nullif(regexp_replace(lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g')), '(^-|-$)', '', 'g'), ''), 'category'), 80)
$$;

create or replace function public.admin_list_category_definitions()
returns table(id uuid,name text,slug text,image_path text,is_active boolean,archived_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=''
as $$ begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  return query select d.id,d.name,d.slug,d.image_path,d.is_active,d.archived_at,d.created_at,d.updated_at
    from public.contest_category_definitions d order by d.is_active desc,d.name,d.id;
end $$;

create or replace function public.admin_create_category_definition(p_name text,p_image_path text default null)
returns public.contest_category_definitions language plpgsql security definer set search_path=''
as $$ declare d public.contest_category_definitions; s text; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'category_name_required'; end if;
  s:=public.category_definition_slug(p_name);
  if exists(select 1 from public.contest_category_definitions where slug=s) then raise exception 'category_slug_exists'; end if;
  insert into public.contest_category_definitions(name,slug,image_path) values(btrim(p_name),s,nullif(btrim(p_image_path),'')) returning * into d;
  return d;
end $$;

create or replace function public.admin_update_category_definition(p_definition_id uuid,p_name text,p_image_path text default null)
returns public.contest_category_definitions language plpgsql security definer set search_path=''
as $$ declare d public.contest_category_definitions; s text; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'category_name_required'; end if;
  s:=public.category_definition_slug(p_name);
  if exists(select 1 from public.contest_category_definitions where slug=s and id<>p_definition_id) then raise exception 'category_slug_exists'; end if;
  update public.contest_category_definitions set name=btrim(p_name),slug=s,image_path=nullif(btrim(p_image_path),''),updated_at=now() where id=p_definition_id returning * into d;
  if d.id is null then raise exception 'category_definition_not_found'; end if;
  update public.contest_categories set name=d.name,slug=d.slug,updated_at=now() where category_definition_id=d.id;
  return d;
end $$;

create or replace function public.admin_set_category_definition_active(p_definition_id uuid,p_is_active boolean)
returns public.contest_category_definitions language plpgsql security definer set search_path=''
as $$ declare d public.contest_category_definitions; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  update public.contest_category_definitions set is_active=p_is_active,archived_at=case when p_is_active then null else coalesce(archived_at,now()) end,updated_at=now() where id=p_definition_id returning * into d;
  if d.id is null then raise exception 'category_definition_not_found'; end if; return d;
end $$;

create or replace function public.admin_delete_unused_category_definition(p_definition_id uuid)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  if exists(select 1 from public.contest_categories where category_definition_id=p_definition_id) then raise exception 'category_definition_in_use'; end if;
  delete from public.contest_category_definitions where id=p_definition_id;
end $$;

create or replace function public.admin_attach_category_to_contest(p_contest_id uuid,p_definition_id uuid,p_submission_cap integer,p_finalists_count integer,p_display_order integer default null)
returns public.contest_categories language plpgsql security definer set search_path=''
as $$ declare d public.contest_category_definitions; c public.contest_categories; next_order integer; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  if not exists(select 1 from public.contests where id=p_contest_id and status='DRAFT' and archived_at is null) then raise exception 'contest_not_draft'; end if;
  select * into d from public.contest_category_definitions where id=p_definition_id and is_active;
  if d.id is null then raise exception 'category_definition_inactive'; end if;
  if exists(select 1 from public.contest_categories where contest_id=p_contest_id and category_definition_id=p_definition_id) then raise exception 'category_already_attached'; end if;
  select coalesce(max(display_order)+1,1) into next_order from public.contest_categories where contest_id=p_contest_id;
  insert into public.contest_categories(contest_id,category_definition_id,name,slug,display_order,submission_cap,finalists_count,is_active)
    values(p_contest_id,d.id,d.name,d.slug,coalesce(p_display_order,next_order),p_submission_cap,p_finalists_count,true) returning * into c;
  return c;
end $$;

create or replace function public.admin_update_contest_category_settings(p_category_id uuid,p_submission_cap integer,p_finalists_count integer,p_display_order integer)
returns public.contest_categories language plpgsql security definer set search_path=''
as $$ declare c public.contest_categories; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  update public.contest_categories cc set submission_cap=p_submission_cap,finalists_count=p_finalists_count,display_order=p_display_order,updated_at=now()
    where cc.id=p_category_id and exists(select 1 from public.contests c where c.id=cc.contest_id and c.status='DRAFT') returning cc.* into c;
  if c.id is null then raise exception 'category_settings_not_editable'; end if; return c;
end $$;

create or replace function public.admin_detach_category_from_contest(p_category_id uuid)
returns void language plpgsql security definer set search_path=''
as $$ declare contest_status text; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  select c.status into contest_status from public.contest_categories cc join public.contests c on c.id=cc.contest_id where cc.id=p_category_id;
  if contest_status is distinct from 'DRAFT' then raise exception 'category_detach_not_allowed'; end if;
  if exists(select 1 from public.submissions s where s.category_id=p_category_id) or exists(select 1 from public.contest_votes v where v.category_id=p_category_id) then raise exception 'category_has_history'; end if;
  delete from public.contest_categories where id=p_category_id;
end $$;

create or replace function public.admin_create_contest_category(p_contest_id uuid,p_name text,p_slug text,p_submission_cap integer,p_finalists_count integer default 4)
returns public.contest_categories language plpgsql security definer set search_path=''
as $$ declare d public.contest_category_definitions; c public.contest_categories; s text; next_order integer; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  if not exists(select 1 from public.contests where id=p_contest_id and status in ('DRAFT','SUBMISSIONS_OPEN')) then raise exception 'category_configuration_closed'; end if;
  s:=public.category_definition_slug(coalesce(nullif(btrim(p_name),''),p_slug));
  select * into d from public.contest_category_definitions where slug=s;
  if d.id is null then insert into public.contest_category_definitions(name,slug) values(btrim(p_name),s) returning * into d; end if;
  if exists(select 1 from public.contest_categories where contest_id=p_contest_id and category_definition_id=d.id) then raise exception 'category_already_attached'; end if;
  select coalesce(max(display_order)+1,1) into next_order from public.contest_categories where contest_id=p_contest_id;
  insert into public.contest_categories(contest_id,category_definition_id,name,slug,display_order,submission_cap,finalists_count,is_active)
    values(p_contest_id,d.id,d.name,d.slug,next_order,p_submission_cap,p_finalists_count,true) returning * into c; return c;
end $$;

create or replace function public.admin_update_contest_category(p_category_id uuid,p_name text,p_slug text,p_submission_cap integer,p_finalists_count integer,p_is_active boolean)
returns public.contest_categories language plpgsql security definer set search_path=''
as $$ declare c public.contest_categories; d public.contest_category_definitions; s text; begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  select * into c from public.contest_categories where id=p_category_id;
  if c.id is null then raise exception 'category_not_found'; end if;
  if not exists(select 1 from public.contests where id=c.contest_id and status in ('DRAFT','SUBMISSIONS_OPEN')) then raise exception 'category_configuration_closed'; end if;
  s:=public.category_definition_slug(coalesce(nullif(btrim(p_name),''),p_slug));
  select * into d from public.contest_category_definitions where id=c.category_definition_id for update;
  if d.id is null then raise exception 'category_definition_not_found'; end if;
  update public.contest_category_definitions set name=btrim(p_name),slug=s,is_active=p_is_active,archived_at=case when p_is_active then null else coalesce(archived_at,now()) end,updated_at=now() where id=d.id returning * into d;
  update public.contest_categories set name=d.name,slug=d.slug,submission_cap=p_submission_cap,finalists_count=p_finalists_count,is_active=p_is_active,updated_at=now() where id=p_category_id returning * into c;
  return c;
end $$;

drop function if exists public.admin_list_contest_categories(uuid);
create function public.admin_list_contest_categories(p_contest_id uuid)
returns table(id uuid,contest_id uuid,name text,slug text,display_order integer,submission_cap integer,finalists_count integer,is_active boolean,created_at timestamptz,updated_at timestamptz,category_definition_id uuid,image_path text)
language plpgsql security definer set search_path=''
as $$ begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'not_admin'; end if;
  return query select cc.id,cc.contest_id,d.name,d.slug,cc.display_order,cc.submission_cap,cc.finalists_count,cc.is_active,cc.created_at,cc.updated_at,d.id,d.image_path
    from public.contest_categories cc join public.contest_category_definitions d on d.id=cc.category_definition_id
    where cc.contest_id=p_contest_id order by cc.display_order,cc.id;
end $$;

drop function if exists public.get_public_contest_categories(uuid);
create function public.get_public_contest_categories(p_contest_id uuid)
returns table(id uuid,contest_id uuid,name text,slug text,display_order integer,submission_cap integer,category_definition_id uuid,image_path text,published_video_count bigint)
language sql security definer set search_path=''
as $$
  select cc.id,cc.contest_id,d.name,d.slug,cc.display_order,cc.submission_cap,d.id,d.image_path,
    (select count(*) from public.published_submission_media pm where pm.contest_id=cc.contest_id and pm.category_id=cc.id) as published_video_count
  from public.contest_categories cc join public.contest_category_definitions d on d.id=cc.category_definition_id
  join public.contests c on c.id=cc.contest_id
  where cc.contest_id=p_contest_id and cc.is_active and c.archived_at is null and c.status<>'DRAFT'
  order by cc.display_order,cc.id
$$;

create or replace function public.get_public_contest_results(p_contest_id uuid)
returns table(submission_id uuid,category_id uuid,category_name text,contestant_display_name text,vote_count bigint,rank_position integer,is_finalist boolean)
language sql security definer set search_path=''
as $$
  with latest as (
    select distinct on (rs.category_id) rs.id,rs.category_id
    from public.contest_result_snapshots rs
    where rs.contest_id=p_contest_id and rs.status='PUBLISHED' and rs.invalidated_at is null
    order by rs.category_id,rs.published_at desc nulls last,rs.id desc
  )
  select e.submission_id,s.category_id,d.name,s.contestant_display_name,e.vote_count,e.rank_position,
    exists(select 1 from public.contest_finalists f where f.snapshot_id=e.snapshot_id and f.submission_id=e.submission_id) as is_finalist
  from latest l join public.contest_result_entries e on e.snapshot_id=l.id
  join public.submissions s on s.id=e.submission_id
  join public.contest_categories cc on cc.id=s.category_id
  join public.contest_category_definitions d on d.id=cc.category_definition_id
  order by s.category_id,e.rank_position,e.submission_id
$$;

revoke execute on function public.admin_list_category_definitions() from public,anon,service_role;
revoke execute on function public.admin_create_category_definition(text,text) from public,anon,service_role;
revoke execute on function public.admin_update_category_definition(uuid,text,text) from public,anon,service_role;
revoke execute on function public.admin_set_category_definition_active(uuid,boolean) from public,anon,service_role;
revoke execute on function public.admin_delete_unused_category_definition(uuid) from public,anon,service_role;
revoke execute on function public.admin_attach_category_to_contest(uuid,uuid,integer,integer,integer) from public,anon,service_role;
revoke execute on function public.admin_update_contest_category_settings(uuid,integer,integer,integer) from public,anon,service_role;
revoke execute on function public.admin_detach_category_from_contest(uuid) from public,anon,service_role;
grant execute on function public.admin_list_category_definitions() to authenticated;
grant execute on function public.admin_create_category_definition(text,text) to authenticated;
grant execute on function public.admin_update_category_definition(uuid,text,text) to authenticated;
grant execute on function public.admin_set_category_definition_active(uuid,boolean) to authenticated;
grant execute on function public.admin_delete_unused_category_definition(uuid) to authenticated;
grant execute on function public.admin_attach_category_to_contest(uuid,uuid,integer,integer,integer) to authenticated;
grant execute on function public.admin_update_contest_category_settings(uuid,integer,integer,integer) to authenticated;
grant execute on function public.admin_detach_category_from_contest(uuid) to authenticated;
revoke execute on function public.category_definition_slug(text) from public,anon,authenticated,service_role;
revoke execute on function public.admin_list_contest_categories(uuid) from public,anon,service_role;
grant execute on function public.admin_list_contest_categories(uuid) to authenticated;
revoke execute on function public.get_public_contest_categories(uuid) from public,anon,service_role;
grant execute on function public.get_public_contest_categories(uuid) to anon,authenticated;
revoke execute on function public.get_public_contest_results(uuid) from public,anon,service_role;
grant execute on function public.get_public_contest_results(uuid) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('category-images','category-images',true,3145728,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do nothing;

drop policy if exists category_images_admin_insert on storage.objects;
create policy category_images_admin_insert on storage.objects for insert to authenticated
with check (bucket_id='category-images' and name like 'category-definitions/%' and exists(select 1 from public.admin_users where user_id=auth.uid()));
drop policy if exists category_images_admin_update on storage.objects;
create policy category_images_admin_update on storage.objects for update to authenticated
using (bucket_id='category-images' and name like 'category-definitions/%' and exists(select 1 from public.admin_users where user_id=auth.uid()))
with check (bucket_id='category-images' and name like 'category-definitions/%' and exists(select 1 from public.admin_users where user_id=auth.uid()));
drop policy if exists category_images_admin_delete on storage.objects;
create policy category_images_admin_delete on storage.objects for delete to authenticated
using (bucket_id='category-images' and name like 'category-definitions/%' and exists(select 1 from public.admin_users where user_id=auth.uid()));

