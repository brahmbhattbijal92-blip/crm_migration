# CRM Testing, Performance, and Troubleshooting Report

**Prepared:** 2026-11-05  
**Application:** CRM Migration Platform  
**Status:** Test plan and troubleshooting runbook. All credentials and URLs in this document are non-working examples.

## 1. SYSTEM PERFORMANCE ANALYSIS & KEY TESTING POINTS

### Test Run Record

| Field | Value |
| --- | --- |
| Tester | |
| Test date/time and time zone | |
| Build / commit | |
| Environment URL | |
| Storage mode | Local / Cloud |
| Browser and version | |
| Organization / role fixture | |
| Dataset size (active / archived / invoices / payments / grants / documents) | |
| Network profile | |

Use the same seeded dataset, browser, and network profile when comparing runs. Record p50 and p95 timings where possible. Suggested timing targets are environment-specific; establish a baseline before treating a threshold as a release gate.

### UI/UX Responsiveness

| Check | Procedure | Expected result / evidence | Result |
| --- | --- | --- | --- |
| Split-screen workspace | Open the dashboard at 360 px, 768 px, 1280 px, and 1600 px widths. Select a client and inspect the sidebar, profile, financial summary, and action hub. | Layout remains usable without overlapping controls or clipped financial values; selected client is visibly identified. Record screenshot and viewport. | |
| Sidebar active/archived switch | Toggle active and archived views with more than 50 records in each. Select a client, then switch views and return. | Correct list and selection behavior; Cloud fetches no more than 51 rows per page request. Record request duration and row count. | |
| Client pagination | Load successive 50-row pages using Load more. Repeat at least three times. | Rows append without duplicates or resetting the prior list. A 51st look-ahead row produces `hasMore=true`; 50 or fewer rows produces `false`. | |
| Selected-client workspace | Select clients with and without documents, invoices, grants, and balances. Record time to render the selected-client workspace. | Related data belongs to the selected client only; loading/error states are clear; no stale prior-client values remain after switching. | |
| State retention | Select a client and switch between dashboard views/routes, then return. | Note whether selection is preserved. If route navigation remounts the page, use the remediation in section 2.4. | |
| Client list interaction | Search/filter if available, toggle archived view, select rows, and load more while observing browser Performance tools. | No long main-thread task or layout shift that prevents interaction. Record largest observed task and interaction delay. | |

### Storage Performance

| Check | Procedure | Expected result / evidence | Result |
| --- | --- | --- | --- |
| Local browser storage | Use a seeded Local profile with representative client, document, invoice, and grant counts. Measure initial load, filtering, and page append. | Local records are read from browser IndexedDB. Current Local page slicing may still scan all IndexedDB rows before rendering a page; record scan and render times separately. | |
| Local site-data behavior | In a disposable test profile, remove only this site's stored data and reload. | Data loss is reproducible and documented. Confirm the test profile contains no user data before cleanup. Do not run this test on a real user profile. | |
| Cloud client page | In Cloud mode, inspect Network requests for active and archived client pages. | Page size is 50 plus one look-ahead row, with deterministic ordering and tenant-scoped filters. Record HTTP status, returned row count, payload bytes, and elapsed time. | |
| Cloud selected-client reads | Select clients with large ledgers. Measure document, invoice, grant, balance, and summary requests individually. | Lists stay bounded to 50 plus look-ahead where page APIs are used; summary data is scoped to the selected client and organization. | |
| RPC latency | Measure `create_client_invoice`, `record_client_invoice_payment`, `allocate_client_grant`, and purge-review RPCs in staging with realistic rows. | Record p50/p95 latency, errors, database CPU/I/O, lock waits, and connection state. Do not treat a local build as a database performance test. | |
| Connection behavior | Repeat test bursts while watching Supabase pooler/database connection metrics. | No connection exhaustion or growing queue. Record configured `DB_POOL_MAX`, pooler mode, and deployment instance count. | |

### Core Financial Logic Verification

Use disposable invoices and grants. Record the before/after invoice and balance values, currency, ledger row IDs, and RPC result. Do not edit ledger rows manually to create a test outcome.

| Scenario | Setup / action | Expected result | Result |
| --- | --- | --- | --- |
| Same-currency grant drawdown | Allocate 100.00 USD. Create an 80.00 USD invoice for the same client. | Grant balance decreases by 80.00 USD; invoice `grant_applied_amount=80.00`, `amount_due=0`, and status is paid. A grant debit ledger row is appended. | |
| Partial grant coverage | Allocate 50.00 USD. Create a 90.00 USD invoice in USD. | Grant balance becomes 0.00 USD; invoice has 50.00 USD grant applied and 40.00 USD due. | |
| Cross-currency isolation | Give a client 100.00 EUR and no USD funds. Create a 75.00 USD invoice. | EUR balance is unchanged; no EUR is applied to the USD invoice. Repeat with mixed balances for several currencies. | |
| Payment recording | Record a payment smaller than `amount_due`, then a payment equal to the remainder. | Each payment appends a positive payment row and decreases due by the same amount. Status becomes paid only when due reaches zero. | |
| Overpayment rejection | Submit a payment greater than the current amount due. | RPC rejects it; invoice balance and payment ledger are unchanged. | |
| Payment/ledger consistency | Sum original payment rows and their reversal rows for an invoice. | Net payment total equals the external amount retained; reversal rows are negative and refer to original entries. Existing ledger rows remain unchanged. | |
| Invoice void / reversal migration | In an isolated staging database with the invoice-reversal migration applied, void an invoice with payments and grant funding. | Original payment rows remain; unreversed payments receive linked negative rows; grants are credited back once; invoice is void with zero due. Duplicate void/reversal attempts fail. | |
| Role enforcement | Repeat financial mutations as owner, admin, agent, member, and viewer. | Only roles explicitly allowed by the RPC can mutate. Cross-organization invoice/payment IDs reveal no data and cause no mutation. | |

