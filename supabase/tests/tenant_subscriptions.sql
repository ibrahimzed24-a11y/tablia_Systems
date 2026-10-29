-- Checks for the three plans (20261029000500 tenancy + 20261029000700 three tiers): enum, prices and limits,
-- domain, seat, menu item and guest profile limits per tier, the feature gate, gated place_order and
-- create_reservation, tenant RLS, the signup profile trigger and the idempotent Paymob payment function.
-- Everything runs in one transaction and is rolled back: no test rows are left behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select * from no_plan();

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---- enum and plans ----
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.subscription_tier'::regtype),
          array['starter', 'growth', 'enterprise'], 'subscription_tier is starter, growth, enterprise');
select ok(to_regtype('public.subscription_tier_legacy') is null, 'the old two-value type is gone');
select is((select array_agg(price_amount_cents order by price_amount_cents) from public.plan_limits), array[399900, 699900, 1000000],
          'prices: 3,999, 6,999 and 10,000 EGP');
select is((select array[max_menus, max_menu_items, max_guest_profiles, online_fee_bps, max_custom_domains, max_manager_seats]
             from public.plan_limits where tier = 'starter'), array[1, 50, 500, 150, 1, 1], 'starter: 1 menu, 50 items, 500 guests, 1.5%, 1 domain, 1 seat');
select is((select array[coalesce(max_menu_items, -1), coalesce(max_guest_profiles, -1), online_fee_bps, max_custom_domains, max_manager_seats]
             from public.plan_limits where tier = 'growth'), array[-1, -1, 50, 3, 3], 'growth: unlimited, 0.5%, 3 domains, 3 seats');
select is((select array[coalesce(max_menu_items, -1), coalesce(max_guest_profiles, -1), online_fee_bps, max_custom_domains, max_manager_seats]
             from public.plan_limits where tier = 'enterprise'), array[-1, -1, 0, 10, 10], 'enterprise: unlimited, 0%, 10 domains, 10 seats');

-- ---- fixtures: one organization per tier, one without a subscription ----
insert into public.organizations (id, name, slug) values
  ('00000000-0000-4000-e000-000000000001', 'Test starter org', 'tier-starter'),
  ('00000000-0000-4000-e000-000000000002', 'Test growth org', 'tier-growth'),
  ('00000000-0000-4000-e000-000000000003', 'Test enterprise org', 'tier-enterprise'),
  ('00000000-0000-4000-e000-000000000004', 'Test org without subscription', 'tier-none');
insert into public.subscriptions (organization_id, tier, status, current_period_start, current_period_end) values
  ('00000000-0000-4000-e000-000000000001', 'starter', 'active', now(), now() + interval '1 month'),
  ('00000000-0000-4000-e000-000000000002', 'growth', 'active', now(), now() + interval '1 month'),
  ('00000000-0000-4000-e000-000000000003', 'enterprise', 'active', now(), now() + interval '1 month');
insert into public.menu_sections (id, slug, name_ar, organization_id)
  select ('00000000-0000-4000-e100-00000000000' || g)::uuid, 'tier-test-' || g, 'أكل', ('00000000-0000-4000-e000-00000000000' || g)::uuid
    from generate_series(1, 4) g;
insert into public.menu_items (id, section_id, name_ar, price_egp, is_available, updated_by)
  select ('00000000-0000-4000-e200-00000000000' || g)::uuid, ('00000000-0000-4000-e100-00000000000' || g)::uuid, 'بيتزا', 100, true, null
    from generate_series(1, 4) g;
insert into public.restaurant_events (id, organization_id, title_en, starts_at, capacity, is_published)
  select ('00000000-0000-4000-e300-00000000000' || g)::uuid, ('00000000-0000-4000-e000-00000000000' || g)::uuid, 'Night', now() + interval '3 days', 10, true
    from generate_series(1, 3) g;

select is(app.org_tier('00000000-0000-4000-e000-000000000004'), 'starter'::public.subscription_tier, 'missing subscription counts as starter');

-- ---- feature gate ----
select is(array[app.org_has_feature('00000000-0000-4000-e000-000000000001', 'pickup_ordering'),
                app.org_has_feature('00000000-0000-4000-e000-000000000001', 'daily_sales_logs'),
                app.org_has_feature('00000000-0000-4000-e000-000000000001', 'table_reservations'),
                app.org_has_feature('00000000-0000-4000-e000-000000000001', 'live_orders_feed'),
                app.org_has_feature('00000000-0000-4000-e000-000000000001', 'event_ticketing'),
                app.org_has_feature('00000000-0000-4000-e000-000000000001', 'unlimited_menus')],
          array[true, true, false, false, false, false], 'starter: pickup and daily logs only');
