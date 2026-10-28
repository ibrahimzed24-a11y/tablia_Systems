# SOP 11: Operations tasks and published SOPs

## Purpose
Give each branch a live list of the jobs that keep service running (opening and closing checks, kitchen and cafe prep, fixes),
who owns each one, and a manager's check that it was done. Tasks follow the SOPs, and managers can publish a new SOP from the app.

## Who does it
- **admin:** both branches. The only role that can delete a task or an SOP, and only when it was entered by mistake.
- **manager:** their branch (both branches when their staff record has no branch). Creates, assigns, verifies, fails and reopens tasks, publishes SOPs and exports the CSV.
- **front_desk, kitchen:** see their branch's tasks. Start and submit the tasks assigned to them.

## How a task moves
`backlog → assigned → in_progress → pending_verification → completed`, or `failed` with a reason.
A task created with an assignee starts as **Assigned**. Only a manager or an admin can verify, fail or reopen a task. The person a task
is assigned to can only press **Start** and **Submit for verification**; the database refuses any other change from them.

## Steps
### Create and assign (manager)
1. **Operations → New task**: title, priority, the SOP it follows, assignee, due time and details.
2. **Create task.** It appears on every device of that branch straight away.
### Do the task (assignee)
1. **Operations** → your task → **Start**.
2. Do it as the linked SOP says, then **Submit for verification**.
### Verify (manager)
1. Check the work in person. **Verify**, or **Fail** and type the reason.
2. A completed or failed task can be **Reopened**.
### Publish an SOP (manager)
1. **Operations → Publish SOP**: category, branch (or both branches), English and Arabic titles, and the steps in order, in English, Arabic or both.
2. **Publish.** It starts at version 1; a later change to its title, category, branch or steps raises the version.
3. When the SOP changes how staff work, add it to `docs/sops` in the same pull request too (README rule).
### Export (admin, manager)
1. **Operations → Tasks**: choose **From** and **To**, then **Export CSV**.
2. The file lists every task created in that period for the selected branch, with its times and outcome. It opens in Excel with the Arabic intact.

## KPI cards
All computed in the app from the branch's loaded tasks (open tasks of any age, plus everything created in the last 30 days):
- **Open tasks**, **Overdue** (open and past the due time), **Awaiting verification**.
- **Completion rate**: completed ÷ (completed + failed), for tasks closed in the last 30 days.
- **On time**: completed tasks with a due time that were finished by it.
- **Avg. time to complete**: from Start (or creation, if never started) to verification.
A card shows "—" until there is data. No figure is fixed in the code.

## How it is enforced (technical)
- Tables `branches`, `sops`, `workflow_tasks` and their enums are in `supabase/migrations/20261029000000_admin_operations.sql`. The SOPs in this folder are seeded into `sops` (codes SOP-01 to SOP-11).
- Role and branch come from `public.staff` through `app.ops_role()`, which also refuses a revoked device session (SOP 05). `user_metadata` is never read: any signed-in user can edit it.
- A trigger stamps the start, submit, completion and failure times and `verified_by`, and limits what an assignee may change.
- Realtime: `workflow_tasks` is in the `supabase_realtime` publication. The app (`apps/staff-pwa/src/core/useWorkflowStore.ts`) subscribes per branch with the signed-in session, so RLS applies to the events too, and reloads after every reconnect.
- Export: edge function `export-branch-analytics`. It verifies the caller's JWT with Supabase Auth, requires admin or manager, answers only origins listed in `ALLOWED_ORIGINS`, and queries as the caller, so RLS still applies. Every CSV value is quoted with inner quotes doubled, and text starting with `= + - @` gets a leading `'` so spreadsheets do not run it as a formula.
- Operations need a connection. They do not use the offline outbox (SOP 07).

## Checks
- At opening and at closing, every task due by then is submitted or verified (SOP 01).
- Nothing stays in **Pending verification** overnight.
- The badge in Operations shows **Live**.

## When it goes wrong
- **"permission denied" or "only_status_steps_allowed":** your role cannot make that change. Ask a manager.
- **"assignee_not_in_branch":** the person works at the other branch or is not active.
- **"failure_reason_required":** type the reason and try again.
- **The badge does not show Live for more than a minute while online:** refresh the page. Tasks still load; only live updates stop.
- **Export shows "origin_not_allowed":** the app's address is missing from `ALLOWED_ORIGINS` (SOP 08). **"admin_or_manager_only":** only those roles can export.

---

## بالمصري
- تبويب **التشغيل** فيه مهام فرعك، وبيتحدث لوحده.
- مهمة باسمك؟ دوس **ابدأ**، ولما تخلص دوس **ابعت للمراجعة**.
- المدير بيراجع بنفسه: **تمام، اتراجعت** أو **مااتعملتش** ويكتب السبب.
- المهام محتاجة نت، مش بتستنى أوفلاين.
- لو ظهرلك "permission denied" كلم المدير.
