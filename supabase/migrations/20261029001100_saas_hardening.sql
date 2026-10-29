-- Tablia Systems SaaS hardening (docs/ROLES.md):
--   1) Admin data needs an MFA-verified session: a platform_admins row AND an aal2 JWT (authenticator-app code).
--   2) A suspended restaurant locks its owner and staff console, not only its public page.
--   3) A platform admin account cannot create or own a restaurant.
--   4) Admins activate, extend, comp or cancel a restaurant's plan by hand (admin_set_subscription) until Paymob is live.

-- 1) Every admin_* function checks app.is_super_admin(), so this one change covers all of them.
create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- Membership only, so /admin can ask a listed admin for the authenticator code. It returns no admin data.
create or replace function public.am_i_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
$$;

-- 2) Every merchant policy and owner function scopes rows by get_auth_organization(): a suspended restaurant gets none.
-- get_my_restaurant still answers, so the console can say why it is locked.
create or replace function public.get_auth_organization() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.user_profiles p
    join public.organizations o on o.id = p.organization_id
   where p.id = auth.uid() and o.is_active
$$;

create or replace function app.require_active_restaurant() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.user_profiles p join public.organizations o on o.id = p.organization_id
              where p.id = auth.uid() and not o.is_active) then
    raise exception 'this restaurant is suspended' using errcode = '42501';
  end if;
end $$;
revoke all on function app.require_active_restaurant() from public, anon;

-- 2 and 3) The owner functions that read user_profiles directly, redefined with the new checks.
create or replace function public.update_my_restaurant(
  p_name text, p_phone text, p_address text, p_description_ar text, p_description_en text, p_full_name text
) returns void
language plpgsql security definer set search_path = '' as $
declare v_org uuid := public.get_auth_organization();
begin
  perform app.require_active_restaurant();
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
end $;

create or replace function public.choose_my_plan(p_tier public.subscription_tier) returns void
language plpgsql security definer set search_path = '' as $
declare v_org uuid := public.get_auth_organization();
begin
  perform app.require_active_restaurant();
  if v_org is null or not exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'tenant_admin') then
    raise exception 'only the restaurant owner can choose the plan' using errcode = '42501';
  end if;
  update public.subscriptions s set tier = p_tier
   where s.organization_id = v_org
     and not (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()));
  if not found then raise exception 'the current plan is paid and running' using errcode = 'P0001'; end if;
end $;

create or replace function public.create_my_organization(p_name text, p_slug text, p_tier public.subscription_tier)
returns uuid
language plpgsql security definer set search_path = '' as $
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then
    raise exception 'platform admins cannot own a restaurant' using errcode = '42501';
  end if;
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.user_profiles p where p.id = v_uid and p.organization_id is not null) then
    raise exception 'this account already has a restaurant' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'restaurant name is required' using errcode = '22023'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?

-- 4) Manual plan changes by an admin. activate: a paid plan for p_days; comp: the same but marked as a test
-- (left out of revenue); extend: adds p_days to the current period; cancel: ends the plan now.
create or replace function public.admin_set_subscription(
  p_org uuid, p_action text, p_tier public.subscription_tier default null, p_days int default 30)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_days int := coalesce(p_days, 30);
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'restaurant not found' using errcode = 'P0002';
  end if;
  if p_action is null or p_action not in ('activate', 'extend', 'comp', 'cancel') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  if v_days not between 1 and 366 then raise exception 'days must be between 1 and 366' using errcode = '22023'; end if;

  if p_action in ('activate', 'comp') then
    insert into public.subscriptions (organization_id, tier, status, billing_provider, current_period_start, current_period_end, is_test)
    values (p_org, coalesce(p_tier, 'starter'), 'active', 'manual', now(), now() + make_interval(days => v_days), p_action = 'comp')
    on conflict (organization_id) do update set
      tier = coalesce(p_tier, public.subscriptions.tier), status = 'active', billing_provider = 'manual',
      current_period_start = now(), current_period_end = now() + make_interval(days => v_days),
      is_test = (p_action = 'comp'), updated_at = now();
  elsif p_action = 'extend' then
    update public.subscriptions s set
      current_period_start = coalesce(s.current_period_start, now()),
      current_period_end = greatest(coalesce(s.current_period_end, now()), now()) + make_interval(days => v_days),
      status = 'active', updated_at = now()
     where s.organization_id = p_org;
    if not found then raise exception 'this restaurant has no plan to extend' using errcode = 'P0002'; end if;
  else
    update public.subscriptions s set
      status = 'canceled',
      current_period_end = case when s.current_period_start is not null and s.current_period_start >= now()
                                then s.current_period_start + interval '1 second' else now() end,
      updated_at = now()
     where s.organization_id = p_org;
    if not found then raise exception 'this restaurant has no plan to cancel' using errcode = 'P0002'; end if;
  end if;

  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'subscription_' || p_action, 'subscriptions', p_org::text);
