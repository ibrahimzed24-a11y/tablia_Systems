-- Custom domains (written only by the provision-domain edge function) and the hourly metrics job
-- for the Corniche and New Damietta branches. No key or token is stored in the database.

-- ---- custom domains ----
create table if not exists public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  hostname text not null unique check (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  branch public.branch_code references public.branches (code),          -- null = the whole staff app
  cname_target text not null default 'cname.vercel-dns.com',
  status text not null default 'pending' check (status in ('pending', 'verifying', 'active', 'failed', 'removed')),
  vercel_verified boolean not null default false,
  cloudflare_record_id text,
  last_error text check (char_length(last_error) <= 500),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.custom_domains enable row level security;
drop policy if exists domains_read on public.custom_domains;
create policy domains_read on public.custom_domains for select to authenticated using (app.ops_role() = 'admin');
-- No insert, update or delete policy: only provision-domain writes, after it has checked that the caller is an admin.
drop trigger if exists custom_domains_touch on public.custom_domains;
create trigger custom_domains_touch before update on public.custom_domains for each row execute function app.touch_updated_at();

-- ---- hourly branch metrics ----
create table if not exists public.branch_metrics_hourly (
  branch public.branch_code not null references public.branches (code),
  hour_start timestamptz not null,
  bookings_created int not null default 0,
  covers_booked int not null default 0,
  bookings_cancelled int not null default 0,
  bookings_no_show int not null default 0,
  whatsapp_new int not null default 0,
  whatsapp_replies int not null default 0,
  tasks_open int not null default 0,
  tasks_completed int not null default 0,
  tasks_failed int not null default 0,
  items_sold_out int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (branch, hour_start)
);
alter table public.branch_metrics_hourly enable row level security;
drop policy if exists metrics_read on public.branch_metrics_hourly;
create policy metrics_read on public.branch_metrics_hourly for select to authenticated using (app.ops_is_manager(branch));

-- Snapshot one clock hour (default: the hour that just ended) for both branches. Re-running an hour overwrites it.
create or replace function app.snapshot_branch_metrics(p_hour timestamptz default now() - interval '1 hour')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h timestamptz := date_trunc('hour', p_hour);
  e timestamptz := date_trunc('hour', p_hour) + interval '1 hour';
  b public.branch_code;
begin
  foreach b in array array['corniche', 'new_damietta']::public.branch_code[] loop
    insert into public.branch_metrics_hourly as m (branch, hour_start, bookings_created, covers_booked, bookings_cancelled,
      bookings_no_show, whatsapp_new, whatsapp_replies, tasks_open, tasks_completed, tasks_failed, items_sold_out, computed_at)
    values (b, h,
      (select count(*) from public.bookings where branch = b and created_at >= h and created_at < e),
      (select coalesce(sum(guests), 0) from public.bookings where branch = b and created_at >= h and created_at < e and status <> 'cancelled'),
      (select count(*) from public.bookings where branch = b and status = 'cancelled' and updated_at >= h and updated_at < e),
      (select count(*) from public.bookings where branch = b and status = 'no_show' and updated_at >= h and updated_at < e),
      (select count(*) from public.whatsapp_requests where branch = b and created_at >= h and created_at < e),
      (select count(*) from public.whatsapp_replies wr join public.whatsapp_requests r on r.id = wr.request_id
        where r.branch = b and wr.sent_at >= h and wr.sent_at < e),
      (select count(*) from public.workflow_tasks where branch = b and created_at < e and status not in ('completed', 'failed')),
      (select count(*) from public.workflow_tasks where branch = b and completed_at >= h and completed_at < e),
      (select count(*) from public.workflow_tasks where branch = b and failed_at >= h and failed_at < e),
      (select count(*) from public.menu_items i join public.menu_sections s on s.id = i.section_id
        where not i.is_available and (s.branch is null or s.branch = b)),
      now())
    on conflict (branch, hour_start) do update set
      bookings_created = excluded.bookings_created, covers_booked = excluded.covers_booked,
      bookings_cancelled = excluded.bookings_cancelled, bookings_no_show = excluded.bookings_no_show,
      whatsapp_new = excluded.whatsapp_new, whatsapp_replies = excluded.whatsapp_replies, tasks_open = excluded.tasks_open,
      tasks_completed = excluded.tasks_completed, tasks_failed = excluded.tasks_failed,
      items_sold_out = excluded.items_sold_out, computed_at = excluded.computed_at;
  end loop;
end $$;
revoke execute on function app.snapshot_branch_metrics(timestamptz) from public, anon, authenticated;

-- Runs inside the database at 5 minutes past every hour (pg_cron). Enable pg_cron in the dashboard first (README).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mr-branch-metrics-hourly', '5 * * * *', 'select app.snapshot_branch_metrics()');
  end if;
end $$;
