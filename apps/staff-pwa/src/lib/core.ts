import { createClient } from '@supabase/supabase-js';
import { createStore, get, set } from 'idb-keyval';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
export const provisionUrl = import.meta.env.VITE_PROVISION_FUNCTION_URL || `${url}/functions/v1/verify-provision-qr`;
export const anon = anonKey;

// ---- types (mirror supabase/migrations) ----
export type Role = 'admin' | 'manager' | 'front_desk' | 'kitchen';
export type Branch = 'corniche' | 'new_damietta';
export type BookingStatus = 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type WaStatus = 'new' | 'replied' | 'converted' | 'closed';
export const ROLES: Role[] = ['admin', 'manager', 'front_desk', 'kitchen'];
export const BRANCHES: Branch[] = ['corniche', 'new_damietta'];

export interface Staff { id: string; display_name: string; role: Role; branch: Branch | null; active: boolean }
export interface MenuSection { id: string; slug: string; name_en: string | null; name_ar: string; branch: Branch | null; sort: number }
export interface MenuItem {
  id: string; section_id: string; group_ar: string | null; group_en: string | null; name_ar: string; name_en: string | null;
  description_ar: string | null; price_egp: number | null; is_available: boolean; sold_out_until: string | null; sort: number; updated_at: string;
}
export interface Booking {
  id: string; branch: Branch; booking_date: string; booking_time: string; guests: number; guest_name: string; guest_phone: string | null;
  status: BookingStatus; source: string; notes: string | null; updated_at: string;
}
export interface WaRequest {
  id: string; branch: Branch; guest_name: string | null; guest_phone: string | null; message: string | null; requested_date: string | null;
  requested_time: string | null; guests: number | null; status: WaStatus; reply_count: number; last_replied_at: string | null; updated_at: string;
}
export interface Device { id: string; staff_id: string; label: string; created_at: string; revoked_at: string | null }

type Permission = 'menu.edit' | 'menu.availability' | 'bookings' | 'whatsapp' | 'staff' | 'staff.admin';
const MATRIX: Record<Permission, Role[]> = {
  'menu.edit': ['admin', 'manager'],
  'menu.availability': ['admin', 'manager', 'kitchen'],
  bookings: ['admin', 'manager', 'front_desk'],
  whatsapp: ['admin', 'manager', 'front_desk'],
  staff: ['admin', 'manager'],
  'staff.admin': ['admin'],
};
export const can = (role: Role, p: Permission) => MATRIX[p].includes(role);

// ---- Cairo time helpers ----
const cairoParts = (d = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return p as Record<string, string>;
};
export const todayCairo = () => { const p = cairoParts(); return `${p.year}-${p.month}-${p.day}`; };
export function endOfDayCairo(): string {
  const now = new Date(); const p = cairoParts(now);
  const left = (24 - Number(p.hour)) * 3600 - Number(p.minute) * 60 - Number(p.second);
  return new Date(now.getTime() + left * 1000).toISOString();
}
export const isSoldOut = (i: MenuItem) => !i.is_available && (!i.sold_out_until || new Date(i.sold_out_until) > new Date());

// ---- offline outbox (docs/sops/07-offline-sync.md) ----
export interface OutboxOp {
  id: string; staffId: string; createdAt: string; kind: 'insert' | 'update' | 'rpc';
  table?: 'bookings' | 'whatsapp_requests'; rowId?: string; patch?: Record<string, unknown>; baseUpdatedAt?: string | null;
  fn?: 'set_item_availability' | 'record_whatsapp_reply'; args?: Record<string, unknown>; force?: boolean;
}
export interface Conflict { op: OutboxOp; reason: string }
export type NewOp = Omit<OutboxOp, 'id' | 'staffId' | 'createdAt'>;

const store = createStore('mela-rossa-staff', 'outbox');
export const outboxEvents = new EventTarget();
let flushing = false;
const readOps = async () => (await get<OutboxOp[]>('ops', store)) ?? [];
const readConflicts = async () => (await get<Conflict[]>('conflicts', store)) ?? [];
async function save(ops: OutboxOp[], conflicts: Conflict[]) {
  await set('ops', ops, store); await set('conflicts', conflicts, store);
  outboxEvents.dispatchEvent(new Event('change'));
}
export async function outboxState() { return { pending: (await readOps()).length, conflicts: await readConflicts(), syncing: flushing }; }

export async function submit(op: NewOp, staffId: string) {
  const ops = await readOps();
  ops.push({ ...op, id: crypto.randomUUID(), staffId, createdAt: new Date().toISOString() });
  await save(ops, await readConflicts());
  void flush(staffId);
}

const isNetwork = (msg: string) => !navigator.onLine || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg);
type Outcome = { ok: true } | { ok: false; network: boolean; reason: string };
const fail = (m: string): Outcome => ({ ok: false, network: isNetwork(m), reason: m });

async function apply(op: OutboxOp): Promise<Outcome> {
  try {
    if (op.kind === 'rpc' && op.fn) {
      const { error } = await supabase.rpc(op.fn, op.args ?? {});
      return error ? fail(error.message) : { ok: true };
    }
    if (!op.table || !op.rowId || !op.patch) return { ok: false, network: false, reason: 'malformed' };
    if (op.kind === 'insert') {
      const { error } = await supabase.from(op.table).upsert({ ...op.patch, id: op.rowId }, { onConflict: 'id', ignoreDuplicates: true });
      return error ? fail(error.message) : { ok: true };
    }
    if (!op.force && op.baseUpdatedAt) {
      const { data, error } = await supabase.from(op.table).select('updated_at').eq('id', op.rowId).maybeSingle();
      if (error) return fail(error.message);
      const server = data as { updated_at: string } | null;
      if (server && new Date(server.updated_at).getTime() > new Date(op.baseUpdatedAt).getTime()) {
        return { ok: false, network: false, reason: 'changed_on_server' };
      }
    }
    const { error } = await supabase.from(op.table).update(op.patch).eq('id', op.rowId);
    return error ? fail(error.message) : { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function flush(staffId: string) {
  if (flushing || !navigator.onLine) return;
  flushing = true; outboxEvents.dispatchEvent(new Event('change'));
  try {
    let ops = await readOps(); const conflicts = await readConflicts();
    while (ops.length) {
      const op = ops[0];
      if (op.staffId !== staffId) { conflicts.push({ op, reason: 'other_staff' }); ops = ops.slice(1); continue; }
      const r = await apply(op);
      if (r.ok) ops = ops.slice(1);
      else if (r.network) break;
      else { conflicts.push({ op, reason: r.reason }); ops = ops.slice(1); }
      await save(ops, conflicts);
    }
    await save(ops, conflicts);
  } finally {
    flushing = false; outboxEvents.dispatchEvent(new Event('change'));
  }
}

export async function resolveConflict(index: number, keep: 'mine' | 'server', staffId: string) {
  const conflicts = await readConflicts(); const c = conflicts[index];
  if (!c) return;
  conflicts.splice(index, 1);
  const ops = await readOps();
  if (keep === 'mine' && c.op.staffId === staffId) ops.push({ ...c.op, force: true });
  await save(ops, conflicts);
  void flush(staffId);
}
