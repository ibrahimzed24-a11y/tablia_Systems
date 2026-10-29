-- Tablia Systems runs on three portals (docs/ROLES.md):
--   Admin    /admin   platform_admins only, through the admin_* functions.
--   Merchant /owner   user_profiles: tenant_admin (the owner) and manager (staff), scoped to one organization.
--   Customer /t/<slug> or <slug>.<root domain>: anonymous, only through get_public_storefront, place_order, create_reservation.
-- This migration removes the single-restaurant staff PWA that predates them (QR device sign-in, branch bookings,
-- WhatsApp desk, SOP and task console, branch metrics): none of the three portals reads or writes those objects.

-- 1) Legacy staff PWA: scheduled jobs, audit rows of the dropped tables, tables, functions and types.
-- pg_cron is only present where it was enabled (it is not in a fresh local database), so the unschedule is guarded.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('mr-purge-guest-data', 'mr-branch-metrics-hourly');
  end if;
end $$;

delete from public.audit_log
 where entity in ('staff', 'staff_devices', 'provision_tokens', 'bookings', 'whatsapp_requests', 'whatsapp_replies', 'workflow_tasks', 'sops');

drop table if exists public.whatsapp_replies, public.whatsapp_requests, public.bookings, public.workflow_tasks, public.sops,
  public.branch_metrics_hourly, public.staff_devices, public.provision_tokens, public.staff cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('covers_today', 'revoke_device', 'record_whatsapp_reply', 'set_item_availability', 'ops_me'))
        or (n.nspname = 'app' and p.proname in ('purge_guest_data', 'forget_guest', 'snapshot_branch_metrics', 'ops_task_guard',
             'ops_sop_stamp', 'ops_audit', 'valid_sop_steps', 'has_role', 'in_branch', 'current_staff_role', 'current_staff_branch',
             'ops_role', 'ops_in_branch', 'ops_is_manager'))
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['staff_role', 'booking_status', 'wa_status', 'sop_category', 'task_status', 'task_priority'] loop
    begin
      execute format('drop type if exists public.%I', t);
    exception when dependent_objects_still_exist then null;
    end;
  end loop;
end $$;

-- 2) Merchant roles. The owner (tenant_admin) runs the restaurant; staff (manager) operate it.
create or replace function app.is_org_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles p
                  where p.id = auth.uid() and p.organization_id is not null and p.role = 'tenant_admin');
$$;
revoke all on function app.is_org_owner() from public, anon;
grant execute on function app.is_org_owner() to authenticated;

create or replace function app.is_super_admin_id(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = p_user);
$$;
revoke all on function app.is_super_admin_id(uuid) from public, anon, authenticated;

-- Menu: everyone in the restaurant reads it, only the owner shapes it, staff may mark items sold out or back.
drop policy if exists tenant_sections_all on public.menu_sections;
create policy tenant_sections_read on public.menu_sections for select to authenticated
  using (organization_id is not null and organization_id = (select public.get_auth_organization()));
create policy tenant_sections_owner on public.menu_sections for all to authenticated
  using (organization_id is not null and organization_id = (select public.get_auth_organization()) and (select app.is_org_owner()))
  with check (organization_id is not null and organization_id = (select public.get_auth_organization()) and (select app.is_org_owner()));

drop policy if exists tenant_items_all on public.menu_items;
create policy tenant_items_read on public.menu_items for select to authenticated
  using (exists (select 1 from public.menu_sections s where s.id = menu_items.section_id and s.organization_id = (select public.get_auth_organization())));
create policy tenant_items_owner on public.menu_items for all to authenticated
  using ((select app.is_org_owner()) and exists (select 1 from public.menu_sections s where s.id = menu_items.section_id and s.organization_id = (select public.get_auth_organization())))
  with check ((select app.is_org_owner()) and exists (select 1 from public.menu_sections s where s.id = menu_items.section_id and s.organization_id = (select public.get_auth_organization())));
create policy tenant_items_staff_availability on public.menu_items for update to authenticated
  using (exists (select 1 from public.menu_sections s where s.id = menu_items.section_id and s.organization_id = (select public.get_auth_organization())))
  with check (exists (select 1 from public.menu_sections s where s.id = menu_items.section_id and s.organization_id = (select public.get_auth_organization())));

create or replace function app.menu_item_staff_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare keep text[] := array['is_available', 'sold_out_until', 'updated_at', 'updated_by'];
begin
  if auth.uid() is null or app.is_org_owner() or app.is_super_admin_id(auth.uid()) then return new; end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'staff can only change whether an item is available' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists menu_items_staff_guard on public.menu_items;
