-- Tablia Systems restaurant CRM: events, CRM customers, orders and reservations per tenant.
-- Additive only. The tenant is public.organizations (organization_id) from 20261029000500, the menu stays in
-- public.menu_sections / public.menu_items, reservations reuse public.booking_status, and tenant RLS uses
-- public.get_auth_organization(). Nothing is dropped or recreated.
-- Money is integer piasters (1 EGP = 100), currency EGP only. Payment methods: cash and paymob.
-- Anonymous visitors never write a table: they call place_order and create_reservation (security definer,
-- fixed search_path), which find the tenant by its subdomain slug and read prices from menu_items.

create extension if not exists pgcrypto;
create schema if not exists app;

do $$
begin
  if to_regtype('public.order_status') is null then
    create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled');
  end if;
  if to_regtype('public.transaction_type') is null then
    create type public.transaction_type as enum ('dine_in', 'takeaway', 'delivery');
  end if;
  if to_regtype('public.payment_method') is null then
    create type public.payment_method as enum ('cash', 'paymob');
  end if;
  if to_regtype('public.payment_status') is null then
    create type public.payment_status as enum ('unpaid', 'paid', 'failed', 'refunded');
  end if;
  if to_regtype('public.booking_status') is null then
    create type public.booking_status as enum ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show');
  end if;
end $$;

-- ---- tenant subdomain: <slug>.<root domain> ----
alter table public.organizations add column if not exists slug text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_slug_format') then
    alter table public.organizations add constraint organizations_slug_format check (
      slug is null or (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
                       and slug not in ('www', 'app', 'admin', 'api', 'owner', 'staff')));
  end if;
end $$;
create unique index if not exists organizations_slug_key on public.organizations (slug);

-- ---- the existing menu belongs to a tenant ----
alter table public.menu_sections add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
create index if not exists menu_sections_org_idx on public.menu_sections (organization_id, sort);

-- Mela Rossa is the first tenant: the seeded menu (sections without a tenant) is attached to it.
insert into public.organizations (name, slug)
select 'Mela Rossa', 'mela-rossa'
where not exists (select 1 from public.organizations where slug = 'mela-rossa');
update public.menu_sections
   set organization_id = (select id from public.organizations where slug = 'mela-rossa')
 where organization_id is null;

-- ---- events ----
create table if not exists public.restaurant_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title_en text check (char_length(title_en) <= 160),
  title_ar text check (char_length(title_ar) <= 160),
  description_en text check (char_length(description_en) <= 2000),
  description_ar text check (char_length(description_ar) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity int check (capacity is null or capacity between 1 and 5000),
  price_piasters int not null default 0 check (price_piasters >= 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_events_title_check check (coalesce(nullif(btrim(title_en), ''), nullif(btrim(title_ar), '')) is not null),
  constraint restaurant_events_time_check check (ends_at is null or ends_at > starts_at),
  constraint restaurant_events_id_org_key unique (id, organization_id)
);
create index if not exists restaurant_events_org_starts_idx on public.restaurant_events (organization_id, starts_at);

-- ---- CRM customers: one row per tenant and email ----
create table if not exists public.crm_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone is null or phone ~ '^\+?[0-9]{8,15}$'),
  preferred_lang text not null default 'ar' check (preferred_lang in ('ar', 'en')),
  notes text check (char_length(notes) <= 2000),
  orders_count int not null default 0 check (orders_count >= 0),
  reservations_count int not null default 0 check (reservations_count >= 0),
  total_ordered_piasters bigint not null default 0 check (total_ordered_piasters >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_customers_org_email_key unique (organization_id, email),
  constraint crm_customers_id_org_key unique (id, organization_id)
);

