-- Tablia Systems tenancy: organizations, subscriptions on two tiers (growth 4,999 EGP, scale_matrix 9,800 EGP),
-- custom domain and manager seat limits, a feature gate, tenant RLS and the signup profile trigger.
-- Additive only: nothing is dropped or recreated. Types, tables, columns, policies and triggers that already
-- exist are reused (public.custom_domains from 20261029000400 gains organization_id and ssl_status).
-- Payments are written only by the paymob-webhook edge function (service role) through apply_paymob_payment.

create extension if not exists pgcrypto;
create schema if not exists app;

-- ---- types ----
do $$ begin
  if to_regtype('public.subscription_tier') is null then
    create type public.subscription_tier as enum ('growth', 'scale_matrix');
  end if;
  if to_regtype('public.subscription_status') is null then
    create type public.subscription_status as enum ('active', 'past_due', 'canceled');
  end if;
  if to_regtype('public.tenant_role') is null then
    create type public.tenant_role as enum ('tenant_admin', 'manager');
  end if;
end $$;

-- ---- organizations (reused when it already exists) ----
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

-- ---- plan limits: one row per tier, prices in piasters (Paymob amount_cents) ----
create table if not exists public.plan_limits (
  tier public.subscription_tier primary key,
  price_amount_cents int not null unique check (price_amount_cents > 0),
  max_custom_domains int not null check (max_custom_domains >= 0),
  max_manager_seats int not null check (max_manager_seats >= 0),
  advanced_analytics boolean not null,
  export_reporting boolean not null
);
insert into public.plan_limits (tier, price_amount_cents, max_custom_domains, max_manager_seats, advanced_analytics, export_reporting) values
  ('growth',       499900, 1, 1, false, false),
  ('scale_matrix', 980000, 5, 5, true,  true)
on conflict (tier) do nothing;

-- ---- subscriptions: one row per organization ----
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  tier public.subscription_tier not null default 'growth',
  status public.subscription_status not null default 'active',
  billing_provider text not null default 'paymob',
  billing_provider_ref text,                 -- Paymob transaction id of the payment that set this period
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);

-- ---- custom domains: the table exists (20261029000400); tenants are added beside the pilot rows ----
alter table public.custom_domains add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.custom_domains add column if not exists ssl_status text not null default 'pending'
  check (ssl_status in ('pending', 'issuing', 'active', 'failed'));
create index if not exists custom_domains_org_idx on public.custom_domains (organization_id);

-- ---- user profiles ----
create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,   -- null until a tenant is assigned
  role public.tenant_role not null default 'manager',
  full_name text check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_profiles_org_idx on public.user_profiles (organization_id);

-- ---- Paymob transactions seen by the webhook (idempotency ledger) ----
create table if not exists public.paymob_transactions (
  transaction_id bigint primary key,
  order_id bigint,
  organization_id uuid references public.organizations (id) on delete set null,
  amount_cents int not null,
  currency text not null,
  tier public.subscription_tier,
  outcome text not null check (outcome in ('applied', 'ignored_amount', 'ignored_currency', 'ignored_organization')),
  received_at timestamptz not null default now()
);

-- ---- helpers ----
-- The caller's organization. SECURITY DEFINER with an empty search_path, so policies can call it without
-- recursing through user_profiles RLS and without being hijacked by objects in another schema.
create or replace function public.get_auth_organization() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.user_profiles p where p.id = auth.uid()
$$;

-- Tier in force: an active subscription whose period has not ended; anything else (none, past_due,
-- canceled, expired) counts as growth.
create or replace function app.org_tier(p_org uuid) returns public.subscription_tier
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.tier from public.subscriptions s
      where s.organization_id = p_org and s.status = 'active'
        and (s.current_period_end is null or s.current_period_end > now())),
    'growth'::public.subscription_tier)
$$;

create or replace function app.org_plan(p_org uuid) returns public.plan_limits
language sql stable security definer set search_path = '' as $$
  select l.* from public.plan_limits l where l.tier = app.org_tier(p_org)
$$;

