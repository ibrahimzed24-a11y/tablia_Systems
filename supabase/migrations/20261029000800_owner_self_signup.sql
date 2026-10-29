-- Tablia Systems owner self-service onboarding. A signed-in owner creates one restaurant (organization), becomes
-- its tenant_admin and picks a plan (starter 3,999 / growth 6,999 / enterprise 10,000 EGP). The subscription row
-- stays past_due until paymob-webhook applies a payment; paymob-checkout opens Paymob for the chosen plan.
-- Organizations with no subscription row (the pilot tenant) keep working as before.

create or replace function public.create_my_organization(p_name text, p_slug text, p_tier public.subscription_tier)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.user_profiles p where p.id = v_uid and p.organization_id is not null) then
    raise exception 'this account already has a restaurant' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'restaurant name is required' using errcode = '22023'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' or v_slug in ('www', 'app', 'admin', 'api', 'owner', 'staff') then
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
end $$;

-- Change the chosen plan while it is unpaid (or after the paid period ended). Owner only.
create or replace function public.choose_my_plan(p_tier public.subscription_tier) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.get_auth_organization();
begin
  if v_org is null or not exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'tenant_admin') then
    raise exception 'only the restaurant owner can choose the plan' using errcode = '42501';
  end if;
  update public.subscriptions s set tier = p_tier
   where s.organization_id = v_org
     and not (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()));
  if not found then raise exception 'the current plan is paid and running' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.create_my_organization(text, text, public.subscription_tier) from public, anon;
revoke execute on function public.choose_my_plan(public.subscription_tier) from public, anon;
grant execute on function public.create_my_organization(text, text, public.subscription_tier) to authenticated;
grant execute on function public.choose_my_plan(public.subscription_tier) to authenticated;