create trigger menu_items_staff_guard before update on public.menu_items
  for each row execute function app.menu_item_staff_guard();

-- Events: staff see them, the owner creates and publishes them.
drop policy if exists tenant_events_all on public.restaurant_events;
create policy tenant_events_read on public.restaurant_events for select to authenticated
  using (organization_id = (select public.get_auth_organization()));
create policy tenant_events_owner on public.restaurant_events for all to authenticated
  using (organization_id = (select public.get_auth_organization()) and (select app.is_org_owner()))
  with check (organization_id = (select public.get_auth_organization()) and (select app.is_org_owner()));

-- 3) Staff seats (Growth 3, Enterprise 10): the owner adds staff by email.
create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, email)
);
alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from anon, authenticated;

create or replace function public.owner_list_team()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.get_auth_organization();
begin
  if v_org is null or not app.is_org_owner() then
    raise exception 'only the restaurant owner can manage staff' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'seats', (app.org_plan(v_org)).max_manager_seats,
    'members', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'full_name', p.full_name, 'role', p.role) order by p.role desc, u.email)
                           from public.user_profiles p join auth.users u on u.id = p.id where p.organization_id = v_org), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('email', i.email, 'created_at', i.created_at) order by i.created_at)
                           from public.staff_invites i where i.organization_id = v_org and i.accepted_at is null), '[]'::jsonb));
end $$;

create or replace function public.owner_invite_staff(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.get_auth_organization();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid; v_lim int; v_used int;
begin
  if v_org is null or not app.is_org_owner() then
    raise exception 'only the restaurant owner can manage staff' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid email' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('tenant_seats:' || v_org::text));
  v_lim := (app.org_plan(v_org)).max_manager_seats;
  select (select count(*) from public.user_profiles p where p.organization_id = v_org and p.role = 'manager')
       + (select count(*) from public.staff_invites i where i.organization_id = v_org and i.accepted_at is null and i.email <> v_email)
    into v_used;
  if v_used >= v_lim then
    raise exception 'staff seat limit reached: % of %', v_used, v_lim using errcode = 'P0001';
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = v_email;
  if v_uid is not null then
    if app.is_super_admin_id(v_uid) then
      raise exception 'this email cannot be added as staff' using errcode = '42501';
    end if;
    if exists (select 1 from public.user_profiles p where p.id = v_uid and p.organization_id is not null) then
      raise exception 'this email already belongs to a restaurant' using errcode = 'P0001';
    end if;
    insert into public.user_profiles (id, organization_id, role) values (v_uid, v_org, 'manager')
    on conflict (id) do update set organization_id = excluded.organization_id, role = 'manager';
    delete from public.staff_invites i where i.organization_id = v_org and i.email = v_email;
    return 'added';
  end if;
  insert into public.staff_invites (organization_id, email, invited_by) values (v_org, v_email, auth.uid())
  on conflict (organization_id, email) do update set accepted_at = null, created_at = now(), invited_by = excluded.invited_by;
  return 'invited';
end $$;

create or replace function public.owner_remove_staff(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.get_auth_organization(); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_org is null or not app.is_org_owner() then
    raise exception 'only the restaurant owner can manage staff' using errcode = '42501';
  end if;
  delete from public.staff_invites i where i.organization_id = v_org and i.email = v_email;
  update public.user_profiles p set organization_id = null
   where p.organization_id = v_org and p.role = 'manager'
     and p.id = (select u.id from auth.users u where lower(u.email) = v_email);
end $$;

revoke all on function public.owner_list_team(), public.owner_invite_staff(text), public.owner_remove_staff(text) from public, anon;
grant execute on function public.owner_list_team(), public.owner_invite_staff(text), public.owner_remove_staff(text) to authenticated;

-- A new account whose email the owner invited joins that restaurant as staff.
create or replace function app.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org text; v_org_id uuid;
begin
  v_org := coalesce(new.raw_app_meta_data ->> 'organization_id',
                    case when new.invited_at is not null then new.raw_user_meta_data ->> 'organization_id' end);
  if v_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select o.id into v_org_id from public.organizations o where o.id = v_org::uuid;
  end if;
  if v_org_id is null and new.email is not null then
    select i.organization_id into v_org_id from public.staff_invites i
     where i.email = lower(new.email) and i.accepted_at is null order by i.created_at limit 1;
    if v_org_id is not null then
      update public.staff_invites i set accepted_at = now() where i.email = lower(new.email) and i.organization_id = v_org_id;
    end if;
  end if;
  insert into public.user_profiles (id, organization_id, role, full_name)
  values (new.id, v_org_id, 'manager', left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;
