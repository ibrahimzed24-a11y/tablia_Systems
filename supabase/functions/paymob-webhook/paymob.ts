// Paymob "transaction processed" callback helpers: HMAC check, success check and the organization id.
// HMAC: https://developers.paymob.com/egypt/manage-callback/hmac-calculation (SHA-512 over these values, in order).
export const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner',
  'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

export type Obj = Record<string, unknown>;

// The three plans by the amount Paymob reports, in piasters (public.plan_limits.price_amount_cents holds the same prices).
export type Tier = 'starter' | 'growth' | 'enterprise';
export const TIER_BY_AMOUNT_CENTS: Readonly<Record<number, Tier>> = { 399900: 'starter', 699900: 'growth', 1000000: 'enterprise' };

export function tierForAmount(amountCents: number): Tier | null {
  return Object.hasOwn(TIER_BY_AMOUNT_CENTS, amountCents) ? TIER_BY_AMOUNT_CENTS[amountCents] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pick(obj: Obj, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Obj)[k] : undefined), obj);
}

export function hmacMessage(obj: Obj): string {
  return HMAC_FIELDS.map((f) => {
    const v = pick(obj, f);
    return v === undefined || v === null ? '' : String(v);
  }).join('');
}

export async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyHmac(obj: Obj, received: string, secret: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{128}$/i.test(received)) return false;
  return timingSafeEqual(await hmacHex(hmacMessage(obj), secret), received.toLowerCase());
}

// Only a finished, successful charge counts: not pending, voided, refunded, auth-only or a child transaction.
export function isSuccessfulPayment(obj: Obj): boolean {
  return obj.success === true && obj.pending === false && obj.error_occured !== true && obj.is_voided !== true &&
    obj.is_refunded !== true && obj.is_auth !== true && obj.has_parent_transaction !== true;
}

// The checkout sets the Paymob order's merchant_order_id to "<organization uuid>" or "<organization uuid>:<suffix>"
// (Paymob wants it unique per order). payment_key_claims.extra.organization_id is accepted as a fallback.
export function organizationIdOf(obj: Obj): string | null {
  const m = String(pick(obj, 'order.merchant_order_id') ?? '').split(':')[0];
  if (UUID.test(m)) return m.toLowerCase();
  const e = String(pick(obj, 'payment_key_claims.extra.organization_id') ?? '');
  return UUID.test(e) ? e.toLowerCase() : null;
}