-- ---- orders: lines are a server-priced snapshot ----
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  status public.order_status not null default 'pending',
  transaction_type public.transaction_type not null default 'takeaway',
  payment_method public.payment_method not null default 'cash',
  payment_status public.payment_status not null default 'unpaid',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  subtotal_piasters int not null check (subtotal_piasters >= 0),
  total_piasters int not null check (total_piasters >= 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  table_label text check (char_length(table_label) <= 20),
  delivery_address text check (char_length(delivery_address) <= 300),
  notes text check (char_length(notes) <= 500),
  paymob_order_id text check (char_length(paymob_order_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_customer_fk foreign key (customer_id, organization_id)
    references public.crm_customers (id, organization_id) on delete restrict,
  constraint orders_delivery_address_check check (transaction_type <> 'delivery' or delivery_address is not null)
);
create index if not exists orders_org_created_idx on public.orders (organization_id, created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id);

-- ---- reservations ----
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  event_id uuid,
  reserved_for timestamptz not null,
  party_size int not null check (party_size between 1 and 40),
  status public.booking_status not null default 'pending',
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_customer_fk foreign key (customer_id, organization_id)
    references public.crm_customers (id, organization_id) on delete restrict,
  constraint reservations_event_fk foreign key (event_id, organization_id)
    references public.restaurant_events (id, organization_id) on delete set null (event_id)
);
create index if not exists reservations_org_time_idx on public.reservations (organization_id, reserved_for);
create index if not exists reservations_event_idx on public.reservations (event_id) where event_id is not null;

-- ---- updated_at ----
do $$
declare t text;
begin
  foreach t in array array['restaurant_events', 'crm_customers', 'orders', 'reservations'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- An owner may move an order through its status and mark a cash order paid, never reprice it.
-- A Paymob order's payment status is written only by the payment webhook (service role, no auth.uid()).
create or replace function app.orders_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.organization_id := old.organization_id;
    new.customer_id := old.customer_id;
    new.items := old.items;
    new.subtotal_piasters := old.subtotal_piasters;
    new.total_piasters := old.total_piasters;
    new.currency := old.currency;
    new.payment_method := old.payment_method;
    new.paymob_order_id := old.paymob_order_id;
    new.created_at := old.created_at;
    if old.payment_method = 'paymob' then
      new.payment_status := old.payment_status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update on public.orders for each row execute function app.orders_guard();

-- ---- row level security: a signed-in tenant user touches only their own organization ----
alter table public.restaurant_events enable row level security;
alter table public.crm_customers enable row level security;
alter table public.orders enable row level security;
alter table public.reservations enable row level security;

revoke all on public.restaurant_events, public.crm_customers, public.orders, public.reservations from anon;
grant select, insert, update, delete on public.restaurant_events, public.crm_customers, public.orders, public.reservations to authenticated;

drop policy if exists tenant_events_all on public.restaurant_events;
create policy tenant_events_all on public.restaurant_events for all to authenticated
  using (organization_id = (select public.get_auth_organization()))
  with check (organization_id = (select public.get_auth_organization()));

drop policy if exists tenant_customers_read on public.crm_customers;
create policy tenant_customers_read on public.crm_customers for select to authenticated
  using (organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_customers_insert on public.crm_customers;
create policy tenant_customers_insert on public.crm_customers for insert to authenticated
  with check (organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_customers_update on public.crm_customers;
create policy tenant_customers_update on public.crm_customers for update to authenticated
  using (organization_id = (select public.get_auth_organization()))
  with check (organization_id = (select public.get_auth_organization()));

-- Orders are created only by place_order. Owners read them and update the status.
drop policy if exists tenant_orders_read on public.orders;
create policy tenant_orders_read on public.orders for select to authenticated
  using (organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_orders_update on public.orders;
create policy tenant_orders_update on public.orders for update to authenticated
  using (organization_id = (select public.get_auth_organization()))
  with check (organization_id = (select public.get_auth_organization()));

drop policy if exists tenant_reservations_read on public.reservations;
create policy tenant_reservations_read on public.reservations for select to authenticated
  using (organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_reservations_insert on public.reservations;
create policy tenant_reservations_insert on public.reservations for insert to authenticated
  with check (organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_reservations_update on public.reservations;
create policy tenant_reservations_update on public.reservations for update to authenticated
  using (organization_id = (select public.get_auth_organization()))
  with check (organization_id = (select public.get_auth_organization()));

-- Tenant owners manage their own menu. These policies sit beside the staff policies of 20261029000200.
-- menu_items.updated_by references public.staff, so owner pages write it as null.
drop policy if exists tenant_sections_all on public.menu_sections;
create policy tenant_sections_all on public.menu_sections for all to authenticated
  using (organization_id is not null and organization_id = (select public.get_auth_organization()))
  with check (organization_id is not null and organization_id = (select public.get_auth_organization()));
drop policy if exists tenant_items_all on public.menu_items;
create policy tenant_items_all on public.menu_items for all to authenticated
  using (exists (select 1 from public.menu_sections s
                  where s.id = section_id and s.organization_id = (select public.get_auth_organization())))
  with check (exists (select 1 from public.menu_sections s
                       where s.id = section_id and s.organization_id = (select public.get_auth_organization())));

-- ---- public functions ----
create or replace function app.tenant_by_slug(p_slug text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select o.id into v from public.organizations o where o.slug = lower(btrim(coalesce(p_slug, '')));
  if v is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Creates or refreshes the tenant's customer by email. Name and phone already on file are never
-- overwritten by a public form, so nobody can rewrite another guest's details by typing their email.
create or replace function app.upsert_crm_customer(p_org uuid, p_customer jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_customer ->> 'email', '')));
  v_phone text := nullif(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[[:space:]-]', '', 'g'), '');
  v_name text := nullif(left(btrim(coalesce(p_customer ->> 'name', '')), 120), '');
  v_lang text := case when p_customer ->> 'lang' = 'en' then 'en' else 'ar' end;
  v_id uuid;
begin
  if p_customer is null or jsonb_typeof(p_customer) <> 'object'
     or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  insert into public.crm_customers as c (organization_id, email, full_name, phone, preferred_lang)
  values (p_org, v_email, v_name, v_phone, v_lang)
  on conflict (organization_id, email) do update
    set full_name = coalesce(c.full_name, excluded.full_name),
        phone = coalesce(c.phone, excluded.phone),
        last_seen_at = now()
  returning c.id into v_id;
  return v_id;
end $$;

-- p_items: [{"item_id": "<menu_items.id>", "quantity": 2}, ...]. Any price sent by the client is ignored.
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

-- What the public mobile page shows: the tenant, its menu with server prices, upcoming published events.
create or replace function public.get_public_storefront(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := app.tenant_by_slug(p_slug);
begin
  return jsonb_build_object(
    'organization', (select jsonb_build_object('name', o.name, 'slug', o.slug) from public.organizations o where o.id = v_org),
    'currency', 'EGP',
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en,
                          'description_ar', i.description_ar, 'description_en', i.description_en,
                          'group_ar', i.group_ar, 'group_en', i.group_en,
                          'price_piasters', case when i.price_egp is null then null else round(i.price_egp * 100)::int end,
                          'available', (i.is_available or (i.sold_out_until is not null and i.sold_out_until <= now())))
                          order by i.sort)
                   from public.menu_items i where i.section_id = s.id), '[]'::jsonb))
             order by s.sort)
        from public.menu_sections s where s.organization_id = v_org), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'title_ar', e.title_ar, 'title_en', e.title_en,
               'description_ar', e.description_ar, 'description_en', e.description_en,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'price_piasters', e.price_piasters,
               'capacity', e.capacity) order by e.starts_at)
        from public.restaurant_events e
       where e.organization_id = v_org and e.is_published and coalesce(e.ends_at, e.starts_at) > now()), '[]'::jsonb));
end $$;

revoke execute on function app.orders_guard(), app.tenant_by_slug(text), app.upsert_crm_customer(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.place_order(text, jsonb, jsonb, public.transaction_type, public.payment_method, text, text, text),
  public.create_reservation(text, jsonb, timestamptz, int, uuid, text), public.get_public_storefront(text) from public;
grant execute on function public.place_order(text, jsonb, jsonb, public.transaction_type, public.payment_method, text, text, text),
  public.create_reservation(text, jsonb, timestamptz, int, uuid, text), public.get_public_storefront(text) to anon, authenticated, service_role;
