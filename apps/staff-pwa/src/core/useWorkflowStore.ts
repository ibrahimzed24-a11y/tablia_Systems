// Live operations state for one branch: workflow tasks and SOPs (docs/sops/11-workflow-tasks.md).
// Every read, write and realtime subscription uses the signed-in staff session, so row level security
// decides what each person sees. Nothing here holds a key: the anon key comes from the env (lib/core).
import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { anon, supabase, type Branch, type Role } from '../lib/core';

export type SopCategory = 'opening_closing' | 'front_of_house' | 'kitchen' | 'cafe' | 'emergency';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'backlog' | 'assigned' | 'in_progress' | 'pending_verification' | 'completed' | 'failed';
export const SOP_CATEGORIES: SopCategory[] = ['opening_closing', 'front_of_house', 'kitchen', 'cafe', 'emergency'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
export const OPEN_STATUSES: TaskStatus[] = ['backlog', 'assigned', 'in_progress', 'pending_verification'];

export type SopStep = { en?: string; ar?: string };
export type Sop = {
  id: string; code: string | null; category: SopCategory; branch: Branch | null; title_en: string; title_ar: string | null;
  roles: Role[]; steps: SopStep[]; version: number; published_at: string;
};
export type WorkflowTask = {
  id: string; branch: Branch; sop_id: string | null; title: string; details: string | null; priority: TaskPriority; status: TaskStatus;
  assigned_to: string | null; due_at: string | null; started_at: string | null; submitted_at: string | null; completed_at: string | null;
  failed_at: string | null; verified_by: string | null; failure_reason: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type NewTask = { title: string; details?: string; priority: TaskPriority; sop_id?: string | null; assigned_to?: string | null; due_at?: string | null };
export type TaskPatch = Partial<Pick<WorkflowTask, 'status' | 'assigned_to' | 'failure_reason' | 'priority' | 'due_at'>>;
export type NewSop = { category: SopCategory; branch: Branch | null; title_en: string; title_ar?: string; roles?: Role[]; steps: SopStep[] };
export type LiveState = 'idle' | 'connecting' | 'live' | 'offline' | 'signed_out' | 'error';

export const analyticsUrl = import.meta.env.VITE_ANALYTICS_FUNCTION_URL
  || `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/export-branch-analytics`;
export const HISTORY_DAYS = 30;

interface WorkflowState {
  branch: Branch | null; tasks: WorkflowTask[]; sops: Sop[]; live: LiveState; error: string | null; since: string | null;
  watch: (branch: Branch) => Promise<void>;
  unwatch: () => Promise<void>;
  refresh: () => Promise<void>;
  createTask: (input: NewTask) => Promise<void>;
  updateTask: (id: string, patch: TaskPatch) => Promise<void>;
  publishSop: (input: NewSop) => Promise<void>;
}

let channel: RealtimeChannel | null = null;
let generation = 0;

const byNewest = (a: WorkflowTask, b: WorkflowTask) => b.created_at.localeCompare(a.created_at);
function upsert(list: WorkflowTask[], row: WorkflowTask): WorkflowTask[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i < 0) return [row, ...list].sort(byNewest);
  const next = list.slice(); next[i] = row; return next;
}

// The real signed-in session; realtime gets the same JWT so RLS applies to the events it delivers.
async function requireSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('signed_out');
  supabase.realtime.setAuth(data.session.access_token);
  return data.session;
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  branch: null, tasks: [], sops: [], live: 'idle', error: null, since: null,

  watch: async (branch) => {
    if (get().branch === branch && channel) return;
    await get().unwatch();
    const gen = ++generation;
    set({ branch, tasks: [], sops: [], live: 'connecting', error: null });
    try { await requireSession(); } catch { if (gen === generation) set({ live: 'signed_out' }); return; }
    if (gen !== generation) return;
    channel = supabase
      .channel(`ops-tasks-${branch}`)
      .on<WorkflowTask>('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks', filter: `branch=eq.${branch}` }, (p) => {
        if (gen !== generation) return;
        if (p.eventType === 'DELETE') {
          const id = p.old.id;
          set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) }));
          return;
        }
        const row = p.new;
        set((s) => ({ tasks: row.branch === branch ? upsert(s.tasks, row) : s.tasks.filter((x) => x.id !== row.id) }));
      })
      .subscribe((status, err) => {
        if (gen !== generation) return;
        if (status === 'SUBSCRIBED') { set({ live: 'live', error: null }); void get().refresh(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') set({ live: navigator.onLine ? 'error' : 'offline', error: err?.message ?? status });
        else if (status === 'CLOSED') set({ live: 'idle' });
      });
    void get().refresh();
  },

  unwatch: async () => {
    generation++;
    const c = channel; channel = null;
    set({ branch: null, live: 'idle' });
    if (c) await supabase.removeChannel(c);
  },

  // Open tasks of any age plus everything created in the last HISTORY_DAYS (what the KPI cards cover).
  refresh: async () => {
    const branch = get().branch; if (!branch) return;
    const gen = generation;
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
    const [t, s] = await Promise.all([
      supabase.from('workflow_tasks').select('*').eq('branch', branch)
        .or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('sops').select('id, code, category, branch, title_en, title_ar, roles, steps, version, published_at')
        .or(`branch.is.null,branch.eq.${branch}`).order('code', { nullsFirst: false }).order('published_at', { ascending: false }),
    ]);
    if (gen !== generation) return;
    set((st) => ({
      tasks: t.error ? st.tasks : ((t.data ?? []) as WorkflowTask[]),
      sops: s.error ? st.sops : ((s.data ?? []) as Sop[]),
      since, error: t.error?.message ?? s.error?.message ?? null,
    }));
  },

  createTask: async (input) => {
    const branch = get().branch; if (!branch) throw new Error('no_branch');
    await requireSession();
    const { data, error } = await supabase.from('workflow_tasks').insert({
      branch, title: input.title.trim(), details: input.details?.trim() || null, priority: input.priority,
      sop_id: input.sop_id || null, assigned_to: input.assigned_to || null, due_at: input.due_at || null,
      status: input.assigned_to ? 'assigned' : 'backlog',
    }).select('*').single();
    if (error) throw new Error(error.message);
    set((s) => ({ tasks: upsert(s.tasks, data as WorkflowTask) }));
  },

  updateTask: async (id, patch) => {
    await requireSession();
    const { data, error } = await supabase.from('workflow_tasks').update(patch).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    set((s) => ({ tasks: upsert(s.tasks, data as WorkflowTask) }));
  },

  publishSop: async (input) => {
    const steps = input.steps
      .map((x) => ({ en: x.en?.trim() || undefined, ar: x.ar?.trim() || undefined }))
      .filter((x) => x.en || x.ar);
    if (!input.title_en.trim() || !steps.length) throw new Error('title_and_steps_required');
    await requireSession();
    const { data, error } = await supabase.from('sops').insert({
      category: input.category, branch: input.branch, title_en: input.title_en.trim(),
      title_ar: input.title_ar?.trim() || null, roles: input.roles ?? [], steps,
    }).select('id, code, category, branch, title_en, title_ar, roles, steps, version, published_at').single();
    if (error) throw new Error(error.message);
    set((s) => ({ sops: [...s.sops, data as Sop] }));
  },
}));

