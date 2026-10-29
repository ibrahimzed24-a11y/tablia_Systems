# SOP 10: Incidents and privacy

**Owner:** the platform admin.

## Security incident

1. **Contain:** suspend an affected restaurant in `/admin`; remove a compromised admin from `platform_admins`
   ([ADMIN-BOOTSTRAP](../ADMIN-BOOTSTRAP.md)); in Supabase > Authentication > Users, sign the user out of all sessions
   and reset the password.
2. **Rotate** any secret that may be exposed ([SOP 08](08-deploy-rollback-secrets.md)).
3. **Find out:** Supabase logs (API, Auth, Postgres, Edge Functions) and `audit_log` for admin actions
   (suspensions, plan changes).
4. **Tell:** affected restaurant owners within 72 hours, and the Personal Data Protection Centre when guest personal
   data was exposed, as Egypt's Law 151 of 2020 requires.
5. **Record:** what happened, when, who was affected, what changed. Keep the record for one year.

## Account problems

- **Owner locked out:** they use "Forgot your password?" on `/owner`. The reset link opens the "choose a new password" screen.
- **Admin lost the authenticator app:** delete their MFA factor (see [ADMIN-BOOTSTRAP](../ADMIN-BOOTSTRAP.md)); they enrol again.
- **Restaurant unpaid or abusive:** suspend it in `/admin` with a reason. Its public page and its owner and staff
  console stay locked until you reactivate it.

## Guest data requests

Guests (customers) have no account; their name, phone and orders sit in the restaurant's `crm_customers`, `orders` and
`reservations`. The restaurant is responsible for its guests' data; Tablia Systems processes it for them.

1. Ask the restaurant owner to confirm the request and the guest's phone number.
2. Until a delete tool exists, an admin removes the rows in the Supabase SQL editor for that restaurant and phone,
   after a backup, and notes it in the incident record.
3. Answer within 30 days.
