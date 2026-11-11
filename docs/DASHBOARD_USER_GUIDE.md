# CRM Migration Dashboard: User Guide

This guide explains the current dashboard behavior in everyday language. Cloud features require the deployed Supabase project to have the application migrations and environment settings configured. Local records are stored in the browser and are separate from Cloud records.

## 1. Sign In and Open Your Organization

1. Choose **Register organization** if you are creating a new company workspace, or **Sign in** if your account already exists.
2. Confirm your email if the system asks you to.
3. New owners finish company setup. Invited team members use the invitation link.
4. The dashboard opens after the system confirms your organization membership.

If the page says the authentication service is not configured, ask the administrator to finish the Supabase setup. Do not enter real client information in a test environment.

## 2. Choose Where Your Records Live

Use the **Workspace** selector in the dashboard header.

- **Local** keeps records in this browser on this device, under your signed-in account. Other team members do not see them.
- **Cloud** keeps records in your organization's shared workspace. Access depends on your account and organization membership.
- The app asks before switching. Local and Cloud records are separate; switching does not copy or merge them.
- If Cloud is unavailable or disabled, ask your administrator to check the project setup.

### What “Local” means

- Local client, invoice, grant, document-metadata, and reminder records are stored in **IndexedDB**, a browser database. They are not stored in the browser history list.
- The Local/Cloud choice itself is saved in `localStorage`. This is a small preference, not the client database.
- Local data is scoped to the signed-in user and the exact website origin. Use the same browser profile, website address, and signed-in account to see it again. A different browser, profile, device, or deployment URL has a separate Local database.
- Browser-history-only cleanup normally removes visited URLs, not IndexedDB. Clearing the site's cookies or site data, resetting/removing the browser profile, or storage eviction can delete Local records. Signing out or switching to Cloud does not copy or delete Local records.
- In Local mode, document metadata is in IndexedDB, but document file bytes are saved in a folder selected with **Choose local folder**. The browser remembers that folder permission and can ask you to grant it again. Clearing website data may remove the remembered folder handle, but does not necessarily remove files already in the folder.
- Local data is not a full backup and is not encrypted by this app as a separate database. Anyone with access to the same unlocked browser profile/device may be able to access it. There is currently no complete Local backup-and-restore button.

## 3. Work with Clients

- Use **Client profile** to add or edit a client's name, contact details, company, and passport or visa dates.
- Select a client in the monitoring list to load that client's documents and financial records.
- Use **Archive client** to hide a client from the active list while keeping its history. Use **Show archived** to switch the sidebar to archived records; the action then becomes **Restore client**.
- Archived clients show the archive date and purge eligibility. From **Archived clients**, **Restore** returns the record to the active list. **Permanently purge** is enabled after 90 days archived, subject to invoice and attachment checks. Purging cannot be undone.

## 4. Dashboard Buttons and Forms

- **Workspace** switches between Local Storage Mode and Cloud Sync Mode. It changes which database future reads and writes use; it does not copy, merge, or migrate records.
- **+ New client** opens a blank client form. **Add client** saves it; **Edit profile** loads a selected client into the form; **Save changes** updates it; **Cancel edit** discards unsaved edits.
- **Search clients** filters the sidebar. **Search by** chooses All fields, Name, Email, or Company. **Load more clients** fetches the next page.
- In Cloud mode, an owner/admin may use **Assigned agent** to assign or unassign a client.
- **Add grant entry** opens the grant form. Enter source, allocation date, positive amount, three-letter currency, and optional reference/description. Balances are shown separately by currency.
- **Add invoice** opens the invoice form. Add its number, positive amount, currency, and optional due date. Available grant funds in the same currency are applied. **Record payment** adds a payment no larger than the amount due.
- In Local mode, choose **Choose local folder** before staging a document. Select a client and file, then choose **Stage document**. In Cloud mode, files go to the private Supabase bucket. **Load more documents**, **Load more invoices**, and **Load more grant entries** fetch additional rows.
- **Archive client** retains the client and related records. For an archived client, use **Restore client**. **Purge client** is available only when an archived record has reached its eligibility date; it opens the secure purge flow described below.
- **Team** is shown to the organization owner. **Sign out** ends the Supabase session; it does not erase Local records.
- **Data lifecycle** opens the inactivity report. **Refresh data** reloads dashboard records. **Global Page Search** jumps to dashboard features and pages.
- **Share selected client** sends the selected client's supported profile fields temporarily to the approved portal browser extension. It does not submit the external form; review and submit it yourself.

