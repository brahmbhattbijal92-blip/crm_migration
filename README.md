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

The client profile assistant requires the server-only `OPENAI_API_KEY`; `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. Client profile data and selected documents are sent to the configured OpenAI API when a question is submitted. The endpoint requires an authenticated organization member and verifies cloud documents against the requested client. Selected assistant documents are limited to 15 MB total.

## Organization accounts

Apply the migrations after configuring Supabase Auth. Owners register at `/register`, confirm their email if confirmation is enabled, and create one organization at `/setup`. Owners and admins can invite agents from `/dashboard/team`; invite links return to `/auth/callback` and assign the invited account the `agent` role. Configure the Supabase Auth site URL and redirect allowlist for the app origin, and set `NEXT_PUBLIC_APP_URL` to that exact origin. Agent invitations require the server-only `SUPABASE_SERVICE_ROLE_KEY`; never expose it with a `NEXT_PUBLIC_` prefix. Each account currently has one default organization.

`DATABASE_URL` is used by legacy PostgreSQL server actions and the credentials vault. It is not required for local dashboard client records. Vault reveal sends a single-use 8-digit email OTP to the signed-in agent's Supabase Auth email. Configure the Supabase **Magic Link or OTP** template to include `{{ .Token }}` (not only `{{ .ConfirmationURL }}`) and use a production SMTP provider that can deliver to agent addresses. The vault dialog allows resending after 60 seconds; Supabase Auth's project-level send limits still apply. OTP expiry is controlled by Supabase Auth settings and also affects other email-auth flows. The verification client does not persist the OTP-created session.

For `DATABASE_URL` TLS errors such as `SELF_SIGNED_CERT_IN_CHAIN`, download the project's root certificate from Supabase **Project Settings → Database → SSL Configuration** and set its PEM contents as the server-only `DATABASE_SSL_CA` environment variable in Vercel. The database client uses this CA while continuing to verify the server certificate and hostname; do not disable TLS verification.

## Expiration reminder worker

The `/api/cron/expiration-reminders` route is scheduled by `vercel.json` to run daily at 08:00 UTC, which is supported on Vercel Hobby. Apply `supabase/migrations/20261111000000_governance_notification_sending_status.sql` before deploying the worker. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, server-only `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `REMINDER_SMTP_HOST`, `REMINDER_SMTP_PORT`, `REMINDER_SMTP_USER`, `REMINDER_SMTP_PASSWORD`, and `REMINDER_EMAIL_FROM` in the Vercel production environment. Keep SMTP credentials server-only; never use a `NEXT_PUBLIC_` prefix. The worker scans active Cloud Supabase clients and sends one email attempt at exactly 90, 60, and 30 UTC calendar days before passport or visa expiry to owners/admins and agents allowed to access the client. Database claiming prevents duplicate attempts for the same recipient and threshold. The audit rows remain in `governance_notifications`; the dashboard shows only the last 24 hours. Failed email attempts are not automatically resent. The audit appears on the main Dashboard under **Purge and data governance**; Local-mode dates are not scanned. Email status `sent` means the SMTP server accepted the message, not that it reached the inbox.

The dashboard provides an expiry review queue and reminder audit. The Data Lifecycle page is an inactivity review and CSV export tool. To purge a client, archive it and use **Archived clients** after the 90-day retention period; active or unpaid invoices block purge. No records are purged automatically.
