# SOP 08: Deployment, rollback and secrets rotation

## Purpose
Ship the staff app safely, undo a bad release in minutes, and rotate secrets without downtime. **No real key, token or password is ever
written to a file in this repository.** Only variable names are, in `.env.example`.

## Who does it
**admin** (technical). A manager may trigger a rollback in Vercel when an admin tells them to.

## Environments and secrets
| Name | Where it lives | Used by |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel env, local `.env.local` | staff app (public) |
| `VITE_SUPABASE_ANON_KEY` | Vercel env, local `.env.local` | staff app (public, protected by RLS) |
| `VITE_PROVISION_FUNCTION_URL` | Vercel env | staff app |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | Vercel env (optional) | telemetry |
| `VITE_LOGROCKET_APP_ID` | Vercel env (optional) | telemetry |
| `PROVISION_JWT_SECRET` | Supabase function secrets | edge function |
| `ALLOWED_ORIGINS` | Supabase function secrets | edge function CORS |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | provided by Supabase to functions automatically | edge function |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | GitHub Actions secrets | deploy workflow |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | GitHub Actions secrets (optional) | migrations and function deploy job |

## Steps: deploy
1. Open a pull request. CI (`.github/workflows/deploy-pwa.yml`) runs install, **lint**, **typecheck** and **build**. All must pass.
2. Pull requests get a **Vercel preview** deploy. Test the changed screens on a phone.
3. Database changes go in a new file in `supabase/migrations/`. Never edit an applied migration.
4. Merge to `main`. The workflow deploys production to Vercel with `vercel deploy --prebuilt --prod`, and (if the Supabase secrets are set) runs
   `supabase db push` and `supabase functions deploy verify-provision-qr`.
5. Update the matching SOP in the same pull request if staff behaviour changed.

## Steps: rollback
1. **App:** Vercel → project → Deployments → the last good deployment → **Promote to Production** (or `vercel rollback`). This takes about a minute.
   Staff close and reopen the app to pick it up.
2. **Database:** migrations are not rolled back automatically. Write a new migration that reverses the change. For data loss, see SOP 09.
3. **Edge function:** redeploy it from the last good commit: `git checkout <sha> -- supabase/functions && supabase functions deploy verify-provision-qr`.

## Steps: rotate secrets
| Secret | How often | How |
| --- | --- | --- |
| `PROVISION_JWT_SECRET` | every 90 days, or when leaked | `supabase secrets set PROVISION_JWT_SECRET=<new 32+ random bytes>`. Unused QR codes stop working; nothing else is affected. |
| Supabase anon key / JWT secret | when leaked | Supabase dashboard → API → rotate. Update `VITE_SUPABASE_ANON_KEY` in Vercel, redeploy. All staff need new QR codes. |
| Service role key | when leaked | Rotate with the JWT secret above. Functions pick it up automatically. |
| `VERCEL_TOKEN` | every 180 days | Vercel → Account → Tokens → create a new one, update the GitHub secret, delete the old one. |
| `SUPABASE_ACCESS_TOKEN` | every 180 days | Supabase → Account → Access tokens, same as above. |
| PostHog / LogRocket | when leaked | Rotate in the vendor dashboard, update Vercel env, redeploy. |

Generate random secrets with a password manager or `openssl rand -base64 48`. Never paste them into chat, issues or commits.

## Checks
- After a deploy: open the production app, check the version in Settings → About, and do one sold-out toggle on a test item and back.
- `git grep -nE "(eyJ|sk_|service_role.*=)"` finds nothing (CI does a basic check too).

## When it goes wrong
- **CI fails on main:** do not deploy by hand. Fix forward or revert the commit.
- **A secret was committed:** rotate it **first**, then remove it from the history. Rotation is what makes it safe; deleting the file is not. Follow SOP 10.

## Operations engine (2026-10-29)
- Edge functions: `verify-provision-qr` and `export-branch-analytics`. The workflow deploys both on a push to `main`.
- `20261029000000_admin_operations.sql` sorts before the first two migrations but runs in either order, and the workflow now uses
  `supabase db push --include-all`, so a database that already has the later migrations still receives it.
  `20261029000100_schema.sql` gained only `if not exists` guards (types, branches) in the same change, so it can follow it on a new database.
- `export-branch-analytics` needs no new secret: it uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` (injected by Supabase), the caller's JWT,
  and `ALLOWED_ORIGINS` for CORS. Every origin the app is opened from must be in `ALLOWED_ORIGINS`.
- App, optional: `VITE_ANALYTICS_FUNCTION_URL` (defaults to `$VITE_SUPABASE_URL/functions/v1/export-branch-analytics`).
