-- Mela Rossa operations engine: branches, SOPs and workflow tasks. See docs/sops/11-workflow-tasks.md.
-- Adapted from the resort blueprint: resorts became branches (Corniche, New Damietta).
--
-- This file sorts before 20261029000100_schema.sql but runs correctly in either order:
-- types, tables and seed rows are created only when missing, and the RLS helpers are plpgsql,
-- so they read public.staff when a query runs, not when this file runs.
-- Role and branch come from public.staff (written only by the service role and admins) and the
-- revoked-device check of SOP 05. user_metadata is never read: any signed-in user can edit it.

create extension if not exists pgcrypto;
create schema if not exists app;

do $$
begin
  if to_regtype('public.staff_role') is null then
    create type public.staff_role as enum ('admin', 'manager', 'front_desk', 'kitchen');
  end if;
  if to_regtype('public.branch_code') is null then
    create type public.branch_code as enum ('corniche', 'new_damietta');
  end if;
  if to_regtype('public.sop_category') is null then
    create type public.sop_category as enum ('opening_closing', 'front_of_house', 'kitchen', 'cafe', 'emergency');
  end if;
  if to_regtype('public.task_priority') is null then
    create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
  end if;
  if to_regtype('public.task_status') is null then
    create type public.task_status as enum ('backlog', 'assigned', 'in_progress', 'pending_verification', 'completed', 'failed');
  end if;
end $$;