-- Feature gate. Features: advanced_analytics, export_reporting. An unknown name is an error, not a silent false.
create or replace function app.org_has_feature(p_org uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare l public.plan_limits;
begin
  if p_feature not in ('advanced_analytics', 'export_reporting') then
    raise exception 'unknown feature %', p_feature using errcode = '22023';
  end if;
  if p_org is null then return false; end if;
  l := app.org_plan(p_org);
  return case p_feature when 'advanced_analytics' then l.advanced_analytics else l.export_reporting end;
end $$;

-- What the app calls: is this feature on for the signed-in user's organization?
create or replace function public.has_feature(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.org_has_feature(public.get_auth_organization(), p_feature)
$$;

-- ---- limits (BEFORE INSERT, and on the updates that could get round them) ----
create or replace function app.enforce_domain_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; used int;
begin
  if new.organization_id is null or new.status = 'removed' then return new; end if;   -- null = pilot staff-app domains
  if tg_op = 'UPDATE' and old.organization_id is not distinct from new.organization_id and old.status <> 'removed' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('tenant_domains:' || new.organization_id::text));
  lim := (app.org_plan(new.organization_id)).max_custom_domains;
  select count(*) into used from public.custom_domains d
   where d.organization_id = new.organization_id and d.status <> 'removed' and d.id <> new.id;
  if used >= lim then
    raise exception 'custom domain limit reached: % of % on the % plan', used, lim, app.org_tier(new.organization_id)
      using errcode = 'P0001', hint = 'Scale Matrix allows up to 5 custom domains.';
  end if;
  return new;
end $$;

create or replace function app.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; used int;
begin
  if new.organization_id is null or new.role <> 'manager' then return new; end if;
  if tg_op = 'UPDATE' and old.organization_id is not distinct from new.organization_id and old.role = new.role then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('tenant_seats:' || new.organization_id::text));
  lim := (app.org_plan(new.organization_id)).max_manager_seats;
  select count(*) into used from public.user_profiles p
   where p.organization_id = new.organization_id and p.role = 'manager' and p.id <> new.id;
  if used >= lim then
    raise exception 'manager seat limit reached: % of % on the % plan', used, lim, app.org_tier(new.organization_id)
      using errcode = 'P0001', hint = 'Scale Matrix allows up to 5 manager seats.';
  end if;
  return new;
end $$;