### Data Lifecycle & Security Compliance

| Check | Procedure | Expected result / evidence | Result |
| --- | --- | --- | --- |
| 90-day archive boundary | In isolated data, test archived timestamps just under 90 days, exactly 90 days, and over 90 days. | Purge review blocks records before the retention boundary and permits eligible records at/after the boundary, subject to all other compliance checks. Record timestamps in UTC. | |
| Purge eligibility and recheck | Review an eligible archived client, change a blocking condition, then attempt purge. | Eligibility is rechecked by the server at execution time. Purge is blocked if retention is unmet, a blocking invoice exists, or the client is locked. | |
| Purge storage consistency | Purge a client with attachments in isolated staging. Simulate storage deletion failure. | Database/object outcomes and retry behavior are recorded; no success is reported while required deletion is unresolved. Reconcile orphan objects. | |
| Simulated reminder worker | Call `/api/cron/expiration-reminders` in staging using the configured bearer secret. Test records expiring in 90, 60, and 30 days, plus nonmatching dates. | Only matching, active clients produce simulated notifications for owner/admin/agent recipients. Repeat run does not duplicate rows. No real email or SMS is sent. Unauthorized requests return 401; missing configuration returns 503. | |
| CSV report export | Select inactive accounts, export, and compare rows/escaping with the selection. Load all pages before testing an export intended to cover the full dataset. | CSV values are correctly quoted/escaped and match selected loaded rows. Current export only includes selected records already loaded into the lifecycle screen. | |
| Tenant and role boundary | Use two organizations and each supported role. Attempt cross-tenant client, document, invoice, grant, notification, and purge access. | RLS and server authorization prevent cross-tenant reads/writes. Viewer/member mutations are rejected where role policy disallows them. | |
| Sensitive data handling | Inspect browser Network, application logs, and test exports during vault, financial, and client workflows. | No secrets, access tokens, or plaintext credentials appear in logs or unrelated responses. Use synthetic test data only. | |

### Run Log

| Test ID | Environment / role | Dataset | Outcome (Pass/Fail/Blocked) | Timing / metric | Evidence or issue link |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |

## 2. COMMON PERFORMANCE ISSUES & HOW TO SOLVE THEM

### 2.1 Local storage data disappears

**Symptoms:** Local records disappear after browser cleanup, browser profile reset, storage eviction, or moving to a different device.

**Why it happens:** Local records live in browser IndexedDB and are not a cloud backup. Clearing site data removes them. The current app does not provide a complete Local backup/export-and-restore workflow.

**Immediate response:**

1. Stop using browser cleanup tools on the affected profile. Do not clear site data, reset the browser, or uninstall the profile while recovery is being assessed.
2. Check that the user has reopened the same browser profile and origin used to create the Local records. Local data is not automatically copied to Cloud mode or another device.
3. If the IndexedDB database still exists, preserve the browser profile and collect a backup copy using approved support procedures before further changes.
4. Do not promise recovery if IndexedDB has been deleted and no separate backup exists.

**Product fix:** Implement a versioned export/import fallback before treating Local mode as durable storage. Export a manifest (`schemaVersion`, export time, user scope) and application records in one consistent IndexedDB read transaction; validate size and schema; exclude secrets by default; encrypt sensitive exports with a user-controlled key if they must be included. Import should preview counts, validate every record, reject unsupported versions, and commit atomically or roll back. Add checksum/integrity verification and test restore into a clean browser profile. Until that ships, keep a separate approved backup and never use Local mode as the only copy of regulated records.

### 2.2 Cloud RPC timeouts or slow financial ledger updates

**Symptoms:** Long waits or timeouts creating invoices, allocating grants, recording payments, reviewing purge eligibility, or loading deep pages.

**Troubleshooting and fix:**