select is(array[app.org_has_feature('00000000-0000-4000-e000-000000000002', 'table_reservations'),
                app.org_has_feature('00000000-0000-4000-e000-000000000002', 'live_orders_feed'),
                app.org_has_feature('00000000-0000-4000-e000-000000000002', 'unlimited_guest_profiles'),
                app.org_has_feature('00000000-0000-4000-e000-000000000002', 'event_ticketing'),
                app.org_has_feature('00000000-0000-4000-e000-000000000002', 'historical_reporting')],
          array[true, true, true, false, false], 'growth: reservations, live feed, unlimited; no tickets or history');
select is(array[app.org_has_feature('00000000-0000-4000-e000-000000000003', 'event_ticketing'),
                app.org_has_feature('00000000-0000-4000-e000-000000000003', 'historical_reporting'),
                app.org_has_feature('00000000-0000-4000-e000-000000000003', 'multi_brand_menus'),
                app.org_has_feature('00000000-0000-4000-e000-000000000003', 'advanced_tagging'),
                app.org_has_feature('00000000-0000-4000-e000-000000000003', 'export_reporting')],
          array[true, true, true, true, true], 'enterprise: every module');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000004', 'table_reservations'), false, 'no subscription: no reservations');
select throws_ok($$ select app.org_has_feature('00000000-0000-4000-e000-000000000002', 'teleport') $$, '22023', null, 'unknown feature is an error');

-- ---- place_order and create_reservation ----
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((public.place_order('tier-starter', '{"email":"a@example.com"}', '[{"item_id":"00000000-0000-4000-e200-000000000001","quantity":1}]') ->> 'total_piasters')::int,
          10000, 'starter: pickup order accepted');
select throws_like($$ select public.place_order('tier-starter', '{"email":"a@example.com"}', '[{"item_id":"00000000-0000-4000-e200-000000000001","quantity":1}]', 'dine_in') $$,
          '%plan_feature_locked: pickup_only%', 'starter: dine-in refused');
select throws_like($$ select public.create_reservation('tier-starter', '{"email":"a@example.com"}', now() + interval '1 day', 2) $$,
          '%plan_feature_locked: table_reservations%', 'starter: table reservation refused');
select throws_like($$ select public.create_reservation('tier-none', '{"email":"a@example.com"}', now() + interval '1 day', 2) $$,
          '%plan_feature_locked: table_reservations%', 'no subscription: table reservation refused');
select is((public.place_order('tier-growth', '{"email":"b@example.com"}', '[{"item_id":"00000000-0000-4000-e200-000000000002","quantity":1}]', 'dine_in') ->> 'total_piasters')::int,
          10000, 'growth: dine-in order accepted');
select is((public.create_reservation('tier-growth', '{"email":"b@example.com"}', now() + interval '1 day', 2) ->> 'party_size')::int, 2, 'growth: table reservation accepted');
select throws_like($$ select public.create_reservation('tier-growth', '{"email":"b@example.com"}', null, 2, '00000000-0000-4000-e300-000000000002') $$,
          '%plan_feature_locked: event_ticketing%', 'growth: event ticket refused');
select is((public.create_reservation('tier-enterprise', '{"email":"c@example.com"}', null, 2, '00000000-0000-4000-e300-000000000003') ->> 'party_size')::int, 2,
          'enterprise: event ticket accepted');
select is((public.create_reservation('tier-enterprise', '{"email":"c@example.com"}', now() + interval '1 day', 4) ->> 'party_size')::int, 4,
          'enterprise: table reservation accepted');
reset role;

-- ---- menu item limit ----
select lives_ok($$ insert into public.menu_items (section_id, name_ar, price_egp, updated_by)
  select '00000000-0000-4000-e100-000000000001', 'صنف ' || g, 10, null from generate_series(2, 50) g $$, 'starter: items 2 to 50 accepted');
select throws_like($$ insert into public.menu_items (section_id, name_ar, price_egp, updated_by) values ('00000000-0000-4000-e100-000000000001', 'صنف 51', 10, null) $$,
          '%menu item limit reached%', 'starter: item 51 refused');
select throws_like($$ insert into public.menu_items (section_id, name_ar, price_egp, updated_by)
  select '00000000-0000-4000-e100-000000000004', 'صنف ' || g, 10, null from generate_series(2, 51) g $$,
          '%menu item limit reached%', 'no subscription: item 51 refused (starter)');
select lives_ok($$ insert into public.menu_items (section_id, name_ar, price_egp, updated_by)
  select '00000000-0000-4000-e100-000000000002', 'صنف ' || g, 10, null from generate_series(2, 60) g $$, 'growth: 60 items accepted');
