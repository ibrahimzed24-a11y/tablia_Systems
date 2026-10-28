-- Roles enforced by row level security. See docs/sops/06-roles-permissions.md.

-- Role of the caller, or null when inactive or when this session's device was revoked (SOP 05).
create function app.current_staff_role() returns public.staff_role
language sql stable security definer set search_path = public, pg_temp as $$
  select s.role from public.staff s
  where s.id = auth.uid() and s.active
    and not exists (
      select 1 from public.staff_devices d
      where d.staff_id = s.id and d.revoked_at is not null
        and d.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid)
$$;

create function app.current_staff_branch() returns public.branch_code
language sql stable security definer set search_path = public, pg_temp as $$
  select s.branch from public.staff s where s.id = auth.uid()
$$;

create function app.has_role(variadic roles public.staff_role[]) returns boolean
language sql stable as $$ select coalesce(app.current_staff_role() = any (roles), false) $$;

create function app.in_branch(b public.branch_code) returns boolean
language sql stable as $$
  select case
    when app.current_staff_role() is null then false
    when app.current_staff_role() = 'admin' then true
    else coalesce(app.current_staff_branch() = b, true)
  end
$$;

grant usage on schema app to authenticated;
grant execute on function app.current_staff_role(), app.current_staff_branch(),
  app.has_role(public.staff_role[]), app.in_branch(public.branch_code) to authenticated;

alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.staff_devices enable row level security;
alter table public.provision_tokens enable row level security;
alter table public.menu_sections enable row level security;
alter table public.menu_items enable row level security;
alter table public.bookings enable row level security;
alter table public.whatsapp_requests enable row level security;
alter table public.whatsapp_replies enable row level security;
alter table public.audit_log enable row level security;

create policy branches_read on public.branches for select to authenticated using (app.current_staff_role() is not null);

create policy staff_read on public.staff for select to authenticated
  using (id = auth.uid() or app.has_role('admin', 'manager'));
create policy staff_admin_update on public.staff for update to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));
create policy staff_admin_delete on public.staff for delete to authenticated using (app.has_role('admin'));
-- staff rows are inserted only by the verify-provision-qr edge function (service role)

create policy devices_read on public.staff_devices for select to authenticated
  using (staff_id = auth.uid() or app.has_role('admin')
    or (app.has_role('manager') and exists (select 1 from public.staff s where s.id = staff_id and app.in_branch(s.branch))));

create policy tokens_read on public.provision_tokens for select to authenticated
  using (app.has_role('admin') or (app.has_role('manager') and created_by = auth.uid()));
create policy tokens_revoke on public.provision_tokens for update to authenticated
  using (app.has_role('admin') or (app.has_role('manager') and created_by = auth.uid()))
  with check (app.has_role('admin') or (app.has_role('manager') and created_by = auth.uid()));

create policy sections_read on public.menu_sections for select to authenticated using (app.current_staff_role() is not null);
create policy sections_insert on public.menu_sections for insert to authenticated with check (app.has_role('admin', 'manager'));
create policy sections_update on public.menu_sections for update to authenticated using (app.has_role('admin', 'manager')) with check (app.has_role('admin', 'manager'));
create policy sections_delete on public.menu_sections for delete to authenticated using (app.has_role('admin'));

create policy items_read on public.menu_items for select to authenticated using (app.current_staff_role() is not null);
create policy items_insert on public.menu_items for insert to authenticated with check (app.has_role('admin', 'manager'));
create policy items_update on public.menu_items for update to authenticated using (app.has_role('admin', 'manager')) with check (app.has_role('admin', 'manager'));
create policy items_delete on public.menu_items for delete to authenticated using (app.has_role('admin'));

