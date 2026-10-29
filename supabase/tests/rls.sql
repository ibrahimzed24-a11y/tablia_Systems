-- Three portals and merchant roles (20261029001000_three_portals): owner vs staff, staff seats, customer access.
begin;
set local role postgres;
set search_path = extensions, public;
select plan(16);

insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-0000000000b1', 'owner@portals.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-0000000000b2', 'staff@portals.test', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select public.create_my_organization('Portal Bistro', 'pgtap-portal-bistro', 'growth');
set local role postgres;
update public.subscriptions set status = 'active', current_period_end = now() + interval '30 days'
 where organization_id = (select id from public.organizations where slug = 'pgtap-portal-bistro');
insert into public.menu_sections (id, slug, name_ar, organization_id)
  select 'b0000000-0000-4000-8000-00000000c001', 'pgtap-portal-main', 'رئيسي', id from public.organizations where slug = 'pgtap-portal-bistro';
insert into public.menu_items (id, section_id, name_ar, price_egp) values
  ('b0000000-0000-4000-8000-00000000c002', 'b0000000-0000-4000-8000-00000000c001', 'صنف', 100);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is(public.owner_invite_staff('Staff@Portals.test'), 'added', 'the owner adds an existing account as staff');
select is(public.owner_invite_staff('new.cook@portals.test'), 'invited', 'an unknown email waits as an invite');
select is(jsonb_array_length(public.owner_list_team() -> 'members'), 2, 'the team lists the owner and the staff member');
select throws_ok($$ select public.owner_invite_staff('not-an-email') $$, '22023', null, 'a bad email is refused');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select is((select role::text from public.user_profiles where id = auth.uid()), 'manager', 'the added account is staff');
select is((select count(*)::int from public.menu_items where id = 'b0000000-0000-4000-8000-00000000c002'), 1, 'staff read the menu');
select lives_ok($$ update public.menu_items set is_available = false where id = 'b0000000-0000-4000-8000-00000000c002' $$, 'staff mark an item sold out');
select throws_ok($$ update public.menu_items set price_egp = 1 where id = 'b0000000-0000-4000-8000-00000000c002' $$, '42501', null, 'staff cannot change prices');
select throws_ok($$ insert into public.menu_sections (slug, name_ar, organization_id) values ('x', 'x', public.get_auth_organization()) $$, '42501', null, 'staff cannot add menu sections');
select throws_ok($$ select public.owner_invite_staff('x@portals.test') $$, '42501', null, 'staff cannot manage the team');
select throws_ok($$ select public.update_my_restaurant('X', null, null, null, null, null) $$, '42501', null, 'staff cannot edit the restaurant profile');
select throws_ok($$ select public.choose_my_plan('enterprise') $$, '42501', null, 'staff cannot change the plan');
select is(public.am_i_super_admin(), false, 'staff are not super admins');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select lives_ok($$ select public.owner_remove_staff('staff@portals.test') $$, 'the owner removes staff');
set local role postgres;
select is((select organization_id from public.user_profiles where id = 'b0000000-0000-4000-8000-0000000000b2'), null, 'removed staff lose the restaurant');
select ok(not has_function_privilege('anon', 'public.owner_invite_staff(text)', 'execute')
  and has_function_privilege('anon', 'public.get_public_storefront(text)', 'execute'), 'customers reach only the storefront functions');
select * from finish();
rollback;