select lives_ok($$ insert into public.menu_items (section_id, name_ar, price_egp, updated_by)
  select '00000000-0000-4000-e100-000000000003', 'صنف ' || g, 10, null from generate_series(2, 60) g $$, 'enterprise: 60 items accepted');
select lives_ok($$ insert into public.menu_sections (id, slug, name_ar) values ('00000000-0000-4000-e100-0000000000ff', 'tier-test-pilot', 'تجربة');
  insert into public.menu_items (section_id, name_ar, price_egp, updated_by)
  select '00000000-0000-4000-e100-0000000000ff', 'صنف ' || g, 10, null from generate_series(1, 60) g $$, 'pilot sections without a tenant are not limited');

-- ---- guest profile limit ----
select lives_ok($$ insert into public.crm_customers (organization_id, email)
  select '00000000-0000-4000-e000-000000000001', 'g' || g || '@example.com' from generate_series(1, 499) g $$, 'starter: guests up to 500 accepted');
select throws_like($$ insert into public.crm_customers (organization_id, email) values ('00000000-0000-4000-e000-000000000001', 'g501@example.com') $$,
          '%guest profile limit reached%', 'starter: guest 501 refused');
select lives_ok($$ select app.upsert_crm_customer('00000000-0000-4000-e000-000000000001', '{"email":"g7@example.com"}') $$,
          'starter at the limit: a returning guest is still accepted');
select lives_ok($$ insert into public.crm_customers (organization_id, email)
  select '00000000-0000-4000-e000-000000000002', 'g' || g || '@example.com' from generate_series(1, 510) g $$, 'growth: 510 guests accepted');
select lives_ok($$ insert into public.crm_customers (organization_id, email)
  select '00000000-0000-4000-e000-000000000003', 'g' || g || '@example.com' from generate_series(1, 510) g $$, 'enterprise: 510 guests accepted');