-- ---- branches (the blueprint's resorts) ----
create table if not exists public.branches (
  code public.branch_code primary key,
  name_en text not null,
  name_ar text not null,
  phone text not null
);
insert into public.branches (code, name_en, name_ar, phone) values
  ('corniche', 'Nile Corniche', 'الكورنيش', '01280060772'),
  ('new_damietta', 'New Damietta', 'دمياط الجديدة', '01280060772')
on conflict (code) do nothing;
alter table public.branches enable row level security;

-- ---- who is calling (read at query time from public.staff) ----
create or replace function app.ops_role() returns public.staff_role
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.staff_role;
begin
  if auth.uid() is null or to_regclass('public.staff') is null then
    return null;
  end if;
  select s.role into r from public.staff s
   where s.id = auth.uid() and s.active
     and not exists (
       select 1 from public.staff_devices d
        where d.staff_id = s.id and d.revoked_at is not null
          and d.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid);
  return r;
end $$;

-- True when the caller works at branch b. A staff row with no branch covers both branches.
-- b = null (a "both branches" row) is true only for admins and staff who cover both branches.
create or replace function app.ops_in_branch(b public.branch_code) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.staff_role := app.ops_role(); sb public.branch_code;
begin
  if r is null then return false; end if;
  if r = 'admin' then return true; end if;
  select s.branch into sb from public.staff s where s.id = auth.uid();
  if sb is null then return true; end if;
  return b is not null and sb = b;
end $$;

create or replace function app.ops_is_manager(b public.branch_code) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(app.ops_role() in ('admin', 'manager'), false) and app.ops_in_branch(b);
end $$;

-- For the export function and the app: the caller's role and branch, nothing when not active staff.
create or replace function public.ops_me() returns table (my_role public.staff_role, my_branch public.branch_code)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.staff_role := app.ops_role();
begin
  if r is null then return; end if;
  return query select r, s.branch from public.staff s where s.id = auth.uid();
end $$;

-- ---- SOPs ----
create or replace function app.valid_sop_steps(j jsonb) returns boolean
language sql immutable as $$
  select case
    when j is null or jsonb_typeof(j) <> 'array' then false
    when jsonb_array_length(j) not between 1 and 50 then false
    else not exists (
      select 1 from jsonb_array_elements(j) s
       where jsonb_typeof(s) <> 'object'
          or coalesce(nullif(btrim(s ->> 'en'), ''), nullif(btrim(s ->> 'ar'), '')) is null
          or char_length(coalesce(s ->> 'en', '')) > 500
          or char_length(coalesce(s ->> 'ar', '')) > 500)
  end
$$;

create table if not exists public.sops (
  id uuid primary key default gen_random_uuid(),
  code text unique,                        -- 'SOP-01'... for docs/sops, null for SOPs published in the app
  category public.sop_category not null,
  branch public.branch_code references public.branches (code),   -- null = both branches
  title_en text not null check (char_length(title_en) between 1 and 160),
  title_ar text check (char_length(title_ar) <= 160),
  roles public.staff_role[] not null default '{}',
  steps jsonb not null check (app.valid_sop_steps(steps)),          -- [{"en": "...", "ar": "..."}]
  version int not null default 1 check (version > 0),
  source_path text,
  published_by uuid default auth.uid() references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- workflow tasks ----
create table if not exists public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  branch public.branch_code not null references public.branches (code),
  sop_id uuid references public.sops (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  details text check (char_length(details) <= 2000),
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'backlog',
  assigned_to uuid references auth.users (id) on delete set null,
  due_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  failure_reason text check (char_length(failure_reason) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workflow_tasks_branch_created_idx on public.workflow_tasks (branch, created_at desc);
create index if not exists workflow_tasks_open_idx on public.workflow_tasks (branch, status)
  where status not in ('completed', 'failed');
create index if not exists workflow_tasks_assignee_idx on public.workflow_tasks (assigned_to)
  where status not in ('completed', 'failed');

-- Stamps the lifecycle times and limits what a non-manager may change (SOP 11):
-- an assignee may only move assigned -> in_progress -> pending_verification.
-- Verifying (completed), failing and reopening are for managers and admins.
create or replace function app.ops_task_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  r public.staff_role := app.ops_role();
  manager boolean := coalesce(r in ('admin', 'manager'), false);
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if me is not null then new.created_by := me; end if;
    new.started_at := null; new.submitted_at := null; new.completed_at := null; new.failed_at := null; new.verified_by := null;
    if new.assigned_to is not null and new.status = 'backlog' then new.status := 'assigned'; end if;
  elsif me is not null then
    new.started_at := old.started_at; new.submitted_at := old.submitted_at;
    new.completed_at := old.completed_at; new.failed_at := old.failed_at; new.verified_by := old.verified_by;
    if not manager then
      if old.assigned_to is distinct from me then
        raise exception 'permission denied' using errcode = '42501';
      end if;
      new.failure_reason := old.failure_reason;
      if (new.branch, new.sop_id, new.title, new.details, new.priority, new.assigned_to, new.due_at, new.created_by, new.created_at)
         is distinct from
         (old.branch, old.sop_id, old.title, old.details, old.priority, old.assigned_to, old.due_at, old.created_by, old.created_at)
         or not (new.status = old.status
              or (old.status = 'assigned' and new.status = 'in_progress')
              or (old.status = 'in_progress' and new.status = 'pending_verification')) then
        raise exception 'only_status_steps_allowed' using errcode = '42501';
      end if;
    end if;
  end if;

  if me is not null then
    if new.status <> 'backlog' and new.assigned_to is null then
      raise exception 'task_needs_assignee' using errcode = 'P0001';
    end if;
    if new.assigned_to is not null
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to or new.branch is distinct from old.branch)
       and not exists (
         select 1 from public.staff s
          where s.id = new.assigned_to and s.active and (s.branch is null or s.branch = new.branch)) then
      raise exception 'assignee_not_in_branch' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status
      when 'in_progress' then
        new.started_at := coalesce(new.started_at, now());
      when 'pending_verification' then
        new.started_at := coalesce(new.started_at, now()); new.submitted_at := now();
      when 'completed' then
        new.completed_at := now(); new.failed_at := null; new.verified_by := me;
      when 'failed' then
        new.failed_at := now(); new.completed_at := null; new.verified_by := me;
      else
        new.completed_at := null; new.failed_at := null; new.verified_by := null;
    end case;
  end if;
  if new.status = 'failed' and coalesce(btrim(new.failure_reason), '') = '' then
    raise exception 'failure_reason_required' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A changed title, category, branch or step list is a new version.
create or replace function app.ops_sop_stamp() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.version := 1;
    new.published_at := now();
    if auth.uid() is not null then new.published_by := auth.uid(); end if;
  elsif (new.steps, new.title_en, new.title_ar, new.category, new.branch)
        is distinct from (old.steps, old.title_en, old.title_ar, old.category, old.branch) then
    new.version := old.version + 1;
    new.published_at := now();
    new.published_by := coalesce(auth.uid(), old.published_by);
  else
    new.version := old.version; new.published_at := old.published_at; new.published_by := old.published_by;
  end if;
  return new;
end $$;

-- Writes to public.audit_log once 20261029000100_schema.sql has created it.
create or replace function app.ops_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log (actor, action, entity, entity_id, before, after)
    values (auth.uid(), tg_op, tg_table_name, coalesce(n ->> 'id', o ->> 'id'), o, n);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists workflow_tasks_guard on public.workflow_tasks;
create trigger workflow_tasks_guard before insert or update on public.workflow_tasks
  for each row execute function app.ops_task_guard();
drop trigger if exists workflow_tasks_audit on public.workflow_tasks;
create trigger workflow_tasks_audit after insert or update or delete on public.workflow_tasks
  for each row execute function app.ops_audit();
drop trigger if exists sops_stamp on public.sops;
create trigger sops_stamp before insert or update on public.sops
  for each row execute function app.ops_sop_stamp();
drop trigger if exists sops_audit on public.sops;
create trigger sops_audit after insert or update or delete on public.sops
  for each row execute function app.ops_audit();

-- ---- row level security ----
alter table public.sops enable row level security;
alter table public.workflow_tasks enable row level security;

drop policy if exists sops_read on public.sops;
create policy sops_read on public.sops for select to authenticated
  using (app.ops_role() is not null and (branch is null or app.ops_in_branch(branch)));
drop policy if exists sops_insert on public.sops;
create policy sops_insert on public.sops for insert to authenticated
  with check (app.ops_is_manager(branch));
drop policy if exists sops_update on public.sops;
create policy sops_update on public.sops for update to authenticated
  using (app.ops_is_manager(branch)) with check (app.ops_is_manager(branch));
drop policy if exists sops_delete on public.sops;
create policy sops_delete on public.sops for delete to authenticated
  using (app.ops_role() = 'admin');

drop policy if exists tasks_read on public.workflow_tasks;
create policy tasks_read on public.workflow_tasks for select to authenticated
  using (app.ops_in_branch(branch));
drop policy if exists tasks_insert on public.workflow_tasks;
create policy tasks_insert on public.workflow_tasks for insert to authenticated
  with check (app.ops_is_manager(branch));
drop policy if exists tasks_update on public.workflow_tasks;
create policy tasks_update on public.workflow_tasks for update to authenticated
  using (app.ops_is_manager(branch) or (assigned_to = auth.uid() and app.ops_in_branch(branch)))
  with check (app.ops_is_manager(branch) or (assigned_to = auth.uid() and app.ops_in_branch(branch)));
drop policy if exists tasks_delete on public.workflow_tasks;
create policy tasks_delete on public.workflow_tasks for delete to authenticated
  using (app.ops_role() = 'admin');

grant usage on schema app to authenticated;
revoke execute on function app.ops_role(), app.ops_in_branch(public.branch_code), app.ops_is_manager(public.branch_code),
  public.ops_me() from public, anon;
grant execute on function app.ops_role(), app.ops_in_branch(public.branch_code), app.ops_is_manager(public.branch_code),
  public.ops_me() to authenticated, service_role;
revoke execute on function app.ops_task_guard(), app.ops_sop_stamp(), app.ops_audit() from public, anon;

-- ---- realtime: the staff app subscribes to workflow_tasks per branch; RLS decides what each session receives ----
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_tasks') then
    alter publication supabase_realtime add table public.workflow_tasks;
  end if;
end $$;

-- ---- seed: the SOPs in docs/sops (category mapping in docs/sops/README.md) ----
insert into public.sops (code, category, branch, title_en, title_ar, roles, steps, source_path) values
('SOP-01', 'opening_closing', null, 'Opening and closing checklist', 'قائمة الفتح والقفل', '{manager,front_desk,kitchen}', $j$[
  {"en": "Opening (from 09:30): open Mela Rossa Staff and check your name, role and branch in the header.", "ar": "الفتح (من ٩:٣٠): افتح أبلكيشن Mela Rossa Staff واتأكد إن اسمك ودورك والفرع صح."},
  {"en": "Check that the sync badge is green (Synced). If it shows Offline or pending changes, follow SOP 07 first.", "ar": "علامة المزامنة لازم تبقى خضرا. لو حمرا أو فيها رقم، شوف SOP 07."},
  {"en": "Bookings, Today: read the list to the floor team and give the cover count to the kitchen lead.", "ar": "اقرا حجوزات النهارده للصالة وقول عدد الأفراد للمطبخ."},
  {"en": "WhatsApp inbox: handle every overnight New request with SOP 04 before 10:30 AM.", "ar": "رد على كل طلبات الواتساب الجديدة قبل ١٠:٣٠."},
  {"en": "Kitchen lead: switch items that are back in stock to Available (SOP 02).", "ar": "المطبخ: راجع الأصناف اللي خلصت امبارح، ولو رجعت خليها متاح."},
  {"en": "Corniche only: check that the Breakfast section is Available. New Damietta does not serve breakfast.", "ar": "الكورنيش بس: اتأكد إن الفطار متاح."},
  {"en": "Check that the guest WhatsApp phone (01280060772) is charged and signed in at the front desk.", "ar": "اتأكد إن موبايل واتساب المطعم (01280060772) مشحون وشغال على الاستقبال."},
  {"en": "Operations: open the Operations tab and start the opening tasks assigned to you (SOP 11).", "ar": "التشغيل: افتح تبويب التشغيل وابدأ المهام اللي باسمك (SOP 11)."},
  {"en": "Closing (from 22:30): mark today's bookings Completed or No-show. Nothing from today stays Pending or Confirmed.", "ar": "القفل (من ١٠:٣٠ بالليل): كل حجز النهارده يتقفل: خلص للي جه ومجاش للي ماجاش."},
  {"en": "Every WhatsApp request is Replied, Converted or Closed, or noted in the shift log.", "ar": "مفيش طلب واتساب يفضل جديد."},
  {"en": "Submit your closing tasks for verification. The shift manager verifies them before leaving.", "ar": "ابعت مهام القفل للمراجعة، والمدير يراجعها قبل ما يمشي."},
  {"en": "Check the badge is green with 0 pending, then lock the tablet. Do not sign out.", "ar": "علامة المزامنة خضرا وصفر مستني، واقفل التابلت من غير Sign out."}
]$j$::jsonb, 'docs/sops/01-opening-closing.md'),
('SOP-02', 'kitchen', null, 'Editing the menu', 'تعديل المنيو', '{admin,manager,kitchen}', $j$[
  {"en": "Change a price (admin, manager): Menu, search the item, Edit, type the EGP price (for example 145 or 145.50) and Save.", "ar": "تغيير السعر للمدير بس: دوّر على الصنف، تعديل، اكتب السعر، حفظ."},
  {"en": "Tell the other branch's manager when a shared price changes.", "ar": "بلّغ مدير الفرع التاني لما السعر يتغير."},
  {"en": "Add an item: open the section, Add item, fill in the Arabic name and the price, choose the group and save.", "ar": "صنف جديد: افتح القسم، صنف جديد، الاسم بالعربي والسعر، حفظ."},
  {"en": "Sold out (kitchen): tap the item, then Sold out today or Sold out, no end date.", "ar": "صنف خلص؟ دوس عليه واختار خلص النهارده أو خلص لحد ما نرجّعه."},
  {"en": "Tell the front desk out loud as well.", "ar": "قول للـ front desk بصوتك كمان."},
  {"en": "When stock is back: tap the item, then Available.", "ar": "لما يرجع: دوس عليه واختار متاح."},
  {"en": "After a price change, search the item and confirm the new price shows.", "ar": "بعد تغيير السعر، دوّر على الصنف واتأكد إن السعر الجديد ظاهر."}
]$j$::jsonb, 'docs/sops/02-menu-editing.md'),
('SOP-03', 'front_of_house', null, 'Handling a table booking', 'التعامل مع حجز ترابيزة', '{front_desk,manager}', $j$[
  {"en": "Bookings, New: branch, date, time (10:00 to 22:00), guests (1 to 40), guest name, phone and source. Save; it starts as Pending.", "ar": "حجز جديد: الفرع، اليوم، الساعة، عدد الأفراد، الاسم، الموبايل، جه منين. احفظ، هيبقى مستني."},
  {"en": "Confirm with the guest in the same conversation, then set Confirmed.", "ar": "أكد مع الضيف وبعدين خليه متأكد."},
  {"en": "Change: edit the same booking and tell the guest in the channel they used.", "ar": "تغيير: عدّل نفس الحجز وبلّغ الضيف بنفس الطريقة اللي كلمك بيها."},
  {"en": "Cancel: press Cancel and pick a reason. Cancelled bookings are never deleted.", "ar": "إلغاء: دوس إلغاء واختار السبب، والحجز مبيتمسحش."},
  {"en": "Guest arrives: Seated. Guest leaves: Completed.", "ar": "الضيف وصل: قعد. مشي: خلص."},
  {"en": "20 minutes late with no word: call once. No answer: No-show. Do not send a WhatsApp message as well.", "ar": "عدّى ٢٠ دقيقة ومجاش: كلمه مرة واحدة بس. مردش؟ مجاش. ومتبعتلوش واتساب."},
  {"en": "More than 12 guests: a manager confirms.", "ar": "أكتر من ١٢ فرد: المدير لازم يوافق."}
]$j$::jsonb, 'docs/sops/03-table-bookings.md'),
('SOP-04', 'front_of_house', null, 'WhatsApp booking requests', 'طلبات الحجز على واتساب', '{front_desk,manager}', $j$[
  {"en": "Log it: WhatsApp inbox, New request, with guest name, phone, branch, date, time, guests and message.", "ar": "سجّل الطلب: الاسم والموبايل والفرع واليوم والساعة وعدد الأفراد والرسالة."},
  {"en": "Check availability for that branch and time in Bookings.", "ar": "شوف المكان فاضي ولا لأ في الحجوزات."},
  {"en": "Reply: press Reply on WhatsApp, edit the text and send it yourself from 01280060772. The app never sends by itself.", "ar": "رد: دوس رد على واتساب وابعت إنت بنفسك من موبايل المطعم. الأبلكيشن عمره ما بيبعت لوحده."},
  {"en": "A second reply to the same guest within 24 hours needs a real reason.", "ar": "متبعتش لنفس الضيف مرتين في ٢٤ ساعة من غير سبب."},
  {"en": "Convert: when the guest agrees, press Create booking.", "ar": "لو وافق دوس اعمل حجز."},
  {"en": "Close: if it is not a booking, set Closed with a short reason.", "ar": "لو مش حجز اقفله واكتب السبب."},
  {"en": "Every New request gets a reply within 30 minutes during opening hours.", "ar": "رد على أي طلب جديد في خلال نص ساعة."}
]$j$::jsonb, 'docs/sops/04-whatsapp-requests.md'),
('SOP-05', 'front_of_house', null, 'Staff onboarding with the QR code', 'تسجيل موظف جديد بالـ QR', '{admin,manager}', $j$[
  {"en": "Staff, Add staff / device: name, role, branch and a device label.", "ar": "الموظفين، إضافة موظف/جهاز: الاسم والدور والفرع واسم الجهاز."},
  {"en": "Generate QR. It expires in 10 minutes. Show it only to the new staff member; never photograph or send it.", "ar": "اعمل QR، بيخلص في ١٠ دقايق. متصورهوش ومتبعتهوش لحد."},
  {"en": "The new staff member scans it, opens the link and checks name, role and branch in the header.", "ar": "الموظف الجديد يعمل Scan ويتأكد من اسمه ودوره والفرع."},
  {"en": "Install it: browser menu, Add to Home screen.", "ar": "يضيفه على الشاشة الرئيسية من قايمة المتصفح."},
  {"en": "Lost device: Staff, the person, Devices, Revoke.", "ar": "جهاز ضاع: الموظفين، الشخص، الأجهزة، إلغاء الجهاز."},
  {"en": "Staff leaving: an admin switches Active off, which blocks every device they have.", "ar": "موظف ماشي: الأدمن يقفل شغّال، وده بيقفل كل أجهزته."}
]$j$::jsonb, 'docs/sops/05-staff-onboarding-qr.md'),
('SOP-06', 'front_of_house', null, 'Staff roles and permissions', 'أدوار الموظفين والصلاحيات', '{admin}', $j$[
  {"en": "Admin, Staff, the person, Role: choose the role and Save."},
  {"en": "The change applies to the person's next request. Ask them to pull to refresh."},
  {"en": "Write the reason in the shift log."},
  {"en": "Roles and branches are read from the staff table only, never from user_metadata (SOP 11)."}
]$j$::jsonb, 'docs/sops/06-roles-permissions.md'),
('SOP-07', 'front_of_house', null, 'Offline use of the app and syncing', 'استخدام الأبلكيشن من غير نت والمزامنة', '{admin,manager,front_desk,kitchen}', $j$[
  {"en": "If the badge shows Offline, keep working. Writes queue up.", "ar": "لو مفيش نت كمّل شغلك، التغييرات بتستنى."},
  {"en": "When the connection is back the badge turns amber, then green. If it does not, press the badge, then Sync now.", "ar": "لما النت يرجع العلامة تخضر. لو لأ دوس عليها واختار زامن دلوقتي."},
  {"en": "Conflicts: for each one choose Keep mine or Keep server. If unsure, keep server and redo the change by hand.", "ar": "لو فيه تعارض اختار خلي بتاعي أو خلي اللي على السيرفر، ولو مش متأكد خلي اللي على السيرفر."},
  {"en": "Operations tasks need a connection; they are not queued offline (SOP 11).", "ar": "مهام التشغيل محتاجة نت، مش بتستنى أوفلاين."}
]$j$::jsonb, 'docs/sops/07-offline-sync.md'),
('SOP-08', 'emergency', null, 'Deployment, rollback and secrets rotation', 'النشر والرجوع وتغيير المفاتيح', '{admin}', $j$[
  {"en": "Open a pull request. CI runs install, lint, typecheck and build. All must pass."},
  {"en": "Test the Vercel preview of the changed screens on a phone."},
  {"en": "Database changes go in a new file in supabase/migrations. Never edit an applied migration."},
  {"en": "Merge to main: the workflow deploys to Vercel, runs supabase db push --include-all and deploys both edge functions."},
  {"en": "Roll back the app: Vercel, Deployments, the last good deployment, Promote to Production."},
  {"en": "Roll back the database with a new migration that reverses the change. For data loss, see SOP 09."},
  {"en": "Roll back an edge function by redeploying it from the last good commit."}
]$j$::jsonb, 'docs/sops/08-deploy-rollback-secrets.md'),
('SOP-09', 'emergency', null, 'Backup and restore of Supabase', 'النسخ الاحتياطي والاسترجاع', '{admin}', $j$[
  {"en": "Every Monday morning: dump the database with the Supabase CLI on the admin computer."},
  {"en": "Encrypt the files and store them in the owner's private cloud drive."},
  {"en": "Keep 8 weekly and 12 monthly copies and delete older ones; the dumps contain guest phone numbers."},
  {"en": "Restore: follow Steps: restore in docs/sops/09-backup-restore.md, then check bookings, menu, SOPs and tasks."}
]$j$::jsonb, 'docs/sops/09-backup-restore.md'),
('SOP-10', 'emergency', null, 'Incident response and privacy', 'التعامل مع الحوادث والخصوصية', '{admin,manager}', $j$[
  {"en": "Detect and declare: tell the admin by phone. The admin opens an incident note with the time and what was seen."},
  {"en": "Contain: revoke the affected devices, sessions or keys."},
  {"en": "Assess with audit_log, Supabase logs and Vercel logs: what data was touched and for how long."},
  {"en": "Notify: if guest personal data was exposed, the owner decides on notifying guests and the authorities under Law 151 of 2020, with legal advice."},
  {"en": "Recover, then hold a review within 7 days and update the affected SOPs."}
]$j$::jsonb, 'docs/sops/10-incident-privacy.md'),
('SOP-11', 'front_of_house', null, 'Operations tasks and published SOPs', 'مهام التشغيل والإجراءات', '{admin,manager,front_desk,kitchen}', $j$[
  {"en": "Manager: Operations, New task: title, priority, SOP, assignee and due time. A task with an assignee starts as Assigned.", "ar": "المدير: التشغيل، مهمة جديدة: العنوان والأولوية والإجراء والمسؤول والميعاد."},
  {"en": "Assignee: press Start when you begin, then Submit for verification when it is done.", "ar": "المسؤول: دوس ابدأ لما تبدأ، ولما تخلص دوس ابعت للمراجعة."},
  {"en": "Manager: check the work in person, then Verify, or Fail with the reason.", "ar": "المدير: راجع الشغل بنفسك، وبعدين تمام أو مااتعملتش مع السبب."},
  {"en": "Publish an SOP: Operations, Publish SOP: category, branch, titles and numbered steps.", "ar": "نشر إجراء: التشغيل، انشر إجراء: التصنيف والفرع والعنوان والخطوات."},
  {"en": "Export: choose From and To, then Export CSV (admin and manager).", "ar": "التصدير: اختار من ولحد ودوس نزّل CSV (للأدمن والمدير)."}
]$j$::jsonb, 'docs/sops/11-workflow-tasks.md')
on conflict (code) do nothing;
