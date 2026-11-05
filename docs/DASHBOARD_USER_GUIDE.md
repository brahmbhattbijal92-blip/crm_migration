# CRM Migration Dashboard: User Guide

This guide explains the dashboard in everyday language. The application still needs real Supabase settings and the schema applied before live organization sign-in and Cloud storage can work.

## 1. Sign In and Open Your Organization

1. Choose **Register organization** if you are creating a new company workspace, or **Sign in** if your account already exists.
2. Confirm your email if the system asks you to.
3. New owners finish company setup. Invited team members use the invitation link.
4. The dashboard opens after the system confirms your organization membership.

If the page says the authentication service is not configured, ask the administrator to finish the Supabase setup. Do not enter real client information in a test environment.

## 2. Choose Where Your Records Live

Use the **Storage** menu in the dashboard header.

- **Local** keeps records in this browser on this device, under your signed-in account. Other team members do not see them.
- **Cloud** keeps records in your organization's shared workspace. Access depends on your account and organization membership.
- The app asks before switching. Local and Cloud records are separate; switching does not copy or merge them.
- If Cloud is unavailable or disabled, ask your administrator to check the project setup.

## 3. Work with Clients

- Use **Client profile** to add or edit a client's name, contact details, company, and passport or visa dates.
- Select a client in the monitoring list to load that client's documents and financial records.
- Use **Archive** to remove a client from the active list while keeping its history.
- Archived clients show their archive date and purge eligibility. Purge is blocked until the 90-day retention period has passed and invoice checks are clear. Permanent purge cannot be undone.

## 4. Grants and Invoices

### Add Grant Funds

- Select a client and enter the grant source, amount, currency, and allocation date.
- The available balance is shown separately for each currency. Do not add different currencies together.
- Grant allocations and later invoice deductions appear in the ledger.

### Add an Invoice

- Select a client and enter the invoice number, amount, currency, and due date.
- The system applies available grant funds in the same currency. If the grant balance is smaller than the invoice, it applies the available portion and leaves the rest outstanding.
- The invoice list shows the total, amount covered by grants, and amount still due.
- Use **Record payment** to enter money received. The app records the payment and reduces the amount due. The invoice is marked paid only when the remaining balance reaches zero.

## 5. Documents and Other Tools

- **Document staging:** Local mode saves file contents to a folder you choose. Cloud mode uses the organization's private document storage. The browser asks for folder access in Local mode.
- **Team access:** Owners and admins can review team members and invite agents.
- **Data lifecycle:** Review inactive accounts, export the selected inactivity report as CSV, and follow the purge checks. This CSV is not a full Local backup.
- **Expiry reminders:** The worker records simulated passport and visa reminders at 90, 60, and 30 days. It does not send a real email or text message.
- **Credential vault:** Saved credentials are encrypted. Reveal remains disabled outside development until a real SMS provider is configured; shared challenge storage and global verification limits use Upstash Redis.
- **Companion extension:** Profile sharing requires the separately installed browser extension. It shares selected profile fields for a one-time form fill.

## 6. Protect Your Work

- Use a private, locked device. Local records are still accessible to someone using your signed-in browser account.
- Keep Local and Cloud records distinct. Check the Storage label before entering important information.
- Browser site-data cleanup can remove Local records. A full Local backup download is not currently available.
- Sign out when finished on a shared device.

## 7. Recommended Dashboard Layout

The intended workspace is organized into three areas:

- **Global header:** Organization name, signed-in user, Local/Cloud selector, and sign-out. A backup action should appear in Local mode only after a trusted paid-plan check and the backup feature are implemented.
- **Client sidebar:** Search and quick filters for active and archived clients. Selecting a name updates the workspace without losing the current mode.
- **Client workspace:** Profile details, available grant balance by currency, invoices and amounts due, documents, and recent activity.
- **Action hub:** Clear actions for **Add Grant**, **Add Invoice**, **Archive**, and **Purge**, with confirmation for destructive actions.

The dashboard uses the split-screen layout in [FinancialWorkspaceLayout.tsx](../src/components/FinancialWorkspaceLayout.tsx). The header contains storage mode and account controls, the sidebar switches between active and archived clients, the center shows the selected profile and financial activity, and the action hub opens grant/invoice forms or runs archive, restore, and eligible purge actions.

## 8. Current Feature Availability

- Organization login gate: implemented for both modes, but requires working Supabase settings and deployed schema.
- Local and Cloud storage selection: implemented; the two stores do not sync or migrate records.
- Grant allocations, per-currency balances, invoice grant drawdown, and payment recording: implemented in app code; Cloud RPCs require the updated schema to be applied.
- Archive and 90-day purge eligibility: implemented in app code and schema; validate against staging before use.
- Paid subscriptions and full Local backup download: not implemented.
- Live registration, Cloud access, and cross-tenant RLS: not verified against a configured Supabase project.