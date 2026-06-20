create extension if not exists pgcrypto;

create table if not exists public.app_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'customer'
    check (role in ('customer', 'analyst', 'admin')),
  display_name text,
  is_active boolean not null default true,
  account_status text not null default 'PENDING_KYC'
    check (account_status in ('PENDING_KYC', 'ACTIVE', 'REVIEW_LOCKED', 'REJECTED', 'SUSPENDED')),
  activated_at timestamptz,
  deactivated_at timestamptz,
  latest_risk_score integer not null default 0 check (latest_risk_score >= 0 and latest_risk_score <= 100),
  latest_risk_rating text not null default 'LOW'
    check (latest_risk_rating in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.app_accounts
  add column if not exists account_status text not null default 'PENDING_KYC'
    check (account_status in ('PENDING_KYC', 'ACTIVE', 'REVIEW_LOCKED', 'REJECTED', 'SUSPENDED')),
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists latest_risk_score integer not null default 0 check (latest_risk_score >= 0 and latest_risk_score <= 100),
  add column if not exists latest_risk_rating text not null default 'LOW'
    check (latest_risk_rating in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

create table if not exists public.kyc_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.app_accounts(id) on delete set null,
  full_name varchar(255) not null,
  dob date not null,
  email varchar(255) not null,
  phone varchar(50) not null,
  address text not null,
  document_number varchar(100),
  document_type varchar(50) not null
    check (document_type in ('passport', 'aadhaar', 'pan', 'driver_license')),
  document_image text,
  selfie_image text,
  consent_accepted boolean not null default false,
  compliance_checked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.kyc_profiles
  add column if not exists document_number varchar(100);

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

create table if not exists public.monitoring_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.app_accounts(id) on delete set null,
  event_type text not null
    check (event_type in ('LOGIN', 'TRANSACTION', 'DEVICE_SWAP', 'GEOLOCATION_SWAP', 'BEHAVIOR_DRIFT', 'AML_ALERT', 'FRAUD_ALERT')),
  user_name text not null default 'Unknown User',
  email text not null,
  ip text not null default '127.0.0.1',
  location text not null default 'Unknown',
  device text not null default 'Unknown Device',
  details text not null,
  risk_score integer not null default 0 check (risk_score >= 0 and risk_score <= 100),
  risk_rating text not null default 'LOW'
    check (risk_rating in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  mitigation_applied text not null default 'Logged for monitoring',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.risk_recalculations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.app_accounts(id) on delete cascade,
  verification_id uuid references public.kyc_verifications(id) on delete set null,
  monitoring_event_id uuid references public.monitoring_events(id) on delete set null,
  previous_score integer not null default 0 check (previous_score >= 0 and previous_score <= 100),
  new_score integer not null default 0 check (new_score >= 0 and new_score <= 100),
  new_rating text not null default 'LOW'
    check (new_rating in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  reason text not null,
  action_taken text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.risk_alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.app_accounts(id) on delete cascade,
  monitoring_event_id uuid references public.monitoring_events(id) on delete set null,
  alert_type text not null
    check (alert_type in ('ACCOUNT_ACTIVATION', 'FRAUD_ALERT', 'AML_ALERT', 'RISK_ESCALATION', 'KYC_REJECTION', 'MANUAL_REVIEW')),
  severity text not null default 'LOW'
    check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title text not null,
  message text not null,
  action_required text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
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

create index if not exists monitoring_events_created_at_idx
  on public.monitoring_events(created_at desc);

create index if not exists monitoring_events_email_idx
  on public.monitoring_events(email);

create index if not exists monitoring_events_type_idx
  on public.monitoring_events(event_type);

create index if not exists monitoring_events_risk_idx
  on public.monitoring_events(risk_rating, risk_score desc);

create index if not exists app_accounts_status_idx
  on public.app_accounts(account_status);

create index if not exists risk_recalculations_account_idx
  on public.risk_recalculations(account_id, created_at desc);

create index if not exists risk_alerts_account_idx
  on public.risk_alerts(account_id, created_at desc);

create index if not exists risk_alerts_status_idx
  on public.risk_alerts(status, severity);

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
alter table public.monitoring_events enable row level security;
alter table public.risk_recalculations enable row level security;
alter table public.risk_alerts enable row level security;

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
alter table public.monitoring_events enable row level security;
alter table public.risk_recalculations enable row level security;
alter table public.risk_alerts enable row level security;

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
drop policy if exists "accounts_update_own_non_admin" on public.app_accounts;
drop policy if exists "accounts_admin_all" on public.app_accounts;

drop policy if exists "profiles_select_own_or_admin" on public.kyc_profiles;
drop policy if exists "profiles_insert_own_or_admin" on public.kyc_profiles;
drop policy if exists "profiles_update_admin_only" on public.kyc_profiles;
drop policy if exists "profiles_delete_admin_only" on public.kyc_profiles;

drop policy if exists "verifications_select_own_or_admin" on public.kyc_verifications;
drop policy if exists "verifications_insert_own_or_admin" on public.kyc_verifications;
drop policy if exists "verifications_update_admin_only" on public.kyc_verifications;
drop policy if exists "verifications_delete_admin_only" on public.kyc_verifications;

drop policy if exists "telemetry_select_own_or_admin" on public.kyc_session_telemetry;
drop policy if exists "telemetry_insert_own_or_admin" on public.kyc_session_telemetry;

drop policy if exists "audit_select_admin_only" on public.kyc_audit_events;
drop policy if exists "audit_insert_admin_or_owner_submit" on public.kyc_audit_events;
drop policy if exists "monitoring_select_own_or_admin" on public.monitoring_events;
drop policy if exists "monitoring_insert_own_or_admin" on public.monitoring_events;
drop policy if exists "monitoring_update_admin_only" on public.monitoring_events;
drop policy if exists "monitoring_delete_admin_only" on public.monitoring_events;
drop policy if exists "risk_recalculations_select_own_or_admin" on public.risk_recalculations;
drop policy if exists "risk_recalculations_insert_admin_only" on public.risk_recalculations;
drop policy if exists "risk_alerts_select_own_or_admin" on public.risk_alerts;
drop policy if exists "risk_alerts_insert_admin_only" on public.risk_alerts;

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

create policy "profiles_delete_admin_only"
on public.kyc_profiles
for delete
to authenticated
using (public.is_admin());

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

create policy "verifications_delete_admin_only"
on public.kyc_verifications
for delete
to authenticated
using (public.is_admin());

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

-- monitoring_events
create policy "monitoring_select_own_or_admin"
on public.monitoring_events
for select
to authenticated
using (
  email = public.current_user_email()
  or public.is_admin()
);

create policy "monitoring_insert_own_or_admin"
on public.monitoring_events
for insert
to authenticated
with check (
  email = public.current_user_email()
  or public.is_admin()
);

create policy "monitoring_update_admin_only"
on public.monitoring_events
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "monitoring_delete_admin_only"
on public.monitoring_events
for delete
to authenticated
using (public.is_admin());

-- risk_recalculations
create policy "risk_recalculations_select_own_or_admin"
on public.risk_recalculations
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.app_accounts a
    where a.id = risk_recalculations.account_id
      and a.email = public.current_user_email()
  )
);

create policy "risk_recalculations_insert_admin_only"
on public.risk_recalculations
for insert
to authenticated
with check (public.is_admin());

-- risk_alerts
create policy "risk_alerts_select_own_or_admin"
on public.risk_alerts
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.app_accounts a
    where a.id = risk_alerts.account_id
      and a.email = public.current_user_email()
  )
);

create policy "risk_alerts_insert_admin_only"
on public.risk_alerts
for insert
to authenticated
with check (public.is_admin());
