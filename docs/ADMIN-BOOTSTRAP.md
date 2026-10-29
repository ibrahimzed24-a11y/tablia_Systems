# Creating the first platform admin

Platform admins run `/admin`. No sign-up, role or metadata makes an account an admin: an admin is a row in
`public.platform_admins`, which only the Supabase dashboard (SQL editor, service role) can write.

Use a separate email for the admin. An admin account cannot create or own a restaurant
(`create_my_organization` refuses it), so do not reuse an owner's email.

## Steps

1. Supabase dashboard > Authentication > Users > **Add user** > **Create new user**. Enter the admin email and a
   strong password and tick **Auto confirm user**. (Or sign up at `/owner` and confirm the email, but do not create a
   restaurant with that account.)
2. Supabase dashboard > SQL editor, with your own email in place of the example:

   ```sql
   insert into public.platform_admins (user_id, note)
   select id, 'founder' from auth.users where email = 'admin@example.com'
   on conflict (user_id) do nothing;
   ```

3. Open `https://<your app domain>/admin` and sign in with the email and password.
4. The first time, the page shows a QR code. Scan it with an authenticator app (Google Authenticator,
   Microsoft Authenticator, 1Password) and type the 6-digit code. From then on every sign-in asks for a code.
   The database refuses every admin function to a session without this step (`aal2`), even if someone has the password.

## Later

- **Add another admin:** repeat steps 1 and 2 with their email.
- **Remove an admin:** `delete from public.platform_admins where user_id = (select id from auth.users where email = 'admin@example.com');`
- **Lost phone or authenticator:** Supabase dashboard > Authentication > Users > the admin > delete the MFA factor,
  or `delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'admin@example.com');`.
  The next sign-in shows a new QR code.
- **Forgot the password:** use "Forgot your password?" on `/admin`. The link opens the authenticator step, then the
  "choose a new password" screen.

Existing admins (added before migration `20261029001100_saas_hardening.sql`) enrol their authenticator app the first
time they sign in after that migration is applied.
