// Tablia tenant pages: the owner console (menu, events, customers, orders) and the public mobile page
// served on <slug>.<VITE_TENANT_ROOT_DOMAIN> (or /t/<slug> for testing). Arabic (RTL) and English.
// The public page never writes a table: it calls place_order / create_reservation, which price on the server.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@tablia/ui';
import { supabase } from '../lib/core';
import { Checkout, OwnerAuth, OwnerSetup, useCheckoutDue } from './OwnerOnboarding';

export type Lang = 'ar' | 'en';
const RESERVED = new Set(['www', 'app', 'admin', 'api', 'owner', 'staff']);
const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function tenantSlugFrom(hostname: string, pathname: string, root = import.meta.env.VITE_TENANT_ROOT_DOMAIN ?? ''): string | null {
  const m = /^\/t\/([a-z0-9-]{1,63})\/?$/.exec(pathname);
  if (m && SLUG.test(m[1])) return m[1];
  const host = hostname.toLowerCase();
  const r = root.toLowerCase();
  if (!r || !host.endsWith('.' + r)) return null;
  const sub = host.slice(0, -(r.length + 1));
  return SLUG.test(sub) && !RESERVED.has(sub) ? sub : null;
}

export const egp = (piasters: number, lang: Lang) =>
  new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(piasters / 100);

const T = {
  en: {
    lang: 'العربية', menu: 'Menu', events: 'Events', customers: 'Customers', orders: 'Orders', reservations: 'Reservations',
    cart: 'Your order', add: 'Add', soldOut: 'Sold out', askPrice: 'Ask for price', name: 'Name', email: 'Email', phone: 'Phone',
    type: 'Order type', dine_in: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery', pay: 'Payment', cash: 'Cash', paymob: 'Card / wallet (Paymob)',
    table: 'Table', address: 'Delivery address', notes: 'Notes', placeOrder: 'Place order', total: 'Total', book: 'Book a table',
    when: 'Date and time', party: 'Guests', event: 'Event', none: 'None', sent: 'Received. Total confirmed by the restaurant:',
    booked: 'Request received. Status:', notFound: 'This restaurant was not found.', loading: 'Loading…', signIn: 'Sign in', password: 'Password',
    signOut: 'Sign out', noOrg: 'This account is not linked to a restaurant yet.', save: 'Save', available: 'Available', price: 'Price (EGP)',
    nameAr: 'Arabic name', nameEn: 'English name', section: 'Section', newEvent: 'New event', titleAr: 'Arabic title', titleEn: 'English title',
    starts: 'Starts', capacity: 'Capacity', published: 'Published', status: 'Status', paid: 'Mark paid', ordersCount: 'Orders', spent: 'Ordered',
    error: 'Something went wrong:', plan: 'Plan', locked: 'Locked', upgradeNote: 'Not in your plan. Upgrade to', domains: 'Domains', seats: 'Seats', fee: 'Online fee',
    tier_starter: 'Starter (3,999 EGP)', tier_growth: 'Growth (6,999 EGP)', tier_enterprise: 'Enterprise (10,000 EGP)',
    mod_live_orders_feed: 'Live orders feed', mod_table_reservations: 'Table reservations', mod_event_ticketing: 'Live event ticketing',
    mod_historical_reporting: 'Historical reports', mod_multi_brand_menus: 'Multi-brand menus', mod_advanced_tagging: 'Advanced guest tagging',
  },
  ar: {
    lang: 'English', menu: 'المنيو', events: 'الفعاليات', customers: 'العملاء', orders: 'الطلبات', reservations: 'الحجوزات',
    cart: 'طلبك', add: 'أضف', soldOut: 'خلص', askPrice: 'اسأل عن السعر', name: 'الاسم', email: 'الإيميل', phone: 'الموبايل',
    type: 'نوع الطلب', dine_in: 'في المطعم', takeaway: 'تيك أواي', delivery: 'توصيل', pay: 'الدفع', cash: 'كاش', paymob: 'كارت / محفظة (Paymob)',
    table: 'الترابيزة', address: 'عنوان التوصيل', notes: 'ملاحظات', placeOrder: 'اطلب', total: 'الإجمالي', book: 'احجز ترابيزة',
    when: 'اليوم والساعة', party: 'عدد الأفراد', event: 'الفعالية', none: 'بدون', sent: 'تم استلام طلبك. الإجمالي حسب المطعم:',
    booked: 'تم استلام الحجز. الحالة:', notFound: 'المطعم ده مش موجود.', loading: 'جاري التحميل…', signIn: 'تسجيل الدخول', password: 'كلمة السر',
    signOut: 'خروج', noOrg: 'الحساب ده مش مربوط بمطعم لسه.', save: 'حفظ', available: 'متاح', price: 'السعر (جنيه)',
    nameAr: 'الاسم بالعربي', nameEn: 'الاسم بالإنجليزي', section: 'القسم', newEvent: 'فعالية جديدة', titleAr: 'العنوان بالعربي', titleEn: 'العنوان بالإنجليزي',
    starts: 'تبدأ', capacity: 'العدد', published: 'منشورة', status: 'الحالة', paid: 'اتدفع', ordersCount: 'الطلبات', spent: 'إجمالي الطلبات',
    error: 'حصلت مشكلة:', plan: 'الباقة', locked: 'مقفول', upgradeNote: 'مش ضمن باقتك. اترقى إلى', domains: 'الدومينات', seats: 'المديرين', fee: 'رسوم الأونلاين',
    tier_starter: 'Starter (3,999 جنيه)', tier_growth: 'Growth (6,999 جنيه)', tier_enterprise: 'Enterprise (10,000 جنيه)',
    mod_live_orders_feed: 'الطلبات لحظة بلحظة', mod_table_reservations: 'حجز الترابيزات', mod_event_ticketing: 'تذاكر الفعاليات',
    mod_historical_reporting: 'التقارير التاريخية', mod_multi_brand_menus: 'منيوهات لأكتر من براند', mod_advanced_tagging: 'تصنيف العملاء المتقدم',
  },
} as const;
type Dict = { [K in keyof typeof T.en]: string };

