create extension if not exists pgcrypto;

create table if not exists public.app_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'customer'
    check (role in ('customer', 'analyst', 'admin')),
  display_name text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.kyc_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.app_accounts(id) on delete set null,
  full_name varchar(255) not null,
  dob date not null,
  email varchar(255) not null,
  phone varchar(50) not null,
  address text not null,
  document_type varchar(50) not null
    check (document_type in ('passport', 'aadhaar', 'pan', 'driver_license')),
  document_image text,
  selfie_image text,
  consent_accepted boolean not null default false,
  compliance_checked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.kyc_profiles(id) on delete cascade,
  preset varchar(50) not null default 'clean'
    check (preset in ('clean', 'manually_edited', 'deepfake', 'synthetic')),
  status varchar(30) not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'HELD_FOR_REVIEW')),
  result jsonb not null,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kyc_session_telemetry (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid references public.kyc_verifications(id) on delete cascade,
  typing_speed integer default 0,
  mouse_speed integer default 0,
  event_count integer default 0,
  human_confidence integer default 0,
  current_step integer,
  created_at timestamptz not null default now()
);

create table if not exists public.kyc_audit_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid references public.kyc_verifications(id) on delete cascade,
  actor_email text,
  event_type text not null,
  old_status text,
  new_status text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists app_accounts_email_idx
  on public.app_accounts(email);

create index if not exists kyc_profiles_email_idx
  on public.kyc_profiles(email);

create index if not exists kyc_profiles_account_id_idx
  on public.kyc_profiles(account_id);

create index if not exists kyc_verifications_created_at_idx
  on public.kyc_verifications(created_at desc);

create index if not exists kyc_verifications_profile_id_idx
  on public.kyc_verifications(profile_id);

create index if not exists kyc_verifications_status_idx
  on public.kyc_verifications(status);

create index if not exists kyc_verifications_result_gin_idx
  on public.kyc_verifications using gin(result);

create index if not exists kyc_session_telemetry_verification_id_idx
  on public.kyc_session_telemetry(verification_id);

create index if not exists kyc_audit_events_verification_id_idx
  on public.kyc_audit_events(verification_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_kyc_verifications_updated_at on public.kyc_verifications;

create trigger set_kyc_verifications_updated_at
before update on public.kyc_verifications
for each row
execute function public.set_updated_at();

create or replace function public.log_kyc_status_change()
returns trigger as $$
begin
  if old.status is distinct from new.status then
    insert into public.kyc_audit_events (
      verification_id,
      actor_email,
      event_type,
      old_status,
      new_status
    )
    values (
      new.id,
      new.reviewed_by,
      'STATUS_CHANGED',
      old.status,
      new.status
    );
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists log_kyc_status_change_trigger on public.kyc_verifications;

create trigger log_kyc_status_change_trigger
after update on public.kyc_verifications
for each row
execute function public.log_kyc_status_change();

alter table public.app_accounts enable row level security;
alter table public.kyc_profiles enable row level security;
alter table public.kyc_verifications enable row level security;
alter table public.kyc_session_telemetry enable row level security;
alter table public.kyc_audit_events enable row level security;

insert into public.app_accounts (email, role, display_name)
values ('admingdr05@gmail.com', 'admin', 'ADMIN')
on conflict (email)
do update set role = 'admin', display_name = excluded.display_name;

-- Enable RLS
alter table public.app_accounts enable row level security;
alter table public.kyc_profiles enable row level security;
alter table public.kyc_verifications enable row level security;
alter table public.kyc_session_telemetry enable row level security;
alter table public.kyc_audit_events enable row level security;

-- Helper: current logged-in email
create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'email'
$$;

-- Helper: current user's app role
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.app_accounts
  where email = public.current_user_email()
    and is_active = true
  limit 1
$$;

-- Helper: admin check
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

-- Remove old policies
drop policy if exists "accounts_select_own_or_admin" on public.app_accounts;
drop policy if exists "accounts_insert_customer_self" on public.app_accounts;
drop policy if exists "accounts_update_own_non_role" on public.app_accounts;
drop policy if exists "accounts_admin_all" on public.app_accounts;

drop policy if exists "profiles_select_own_or_admin" on public.kyc_profiles;
drop policy if exists "profiles_insert_own_or_admin" on public.kyc_profiles;
drop policy if exists "profiles_update_admin_only" on public.kyc_profiles;

drop policy if exists "verifications_select_own_or_admin" on public.kyc_verifications;
drop policy if exists "verifications_insert_own_or_admin" on public.kyc_verifications;
drop policy if exists "verifications_update_admin_only" on public.kyc_verifications;

drop policy if exists "telemetry_select_own_or_admin" on public.kyc_session_telemetry;
drop policy if exists "telemetry_insert_own_or_admin" on public.kyc_session_telemetry;

drop policy if exists "audit_select_admin_only" on public.kyc_audit_events;
drop policy if exists "audit_insert_admin_or_owner_submit" on public.kyc_audit_events;

-- app_accounts
create policy "accounts_select_own_or_admin"
on public.app_accounts
for select
to authenticated
using (
  email = public.current_user_email()
  or public.is_admin()
);

create policy "accounts_insert_customer_self"
on public.app_accounts
for insert
to authenticated
with check (
  email = public.current_user_email()
  and role = 'customer'
);

create policy "accounts_update_own_non_admin"
on public.app_accounts
for update
to authenticated
using (
  email = public.current_user_email()
)
with check (
  email = public.current_user_email()
  and role <> 'admin'
);

create policy "accounts_admin_all"
on public.app_accounts
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- kyc_profiles
create policy "profiles_select_own_or_admin"
on public.kyc_profiles
for select
to authenticated
using (
  email = public.current_user_email()
  or public.is_admin()
);

create policy "profiles_insert_own_or_admin"
on public.kyc_profiles
for insert
to authenticated
with check (
  email = public.current_user_email()
  or public.is_admin()
);

create policy "profiles_update_admin_only"
on public.kyc_profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- kyc_verifications
create policy "verifications_select_own_or_admin"
on public.kyc_verifications
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.kyc_profiles p
    where p.id = kyc_verifications.profile_id
      and p.email = public.current_user_email()
  )
);

create policy "verifications_insert_own_or_admin"
on public.kyc_verifications
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.kyc_profiles p
    where p.id = kyc_verifications.profile_id
      and p.email = public.current_user_email()
  )
);

create policy "verifications_update_admin_only"
on public.kyc_verifications
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- kyc_session_telemetry
create policy "telemetry_select_own_or_admin"
on public.kyc_session_telemetry
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.kyc_verifications v
    join public.kyc_profiles p on p.id = v.profile_id
    where v.id = kyc_session_telemetry.verification_id
      and p.email = public.current_user_email()
  )
);

create policy "telemetry_insert_own_or_admin"
on public.kyc_session_telemetry
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.kyc_verifications v
    join public.kyc_profiles p on p.id = v.profile_id
    where v.id = kyc_session_telemetry.verification_id
      and p.email = public.current_user_email()
  )
);

-- kyc_audit_events
create policy "audit_select_admin_only"
on public.kyc_audit_events
for select
to authenticated
using (public.is_admin());

create policy "audit_insert_admin_or_owner_submit"
on public.kyc_audit_events
for insert
to authenticated
with check (
  public.is_admin()
  or (
    event_type = 'APPLICATION_SUBMITTED'
    and actor_email = public.current_user_email()
    and exists (
      select 1
      from public.kyc_verifications v
      join public.kyc_profiles p on p.id = v.profile_id
      where v.id = kyc_audit_events.verification_id
        and p.email = public.current_user_email()
    )
  )
);


