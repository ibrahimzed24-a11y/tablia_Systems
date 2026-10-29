// Tablia Systems platform console (/admin) for platform admins: every restaurant with its plan and payment state,
// suspend and reactivate, manual plan changes, and platform numbers. Every read and write is an admin RPC that the
// database refuses unless the account is in platform_admins AND the session passed an authenticator-app code (aal2).
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Badge, Button, Card, Field, Input, Select } from '@tablia/ui';
import { authLinkType, supabase } from '../lib/core';

type Lang = 'ar' | 'en';
type PlanAction = 'activate' | 'extend' | 'comp' | 'cancel';
const PLAN_ACTIONS: PlanAction[] = ['activate', 'extend', 'comp', 'cancel'];
const TIERS = ['starter', 'growth', 'enterprise'] as const;

const T = {
  en: {
    lang: 'العربية', title: 'Tablia Systems · Platform admin', signIn: 'Sign in', email: 'Email', password: 'Password', signOut: 'Sign out',
    notAdmin: 'This account is not a Tablia Systems platform admin.', loading: 'Loading…', error: 'Something went wrong:',
    forgot: 'Forgot your password?', backToSignIn: 'Back to sign in', sendReset: 'Email me a reset link',
    resetSent: 'If this email has an account, we sent a link to choose a new password.',
    newPassword: 'New password (at least 8 characters)', setPassword: 'Save the new password',
    mfaTitle: 'Authenticator code', mfaEnroll: 'Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then type the 6-digit code it shows.',
    mfaSecret: 'Or enter this key by hand:', mfaCode: '6-digit code', mfaVerify: 'Verify',
    restaurants: 'Restaurants', active: 'Active', suspended: 'Suspended', paying: 'Paying', pastDue: 'Awaiting payment',
    tests: 'Test subscriptions', mrr: 'Monthly revenue (EGP)', owners: 'Owners', customers: 'Customers', orders: 'Orders', orders30: 'Orders (30 days)',
    name: 'Restaurant', owner: 'Owner', plan: 'Plan', payment: 'Payment', state: 'State', actions: '', paid: 'Paid', unpaid: 'Unpaid',
    noPlan: 'No plan', test: 'Test', until: 'until', suspend: 'Suspend', activate: 'Activate', reason: 'Reason for suspending (optional)',
    search: 'Search by name, web address or email', refresh: 'Refresh',
    planActions: 'Plan', days: 'Days', apply: 'Apply', confirmCancel: "Cancel this restaurant's plan now?",
    act_activate: 'Activate plan', act_extend: 'Extend plan', act_comp: 'Comp (free)', act_cancel: 'Cancel plan',
  },
  ar: {
    lang: 'English', title: 'Tablia Systems · إدارة المنصة', signIn: 'تسجيل الدخول', email: 'الإيميل', password: 'كلمة السر', signOut: 'خروج',
    notAdmin: 'الحساب ده مش أدمن منصة Tablia Systems.', loading: 'جاري التحميل…', error: 'حصلت مشكلة:',
    forgot: 'نسيت كلمة السر؟', backToSignIn: 'رجوع لتسجيل الدخول', sendReset: 'ابعتلي لينك تغيير كلمة السر',
    resetSent: 'لو الإيميل ده عليه حساب، بعتنالك لينك تختار منه كلمة سر جديدة.',
    newPassword: 'كلمة السر الجديدة (8 حروف على الأقل)', setPassword: 'احفظ كلمة السر الجديدة',
    mfaTitle: 'كود تطبيق المصادقة', mfaEnroll: 'امسح الكود ده بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو 1Password)، واكتب الكود اللي من 6 أرقام.',
    mfaSecret: 'أو اكتب المفتاح ده بإيدك:', mfaCode: 'الكود (6 أرقام)', mfaVerify: 'تأكيد',
    restaurants: 'المطاعم', active: 'شغّال', suspended: 'موقوف', paying: 'مدفوع', pastDue: 'مستني الدفع',
    tests: 'اشتراكات تجريبية', mrr: 'الإيراد الشهري (جنيه)', owners: 'أصحاب المطاعم', customers: 'العملاء', orders: 'الطلبات', orders30: 'طلبات آخر 30 يوم',
    name: 'المطعم', owner: 'صاحب المطعم', plan: 'الباقة', payment: 'الدفع', state: 'الحالة', actions: '', paid: 'مدفوع', unpaid: 'غير مدفوع',
    noPlan: 'بدون باقة', test: 'تجريبي', until: 'لحد', suspend: 'إيقاف', activate: 'تفعيل', reason: 'سبب الإيقاف (اختياري)',
    search: 'دوّر بالاسم أو عنوان الصفحة أو الإيميل', refresh: 'تحديث',
    planActions: 'الباقة', days: 'أيام', apply: 'تنفيذ', confirmCancel: 'تلغي باقة المطعم ده دلوقتي؟',
    act_activate: 'تفعيل الباقة', act_extend: 'تمديد الباقة', act_comp: 'مجانًا (هدية)', act_cancel: 'إلغاء الباقة',
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
interface PlanDraft { action: PlanAction; tier: string; days: string }

export function SuperAdminConsole() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('tablia-lang') === 'en' ? 'en' : 'ar'));
  const t = T[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [aal, setAal] = useState<string | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(() => authLinkType === 'recovery');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('tablia-lang', lang);
  }, [lang]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSession(s); if (e === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setIsAdmin(undefined); setAal(undefined); return; }
    supabase.rpc('am_i_super_admin').then(({ data }) => setIsAdmin(data === true));
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data?.currentLevel ?? null));
  }, [session]);

  const toggle = () => setLang(lang === 'ar' ? 'en' : 'ar');
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="flex-1 text-xl font-bold">{t.title}</h1>
      <Button variant="ghost" onClick={toggle}>{t.lang}</Button>
      {session && <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t.signOut}</Button>}
    </div>
  );
  const narrow = (body: JSX.Element) => <main className="mx-auto max-w-md space-y-3 p-6">{header}{body}</main>;

  if (!ready) return <main className="p-6">{t.loading}</main>;
  if (!session) return narrow(<AdminSignIn lang={lang} />);
  if (isAdmin === undefined || aal === undefined) return <main className="p-6">{t.loading}</main>;
  if (!isAdmin) return narrow(<Card className="p-3">{t.notAdmin}</Card>);
  if (aal !== 'aal2') return narrow(<AdminMfa lang={lang} onDone={() => setAal('aal2')} />);
  if (recovery) return narrow(<AdminNewPassword lang={lang} onDone={() => setRecovery(false)} />);
  return <main className="mx-auto max-w-6xl space-y-4 p-4">{header}<AdminDashboard lang={lang} /></main>;
}

