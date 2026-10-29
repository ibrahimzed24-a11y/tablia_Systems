-- Row level security checks for SOP 06 (roles and permissions) and SOP 11 (task visibility).
-- Tests admin, manager, front_desk and kitchen access per branch (Corniche, New Damietta).
-- Run against a LOCAL database after the migrations:  supabase start && supabase test db
-- Everything runs in one transaction and is rolled back: no test rows are left behind. Never run it against production.
begin;
set local role postgres; -- `supabase test db --linked` logs in as a non-inheriting role that cannot see the extensions schema
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(33);

-- Act as a staff member: the JWT claims Supabase sets for a signed-in user.
create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---- fixtures (inserted as the migration owner; RLS does not apply) ----
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-000000000001', 'rls-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000002', 'rls-manager-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000003', 'rls-manager-nd@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000004', 'rls-frontdesk-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000005', 'rls-frontdesk-nd@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000006', 'rls-kitchen-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000007', 'rls-inactive@test.invalid', 'authenticated', 'authenticated');
insert into public.staff (id, display_name, role, branch, active) values
  ('00000000-0000-4000-a000-000000000001', 'Test admin', 'admin', null, true),
  ('00000000-0000-4000-a000-000000000002', 'Test manager Corniche', 'manager', 'corniche', true),
  ('00000000-0000-4000-a000-000000000003', 'Test manager New Damietta', 'manager', 'new_damietta', true),
  ('00000000-0000-4000-a000-000000000004', 'Test front desk Corniche', 'front_desk', 'corniche', true),
  ('00000000-0000-4000-a000-000000000005', 'Test front desk New Damietta', 'front_desk', 'new_damietta', true),
  ('00000000-0000-4000-a000-000000000006', 'Test kitchen Corniche', 'kitchen', 'corniche', true),
  ('00000000-0000-4000-a000-000000000007', 'Test inactive front desk', 'front_desk', 'corniche', false);

insert into public.menu_sections (id, slug, name_ar) values ('00000000-0000-4000-b000-000000000001', 'rls-test', 'اختبار');
insert into public.menu_items (id, section_id, legacy_key, name_ar, price_egp) values
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-b000-000000000001', 'rls:test:001', 'صنف اختبار', 100);
insert into public.bookings (id, branch, booking_date, booking_time, guests, guest_name, guest_phone) values
  ('00000000-0000-4000-c000-000000000001', 'corniche', (now() at time zone 'Africa/Cairo')::date, '13:00', 4, 'Guest Corniche', '01000000001'),
  ('00000000-0000-4000-c000-000000000002', 'new_damietta', (now() at time zone 'Africa/Cairo')::date, '14:00', 2, 'Guest New Damietta', '01000000002');
insert into public.whatsapp_requests (id, branch, guest_name, guest_phone, message) values
  ('00000000-0000-4000-d000-000000000001', 'corniche', 'Guest Corniche', '01000000001', 'Table for 4'),
  ('00000000-0000-4000-d000-000000000002', 'new_damietta', 'Guest New Damietta', '01000000002', 'Table for 2');
insert into public.workflow_tasks (id, branch, title) values
  ('00000000-0000-4000-e000-000000000001', 'corniche', 'RLS test task Corniche'),
  ('00000000-0000-4000-e000-000000000002', 'new_damietta', 'RLS test task New Damietta');

create temp view t_bookings as select * from public.bookings where id::text like '00000000-0000-4000-c000-%';
create temp view t_wa as select * from public.whatsapp_requests where id::text like '00000000-0000-4000-d000-%';
create temp view t_tasks as select * from public.workflow_tasks where id::text like '00000000-0000-4000-e000-%';
grant select on t_bookings, t_wa, t_tasks to authenticated;
-- The views run with the caller's rights only if security_invoker is on (Postgres 15).
alter view t_bookings set (security_invoker = true);
alter view t_wa set (security_invoker = true);
alter view t_tasks set (security_invoker = true);

-- ---- admin: both branches ----
select pg_temp.act_as('00000000-0000-4000-a000-000000000001'); set local role authenticated;
select is((select count(*)::int from t_bookings), 2, 'admin sees bookings of both branches');
select is((select count(*)::int from t_wa), 2, 'admin sees WhatsApp requests of both branches');
select is((select count(*)::int from t_tasks), 2, 'admin sees tasks of both branches');
select ok((select count(*) from public.audit_log) > 0, 'admin reads the audit log');

