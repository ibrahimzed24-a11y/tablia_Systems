// provision-domain: adds, verifies and removes a custom domain for the staff app (admins only).
// Vercel attaches the domain to the project; Cloudflare gets the CNAME (DNS only) to cname.vercel-dns.com,
// and Vercel then issues and renews the TLS certificate. Every token is read from function secrets
// (supabase secrets set ...), never from the app: nothing here may use a VITE_ or NEXT_PUBLIC_ name.
// The caller's JWT is checked first; the service role key (injected by Supabase, server side only)
// is used only after that, to write public.custom_domains, which has no write policy for staff.
import { createClient } from '@supabase/supabase-js';

const CNAME_TARGET = 'cname.vercel-dns.com';
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BRANCHES = ['corniche', 'new_damietta'];

class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error('missing env ' + name);
  return v;
}

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
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

// ---- Vercel (https://vercel.com/docs/rest-api) ----
async function vercel(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const team = Deno.env.get('VERCEL_TEAM_ID');
  const url = new URL('https://api.vercel.com' + path);
  if (team) url.searchParams.set('teamId', team);
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + env('VERCEL_API_TOKEN'), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // 409 domain_already_in_use_by_this_project is fine when adding twice.
  if (!res.ok && !(res.status === 409 && method === 'POST')) {
    const err = (data.error as { code?: string } | undefined)?.code ?? String(res.status);
    throw new HttpError(502, 'vercel_' + err);
  }
  return data;
}

// ---- Cloudflare (https://developers.cloudflare.com/api/) ----
async function cloudflare(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.cloudflare.com/client/v4/zones/' + env('CLOUDFLARE_ZONE_ID') + path, {
    method,
    headers: { Authorization: 'Bearer ' + env('CLOUDFLARE_API_TOKEN'), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; result?: Record<string, unknown> };
  if (!res.ok || data.success === false) throw new HttpError(502, 'cloudflare_' + res.status);
  return data.result ?? {};
}

const useCloudflare = () => !!Deno.env.get('CLOUDFLARE_API_TOKEN') && !!Deno.env.get('CLOUDFLARE_ZONE_ID');

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const originOk = !!origin && allowedOrigins.includes(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors(origin) });
  if (!originOk) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) throw new HttpError(401, 'missing_token');
    const asCaller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: 'Bearer ' + jwt } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await asCaller.auth.getUser(jwt);
    if (authError || !auth.user) throw new HttpError(401, 'invalid_token');
    // Role from public.staff (via ops_me), never from user_metadata.
    const { data: me } = await asCaller.rpc('ops_me').maybeSingle();
    if ((me as { my_role?: string } | null)?.my_role !== 'admin') throw new HttpError(403, 'admin_only');

    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const hostname = String(body.hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!HOST.test(hostname) || hostname.length > 253) throw new HttpError(400, 'bad_hostname');
    const branch = body.branch == null || body.branch === '' ? null : String(body.branch);
    if (branch !== null && !BRANCHES.includes(branch)) throw new HttpError(400, 'bad_branch');

    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const project = encodeURIComponent(env('VERCEL_PROJECT_ID'));
    const domain = encodeURIComponent(hostname);
    const { data: row } = await db.from('custom_domains').select('*').eq('hostname', hostname).maybeSingle();

    if (action === 'add') {
      const v = await vercel('POST', '/v10/projects/' + project + '/domains', { name: hostname });
      let recordId = (row as { cloudflare_record_id?: string | null } | null)?.cloudflare_record_id ?? null;
      if (useCloudflare() && !recordId) {
        // proxied: false, so Vercel can answer the ACME HTTP-01 challenge and issue the certificate itself.
        const r = await cloudflare('POST', '/dns_records', { type: 'CNAME', name: hostname, content: CNAME_TARGET, proxied: false, ttl: 1 });
        recordId = String(r.id ?? '') || null;
      }
      const verified = v.verified === true;
      const { data, error } = await db.from('custom_domains').upsert({
        hostname, branch, cname_target: CNAME_TARGET, status: verified ? 'active' : 'verifying', vercel_verified: verified,
        cloudflare_record_id: recordId, last_error: null, requested_by: auth.user.id,
      }, { onConflict: 'hostname' }).select().single();
      if (error) throw new Error(error.message);
      return json({ domain: data, verification: v.verification ?? [] }, 200, origin);
    }

    if (!row) throw new HttpError(404, 'unknown_domain');

    if (action === 'verify') {
      const v = await vercel('POST', '/v9/projects/' + project + '/domains/' + domain + '/verify');
      const verified = v.verified === true;
      const { data, error } = await db.from('custom_domains')
        .update({ vercel_verified: verified, status: verified ? 'active' : 'verifying' }).eq('hostname', hostname).select().single();
      if (error) throw new Error(error.message);
      return json({ domain: data, verification: v.verification ?? [] }, 200, origin);
    }

    if (action === 'remove') {
      await vercel('DELETE', '/v9/projects/' + project + '/domains/' + domain);
      const recordId = (row as { cloudflare_record_id?: string | null }).cloudflare_record_id;
      if (useCloudflare() && recordId) await cloudflare('DELETE', '/dns_records/' + encodeURIComponent(recordId));
      const { data, error } = await db.from('custom_domains')
        .update({ status: 'removed', vercel_verified: false, cloudflare_record_id: null }).eq('hostname', hostname).select().single();
      if (error) throw new Error(error.message);
      return json({ domain: data }, 200, origin);
    }

    throw new HttpError(400, 'bad_action');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status, origin);
    console.error('provision-domain', e instanceof Error ? e.message : e);
    return json({ error: 'server_error' }, 500, origin);
  }
});
