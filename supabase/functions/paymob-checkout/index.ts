// paymob-checkout: opens Paymob's hosted checkout for the signed-in owner's chosen Tablia Systems plan.
// The amount comes from plan_limits (never from the browser); special_reference "<organization_id>:<time>" and
// extras.organization_id let paymob-webhook match the payment to the restaurant.
// Function secrets (supabase secrets set ..., never in the repo): PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY,
// PAYMOB_INTEGRATION_ID, optional PAYMOB_REDIRECT_URL.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: who } = await asUser.auth.getUser();
  const user = who.user;
  if (!user) return json({ error: 'not_signed_in' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile } = await admin.from('user_profiles').select('organization_id, role').eq('id', user.id).maybeSingle();
  if (!profile?.organization_id || profile.role !== 'tenant_admin') return json({ error: 'no_restaurant' }, 403);
  const org = profile.organization_id as string;
  const { data: sub } = await admin.from('subscriptions').select('tier').eq('organization_id', org).maybeSingle();
  const { data: plan } = await admin.from('plan_limits').select('tier, price_amount_cents').eq('tier', sub?.tier ?? 'starter').maybeSingle();
  const { data: restaurant } = await admin.from('organizations').select('name').eq('id', org).maybeSingle();
  if (!plan) return json({ error: 'no_plan' }, 400);

  const secret = Deno.env.get('PAYMOB_SECRET_KEY');
  const publicKey = Deno.env.get('PAYMOB_PUBLIC_KEY');
  const integration = Number(Deno.env.get('PAYMOB_INTEGRATION_ID'));
  if (!secret || !publicKey || !integration) {
    console.error('paymob-checkout: PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY or PAYMOB_INTEGRATION_ID is not set');
    return json({ error: 'paymob_not_configured', tier: plan.tier, amount_cents: plan.price_amount_cents }, 503);
  }

  const names = String(user.user_metadata?.full_name || 'Restaurant Owner').trim().split(/\s+/);
  const res = await fetch('https://accept.paymob.com/v1/intention/', {
    method: 'POST',
    headers: { Authorization: `Token ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: plan.price_amount_cents,
      currency: 'EGP',
      payment_methods: [integration],
      items: [{ name: `Tablia Systems ${plan.tier} plan`, amount: plan.price_amount_cents, description: `${restaurant?.name ?? ''} - 1 month`.slice(0, 255), quantity: 1 }],
      billing_data: { first_name: names[0], last_name: names.slice(1).join(' ') || names[0], email: user.email, phone_number: user.phone || 'NA', country: 'EG' },
      special_reference: `${org}:${Date.now()}`,
      extras: { organization_id: org, tier: plan.tier },
      redirection_url: Deno.env.get('PAYMOB_REDIRECT_URL') ?? 'https://app.tablia.nilesupplies.com/owner',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_secret) {
    console.error('paymob-checkout: intention failed', res.status, JSON.stringify(body).slice(0, 300));
    return json({ error: 'paymob_error' }, 502);
  }
  return json({
    url: `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(body.client_secret)}`,
    tier: plan.tier,
    amount_cents: plan.price_amount_cents,
  });
});
