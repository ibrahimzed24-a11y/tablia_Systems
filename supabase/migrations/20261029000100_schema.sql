-- Mela Rossa admin: core schema. See docs/sops 02, 03, 04, 05, 06, 10.
create extension if not exists pgcrypto;
create schema if not exists app;

create type public.staff_role as enum ('admin', 'manager', 'front_desk', 'kitchen');
create type public.branch_code as enum ('corniche', 'new_damietta');
create type public.booking_status as enum ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show');
create type public.booking_source as enum ('phone', 'walk_in', 'whatsapp', 'website');
create type public.wa_status as enum ('new', 'replied', 'converted', 'closed');

create table public.branches (
  code public.branch_code primary key,
  name_en text not null,
  name_ar text not null,
  phone text not null
);
insert into public.branches values
  ('corniche', 'Nile Corniche', 'الكورنيش', '01280060772'),
  ('new_damietta', 'New Damietta', 'دمياط الجديدة', '01280060772');

create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.staff_role not null,
  branch public.branch_code,               -- null = both branches
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  label text not null,
  session_id uuid,
  provision_jti uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.staff (id)
);
create index staff_devices_session_idx on public.staff_devices (session_id);

create table public.provision_tokens (
  jti uuid primary key,
  display_name text not null,
  role public.staff_role not null,
  branch public.branch_code,
  device_label text not null,
  staff_id uuid references public.staff (id) on delete cascade,  -- set when adding a device for existing staff
  created_by uuid not null references public.staff (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text,
  name_ar text not null,
  branch public.branch_code,               -- null = both branches
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.menu_sections (id) on delete restrict,
  legacy_key text unique,
  group_ar text,
  group_en text,
  name_ar text not null check (char_length(name_ar) between 1 and 120),
  name_en text,
  description_ar text,
  description_en text,
  price_egp numeric(10, 2) check (price_egp is null or price_egp > 0),  -- null = ask for price
  is_available boolean not null default true,
  sold_out_until timestamptz,              -- null while sold out = no end date
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id) default auth.uid()
);
create index menu_items_section_idx on public.menu_items (section_id, sort);

create table public.whatsapp_requests (
  id uuid primary key default gen_random_uuid(),
  branch public.branch_code not null,
  guest_name text check (char_length(guest_name) <= 80),
  guest_phone text check (guest_phone ~ '^\+?[0-9]{8,15}$'),
  message text check (char_length(message) <= 2000),
  requested_date date,
  requested_time time,
  guests int check (guests between 1 and 40),
  status public.wa_status not null default 'new',
  close_reason text,
  booking_id uuid,
  reply_count int not null default 0,
  last_replied_at timestamptz,
  created_by uuid references public.staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  branch public.branch_code not null,
  booking_date date not null,
  booking_time time not null check (booking_time between '10:00' and '22:00'),
  guests int not null check (guests between 1 and 40),
  guest_name text not null check (char_length(guest_name) between 1 and 80),
  guest_phone text check (guest_phone ~ '^\+?[0-9]{8,15}$'),
  status public.booking_status not null default 'pending',
  source public.booking_source not null default 'phone',
  cancel_reason text,
  notes text check (char_length(notes) <= 300),
  whatsapp_request_id uuid references public.whatsapp_requests (id) on delete set null,
  created_by uuid references public.staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_branch_date_idx on public.bookings (branch, booking_date);
alter table public.whatsapp_requests
  add constraint whatsapp_requests_booking_fk foreign key (booking_id) references public.bookings (id) on delete set null;

create table public.whatsapp_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.whatsapp_requests (id) on delete cascade,
  staff_id uuid not null references public.staff (id) default auth.uid(),
  reason text,
  sent_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function app.audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (auth.uid(), tg_op, tg_table_name, coalesce(n ->> 'id', o ->> 'id'), o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['staff', 'menu_sections', 'menu_items', 'bookings', 'whatsapp_requests'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit()', t, t);
  end loop;
end $$;
