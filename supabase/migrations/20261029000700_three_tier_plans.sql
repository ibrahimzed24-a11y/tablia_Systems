-- Tablia Systems plans: three tiers, starter 3,999 EGP, growth 6,999 EGP, enterprise 10,000 EGP.
-- Replaces the two-value public.subscription_tier (growth, scale_matrix) without dropping any table or row:
-- a new enum is created, every column of the old type is converted (growth -> growth, scale_matrix -> enterprise),
-- and the old type (renamed subscription_tier_legacy) is removed only when nothing depends on it.
-- plan_limits is rewritten for the three tiers; menu item, guest profile, custom domain and manager seat limits
-- are enforced by triggers (no active subscription = starter); place_order and create_reservation check the plan;
-- has_feature() knows the new modules; get_my_plan() feeds the owner pages.
-- Paymob amounts map through plan_limits.price_amount_cents (piasters): 399900, 699900, 1000000.

create schema if not exists app;

-- ---- 1. the enum ----
do $$
declare c record; n_growth bigint; n_scale bigint;
begin
  if exists (select 1 from pg_enum e where e.enumtypid = to_regtype('public.subscription_tier') and e.enumlabel = 'scale_matrix') then
    alter type public.subscription_tier rename to subscription_tier_legacy;
    create type public.subscription_tier as enum ('starter', 'growth', 'enterprise');
    alter table public.subscriptions alter column tier drop default;
    for c in
      select a.attrelid::regclass as tbl, a.attname as col
        from pg_attribute a join pg_class r on r.oid = a.attrelid
       where a.atttypid = to_regtype('public.subscription_tier_legacy') and a.attnum > 0 and not a.attisdropped
         and r.relkind in ('r', 'p')
    loop
      execute format('select count(*) filter (where %1$I::text = ''growth''), count(*) filter (where %1$I::text = ''scale_matrix'') from %2$s',
                     c.col, c.tbl) into n_growth, n_scale;
      execute format('alter table %2$s alter column %1$I type public.subscription_tier using '
                     '(case %1$I::text when ''scale_matrix'' then ''enterprise'' else %1$I::text end)::public.subscription_tier',
                     c.col, c.tbl);
      raise notice 'subscription_tier converted in %.%: % growth -> growth, % scale_matrix -> enterprise', c.tbl, c.col, n_growth, n_scale;
    end loop;
  end if;
  if to_regtype('public.subscription_tier') is null then
    create type public.subscription_tier as enum ('starter', 'growth', 'enterprise');
  end if;
end $$;
alter table public.subscriptions alter column tier set default 'starter';

-- ---- 2. plan limits (null = unlimited) ----
alter table public.plan_limits
  add column if not exists max_menus int check (max_menus is null or max_menus >= 0),
  add column if not exists max_menu_items int check (max_menu_items is null or max_menu_items >= 0),
  add column if not exists max_guest_profiles int check (max_guest_profiles is null or max_guest_profiles >= 0),
  add column if not exists online_fee_bps int not null default 0 check (online_fee_bps between 0 and 10000),
  add column if not exists pickup_ordering boolean not null default true,
  add column if not exists table_reservations boolean not null default false,
  add column if not exists live_orders_feed boolean not null default false,
  add column if not exists event_ticketing boolean not null default false,
  add column if not exists daily_sales_logs boolean not null default true,
  add column if not exists historical_reporting boolean not null default false,
  add column if not exists multi_brand_menus boolean not null default false,
  add column if not exists advanced_tagging boolean not null default false;

insert into public.plan_limits as l (tier, price_amount_cents, max_custom_domains, max_manager_seats, advanced_analytics, export_reporting,
  max_menus, max_menu_items, max_guest_profiles, online_fee_bps, pickup_ordering, table_reservations, live_orders_feed,
  event_ticketing, daily_sales_logs, historical_reporting, multi_brand_menus, advanced_tagging) values
  ('starter',     399900,  1,  1, false, false, 1,    50,   500,  150, true, false, false, false, true, false, false, false),
  ('growth',      699900,  3,  3, false, false, null, null, null,  50, true, true,  true,  false, true, false, false, false),
  ('enterprise', 1000000, 10, 10, true,  true,  null, null, null,   0, true, true,  true,  true,  true, true,  true,  true)
