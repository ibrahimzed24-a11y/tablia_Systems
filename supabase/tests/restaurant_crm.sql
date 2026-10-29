-- Checks for 20261029000600_restaurant_crm_orders: RLS on every new table, anon cannot write tables,
-- place_order prices on the server and upserts the CRM customer, create_reservation respects event capacity,
-- and a tenant user sees only their own organization. Everything is rolled back.
begin;
set local role postgres; -- `supabase test db --linked` logs in as a non-inheriting role that cannot see the extensions schema
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set search_path = extensions, public;
select * from no_plan();

-- ---- structure ----
select ok((select bool_and(c.relrowsecurity) from pg_class c
            where c.oid in ('public.restaurant_events'::regclass, 'public.crm_customers'::regclass,
                            'public.orders'::regclass, 'public.reservations'::regclass)), 'RLS is on for every new table');
select ok((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
             from pg_proc p where p.proname in ('place_order', 'create_reservation', 'get_public_storefront')
              and p.pronamespace = 'public'::regnamespace), 'public functions are security definer with a fixed search_path');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.payment_method'::regtype),
          array['cash', 'paymob'], 'payment methods are cash and paymob only');
select ok(not has_table_privilege('anon', 'public.orders', 'INSERT'), 'anon has no insert on orders');
select ok(not has_table_privilege('anon', 'public.crm_customers', 'SELECT'), 'anon has no select on crm_customers');

-- ---- fixtures ----
insert into public.organizations (id, name, slug) values
  ('00000000-0000-4000-f000-000000000001', 'Test tenant one', 'test-one'),
  ('00000000-0000-4000-f000-000000000002', 'Test tenant two', 'test-two');
-- Both test tenants are on Enterprise so dine-in, reservations and event tickets are open (plans: tenant_subscriptions.sql).
insert into public.subscriptions (organization_id, tier, status) values
  ('00000000-0000-4000-f000-000000000001', 'enterprise', 'active'),
  ('00000000-0000-4000-f000-000000000002', 'enterprise', 'active');
insert into public.menu_sections (id, slug, name_ar, organization_id) values
  ('00000000-0000-4000-f100-000000000001', 'test-one-food', 'أكل', '00000000-0000-4000-f000-000000000001'),
  ('00000000-0000-4000-f100-000000000002', 'test-two-food', 'أكل', '00000000-0000-4000-f000-000000000002');
insert into public.menu_items (id, section_id, name_ar, price_egp, is_available, updated_by) values
  ('00000000-0000-4000-f200-000000000001', '00000000-0000-4000-f100-000000000001', 'بيتزا', 120.50, true, null),
  ('00000000-0000-4000-f200-000000000002', '00000000-0000-4000-f100-000000000001', 'قهوة', 45, false, null),
  ('00000000-0000-4000-f200-000000000003', '00000000-0000-4000-f100-000000000002', 'برجر', 99, true, null);
insert into public.restaurant_events (id, organization_id, title_en, starts_at, capacity, is_published) values
  ('00000000-0000-4000-f300-000000000001', '00000000-0000-4000-f000-000000000001', 'Jazz night', now() + interval '3 days', 4, true);

-- ---- anonymous visitor ----
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$insert into public.orders (organization_id, customer_id, items, subtotal_piasters, total_piasters)
                   values ('00000000-0000-4000-f000-000000000001', gen_random_uuid(), '[{}]', 1, 1)$$,
                 '42501', null, 'anon cannot insert an order directly');
select throws_ok($$select * from public.crm_customers$$, '42501', null, 'anon cannot read customers');

select is((public.place_order('test-one', '{"email":"Guest@Example.com","name":"Guest","phone":"01000000000"}',
            '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":2,"price":1,"unit_piasters":1}]') ->> 'total_piasters')::int,
          24100, 'place_order ignores client prices: 2 x 120.50 EGP = 24100 piasters');
select is((public.place_order('test-one', '{"email":"guest@example.com","name":"Someone else"}',
            '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":1}]',
            'dine_in', 'paymob') ->> 'payment_method'), 'paymob', 'paymob is accepted');
select throws_ok($$select public.place_order('test-one', '{"email":"x@example.com"}', '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":1}]', 'takeaway', 'stripe')$$,
                 '22P02', null, 'stripe is not a payment method');
select throws_ok($$select public.place_order('test-one', '{"email":"x@example.com"}', '[{"item_id":"00000000-0000-4000-f200-000000000003","quantity":1}]')$$,
                 'P0001', 'item_unavailable', 'another tenant''s item cannot be ordered');
select throws_ok($$select public.place_order('test-one', '{"email":"x@example.com"}', '[{"item_id":"00000000-0000-4000-f200-000000000002","quantity":1}]')$$,
                 'P0001', 'item_unavailable', 'a sold out item cannot be ordered');
select throws_ok($$select public.place_order('test-one', '{"email":"x@example.com"}', '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":0}]')$$,
                 '22023', 'invalid_items', 'quantity must be 1 to 50');
select throws_ok($$select public.place_order('nope', '{"email":"x@example.com"}', '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":1}]')$$,
                 'P0002', 'tenant_not_found', 'unknown subdomain is refused');
select throws_ok($$select public.place_order('test-one', '{"email":"not-an-email"}', '[{"item_id":"00000000-0000-4000-f200-000000000001","quantity":1}]')$$,
                 '22023', 'invalid_email', 'an email is required');

select is((public.create_reservation('test-one', '{"email":"guest@example.com"}', null, 3,
            '00000000-0000-4000-f300-000000000001') ->> 'status'), 'pending', 'a reservation starts pending');
select throws_ok($$select public.create_reservation('test-one', '{"email":"b@example.com"}', null, 2, '00000000-0000-4000-f300-000000000001')$$,
                 'P0001', 'event_full', 'event capacity is enforced');
select ok((public.get_public_storefront('test-one') -> 'sections') is not null, 'the storefront is readable by anon');

set local role postgres;

-- ---- CRM upsert ----
select is((select count(*)::int from public.crm_customers where organization_id = '00000000-0000-4000-f000-000000000001' and email = 'guest@example.com'),
          1, 'one customer per tenant and email');
select is((select row(full_name, orders_count, reservations_count, total_ordered_piasters)::text from public.crm_customers
            where organization_id = '00000000-0000-4000-f000-000000000001' and email = 'guest@example.com'),
          '(Guest,2,1,36150)', 'name kept, counters and totals updated');

-- ---- tenant isolation ----
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-f400-000000000001', 'owner-two@example.com', 'authenticated', 'authenticated');
insert into public.user_profiles (id, organization_id, role)
values ('00000000-0000-4000-f400-000000000001', '00000000-0000-4000-f000-000000000002', 'tenant_admin')
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f400-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.orders), 0, 'tenant two sees none of tenant one''s orders');
select is((select count(*)::int from public.crm_customers), 0, 'tenant two sees none of tenant one''s customers');
select throws_ok($$insert into public.restaurant_events (organization_id, title_en, starts_at) values ('00000000-0000-4000-f000-000000000001', 'x', now() + interval '1 day')$$,
                 '42501', null, 'tenant two cannot write into tenant one');
select lives_ok($$insert into public.restaurant_events (organization_id, title_en, starts_at) values ('00000000-0000-4000-f000-000000000002', 'Own event', now() + interval '1 day')$$,
                'tenant two writes its own events');
set local role postgres;

select * from finish();
rollback;
