import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { Badge, Button, Card, Field, Input, Select } from '@mela-rossa/ui';
import {
  BRANCHES, ROLES, anon, can, endOfDayCairo, flush, isSoldOut, outboxEvents, outboxState, provisionUrl, resolveConflict,
  submit, supabase, supabaseConfigured, todayCairo,
  type Booking, type BookingStatus, type Branch, type Conflict, type Device, type MenuItem, type MenuSection, type Role, type Staff, type WaRequest,
} from './lib/core';
import { identify, track } from './lib/telemetry';
import { OpsConsole } from './OpsConsole';

// ---- i18n: English and Egyptian Arabic (RTL) ----
type Lang = 'en' | 'ar';
const EN = {
  ops: 'Operations', menu: 'Menu', bookings: 'Bookings', whatsapp: 'WhatsApp', staff: 'Staff', search: 'Search', soldOut: 'Sold out', available: 'Available',
  soldToday: 'Sold out today', soldNoEnd: 'Sold out, no end', edit: 'Edit', save: 'Save', cancel: 'Cancel', addItem: 'Add item', askPrice: 'Ask for price',
  nameAr: 'Arabic name', nameEn: 'English name', price: 'Price (EGP)', group: 'Group', newBooking: 'New booking', date: 'Date', time: 'Time',
  guests: 'Guests', branch: 'Branch', guestName: 'Guest name', phone: 'Phone', notes: 'Notes', covers: 'Covers today', newRequest: 'New request',
  message: 'Message', reply: 'Reply on WhatsApp', markReplied: 'Mark replied', createBooking: 'Create booking', close: 'Close',
  reasonPrompt: 'This guest got a reply in the last 24 hours. Why message again?', closeReason: 'Reason for closing', cancelReason: 'Cancel reason',
  addStaff: 'Add staff / device', role: 'Role', device: 'Device label', generate: 'Generate QR', expires: 'Expires in', revoke: 'Revoke',
  devices: 'Devices', synced: 'Synced', offline: 'Offline', syncing: 'Syncing', pending: 'pending', syncNow: 'Sync now', keepMine: 'Keep mine',
  keepServer: 'Keep server', signedOut: 'This device is not signed in. Ask a manager for a QR code (SOP 05).', notConfigured: 'Supabase env vars are missing (see .env.example).',
  needsOnline: 'Needs a connection.', duplicate: 'This phone already has a booking that day. Continue?', bigGroup: 'More than 12 guests: a manager must confirm.',
  provisioning: 'Setting up this device…', active: 'Active', all: 'All',
  corniche: 'Corniche', new_damietta: 'New Damietta', admin: 'Admin', manager: 'Manager', front_desk: 'Front desk', kitchen: 'Kitchen',
  pendingS: 'Pending', confirmed: 'Confirmed', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
  new: 'New', replied: 'Replied', converted: 'Converted', closed: 'Closed',
};
type Dict = typeof EN;
const AR: Dict = {
  ops: 'التشغيل', menu: 'المنيو', bookings: 'الحجوزات', whatsapp: 'واتساب', staff: 'الموظفين', search: 'دوّر', soldOut: 'خلص', available: 'متاح',
  soldToday: 'خلص النهارده', soldNoEnd: 'خلص لحد ما نرجّعه', edit: 'تعديل', save: 'حفظ', cancel: 'إلغاء', addItem: 'صنف جديد', askPrice: 'اسأل عن السعر',
  nameAr: 'الاسم بالعربي', nameEn: 'الاسم بالإنجليزي', price: 'السعر (ج.م)', group: 'المجموعة', newBooking: 'حجز جديد', date: 'اليوم', time: 'الساعة',
  guests: 'عدد الأفراد', branch: 'الفرع', guestName: 'اسم الضيف', phone: 'الموبايل', notes: 'ملاحظات', covers: 'أفراد النهارده', newRequest: 'طلب جديد',
  message: 'الرسالة', reply: 'رد على واتساب', markReplied: 'اترد عليه', createBooking: 'اعمل حجز', close: 'اقفل',
  reasonPrompt: 'الضيف ده اترد عليه في آخر ٢٤ ساعة. ليه هتبعتله تاني؟', closeReason: 'سبب القفل', cancelReason: 'سبب الإلغاء',
  addStaff: 'إضافة موظف/جهاز', role: 'الدور', device: 'اسم الجهاز', generate: 'اعمل QR', expires: 'باقي', revoke: 'إلغاء الجهاز',
  devices: 'الأجهزة', synced: 'متزامن', offline: 'مفيش نت', syncing: 'بيزامن', pending: 'مستني', syncNow: 'زامن دلوقتي', keepMine: 'خلي بتاعي',
  keepServer: 'خلي اللي على السيرفر', signedOut: 'الجهاز ده مش داخل. اطلب QR من المدير.', notConfigured: 'إعدادات Supabase ناقصة.',
  needsOnline: 'محتاج نت.', duplicate: 'الرقم ده له حجز في نفس اليوم. نكمّل؟', bigGroup: 'أكتر من ١٢ فرد: المدير لازم يأكد.',
  provisioning: 'بنجهّز الجهاز…', active: 'شغّال', all: 'الكل',
  corniche: 'الكورنيش', new_damietta: 'دمياط الجديدة', admin: 'أدمن', manager: 'مدير', front_desk: 'استقبال', kitchen: 'مطبخ',
  pendingS: 'مستني', confirmed: 'متأكد', seated: 'قعد', completed: 'خلص', cancelled: 'اتلغى', no_show: 'مجاش',
  new: 'جديد', replied: 'اترد عليه', converted: 'اتحوّل لحجز', closed: 'اتقفل',
};
const lbl = (t: Dict, k: string) => (k === 'pending' ? t.pendingS : (t as Record<string, string>)[k] ?? k);

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('mr.lang') as Lang) || 'ar');
  const t = lang === 'ar' ? AR : EN;
  useEffect(() => {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('mr.lang', lang);
  }, [lang]);
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'menu' | 'bookings' | 'whatsapp' | 'staff' | 'ops'>('menu');

  const loadStaff = useCallback(async (s: Session | null) => {
    if (!s) { setStaff(null); return; }
    const { data } = await supabase.from('staff').select('id, display_name, role, branch, active').eq('id', s.user.id).maybeSingle();
    const cached = localStorage.getItem('mr.staff');
    const st = (data as Staff | null) ?? (cached ? (JSON.parse(cached) as Staff) : null);
    if (st && st.id === s.user.id) { setStaff(st); localStorage.setItem('mr.staff', JSON.stringify(st)); identify(st.id, st.role); } else setStaff(null);
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith('/provision')) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadStaff(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setTimeout(() => void loadStaff(s), 0); });
    return () => sub.subscription.unsubscribe();
  }, [loadStaff]);

  const shell = (body: React.ReactNode) => <main className="mx-auto max-w-5xl p-4">{body}</main>;
  if (location.pathname.startsWith('/provision')) return shell(<Provision t={t} />);
  if (!supabaseConfigured) return shell(<Card>{t.notConfigured}</Card>);
  if (loading) return shell(<p className="text-white/60">…</p>);
  if (!session || !staff || !staff.active) return shell(<Card>{t.signedOut}</Card>);
  const me = staff;
  const tabs = (['menu', 'bookings', 'whatsapp', 'staff', 'ops'] as const).filter((k) =>
    k === 'menu' || k === 'ops' || k === 'bookings' || (k === 'whatsapp' && can(me.role, 'whatsapp')) || (k === 'staff' && can(me.role, 'staff')));

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-white/10 bg-brand-dark/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 p-3">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div className="me-auto leading-tight">
            <div className="font-bold">Mela Rossa</div>
            <div className="text-xs text-white/60">{me.display_name} · {lbl(t, me.role)} · {me.branch ? lbl(t, me.branch) : t.all}</div>
          </div>
          <SyncBadge t={t} staffId={me.id} />
          <Button variant="ghost" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'EN' : 'عربي'}</Button>
        </div>
        <nav className="mx-auto flex max-w-5xl flex-wrap gap-1 px-3 pb-2">
          {tabs.map((k) => <Button key={k} variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>{t[k]}</Button>)}
        </nav>
      </header>
      {shell(<>
        {tab === 'menu' && <MenuPage t={t} lang={lang} me={me} />}
        {tab === 'bookings' && <BookingsPage t={t} me={me} />}
        {tab === 'whatsapp' && <WhatsAppPage t={t} lang={lang} me={me} />}
        {tab === 'staff' && <StaffPage t={t} me={me} token={session.access_token} />}
        {tab === 'ops' && <OpsConsole lang={lang} me={me} />}
      </>)}
    </>
  );
}

