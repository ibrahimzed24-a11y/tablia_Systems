# Tablia Systems

Tablia Systems is a restaurant SaaS with three portals:

- **Admin** (`/admin`): the platform team. Every restaurant, its plan and payment state, suspend or reactivate, and
  activate, extend, comp or cancel plans. Needs an authenticator-app code.
- **Merchant** (`/owner`): restaurant owners sign up, create their restaurant, pick a plan and pay with Paymob, then run
  the menu, orders, reservations, events, guests and team. Staff the owner invites use the same console with fewer rights.
- **Customer** (`/t/<slug>` or `<slug>.<root domain>`): the public storefront, no account needed.

Who can do what: [docs/ROLES.md](docs/ROLES.md). Steps that need your accounts: [docs/NEEDS-YOUR-ACCESS.md](docs/NEEDS-YOUR-ACCESS.md).
First admin: [docs/ADMIN-BOOTSTRAP.md](docs/ADMIN-BOOTSTRAP.md). SOPs: [docs/sops](docs/sops/README.md).

## What is in the repo

| Path | What it is |
| --- | --- |
| apps/web | The web app (React, Vite, Tailwind, installable): portal chooser, `/owner`, `/admin` and the storefront |
| packages/ui | Shared UI components and the Tailwind preset |
| packages/ts-config | Shared TypeScript settings |
| supabase/migrations | Schema, row level security, plans and subscriptions, owner sign-up, platform admin, three portals, SaaS hardening |
| supabase/functions | Edge functions: `paymob-checkout`, `paymob-webhook` |
| supabase/templates | Sign-up and password reset emails (6-digit code and link) |
| supabase/tests | pgTAP tests (`supabase test db`) |
| docs | Roles, access checklist, admin bootstrap, SOPs |

## Requirements

- Node.js 20 or newer and npm 10 (the lockfile is committed: use `npm ci`)
- Supabase CLI and Docker for the local database and the tests
- Deno 2.x for the edge function tests

## Setup

```bash
npm ci
cp .env.example apps/web/.env.local     # keep only the VITE_ lines and fill them
supabase start                          # local Postgres, Auth and the edge runtime
supabase db reset                       # runs every migration
npm run dev                             # http://localhost:5173
```

## Environment variables (names only; values never go in the repo)

| Name | Where | Notes |
| --- | --- | --- |
| VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY | Vercel and apps/web/.env.local | Public by design; row level security protects the data |
| VITE_TENANT_ROOT_DOMAIN | same | Optional: serves restaurant pages at `<slug>.<root>` |
| VITE_POSTHOG_KEY, VITE_POSTHOG_HOST, VITE_LOGROCKET_APP_ID | same | Optional telemetry; empty = off |
| Paymob secrets (see `.env.example`) | Supabase function secrets | `supabase secrets set NAME=value` |
| SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | Injected by Supabase into functions | Never set them in the app |
| VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID | GitHub Actions secrets | Web deploy job |
| SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD | GitHub Actions secrets | Database and functions deploy job |

The service role key stays inside Supabase. It is never given a `VITE_` name, never put in Vercel and never committed.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Web app dev server |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint in every workspace |
| `npm run build` | Production build of the web app (apps/web/dist) |
| `npm run check` | lint, typecheck and build (what CI runs) |
| `supabase test db` | The pgTAP suites in supabase/tests |
| `deno test --allow-env --config supabase/functions/paymob-webhook/deno.json supabase/functions/paymob-webhook/` | Paymob webhook tests |

## Deploy

CI (`.github/workflows/deploy-pwa.yml`) runs on every push: lint, typecheck and build, plus non-blocking database and
function test jobs. Deploys are manual: Actions > **CI and deploy** > **Run workflow**, then pick `web` (Vercel),
`supabase` (`db push` and the Paymob functions) or `all`. Back up before any `db push`: migration
`20261029001000_three_portals.sql` deletes the old pilot data. Vercel builds `@tablia/web` from the root `vercel.json`
(output `apps/web/dist`).

Rollback and secrets: [SOP 08](docs/sops/08-deploy-rollback-secrets.md). Backups: [SOP 09](docs/sops/09-backup-restore.md).
