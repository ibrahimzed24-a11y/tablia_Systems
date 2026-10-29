// Tablia Systems owner onboarding (sign up with an emailed code, sign in, restaurant, plan, Paymob checkout).
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Card, Field, Input } from '@tablia/ui';
import { supabase } from '../lib/core';

type Lang = 'ar' | 'en';
export type Tier = 'starter' | 'growth' | 'enterprise';
const TIERS: { tier: Tier; egp: string }[] = [
  { tier: 'starter', egp: '3,999' }, { tier: 'growth', egp: '6,999' }, { tier: 'enterprise', egp: '10,000' },
];

const T = {
  en: {
    lang: 'العربية', brand: 'Tablia Systems', signIn: 'Sign in', signUp: 'Create owner account', toSignIn: 'Already have an account? Sign in',
    toSignUp: 'New restaurant? Create an owner account', fullName: 'Full name', email: 'Email', password: 'Password (at least 8 characters)',
    codeSent: 'We emailed you a code. Enter it to confirm your account.', code: 'Code', verify: 'Confirm', resend: 'Send the code again',
    setup: 'Set up your restaurant', restaurant: 'Restaurant name', slug: 'Web address', slugHint: 'Lower-case letters, numbers and dashes.',
    plan: 'Choose your plan', perMonth: 'EGP / month', next: 'Continue to payment', checkout: 'Pay for your plan', pay: 'Pay with Paymob',
    notConfigured: 'Online payment is not switched on yet. The Tablia Systems team will contact you to activate your plan.',
    signOut: 'Sign out', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise', error: 'Something went wrong:', wait: 'Please wait...',
  },
  ar: {
    lang: 'English', brand: 'Tablia Systems', signIn: 'تسجيل الدخول', signUp: 'إنشاء حساب صاحب مطعم', toSignIn: 'عندك حساب؟ سجّل دخول',
    toSignUp: 'مطعم جديد؟ اعمل حساب صاحب مطعم', fullName: 'الاسم بالكامل', email: 'الإيميل', password: 'كلمة السر (8 حروف على الأقل)',
    codeSent: 'بعتنالك كود على الإيميل. اكتبه هنا لتأكيد الحساب.', code: 'الكود', verify: 'تأكيد', resend: 'ابعت الكود تاني',
    setup: 'بيانات مطعمك', restaurant: 'اسم المطعم', slug: 'عنوان الصفحة', slugHint: 'حروف إنجليزي صغيرة وأرقام وشرطة.',
    plan: 'اختار باقتك', perMonth: 'جنيه / شهر', next: 'كمّل للدفع', checkout: 'ادفع اشتراك باقتك', pay: 'ادفع بـ Paymob',
    notConfigured: 'الدفع الأونلاين لسه مش متفعّل. فريق Tablia Systems هيتواصل معاك لتفعيل باقتك.',
    signOut: 'خروج', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise', error: 'حصلت مشكلة:', wait: 'لحظة...',
  },
} as const;

function PlanPicker({ lang, value, onChange }: { lang: Lang; value: Tier; onChange: (t: Tier) => void }) {
  const t = T[lang];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {TIERS.map((p) => (
        <label key={p.tier} className={'cursor-pointer rounded-xl border p-3 ' + (value === p.tier ? 'border-[#8B1E14] ring-2 ring-[#8B1E14]' : 'border-gray-300')}>
          <input type="radio" name="tier" className="sr-only" checked={value === p.tier} onChange={() => onChange(p.tier)} />
          <div className="font-bold">{t[p.tier]}</div>
          <div className="text-sm">{p.egp} {t.perMonth}</div>
        </label>
      ))}
    </div>
  );
}

function Shell({ lang, toggle, title, children }: { lang: Lang; toggle: () => void; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-md space-y-3 p-6">
      <div className="flex items-center justify-between">
        <div><div className="text-sm text-[#8B1E14]">{T[lang].brand}</div><h1 className="text-xl font-bold">{title}</h1></div>
        <Button variant="ghost" onClick={toggle}>{T[lang].lang}</Button>
      </div>
      {children}
    </main>
  );
}

