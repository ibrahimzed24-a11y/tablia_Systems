// deno test supabase/functions/paymob-webhook/paymob_test.ts
import { assert, assertEquals, assertFalse } from '@std/assert';
import { hmacHex, hmacMessage, isSuccessfulPayment, organizationIdOf, tierForAmount, verifyHmac } from './paymob.ts';

const secret = 'test-only-secret';
const tx = () => ({
  id: 192036465, amount_cents: 980000, created_at: '2026-10-29T10:00:00.000000', currency: 'EGP',
  error_occured: false, has_parent_transaction: false, integration_id: 1, is_3d_secure: true, is_auth: false,
  is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 217503754, merchant_order_id: '00000000-0000-4000-E000-000000000002:1' },
  owner: 302852, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
});

Deno.test('HMAC-SHA512 matches RFC 4231 test case 2', async () => {
  assertEquals(
    await hmacHex('what do ya want for nothing?', 'Jefe'),
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
  );
});

Deno.test('message concatenates the Paymob fields in order', () => {
  assertEquals(
    hmacMessage(tx()),
    '9800002026-10-29T10:00:00.000000EGPfalsefalse1920364651truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue',
  );
});

Deno.test('valid signature is accepted, in either case', async () => {
  const sig = await hmacHex(hmacMessage(tx()), secret);
  assert(await verifyHmac(tx(), sig, secret));
  assert(await verifyHmac(tx(), sig.toUpperCase(), secret));
});

Deno.test('tampered amount, wrong secret, empty and malformed signatures are refused', async () => {
  const sig = await hmacHex(hmacMessage(tx()), secret);
  assertFalse(await verifyHmac({ ...tx(), amount_cents: 499900 }, sig, secret));
  assertFalse(await verifyHmac(tx(), sig, 'another-secret'));
  assertFalse(await verifyHmac(tx(), '', secret));
  assertFalse(await verifyHmac(tx(), 'zz' + sig.slice(2), secret));
  assertFalse(await verifyHmac(tx(), sig, ''));
});

Deno.test('only finished successful payments count', () => {
  assert(isSuccessfulPayment(tx()));
  assertFalse(isSuccessfulPayment({ ...tx(), success: false }));
  assertFalse(isSuccessfulPayment({ ...tx(), pending: true }));
  assertFalse(isSuccessfulPayment({ ...tx(), is_refunded: true }));
  assertFalse(isSuccessfulPayment({ ...tx(), is_voided: true }));
  assertFalse(isSuccessfulPayment({ ...tx(), is_auth: true }));
  assertFalse(isSuccessfulPayment({ ...tx(), error_occured: true }));
});

Deno.test('organization id comes from merchant_order_id or the payment key extras', () => {
  assertEquals(organizationIdOf(tx()), '00000000-0000-4000-e000-000000000002');
  const viaExtra = { ...tx(), order: { id: 1, merchant_order_id: 'abc' },
    payment_key_claims: { extra: { organization_id: '00000000-0000-4000-e000-000000000001' } } };
  assertEquals(organizationIdOf(viaExtra), '00000000-0000-4000-e000-000000000001');
  assertEquals(organizationIdOf({ ...tx(), order: { id: 1, merchant_order_id: 'not-a-uuid' } }), null);
});

Deno.test('amounts map to the three plans', () => {
  assertEquals(tierForAmount(399900), 'starter');
  assertEquals(tierForAmount(699900), 'growth');
  assertEquals(tierForAmount(1000000), 'enterprise');
  assertEquals(tierForAmount(980000), null);
  assertEquals(tierForAmount(499900), null);
});