## 5. Expiry Review and Reminders

- Enter **Passport expiry** or **Visa expiry** on the Client profile and save it. A date appearing in the **Expiry review queue** means that date exists on a currently loaded client; it is not itself a reminder event.
- The queue and **Agent reminder audit** are under **Purge and data governance** on the main Dashboard. They are not on the **Inactive accounts** Data Lifecycle page.
- The Vercel cron worker checks at the start of every UTC hour. It creates a reminder when a non-archived Cloud client expires exactly 90, 60, or 30 UTC calendar days after that run. It emails the authorized recipients and stores an audit row; it does not trigger for every date inside those windows. The Vercel plan must support hourly Cron Jobs.
- The worker does not backfill a notice window that has already passed. If an expiry date is entered after its 30-day notice date, no late 30-day event is generated.
- The audit panel displays events created within the last 24 hours and their delivery status: **queued**, **sending**, **sent**, or **failed**. Older events remain stored in Supabase but are hidden from this panel. A **sent** status means the SMTP server accepted the message; it does not guarantee inbox delivery. Each reminder milestone gets one email attempt; failed attempts are not automatically resent.
- The worker emails organization owners/admins and agents who can access that client (assigned agent, or its creator while unassigned). The message includes the client name, document type, and expiry date. No user needs to be signed in at the time of the run.
- The worker reads Cloud Supabase records only. Dates entered in Local mode are not scanned by the server worker and will not produce its reminder rows.
- For an expiry on **20 Nov 2026**, the 90/60/30-day eligible dates are **22 Aug, 21 Sep, and 21 Oct 2026**. The worker checks hourly during each eligible UTC date. On **11 Nov 2026** the expiry is only 9 days away, so no new reminder is expected from this worker.
- Apply `supabase/migrations/20261111000000_governance_notification_sending_status.sql` before deploying this worker. It adds the `sending` state used to prevent duplicate email attempts.
- The worker requires `NEXT_PUBLIC_SUPABASE_URL`, server-only `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, and `REMINDER_SMTP_HOST`, `REMINDER_SMTP_PORT`, `REMINDER_SMTP_USER`, `REMINDER_SMTP_PASSWORD`, and `REMINDER_EMAIL_FROM` in Vercel Production environment variables. Never prefix SMTP credentials with `NEXT_PUBLIC_`. Check Vercel Cron/Function logs for `matchingExpirations`, `emailsSent`, and `emailsFailed`; 503 indicates missing cron secret, 401 indicates a secret mismatch, and 500 indicates a worker/database failure.

## 6. Inactive Accounts and Data Lifecycle

- Open **Data Lifecycle** to review active client records whose **last interaction** is older than the selected **Inactive for at least** threshold. This is based on activity, not passport/visa expiry.
- **Search accounts** filters by text; **Search by** chooses All fields, Name, Email, or Company. **Inactive for at least** chooses 30, 60, 90, 180, or 365 days. **Refresh** reloads the report, and **Load more accounts** adds the next page.
- Select rows or **Select all visible inactive accounts**, then choose **Export selected** to download a CSV of the selected account fields. The CSV is an inactivity report, not a full backup.
- **Open archived clients** takes you to the supported restore/purge workflow. To purge, first archive the client from the main Dashboard, keep it archived for 90 days, then use **Permanently purge** on the Archived clients page. Purge is blocked if active/unpaid invoices remain. In Local mode, access to the selected document folder must also be available.
- The secure purge confirmation lists the affected records and attachments. **Cancel** stops; **Permanently purge** deletes the selected archived client and dependent data from the selected storage domain and removes associated files. This is irreversible.

## 7. Team Access and Credentials

- On **Team access**, enter an email and choose **Invite agent**. **Deactivate agent** stops access but retains the membership. **Send reactivation email** sends a verification code to an inactive agent.
- **Remove agent** removes organization access with a 30-day recovery period. In **Removed agents**, **Restore / re-invite** restores the original account when possible; **Delete account permanently** deletes the Supabase account and organization memberships. It is owner-only and refuses accounts still belonging to another organization.
- The **Credentials vault** is Cloud-only. **Reveal** sends an 8-digit verification code to the signed-in user's Supabase Auth email. Enter the code in the dialog; the revealed username/password are hidden again after 30 seconds. **Resend** is subject to the 60-second cooldown and Supabase Auth rate limits. Vault secrets remain masked until verification succeeds.

## 8. Grants and Invoices

### Add Grant Funds

- Select a client and enter the grant source, amount, currency, and allocation date.
- The available balance is shown separately for each currency. Do not add different currencies together.
- Grant allocations and later invoice deductions appear in the ledger.

### Add an Invoice

- Select a client and enter the invoice number, amount, currency, and due date.
- The system applies available grant funds in the same currency. If the grant balance is smaller than the invoice, it applies the available portion and leaves the rest outstanding.
- The invoice list shows the total, amount covered by grants, and amount still due.
- Use **Record payment** to enter money received. The app records the payment and reduces the amount due. The invoice is marked paid only when the remaining balance reaches zero.

## 9. Documents and Other Tools

- **Document staging:** Local mode saves file contents to a folder you choose. Cloud mode uses the organization's private document storage. The browser asks for folder access in Local mode.
- **Team access:** Only the organization owner can open Team access, review members, and invite agents. Agents do not have a Team menu or Team page access.
- **Data lifecycle:** Review and export inactive active-client records. Purging is done from Archived clients after the retention period.
- **Expiry reminders:** The main Dashboard shows an expiry review queue and reminder audit. Worker events are simulated at exact 90/60/30-day thresholds and do not send email or text.
- **Credential vault:** Saved credentials are encrypted. Reveal uses a one-time email code sent to the signed-in user's Supabase Auth email. The verification code expires according to Supabase Auth settings, resend has a 60-second app cooldown, and revealed values are hidden again after 30 seconds.

### Share Selected Client

Use **Share selected client** when you want to copy the currently selected client's profile details into a compatible form in the approved ImmiAccount portal.

1. Install and enable the **Migration Form Assistant** Chrome extension. The deployment must have the extension ID configured.
2. In the dashboard, select the client whose profile you need.
3. Open exactly one ImmiAccount tab at `https://online.immi.gov.au` in the same Chrome window.
4. Choose **Share selected client** in the dashboard. The extension stores the profile temporarily for that portal tab.
5. In the portal, choose **Fill form from client**. The extension fills matching, visible, empty fields; review the values and submit the portal form yourself.

