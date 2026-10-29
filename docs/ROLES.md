# Tablia Systems roles and portals

Tablia Systems has three portals. Each one has its own roles, and the database enforces every rule below with row level security and `security definer` functions. Hiding something in the interface is never the only guard.

| Portal | Where | Who | How they get in |
| --- | --- | --- | --- |
| Admin | `/admin` | Platform admin (a row in `platform_admins`) | Email and password, then a 6-digit authenticator-app code (TOTP) on every sign-in. The database refuses all admin data to a session without the code (`aal2`). Admins are added only from the Supabase dashboard ([ADMIN-BOOTSTRAP.md](ADMIN-BOOTSTRAP.md)); no role, sign-up or metadata grants it. |
| Merchant | `/owner` | Owner (`user_profiles.role = tenant_admin`) and staff (`user_profiles.role = manager`) of one restaurant | Owner: creates an account (confirmed with the 6-digit code or the link in the email), then creates the restaurant and picks a plan. Staff: the owner adds the email under Team, and the person signs up (or signs in) at `/owner` with that email. |
| Customer | `/t/<slug>` or `<slug>.<root domain>` | Anyone, no account | The public storefront: menu, ordering, table reservations and events. |

`/` is a portal chooser that links to the Merchant and Admin portals.

## Sign-in and accounts

- Confirmation and password reset links create a session from the URL (`detectSessionInUrl`).
- "Forgot your password?" is on the `/owner` and `/admin` sign-in screens; the emailed link opens a "choose a new password" screen (on `/admin`, after the authenticator code).
- Sign-up needs email confirmation; the email carries both the 6-digit code and the link (`supabase/templates`).
- A platform admin account cannot create or own a restaurant (`create_my_organization` refuses it).

## Role matrix

| Capability | Platform admin | Owner | Staff | Customer |
| --- | --- | --- | --- | --- |
| See every restaurant, plan, payment state and platform stats | yes, with the authenticator code (`admin_list_restaurants`, `admin_platform_stats`) | no | no | no |
| Suspend or reactivate a restaurant | yes (`admin_set_restaurant_active`) | no | no | no |
| Activate, extend, comp or cancel a restaurant's plan | yes (`admin_set_subscription`) | no | no | no |
| Open `/admin` | yes | refused (`am_i_super_admin` = false) | refused | refused |
| Create their restaurant (once) | no (refused) | yes (`create_my_organization`) | no | no |
| Choose a plan and pay | no | yes (`choose_my_plan`, `paymob-checkout`) | no: sees "ask the owner" | no |
| Edit restaurant profile | no | yes (`update_my_restaurant`) | no | no |
| Add or remove staff (seats by plan) | no | yes (`owner_invite_staff`, `owner_remove_staff`, `owner_list_team`) | no | no |
| Add, edit and delete menu sections, items and prices | no | yes (`tenant_sections_owner`, `tenant_items_owner`) | no | no |
| Mark a menu item sold out or available | no | yes | yes (`tenant_items_staff_availability` and the `menu_items_staff_guard` trigger) | no |
| Create and publish events | no | yes (`tenant_events_owner`) | read only | sees published events |
| See and update orders (status, cash paid) | no | yes | yes | no |
| See and update reservations | no | yes | yes | no |
| See guest profiles (CRM) | no | yes | yes | no |
| Read the public menu and restaurant page | yes | yes | yes | yes (`get_public_storefront`) |
| Place an order | yes | yes | yes | yes (`place_order`) |
| Reserve a table | yes | yes | yes | yes (`create_reservation`) |

Plan limits apply on top of roles: menu items, guest profiles, staff seats (Starter 0, Growth 3, Enterprise 10), custom domains and modules (`plan_limits`, `has_feature`).

**Suspension:** a suspended restaurant's storefront, orders and reservations are closed, and its owner and staff console is locked: `get_auth_organization()` returns nothing for it, so every merchant policy and owner function returns no rows, and `update_my_restaurant` and `choose_my_plan` refuse. The console shows only the suspended notice until an admin reactivates it.

## Tables by portal

| Table | Portal | Access |
| --- | --- | --- |
| `platform_admins` | Admin | No policies; only `security definer` functions read it. |
| `organizations` | Merchant (own row), Admin (via functions), Customer (via `get_public_storefront`) | Owners edit only through `update_my_restaurant`. |
| `subscriptions`, `plan_limits`, `paymob_transactions` | Merchant (read own), Admin | Payments are written only by the Paymob webhook; manual plan changes only by `admin_set_subscription`. |
| `user_profiles`, `staff_invites` | Merchant | Read own team; writes only through the owner functions and the sign-up trigger. |
| `menu_sections`, `menu_items` | Merchant, Customer (read) | Owner writes; staff only availability. |
| `restaurant_events` | Merchant, Customer (published, read) | Owner writes. |
| `orders`, `reservations`, `crm_customers` | Merchant, Customer (insert via functions) | Restaurant members read and update their own. |
| `custom_domains` | Merchant (read own) | Plan-limited. |
| `audit_log` | Admin | No client access; written by triggers and admin functions. |
| `branches` | Legacy menu branch data | No client access. |

## Edge functions

- `paymob-checkout` (Merchant, owner): starts payment for the chosen plan.
- `paymob-webhook` (server): verifies Paymob's HMAC and records the payment with `apply_paymob_payment`.

## Removed

The original single-restaurant staff app (QR device sign-in, branch bookings, WhatsApp desk, SOP and task console, branch metrics, offline sync queue) was removed in `20261029001000_three_portals.sql` and from `apps/web`. Its tables, functions, scheduled jobs and the `verify-provision-qr`, `export-branch-analytics` and `provision-domain` edge functions are gone.
