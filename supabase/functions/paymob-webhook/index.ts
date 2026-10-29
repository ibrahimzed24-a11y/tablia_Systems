// paymob-webhook: Paymob's transaction processed callback (POST, ?hmac=...).
// 1. Verifies Paymob's HMAC with the function secret PAYMOB_HMAC_SECRET (supabase secrets set ..., never in the repo).
// 2. Accepts only successful payments; anything else is acknowledged and ignored.
// 3. Calls public.apply_paymob_payment with the service role key (injected by Supabase, server side only).
//    That function maps the amount to a plan (980000 piasters = 9,800 EGP = scale_matrix, 499900 = 4,999 EGP = growth),
//    ignores any other amount or currency, and is idempotent on the Paymob transaction id, so retries are harmless.
import { createClient } from '@supabase/supabase-js';
import { isSuccessfulPayment, type Obj, organizationIdOf, verifyHmac } from './paymob.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('PAYMOB_HMAC_SECRET');
  if (!secret) {
    console.error('PAYMOB_HMAC_SECRET is not set');
    return json({ error: 'not_configured' }, 500);
  }

  let payload: Obj;
  try {
    payload = (await req.json()) as Obj;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const obj = payload?.obj as Obj | undefined;
  if (payload?.type !== 'TRANSACTION' || !obj || typeof obj !== 'object') return json({ error: 'unsupported_type' }, 400);

  const received = new URL(req.url).searchParams.get('hmac') ?? '';
  if (!(await verifyHmac(obj, received, secret))) return json({ error: 'bad_hmac' }, 401);

  if (!isSuccessfulPayment(obj)) return json({ ok: true, outcome: 'ignored_not_successful' }, 200);

  const transactionId = Number(obj.id);
  const orderId = Number((obj.order as Obj | undefined)?.id);
  const amountCents = Number(obj.amount_cents);
  if (!Number.isSafeInteger(transactionId) || !Number.isSafeInteger(amountCents)) return json({ error: 'bad_transaction' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc('apply_paymob_payment', {
    p_transaction_id: transactionId,
    p_order_id: Number.isSafeInteger(orderId) ? orderId : null,
    p_organization_id: organizationIdOf(obj),
    p_amount_cents: amountCents,
    p_currency: String(obj.currency ?? ''),
  });
  if (error) {
    // 500 makes Paymob retry; the ledger makes the retry safe.
    console.error('apply_paymob_payment failed', error.code, error.message);
    return json({ error: 'db_error' }, 500);
  }
  if (data !== 'applied' && data !== 'duplicate') console.warn('paymob payment ignored', transactionId, data);
  return json({ ok: true, outcome: data }, 200);
});
