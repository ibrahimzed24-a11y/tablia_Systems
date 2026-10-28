# Mela Rossa admin

Staff app for Mela Rossa Restaurant & Cafe (Nile Corniche and New Damietta): menu editing, table bookings,
WhatsApp requests, staff roles and the operations tasks. The SOPs in [docs/sops](docs/sops/README.md) come first; the code follows them.

## What is in the repo

| Path | What it is |
| --- | --- |
| apps/staff-pwa | The staff app (React, Vite, Tailwind, installable PWA, works offline with a sync queue) |
| packages/ui | Shared UI components and the Tailwind preset |
| packages/ts-config | Shared TypeScript settings |
| supabase/migrations | Schema, row level security, SOP seed, menu seed (from the website), custom domains, hourly branch metrics |
| supabase/functions | Edge functions: verify-provision-qr, export-branch-analytics, provision-domain |
| supabase/tests/rls.sql | Row level security tests per role and branch (SOP 06) |
| docs/sops | The 11 SOPs |

## Requirements

- Node.js 20 or newer and npm 10 (the lockfile is committed: use `npm ci`)
- Supabase CLI and Docker for the local database and the tests
- Deno 1.4x or 2.x, only to type check the edge functions

## Setup

```bash
npm ci
cp .env.example apps/staff-pwa/.env.local      # keep only the VITE_ lines and fill them
supabase start                                  # local Postgres, Auth and the edge runtime
supabase db reset                               # runs every migration, including the menu seed
npm run dev                                     # http://localhost:5173
```

## Environment variables (names only; values never go in the repo)

| Name | Where | Notes |
| --- | --- | --- |
| VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY | Vercel project and apps/staff-pwa/.env.local | Public by design; row level security protects the data |
| VITE_PROVISION_FUNCTION_URL, VITE_ANALYTICS_FUNCTION_URL | same | Optional; default to the Supabase functions URL |
| VITE_POSTHOG_KEY, VITE_POSTHOG_HOST, VITE_LOGROCKET_APP_ID | same | Optional telemetry; empty = off |
| PROVISION_JWT_SECRET, ALLOWED_ORIGINS, STAFF_EMAIL_DOMAIN | Supabase function secrets | `supabase secrets set NAME=value` |
| VERCEL_API_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID | Supabase function secrets | provision-domain only |
| CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID | Supabase function secrets | Optional; without them add the CNAME by hand |
| SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | Injected by Supabase into functions | Never set them in the app |
| VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID | GitHub Actions secrets | Deploy job |
| SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD | GitHub Actions secrets | Migration and function deploy job |

The service role key stays inside Supabase. It is never given a `VITE_` or `NEXT_PUBLIC_` name, never put in Vercel and never committed.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Staff app dev server |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint in every workspace |
| `npm run build` | Production build of the staff app (apps/staff-pwa/dist) |
| `npm run check` | lint, typecheck and build (what CI runs) |
| `supabase test db` | Runs supabase/tests/rls.sql against the local database (pgTAP) |
| `deno check supabase/functions/*/index.ts` | Type checks the edge functions |

## Database

- **Menu seed** (`20261029000300_menu_seed.sql`): 241 dishes and drinks with EGP prices from the public website's Arabic menu.
  An item with no price on the site is stored with an empty price, which the app shows as "ask for price". The seed never overwrites edits.
- **Hourly metrics** (`20261029000400_domains_and_branch_metrics.sql`): `app.snapshot_branch_metrics()` writes one row per branch per hour into
  `branch_metrics_hourly` (bookings, covers, cancellations, no-shows, WhatsApp requests and replies, tasks, sold-out items).
  pg_cron runs it at 5 past every hour. Managers read their own branch, admins both. Backfill an hour with
  `select app.snapshot_branch_metrics('2026-10-29 13:00+02');`
- **Custom domains**: `custom_domains` is read by admins and written only by the provision-domain function.

## Custom domains (provision-domain)

POST to `/functions/v1/provision-domain` with an admin's session token and `{"action": "add" | "verify" | "remove", "hostname": "staff.example.com", "branch": null}`.
**add** attaches the domain to the Vercel project and, when the Cloudflare secrets are set, creates a DNS-only CNAME to `cname.vercel-dns.com`;
Vercel then issues and renews the certificate. **verify** asks Vercel to check DNS again. **remove** detaches it and deletes the record.

## Deploy

1. **Supabase**: `supabase link --project-ref <ref>`, `supabase db push`, then `supabase functions deploy verify-provision-qr export-branch-analytics provision-domain`.
2. **Vercel**: import this repo; the root `vercel.json` builds the staff app (`npx turbo run build --filter=staff-pwa`, output `apps/staff-pwa/dist`).
3. **CI** (`.github/workflows/deploy-pwa.yml`): every push runs lint, typecheck and build; pushes to main deploy to Vercel and Supabase when the secrets above are set, and skip otherwise.

Rollback and secret rotation: [SOP 08](docs/sops/08-deploy-rollback-secrets.md). Backups: [SOP 09](docs/sops/09-backup-restore.md).
