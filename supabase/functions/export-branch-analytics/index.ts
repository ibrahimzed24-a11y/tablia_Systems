// export-branch-analytics: CSV of one branch's workflow tasks for admins and managers (docs/sops/11).
// Renamed from the blueprint's export-resort-analytics. The caller's JWT is verified with Supabase Auth and
// every query runs as the caller, so row level security still limits the export to their branches.
// No service role key is used. Imports are pinned through deno.json (npm: specifiers).
import { createClient } from '@supabase/supabase-js';

const BRANCHES = ['corniche', 'new_damietta'] as const;
type Branch = (typeof BRANCHES)[number];
const MAX_DAYS = 366;
const PAGE = 1000;
const DAY_MS = 86_400_000;

class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Expose-Headers'] = 'Content-Disposition';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const isBranch = (v: unknown): v is Branch => typeof v === 'string' && (BRANCHES as readonly string[]).includes(v);

// RFC 4180: every value quoted, quotes inside doubled. Text that starts with = + - @ or a tab is prefixed
// with ' so a spreadsheet shows it instead of running it as a formula.
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const csvRow = (values: unknown[]) => values.map(csvField).join(',');

interface TaskRow {
  id: string; branch: Branch; title: string; priority: string; status: string; assigned_to: string | null;
  due_at: string | null; created_at: string; started_at: string | null; submitted_at: string | null;
  completed_at: string | null; failed_at: string | null; failure_reason: string | null;
  sops: { code: string | null; title_en: string } | null;
}

function parseDate(v: unknown, fallback: Date): Date {
  if (v === undefined || v === null || v === '') return fallback;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'bad_date');
  return d;
}

const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const originOk = !!origin && allowedOrigins.includes(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors(origin) });
  if (!originOk) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) throw new HttpError(401, 'missing_token');
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) throw new HttpError(401, 'invalid_token');

    // Role and branch from public.staff (via ops_me), never from user_metadata.
    const { data: me, error: meError } = await db.rpc('ops_me').maybeSingle();
    if (meError) throw new Error(meError.message);
    const role = (me as { my_role?: string } | null)?.my_role;
    const myBranch = (me as { my_branch?: string | null } | null)?.my_branch ?? null;
    if (role !== 'admin' && role !== 'manager') throw new HttpError(403, 'admin_or_manager_only');

    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (!isBranch(body.branch)) throw new HttpError(400, 'bad_branch');
    const branch = body.branch;
    if (role === 'manager' && myBranch && myBranch !== branch) throw new HttpError(403, 'other_branch');
    const to = parseDate(body.to, new Date());
    const from = parseDate(body.from, new Date(to.getTime() - 30 * DAY_MS));
    if (from > to || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) throw new HttpError(400, 'bad_range');

    const rows: TaskRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db
        .from('workflow_tasks')
        .select('id, branch, title, priority, status, assigned_to, due_at, created_at, started_at, submitted_at, completed_at, failed_at, failure_reason, sops(code, title_en)')
        .eq('branch', branch)
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as TaskRow[]));
      if (!data || data.length < PAGE) break;
    }

    const ids = [...new Set(rows.map((r) => r.assigned_to).filter((v): v is string => !!v))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data, error } = await db.from('staff').select('id, display_name').in('id', ids);
      if (error) throw new Error(error.message);
      for (const s of (data ?? []) as { id: string; display_name: string }[]) names.set(s.id, s.display_name);
    }

    const lines = [csvRow([
      'task_id', 'branch', 'title', 'sop_code', 'sop_title', 'priority', 'status', 'assignee', 'created_at', 'due_at',
      'started_at', 'submitted_at', 'completed_at', 'failed_at', 'minutes_to_complete', 'on_time', 'failure_reason',
    ])];
    for (const r of rows) {
      const minutes = r.completed_at ? Math.round((ms(r.completed_at) - ms(r.started_at ?? r.created_at)) / 60000) : null;
      const onTime = r.completed_at && r.due_at ? (ms(r.completed_at) <= ms(r.due_at) ? 'yes' : 'no') : null;
      lines.push(csvRow([
        r.id, r.branch, r.title, r.sops?.code ?? null, r.sops?.title_en ?? null, r.priority, r.status,
        r.assigned_to ? names.get(r.assigned_to) ?? r.assigned_to : null, r.created_at, r.due_at, r.started_at,
        r.submitted_at, r.completed_at, r.failed_at, minutes, onTime, r.failure_reason,
      ]));
    }

    const file = `tablia-${branch}-tasks-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
    // The byte order mark lets Excel open the Arabic text as UTF-8.
    return new Response('\uFEFF' + lines.join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        ...cors(origin),
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status, origin);
    console.error('export-branch-analytics', e instanceof Error ? e.message : e);
    return json({ error: 'server_error' }, 500, origin);
  }
});
