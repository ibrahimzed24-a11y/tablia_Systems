-- Tablia Systems platform super admin. A super admin is a row in public.platform_admins, which only the
-- service role or the migration owner can write and which no signed-in user (owner, manager or staff) can
-- read or change: RLS is on with no policy and the table privileges are revoked. Every super admin action is
-- a security definer function that checks app.is_super_admin() first. tenant_role is unchanged, so no owner
-- can reach this role through user_profiles, metadata or onboarding.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

-- Restaurant suspension and the owner's editable profile.
alter table public.organizations
  add column if not exists is_active boolean not null default true,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text check (char_length(suspended_reason) <= 300),
  add column if not exists phone text check (phone is null or phone ~ '^\+?[0-9]{8,15}$'),
  add column if not exists address text check (char_length(address) <= 300),
  add column if not exists description_ar text check (char_length(description_ar) <= 1000),
  add column if not exists description_en text check (char_length(description_en) <= 1000);

-- Subscriptions created by hand for demos and QA; left out of revenue figures.
alter table public.subscriptions add column if not exists is_test boolean not null default false;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
$$;

create or replace function app.require_super_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
end $$;

create or replace function public.am_i_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_super_admin() $$;

-- A suspended restaurant disappears from its public page: no storefront, orders or reservations.
create or replace function app.tenant_by_slug(p_slug text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select o.id into v from public.organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.is_active;
  if v is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- ---- owner: profile and subscription status ----
create or replace function public.get_my_restaurant() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'slug', o.slug, 'phone', o.phone, 'address', o.address,
    'description_ar', o.description_ar, 'description_en', o.description_en,
    'is_active', o.is_active, 'suspended_reason', o.suspended_reason,
    'role', p.role, 'full_name', p.full_name,
    'subscription', (select jsonb_build_object('tier', s.tier, 'status', s.status, 'is_test', s.is_test,
        'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
        'paid', s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()))
      from public.subscriptions s where s.organization_id = o.id))
  from public.user_profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
$$;

create or replace function public.update_my_restaurant(
  p_name text, p_phone text, p_address text, p_description_ar text, p_description_en text, p_full_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.get_auth_organization();
begin
  if v_org is null or not exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'tenant_admin') then
    raise exception 'only the restaurant owner can edit the profile' using errcode = '42501';
  end if;
  update public.organizations o set
    name = btrim(coalesce(p_name, '')),
    phone = nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]-]', '', 'g'), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    description_ar = nullif(btrim(coalesce(p_description_ar, '')), ''),
    description_en = nullif(btrim(coalesce(p_description_en, '')), '')
   where o.id = v_org;
  update public.user_profiles p set full_name = nullif(btrim(coalesce(p_full_name, '')), '') where p.id = auth.uid();
end $$;

-- ---- super admin ----
create or replace function public.admin_list_restaurants() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return coalesce((
    select jsonb_agg(q.r order by q.created_at desc) from (
      select o.created_at, jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'created_at', o.created_at,
        'is_active', o.is_active, 'suspended_reason', o.suspended_reason,
        'owner_email', (select u.email from public.user_profiles p join auth.users u on u.id = p.id
                         where p.organization_id = o.id and p.role = 'tenant_admin' order by p.created_at limit 1),
        'tier', s.tier, 'status', s.status, 'is_test', coalesce(s.is_test, false),
        'current_period_end', s.current_period_end,
        'paid', s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()),
        'last_payment_at', (select max(t.received_at) from public.paymob_transactions t
                             where t.organization_id = o.id and t.outcome = 'applied'),
        'orders', (select count(*) from public.orders x where x.organization_id = o.id),
        'customers', (select count(*) from public.crm_customers c where c.organization_id = o.id)) as r
      from public.organizations o
      left join public.subscriptions s on s.organization_id = o.id) q), '[]'::jsonb);
end $$;

create or replace function public.admin_set_restaurant_active(p_org uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.organizations o set
    is_active = p_active,
    suspended_at = case when p_active then null else now() end,
    suspended_reason = case when p_active then null else nullif(left(btrim(coalesce(p_reason, '')), 300), '') end
   where o.id = p_org;
  if not found then raise exception 'restaurant not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), case when p_active then 'restaurant_activated' else 'restaurant_suspended' end, 'organizations', p_org::text);
end $$;

create or replace function public.admin_platform_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'restaurants', (select count(*) from public.organizations),
    'active_restaurants', (select count(*) from public.organizations o where o.is_active),
    'suspended_restaurants', (select count(*) from public.organizations o where not o.is_active),
    'paying', (select count(*) from public.subscriptions s where s.status = 'active' and not s.is_test
                 and (s.current_period_end is null or s.current_period_end > now())),
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due'),
    'test_subscriptions', (select count(*) from public.subscriptions s where s.is_test),
    'mrr_egp', (select coalesce(sum(l.price_amount_cents), 0) / 100 from public.subscriptions s
                  join public.plan_limits l on l.tier = s.tier
                 where s.status = 'active' and not s.is_test and (s.current_period_end is null or s.current_period_end > now())),
    'owners', (select count(*) from public.user_profiles p where p.role = 'tenant_admin'),
    'customers', (select count(*) from public.crm_customers),
    'orders_total', (select count(*) from public.orders),
    'orders_30d', (select count(*) from public.orders x where x.created_at > now() - interval '30 days'));
end $$;

revoke execute on function app.is_super_admin(), app.require_super_admin(), public.am_i_super_admin(),
  public.get_my_restaurant(), public.update_my_restaurant(text, text, text, text, text, text),
  public.admin_list_restaurants(), public.admin_set_restaurant_active(uuid, boolean, text),
  public.admin_platform_stats() from public, anon;
grant execute on function app.is_super_admin(), app.require_super_admin(), public.am_i_super_admin(),
  public.get_my_restaurant(), public.update_my_restaurant(text, text, text, text, text, text),
  public.admin_list_restaurants(), public.admin_set_restaurant_active(uuid, boolean, text),
  public.admin_platform_stats() to authenticated, service_role;