function AdminSignIn({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [f, setF] = useState({ email: '', password: '' });
  const [forgot, setForgot] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const signIn = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    setBusy(false);
    if (error) setMsg(t.error + ' ' + error.message);
  };
  const sendReset = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: window.location.origin + '/admin' });
    setBusy(false);
    setMsg(error ? t.error + ' ' + error.message : t.resetSent);
  };
  return (
    <Card className="space-y-3 p-4">
      <Field label={t.email}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
      {!forgot && <Field label={t.password}><Input type="password" autoComplete="current-password" value={f.password} onChange={set('password')} /></Field>}
      {forgot
        ? <Button disabled={busy || !f.email.trim()} onClick={sendReset}>{t.sendReset}</Button>
        : <Button disabled={busy} onClick={signIn}>{t.signIn}</Button>}
      <Button variant="ghost" onClick={() => { setMsg(''); setForgot(!forgot); }}>{forgot ? t.backToSignIn : t.forgot}</Button>
      {msg && <p className="text-sm">{msg}</p>}
    </Card>
  );
}

// Second step for admins: enrol an authenticator app the first time, then a 6-digit code on every sign-in.
function AdminMfa({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const t = T[lang];
  const started = useRef(false);
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) { setMsg(T[lang].error + ' ' + error.message); return; }
      const verified = data.totp.find((x) => x.status === 'verified');
      if (verified) { setFactorId(verified.id); return; }
      // An enrolment that was never finished would block a new one, so it is dropped first.
      for (const x of data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: x.id });
      }
      const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Tablia Systems admin ' + Date.now() });
      if (en.error) { setMsg(T[lang].error + ' ' + en.error.message); return; }
      setFactorId(en.data.id);
      setQr(en.data.totp?.qr_code ?? '');
      setSecret(en.data.totp?.secret ?? '');
    })();
  }, [lang]);

  const verify = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) setMsg(t.error + ' ' + error.message); else onDone();
  };
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{t.mfaTitle}</h2>
      {qr && (
        <>
          <p className="text-sm">{t.mfaEnroll}</p>
          <img src={qr} alt="" className="mx-auto h-48 w-48 bg-white p-2" />
          <p className="break-all text-xs" dir="ltr">{t.mfaSecret} {secret}</p>
        </>
      )}
      <Field label={t.mfaCode}>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button disabled={busy || !factorId || code.trim().length !== 6} onClick={verify}>{t.mfaVerify}</Button>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </Card>
  );
}

