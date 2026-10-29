# SOP 08: Deploy, rollback and secrets

**Owner:** the platform admin. **When:** every release, and whenever a secret may have leaked.

## Deploy

1. Merge to `main`. CI runs lint, typecheck, build, the database tests and the function tests. Nothing deploys on push.
2. If the release has a new migration, take a backup first ([SOP 09](09-backup-restore.md)) and read the migration:
   anything that drops or deletes needs your sign-off.
3. GitHub > Actions > **CI and deploy** > **Run workflow** on `main`, and pick:
   - `web`: builds `apps/web` and deploys it to Vercel production;
   - `supabase`: `supabase db push`, then deploys `paymob-checkout` and `paymob-webhook`;
   - `all`: both, database first.
4. Run the manual test script in [NEEDS-YOUR-ACCESS.md](../NEEDS-YOUR-ACCESS.md) (at least sign-in, `/admin` with
   the authenticator code, one storefront order).

## Rollback

- **Web app:** Vercel > Deployments > the last good deployment > **Promote to Production** (instant).
- **Edge functions:** check out the last good commit and run `supabase functions deploy <name>`.
- **Database:** migrations are not rolled back automatically. Write a new migration that undoes the change and push it.
  For data loss, restore from backup ([SOP 09](09-backup-restore.md)).

## Secrets

| Secret | Lives in | Never in |
| --- | --- | --- |
| Supabase anon key and URL (`VITE_` names) | Vercel, GitHub Actions | it is public by design; protected by RLS |
| Supabase service role key | Supabase only (injected into functions) | Vercel, the app, the repo, GitHub |
| Paymob API key, HMAC secret, integration and iframe ids | Supabase function secrets | Vercel, the app, the repo |
| `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | GitHub Actions secrets | the repo |

CI refuses commits that look like a JWT, a live key or a service role value.

**Rotate** when a secret may have leaked or a person with access leaves: create the new value in the provider
(Supabase, Paymob, Vercel), set it where it lives, redeploy the affected part, then revoke the old one. Note the date
and reason in the incident log ([SOP 10](10-incident-privacy.md)).