function SyncBadge({ t, staffId }: { t: Dict; staffId: string }) {
  const [s, setS] = useState({ pending: 0, conflicts: [] as Conflict[], syncing: false, online: navigator.onLine });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => void outboxState().then((o) => setS({ ...o, online: navigator.onLine }));
    const online = () => { refresh(); void flush(staffId); };
    outboxEvents.addEventListener('change', refresh); addEventListener('online', online); addEventListener('offline', refresh);
    const iv = setInterval(() => void flush(staffId), 30000); online();
    return () => { outboxEvents.removeEventListener('change', refresh); removeEventListener('online', online); removeEventListener('offline', refresh); clearInterval(iv); };
  }, [staffId]);
  const bad = s.pending + s.conflicts.length;
  const text = !s.online ? t.offline : s.syncing ? t.syncing : bad ? `${bad} ${t.pending}` : t.synced;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}><Badge tone={!s.online ? 'neutral' : s.syncing ? 'amber' : bad ? 'red' : 'green'}>{text}</Badge></button>
      {open && (
        <Card className="absolute end-0 top-8 z-20 w-72 space-y-2 bg-brand-dark">
          <Button className="w-full" onClick={() => void flush(staffId)}>{t.syncNow}</Button>
          {s.conflicts.map((c, i) => (
            <div key={c.op.id} className="text-xs">
              <div>{c.op.table ?? c.op.fn}: {c.reason}</div>
              <div className="mt-1 flex gap-1">
                <Button variant="secondary" onClick={() => void resolveConflict(i, 'mine', staffId)}>{t.keepMine}</Button>
                <Button variant="secondary" onClick={() => void resolveConflict(i, 'server', staffId)}>{t.keepServer}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---- Menu (SOP 02) ----
function MenuPage({ t, lang, me }: { t: Dict; lang: Lang; me: Staff }) {
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<MenuItem> | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [s, i] = await Promise.all([supabase.from('menu_sections').select('*').order('sort'), supabase.from('menu_items').select('*').order('sort')]);
    if (s.data) setSections(s.data as MenuSection[]);
    if (i.data) setItems(i.data as MenuItem[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setAvail = (it: MenuItem, available: boolean, until: string | null) => {
    setItems((all) => all.map((x) => (x.id === it.id ? { ...x, is_available: available, sold_out_until: available ? null : until } : x)));
    void submit({ kind: 'rpc', fn: 'set_item_availability', args: { p_item: it.id, p_available: available, p_until: until } }, me.id);
    track('menu_availability', { available });
  };
  const saveItem = async () => {
    if (!edit) return;
    if (!navigator.onLine) { setErr(t.needsOnline); return; }
    const price = edit.price_egp == null || String(edit.price_egp) === '' ? null : Number(edit.price_egp);
    if (price !== null && (!Number.isFinite(price) || price <= 0)) { setErr(t.price); return; }
    const row = { section_id: edit.section_id, name_ar: edit.name_ar, name_en: edit.name_en || null, group_ar: edit.group_ar || null, description_ar: edit.description_ar || null, price_egp: price };
    const res = edit.id ? await supabase.from('menu_items').update(row).eq('id', edit.id) : await supabase.from('menu_items').insert(row);
    if (res.error) { setErr(res.error.message); return; }
    setEdit(null); setErr(''); void load();
  };
  const n = q.trim().toLowerCase();
  return (
    <div className="space-y-4">
      <Input placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="text-sm text-red-300">{err}</p>}
      {edit && (
        <Card className="grid gap-2 sm:grid-cols-2">
          <Field label={t.nameAr}><Input dir="rtl" value={edit.name_ar ?? ''} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
          <Field label={t.nameEn}><Input dir="ltr" value={edit.name_en ?? ''} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
          <Field label={t.price} hint={t.askPrice}><Input inputMode="decimal" value={edit.price_egp ?? ''} onChange={(e) => setEdit({ ...edit, price_egp: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label={t.group}><Input value={edit.group_ar ?? ''} onChange={(e) => setEdit({ ...edit, group_ar: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2"><Button onClick={() => void saveItem()}>{t.save}</Button><Button variant="secondary" onClick={() => setEdit(null)}>{t.cancel}</Button></div>
        </Card>
      )}
      {sections.map((s) => {
        const list = items.filter((i) => i.section_id === s.id && (!n || `${i.name_ar} ${i.name_en ?? ''} ${i.group_ar ?? ''}`.toLowerCase().includes(n)));
        if (!list.length && n) return null;
        return (
          <section key={s.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="me-auto text-lg font-bold">{lang === 'en' && s.name_en ? s.name_en : s.name_ar}{s.branch && <Badge className="ms-2">{lbl(t, s.branch)}</Badge>}</h2>
              {can(me.role, 'menu.edit') && <Button variant="secondary" onClick={() => setEdit({ section_id: s.id })}>{t.addItem}</Button>}
            </div>
            {list.map((i) => {
              const out = isSoldOut(i);
              return (
                <Card key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="me-auto">
                    <div className="font-semibold">{lang === 'en' && i.name_en ? i.name_en : i.name_ar}</div>
                    <div className="text-xs text-white/50">{i.group_ar}</div>
                  </div>
                  <span className="font-bold">{i.price_egp == null ? t.askPrice : `${i.price_egp} EGP`}</span>
                  <Badge tone={out ? 'red' : 'green'}>{out ? t.soldOut : t.available}</Badge>
                  {can(me.role, 'menu.availability') && (out
                    ? <Button variant="success" onClick={() => setAvail(i, true, null)}>{t.available}</Button>
                    : <>
                        <Button variant="secondary" onClick={() => setAvail(i, false, endOfDayCairo())}>{t.soldToday}</Button>
                        <Button variant="secondary" onClick={() => setAvail(i, false, null)}>{t.soldNoEnd}</Button>
                      </>)}
                  {can(me.role, 'menu.edit') && <Button variant="ghost" onClick={() => setEdit(i)}>{t.edit}</Button>}
                </Card>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---- Bookings (SOP 03) ----
const NEXT: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'], confirmed: ['seated', 'no_show', 'cancelled'], seated: ['completed'], completed: [], cancelled: [], no_show: [],
};
function BookingsPage({ t, me }: { t: Dict; me: Staff }) {
  const [date, setDate] = useState(todayCairo());
  const [rows, setRows] = useState<Booking[]>([]);
  const [covers, setCovers] = useState<Record<string, number>>({});
  const [form, setForm] = useState<Partial<Booking> | null>(null);
  const full = can(me.role, 'bookings');
  const load = useCallback(async () => {
    const c: Record<string, number> = {};
    for (const b of BRANCHES) { const { data } = await supabase.rpc('covers_today', { p_branch: b }); c[b] = Number(data ?? 0); }
    setCovers(c);
    if (!full) return;
    const { data } = await supabase.from('bookings').select('*').eq('booking_date', date).order('booking_time');
    if (data) setRows(data as Booking[]);
  }, [date, full]);
  useEffect(() => { void load(); }, [load]);

  const setStatus = (b: Booking, status: BookingStatus) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'cancelled') { const r = prompt(t.cancelReason); if (!r) return; patch.cancel_reason = r; }
    setRows((all) => all.map((x) => (x.id === b.id ? { ...x, status } : x)));
    void submit({ kind: 'update', table: 'bookings', rowId: b.id, patch, baseUpdatedAt: b.updated_at }, me.id);
  };
  const create = () => {
    if (!form?.guest_name || !form.booking_time || !form.guests || !form.branch) return;
    if (form.guest_phone && rows.some((r) => r.guest_phone === form.guest_phone && r.branch === form.branch && r.status !== 'cancelled') && !confirm(t.duplicate)) return;
    const id = crypto.randomUUID();
    const status: BookingStatus = form.guests > 12 && me.role === 'front_desk' ? 'pending' : 'pending';
    const patch = { branch: form.branch, booking_date: date, booking_time: form.booking_time, guests: form.guests, guest_name: form.guest_name, guest_phone: form.guest_phone || null, notes: form.notes || null, source: 'phone', status };
    setRows((all) => [...all, { ...(patch as unknown as Booking), id, updated_at: new Date().toISOString() }]);
    void submit({ kind: 'insert', table: 'bookings', rowId: id, patch }, me.id);
    setForm(null);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {BRANCHES.map((b) => <Badge key={b} tone="green">{t.covers} · {lbl(t, b)}: {covers[b] ?? 0}</Badge>)}
      </div>
      {full && <>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t.date}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Button onClick={() => setForm({ branch: me.branch ?? 'corniche', guests: 2 })}>{t.newBooking}</Button>
        </div>
        {form && (
          <Card className="grid gap-2 sm:grid-cols-3">
            <Field label={t.branch}><Select value={form.branch} disabled={!!me.branch && me.role !== 'admin'} onChange={(e) => setForm({ ...form, branch: e.target.value as Branch })}>{BRANCHES.map((b) => <option key={b} value={b}>{lbl(t, b)}</option>)}</Select></Field>
            <Field label={t.time}><Input type="time" min="10:00" max="22:00" value={form.booking_time ?? ''} onChange={(e) => setForm({ ...form, booking_time: e.target.value })} /></Field>
            <Field label={t.guests} hint={(form.guests ?? 0) > 12 ? t.bigGroup : undefined}><Input type="number" min={1} max={40} value={form.guests ?? ''} onChange={(e) => setForm({ ...form, guests: Number(e.target.value) })} /></Field>
            <Field label={t.guestName}><Input data-private value={form.guest_name ?? ''} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} /></Field>
            <Field label={t.phone}><Input data-private dir="ltr" inputMode="tel" value={form.guest_phone ?? ''} onChange={(e) => setForm({ ...form, guest_phone: e.target.value.replace(/[^\d+]/g, '') })} /></Field>
            <Field label={t.notes}><Input maxLength={300} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-3"><Button onClick={create}>{t.save}</Button><Button variant="secondary" onClick={() => setForm(null)}>{t.cancel}</Button></div>
          </Card>
        )}
        {rows.map((b) => (
          <Card key={b.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="font-bold">{b.booking_time.slice(0, 5)}</span>
            <span data-private className="me-auto">{b.guest_name} · {b.guests} · {lbl(t, b.branch)}</span>
            <Badge>{lbl(t, b.status)}</Badge>
            {NEXT[b.status].map((s) => <Button key={s} variant={s === 'cancelled' || s === 'no_show' ? 'secondary' : 'success'} onClick={() => setStatus(b, s)}>{lbl(t, s)}</Button>)}
          </Card>
        ))}
      </>}
    </div>
  );
}

// ---- WhatsApp inbox (SOP 04): never sends automatically ----
const toIntl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? `20${d.slice(1)}` : d; };
function WhatsAppPage({ t, lang, me }: { t: Dict; lang: Lang; me: Staff }) {
  const [rows, setRows] = useState<WaRequest[]>([]);
  const [form, setForm] = useState<Partial<WaRequest> | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('whatsapp_requests').select('*').order('created_at', { ascending: false }).limit(200);
    if (data) setRows(data as WaRequest[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const patch = (r: WaRequest, p: Partial<WaRequest>) => setRows((all) => all.map((x) => (x.id === r.id ? { ...x, ...p } : x)));

  const reply = (r: WaRequest, open: boolean) => {
    const recent = rows.some((x) => x.last_replied_at && (x.id === r.id || (r.guest_phone && x.guest_phone === r.guest_phone)) && Date.now() - new Date(x.last_replied_at).getTime() < 864e5);
    let reason: string | null = null;
    if (recent) { reason = prompt(t.reasonPrompt); if (!reason?.trim()) return; }
    if (open && r.guest_phone) {
      const when = r.requested_date && r.requested_time ? ` ${r.requested_date} ${r.requested_time.slice(0, 5)}` : '';
      const text = lang === 'ar'
        ? `أهلاً ${r.guest_name ?? ''}، معاك ميلا روسا فرع ${AR[r.branch]}. بخصوص طلب الحجز${when}…`
        : `Hello ${r.guest_name ?? ''}, this is Mela Rossa ${EN[r.branch]}. About your booking request${when}…`;
      window.open(`https://wa.me/${toIntl(r.guest_phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
    patch(r, { status: r.status === 'new' ? 'replied' : r.status, last_replied_at: new Date().toISOString(), reply_count: r.reply_count + 1 });
    void submit({ kind: 'rpc', fn: 'record_whatsapp_reply', args: { p_request: r.id, p_reason: reason } }, me.id);
  };
  const toBooking = (r: WaRequest) => {
    if (!r.requested_date || !r.requested_time || !r.guests) return;
    const id = crypto.randomUUID();
    void submit({ kind: 'insert', table: 'bookings', rowId: id, patch: { branch: r.branch, booking_date: r.requested_date, booking_time: r.requested_time, guests: r.guests, guest_name: r.guest_name || '-', guest_phone: r.guest_phone, source: 'whatsapp', status: 'confirmed', whatsapp_request_id: r.id } }, me.id);
    void submit({ kind: 'update', table: 'whatsapp_requests', rowId: r.id, patch: { status: 'converted', booking_id: id }, baseUpdatedAt: r.updated_at }, me.id);
    patch(r, { status: 'converted' });
  };
  const closeReq = (r: WaRequest) => {
    const reason = prompt(t.closeReason); if (!reason) return;
    void submit({ kind: 'update', table: 'whatsapp_requests', rowId: r.id, patch: { status: 'closed', close_reason: reason }, baseUpdatedAt: r.updated_at }, me.id);
    patch(r, { status: 'closed' });
  };
  const create = () => {
    if (!form?.branch || !form.guest_phone) return;
    const id = crypto.randomUUID();
    const p = { branch: form.branch, guest_name: form.guest_name || null, guest_phone: form.guest_phone, message: form.message || null, requested_date: form.requested_date || null, requested_time: form.requested_time || null, guests: form.guests || null };
    setRows((all) => [{ ...(p as WaRequest), id, status: 'new', reply_count: 0, last_replied_at: null, updated_at: new Date().toISOString() }, ...all]);
    void submit({ kind: 'insert', table: 'whatsapp_requests', rowId: id, patch: p }, me.id);
    setForm(null);
  };
  return (
    <div className="space-y-3">
      <Button onClick={() => setForm({ branch: me.branch ?? 'corniche' })}>{t.newRequest}</Button>
      {form && (
        <Card className="grid gap-2 sm:grid-cols-3">
          <Field label={t.branch}><Select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value as Branch })}>{BRANCHES.map((b) => <option key={b} value={b}>{lbl(t, b)}</option>)}</Select></Field>
          <Field label={t.guestName}><Input data-private value={form.guest_name ?? ''} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} /></Field>
          <Field label={t.phone}><Input data-private dir="ltr" value={form.guest_phone ?? ''} onChange={(e) => setForm({ ...form, guest_phone: e.target.value.replace(/[^\d+]/g, '') })} /></Field>
          <Field label={t.date}><Input type="date" value={form.requested_date ?? ''} onChange={(e) => setForm({ ...form, requested_date: e.target.value })} /></Field>
          <Field label={t.time}><Input type="time" value={form.requested_time ?? ''} onChange={(e) => setForm({ ...form, requested_time: e.target.value })} /></Field>
          <Field label={t.guests}><Input type="number" min={1} max={40} value={form.guests ?? ''} onChange={(e) => setForm({ ...form, guests: Number(e.target.value) })} /></Field>
          <Field label={t.message}><Input data-private value={form.message ?? ''} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-3"><Button onClick={create}>{t.save}</Button><Button variant="secondary" onClick={() => setForm(null)}>{t.cancel}</Button></div>
        </Card>
      )}
      {rows.map((r) => (
        <Card key={r.id} className="space-y-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span data-private className="me-auto font-semibold">{r.guest_name ?? '—'} · {lbl(t, r.branch)}</span>
            <Badge tone={r.status === 'new' ? 'red' : 'neutral'}>{lbl(t, r.status)}</Badge>
          </div>
          {r.message && <p data-private className="text-sm text-white/70">{r.message}</p>}
          {r.status !== 'closed' && r.status !== 'converted' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="success" onClick={() => reply(r, true)}>{t.reply}</Button>
              <Button variant="secondary" onClick={() => reply(r, false)}>{t.markReplied}</Button>
              <Button variant="secondary" disabled={!r.requested_date || !r.requested_time || !r.guests} onClick={() => toBooking(r)}>{t.createBooking}</Button>
              <Button variant="ghost" onClick={() => closeReq(r)}>{t.close}</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---- Staff, QR onboarding, devices (SOP 05, 06) ----
function StaffPage({ t, me, token }: { t: Dict; me: Staff; token: string }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({ display_name: '', role: 'front_desk' as Role, branch: (me.branch ?? 'corniche') as Branch | '', device_label: '', staff_id: '' });
  const [qr, setQr] = useState<{ img: string; expires: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [s, d] = await Promise.all([supabase.from('staff').select('*').order('display_name'), supabase.from('staff_devices').select('*').order('created_at', { ascending: false })]);
    if (s.data) setStaff(s.data as Staff[]);
    if (d.data) setDevices(d.data as Device[]);
  }, []);
  useEffect(() => { void load(); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, [load]);
  const roles = me.role === 'admin' ? ROLES : (['front_desk', 'kitchen'] as Role[]);

  const generate = async () => {
    setErr('');
    if (!navigator.onLine) { setErr(t.needsOnline); return; }
    const res = await fetch(provisionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify({ action: 'issue', ...form, staff_id: form.staff_id || undefined, branch: form.branch || null }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; expires_at?: string; error?: string };
    if (!res.ok || !body.token || !body.expires_at) { setErr(body.error ?? `HTTP ${res.status}`); return; }
    const img = await QRCode.toDataURL(`${location.origin}/provision#t=${body.token}`, { margin: 1, width: 280 });
    setQr({ img, expires: new Date(body.expires_at).getTime() });
    track('qr_issued', { role: form.role });
  };
  const revoke = async (d: Device) => {
    const { error } = await supabase.rpc('revoke_device', { p_device: d.id });
    if (error) setErr(error.message); else void load();
  };
  const update = async (s: Staff, p: Partial<Staff>) => {
    const { error } = await supabase.from('staff').update(p).eq('id', s.id);
    if (error) setErr(error.message); else void load();
  };
  const left = qr ? Math.max(0, Math.round((qr.expires - now) / 1000)) : 0;
  return (
    <div className="space-y-4">
      <Card className="grid gap-2 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">{t.addStaff}</h2>
        <Field label={t.staff}><Select value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}><option value="">+ {t.addStaff}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</Select></Field>
        {!form.staff_id && <>
          <Field label={t.guestName}><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label={t.role}><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{lbl(t, r)}</option>)}</Select></Field>
          <Field label={t.branch}><Select value={form.branch} disabled={me.role !== 'admin' && !!me.branch} onChange={(e) => setForm({ ...form, branch: e.target.value as Branch | '' })}>{me.role === 'admin' && <option value="">{t.all}</option>}{BRANCHES.map((b) => <option key={b} value={b}>{lbl(t, b)}</option>)}</Select></Field>
        </>}
        <Field label={t.device}><Input value={form.device_label} onChange={(e) => setForm({ ...form, device_label: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Button onClick={() => void generate()}>{t.generate}</Button></div>
        {err && <p className="text-sm text-red-300 sm:col-span-2">{err}</p>}
        {qr && left > 0 && <div className="space-y-1 sm:col-span-2"><img src={qr.img} alt="QR" className="rounded-xl bg-white p-2" /><p>{t.expires}: {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p></div>}
      </Card>
      {staff.map((s) => (
        <Card key={s.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-auto font-semibold">{s.display_name} · {s.branch ? lbl(t, s.branch) : t.all}</span>
            {can(me.role, 'staff.admin')
              ? <><Select className="w-40" value={s.role} onChange={(e) => void update(s, { role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{lbl(t, r)}</option>)}</Select>
                  <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.active} onChange={(e) => void update(s, { active: e.target.checked })} />{t.active}</label></>
              : <Badge>{lbl(t, s.role)}</Badge>}
          </div>
          {devices.filter((d) => d.staff_id === s.id).map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm text-white/70">
              <span className="me-auto">{d.label} · {d.created_at.slice(0, 10)}</span>
              {d.revoked_at ? <Badge tone="red">{t.revoke}</Badge> : <Button variant="secondary" onClick={() => void revoke(d)}>{t.revoke}</Button>}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

// ---- QR redeem: the token stays after '#', so it never reaches server logs ----
function Provision({ t }: { t: Dict }) {
  const [msg, setMsg] = useState(t.provisioning);
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('t');
    history.replaceState(null, '', '/provision');
    if (!token) { setMsg(t.signedOut); return; }
    void (async () => {
      const res = await fetch(provisionUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: anon },
        body: JSON.stringify({ action: 'redeem', token }),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
      if (!res.ok || !body.access_token || !body.refresh_token) { setMsg(body.error ?? `HTTP ${res.status}`); return; }
      await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
      location.replace('/');
    })();
  }, [t]);
  return <Card>{msg}</Card>;
}
