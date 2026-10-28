# SOP 09: Backup and restore of Supabase

## Purpose
Be able to recover the menu, bookings, WhatsApp requests and staff after a mistake, a bad migration or a provider incident.

## Who does it
**admin** (technical). Restores always need two people: one does it and one checks.

## What is backed up
- **Supabase daily backups** (part of the paid plans; Point-in-Time Recovery is an add-on). Check the project's plan; the free plan has no downloadable backups.
- **Our own weekly logical dump**, kept outside Supabase, as follows.

## Steps: weekly dump (Monday morning)
1. On the admin computer, with the Supabase CLI logged in:
   `supabase db dump --linked -f backups/$(date +%F)-schema.sql`
   `supabase db dump --linked --data-only -f backups/$(date +%F)-data.sql`
2. Encrypt both files (for example `gpg -c` or a password-protected archive) and store them in the owner's private cloud drive.
   Never commit them; `backups/` is in `.gitignore`.
3. Keep 8 weekly and 12 monthly copies. Delete older ones; the dumps contain guest phone numbers.

## Steps: restore
- **One row or a few (for example a deleted menu item):** find the old values in `audit_log` (it keeps the before and after of every change) and re-insert them with the SQL editor.
- **A whole table:** restore the latest dump to a **new** temporary Supabase project or a local `supabase start`, export the table, and import it into production in a transaction.
- **The whole database:** Supabase dashboard → Database → Backups → Restore (or PITR to a time before the incident). The project is unavailable during the restore.
  Tell both branches to work offline and on paper first (SOP 07).

## Checks
- Every month, restore the latest dump into a local `supabase start` and check the counts: menu items about 215, bookings in the last 30 days, staff.
- After any restore: an admin and a manager each sign in, read today's bookings and toggle one item.

## When it goes wrong
- **The restore needs a backup older than any you have:** rebuild the menu from `supabase/migrations/*_seed_menu.sql`, and rebuild bookings for the coming days from WhatsApp chats and the phone log.
- **A dump file was lost or shared:** it contains guest data, so follow SOP 10.
