// Tablia Systems platform console (/admin) for super admins: every restaurant with its plan and payment state,
// suspend and reactivate, and platform numbers. Every read and write is a super admin RPC that the database
// refuses to anyone not listed in platform_admins, so this page only renders what the server allows.
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Badge, Button, Card, Field, Input } from '@tablia/ui';
import { supabase } from '../lib/core';

type Lang = 'ar' | 'en';

const T = {
  en: {
    lang: 'العربية', title: 'Tablia Systems · Super admin', signIn: 'Sign in', email: 'Email', password: 'Password', signOut: 'Sign out',
    notAdmin: 'This account is not a Tablia Systems super admin.', loading: 'Loading…', error: 'Something went wrong:',
    restaurants: 'Restaurants', active: 'Active', suspended: 'Suspended', paying: 'Paying', pastDue: 'Awaiting payment',
    tests: 'Test subscriptions', mrr: 'Monthly revenue (EGP)', owners: 'Owners', customers: 'Customers', orders: 'Orders', orders30: 'Orders (30 days)',
    name: 'Restaurant', owner: 'Owner', plan: 'Plan', payment: 'Payment', state: 'State', actions: '', paid: 'Paid', unpaid: 'Unpaid',
    noPlan: 'No plan', test: 'Test', until: 'until', suspend: 'Suspend', activate: 'Activate', reason: 'Reason for suspending (optional)',
    search: 'Search by name, web address or email', refresh: 'Refresh',
  },
  ar: {
    lang: 'English', title: 'Tablia Systems · السوبر أدمن', signIn: 'تسجيل الدخول', email: 'الإيميل', password: 'كلمة السر', signOut: 'خروج',
    notAdmin: 'الحساب ده مش سوبر أدمن في Tablia Systems.', loading: 'جاري التحميل…', error: 'حصلت مشكلة:',
    restaurants: 'المطاعم', active: 'شغّال', suspended: 'موقوف', paying: 'مدفوع', pastDue: 'مستني الدفع',
    tests: 'اشتراكات تجريبية', mrr: 'الإيراد الشهري (جنيه)', owners: 'أصحاب المطاعم', customers: 'العملاء', orders: 'الطلبات', orders30: 'طلبات آخر 30 يوم',
    name: 'المطعم', owner: 'صاحب المطعم', plan: 'الباقة', payment: 'الدفع', state: 'الحالة', actions: '', paid: 'مدفوع', unpaid: 'غير مدفوع',
    noPlan: 'بدون باقة', test: 'تجريبي', until: 'لحد', suspend: 'إيقاف', activate: 'تفعيل', reason: 'سبب الإيقاف (اختياري)',
    search: 'دوّر بالاسم أو عنوان الصفحة أو الإيميل', refresh: 'تحديث',
  },
} as const;

interface Restaurant {
  id: string; name: string; slug: string | null; created_at: string; is_active: boolean; suspended_reason: string | null;
  owner_email: string | null; tier: string | null; status: string | null; is_test: boolean; current_period_end: string | null;
  paid: boolean | null; last_payment_at: string | null; orders: number; customers: number;
}
interface Stats {
  restaurants: number; active_restaurants: number; suspended_restaurants: number; paying: number; past_due: number;
  test_subscriptions: number; mrr_egp: number; owners: number; customers: number; orders_total: number; orders_30d: number;
}

export function SuperAdminConsole() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('tablia-lang') === 'en' ? 'en' : 'ar'));
  const t = T[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('tablia-lang', lang);
  }, [lang]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setIsAdmin(undefined); return; }
    supabase.rpc('am_i_super_admin').then(({ data }) => setIsAdmin(data === true));
  }, [session]);

  const toggle = () => setLang(lang === 'ar' ? 'en' : 'ar');
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="flex-1 text-xl font-bold">{t.title}</h1>
      <Button variant="ghost" onClick={toggle}>{t.lang}</Button>
      {session && <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t.signOut}</Button>}
    </div>
  );

  if (!ready) return <main className="p-6">{t.loading}</main>;
  if (!session) return <main className="mx-auto max-w-md space-y-3 p-6">{header}<AdminSignIn lang={lang} /></main>;
  if (isAdmin === undefined) return <main className="p-6">{t.loading}</main>;
  if (!isAdmin) return <main className="mx-auto max-w-md space-y-3 p-6">{header}<Card className="p-3">{t.notAdmin}</Card></main>;
  return <main className="mx-auto max-w-6xl space-y-4 p-4">{header}<AdminDashboard lang={lang} /></main>;
}