1. Record the RPC name, organization/test tenant, request time, duration, request ID, and returned error code. Do not log client PII or secrets.
2. Check Supabase API/database logs for slow queries, lock waits, CPU/I/O saturation, pooler exhaustion, and network errors. Determine whether the delay is in PostgREST, the database function, or connection acquisition.
3. In staging, run `EXPLAIN (ANALYZE, BUFFERS)` on the underlying filters with representative tenant sizes. Confirm tenant/client predicates and ordering use appropriate indexes.
4. Verify the applied schema includes the indexes used by the workload, including the organization/client/due invoice page index, payment organization/invoice index, and client grant-balance key. Apply migrations through the normal deployment process; do not add speculative production indexes without reviewing write/storage cost.
5. Check database connection state and the configured pooler. The app's direct PostgreSQL pool defaults to five connections per process; review `DB_POOL_MAX`, serverless instance concurrency, and Supabase pooler limits together.
6. Retry only safe/idempotent operations. Do not blindly retry financial writes unless the RPC has a transaction-safe idempotency key; otherwise, first inspect the invoice/payment ledger to determine whether the write committed.

### 2.3 Failed grant/invoice cross-currency deductions

**Symptoms:** A grant in one currency appears to reduce an invoice in another currency, or the invoice balance does not match the grant ledger.

**Troubleshooting and fix:**

1. Compare the client's balance rows by organization, client, and currency. Check the `client_grant_balances` key and the corresponding `grants_ledger` currency entries.
2. Confirm invoice creation selects a balance using the invoice's normalized currency, and that both grant and invoice currencies are valid three-letter codes.
3. Enforce currency equality in authoritative server/database logic, not only in the UI. Never silently convert currencies. If FX conversion is required, add an explicit rate, source, timestamp, rounding rule, and paired ledger entries.
4. Reconcile `grant_applied_amount`, `amount_due`, the grant debit entry, and `available_balance` in a transaction. Correct mistakes with audited compensating entries; never edit or delete historical ledger rows.
5. Add regression tests for USD/EUR and at least one zero-balance or insufficient-balance case before release.

### 2.4 Component re-renders lose active client state when switching views

**Symptoms:** Returning to a dashboard view selects the first client, loses unsaved view state, or reloads all related data after navigation.

**Why it happens:** The active client is held in page-level state. App Router navigation can unmount that page, resetting local component state.

**Fix:** Move the selected client ID to a client context/provider mounted in the shared `app/dashboard/layout.tsx` (or another persistent dashboard-level layout). Have sibling dashboard pages consume the same provider. Also mirror the selected ID in a validated URL search parameter when deep-link/reload persistence is needed; clear it if the ID is not in the active organization. Keep per-view form/modal state local. Memoize repeated rows and use stable handlers for large lists so selection updates do not repaint every row.

### 2.5 Lifecycle results or exports seem incomplete

**Symptoms:** The inactive count or CSV seems smaller than the organization’s full dataset.

**Why it happens:** The lifecycle screen evaluates inactivity over records loaded so far, and its export includes only selected loaded rows.

**Fix:** Use Load more until all required pages are loaded before selecting/exporting a full population. For large organizations, implement server-side inactivity filters and a bounded/streamed export job with explicit row counts rather than asking the browser to hold the full dataset.

## 3. MOCK ORGANISATION & TEST CREDENTIALS LIST

> **Safety notice:** These `.test` identities, URLs, and passwords are fake fixtures only and are not provisioned accounts. Create them only in an isolated development/staging project using synthetic data. Never reuse these passwords or place real credentials in this document. Replace the staging URL with your own non-production host.

| Organisation Name | Test Environment URL / Mode | User Role | Mock Sign-In Email | Simulated Password / Access Key | Expected Data State |
| --- | --- | --- | --- | --- | --- |
| Northstar Mobility Group (Enterprise fixture) | `https://crm-staging.example.test` / Cloud | Owner | `owner.northstar@example.test` | `MockOnly-Northstar-Owner-2026!` | 2,000 active clients; over 50 archived clients; mixed USD/EUR/AUD grant balances; invoices with partial and full payments; documents across several clients; synthetic records at 89 and 91 days archived to test the retention boundary. |
| Riverbend Advisory (Mid-Market fixture) | `http://localhost:3000` / Local | Admin | `admin.riverbend@example.test` | `MockOnly-Riverbend-Admin-2026!` | 180 active clients; 40 inactive clients across 30/60/90-day thresholds; local documents and mixed-currency grant fixtures; enough records for four 50-row page requests. Seed only through the local test setup. |
| Community Access Trust (Non-Profit fixture) | `https://crm-staging.example.test` / Cloud | Agent | `agent.community@example.test` | `MockOnly-Community-Agent-2026!` | 400 active clients; active grants in USD and CAD; invoices with no grant, partial grant, and fully covered states; synthetic passport/visa expiry dates for 90/60/30-day simulated reminders; archived records both inside and beyond 90 days. |

### Fixture Setup and Cleanup

- Use a separate Supabase project and database for Cloud fixtures. Do not seed mock records into production.
- Ensure each test identity is a member of only its intended fixture organization and is assigned exactly the listed role.
- Use synthetic names, contact details, documents, and financial data. Do not upload real identity documents.
- Set reminder worker secrets and database credentials in the deployment secret manager, not in this file or source control.
- After testing, retain only the evidence needed for the run log, remove temporary accounts and files, and verify test objects were deleted.