function useLang(): [Lang, Dict, () => void] {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('tablia-lang') === 'en' ? 'en' : 'ar'));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('tablia-lang', lang);
  }, [lang]);
  return [lang, T[lang], () => setLang(lang === 'ar' ? 'en' : 'ar')];
}

const pick = (lang: Lang, ar: string | null, en: string | null) => (lang === 'en' ? en || ar : ar || en) ?? '';

// ---------------- public mobile page ----------------
interface PubItem { id: string; name_ar: string; name_en: string | null; description_ar: string | null; description_en: string | null; price_piasters: number | null; available: boolean }
interface PubSection { id: string; name_ar: string; name_en: string | null; items: PubItem[] }
interface PubEvent { id: string; title_ar: string | null; title_en: string | null; starts_at: string; price_piasters: number; capacity: number | null }
interface Storefront { organization: { name: string; slug: string }; sections: PubSection[]; events: PubEvent[] }
type TxType = 'dine_in' | 'takeaway' | 'delivery';
type PayMethod = 'cash' | 'paymob';

export function StorefrontPage({ slug }: { slug: string }) {
  const [lang, t, toggle] = useLang();
  const [data, setData] = useState<Storefront | null>(null);
  const [failed, setFailed] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [who, setWho] = useState({ name: '', email: '', phone: '' });
  const [tx, setTx] = useState<TxType>('takeaway');
  const [pay, setPay] = useState<PayMethod>('cash');
  const [extra, setExtra] = useState({ table: '', address: '', notes: '' });
  const [res, setRes] = useState({ when: '', party: '2', event: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.rpc('get_public_storefront', { p_slug: slug }).then(({ data: d, error }) => {
      if (error || !d) setFailed(true); else setData(d as Storefront);
    });
  }, [slug]);

  const items = useMemo(() => new Map((data?.sections ?? []).flatMap((s) => s.items).map((i) => [i.id, i])), [data]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  // Display only: the server recomputes every price in place_order.
  const estimate = lines.reduce((sum, [id, q]) => sum + (items.get(id)?.price_piasters ?? 0) * q, 0);
  const customer = { name: who.name, email: who.email, phone: who.phone, lang };

  async function order() {
    setMsg('');
    const { data: r, error } = await supabase.rpc('place_order', {
      p_slug: slug, p_customer: customer, p_items: lines.map(([item_id, quantity]) => ({ item_id, quantity })),
      p_transaction_type: tx, p_payment_method: pay, p_notes: extra.notes || null,
      p_table_label: tx === 'dine_in' ? extra.table || null : null, p_delivery_address: tx === 'delivery' ? extra.address || null : null,
    });
    if (error) { setMsg(t.error + ' ' + error.message); return; }
    setCart({});
    setMsg(t.sent + ' ' + egp((r as { total_piasters: number }).total_piasters, lang));
  }

  async function reserve() {
    setMsg('');
    const { data: r, error } = await supabase.rpc('create_reservation', {
      p_slug: slug, p_customer: customer, p_reserved_for: res.when ? new Date(res.when).toISOString() : null,
      p_party_size: Number(res.party), p_event_id: res.event || null,
    });
    setMsg(error ? t.error + ' ' + error.message : t.booked + ' ' + (r as { status: string }).status);
  }

  if (failed) return <main className="p-6 text-center">{t.notFound}</main>;
  if (!data) return <main className="p-6 text-center">{t.loading}</main>;
  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#8B1E14]">{data.organization.name}</h1>
        <Button variant="ghost" onClick={toggle}>{t.lang}</Button>
      </header>
      {data.events.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t.events}</h2>
          {data.events.map((e) => (
            <Card key={e.id} className="p-3">
              <div className="font-medium">{pick(lang, e.title_ar, e.title_en)}</div>
              <div className="text-sm opacity-70">{new Date(e.starts_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}{e.price_piasters > 0 ? ' · ' + egp(e.price_piasters, lang) : ''}</div>
            </Card>
          ))}
        </section>
      )}
      {data.sections.map((s) => (
        <section key={s.id} className="space-y-2">
          <h2 className="text-lg font-semibold text-[#2E4F23]">{pick(lang, s.name_ar, s.name_en)}</h2>
          {s.items.map((i) => (
            <Card key={i.id} className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="font-medium">{pick(lang, i.name_ar, i.name_en)}</div>
                {pick(lang, i.description_ar, i.description_en) && <div className="text-xs opacity-70">{pick(lang, i.description_ar, i.description_en)}</div>}
                <div className="text-sm">{i.price_piasters == null ? t.askPrice : egp(i.price_piasters, lang)}</div>
              </div>
              {i.available && i.price_piasters != null
                ? <Button onClick={() => setCart({ ...cart, [i.id]: Math.min(50, (cart[i.id] ?? 0) + 1) })}>{t.add}{cart[i.id] ? ' (' + cart[i.id] + ')' : ''}</Button>
                : <Badge>{t.soldOut}</Badge>}
            </Card>
          ))}
        </section>
      ))}
      <Card className="space-y-3 p-4">
        <Field label={t.name}><Input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></Field>
        <Field label={t.email}><Input type="email" required value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></Field>
        <Field label={t.phone}><Input type="tel" value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} /></Field>
      </Card>
      {lines.length > 0 && (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">{t.cart}</h2>
          {lines.map(([id, q]) => (
            <div key={id} className="flex justify-between text-sm">
              <span>{q} × {pick(lang, items.get(id)?.name_ar ?? '', items.get(id)?.name_en ?? null)}</span>
              <button onClick={() => setCart({ ...cart, [id]: q - 1 })}>−</button>
            </div>
          ))}
          <Field label={t.type}>
            <Select value={tx} onChange={(e) => setTx(e.target.value as TxType)}>
              {(['takeaway', 'dine_in', 'delivery'] as const).map((v) => <option key={v} value={v}>{t[v]}</option>)}
            </Select>
          </Field>
          {tx === 'dine_in' && <Field label={t.table}><Input value={extra.table} onChange={(e) => setExtra({ ...extra, table: e.target.value })} /></Field>}
          {tx === 'delivery' && <Field label={t.address}><Textarea value={extra.address} onChange={(e) => setExtra({ ...extra, address: e.target.value })} /></Field>}
          <Field label={t.pay}>
            <Select value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
              <option value="cash">{t.cash}</option><option value="paymob">{t.paymob}</option>
            </Select>
          </Field>
          <Field label={t.notes}><Input value={extra.notes} onChange={(e) => setExtra({ ...extra, notes: e.target.value })} /></Field>
          <div className="flex items-center justify-between font-semibold"><span>{t.total} ≈ {egp(estimate, lang)}</span><Button onClick={order}>{t.placeOrder}</Button></div>
        </Card>
      )}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t.book}</h2>
        <Field label={t.when}><Input type="datetime-local" value={res.when} onChange={(e) => setRes({ ...res, when: e.target.value })} /></Field>
        <Field label={t.party}><Input type="number" min={1} max={40} value={res.party} onChange={(e) => setRes({ ...res, party: e.target.value })} /></Field>
        {data.events.length > 0 && (
          <Field label={t.event}>
            <Select value={res.event} onChange={(e) => setRes({ ...res, event: e.target.value })}>
              <option value="">{t.none}</option>
              {data.events.map((e) => <option key={e.id} value={e.id}>{pick(lang, e.title_ar, e.title_en)}</option>)}
            </Select>
          </Field>
        )}
        <Button onClick={reserve}>{t.book}</Button>
      </Card>
      {msg && <p role="status" className="rounded bg-black/5 p-3 text-sm">{msg}</p>}
    </main>
  );
}