function AdminSignIn({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [f, setF] = useState({ email: '', password: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const signIn = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    setBusy(false);
    if (error) setMsg(t.error + ' ' + error.message);
  };
  return (
    <Card className="space-y-3 p-4">
      <Field label={t.email}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
      <Field label={t.password}><Input type="password" autoComplete="current-password" value={f.password} onChange={set('password')} /></Field>
      <Button disabled={busy} onClick={signIn}>{t.signIn}</Button>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </Card>
  );
}

function AdminDashboard({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [rows, setRows] = useState<Restaurant[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    supabase.rpc('admin_list_restaurants').then(({ data, error: e }) => { setRows((data as Restaurant[] | null) ?? []); if (e) setError(e.message); });
    supabase.rpc('admin_platform_stats').then(({ data, error: e }) => { setStats((data as Stats | null) ?? null); if (e) setError(e.message); });
  }, []);
  useEffect(load, [load]);

  const setActive = async (r: Restaurant, active: boolean) => {
    const { error: e } = await supabase.rpc('admin_set_restaurant_active', { p_org: r.id, p_active: active, p_reason: active ? null : reasons[r.id] || null });
    if (e) setError(e.message); else { setError(''); load(); }
  };

  const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '');
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || [r.name, r.slug, r.owner_email].some((v) => (v ?? '').toLowerCase().includes(needle)));
  const tiles: [string, number | undefined][] = stats ? [
    [t.restaurants, stats.restaurants], [t.active, stats.active_restaurants], [t.suspended, stats.suspended_restaurants],
    [t.paying, stats.paying], [t.pastDue, stats.past_due], [t.tests, stats.test_subscriptions], [t.mrr, stats.mrr_egp],
    [t.owners, stats.owners], [t.customers, stats.customers], [t.orders, stats.orders_total], [t.orders30, stats.orders_30d],
  ] : [];

  return (
    <>
      {error && <p className="text-sm text-red-700">{t.error} {error}</p>}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map(([label, n]) => (
          <Card key={label} className="p-3"><div className="text-xs opacity-70">{label}</div><div className="text-2xl font-bold">{n ?? 0}</div></Card>
        ))}
      </section>
      <div className="flex gap-2">
        <Input className="flex-1" placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="ghost" onClick={load}>{t.refresh}</Button>
      </div>
      <Card className="overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead><tr className="text-start"><th>{t.name}</th><th>{t.owner}</th><th>{t.plan}</th><th>{t.payment}</th><th>{t.orders}</th><th>{t.state}</th><th>{t.actions}</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="py-2"><div className="font-medium">{r.name}</div><div className="text-xs opacity-70" dir="ltr">{r.slug}</div></td>
                <td dir="ltr">{r.owner_email}</td>
                <td>{r.tier ?? t.noPlan} {r.is_test && <Badge>{t.test}</Badge>}</td>
                <td>
                  {r.tier ? <Badge tone={r.paid ? 'green' : 'amber'}>{r.paid ? t.paid : t.unpaid}</Badge> : null}
                  {r.current_period_end && <div className="text-xs opacity-70">{t.until} {date(r.current_period_end)}</div>}
                </td>
                <td>{r.orders} · {r.customers}</td>
                <td>
                  <Badge tone={r.is_active ? 'green' : 'red'}>{r.is_active ? t.active : t.suspended}</Badge>
                  {!r.is_active && r.suspended_reason && <div className="text-xs opacity-70">{r.suspended_reason}</div>}
                </td>
                <td className="space-y-1">
                  {r.is_active ? (
                    <>
                      <Input placeholder={t.reason} value={reasons[r.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })} />
                      <Button variant="ghost" onClick={() => setActive(r, false)}>{t.suspend}</Button>
                    </>
                  ) : (
                    <Button onClick={() => setActive(r, true)}>{t.activate}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