create policy bookings_read on public.bookings for select to authenticated
  using (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy bookings_insert on public.bookings for insert to authenticated
  with check (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy bookings_update on public.bookings for update to authenticated
  using (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch))
  with check (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy bookings_delete on public.bookings for delete to authenticated using (app.has_role('admin'));

create policy wa_read on public.whatsapp_requests for select to authenticated
  using (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy wa_insert on public.whatsapp_requests for insert to authenticated
  with check (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy wa_update on public.whatsapp_requests for update to authenticated
  using (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch))
  with check (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(branch));
create policy wa_delete on public.whatsapp_requests for delete to authenticated using (app.has_role('admin'));

create policy wa_replies_read on public.whatsapp_replies for select to authenticated
  using (exists (select 1 from public.whatsapp_requests r where r.id = request_id));

create policy audit_read on public.audit_log for select to authenticated using (app.has_role('admin'));

-- Kitchen may only flip availability (SOP 02).
create function public.set_item_availability(p_item uuid, p_available boolean, p_until timestamptz default null)
returns public.menu_items language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.menu_items;
begin
  if not app.has_role('admin', 'manager', 'kitchen') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.menu_items
     set is_available = p_available,
         sold_out_until = case when p_available then null else p_until end,
         updated_by = auth.uid()
   where id = p_item returning * into r;
  return r;
end $$;

-- Kitchen sees covers, not guest details (SOP 06).
create function public.covers_today(p_branch public.branch_code)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.current_staff_role() is null then null else coalesce(sum(guests), 0)::int end
  from public.bookings
  where branch = p_branch
    and booking_date = (now() at time zone 'Africa/Cairo')::date
    and status in ('pending', 'confirmed', 'seated')
$$;

-- A manual WhatsApp reply. A second reply to the same guest within 24h needs a reason (SOP 04).
create function public.record_whatsapp_reply(p_request uuid, p_reason text default null)
returns public.whatsapp_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare req public.whatsapp_requests;
begin
  select * into req from public.whatsapp_requests where id = p_request;
  if req.id is null or not (app.has_role('admin', 'manager', 'front_desk') and app.in_branch(req.branch)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' and exists (
    select 1 from public.whatsapp_replies wr join public.whatsapp_requests r on r.id = wr.request_id
    where wr.sent_at > now() - interval '24 hours'
      and (r.id = req.id or (req.guest_phone is not null and r.guest_phone = req.guest_phone))) then
    raise exception 'second_reply_needs_reason' using errcode = 'P0001';
  end if;
  insert into public.whatsapp_replies (request_id, reason) values (req.id, nullif(btrim(p_reason), ''));
  update public.whatsapp_requests
     set reply_count = reply_count + 1, last_replied_at = now(),
         status = case when status = 'new' then 'replied'::public.wa_status else status end
   where id = req.id returning * into req;
  return req;
end $$;

-- Revoke a lost device (SOP 05).
create function public.revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.staff_devices; s public.staff;
begin
  select * into d from public.staff_devices where id = p_device;
  select * into s from public.staff where id = d.staff_id;
  if d.id is null or not (
    app.has_role('admin')
    or (app.has_role('manager') and s.role in ('front_desk', 'kitchen') and app.in_branch(s.branch))
    or d.staff_id = auth.uid()) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.staff_devices set revoked_at = now(), revoked_by = auth.uid() where id = d.id;
  if d.session_id is not null then
    begin
      delete from auth.sessions where id = d.session_id;
    exception when insufficient_privilege then
      null; -- RLS still blocks the revoked session on its next request
    end;
  end if;
end $$;

-- Privacy (SOP 10)
create function app.purge_guest_data() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.bookings set guest_name = '-', guest_phone = null, notes = null
   where booking_date < (now() at time zone 'Africa/Cairo')::date - 180 and guest_phone is not null;
  update public.whatsapp_requests set guest_name = null, guest_phone = null, message = null
   where created_at < now() - interval '90 days' and (guest_phone is not null or message is not null);
$$;

create function app.forget_guest(p_phone text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.bookings set guest_name = '-', guest_phone = null, notes = null where guest_phone = p_phone;
  update public.whatsapp_requests set guest_name = null, guest_phone = null, message = null where guest_phone = p_phone;
$$;

create function app.reset_expired_sold_out() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.menu_items set is_available = true, sold_out_until = null
   where not is_available and sold_out_until is not null and sold_out_until <= now();
$$;

revoke execute on function app.purge_guest_data(), app.forget_guest(text), app.reset_expired_sold_out(), app.audit() from public;
revoke execute on function public.set_item_availability(uuid, boolean, timestamptz), public.covers_today(public.branch_code),
  public.record_whatsapp_reply(uuid, text), public.revoke_device(uuid) from public, anon;
grant execute on function public.set_item_availability(uuid, boolean, timestamptz), public.covers_today(public.branch_code),
  public.record_whatsapp_reply(uuid, text), public.revoke_device(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mr-reset-sold-out', '*/15 * * * *', 'select app.reset_expired_sold_out()');
    perform cron.schedule('mr-purge-guest-data', '30 3 * * *', 'select app.purge_guest_data()');
  end if;
end $$;