on conflict (tier) do update set
  price_amount_cents = excluded.price_amount_cents, max_custom_domains = excluded.max_custom_domains,
  max_manager_seats = excluded.max_manager_seats, advanced_analytics = excluded.advanced_analytics,
  export_reporting = excluded.export_reporting, max_menus = excluded.max_menus, max_menu_items = excluded.max_menu_items,
  max_guest_profiles = excluded.max_guest_profiles, online_fee_bps = excluded.online_fee_bps,
  pickup_ordering = excluded.pickup_ordering, table_reservations = excluded.table_reservations,
  live_orders_feed = excluded.live_orders_feed, event_ticketing = excluded.event_ticketing,
  daily_sales_logs = excluded.daily_sales_logs, historical_reporting = excluded.historical_reporting,
  multi_brand_menus = excluded.multi_brand_menus, advanced_tagging = excluded.advanced_tagging;

-- ---- 3. tier, plan and feature gate ----
-- org_tier returned the old type, so it is recreated; anything but a running active subscription is starter.
drop function if exists app.org_tier(uuid);
create function app.org_tier(p_org uuid) returns public.subscription_tier
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.tier from public.subscriptions s
      where s.organization_id = p_org and s.status = 'active'
        and (s.current_period_end is null or s.current_period_end > now())),
    'starter'::public.subscription_tier)
$$;

create or replace function app.org_plan(p_org uuid) returns public.plan_limits
language sql stable security definer set search_path = '' as $$
  select l.* from public.plan_limits l where l.tier = app.org_tier(p_org)
$$;

-- Features: the plan_limits switches, unlimited_menus / unlimited_guest_profiles, and the older
-- advanced_analytics / export_reporting. An unknown name is an error, not a silent false.
create or replace function app.org_has_feature(p_org uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare l public.plan_limits;
begin
  if p_feature is null or p_feature <> all (array['pickup_ordering', 'table_reservations', 'live_orders_feed', 'event_ticketing',
      'daily_sales_logs', 'historical_reporting', 'multi_brand_menus', 'advanced_tagging', 'unlimited_menus',
      'unlimited_guest_profiles', 'advanced_analytics', 'export_reporting']) then
    raise exception 'unknown feature %', p_feature using errcode = '22023';
  end if;
  if p_org is null then return false; end if;
  l := app.org_plan(p_org);
  return case p_feature
    when 'unlimited_menus' then l.max_menu_items is null
    when 'unlimited_guest_profiles' then l.max_guest_profiles is null
    else coalesce((to_jsonb(l) ->> p_feature)::boolean, false)
  end;
end $$;

create or replace function app.require_feature(p_org uuid, p_feature text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.org_has_feature(p_org, p_feature) then
    raise exception 'plan_feature_locked: %', p_feature using errcode = 'P0001',
      hint = format('The %s plan does not include %s. Upgrade to unlock it.', app.org_tier(p_org), p_feature);
  end if;
end $$;

-- The signed-in owner's plan with its current usage, for the owner pages.
create or replace function public.get_my_plan() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.get_auth_organization();
begin
  if v_org is null then return null; end if;
  return to_jsonb(app.org_plan(v_org)) || jsonb_build_object('usage', jsonb_build_object(
    'menu_items', (select count(*) from public.menu_items i join public.menu_sections s on s.id = i.section_id where s.organization_id = v_org),
    'guest_profiles', (select count(*) from public.crm_customers c where c.organization_id = v_org),
    'custom_domains', (select count(*) from public.custom_domains d where d.organization_id = v_org and d.status <> 'removed'),
    'manager_seats', (select count(*) from public.user_profiles p where p.organization_id = v_org and p.role = 'manager')));
end $$;

-- ---- 4. limits ----
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
      using errcode = 'P0001', hint = 'Growth allows 3 custom domains, Enterprise 10.';
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
      using errcode = 'P0001', hint = 'Growth allows 3 manager seats, Enterprise 10.';
  end if;
  return new;
end $$;

-- Menu items of tenant sections (pilot sections without an organization are not limited). Existing rows stay.
create or replace function app.enforce_menu_item_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; lim int; used int;
begin
  select s.organization_id into v_org from public.menu_sections s where s.id = new.section_id;
  if v_org is null then return new; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.menu_sections s where s.id = old.section_id and s.organization_id = v_org) then
    return new;
  end if;
  lim := (app.org_plan(v_org)).max_menu_items;
  if lim is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('tenant_menu_items:' || v_org::text));
  select count(*) into used from public.menu_items i join public.menu_sections s on s.id = i.section_id
   where s.organization_id = v_org and i.id is distinct from new.id;
  if used >= lim then
    raise exception 'menu item limit reached: % of % on the % plan', used, lim, app.org_tier(v_org)
      using errcode = 'P0001', hint = 'Growth and Enterprise have unlimited menu items.';
  end if;
  return new;
