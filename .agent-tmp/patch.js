// node patch.js  (run from the repo root)
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.error('PATCH MISS in ' + file + ': ' + a.slice(0, 80)); process.exitCode = 1; continue; }
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
  console.log('patched ' + file);
}

edit('supabase/tests/restaurant_crm.sql', [[
  "'Test tenant two', 'test-two');",
  "'Test tenant two', 'test-two');\n-- Both test tenants are on Enterprise so dine-in, reservations and event tickets are open (plans: tenant_subscriptions.sql).\ninsert into public.subscriptions (organization_id, tier, status) values\n  ('00000000-0000-4000-f000-000000000001', 'enterprise', 'active'),\n  ('00000000-0000-4000-f000-000000000002', 'enterprise', 'active');",
]]);

edit('supabase/functions/paymob-webhook/paymob.ts', [[
  "export type Obj = Record<string, unknown>;",
  "export type Obj = Record<string, unknown>;\n\n// The three plans by the amount Paymob reports, in piasters (public.plan_limits.price_amount_cents holds the same prices).\nexport type Tier = 'starter' | 'growth' | 'enterprise';\nexport const TIER_BY_AMOUNT_CENTS: Readonly<Record<number, Tier>> = { 399900: 'starter', 699900: 'growth', 1000000: 'enterprise' };\n\nexport function tierForAmount(amountCents: number): Tier | null {\n  return Object.hasOwn(TIER_BY_AMOUNT_CENTS, amountCents) ? TIER_BY_AMOUNT_CENTS[amountCents] : null;\n}",
]]);

edit('supabase/functions/paymob-webhook/index.ts', [
  ["//    That function maps the amount to a plan (980000 piasters = 9,800 EGP = scale_matrix, 499900 = 4,999 EGP = growth),",
   "//    That function maps the amount to a plan (399900 piasters = 3,999 EGP = starter, 699900 = 6,999 EGP = growth,\n//    1000000 = 10,000 EGP = enterprise),"],
  ["import { isSuccessfulPayment, type Obj, organizationIdOf, verifyHmac } from './paymob.ts';",
   "import { isSuccessfulPayment, type Obj, organizationIdOf, tierForAmount, verifyHmac } from './paymob.ts';"],
  ["  if (data !== 'applied' && data !== 'duplicate') console.warn('paymob payment ignored', transactionId, data);\n  return json({ ok: true, outcome: data }, 200);",
   "  const tier = tierForAmount(amountCents);\n  if (data !== 'applied' && data !== 'duplicate') console.warn('paymob payment ignored', transactionId, data);\n  if (data === 'applied' && !tier) console.error('plan prices differ between plan_limits and paymob.ts', amountCents);\n  return json({ ok: true, outcome: data, tier }, 200);"],
]);

let pt = fs.readFileSync('supabase/functions/paymob-webhook/paymob_test.ts', 'utf8');
pt = pt.replace("import { hmacHex, hmacMessage, isSuccessfulPayment, organizationIdOf, verifyHmac } from './paymob.ts';",
  "import { hmacHex, hmacMessage, isSuccessfulPayment, organizationIdOf, tierForAmount, verifyHmac } from './paymob.ts';");
pt += "\nDeno.test('amounts map to the three plans', () => {\n  assertEquals(tierForAmount(399900), 'starter');\n  assertEquals(tierForAmount(699900), 'growth');\n  assertEquals(tierForAmount(1000000), 'enterprise');\n  assertEquals(tierForAmount(980000), null);\n  assertEquals(tierForAmount(499900), null);\n});\n";
fs.writeFileSync('supabase/functions/paymob-webhook/paymob_test.ts', pt);

