# Mela Rossa: Standard Operating Procedures

These SOPs are the source of truth for the **Mela Rossa staff app** (`apps/staff-pwa`) and for how the
Corniche and New Damietta branches run it. They were written **before** the code. Every change to the app that changes
how staff work must update the matching SOP in the same pull request.

Restaurant & Cafe, Damietta, Egypt. Two branches:

| Code | Branch | Notes |
| --- | --- | --- |
| `corniche` | Nile Corniche, Damietta | Serves the breakfast menu |
| `new_damietta` | New Damietta | No breakfast menu |

Opening hours (from the public website): every day 10:00 AM to 11:00 PM. Guest WhatsApp and phone: **01280060772** (`wa.me/201280060772`).

## Index

| # | SOP | Roles | Arabic summary |
| --- | --- | --- | --- |
| 01 | [Opening and closing checklist](01-opening-closing.md) | manager, front_desk, kitchen | yes |
| 02 | [Editing the menu](02-menu-editing.md) | admin, manager, kitchen (sold out only) | yes |
| 03 | [Handling a table booking](03-table-bookings.md) | front_desk, manager | yes |
| 04 | [WhatsApp booking requests](04-whatsapp-requests.md) | front_desk, manager | yes |
| 05 | [Staff onboarding with the QR code](05-staff-onboarding-qr.md) | admin, manager, new staff | yes |
| 06 | [Staff roles and permissions](06-roles-permissions.md) | admin | no |
| 07 | [Offline use of the app and syncing](07-offline-sync.md) | all staff | yes |
| 08 | [Deployment, rollback and secrets rotation](08-deploy-rollback-secrets.md) | admin (technical) | no |
| 09 | [Backup and restore of Supabase](09-backup-restore.md) | admin (technical) | no |
| 10 | [Incident response and privacy](10-incident-privacy.md) | admin, manager | no |
| 11 | [Operations tasks and published SOPs](11-workflow-tasks.md) | admin, manager, front_desk, kitchen | yes |

## SOPs in the database

The migration `20261029000000_admin_operations.sql` seeds these SOPs into the `sops` table (codes SOP-01 to SOP-11), so the
Operations tab can link tasks to them. Managers can also publish new SOPs from the app (SOP 11). Category mapping:

| Category | SOPs |
| --- | --- |
| `opening_closing` | 01 |
| `kitchen` | 02 |
| `front_of_house` | 03, 04, 05, 06, 07, 11 (no closer category exists for the staff and app SOPs) |
| `emergency` | 08, 09, 10 |
| `cafe` | none yet |

When a seeded SOP changes here, update its row with a new migration as well; the seed only inserts missing codes.

## Format

Every SOP has the same five parts: **Purpose**, **Who does it**, **Steps**, **Checks**, **When it goes wrong**.
The SOPs that front_desk and kitchen staff use end with a short **Egyptian Arabic** version (بالمصري).

## Roles in one line

- **admin**: owner level. Everything, including roles, secrets, deploys and deleting data.
- **manager**: runs a branch. Menu, bookings, WhatsApp inbox, onboarding front_desk and kitchen staff, revoking devices.
- **front_desk**: bookings and the WhatsApp inbox for their branch. Reads the menu.
- **kitchen**: reads the menu, marks items sold out or available again, sees today's covers.

## Change log

| Date | Change |
| --- | --- |
| 2026-10-29 | First version, written before the build. |
| 2026-10-29 | Operations engine: SOP 11 added; SOPs 01, 06, 07 and 08 updated to match the build; all SOPs seeded into the `sops` table. |