end $$;

-- Guest profiles (crm_customers). An upsert of a guest already on file is not a new profile.
create or replace function app.enforce_guest_profile_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; used int;
begin
  if tg_op = 'UPDATE' and old.organization_id = new.organization_id then return new; end if;
  lim := (app.org_plan(new.organization_id)).max_guest_profiles;
  if lim is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('tenant_guests:' || new.organization_id::text));
  if tg_op = 'INSERT' and exists (select 1 from public.crm_customers c
                                   where c.organization_id = new.organization_id and c.email = new.email) then
    return new;
  end if;
  select count(*) into used from public.crm_customers c where c.organization_id = new.organization_id and c.id <> new.id;
  if used >= lim then
    raise exception 'guest profile limit reached: % of % on the % plan', used, lim, app.org_tier(new.organization_id)
      using errcode = 'P0001', hint = 'Growth and Enterprise have unlimited guest profiles.';
  end if;
  return new;
end $$;

drop trigger if exists menu_items_plan_limit on public.menu_items;
create trigger menu_items_plan_limit before insert or update of section_id on public.menu_items
  for each row execute function app.enforce_menu_item_limit();
drop trigger if exists crm_customers_plan_limit on public.crm_customers;
create trigger crm_customers_plan_limit before insert or update of organization_id on public.crm_customers
  for each row execute function app.enforce_guest_profile_limit();

