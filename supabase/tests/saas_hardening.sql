-- SaaS hardening (20261029001100): admin sessions need aal2, manual plan changes, suspension lock,
-- and platform admins own no restaurant.
begin;
set local role postgres;
set search_path = extensions, public;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-4000-8000-0000000000c1', 'admin@test.tablia', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-0000000000c2', 'owner2@test.tablia', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('c0000000-0000-4000-8000-0000000000c1');

set local role authenticated;

-- the owner
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
select lives_ok($$ select public.create_my_organization('Hardening Grill', 'pgtap-hardening-grill', 'starter') $$, 'the owner creates a restaurant');
select throws_ok($$ select public.admin_set_subscription(public.get_auth_organization(), 'comp', 'growth', 30) $$, '42501', null,
  'owners cannot change plans');

-- a listed admin with a password-only session
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
select is(public.am_i_super_admin(), true, 'a listed admin is recognised before the authenticator step');
select throws_ok($$ select public.admin_list_restaurants() $$, '42501', null, 'admin data is refused to a password-only session');
select throws_ok($$ select public.admin_platform_stats() $$, '42501', null, 'platform numbers are refused to a password-only session');
select throws_ok($$ select public.create_my_organization('Admin Cafe', 'pgtap-admin-cafe', 'starter') $$, '42501', null,
  'an admin account cannot create a restaurant');

-- the admin after the authenticator code
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select public.admin_list_restaurants() $$, 'an aal2 admin session reads admin data');
select lives_ok($$ select public.admin_set_subscription((select (r ->> 'id')::uuid from jsonb_array_elements(public.admin_list_restaurants()) r
  where r ->> 'slug' = 'pgtap-hardening-grill'), 'comp', 'growth', 30) $$, 'the admin comps a plan');
select is((select r ->> 'tier' from jsonb_array_elements(public.admin_list_restaurants()) r where r ->> 'slug' = 'pgtap-hardening-grill'),
  'growth', 'the comped plan is in force');
select is((select (r ->> 'is_test')::boolean from jsonb_array_elements(public.admin_list_restaurants()) r where r ->> 'slug' = 'pgtap-hardening-grill'),
  true, 'a comped plan is left out of revenue');
select lives_ok($$ select public.admin_set_restaurant_active((select (r ->> 'id')::uuid from jsonb_array_elements(public.admin_list_restaurants()) r
  where r ->> 'slug' = 'pgtap-hardening-grill'), false, 'test') $$, 'the admin suspends the restaurant');

-- the owner of the suspended restaurant
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
select is(public.get_auth_organization(), null::uuid, 'a suspended restaurant gets no console data');
select is(public.get_my_restaurant() ->> 'is_active', 'false', 'the owner still sees that it is suspended');
select throws_ok($$ select public.update_my_restaurant('X', null, null, null, null, null) $$, '42501', null,
  'a suspended owner cannot edit the profile');

select * from finish();
rollback;
