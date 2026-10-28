# SOP 07: Offline use of the app and syncing

## Purpose
Wi-Fi and mobile data on the Corniche are not always reliable. The staff app keeps working offline for the things that matter during service,
and syncs when the connection comes back.

## Who does it
All staff. The manager on shift owns the problems.

## What works offline
| Works offline | Needs a connection |
| --- | --- |
| Opening the app (the offline shell is cached) | Signing in with a QR code |
| Reading the menu and today's bookings as last loaded | Changing prices and names, adding items |
| Marking items Sold out / Available (queued) | Creating QR codes, revoking devices, changing roles |
| Changing a booking's status (queued) | Seeing changes made on other devices |
| Creating a new booking (queued) | |
| Logging a WhatsApp request, marking it replied (queued) | Opening WhatsApp itself needs data |

## How it works (technical summary)
- **Static files and fonts:** cached with **CacheFirst** by the service worker (vite-plugin-pwa / Workbox), so the app opens without a connection.
- **API reads** (Supabase REST): **NetworkFirst** with a 4 second timeout, falling back to the last cached answer.
- **Auth and the edge function are never cached.**
- **Writes made offline** go to an **outbox** saved on the device (IndexedDB). Each entry has the table, the row id, the change and the
  `updated_at` the device last saw. When the device is back online, the outbox is replayed in order.
- **Conflicts:** if the row changed on the server after the device last saw it, the change is **not** applied. It shows under
  **Sync → Conflicts** for a person to decide. Sold out / Available always applies (latest wins), because the newest kitchen state is the true one.
- The sync badge shows Synced (green), Offline (grey), Syncing (amber) or the number of pending changes and conflicts (red).

## Steps
1. If the badge shows **Offline**, keep working. Writes queue up.
2. When the connection is back, the badge turns amber, then green. If it does not, press the badge → **Sync now**.
3. If **Conflicts** shows a number, open it. For each one, choose **Keep mine** or **Keep server**. If unsure, keep server and redo the change by hand.

## Checks
- The badge is green at opening and closing (SOP 01).
- Never clear the browser data or uninstall the app while changes are pending; they would be lost.

## When it goes wrong
- **Pending for more than 10 minutes on a working connection:** Sync now. If it still fails, take a screenshot of the Sync screen and send it to the manager.
  Do not enter the same booking again.
- **"Session expired" while offline:** stay offline, finish service, then reconnect. If the app asks for a sign-in, the manager issues a new QR code (SOP 05).
  The outbox stays on the device and is sent after sign-in **only if it is the same staff member**; otherwise it is discarded and listed for the manager.
- **The app looks out of date after a deploy:** close all tabs of the app and open it again. The new version takes over on the next start.

## Operations tasks
The Operations tab (SOP 11) needs a connection. Task and SOP changes are not queued in the outbox: offline, the action shows an error
and you do it again when the badge is green.

---

## بالمصري
- النت قطع؟ **كمّل شغل عادي.** الحجوزات و"خلص/متاح" بتتسجل على الجهاز وتتبعت لما النت يرجع.
- اللي **محتاج نت:** تغيير الأسعار، QR للموظفين، وفتح الواتساب نفسه.
- علامة المزامنة: خضرا = تمام، رمادي = مفيش نت، أحمر برقم = فيه حاجات مستنية.
- لو فضلت حمرا ١٠ دقايق والنت شغال: دوس عليها ← **زامن دلوقتي**. ولو مفيش فايدة صوّر الشاشة وابعتها للمدير.
- **اوعى تمسح الأبلكيشن أو بيانات المتصفح** وفيه حاجات لسه متبعتتش.
- ومتسجلش نفس الحجز مرتين.