// ---------------- owner console ----------------
interface OSection { id: string; name_ar: string; name_en: string | null }
interface OItem { id: string; section_id: string; name_ar: string; name_en: string | null; price_egp: number | null; is_available: boolean }
interface OEvent { id: string; title_ar: string | null; title_en: string | null; starts_at: string; capacity: number | null; price_piasters: number; is_published: boolean }
interface OCustomer { id: string; full_name: string | null; email: string; phone: string | null; orders_count: number; reservations_count: number; total_ordered_piasters: number }
interface OOrder { id: string; created_at: string; status: string; transaction_type: TxType; payment_method: PayMethod; payment_status: string; total_piasters: number; crm_customers: { email: string; full_name: string | null } | null }
interface OReservation { id: string; reserved_for: string; party_size: number; status: string; crm_customers: { email: string; full_name: string | null } | null }
type Tab = 'menu' | 'events' | 'customers' | 'orders';
const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];

export function OwnerConsole() {
  const [lang, t, toggle] = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('orders');
  const [plan, setPlan] = useState<Plan | null>(null);
  const due = useCheckoutDue(org);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setOrg(undefined); return; }
    supabase.rpc('get_auth_organization').then(({ data }) => setOrg((data as string | null) ?? null));
  }, [session]);
  useEffect(() => {
    if (!org) { setPlan(null); return; }
    supabase.rpc('get_my_plan').then(({ data }) => setPlan((data as Plan | null) ?? null));
  }, [org]);

  if (!session) return <OwnerAuth lang={lang} toggle={toggle} />;
  if (org === undefined) return <main className="p-6">{t.loading}</main>;
  if (org === null) return <OwnerSetup lang={lang} toggle={toggle} onDone={setOrg} />;
  if (due === undefined) return <main className="p-6">{t.loading}</main>;
  if (due) return <Checkout lang={lang} toggle={toggle} tier={due} />;
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <nav className="flex flex-wrap items-center gap-2">
        {(['orders', 'menu', 'events', 'customers'] as const).map((k) => (
          <Button key={k} variant={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)}>{t[k]}</Button>
        ))}
        <span className="flex-1" />
        <Button variant="ghost" onClick={toggle}>{t.lang}</Button>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t.signOut}</Button>
      </nav>
      {plan && <PlanPanel plan={plan} t={t} />}
      {tab === 'menu' && <OwnerMenu org={org} lang={lang} t={t} />}
      {tab === 'events' && (plan && !plan.event_ticketing ? <Locked t={t} module="event_ticketing" /> : <OwnerEvents org={org} lang={lang} t={t} />)}
      {tab === 'customers' && <OwnerCustomers lang={lang} t={t} />}
      {tab === 'orders' && <OwnerOrders lang={lang} t={t} />}
    </main>
  );
}

