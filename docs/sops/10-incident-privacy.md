# SOP 10: Incident response and privacy

## Purpose
Respond to outages, security problems and guest data exposure the same way every time, and keep the minimum guest data, for the shortest time.

## Who does it
- **admin:** incident lead.
- **manager:** reports incidents, handles the guest side.
- Everyone: reports anything strange straight away.

## Guest data we hold
| Data | Why | Kept for |
| --- | --- | --- |
| Guest name, phone | to confirm or change a booking or a WhatsApp request | 180 days after the booking date, then anonymised by `app.purge_guest_data()` |
| Booking date, time, guests, branch, status | operations and statistics | kept, without name and phone after 180 days |
| WhatsApp request message text | to answer the request | 90 days, then the message and phone are cleared |
| Notes | only what the guest asked for (allergy, high chair, birthday) | same as the booking |

Never store ID numbers, card numbers, or personal opinions about guests. Never export guest phone numbers for marketing.

## What telemetry scrubs
The telemetry wrapper (`apps/staff-pwa/src/lib/telemetry.ts`) is off unless the `VITE_POSTHOG_KEY` / `VITE_LOGROCKET_APP_ID` env vars are set. When it is on:
- **LogRocket:** every input value is masked (`dom.inputSanitizer: true`), and text inside elements marked `data-private` (guest names and phones) is masked in recordings.
  On captured network requests, **all request bodies are dropped**, and the `Authorization`, `apikey`, `Cookie`, `Set-Cookie` and `x-client-info` headers are removed. Response bodies are dropped.
- **PostHog:** autocapture is off, session recording masks all inputs and `data-private` text, and every event goes through a scrubber before it is sent. The scrubber removes keys that look like
  `phone`, `name`, `email`, `token`, `password`, `authorization` or `message`, and replaces Egyptian phone numbers (`01xxxxxxxxx`, `+201…`), emails and JWT-looking strings anywhere in strings with `[redacted]`.
- URLs are cleaned of `#t=` (QR tokens) and `access_token` / `refresh_token` before they are sent.
- Staff are identified only by their internal staff id and role, never by name.

## Steps: incident
1. **Detect and declare.** Whoever notices it tells the admin (phone call, not a group chat if it involves data). The admin opens an incident note: time, what was seen.
2. **Contain.**
   - Lost or stolen device: revoke it (SOP 05).
   - Leaked secret: rotate it (SOP 08).
   - Wrong permissions: set the account inactive (SOP 06).
   - App broken after a deploy: roll back (SOP 08).
   - Supabase down: branches work on paper and offline (SOP 07).
3. **Assess.** Use `audit_log`, Supabase logs and Vercel logs to find what data was touched and for how long.
4. **Notify.** If guest personal data was exposed, the owner decides on notifying the affected guests and the authorities under Egypt's Personal Data Protection Law (Law 151 of 2020), with legal advice. Notify without undue delay.
5. **Recover**, then hold a **review within 7 days**: cause, timeline, what we change. Update the SOPs affected.

## Checks
- Every quarter: run `select app.purge_guest_data();` (it is scheduled with pg_cron if enabled) and check that no booking older than 180 days has a phone number.
- Every quarter: open a LogRocket session and a PostHog event and check that no phone, name or token is visible.

## When it goes wrong
- **Not sure if it is an incident:** treat it as one. Declaring an incident costs nothing.
- **A guest asks to delete their data:** the manager finds their bookings and requests by phone, and an admin runs `app.forget_guest('<phone>')`. Reply to the guest once to confirm.
