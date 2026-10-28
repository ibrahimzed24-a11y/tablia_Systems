// Operations console: live tasks, KPI cards, SOP publishing and CSV export (docs/sops/11-workflow-tasks.md).
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@mela-rossa/ui';
import { BRANCHES, supabase, todayCairo, type Branch, type Staff } from './lib/core';
import {
  HISTORY_DAYS, OPEN_STATUSES, SOP_CATEGORIES, TASK_PRIORITIES, computeKpis, exportBranchCsv, useWorkflowStore,
  type SopCategory, type SopStep, type TaskPriority, type TaskStatus, type WorkflowTask,
} from './core/useWorkflowStore';

const EN = {
  live: 'Live', connecting: 'Connecting…', offline: 'Offline', signed_out: 'Signed out', error: 'Connection error', idle: 'Paused',
  open: 'Open tasks', overdue: 'Overdue', awaiting: 'Awaiting verification', completion: 'Completion rate', onTime: 'On time',
  avgTime: 'Avg. time to complete', window: `last ${HISTORY_DAYS} days`, tasks: 'Tasks', newTask: 'New task', taskTitle: 'Title',
  details: 'Details', priority: 'Priority', status: 'Status', assignee: 'Assignee', due: 'Due', sop: 'SOP', none: 'None',
  unassigned: 'Unassigned', create: 'Create task', start: 'Start', submit: 'Submit for verification', verify: 'Verify', fail: 'Fail',
  failReason: 'Why did it fail?', reopen: 'Reopen', publishSop: 'Publish SOP', category: 'Category', both: 'Both branches',
  titleEn: 'Title (English)', titleAr: 'Title (Arabic)', steps: 'Steps', stepEn: 'Step in English', stepAr: 'Step in Arabic',
  addStep: 'Add step', remove: 'Remove', publish: 'Publish', published: 'Published.', exportCsv: 'Export CSV', from: 'From', to: 'To',
  branch: 'Branch', empty: 'No tasks in this branch yet.', sops: 'SOPs', showAll: 'Show closed tasks', min: 'min', h: 'h',
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  backlog: 'Backlog', assigned: 'Assigned', in_progress: 'In progress', pending_verification: 'Pending verification', completed: 'Completed', failed: 'Failed',
  opening_closing: 'Opening & closing', front_of_house: 'Front of house', kitchen: 'Kitchen', cafe: 'Cafe', emergency: 'Emergency',
  corniche: 'Corniche', new_damietta: 'New Damietta',
};
type Dict = typeof EN;
const AR: Dict = {
  live: 'مباشر', connecting: 'بيوصل…', offline: 'مفيش نت', signed_out: 'مش داخل', error: 'مشكلة في الاتصال', idle: 'متوقف',
  open: 'مهام مفتوحة', overdue: 'متأخرة', awaiting: 'مستنية مراجعة', completion: 'نسبة الإنجاز', onTime: 'في الميعاد',
  avgTime: 'متوسط وقت الإنجاز', window: `آخر ${HISTORY_DAYS} يوم`, tasks: 'المهام', newTask: 'مهمة جديدة', taskTitle: 'العنوان',
  details: 'التفاصيل', priority: 'الأولوية', status: 'الحالة', assignee: 'المسؤول', due: 'الميعاد', sop: 'الإجراء', none: 'ولا حاجة',
  unassigned: 'مش متسجلة لحد', create: 'اعمل المهمة', start: 'ابدأ', submit: 'ابعت للمراجعة', verify: 'تمام، اتراجعت', fail: 'مااتعملتش',
  failReason: 'ليه مااتعملتش؟', reopen: 'افتحها تاني', publishSop: 'انشر إجراء', category: 'التصنيف', both: 'الفرعين',
  titleEn: 'العنوان بالإنجليزي', titleAr: 'العنوان بالعربي', steps: 'الخطوات', stepEn: 'الخطوة بالإنجليزي', stepAr: 'الخطوة بالعربي',
  addStep: 'خطوة كمان', remove: 'شيل', publish: 'انشر', published: 'اتنشر.', exportCsv: 'نزّل CSV', from: 'من', to: 'لحد',
  branch: 'الفرع', empty: 'مفيش مهام في الفرع ده لسه.', sops: 'الإجراءات', showAll: 'اعرض المهام المقفولة', min: 'دقيقة', h: 'ساعة',
  low: 'قليلة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة',
  backlog: 'مستنية', assigned: 'متسجلة', in_progress: 'شغالين فيها', pending_verification: 'مستنية مراجعة', completed: 'خلصت', failed: 'مااتعملتش',
  opening_closing: 'الفتح والقفل', front_of_house: 'الصالة والاستقبال', kitchen: 'المطبخ', cafe: 'الكافيه', emergency: 'الطوارئ',
  corniche: 'الكورنيش', new_damietta: 'دمياط الجديدة',
};

