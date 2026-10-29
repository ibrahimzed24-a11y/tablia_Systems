-- Owner self-service onboarding: create_my_organization and choose_my_plan (20261029000800).
begin;
set local role postgres;
set search_path = extensions, public;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'owner-a@test.tablia', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-0000000000a2', 'owner-b@test.tablia', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select public.create_my_organization('Test Bistro', 'pgtap-test-bistro', 'growth') $$, 'a signed-in owner creates a restaurant');
select is((select role::text from public.user_profiles where id = auth.uid()), 'tenant_admin', 'the creator becomes tenant_admin');
select is((select tier::text || '/' || status::text from public.subscriptions where organization_id = public.get_auth_organization()),
  'growth/past_due', 'the chosen plan waits for payment');
select throws_ok($$ select public.create_my_organization('Second', 'pgtap-second', 'starter') $$, 'P0001', null, 'one restaurant per owner');
select lives_ok($$ select public.choose_my_plan('enterprise') $$, 'the owner changes the plan before paying');
select is((select tier::text from public.subscriptions where organization_id = public.get_auth_organization()), 'enterprise', 'the new plan is saved');
select throws_ok($$ update public.subscriptions set status = 'active' $$, '42501', null, 'owners cannot mark their plan paid');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select public.create_my_organization('Copy', 'pgtap-test-bistro', 'starter') $$, '23505', null, 'a taken web address is refused');

set local role postgres;
select ok(not has_function_privilege('anon', 'public.create_my_organization(text, text, public.subscription_tier)', 'execute'),
  'anon cannot create restaurants');
select * from finish();
rollback;