// ---- KPI cards: computed only from the loaded tasks, never fixed numbers ----
export interface Kpis {
  open: number; overdue: number; awaitingVerification: number; closed: number;
  completionRate: number | null; onTimeRate: number | null; avgMinutesToComplete: number | null;
}
const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

export function computeKpis(tasks: WorkflowTask[], since: string | null, now = Date.now()): Kpis {
  const from = since ? Date.parse(since) : 0;
  const open = tasks.filter((x) => OPEN_STATUSES.includes(x.status));
  const closed = tasks.filter((x) => (x.status === 'completed' || x.status === 'failed') && ms(x.completed_at ?? x.failed_at) >= from);
  const done = closed.filter((x) => x.status === 'completed');
  const withDue = done.filter((x) => x.due_at);
  const minutes = done.map((x) => (ms(x.completed_at) - ms(x.started_at ?? x.created_at)) / 60000).filter((n) => Number.isFinite(n) && n >= 0);
  return {
    open: open.length,
    overdue: open.filter((x) => ms(x.due_at) < now).length,
    awaitingVerification: open.filter((x) => x.status === 'pending_verification').length,
    closed: closed.length,
    completionRate: closed.length ? done.length / closed.length : null,
    onTimeRate: withDue.length ? withDue.filter((x) => ms(x.completed_at) <= ms(x.due_at)).length / withDue.length : null,
    avgMinutesToComplete: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
  };
}

// CSV from the export-branch-analytics edge function, as the signed-in user.
export async function exportBranchCsv(branch: Branch, from: string, to: string): Promise<{ blob: Blob; name: string }> {
  const session = await requireSession();
  const res = await fetch(analyticsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify({ branch, from, to }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `tablia-${branch}-tasks.csv`;
  return { blob: await res.blob(), name };
}