end $$;
revoke all on function public.admin_set_subscription(uuid, text, public.subscription_tier, int) from public, anon;
grant execute on function public.admin_set_subscription(uuid, text, public.subscription_tier, int) to authenticated;
 or v_slug in ('www', 'app', 'admin', 'api', 'owner', 'staff') then
    raise exception 'invalid web address' using errcode = '22023';
  end if;
  if p_tier is null then raise exception 'choose a plan' using errcode = '22023'; end if;
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'this web address is taken' using errcode = '23505';
  end if;
  insert into public.organizations (name, slug) values (v_name, v_slug) returning id into v_org;
  insert into public.user_profiles (id, organization_id, role) values (v_uid, v_org, 'tenant_admin')
  on conflict (id) do update set organization_id = excluded.organization_id, role = 'tenant_admin';
  insert into public.subscriptions (organization_id, tier, status) values (v_org, p_tier, 'past_due');
  return v_org;
end $;

-- 4) Manual plan changes by an admin. activate: a paid plan for p_days; comp: the same but marked as a test
-- (left out of revenue); extend: adds p_days to the current period; cancel: ends the plan now.
create or replace function public.admin_set_subscription(
  p_org uuid, p_action text, p_tier public.subscription_tier default null, p_days int default 30)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_days int := coalesce(p_days, 30);
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'restaurant not found' using errcode = 'P0002';
  end if;
  if p_action is null or p_action not in ('activate', 'extend', 'comp', 'cancel') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  if v_days not between 1 and 366 then raise exception 'days must be between 1 and 366' using errcode = '22023'; end if;

  if p_action in ('activate', 'comp') then
    insert into public.subscriptions (organization_id, tier, status, billing_provider, current_period_start, current_period_end, is_test)
    values (p_org, coalesce(p_tier, 'starter'), 'active', 'manual', now(), now() + make_interval(days => v_days), p_action = 'comp')
    on conflict (organization_id) do update set
      tier = coalesce(p_tier, public.subscriptions.tier), status = 'active', billing_provider = 'manual',
      current_period_start = now(), current_period_end = now() + make_interval(days => v_days),
      is_test = (p_action = 'comp'), updated_at = now();
  elsif p_action = 'extend' then
    update public.subscriptions s set
      current_period_start = coalesce(s.current_period_start, now()),
      current_period_end = greatest(coalesce(s.current_period_end, now()), now()) + make_interval(days => v_days),
      status = 'active', updated_at = now()
     where s.organization_id = p_org;
    if not found then raise exception 'this restaurant has no plan to extend' using errcode = 'P0002'; end if;
  else
    update public.subscriptions s set
      status = 'canceled',
      current_period_end = case when s.current_period_start is not null and s.current_period_start >= now()
                                then s.current_period_start + interval '1 second' else now() end,
      updated_at = now()
     where s.organization_id = p_org;
    if not found then raise exception 'this restaurant has no plan to cancel' using errcode = 'P0002'; end if;
  end if;

  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'subscription_' || p_action, 'subscriptions', p_org::text);
end $$;
revoke all on function public.admin_set_subscription(uuid, text, public.subscription_tier, int) from public, anon;
grant execute on function public.admin_set_subscription(uuid, text, public.subscription_tier, int) to authenticated;
