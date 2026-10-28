// verify-provision-qr: issues and redeems the short-lived, single-use staff QR token (docs/sops/05).
// Imports are pinned through deno.json (npm: specifiers), no esm.sh or unpinned URLs.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose';

const ISSUER = 'mela-rossa-admin';
const AUDIENCE = 'staff-provision';
const TTL_SECONDS = 600;
const ROLES = ['admin', 'manager', 'front_desk', 'kitchen'] as const;
const BRANCHES = ['corniche', 'new_damietta'] as const;
type Role = (typeof ROLES)[number];
type Branch = (typeof BRANCHES)[number];

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

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
const isBranch = (v: unknown): v is Branch => typeof v === 'string' && (BRANCHES as readonly string[]).includes(v);

function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const originOk = !!origin && allowedOrigins.includes(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors(origin) });
  if (!originOk) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== 'string') throw new HttpError(400, 'bad_request');
    const secretText = env('PROVISION_JWT_SECRET');
    if (secretText.length < 32) throw new Error('PROVISION_JWT_SECRET too short');
    const secret = new TextEncoder().encode(secretText);
    const admin = serviceClient();
    if (body.action === 'issue') return json(await issue(req, body, admin, secret), 200, origin);
    if (body.action === 'redeem') return json(await redeem(body, admin, secret), 200, origin);
    throw new HttpError(400, 'unknown_action');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status, origin);
    console.error('verify-provision-qr failed:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'internal_error' }, 500, origin);
  }
});

async function issue(req: Request, body: Record<string, unknown>, admin: SupabaseClient, secret: Uint8Array) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'not_signed_in');
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u.user) throw new HttpError(401, 'not_signed_in');

  const { data: me } = await admin.from('staff').select('id, role, branch, active').eq('id', u.user.id).maybeSingle();
  if (!me || !me.active || (me.role !== 'admin' && me.role !== 'manager')) throw new HttpError(403, 'forbidden');
  const sid = decodeJwt(jwt).session_id;
  if (typeof sid === 'string') {
    const { data: revoked } = await admin.from('staff_devices').select('id').eq('session_id', sid).not('revoked_at', 'is', null).limit(1);
    if (revoked && revoked.length) throw new HttpError(403, 'device_revoked');
  }

  let role: Role;
  let branch: Branch | null;
  let displayName: string;
  let staffId: string | null = null;
  if (typeof body.staff_id === 'string' && body.staff_id) {
    const { data: target } = await admin.from('staff').select('id, display_name, role, branch, active').eq('id', body.staff_id).maybeSingle();
    if (!target || !target.active) throw new HttpError(404, 'staff_not_found');
    role = target.role; branch = target.branch; displayName = target.display_name; staffId = target.id;
  } else {
    if (!isRole(body.role)) throw new HttpError(400, 'bad_role');
    if (body.branch != null && body.branch !== '' && !isBranch(body.branch)) throw new HttpError(400, 'bad_branch');
    role = body.role;
    branch = isBranch(body.branch) ? body.branch : null;
    displayName = String(body.display_name ?? '').trim();
    if (!displayName || displayName.length > 80) throw new HttpError(400, 'bad_name');
  }
  if (me.role === 'manager') {
    if (role !== 'front_desk' && role !== 'kitchen') throw new HttpError(403, 'manager_cannot_issue_role');
    if (me.branch && branch !== me.branch) throw new HttpError(403, 'other_branch');
  }

  const label = String(body.device_label ?? '').trim().slice(0, 80) || 'Staff device';
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  const { error: insErr } = await admin.from('provision_tokens').insert({
    jti, display_name: displayName, role, branch, device_label: label, staff_id: staffId,
    created_by: me.id, expires_at: expiresAt.toISOString(),
  });
  if (insErr) throw new Error(insErr.message);

  const token = await new SignJWT({ role, branch })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setJti(jti).setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
  return { token, jti, expires_at: expiresAt.toISOString() };
}

async function redeem(body: Record<string, unknown>, admin: SupabaseClient, secret: Uint8Array) {
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token || token.length > 2048) throw new HttpError(400, 'bad_token');

  let jti: string;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], maxTokenAge: `${TTL_SECONDS}s`, clockTolerance: 5,
    });
    if (!payload.jti) throw new HttpError(400, 'bad_token');
    jti = payload.jti;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof errors.JWTExpired) throw new HttpError(410, 'expired');
    throw new HttpError(401, 'bad_token');
  }

  // Single use: one UPDATE that only matches an unused, unrevoked, unexpired token.
  const now = new Date().toISOString();
  const { data: tok, error } = await admin.from('provision_tokens').update({ used_at: now })
    .eq('jti', jti).is('used_at', null).is('revoked_at', null).gt('expires_at', now)
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!tok) {
    const { data: t } = await admin.from('provision_tokens').select('used_at, revoked_at').eq('jti', jti).maybeSingle();
    if (!t) throw new HttpError(404, 'unknown_token');
    if (t.used_at) throw new HttpError(409, 'already_used');
    if (t.revoked_at) throw new HttpError(410, 'revoked');
    throw new HttpError(410, 'expired');
  }

  const domain = Deno.env.get('STAFF_EMAIL_DOMAIN') ?? 'staff.mela-rossa.internal';
  let staffId: string | null = tok.staff_id;
  let email: string;
  if (staffId) {
    const { data, error: ge } = await admin.auth.admin.getUserById(staffId);
    if (ge || !data.user?.email) throw new Error('staff user missing');
    email = data.user.email;
  } else {
    email = `staff-${crypto.randomUUID()}@${domain}`;
    const { data, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: { provisioned_by: 'qr' } });
    if (ce || !data.user) throw new Error(ce?.message ?? 'create user failed');
    staffId = data.user.id;
    const { error: se } = await admin.from('staff').insert({ id: staffId, display_name: tok.display_name, role: tok.role, branch: tok.branch });
    if (se) { await admin.auth.admin.deleteUser(staffId); throw new Error(se.message); }
  }

  // Create the staff session: magic link token verified server side, never emailed.
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (le || !link.properties?.hashed_token) throw new Error(le?.message ?? 'link failed');
  const authClient = serviceClient(); // separate client so the service client never switches to the user session
  const { data: v, error: ve } = await authClient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (ve || !v.session) throw new Error(ve?.message ?? 'session failed');

  const sessionId = decodeJwt(v.session.access_token).session_id;
  await admin.from('staff_devices').insert({
    staff_id: staffId, label: tok.device_label, provision_jti: jti, last_seen_at: now,
    session_id: typeof sessionId === 'string' ? sessionId : null,
  });
  return { access_token: v.session.access_token, refresh_token: v.session.refresh_token };
}
