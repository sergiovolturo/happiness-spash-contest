-- Step 1 — Happiness Contest domain foundation.
-- This migration intentionally excludes submissions, media, moderation,
-- voting and Storage objects.

create type public.contest_status as enum (
  'DRAFT',
  'SUBMISSIONS_OPEN',
  'SUBMISSIONS_CLOSED',
  'MODERATION',
  'READY_FOR_VOTING',
  'VOTING_OPEN',
  'VOTING_CLOSED',
  'CLOSED'
);

create type public.participation_status as enum (
  'ACTIVE',
  'WITHDRAWN',
  'CANCELLED'
);

create table public.platform_identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  status public.contest_status not null default 'DRAFT',
  configuration_version integer not null default 1
    check (configuration_version > 0),
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object'),
  submissions_open_at timestamptz,
  submissions_close_at timestamptz,
  voting_open_at timestamptz,
  voting_close_at timestamptz,
  created_by uuid references public.platform_identities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(slug)) > 0),
  check (length(btrim(name)) > 0),
  check (
    submissions_open_at is null
    or submissions_close_at is null
    or submissions_open_at < submissions_close_at
  ),
  check (
    voting_open_at is null
    or voting_close_at is null
    or voting_open_at < voting_close_at
  ),
  check (
    submissions_close_at is null
    or voting_open_at is null
    or submissions_close_at <= voting_open_at
  )
);

create table public.contest_categories (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  name text not null,
  slug text not null,
  display_order integer not null default 0 check (display_order >= 0),
  submission_cap integer not null check (submission_cap > 0),
  finalists_count integer not null default 4 check (finalists_count > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, slug),
  unique (contest_id, display_order),
  check (length(btrim(name)) > 0),
  check (length(btrim(slug)) > 0)
);

-- Architectural note: Contest-to-child ON DELETE CASCADE is acceptable for
-- foundation referential integrity. Later workflows must not expose hard
-- deletion of historical Contests as a normal Admin operation; concluded
-- Contests are normally retained through the CLOSED lifecycle state.
create table public.contest_participations (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  identity_id uuid not null references public.platform_identities(id) on delete restrict,
  status public.participation_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, identity_id)
);

create index contest_categories_contest_active_idx
  on public.contest_categories (contest_id, is_active, display_order);

create index contest_participations_identity_idx
  on public.contest_participations (identity_id, contest_id);

alter table public.platform_identities enable row level security;
alter table public.contests enable row level security;
alter table public.contest_categories enable row level security;
alter table public.contest_participations enable row level security;

-- Platform administrators remain global across all contests. The existing
-- admin_users table is intentionally read only from these policies.
create policy platform_identities_select_self_or_admin
  on public.platform_identities for select
  using (
    auth_user_id = auth.uid()
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy platform_identities_insert_self
  on public.platform_identities for insert
  with check (auth_user_id = auth.uid());

create policy contests_admin_all
  on public.contests for all
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy contest_categories_admin_all
  on public.contest_categories for all
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy contest_participations_select_own_or_admin
  on public.contest_participations for select
  using (
    exists (
      select 1 from public.platform_identities pi
      where pi.id = contest_participations.identity_id
        and pi.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy contest_participations_insert_own
  on public.contest_participations for insert
  with check (
    exists (
      select 1 from public.platform_identities pi
      where pi.id = contest_participations.identity_id
        and pi.auth_user_id = auth.uid()
    )
  );

create policy contest_participations_admin_all
  on public.contest_participations for all
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );
