-- Happiness SPASH Contest legacy schema baseline.
--
-- This file is a reconstruction baseline for a new Supabase project. It is
-- not intended to be executed against the existing Production schema, where
-- these legacy objects already exist. Before applying it to an existing
-- project, record this version as already applied through the approved
-- migration-history procedure.
--
-- The baseline intentionally contains no application rows, user data,
-- secrets, managed Storage infrastructure, or Edge Functions.

create schema if not exists private;

create table public.admin_users (
  user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint admin_users_pkey primary key (user_id),
  constraint admin_users_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.contest_settings (
  singleton boolean not null default true,
  submissions_open boolean not null default true,
  voting_open boolean not null default false,
  results_visible boolean not null default false,
  max_video_bytes bigint not null default 10485760,
  max_video_seconds smallint not null default 10,
  updated_at timestamptz not null default now(),
  constraint contest_settings_pkey primary key (singleton),
  constraint contest_settings_singleton_check check (singleton = true)
);

insert into public.contest_settings (
  singleton,
  submissions_open,
  voting_open,
  results_visible,
  max_video_bytes,
  max_video_seconds
)
values (true, true, false, false, 10485760, 10)
on conflict (singleton) do nothing;

create table public.profiles (
  id uuid not null,
  full_name text not null,
  instagram_handle text,
  created_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey
    foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_full_name_check
    check (char_length(full_name) >= 2 and char_length(full_name) <= 80)
);

create table public.videos (
  id bigint generated always as identity,
  user_id uuid not null,
  slot smallint not null,
  participant_name text not null,
  instagram_handle text,
  video_path text not null,
  original_filename text not null,
  file_size_bytes bigint not null,
  duration_seconds numeric(5,2) not null,
  status text not null default 'pending',
  rejection_reason text,
  consent_publication boolean not null,
  consent_other_people boolean not null,
  consent_rules boolean not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint videos_pkey primary key (id),
  constraint videos_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint videos_user_id_slot_key unique (user_id, slot),
  constraint videos_video_path_key unique (video_path),
  constraint videos_slot_check check (slot in (1, 2)),
  constraint videos_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint videos_duration_seconds_check
    check (duration_seconds > 0 and duration_seconds <= 10),
  constraint videos_file_size_bytes_check
    check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  constraint videos_participant_name_check
    check (char_length(participant_name) >= 2 and char_length(participant_name) <= 80),
  constraint videos_consent_publication_check check (consent_publication = true),
  constraint videos_consent_other_people_check check (consent_other_people = true),
  constraint videos_consent_rules_check check (consent_rules = true)
);

create index idx_videos_status_created_at
  on public.videos (status, created_at);

create index idx_videos_user_id
  on public.videos (user_id);

create table public.votes (
  voter_id uuid not null,
  video_id bigint not null,
  created_at timestamptz not null default now(),
  constraint votes_pkey primary key (voter_id),
  constraint votes_voter_id_fkey
    foreign key (voter_id) references auth.users(id) on delete cascade,
  constraint votes_video_id_fkey
    foreign key (video_id) references public.videos(id) on delete cascade
);

create index idx_votes_video_id
  on public.votes (video_id);

alter table public.admin_users enable row level security;
alter table public.contest_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.votes enable row level security;

create policy admins_select_own
  on public.admin_users for select
  to authenticated
  using (auth.uid() = user_id);

create policy settings_admin_update
  on public.contest_settings for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy settings_read_authenticated
  on public.contest_settings for select
  to authenticated
  using (true);

create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy videos_admin_update
  on public.videos for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy videos_delete_own_pending_or_admin
  on public.videos for delete
  to authenticated
  using (
    (user_id = auth.uid() and status = 'pending')
    or exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy videos_insert_own_pending
  on public.videos for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from public.contest_settings cs
      where cs.singleton = true
        and cs.submissions_open = true
    )
  );

create policy videos_select_owner_approved_or_admin
  on public.videos for select
  to authenticated
  using (
    user_id = auth.uid()
    or status = 'approved'
    or exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy votes_insert_once_when_open
  on public.votes for insert
  to authenticated
  with check (
    voter_id = auth.uid()
    and exists (
      select 1
      from public.contest_settings cs
      where cs.singleton = true
        and cs.voting_open = true
    )
    and exists (
      select 1
      from public.videos v
      where v.id = votes.video_id
        and v.status = 'approved'
    )
  );

create policy votes_select_own_or_admin
  on public.votes for select
  to authenticated
  using (
    voter_id = auth.uid()
    or exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, full_name, instagram_handle)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    nullif(trim(new.raw_user_meta_data ->> 'instagram_handle'), '')
  );
  return new;
end;
$function$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'contest-videos',
  'contest-videos',
  false,
  10485760,
  array['video/mp4', 'video/webm', 'video/quicktime']::text[]
)
on conflict (id) do nothing;

create policy video_objects_insert_own_folder
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contest-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy video_objects_select_owner_approved_or_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contest-videos'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.videos v
        where v.video_path = storage.objects.name
          and v.status = 'approved'
      )
      or exists (
        select 1
        from public.admin_users au
        where au.user_id = auth.uid()
      )
    )
  );

create policy video_objects_delete_owner_or_admin
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'contest-videos'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.admin_users au
        where au.user_id = auth.uid()
      )
    )
  );