// Reached from the password reset email, after the authenticator step.
function AdminNewPassword({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const t = T[lang];
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const save = async () => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setMsg(t.error + ' ' + error.message); return; }
    window.history.replaceState(null, '', window.location.pathname);
    onDone();
  };
  return (
    <Card className="space-y-3 p-4">
      <Field label={t.newPassword}><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button disabled={password.length < 8} onClick={save}>{t.setPassword}</Button>
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
  const [plans, setPlans] = useState<Record<string, PlanDraft>>({});

  const load = useCallback(() => {
    supabase.rpc('admin_list_restaurants').then(({ data, error: e }) => { setRows((data as Restaurant[] | null) ?? []); if (e) setError(e.message); });
    supabase.rpc('admin_platform_stats').then(({ data, error: e }) => { setStats((data as Stats | null) ?? null); if (e) setError(e.message); });
  }, []);
  useEffect(load, [load]);

  const setActive = async (r: Restaurant, active: boolean) => {
    const { error: e } = await supabase.rpc('admin_set_restaurant_active', { p_org: r.id, p_active: active, p_reason: active ? null : reasons[r.id] || null });
    if (e) setError(e.message); else { setError(''); load(); }
  };
  const planOf = (r: Restaurant): PlanDraft => plans[r.id] ?? { action: 'activate', tier: r.tier && (TIERS as readonly string[]).includes(r.tier) ? r.tier : 'starter', days: '30' };
  const editPlan = (r: Restaurant, patch: Partial<PlanDraft>) => setPlans({ ...plans, [r.id]: { ...planOf(r), ...patch } });
  const applyPlan = async (r: Restaurant) => {
    const p = planOf(r);
    if (p.action === 'cancel' && !window.confirm(t.confirmCancel)) return;
    const { error: e } = await supabase.rpc('admin_set_subscription', { p_org: r.id, p_action: p.action, p_tier: p.tier, p_days: Number(p.days) || 30 });
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
          <thead><tr className="text-start"><th>{t.name}</th><th>{t.owner}</th><th>{t.plan}</th><th>{t.payment}</th><th>{t.orders}</th><th>{t.state}</th><th>{t.actions}</th><th>{t.planActions}</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const p = planOf(r);
              return (
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
                  <td className="space-y-1">
                    <Select value={p.action} onChange={(e) => editPlan(r, { action: e.target.value as PlanAction })}>
                      {PLAN_ACTIONS.map((a) => <option key={a} value={a}>{t[`act_${a}`]}</option>)}
                    </Select>
                    {(p.action === 'activate' || p.action === 'comp') && (
                      <Select value={p.tier} onChange={(e) => editPlan(r, { tier: e.target.value })}>
                        {TIERS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </Select>
                    )}
                    {p.action !== 'cancel' && (
                      <Input type="number" min={1} max={366} aria-label={t.days} placeholder={t.days} value={p.days} onChange={(e) => editPlan(r, { days: e.target.value })} />
                    )}
                    <Button variant="ghost" onClick={() => applyPlan(r)}>{t.apply}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