edit('apps/staff-pwa/src/tenant/Tenant.tsx', [
  ["    error: 'Something went wrong:',",
   "    error: 'Something went wrong:', plan: 'Plan', locked: 'Locked', upgradeNote: 'Not in your plan. Upgrade to', domains: 'Domains', seats: 'Seats', fee: 'Online fee',\n    tier_starter: 'Starter (3,999 EGP)', tier_growth: 'Growth (6,999 EGP)', tier_enterprise: 'Enterprise (10,000 EGP)',\n    mod_live_orders_feed: 'Live orders feed', mod_table_reservations: 'Table reservations', mod_event_ticketing: 'Live event ticketing',\n    mod_historical_reporting: 'Historical reports', mod_multi_brand_menus: 'Multi-brand menus', mod_advanced_tagging: 'Advanced guest tagging',"],
  ["    error: 'حصلت مشكلة:',",
   "    error: 'حصلت مشكلة:', plan: 'الباقة', locked: 'مقفول', upgradeNote: 'مش ضمن باقتك. اترقى إلى', domains: 'الدومينات', seats: 'المديرين', fee: 'رسوم الأونلاين',\n    tier_starter: 'Starter (3,999 جنيه)', tier_growth: 'Growth (6,999 جنيه)', tier_enterprise: 'Enterprise (10,000 جنيه)',\n    mod_live_orders_feed: 'الطلبات لحظة بلحظة', mod_table_reservations: 'حجز الترابيزات', mod_event_ticketing: 'تذاكر الفعاليات',\n    mod_historical_reporting: 'التقارير التاريخية', mod_multi_brand_menus: 'منيوهات لأكتر من براند', mod_advanced_tagging: 'تصنيف العملاء المتقدم',"],
  ["  const [err, setErr] = useState('');\n",
   "  const [err, setErr] = useState('');\n  const [plan, setPlan] = useState<Plan | null>(null);\n"],
  ["setOrg((data as string | null) ?? null));\n  }, [session]);",
   "setOrg((data as string | null) ?? null));\n  }, [session]);\n  useEffect(() => {\n    if (!org) { setPlan(null); return; }\n    supabase.rpc('get_my_plan').then(({ data }) => setPlan((data as Plan | null) ?? null));\n  }, [org]);"],
  ["      {tab === 'menu' && <OwnerMenu org={org} lang={lang} t={t} />}\n      {tab === 'events' && <OwnerEvents org={org} lang={lang} t={t} />}",
   "      {plan && <PlanPanel plan={plan} t={t} />}\n      {tab === 'menu' && <OwnerMenu org={org} lang={lang} t={t} />}\n      {tab === 'events' && (plan && !plan.event_ticketing ? <Locked t={t} module=\"event_ticketing\" /> : <OwnerEvents org={org} lang={lang} t={t} />)}"],
]);
fs.appendFileSync('apps/staff-pwa/src/tenant/Tenant.tsx', `
// ---- plan: the database enforces every limit; these pages only show what is locked ----
type Tier = 'starter' | 'growth' | 'enterprise';
const MODULES = ['live_orders_feed', 'table_reservations', 'event_ticketing', 'historical_reporting', 'multi_brand_menus', 'advanced_tagging'] as const;
type Module = (typeof MODULES)[number];
const UNLOCKED_BY: Record<Module, Tier> = {
  live_orders_feed: 'growth', table_reservations: 'growth', event_ticketing: 'enterprise',
  historical_reporting: 'enterprise', multi_brand_menus: 'enterprise', advanced_tagging: 'enterprise',
};
interface Plan extends Record<Module, boolean> {
  tier: Tier;
  online_fee_bps: number;
  max_menu_items: number | null;
  max_guest_profiles: number | null;
  max_custom_domains: number;
  max_manager_seats: number;
  usage: { menu_items: number; guest_profiles: number; custom_domains: number; manager_seats: number };
}
const tierLabel = (t: Dict, tier: Tier) => t[\`tier_\${tier}\` as const];

function Locked({ t, module }: { t: Dict; module: Module }) {
  return (
    <Card className="space-y-1 p-3 text-sm">
      <div className="flex items-center gap-2"><Badge>🔒 {t.locked}</Badge><strong>{t[\`mod_\${module}\` as const]}</strong></div>
      <p>{t.upgradeNote} {tierLabel(t, UNLOCKED_BY[module])}</p>
    </Card>
  );
}

function PlanPanel({ plan, t }: { plan: Plan; t: Dict }) {
  const cap = (n: number | null) => (n === null ? '∞' : String(n));
  return (
    <section className="space-y-2">
      <Card className="flex flex-wrap items-center gap-2 p-2 text-sm">
        <strong>{t.plan}: {tierLabel(t, plan.tier)}</strong>
        <span className="flex-1" />
        <span>
          {t.menu} {plan.usage.menu_items}/{cap(plan.max_menu_items)} · {t.customers} {plan.usage.guest_profiles}/{cap(plan.max_guest_profiles)} ·{' '}
          {t.domains} {plan.usage.custom_domains}/{plan.max_custom_domains} · {t.seats} {plan.usage.manager_seats}/{plan.max_manager_seats} ·{' '}
          {t.fee} {plan.online_fee_bps / 100}%
        </span>
      </Card>
      {MODULES.filter((m) => !plan[m]).map((m) => <Locked key={m} t={t} module={m} />)}
    </section>
  );
}
`);