The one-time profile contains first and last name, email, company, passport expiry, visa subclass, and visa expiry. It expires after five minutes and is consumed once. Existing non-empty fields are not overwritten. The extension does not submit the form and does not share vault usernames, passwords, one-time codes, or other credentials. Use the share only when the selected client and portal form are correct.

If sharing fails, check that the extension is installed and enabled, the correct client is selected, exactly one approved portal tab is open, and the extension ID is configured for the current deployment.

## 10. Protect Your Work

- Use a private, locked device. Local records are still accessible to someone using your signed-in browser account.
- Keep Local and Cloud records distinct. Check the Storage label before entering important information.
- Browser site-data cleanup can remove Local IndexedDB records; history-only cleanup usually does not. A full Local backup download is not currently available.
- Sign out when finished on a shared device.

## 11. Dashboard Layout

The current workspace is organized into three areas:

- **Global header:** Local/Cloud Workspace selector, Global Page Search, Data lifecycle, Refresh data, Share selected client, Team (owner only), and sign-out. A full Local backup button is not available.
- **Client sidebar:** Search and quick filters for active and archived clients. Selecting a name updates the workspace without losing the current mode.
- **Client workspace:** Profile details, available grant balance by currency, invoices and amounts due, documents, and recent activity.
- **Action hub:** **Add grant entry**, **Add invoice**, **Archive client** (or **Restore client**), and **Purge client**. Purge is enabled only for eligible archived records and requires confirmation.

The dashboard uses the split-screen layout in [FinancialWorkspaceLayout.tsx](../src/components/FinancialWorkspaceLayout.tsx). The header contains storage mode and account controls, the sidebar switches between active and archived clients, the center shows the selected profile and financial activity, and the action hub opens grant/invoice forms or runs archive, restore, and eligible purge actions.

## 12. Current Feature Availability

- Organization login gate: implemented for both modes, but requires working Supabase settings and deployed schema.
- Local and Cloud storage selection: implemented; the two stores do not sync or migrate records.
- Grant allocations, per-currency balances, invoice grant drawdown, and payment recording: implemented in app code; Cloud RPCs require the updated schema to be applied.
- Archive and 90-day purge eligibility: implemented in the app and schema. Purge is manual, requires an archived record and invoice/attachment checks, and is never triggered by the reminder worker.
- Paid subscriptions and full Local backup download: not implemented.
- Deployed registration, Cloud access, and database policies must be checked in the target Supabase/Vercel projects; this source guide cannot verify external deployment settings.