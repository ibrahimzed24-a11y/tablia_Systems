-- Tenancy checks for 20261029000500_tenant_subscriptions: plan limits, domain and seat triggers,
-- the feature gate, tenant RLS, the signup profile trigger and the idempotent Paymob payment function.
-- Everything runs in one transaction and is rolled back: no test rows are left behind.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---- fixtures (as the migration owner) ----
insert into public.organizations (id, name) values
  ('00000000-0000-4000-e000-000000000001', 'Test growth org'),
  ('00000000-0000-4000-e000-000000000002', 'Test scale org'),
  ('00000000-0000-4000-e000-000000000003', 'Test org without subscription');
insert into public.subscriptions (organization_id, tier, status, current_period_start, current_period_end) values
  ('00000000-0000-4000-e000-000000000001', 'growth', 'active', now(), now() + interval '1 month'),
  ('00000000-0000-4000-e000-000000000002', 'scale_matrix', 'active', now(), now() + interval '1 month');

-- ---- plan limits ----
select is((select price_amount_cents from public.plan_limits where tier = 'growth'), 499900, 'growth costs 4,999 EGP');
select is((select price_amount_cents from public.plan_limits where tier = 'scale_matrix'), 980000, 'scale_matrix costs 9,800 EGP');
select is((select array[max_custom_domains, max_manager_seats] from public.plan_limits where tier = 'growth'), array[1, 1], 'growth: 1 domain, 1 seat');
select is((select array[max_custom_domains, max_manager_seats] from public.plan_limits where tier = 'scale_matrix'), array[5, 5], 'scale_matrix: 5 domains, 5 seats');
select is(app.org_tier('00000000-0000-4000-e000-000000000003'), 'growth'::public.subscription_tier, 'missing subscription counts as growth');

-- ---- feature gate ----
select is(app.org_has_feature('00000000-0000-4000-e000-000000000001', 'advanced_analytics'), false, 'growth has no advanced analytics');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000001', 'export_reporting'), false, 'growth has no export reporting');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000002', 'advanced_analytics'), true, 'scale_matrix has advanced analytics');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000002', 'export_reporting'), true, 'scale_matrix has export reporting');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000003', 'export_reporting'), false, 'no subscription: no export reporting');
select throws_ok($$ select app.org_has_feature('00000000-0000-4000-e000-000000000002', 'teleport') $$, '22023', null, 'unknown feature is an error');

-- ---- signup trigger ----
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-4000-f000-000000000001', 'self-signup@test.invalid', 'authenticated', 'authenticated', '{}',
   '{"role": "tenant_admin", "organization_id": "00000000-0000-4000-e000-000000000001", "full_name": "Self signup"}');
select is((select role from public.user_profiles where id = '00000000-0000-4000-f000-000000000001'), 'manager'::public.tenant_role, 'metadata cannot grant tenant_admin');
select is((select organization_id from public.user_profiles where id = '00000000-0000-4000-f000-000000000001'), null, 'plain signup cannot join an organization through user metadata');
select is((select full_name from public.user_profiles where id = '00000000-0000-4000-f000-000000000001'), 'Self signup', 'full name copied from metadata');

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f000-000000000002', 'growth-manager@test.invalid', 'authenticated', 'authenticated',
   '{"organization_id": "00000000-0000-4000-e000-000000000001", "role": "tenant_admin"}');
select is((select array[organization_id::text, role::text] from public.user_profiles where id = '00000000-0000-4000-f000-000000000002'),
          array['00000000-0000-4000-e000-000000000001', 'manager'], 'app metadata places the user in the organization as manager');

insert into auth.users (id, email, aud, role, invited_at, raw_user_meta_data) values
  ('00000000-0000-4000-f000-000000000003', 'scale-invite@test.invalid', 'authenticated', 'authenticated', now(),
   '{"organization_id": "00000000-0000-4000-e000-000000000002"}');
select is((select organization_id from public.user_profiles where id = '00000000-0000-4000-f000-000000000003'),
          '00000000-0000-4000-e000-000000000002'::uuid, 'an invitation places the user in the organization');