export function OwnerAuth({ lang, toggle }: { lang: Lang; toggle: () => void }) {
  const t = T[lang];
  const [mode, setMode] = useState<'in' | 'up' | 'code'>(() => (new URLSearchParams(window.location.search).has('signup') ? 'up' : 'in'));
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => { setBusy(true); setMsg(''); try { setMsg(await fn()); } finally { setBusy(false); } };
  const fail = (m: string) => t.error + ' ' + m;

  const signIn = () => run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    return error ? fail(error.message) : '';
  });
  const signUp = () => run(async () => {
    const { error } = await supabase.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: { data: { full_name: f.name.trim() }, emailRedirectTo: window.location.origin + '/owner' },
    });
    if (error) return fail(error.message);
    setMode('code');
    return '';
  });
  const verify = () => run(async () => {
    const { error } = await supabase.auth.verifyOtp({ email: f.email.trim(), token: f.code.trim(), type: 'signup' });
    return error ? fail(error.message) : '';
  });
  const resend = () => run(async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: f.email.trim() });
    return error ? fail(error.message) : t.codeSent;
  });

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Shell lang={lang} toggle={toggle} title={mode === 'up' ? t.signUp : mode === 'code' ? t.verify : t.signIn}>
      {mode === 'code' ? (
        <>
          <p className="text-sm">{t.codeSent}</p>
          <Field label={t.code}><Input inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={set('code')} /></Field>
          <Button disabled={busy} onClick={verify}>{t.verify}</Button>
          <Button variant="ghost" disabled={busy} onClick={resend}>{t.resend}</Button>
        </>
      ) : (
        <>
          {mode === 'up' && <Field label={t.fullName}><Input value={f.name} autoComplete="name" onChange={set('name')} /></Field>}
          <Field label={t.email}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
          <Field label={t.password}><Input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} /></Field>
          <Button disabled={busy} onClick={mode === 'up' ? signUp : signIn}>{busy ? t.wait : mode === 'up' ? t.signUp : t.signIn}</Button>
          <Button variant="ghost" onClick={() => { setMsg(''); setMode(mode === 'up' ? 'in' : 'up'); }}>{mode === 'up' ? t.toSignIn : t.toSignUp}</Button>
        </>
      )}
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </Shell>
  );
}

export function OwnerSetup({ lang, toggle, onDone }: { lang: Lang; toggle: () => void; onDone: (org: string) => void }) {
  const t = T[lang];
  const [f, setF] = useState({ name: '', slug: '' });
  const [tier, setTier] = useState<Tier>('starter');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  async function create() {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('create_my_organization', { p_name: f.name, p_slug: f.slug, p_tier: tier });
    setBusy(false);
    if (error) setMsg(t.error + ' ' + error.message); else onDone(data as string);
  }
  return (
    <Shell lang={lang} toggle={toggle} title={t.setup}>
      <Field label={t.restaurant}><Input value={f.name} onChange={(e) => setF({ name: e.target.value, slug: f.slug || slugOf(e.target.value) })} /></Field>
      <Field label={t.slug}><Input dir="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: slugOf(e.target.value) })} /></Field>
      <p className="text-xs text-gray-500">{t.slugHint}</p>
      <h2 className="font-semibold">{t.plan}</h2>
      <PlanPicker lang={lang} value={tier} onChange={setTier} />
      <Button disabled={busy || !f.name || !f.slug} onClick={create}>{busy ? t.wait : t.next}</Button>
      <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t.signOut}</Button>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </Shell>
  );
}

// The plan to pay for, or null when the organization may use the console (paid and running, or a pilot tenant
// with no subscription row). undefined while loading.
export function useCheckoutDue(org: string | null | undefined): Tier | null | undefined {
  const [due, setDue] = useState<Tier | null | undefined>(undefined);
  useEffect(() => {
    if (!org) { setDue(undefined); return; }
    supabase.from('subscriptions').select('tier,status,current_period_end').eq('organization_id', org).maybeSingle().then(({ data }) => {
      const s = data as { tier: Tier; status: string; current_period_end: string | null } | null;
      const running = !s || (s.status === 'active' && (!s.current_period_end || new Date(s.current_period_end) > new Date()));
      setDue(running || !s ? null : s.tier);
    });
  }, [org]);
  return due;
}

export function Checkout({ lang, toggle, tier: initial }: { lang: Lang; toggle: () => void; tier: Tier }) {
  const t = T[lang];
  const [tier, setTier] = useState<Tier>(initial);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(next: Tier) {
    setMsg('');
    const { error } = await supabase.rpc('choose_my_plan', { p_tier: next });
    if (error) setMsg(t.error + ' ' + error.message); else setTier(next);
  }
  async function pay() {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('paymob-checkout', { body: {} });
    setBusy(false);
    if (!error && data?.url) { window.location.assign(data.url as string); return; }
    let code = '';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? ''; } catch { code = ''; }
    setMsg(code === 'paymob_not_configured' ? t.notConfigured : t.error + ' ' + (code || error?.message || ''));
  }
  const price = TIERS.find((p) => p.tier === tier)!.egp;
  return (
    <Shell lang={lang} toggle={toggle} title={t.checkout}>
      <PlanPicker lang={lang} value={tier} onChange={(n) => void change(n)} />
      <Card className="p-3 font-semibold">{t[tier]}: {price} {t.perMonth}</Card>
      <Button disabled={busy} onClick={pay}>{busy ? t.wait : t.pay}</Button>
      <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t.signOut}</Button>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </Shell>
  );
}