interface PageProps { lang: Lang; t: Dict }

function useLoad<R>(load: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const [rows, setRows] = useState<R[]>([]);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    load().then(({ data, error: e }) => { setRows((data as R[] | null) ?? []); setError(e ? e.message : ''); });
  }, [load]);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}

function OwnerMenu({ org, lang, t }: PageProps & { org: string }) {
  const sections = useLoad<OSection>(useCallback(() => supabase.from('menu_sections').select('id,name_ar,name_en').eq('organization_id', org).order('sort'), [org]));
  const ids = sections.rows.map((s) => s.id);
  const key = ids.join(',');
  const items = useLoad<OItem>(useCallback(
    () => supabase.from('menu_items').select('id,section_id,name_ar,name_en,price_egp,is_available').in('section_id', key ? key.split(',') : []).order('sort'),
    [key]));
  const [draft, setDraft] = useState({ section_id: '', name_ar: '', name_en: '', price: '' });

  async function update(id: string, patch: Partial<OItem>) {
    await supabase.from('menu_items').update({ ...patch, updated_by: null }).eq('id', id);
    items.reload();
  }
  async function add() {
    const section = draft.section_id || ids[0];
    if (!section || !draft.name_ar) return;
    await supabase.from('menu_items').insert({ section_id: section, name_ar: draft.name_ar, name_en: draft.name_en || null,
      price_egp: draft.price ? Number(draft.price) : null, updated_by: null });
    setDraft({ ...draft, name_ar: '', name_en: '', price: '' });
    items.reload();
  }

  return (
    <section className="space-y-3">
      <Card className="grid gap-2 p-3 sm:grid-cols-5">
        <Select value={draft.section_id} onChange={(e) => setDraft({ ...draft, section_id: e.target.value })}>
          {sections.rows.map((s) => <option key={s.id} value={s.id}>{pick(lang, s.name_ar, s.name_en)}</option>)}
        </Select>
        <Input placeholder={t.nameAr} value={draft.name_ar} onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} />
        <Input placeholder={t.nameEn} value={draft.name_en} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} />
        <Input placeholder={t.price} type="number" min={0} step="0.5" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <Button onClick={add}>{t.add}</Button>
      </Card>
      {(sections.error || items.error) && <p className="text-sm text-red-700">{sections.error || items.error}</p>}
      {sections.rows.map((s) => (
        <div key={s.id} className="space-y-1">
          <h2 className="font-semibold">{pick(lang, s.name_ar, s.name_en)}</h2>
          {items.rows.filter((i) => i.section_id === s.id).map((i) => (
            <Card key={i.id} className="flex items-center gap-2 p-2 text-sm">
              <span className="flex-1">{pick(lang, i.name_ar, i.name_en)}</span>
              <Input className="w-24" type="number" min={0} step="0.5" defaultValue={i.price_egp ?? ''}
                onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== i.price_egp) void update(i.id, { price_egp: v }); }} />
              <label className="flex items-center gap-1"><input type="checkbox" checked={i.is_available} onChange={(e) => void update(i.id, { is_available: e.target.checked })} />{t.available}</label>
            </Card>
          ))}
        </div>
      ))}
    </section>
  );
}

