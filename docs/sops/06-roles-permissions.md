# SOP 06: Staff roles and permissions

## Purpose
Define who can do what, and make sure the **database** enforces it with Postgres row level security (RLS), not just the screens.
Hiding a button is not security; RLS is.

## Who does it
**admin** assigns roles and reviews this matrix every quarter.

## The matrix
| Area | admin | manager | front_desk | kitchen |
| --- | --- | --- | --- | --- |
| Menu: read | yes | yes | yes | yes |
| Menu: add, edit, price, reorder | yes | yes | no | no |
| Menu: sold out / available | yes | yes | no | yes (function `set_item_availability`) |
| Menu: delete item | yes | no | no | no |
| Bookings: read with guest details | all branches | own branch* | own branch* | no |
| Bookings: today's covers count | yes | yes | yes | yes (function `covers_today`) |
| Bookings: create, edit, status | yes | own branch* | own branch* | no |
| Bookings: delete | yes | no | no | no |
| WhatsApp inbox: read, log, reply | yes | own branch* | own branch* | no |
| Staff: read list | yes | yes | own row | own row |
| Staff: change role, deactivate | yes | no | no | no |
| QR codes: issue | any role | front_desk and kitchen, own branch | no | no |
| Devices: revoke | yes | own branch staff | no | no |
| Audit log: read | yes | no | no | no |

\* "Own branch" is the `branch` on the staff row. A staff row with no branch (null) covers both branches; only admins and area managers should have that.

## How it is enforced
- The table `staff` links `auth.users.id` to a role, a branch and an `active` flag.
- The SQL helpers `app.current_staff_role()` and `app.current_staff_branch()` (security definer) return nothing when the staff member is inactive or the
  current session belongs to a revoked device. Every RLS policy is built on them, so a revoked device loses access on its next request.
- Kitchen's sold-out right is a security definer function that changes **only** `is_available` and `sold_out_until`.
- Every change to menu items, bookings and staff is written to `audit_log` by triggers.
- The edge function uses the service role key **only** inside Supabase. The key is never in the app or the repo.

## Steps: change someone's role
1. Admin → Staff → the person → **Role** → choose → Save.
2. The change applies to the person's next request. Ask them to pull to refresh.
3. Write the reason in the shift log.

## Checks
- Every quarter: list the admins (there should be at most 2) and the inactive accounts with devices still active.
- After any migration that touches policies, run `supabase/tests/rls.sql` (see the README) to check that kitchen cannot read guest phones.

## When it goes wrong
- **Someone can see more than they should:** set them inactive (blocks immediately), then fix the policy in a new migration and follow SOP 10 if guest data was exposed.
- **The only admin is locked out:** a project owner runs `update staff set role='admin', active=true where id='<uuid>'` from the Supabase SQL editor. Log it.

## Operations engine permissions (SOP 11)

| Action | admin | manager | front_desk | kitchen |
| --- | --- | --- | --- | --- |
| See tasks and SOPs of their branch | yes | yes | yes | yes |
| Create, assign, verify, fail, reopen tasks | both branches | own branch | no | no |
| Start and submit a task assigned to them | yes | yes | yes | yes |
| Publish an SOP | both branches | own branch (both if their staff row has no branch) | no | no |
| Export the tasks CSV | yes | own branch | no | no |
| Delete a task or an SOP | yes | no | no | no |

Enforced by RLS and the task trigger in `20261029000000_admin_operations.sql`. Role and branch are read from `public.staff`
(the same rule as above), never from `user_metadata`, which any signed-in user can change.
