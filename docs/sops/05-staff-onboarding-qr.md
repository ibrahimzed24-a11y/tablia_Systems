# SOP 05: Staff onboarding with the QR code

## Purpose
New staff and new devices are added by scanning a QR code, with no passwords to share or forget.
Each QR code is a **short-lived, single-use** signed token. It sets up one device, for one person, with one role and one branch.

## Who does it
- **admin:** creates QR codes for any role, including manager and admin.
- **manager:** creates QR codes for **front_desk** and **kitchen**, for their own branch only.
- **the new staff member:** scans the code on the device they will use.

## How it works (technical summary)
- In **Staff → Add staff / device**, the manager fills in the name, role and branch. The app asks the `verify-provision-qr` edge function to
  **issue** a token: an HS256 JWT signed with `PROVISION_JWT_SECRET`, containing a unique `jti`, the role and the branch, valid for **10 minutes**.
  A row is saved in `provision_tokens`.
- The QR code holds the link `https://<staff app>/provision#t=<token>`. The token sits after `#`, so it is never sent in server logs or Referer headers.
- When the new device opens the link, the app sends the token to the edge function (**redeem**). The function checks the signature, the expiry
  and the issuer, then marks the token as used **in the same database update** (only if it is not used, not revoked and not expired).
  It then creates or finds the staff user, opens a session for this device and records the device in `staff_devices`.
- A second scan of the same code fails with "already used".

## Steps
### Generate
1. Staff → **Add staff / device**.
2. Name, role, branch, and a device label (for example "Corniche front desk tablet").
3. **Generate QR**. The code shows a 10 minute countdown. Keep the screen in front of the new staff member only, and do not photograph it or send it.

### Scan
1. The new staff member scans it with the device's camera and opens the link in the browser.
2. The app opens signed in. Check the name, role and branch in the header.
3. Install it: browser menu → **Add to Home screen**.

### Expiry and single use
- An unused code dies after 10 minutes. Generate a new one; old ones cannot be reused.
- **Revoke unused code**: Staff → Pending codes → **Revoke**.

### Revoke a lost device
1. Staff → open the person → **Devices** → **Revoke** on the lost device.
2. This deletes that device's session and marks it revoked. The database stops accepting it on the next request (the RLS check looks at the
   device's session). It does not affect the person's other devices.
3. If the person is leaving, an admin switches **Active** off. That blocks every device they have.
4. Give the person a new QR code for their new device.

## Checks
- After a scan, the device shows in the person's Devices list with today's date.
- Every week the manager reviews Devices and revokes any not seen for 30 days.

## When it goes wrong
- **"Code expired" or "already used":** generate a new code.
- **"Origin not allowed":** the link was opened on a domain that is not in `ALLOWED_ORIGINS` (SOP 08). Use the official staff app address.
- **A QR photo was shared:** revoke the code (or the device, if it was already redeemed) and create a new one.

---

## بالمصري
- المدير بيعمل QR من **الموظفين ← إضافة موظف/جهاز**. الكود شغّال **١٠ دقايق بس** و**مرة واحدة بس**.
- الموظف الجديد بيصوّر الكود من موبايله أو التابلت ويفتح اللينك، هيدخل على طول. بعد كده: **Add to Home screen**.
- متصوّرش الكود ومتبعتهوش لحد.
- جهاز ضاع؟ قول للمدير على طول وهو يعمل **Revoke** للجهاز ده بس.