function OwnerEvents({ org, lang, t }: PageProps & { org: string }) {
  const events = useLoad<OEvent>(useCallback(() => supabase.from('restaurant_events').select('id,title_ar,title_en,starts_at,capacity,price_piasters,is_published').order('starts_at', { ascending: false }), []));
  const reservations = useLoad<OReservation>(useCallback(() => supabase.from('reservations').select('id,reserved_for,party_size,status,crm_customers(email,full_name)').order('reserved_for', { ascending: false }).limit(100), []));
  const [d, setD] = useState({ title_ar: '', title_en: '', starts: '', capacity: '', price: '' });
  const [err, setErr] = useState('');

  async function create() {
    const { error } = await supabase.from('restaurant_events').insert({
      organization_id: org, title_ar: d.title_ar || null, title_en: d.title_en || null,
      starts_at: d.starts ? new Date(d.starts).toISOString() : null, capacity: d.capacity ? Number(d.capacity) : null,
      price_piasters: d.price ? Math.round(Number(d.price) * 100) : 0,
    });
    setErr(error ? error.message : '');
    if (!error) { setD({ title_ar: '', title_en: '', starts: '', capacity: '', price: '' }); events.reload(); }
  }

  return (
    <section className="space-y-3">
      <Card className="grid gap-2 p-3 sm:grid-cols-3">
        <Input placeholder={t.titleAr} value={d.title_ar} onChange={(e) => setD({ ...d, title_ar: e.target.value })} />
        <Input placeholder={t.titleEn} value={d.title_en} onChange={(e) => setD({ ...d, title_en: e.target.value })} />
        <Input type="datetime-local" aria-label={t.starts} value={d.starts} onChange={(e) => setD({ ...d, starts: e.target.value })} />
        <Input placeholder={t.capacity} type="number" min={1} value={d.capacity} onChange={(e) => setD({ ...d, capacity: e.target.value })} />
        <Input placeholder={t.price} type="number" min={0} value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} />
        <Button onClick={create}>{t.newEvent}</Button>
      </Card>
      {(err || events.error) && <p className="text-sm text-red-700">{err || events.error}</p>}
      {events.rows.map((e) => (
        <Card key={e.id} className="flex items-center gap-2 p-2 text-sm">
          <span className="flex-1">{pick(lang, e.title_ar, e.title_en)} · {new Date(e.starts_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')} · {egp(e.price_piasters, lang)}</span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={e.is_published}
              onChange={async (x) => { await supabase.from('restaurant_events').update({ is_published: x.target.checked }).eq('id', e.id); events.reload(); }} />
            {t.published}
          </label>
        </Card>
      ))}
      <h2 className="font-semibold">{t.reservations}</h2>
      {reservations.rows.map((r) => (
        <Card key={r.id} className="flex items-center gap-2 p-2 text-sm">
          <span className="flex-1">{new Date(r.reserved_for).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')} · {r.party_size} · {r.crm_customers?.full_name || r.crm_customers?.email}</span>
          <Select value={r.status} onChange={async (x) => { await supabase.from('reservations').update({ status: x.target.value }).eq('id', r.id); reservations.reload(); }}>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Card>
      ))}
    </section>
  );
}

function OwnerCustomers({ lang, t }: PageProps) {
  const customers = useLoad<OCustomer>(useCallback(() => supabase.from('crm_customers').select('id,full_name,email,phone,orders_count,reservations_count,total_ordered_piasters').order('last_seen_at', { ascending: false }).limit(200), []));
  return (
    <section className="overflow-x-auto">
      {customers.error && <p className="text-sm text-red-700">{customers.error}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-start"><th>{t.name}</th><th>{t.email}</th><th>{t.phone}</th><th>{t.ordersCount}</th><th>{t.reservations}</th><th>{t.spent}</th></tr></thead>
        <tbody>
          {customers.rows.map((c) => (
            <tr key={c.id} className="border-t"><td>{c.full_name}</td><td>{c.email}</td><td dir="ltr">{c.phone}</td><td>{c.orders_count}</td><td>{c.reservations_count}</td><td>{egp(c.total_ordered_piasters, lang)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OwnerOrders({ lang, t }: PageProps) {
  const orders = useLoad<OOrder>(useCallback(() => supabase.from('orders').select('id,created_at,status,transaction_type,payment_method,payment_status,total_piasters,crm_customers(email,full_name)').order('created_at', { ascending: false }).limit(100), []));
  async function patch(id: string, p: Record<string, string>) {
    await supabase.from('orders').update(p).eq('id', id);
    orders.reload();
  }
  return (
    <section className="space-y-2">
      {orders.error && <p className="text-sm text-red-700">{orders.error}</p>}
      {orders.rows.map((o) => (
        <Card key={o.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
          <span className="flex-1">{new Date(o.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')} · {o.crm_customers?.full_name || o.crm_customers?.email} · {t[o.transaction_type]} · {egp(o.total_piasters, lang)}</span>
          <Badge>{t[o.payment_method]} · {o.payment_status}</Badge>
          {o.payment_method === 'cash' && o.payment_status === 'unpaid' && <Button variant="ghost" onClick={() => patch(o.id, { payment_status: 'paid' })}>{t.paid}</Button>}
          <Select value={o.status} onChange={(e) => patch(o.id, { status: e.target.value })}>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Card>
      ))}
    </section>
  );
}

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
const tierLabel = (t: Dict, tier: Tier) => t[`tier_${tier}` as const];

function Locked({ t, module }: { t: Dict; module: Module }) {
  return (
    <Card className="space-y-1 p-3 text-sm">
      <div className="flex items-center gap-2"><Badge>🔒 {t.locked}</Badge><strong>{t[`mod_${module}` as const]}</strong></div>
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
