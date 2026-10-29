# What needs your access

The code is in the repo; these steps need your accounts, keys or decisions. None of them were done from the repo.
Values (keys, passwords, tokens) go in the dashboards named below, never in the repo.

## 0. Back up first

Migration `20261029001000_three_portals.sql` permanently deletes the old pilot data: bookings, WhatsApp requests
and replies, SOPs and tasks, staff devices and QR tokens, hourly branch metrics. Before any `db push`:

1. Supabase dashboard > Database > Backups: confirm a recent daily backup exists, or turn on Point in Time Recovery.
2. Also take your own copy: `supabase db dump --linked -f backup-schema.sql` and
   `supabase db dump --linked --data-only -f backup-data.sql`, kept outside the repo.
3. Export anything you still need from those tables as CSV (Table editor > Export).

## 1. Supabase

1. Apply the migrations, after the backup: `supabase link --project-ref <ref>` then `supabase db push`,
   or GitHub Actions > CI and deploy > Run workflow > deploy `supabase`.
2. Create your first platform admin: [ADMIN-BOOTSTRAP.md](ADMIN-BOOTSTRAP.md).
3. Authentication > URL Configuration: Site URL `https://app.tablia.nilesupplies.com`; Redirect URLs
   `https://app.tablia.nilesupplies.com/owner` and `https://app.tablia.nilesupplies.com/admin`
   (plus `http://localhost:5173/**` for development).
4. Authentication > Providers > Email: **Confirm email** on. Email OTP length 6.
5. Authentication > Email Templates: paste `supabase/templates/confirmation.html` into **Confirm signup** and
   `supabase/templates/recovery.html` into **Reset password** (subjects are in `supabase/config.toml`).
6. Authentication > Multi-Factor: **TOTP** (authenticator app) enabled. `/admin` does not work without it.
7. Authentication > SMTP Settings: a real SMTP provider (for example Resend) sending from your own domain, for example
   `no-reply@tablia.nilesupplies.com`. Supabase's built-in sender is rate limited and not for production.
8. Authentication > Attack Protection: turn on captcha (Cloudflare Turnstile or hCaptcha) for sign-up and sign-in.
   The app does not send a captcha token yet, so add the widget before switching this on (see "Not built yet").
9. Database > Backups: daily backups on (Pro plan) and, if you can, Point in Time Recovery.
10. Edge Functions: delete `verify-provision-qr`, `export-branch-analytics` and `provision-domain`, and their secrets
    `PROVISION_JWT_SECRET`, `ALLOWED_ORIGINS`, `STAFF_EMAIL_DOMAIN`, `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`,
    `VERCEL_TEAM_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`. Deploy `paymob-checkout` and
    `paymob-webhook` (the deploy workflow does it when you pick `supabase`).

## 2. Paymob

1. A Paymob merchant account for Egypt with card payments enabled.
2. Supabase > Edge Functions > Secrets: set `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_INTEGRATION_ID`,
   `PAYMOB_HMAC_SECRET` and `PAYMOB_REDIRECT_URL` (listed in `.env.example`). Never in Vercel and never with a `VITE_` name.
3. Paymob dashboard: the transaction processed callback URL is
   `https://<project-ref>.supabase.co/functions/v1/paymob-webhook`.
4. One real test payment per plan (Starter, Growth, Enterprise), then check in `/admin` that the plan shows as paid.
   Until then, admins can activate, extend, comp or cancel plans by hand in `/admin`.

## 3. Vercel and DNS

1. Project settings: the root `vercel.json` builds `@tablia/web` and serves `apps/web/dist`. If the project's
   Root Directory or Output Directory were set to `apps/staff-pwa` in the dashboard, clear them.
2. Environment variables (Production and Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally
   `VITE_TENANT_ROOT_DOMAIN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_LOGROCKET_APP_ID`. Remove
   `VITE_PROVISION_FUNCTION_URL` and `VITE_ANALYTICS_FUNCTION_URL`.
3. Domains: `app.tablia.nilesupplies.com` (CNAME to `cname.vercel-dns.com` at your DNS host).
4. Restaurant pages at `<slug>.<root domain>` need a wildcard domain in Vercel (for example
   `*.tablia.nilesupplies.com`, which needs Vercel nameservers for that zone) and `VITE_TENANT_ROOT_DOMAIN` set to the
   root. Without it, restaurant pages work at `/t/<slug>`.

## 4. GitHub

1. Settings > Secrets and variables > Actions: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (build),
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (web deploy), `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` (database and functions deploy).
2. Deploys are manual: Actions > CI and deploy > Run workflow > choose `web`, `supabase` or `all`. A push only runs
   CI and the tests. If Vercel's own Git integration is connected, it still builds every push; turn it off under
   Vercel > Settings > Git if you want deploys to come only from the workflow.
3. Settings > Branches: protect `main` (require the `ci` check, no force pushes).
4. After the first green run of `db-tests` and `function-tests`, remove their `continue-on-error: true` so they block.

## 5. Your decisions and content

- Terms of service and privacy policy pages (who you are, what data you keep, how long, how to ask for deletion).
- Egypt's Personal Data Protection Law (Law 151 of 2020): registration or licence with the Personal Data Protection
  Centre for processing customer data.
- Sender domain and support email shown in emails and in the suspended notice.
- Plan prices and what each plan includes, if they change.

## 6. Test by hand after deploy

1. `/owner` > Create owner account: the email has a 6-digit code and a link; both confirm the account.
2. Create a restaurant and pick a plan; checkout opens Paymob (or the "not switched on yet" notice).
3. Sign out, "Forgot your password?", open the link: the "choose a new password" screen appears; sign in with it.
4. `/admin` with the admin account: QR enrolment the first time, then a code on every sign-in. Without the code
   no admin data loads.
5. In `/admin`: comp the test restaurant's plan for 30 days, then extend it, then cancel it; the owner console follows.
6. Suspend the test restaurant: its owner and staff console shows the locked notice and its public page is gone.
   Reactivate it.
7. Try to create a restaurant at `/owner` with the admin account: refused.
8. Owner adds a staff email under Team; that person signs up at `/owner` with it and sees the staff tabs only.
9. Open the restaurant's public page, place an order and a reservation without an account; both appear in the console.

## Not built yet

- Automatic monthly renewal and reminder emails
- Invoices
- Custom domains for restaurants
- Per-restaurant branding
- Order notifications
- A tool to delete one guest's data on request
- Captcha on the public order endpoint and on sign-up
- Error monitoring

## Open security note

The Paymob webhook takes the restaurant id from a field Paymob does not sign. The HMAC proves the payment is real,
but not which restaurant it was meant for. Fix: store the Paymob order id when `paymob-checkout` creates it and look the
restaurant up from that id in the webhook.