-- ---- 5. ordering and reservations, gated by plan ----
-- Starter takes pickup (takeaway) orders only; dine-in and delivery come with Growth and Enterprise.
create or replace function public.place_order(
  p_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_transaction_type public.transaction_type default 'takeaway',
  p_payment_method public.payment_method default 'cash',
  p_notes text default null,
  p_table_label text default null,
  p_delivery_address text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app.tenant_by_slug(p_slug);
  v_customer uuid;
  v_wanted int;
  v_found int;
  v_lines jsonb;
  v_total bigint;
  v_order public.orders;
begin
  perform app.require_feature(v_org, 'pickup_ordering');
  if p_transaction_type <> 'takeaway' and not app.org_has_feature(v_org, 'table_reservations') then
    raise exception 'plan_feature_locked: pickup_only' using errcode = 'P0001',
      hint = 'The starter plan takes pickup orders only. Upgrade to Growth for dine-in and delivery.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50
     or exists (
       select 1 from jsonb_array_elements(p_items) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or coalesce(e ->> 'quantity', '') !~ '^[0-9]{1,2}$'
           or case when coalesce(e ->> 'quantity', '') ~ '^[0-9]{1,2}$'
                   then (e ->> 'quantity')::int not between 1 and 50 else true end) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if p_transaction_type = 'delivery' and nullif(btrim(coalesce(p_delivery_address, '')), '') is null then
    raise exception 'delivery_address_required' using errcode = '22023';
  end if;

  with req as (
    select (e ->> 'item_id')::uuid as item_id, sum((e ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) e
     group by 1
  ), priced as (
    select r.item_id, r.qty, i.name_ar, i.name_en, round(i.price_egp * 100)::int as unit, i.sort, s.sort as ssort
      from req r
      join public.menu_items i on i.id = r.item_id
      join public.menu_sections s on s.id = i.section_id
     where s.organization_id = v_org
       and i.price_egp is not null
       and (i.is_available or (i.sold_out_until is not null and i.sold_out_until <= now()))
  )
  select (select count(*) from req), count(*),
         jsonb_agg(jsonb_build_object('item_id', item_id, 'name_ar', name_ar, 'name_en', name_en, 'quantity', qty,
                                      'unit_piasters', unit, 'line_piasters', unit * qty) order by ssort, sort),
         sum(unit * qty)
    into v_wanted, v_found, v_lines, v_total
    from priced;

  if v_found <> v_wanted then
    raise exception 'item_unavailable' using errcode = 'P0001';
  end if;
  if v_total > 2147483647 then
    raise exception 'order_too_large' using errcode = '22003';
  end if;

  v_customer := app.upsert_crm_customer(v_org, p_customer);

  insert into public.orders (organization_id, customer_id, transaction_type, payment_method, items,
                             subtotal_piasters, total_piasters, table_label, delivery_address, notes)
  values (v_org, v_customer, p_transaction_type, p_payment_method, v_lines, v_total, v_total,
          nullif(left(btrim(coalesce(p_table_label, '')), 20), ''),
          case when p_transaction_type = 'delivery' then left(btrim(p_delivery_address), 300) end,
          nullif(left(btrim(coalesce(p_notes, '')), 500), ''))
  returning * into v_order;

  update public.crm_customers
     set orders_count = orders_count + 1, total_ordered_piasters = total_ordered_piasters + v_total, last_seen_at = now()
   where id = v_customer;

  return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'items', v_order.items,
                            'total_piasters', v_order.total_piasters, 'currency', v_order.currency,
                            'payment_method', v_order.payment_method, 'payment_status', v_order.payment_status);
end $$;

-- Table reservations need Growth; a reservation for an event (event ticketing) needs Enterprise.
create or replace function public.create_reservation(
  p_slug text,
  p_customer jsonb,
  p_reserved_for timestamptz,
  p_party_size int,
  p_event_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app.tenant_by_slug(p_slug);
  v_customer uuid;
  v_event public.restaurant_events;
  v_taken int;
  v_when timestamptz := p_reserved_for;
  v_res public.reservations;
begin
  perform app.require_feature(v_org, 'table_reservations');
  if p_event_id is not null then
    perform app.require_feature(v_org, 'event_ticketing');
  end if;
  if p_party_size is null or p_party_size not between 1 and 40 then
    raise exception 'invalid_party_size' using errcode = '22023';
  end if;
  if p_event_id is not null then
    select * into v_event from public.restaurant_events e
     where e.id = p_event_id and e.organization_id = v_org and e.is_published
       and coalesce(e.ends_at, e.starts_at) > now()
     for update;
    if v_event.id is null then
      raise exception 'event_not_found' using errcode = 'P0002';
    end if;
    v_when := coalesce(v_when, v_event.starts_at);
    if v_event.capacity is not null then
      select coalesce(sum(r.party_size), 0) into v_taken from public.reservations r
       where r.event_id = v_event.id and r.status not in ('cancelled', 'no_show');
      if v_taken + p_party_size > v_event.capacity then
        raise exception 'event_full' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if v_when is null or v_when < now() - interval '5 minutes' or v_when > now() + interval '180 days' then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  v_customer := app.upsert_crm_customer(v_org, p_customer);

  insert into public.reservations (organization_id, customer_id, event_id, reserved_for, party_size, notes)
  values (v_org, v_customer, v_event.id, v_when, p_party_size, nullif(left(btrim(coalesce(p_notes, '')), 300), ''))
  returning * into v_res;

  update public.crm_customers
     set reservations_count = reservations_count + 1, last_seen_at = now()
   where id = v_customer;

  return jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status,
                            'reserved_for', v_res.reserved_for, 'party_size', v_res.party_size);
end $$;

-- ---- 6. grants ----
revoke execute on function app.org_tier(uuid), app.org_plan(uuid), app.org_has_feature(uuid, text), app.require_feature(uuid, text),
  app.enforce_domain_limit(), app.enforce_seat_limit(), app.enforce_menu_item_limit(), app.enforce_guest_profile_limit()
  from public, anon, authenticated;
revoke execute on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated, service_role;

-- ---- 7. the old type goes only when nothing depends on it ----
do $$
begin
  if to_regtype('public.subscription_tier_legacy') is not null then
    begin
      drop type public.subscription_tier_legacy;
      raise notice 'old subscription_tier type removed';
    exception when dependent_objects_still_exist then
      raise notice 'old subscription_tier type kept as subscription_tier_legacy: other objects still depend on it';
    end;
  end if;
end $$;
