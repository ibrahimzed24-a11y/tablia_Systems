# SOP 09: Backup and restore

**Owner:** the platform admin.

## Before every migration

1. Supabase dashboard > Database > Backups: check today's backup exists (or PITR is on).
2. Take a dump outside the repo: `supabase db dump --linked -f backup-YYYYMMDD-schema.sql` and
   `supabase db dump --linked --data-only -f backup-YYYYMMDD-data.sql`.
3. Keep the files in private storage for at least 30 days. They hold guest names and phone numbers: never in the repo,
   never in chat.

## Restore

- **Whole project:** Supabase dashboard > Database > Backups > restore the backup (or a PITR time). The project is
  offline while it restores; tell restaurant owners first.
- **One table or a few rows:** restore the dump into a new local or branch database (`psql -f backup-...sql`), then
  copy the rows back with `insert ... select` in the SQL editor.
- After a restore, sign in as an owner and as an admin and place one storefront order to check.

## Retention

Daily backups as your Supabase plan allows. Delete your own dumps after 30 days unless an incident needs them.