-- ---- domain limits ----
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('a.starter-test.com', '00000000-0000-4000-e000-000000000001') $$, 'starter: first domain accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('b.starter-test.com', '00000000-0000-4000-e000-000000000001') $$, '%custom domain limit reached%', 'starter: second domain refused');
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('a.none-test.com', '00000000-0000-4000-e000-000000000004') $$, 'no subscription: first domain accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('b.none-test.com', '00000000-0000-4000-e000-000000000004') $$, '%custom domain limit reached%', 'no subscription: second domain refused');
select lives_ok($$ insert into public.custom_domains (hostname, organization_id)
  select 'd' || g || '.growth-test.com', '00000000-0000-4000-e000-000000000002' from generate_series(1, 3) g $$, 'growth: three domains accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('d4.growth-test.com', '00000000-0000-4000-e000-000000000002') $$, '%custom domain limit reached%', 'growth: fourth domain refused');
select lives_ok($$ insert into public.custom_domains (hostname, organization_id)
  select 'd' || g || '.ent-test.com', '00000000-0000-4000-e000-000000000003' from generate_series(1, 10) g $$, 'enterprise: ten domains accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('d11.ent-test.com', '00000000-0000-4000-e000-000000000003') $$, '%custom domain limit reached%', 'enterprise: eleventh domain refused');
update public.custom_domains set status = 'removed' where hostname = 'a.starter-test.com';
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('b.starter-test.com', '00000000-0000-4000-e000-000000000001') $$, 'a removed domain frees its slot');

-- ---- seat limits (signup trigger places managers through app metadata) ----
select lives_ok($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f000-000000000001', 'starter-1@test.invalid', 'authenticated', 'authenticated', '{"organization_id": "00000000-0000-4000-e000-000000000001"}') $$, 'starter: first manager accepted');
select throws_like($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f000-000000000002', 'starter-2@test.invalid', 'authenticated', 'authenticated', '{"organization_id": "00000000-0000-4000-e000-000000000001"}') $$,
  '%manager seat limit reached%', 'starter: second manager refused');
select lives_ok($$ insert into auth.users (id, email, aud, role, raw_app_meta_data)
  select ('00000000-0000-4000-f200-00000000000' || g)::uuid, 'growth-' || g || '@test.invalid', 'authenticated', 'authenticated',
         '{"organization_id": "00000000-0000-4000-e000-000000000002"}'::jsonb from generate_series(1, 3) g $$, 'growth: three managers accepted');
select throws_like($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f200-000000000009', 'growth-4@test.invalid', 'authenticated', 'authenticated', '{"organization_id": "00000000-0000-4000-e000-000000000002"}') $$,
  '%manager seat limit reached%', 'growth: fourth manager refused');
select lives_ok($$ insert into auth.users (id, email, aud, role, raw_app_meta_data)
  select ('00000000-0000-4000-f300-0000000000' || lpad(g::text, 2, '0'))::uuid, 'ent-' || g || '@test.invalid', 'authenticated', 'authenticated',
         '{"organization_id": "00000000-0000-4000-e000-000000000003"}'::jsonb from generate_series(1, 10) g $$, 'enterprise: ten managers accepted');
select throws_like($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f300-000000000099', 'ent-11@test.invalid', 'authenticated', 'authenticated', '{"organization_id": "00000000-0000-4000-e000-000000000003"}') $$,
  '%manager seat limit reached%', 'enterprise: eleventh manager refused');
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-f000-000000000003', 'self-signup@test.invalid', 'authenticated', 'authenticated',
   '{"role": "tenant_admin", "organization_id": "00000000-0000-4000-e000-000000000001"}');
select is((select array[coalesce(organization_id::text, 'none'), role::text] from public.user_profiles where id = '00000000-0000-4000-f000-000000000003'),
          array['none', 'manager'], 'plain signup gets no organization and no tenant_admin');

-- ---- RLS and has_feature as tenants ----
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-f000-000000000001');
select is((select tier from public.subscriptions), 'starter'::public.subscription_tier, 'starter tenant reads only its own tier');
select is(public.has_feature('table_reservations'), false, 'has_feature: starter has no reservations');
select is((public.get_my_plan() ->> 'tier'), 'starter', 'get_my_plan returns the tier');
select is((public.get_my_plan() -> 'usage' ->> 'menu_items')::int, 50, 'get_my_plan returns menu usage');
select throws_ok($$ update public.subscriptions set tier = 'enterprise' $$, '42501', null, 'tenant cannot update its subscription');
select throws_ok($$ select public.apply_paymob_payment(1, 1, '00000000-0000-4000-e000-000000000001', 1000000, 'EGP') $$, '42501', null, 'tenants cannot record payments');
select is((select count(*)::int from public.plan_limits), 3, 'tenants read the three plans');
select pg_temp.act_as('00000000-0000-4000-f200-000000000001');
select is(public.has_feature('live_orders_feed'), true, 'has_feature: growth has the live orders feed');
select pg_temp.act_as('00000000-0000-4000-f300-000000000001');
select is(public.has_feature('historical_reporting'), true, 'has_feature: enterprise has historical reporting');
reset role;

-- ---- Paymob payments ----
select is(public.apply_paymob_payment(9101, 7101, '00000000-0000-4000-e000-000000000004', 399900, 'EGP'), 'applied', '3,999 EGP is applied');
select is(app.org_tier('00000000-0000-4000-e000-000000000004'), 'starter'::public.subscription_tier, '3,999 EGP sets starter');
select is(public.apply_paymob_payment(9102, 7102, '00000000-0000-4000-e000-000000000004', 699900, 'EGP'), 'applied', '6,999 EGP is applied');
select is(app.org_tier('00000000-0000-4000-e000-000000000004'), 'growth'::public.subscription_tier, '6,999 EGP sets growth');
select is(public.apply_paymob_payment(9103, 7103, '00000000-0000-4000-e000-000000000004', 1000000, 'EGP'), 'applied', '10,000 EGP is applied');
select is(app.org_tier('00000000-0000-4000-e000-000000000004'), 'enterprise'::public.subscription_tier, '10,000 EGP sets enterprise');
select is(public.apply_paymob_payment(9103, 7103, '00000000-0000-4000-e000-000000000004', 1000000, 'EGP'), 'duplicate', 'the same transaction twice is a duplicate');
select is((select count(*)::int from public.paymob_transactions where transaction_id = 9103), 1, 'a duplicate is not recorded twice');
select is(public.apply_paymob_payment(9104, 7104, '00000000-0000-4000-e000-000000000004', 980000, 'EGP'), 'ignored_amount', 'the old 9,800 EGP price is ignored');
select is(public.apply_paymob_payment(9105, 7105, '00000000-0000-4000-e000-000000000004', 499900, 'EGP'), 'ignored_amount', 'the old 4,999 EGP price is ignored');
select is(public.apply_paymob_payment(9106, 7106, '00000000-0000-4000-e000-000000000004', 1000000, 'USD'), 'ignored_currency', 'another currency is ignored');
select is(public.apply_paymob_payment(9107, 7107, '00000000-0000-4000-e000-0000000000ff', 1000000, 'EGP'), 'ignored_organization', 'an unknown organization is ignored');
select is(app.org_tier('00000000-0000-4000-e000-000000000004'), 'enterprise'::public.subscription_tier, 'ignored payments change nothing');
update public.subscriptions set status = 'canceled' where organization_id = '00000000-0000-4000-e000-000000000003';
select is(app.org_tier('00000000-0000-4000-e000-000000000003'), 'starter'::public.subscription_tier, 'a canceled subscription counts as starter');

select * from finish();
rollback;