-- ---- profile on signup ----
-- The role is always manager: tenant_admin is never granted by a trigger or by metadata.
-- The organization comes from app metadata (only the service role can set it), or from user metadata
-- only on an invitation, which only the service role can send. A plain signup gets no organization.
create or replace function app.handle_new_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org text; v_org_id uuid;
begin
  v_org := coalesce(new.raw_app_meta_data ->> 'organization_id',
                    case when new.invited_at is not null then new.raw_user_meta_data ->> 'organization_id' end);
  if v_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select o.id into v_org_id from public.organizations o where o.id = v_org::uuid;
  end if;
  insert into public.user_profiles (id, organization_id, role, full_name)
  values (new.id, v_org_id, 'manager', left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---- Paymob payment -> subscription (called by paymob-webhook with the service role) ----
-- Idempotent on the Paymob transaction id. The amount picks the tier: 980000 piasters (9,800 EGP) is
-- scale_matrix, 499900 (4,999 EGP) is growth; any other amount or currency is recorded and ignored.
-- A renewal of the same tier while the period is running extends it by a month from its end.
create or replace function public.apply_paymob_payment(
  p_transaction_id bigint, p_order_id bigint, p_organization_id uuid, p_amount_cents int, p_currency text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_tier public.subscription_tier; v_outcome text; v_sub public.subscriptions; v_start timestamptz;
begin
  if p_transaction_id is null then raise exception 'transaction id required' using errcode = '22023'; end if;
  if upper(coalesce(p_currency, '')) <> 'EGP' then
    v_outcome := 'ignored_currency';
  elsif p_organization_id is null or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    v_outcome := 'ignored_organization';
  else
    select l.tier into v_tier from public.plan_limits l where l.price_amount_cents = p_amount_cents;
    v_outcome := case when v_tier is null then 'ignored_amount' else 'applied' end;
  end if;

  insert into public.paymob_transactions (transaction_id, order_id, organization_id, amount_cents, currency, tier, outcome)
  values (p_transaction_id, p_order_id, case when v_outcome = 'ignored_organization' then null else p_organization_id end,
          coalesce(p_amount_cents, 0), upper(coalesce(p_currency, '')), v_tier, v_outcome)
  on conflict (transaction_id) do nothing;
  if not found then return 'duplicate'; end if;
  if v_outcome <> 'applied' then return v_outcome; end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_organization_id for update;
  v_start := case when v_sub.id is not null and v_sub.status = 'active' and v_sub.tier = v_tier
                       and v_sub.current_period_end > now()
                  then v_sub.current_period_end else now() end;
  insert into public.subscriptions (organization_id, tier, status, billing_provider, billing_provider_ref,
                                    current_period_start, current_period_end)
  values (p_organization_id, v_tier, 'active', 'paymob', p_transaction_id::text, v_start, v_start + interval '1 month')
  on conflict (organization_id) do update
    set tier = excluded.tier, status = 'active', billing_provider = 'paymob',
        billing_provider_ref = excluded.billing_provider_ref,
        current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
        updated_at = now();
  return 'applied';
end $$;

-- ---- triggers (created only when missing) ----
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'custom_domains_tenant_limit' and tgrelid = 'public.custom_domains'::regclass) then
    create trigger custom_domains_tenant_limit before insert or update of organization_id, status on public.custom_domains
      for each row execute function app.enforce_domain_limit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_profiles_seat_limit' and tgrelid = 'public.user_profiles'::regclass) then
    create trigger user_profiles_seat_limit before insert or update of organization_id, role on public.user_profiles
      for each row execute function app.enforce_seat_limit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_profiles_touch' and tgrelid = 'public.user_profiles'::regclass) then
    create trigger user_profiles_touch before update on public.user_profiles for each row execute function app.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'subscriptions_touch' and tgrelid = 'public.subscriptions'::regclass) then
    create trigger subscriptions_touch before update on public.subscriptions for each row execute function app.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created_profile' and tgrelid = 'auth.users'::regclass) then
    create trigger on_auth_user_created_profile after insert on auth.users for each row execute function app.handle_new_user_profile();
  end if;
end $$;

-- ---- row level security ----
alter table public.organizations enable row level security;
alter table public.plan_limits enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.paymob_transactions enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('organizations',  'organizations_tenant_read',  'id = public.get_auth_organization()'),
    ('plan_limits',    'plan_limits_read',           'true'),
    ('subscriptions',  'subscriptions_tenant_read',  'organization_id = public.get_auth_organization()'),
    ('user_profiles',  'user_profiles_tenant_read',  'id = auth.uid() or organization_id = public.get_auth_organization()'),
    ('custom_domains', 'custom_domains_tenant_read', 'organization_id is not null and organization_id = public.get_auth_organization()')
  ) as v(tbl, name, expr) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
  end loop;
end $$;
-- No insert, update or delete policy on any of these: tenants read their subscription but never write it.
-- Writes go through the service role (paymob-webhook, provision-domain) or the migration owner.

revoke insert, update, delete, truncate on public.organizations, public.plan_limits, public.subscriptions,
  public.user_profiles from anon, authenticated;
revoke all on public.paymob_transactions from anon, authenticated;
revoke select on public.organizations, public.plan_limits, public.subscriptions, public.user_profiles from anon;

grant usage on schema app to authenticated;
revoke execute on function public.get_auth_organization(), public.has_feature(text) from public, anon;
grant execute on function public.get_auth_organization(), public.has_feature(text) to authenticated, service_role;
revoke execute on function app.org_tier(uuid), app.org_plan(uuid), app.org_has_feature(uuid, text),
  app.enforce_domain_limit(), app.enforce_seat_limit(), app.handle_new_user_profile() from public, anon, authenticated;
revoke execute on function public.apply_paymob_payment(bigint, bigint, uuid, int, text) from public, anon, authenticated;
grant execute on function public.apply_paymob_payment(bigint, bigint, uuid, int, text) to service_role;
