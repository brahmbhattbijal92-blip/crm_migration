# CRM Migration Platform

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If that port is occupied, Next.js prints the alternate local port.

## Database and storage

The ordered migrations in `supabase/migrations/` create the application schema, tenant tables, RLS policies, role mappings, split-screen dashboard layouts, passport/visa expiry fields, the notification ledger, and the private document bucket.

For local development, install and start Docker Desktop, then run:

```bash
npx supabase start
npx supabase db reset
```

`db reset` recreates the local database and deletes its existing data. Do not use it to update a database whose contents you need to keep. To apply the SQL to an existing cloud project, run the migration files in timestamp order using the Supabase SQL Editor, or use the Supabase migration workflow after confirming the project's migration history.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for authenticated cloud mode. Only the anon/public key belongs in browser variables; never expose a service-role key with a `NEXT_PUBLIC_` prefix. Local mode uses IndexedDB and does not require Supabase. Local document bytes are written to a user-selected folder through the File System Access API, which requires a supported browser and HTTPS or localhost.

## Organization accounts

Apply the migrations after configuring Supabase Auth. Owners register at `/register`, confirm their email if confirmation is enabled, and create one organization at `/setup`. Owners and admins can invite agents from `/dashboard/team`; invite links return to `/auth/callback` and assign the invited account the `agent` role. Configure the Supabase Auth site URL and redirect allowlist for the app origin, and set `NEXT_PUBLIC_APP_URL` to that exact origin. Agent invitations require the server-only `SUPABASE_SERVICE_ROLE_KEY`; never expose it with a `NEXT_PUBLIC_` prefix. Each account currently has one default organization.

`DATABASE_URL` is used by legacy PostgreSQL server actions and the credentials vault. It is not required for local dashboard client records. Vault reveal sends a single-use email OTP to the signed-in agent's Supabase Auth email. Configure the Supabase **Magic Link or OTP** template to include `{{ .Token }}` (not only `{{ .ConfirmationURL }}`) and use a production SMTP provider that can deliver to agent addresses. The OTP expiry and email rate limits are controlled by Supabase Auth settings and apply to other email-auth flows too. The verification client does not persist the OTP-created session.

For `DATABASE_URL` TLS errors such as `SELF_SIGNED_CERT_IN_CHAIN`, download the project's root certificate from Supabase **Project Settings → Database → SSL Configuration** and set its PEM contents as the server-only `DATABASE_SSL_CA` environment variable in Vercel. The database client uses this CA while continuing to verify the server certificate and hostname; do not disable TLS verification.

## Expiration reminder worker

The `/api/cron/expiration-reminders` route is scheduled by `vercel.json` to run daily at 08:00 UTC. Configure server-only `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` values in the deployment environment. The worker records idempotent simulated notifications for organization owners, admins, and agents exactly 90, 60, and 30 UTC calendar days before passport or visa expiry. It does not send email or SMS.

The dashboard provides an expiry review queue and reminder audit. No records are purged automatically; define and approve an organization retention policy before implementing destructive purge behavior.
