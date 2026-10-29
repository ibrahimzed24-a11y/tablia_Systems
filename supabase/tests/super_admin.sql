-- Platform super admin, restaurant suspension and the owner profile (20261029000900).
begin;
set local role postgres;
set search_path = extensions, public;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-0000000000b1', 'super@test.tablia', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-0000000000b2', 'owner@test.tablia', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('b0000000-0000-4000-8000-0000000000b1');

-- the owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select public.create_my_organization('Super Test Grill', 'pgtap-super-grill', 'growth') $$, 'the owner creates a restaurant');
select throws_ok($$ select * from public.platform_admins $$, '42501', null, 'owners cannot read platform_admins');
select throws_ok($$ insert into public.platform_admins (user_id) values (auth.uid()) $$, '42501', null, 'owners cannot make themselves super admin');
select is(public.am_i_super_admin(), false, 'an owner is not a super admin');
select throws_ok($$ select public.admin_list_restaurants() $$, '42501', null, 'owners cannot list every restaurant');
select throws_ok($$ select public.admin_platform_stats() $$, '42501', null, 'owners cannot read platform numbers');
select throws_ok($$ select public.admin_set_restaurant_active(public.get_auth_organization(), false, 'x') $$, '42501', null,
  'owners cannot suspend restaurants');
select lives_ok($$ select public.update_my_restaurant('Super Test Grill 2', '+201000000000', 'Corniche', 'وصف', 'About', 'Owner') $$,
  'the owner edits the profile');
select is(public.get_my_restaurant() ->> 'name', 'Super Test Grill 2', 'the profile is saved');
select is(public.get_my_restaurant() -> 'subscription' ->> 'status', 'past_due', 'the owner sees the subscription status');

-- the super admin
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
select is(public.am_i_super_admin(), true, 'the super admin is recognised');
select ok(public.admin_list_restaurants() @> '[{"slug":"pgtap-super-grill","owner_email":"owner@test.tablia","tier":"growth"}]',
  'the super admin sees every restaurant with its owner and plan');
select lives_ok($$ select public.admin_set_restaurant_active((select (r ->> 'id')::uuid from jsonb_array_elements(public.admin_list_restaurants()) r where r ->> 'slug' = 'pgtap-super-grill'), false, 'unpaid') $$,
  'the super admin suspends a restaurant');
select throws_ok($$ select public.get_public_storefront('pgtap-super-grill') $$, 'P0002', null, 'a suspended restaurant has no public page');
select ok((public.admin_platform_stats() ->> 'suspended_restaurants')::int >= 1, 'platform numbers count suspended restaurants');
select lives_ok($$ select public.admin_set_restaurant_active((select (r ->> 'id')::uuid from jsonb_array_elements(public.admin_list_restaurants()) r where r ->> 'slug' = 'pgtap-super-grill'), true) $$,
  'the super admin reactivates it');

set local role postgres;
select ok(not has_function_privilege('anon', 'public.admin_list_restaurants()', 'execute'), 'anon cannot call super admin functions');
select * from finish();
rollback;