-- ---- seat limits ----
select throws_like($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f000-000000000004', 'growth-manager-2@test.invalid', 'authenticated', 'authenticated',
   '{"organization_id": "00000000-0000-4000-e000-000000000001"}') $$, '%manager seat limit reached%', 'growth: second manager seat refused');
select lives_ok($$ insert into auth.users (id, email, aud, role, raw_app_meta_data)
  select ('00000000-0000-4000-f100-00000000000' || g)::uuid, 'scale-' || g || '@test.invalid', 'authenticated', 'authenticated',
         '{"organization_id": "00000000-0000-4000-e000-000000000002"}'::jsonb from generate_series(1, 4) g $$, 'scale_matrix: managers 2 to 5 accepted');
select throws_like($$ insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-4000-f100-000000000009', 'scale-6@test.invalid', 'authenticated', 'authenticated',
   '{"organization_id": "00000000-0000-4000-e000-000000000002"}') $$, '%manager seat limit reached%', 'scale_matrix: sixth manager seat refused');
-- A tenant admin does not use a manager seat; moving a manager into a full organization is refused too.
select lives_ok($$ update public.user_profiles set organization_id = '00000000-0000-4000-e000-000000000001', role = 'tenant_admin'
  where id = '00000000-0000-4000-f000-000000000001' $$, 'tenant admin added beside the growth manager');
select throws_like($$ update public.user_profiles set organization_id = '00000000-0000-4000-e000-000000000001'
  where id = '00000000-0000-4000-f100-000000000001' $$, '%manager seat limit reached%', 'moving a manager into a full organization is refused');

-- ---- domain limits ----
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('menu.growth-test.com', '00000000-0000-4000-e000-000000000001') $$, 'growth: first domain accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('book.growth-test.com', '00000000-0000-4000-e000-000000000001') $$, '%custom domain limit reached%', 'growth: second domain refused');
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('menu.nosub-test.com', '00000000-0000-4000-e000-000000000003') $$, 'no subscription: first domain accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('book.nosub-test.com', '00000000-0000-4000-e000-000000000003') $$, '%custom domain limit reached%', 'no subscription: second domain refused (growth)');
select lives_ok($$ insert into public.custom_domains (hostname, organization_id)
  select 'd' || g || '.scale-test.com', '00000000-0000-4000-e000-000000000002' from generate_series(1, 5) g $$, 'scale_matrix: five domains accepted');
select throws_like($$ insert into public.custom_domains (hostname, organization_id) values ('d6.scale-test.com', '00000000-0000-4000-e000-000000000002') $$, '%custom domain limit reached%', 'scale_matrix: sixth domain refused');
update public.custom_domains set status = 'removed' where hostname = 'menu.growth-test.com';
select lives_ok($$ insert into public.custom_domains (hostname, organization_id) values ('book.growth-test.com', '00000000-0000-4000-e000-000000000001') $$, 'a removed domain frees its slot');
select throws_like($$ update public.custom_domains set status = 'pending' where hostname = 'menu.growth-test.com' $$, '%custom domain limit reached%', 'restoring a removed domain over the limit is refused');
select lives_ok($$ insert into public.custom_domains (hostname) values ('staff1.pilot-test.com'), ('staff2.pilot-test.com') $$, 'pilot domains without an organization are not limited');

-- ---- RLS as a growth tenant admin ----
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-f000-000000000001');
select is(public.get_auth_organization(), '00000000-0000-4000-e000-000000000001'::uuid, 'get_auth_organization returns the caller organization');
select is((select count(*)::int from public.subscriptions), 1, 'tenant sees only its own subscription');
select is((select tier from public.subscriptions), 'growth'::public.subscription_tier, 'tenant reads its tier');
select throws_ok($$ update public.subscriptions set tier = 'scale_matrix' $$, '42501', null, 'tenant cannot update its subscription');
select throws_ok($$ insert into public.subscriptions (organization_id, tier) values ('00000000-0000-4000-e000-000000000003', 'scale_matrix') $$, '42501', null, 'tenant cannot insert a subscription');
select throws_ok($$ delete from public.subscriptions $$, '42501', null, 'tenant cannot delete a subscription');
select is((select count(*)::int from public.organizations), 1, 'tenant sees only its own organization');
select is((select count(*)::int from public.user_profiles), 2, 'tenant sees the profiles of its own organization');
select is((select count(*)::int from public.custom_domains), 2, 'tenant sees only its own domains');
select throws_ok($$ update public.user_profiles set role = 'tenant_admin' where id = '00000000-0000-4000-f000-000000000002' $$, '42501', null, 'tenant cannot promote a manager');
select is(public.has_feature('advanced_analytics'), false, 'has_feature: growth tenant has no advanced analytics');
select throws_ok($$ select public.apply_paymob_payment(1, 1, '00000000-0000-4000-e000-000000000001', 980000, 'EGP') $$, '42501', null, 'tenants cannot record payments');
select is((select count(*)::int from public.plan_limits), 2, 'tenants can read the plan limits');