const priorityTone = { low: 'neutral', medium: 'neutral', high: 'amber', critical: 'red' } as const;
const statusTone = { backlog: 'neutral', assigned: 'neutral', in_progress: 'amber', pending_verification: 'amber', completed: 'green', failed: 'red' } as const;
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export function OpsConsole({ lang, me }: { lang: 'en' | 'ar'; me: Staff }) {
  const t = lang === 'ar' ? AR : EN;
  const manager = me.role === 'admin' || me.role === 'manager';
  const bothBranches = me.role === 'admin' || me.branch === null;
  const [branch, setBranch] = useState<Branch>(me.branch ?? 'corniche');
  const { tasks, sops, live, error, since, watch, unwatch, createTask, updateTask, publishSop } = useWorkflowStore();
  const [people, setPeople] = useState<Staff[]>([]);
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [task, setTask] = useState<{ title: string; details: string; priority: TaskPriority; sop_id: string; assigned_to: string; due: string }>(
    { title: '', details: '', priority: 'medium', sop_id: '', assigned_to: '', due: '' });
  const [sop, setSop] = useState<{ category: SopCategory; branch: Branch | ''; title_en: string; title_ar: string; steps: SopStep[] }>(
    { category: 'opening_closing', branch: me.branch ?? '', title_en: '', title_ar: '', steps: [{ en: '', ar: '' }] });
  const [range, setRange] = useState({ from: daysAgo(HISTORY_DAYS), to: todayCairo() });

  useEffect(() => { void watch(branch); return () => { void unwatch(); }; }, [branch, watch, unwatch]);
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    if (!manager) return;
    void supabase.from('staff').select('id, display_name, role, branch, active').eq('active', true).order('display_name')
      .then(({ data }) => setPeople(((data ?? []) as Staff[]).filter((p) => p.branch === null || p.branch === branch)));
  }, [manager, branch]);

  const kpis = useMemo(() => computeKpis(tasks, since, now), [tasks, since, now]);
  const shown = showAll ? tasks : tasks.filter((x) => OPEN_STATUSES.includes(x.status));
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }), [lang]);
  const nameOf = (id: string | null) => (!id ? t.unassigned : people.find((p) => p.id === id)?.display_name ?? (id === me.id ? me.display_name : '…'));
  const sopTitle = (id: string | null) => { const s = sops.find((x) => x.id === id); return s ? `${s.code ? `${s.code} · ` : ''}${lang === 'ar' && s.title_ar ? s.title_ar : s.title_en}` : ''; };
  const minutes = (m: number | null) => (m === null ? '—' : m < 90 ? `${Math.round(m)} ${t.min}` : `${(m / 60).toFixed(1)} ${t.h}`);

  const run = async (f: () => Promise<void>, done = '') => {
    try { setMsg(''); await f(); setMsg(done); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const move = (x: WorkflowTask, status: TaskStatus) => {
    if (status === 'failed') {
      const reason = prompt(t.failReason); if (!reason?.trim()) return;
      void run(() => updateTask(x.id, { status, failure_reason: reason.trim() }));
    } else void run(() => updateTask(x.id, { status, ...(status === 'assigned' || status === 'backlog' ? { failure_reason: null } : {}) }));
  };
  const assign = (x: WorkflowTask, id: string) => void run(() => updateTask(x.id, {
    assigned_to: id || null, status: id ? (x.status === 'backlog' ? 'assigned' : x.status) : 'backlog' }));
  const submitTask = () => void run(async () => {
    await createTask({ title: task.title, details: task.details, priority: task.priority, sop_id: task.sop_id || null,
      assigned_to: task.assigned_to || null, due_at: task.due ? new Date(task.due).toISOString() : null });
    setTask({ title: '', details: '', priority: 'medium', sop_id: '', assigned_to: '', due: '' });
  });
  const submitSop = () => void run(async () => {
    await publishSop({ category: sop.category, branch: sop.branch || null, title_en: sop.title_en, title_ar: sop.title_ar, steps: sop.steps });
    setSop({ category: 'opening_closing', branch: me.branch ?? '', title_en: '', title_ar: '', steps: [{ en: '', ar: '' }] });
  }, t.published);
  const download = () => void run(async () => {
    const { blob, name } = await exportBranchCsv(branch, new Date(`${range.from}T00:00:00`).toISOString(), new Date(`${range.to}T23:59:59.999`).toISOString());
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const setStep = (i: number, k: 'en' | 'ar', v: string) => setSop({ ...sop, steps: sop.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  const actions = (x: WorkflowTask) => {
    const mine = x.assigned_to === me.id;
    return (
      <div className="flex flex-wrap gap-1">
        {(mine || manager) && x.status === 'assigned' && <Button variant="secondary" onClick={() => move(x, 'in_progress')}>{t.start}</Button>}
        {(mine || manager) && x.status === 'in_progress' && <Button variant="secondary" onClick={() => move(x, 'pending_verification')}>{t.submit}</Button>}
        {manager && x.status === 'pending_verification' && <Button variant="success" onClick={() => move(x, 'completed')}>{t.verify}</Button>}
        {manager && x.status !== 'completed' && x.status !== 'failed' && <Button variant="ghost" onClick={() => move(x, 'failed')}>{t.fail}</Button>}
        {manager && (x.status === 'completed' || x.status === 'failed') && <Button variant="ghost" onClick={() => move(x, x.assigned_to ? 'assigned' : 'backlog')}>{t.reopen}</Button>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {bothBranches
          ? <Select className="w-auto" value={branch} onChange={(e) => setBranch(e.target.value as Branch)}>{BRANCHES.map((b) => <option key={b} value={b}>{t[b]}</option>)}</Select>
          : <Badge>{t[branch]}</Badge>}
        <Badge tone={live === 'live' ? 'green' : live === 'connecting' ? 'amber' : 'red'}>{t[live]}</Badge>
        {error && <span className="text-xs text-white/60">{error}</span>}
        {msg && <span className="ms-auto text-sm text-white/80" role="status">{msg}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          [t.open, String(kpis.open), false], [t.overdue, String(kpis.overdue), kpis.overdue > 0], [t.awaiting, String(kpis.awaitingVerification), false],
          [t.completion, pct(kpis.completionRate), false], [t.onTime, pct(kpis.onTimeRate), false], [t.avgTime, minutes(kpis.avgMinutesToComplete), false],
        ].map(([label, value, alert], i) => (
          <Card key={i} className={alert ? 'border-brand-red' : undefined}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-white/60">{label}{i >= 3 ? ` · ${t.window}` : ''}</div>
          </Card>
        ))}
      </div>

      {manager && (
        <Card className="grid gap-3 sm:grid-cols-2">
          <h2 className="text-lg font-bold sm:col-span-2">{t.newTask}</h2>
          <Field label={t.taskTitle}><Input value={task.title} maxLength={160} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
          <Field label={t.priority}><Select value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value as TaskPriority })}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t[p]}</option>)}</Select></Field>
          <Field label={t.sop}><Select value={task.sop_id} onChange={(e) => setTask({ ...task, sop_id: e.target.value })}><option value="">{t.none}</option>{sops.map((s) => <option key={s.id} value={s.id}>{sopTitle(s.id)}</option>)}</Select></Field>
          <Field label={t.assignee}><Select value={task.assigned_to} onChange={(e) => setTask({ ...task, assigned_to: e.target.value })}><option value="">{t.unassigned}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select></Field>
          <Field label={t.due}><Input type="datetime-local" value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} /></Field>
          <Field label={t.details}><Textarea rows={2} maxLength={2000} value={task.details} onChange={(e) => setTask({ ...task, details: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button disabled={!task.title.trim()} onClick={submitTask}>{t.create}</Button></div>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="me-auto text-lg font-bold">{t.tasks}</h2>
          <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{t.showAll}</label>
          {manager && <>
            <Input className="w-auto" type="date" aria-label={t.from} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Input className="w-auto" type="date" aria-label={t.to} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <Button variant="secondary" onClick={download}>{t.exportCsv}</Button>
          </>}
        </div>
        {shown.length === 0 ? <p className="text-sm text-white/60">{t.empty}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-white/60">
                <tr>{[t.taskTitle, t.priority, t.status, t.assignee, t.due, ''].map((h, i) => <th key={i} className="p-2 text-start font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.id} className="border-t border-white/10 align-top">
                    <td className="p-2"><div className="font-semibold">{x.title}</div><div className="text-xs text-white/50">{sopTitle(x.sop_id)}</div>
                      {x.failure_reason && <div className="text-xs text-red-200">{x.failure_reason}</div>}</td>
                    <td className="p-2"><Badge tone={priorityTone[x.priority]}>{t[x.priority]}</Badge></td>
                    <td className="p-2"><Badge tone={statusTone[x.status]}>{t[x.status]}</Badge></td>
                    <td className="p-2">{manager && OPEN_STATUSES.includes(x.status)
                      ? <Select value={x.assigned_to ?? ''} onChange={(e) => assign(x, e.target.value)}><option value="">{t.unassigned}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select>
                      : nameOf(x.assigned_to)}</td>
                    <td className={`p-2 ${x.due_at && Date.parse(x.due_at) < now && OPEN_STATUSES.includes(x.status) ? 'text-red-300' : ''}`}>{x.due_at ? fmt.format(new Date(x.due_at)) : '—'}</td>
                    <td className="p-2">{actions(x)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {manager && (
        <Card className="grid gap-3 sm:grid-cols-2">
          <h2 className="text-lg font-bold sm:col-span-2">{t.publishSop}</h2>
          <Field label={t.category}><Select value={sop.category} onChange={(e) => setSop({ ...sop, category: e.target.value as SopCategory })}>{SOP_CATEGORIES.map((c) => <option key={c} value={c}>{t[c]}</option>)}</Select></Field>
          <Field label={t.branch}><Select value={sop.branch} onChange={(e) => setSop({ ...sop, branch: e.target.value as Branch | '' })}>
            {bothBranches && <option value="">{t.both}</option>}
            {BRANCHES.filter((b) => bothBranches || b === me.branch).map((b) => <option key={b} value={b}>{t[b]}</option>)}</Select></Field>
          <Field label={t.titleEn}><Input dir="ltr" maxLength={160} value={sop.title_en} onChange={(e) => setSop({ ...sop, title_en: e.target.value })} /></Field>
          <Field label={t.titleAr}><Input dir="rtl" maxLength={160} value={sop.title_ar} onChange={(e) => setSop({ ...sop, title_ar: e.target.value })} /></Field>
          <div className="space-y-2 sm:col-span-2">
            <div className="text-sm text-white/70">{t.steps}</div>
            {sop.steps.map((s, i) => (
              <div key={i} className="grid items-start gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
                <span className="pt-2 text-sm text-white/60">{i + 1}.</span>
                <Input dir="ltr" maxLength={500} placeholder={t.stepEn} value={s.en ?? ''} onChange={(e) => setStep(i, 'en', e.target.value)} />
                <Input dir="rtl" maxLength={500} placeholder={t.stepAr} value={s.ar ?? ''} onChange={(e) => setStep(i, 'ar', e.target.value)} />
                <Button variant="ghost" disabled={sop.steps.length === 1} onClick={() => setSop({ ...sop, steps: sop.steps.filter((_, j) => j !== i) })}>{t.remove}</Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" disabled={sop.steps.length >= 50} onClick={() => setSop({ ...sop, steps: [...sop.steps, { en: '', ar: '' }] })}>{t.addStep}</Button>
              <Button disabled={!sop.title_en.trim() || !sop.steps.some((s) => s.en?.trim() || s.ar?.trim())} onClick={submitSop}>{t.publish}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-bold">{t.sops}</h2>
        {sops.map((s) => (
          <details key={s.id} className="rounded-xl border border-white/10 p-2">
            <summary className="cursor-pointer text-sm"><span className="font-semibold">{sopTitle(s.id)}</span> <Badge>{t[s.category]}</Badge> <span className="text-xs text-white/50">v{s.version} · {s.branch ? t[s.branch] : t.both}</span></summary>
            <ol className="mt-2 list-decimal space-y-1 ps-6 text-sm text-white/80">
              {s.steps.map((st, i) => <li key={i}>{lang === 'ar' ? st.ar || st.en : st.en || st.ar}</li>)}
            </ol>
          </details>
        ))}
      </Card>
    </div>
  );
}