-- ---- manager, Corniche ----
set local role postgres; select pg_temp.act_as('00000000-0000-4000-a000-000000000002'); set local role authenticated;
select is((select string_agg(branch::text, ',') from t_bookings), 'corniche', 'manager sees only own-branch bookings');
select is((select string_agg(branch::text, ',') from t_wa), 'corniche', 'manager sees only own-branch WhatsApp requests');
select is((select string_agg(branch::text, ',') from t_tasks), 'corniche', 'manager sees only own-branch tasks');
select throws_ok($$insert into public.bookings (branch, booking_date, booking_time, guests, guest_name) values ('new_damietta', current_date, '15:00', 2, 'X')$$,
  '42501', null, 'manager cannot create a booking at the other branch');
select lives_ok($$update public.menu_items set price_egp = 120 where id = '00000000-0000-4000-b000-000000000002'$$, 'manager can change a price');
select lives_ok($$delete from public.menu_items where id = '00000000-0000-4000-b000-000000000002'$$, 'manager delete runs but removes nothing (checked below)');
select is((select count(*)::int from public.audit_log), 0, 'manager cannot read the audit log');
select is((select count(*)::int from public.staff where id::text like '00000000-0000-4000-a000-%'), 7, 'manager reads the staff list');

-- ---- front desk, Corniche ----
set local role postgres; select pg_temp.act_as('00000000-0000-4000-a000-000000000004'); set local role authenticated;
select is((select guest_phone from t_bookings where branch = 'corniche'), '01000000001', 'front desk sees guest phone at own branch');
select is((select count(*)::int from t_bookings where branch = 'new_damietta'), 0, 'front desk does not see the other branch');
select lives_ok($$insert into public.bookings (id, branch, booking_date, booking_time, guests, guest_name) values ('00000000-0000-4000-c000-000000000003', 'corniche', current_date, '16:00', 3, 'Walk in')$$,
  'front desk can create an own-branch booking');
select throws_ok($$insert into public.bookings (branch, booking_date, booking_time, guests, guest_name) values ('new_damietta', current_date, '15:00', 2, 'X')$$,
  '42501', null, 'front desk cannot create a booking at the other branch');
select throws_ok($$select public.set_item_availability('00000000-0000-4000-b000-000000000002', false, null)$$,
  '42501', null, 'front desk cannot mark items sold out');
select lives_ok($$update public.menu_items set price_egp = 999 where id = '00000000-0000-4000-b000-000000000002'$$, 'front desk price update runs but changes nothing (checked below)');
select is((select count(*)::int from public.staff where id::text like '00000000-0000-4000-a000-%'), 1, 'front desk reads only its own staff row');
select isnt(public.covers_today('corniche'), null, 'front desk gets the covers count');

-- ---- kitchen, Corniche ----
set local role postgres; select pg_temp.act_as('00000000-0000-4000-a000-000000000006'); set local role authenticated;
select is((select count(*)::int from t_bookings), 0, 'kitchen cannot read bookings or guest phones');
select is((select count(*)::int from t_wa), 0, 'kitchen cannot read WhatsApp requests');
select ok(public.covers_today('corniche') >= 4, 'kitchen gets the covers count without guest details');
select lives_ok($$select public.set_item_availability('00000000-0000-4000-b000-000000000002', false, null)$$, 'kitchen can mark an item sold out');
select throws_ok($$insert into public.bookings (branch, booking_date, booking_time, guests, guest_name) values ('corniche', current_date, '15:00', 2, 'X')$$,
  '42501', null, 'kitchen cannot create bookings');
select is((select string_agg(branch::text, ',') from t_tasks), 'corniche', 'kitchen sees only own-branch tasks');
select is((select count(*)::int from public.menu_items where id = '00000000-0000-4000-b000-000000000002'), 1, 'kitchen reads the menu');

-- ---- inactive staff ----
set local role postgres; select pg_temp.act_as('00000000-0000-4000-a000-000000000007'); set local role authenticated;
select is((select count(*)::int from public.menu_items where id = '00000000-0000-4000-b000-000000000002'), 0, 'inactive staff read nothing');

-- ---- manager, New Damietta ----
set local role postgres; select pg_temp.act_as('00000000-0000-4000-a000-000000000003'); set local role authenticated;
select is((select string_agg(branch::text, ',') from t_bookings), 'new_damietta', 'New Damietta manager sees only New Damietta bookings');

-- ---- results, read as the owner ----
set local role postgres;
select is((select price_egp from public.menu_items where id = '00000000-0000-4000-b000-000000000002'), 120.00::numeric, 'price is the manager''s, not the front desk''s');
select is((select is_available from public.menu_items where id = '00000000-0000-4000-b000-000000000002'), false, 'kitchen sold-out flag was saved');
select is((select count(*)::int from public.menu_items where id = '00000000-0000-4000-b000-000000000002'), 1, 'manager could not delete the item');
select is((select count(*)::int from public.bookings where id = '00000000-0000-4000-c000-000000000003'), 1, 'front desk booking was saved');

select * from finish();
rollback;