select pg_temp.act_as('00000000-0000-4000-f000-000000000003');
select is((select tier from public.subscriptions), 'scale_matrix'::public.subscription_tier, 'scale tenant reads its own tier');
select is(public.has_feature('export_reporting'), true, 'has_feature: scale tenant has export reporting');
select is((select count(*)::int from public.custom_domains), 5, 'scale tenant sees its five domains only');
reset role;

-- ---- Paymob payments ----
select is(public.apply_paymob_payment(9001, 7001, '00000000-0000-4000-e000-000000000003', 980000, 'EGP'), 'applied', '9,800 EGP is applied');
select is((select array[tier::text, status::text, billing_provider_ref] from public.subscriptions where organization_id = '00000000-0000-4000-e000-000000000003'),
          array['scale_matrix', 'active', '9001'], '9,800 EGP creates a scale_matrix subscription');
select is(app.org_has_feature('00000000-0000-4000-e000-000000000003', 'advanced_analytics'), true, 'the upgrade turns advanced analytics on');
select is(public.apply_paymob_payment(9001, 7001, '00000000-0000-4000-e000-000000000003', 980000, 'EGP'), 'duplicate', 'the same transaction twice is a duplicate');
select is((select count(*)::int from public.paymob_transactions where transaction_id = 9001), 1, 'a duplicate is not recorded twice');
select is((select current_period_end::date from public.subscriptions where organization_id = '00000000-0000-4000-e000-000000000003'),
          (now() + interval '1 month')::date, 'a duplicate does not extend the period');
select is(public.apply_paymob_payment(9002, 7002, '00000000-0000-4000-e000-000000000001', 499900, 'EGP'), 'applied', '4,999 EGP is applied');
select is((select tier from public.subscriptions where organization_id = '00000000-0000-4000-e000-000000000001'), 'growth'::public.subscription_tier, '4,999 EGP keeps growth');
select is((select current_period_end::date from public.subscriptions where organization_id = '00000000-0000-4000-e000-000000000001'),
          (now() + interval '2 months')::date, 'a growth renewal extends the running period by a month');
select is(public.apply_paymob_payment(9003, 7003, '00000000-0000-4000-e000-000000000001', 123400, 'EGP'), 'ignored_amount', 'an unknown amount is ignored');
select is(public.apply_paymob_payment(9004, 7004, '00000000-0000-4000-e000-000000000001', 980000, 'USD'), 'ignored_currency', 'another currency is ignored');
select is(public.apply_paymob_payment(9005, 7005, '00000000-0000-4000-e000-0000000000ff', 980000, 'EGP'), 'ignored_organization', 'an unknown organization is ignored');
select is((select tier from public.subscriptions where organization_id = '00000000-0000-4000-e000-000000000001'), 'growth'::public.subscription_tier, 'ignored payments change nothing');

update public.subscriptions set status = 'canceled' where organization_id = '00000000-0000-4000-e000-000000000002';
select is(app.org_tier('00000000-0000-4000-e000-000000000002'), 'growth'::public.subscription_tier, 'a canceled subscription counts as growth');

-- ---- function hardening ----
select is((select prosecdef from pg_proc where oid = 'public.get_auth_organization()'::regprocedure), true, 'get_auth_organization is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.get_auth_organization()'::regprocedure), 'get_auth_organization has a fixed search_path');

select * from finish();
rollback;
