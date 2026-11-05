# Security Audit: CRM Migration Platform

**Review date:** 2026-11-04  
**Scope:** Repository review of tenant schema, RLS policies, server actions, browser storage, file storage, and purge flow.  
**Verification limit:** This is a code review, not a live Supabase assessment. The workspace's Supabase settings are placeholders, so deployed grants, policies, function ownership, and SQL behavior have not been verified against a running project.

## Executive Summary

The schema enables and forces RLS on all application tables in `public`, with tenant-scoped policies for organizations, clients, documents, credentials, invoices, payments, grants, balances, and notifications. The private document bucket has organization/client path checks. The request proxy and server context check the signed-in user and organization membership before dashboard and server-action access.

This review triggered source changes: mutation policies now distinguish members from owner/admin/agent roles; direct membership edits are revoked; invoice receipt is an append-only payment transaction rather than a status edit; archive dates are set through guarded functions; purge rechecks retention; and document writes are blocked for archived or purge-locked clients. These are source-level fixes only. They are not confirmed in a live Supabase project, and the direct PostgreSQL connection role remains a critical deployment check.

## Findings

### Resolved in source: Organization roles are not consistently enforced

The membership table defines `owner`, `admin`, `agent`, `member`, and `viewer`. The schema now gives ordinary members read access and restricts data changes, financial allocations, and credential operations to owner/admin/agent roles. Membership changes and purge remain admin-only. Confirm these policies have been applied and test each role in staging.

The team actions do check for an owner/admin, and purge RPCs require an admin, but those checks are not a general role policy.

**Remaining action:** Run role-matrix tests against the deployed database. Confirm no older permissive policies remain after migration; PostgreSQL policies are permissive by default and multiple policies can combine with OR.

### Resolved in source: Invoice status could change without recording payment

The UI now records payments through a transaction that adds a payment row, decreases `amount_due`, and marks the invoice paid only at zero. Direct invoice writes are revoked from authenticated users. The payment ledger is append-only through the public API.

### Resolved in source: Invoice voids and payment reversals

The invoice-reversal migration adds linked negative payment rows without editing prior transactions, enforces one full reversal per original payment, and locks client/invoice rows in the same order as payment receipt. `void_invoice` is owner/admin-only, reverses unreversed payments, restores grant funds with an appended grant-ledger credit, and sets the invoice balance to zero. The server actions validate inputs and invoke the authenticated RPCs.

**Remaining action:** Apply the migration and test the role matrix, concurrent payment/reversal/void calls, and grant restoration in staging. Partial payment refunds are not implemented; reversals currently reverse an entire payment.

### Addressed in source: Direct PostgreSQL access requires a non-bypass role

`executeTenantQuery` sets `app.current_organization_id` from the server-validated organization inside a transaction. Current server queries also use explicit organization predicates. The helper now rejects direct PostgreSQL connections whose effective role is a superuser or has `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` does not constrain either.

**Remaining action:** Use a dedicated least-privilege database role with `NOBYPASSRLS`, never the `postgres` owner for application queries. Verify the deployed role flags and test cross-tenant access with the actual production role. The runtime check must be exercised against the deployed connection role.

### Addressed in source: Purge lock and document-write race

The schema now serializes document metadata writes against client row locks, rejects document metadata for archived/deleted/purge-locked clients, and validates both organization and client in the storage path. Storage writes require an editable role; object deletion is admin-only. The Cloud upload flow removes the uploaded object if metadata creation fails.

**Remaining action:** The storage object and SQL metadata operations are still separate systems. Add a durable purge job with retries and orphan-object reconciliation before handling large numbers of documents.

### Addressed in source: Archive timestamp tampering

Direct authenticated client updates no longer include status, archive timestamp, or deletion timestamp. Archive and restore use role-checked functions, and both purge claim and finalization check the 90-day retention period.

**Remaining action:** Validate function ownership and execution against RLS in the live project. Add an immutable archive event log if regulatory auditability is required.

### Resolved in source: Cloud failures could write to Local storage

Cloud operations previously fell back to Local storage after any error, including authorization and schema failures. This could report a successful operation while leaving its data in a different storage domain than the user selected. Cloud failures now propagate; Local storage is used only when Local is explicitly selected.

The Cloud data service now uses explicit client-column projections, supplies the active organization on inserts, archives through the guarded RPC, and writes document metadata to `public.documents`. A guarded preflight rejects archived, deleted, or purge-locked clients before upload; the metadata trigger and Storage RLS recheck client state. Storage object paths use `<organization-id>/<client-id>/<document-id>`, with the same generated document ID in the metadata row. Regression tests cover Cloud-to-Local isolation, the tenant-scoped upload path, locked clients, and cleanup retries.

### Verified in source: Narrow notification and organization privileges

The current schema grants notification updates only on `read_at`, grants profiles SELECT only, and restricts organization updates to `name`. It also drops the direct grant-ledger INSERT policy; grant writes use the authorized RPC. These source definitions still need to be verified in the deployed database.

### Medium: Local records are not a durable or device-protected backup

Local records are stored in browser storage, scoped by signed-in user. They are not encrypted with a device key, do not sync, and can be lost when browser site data is removed or the browser evicts storage. The full Local backup/export feature is not implemented. Legacy anonymous Local records are not automatically imported into the new user-scoped store.

**Recommendation:** Treat Local Mode as convenience storage, not the only copy of regulated financial records. Implement and test a versioned backup/restore flow before promoting Local Mode for important data.

## RLS Coverage Snapshot

The schema includes RLS enablement and tenant policies for `organizations`, `profiles`, `organization_memberships`, `clients`, `documents`, `credentials_vault`, `financial_invoices`, `financial_invoice_payments`, `grants_ledger`, `client_grant_balances`, and `governance_notifications`. The `client-documents` bucket is private and has organization/client path policies on `storage.objects`.

No intentional anon read policy for application rows was found in the schema. Direct authenticated grant-ledger INSERT is revoked and its INSERT policy is dropped, leaving the authorized RPC as the intended write path. Confirm effective privileges in the deployed database because SQL privileges can differ from this file.

## Scaling and Architecture Limits

- **Database connection growth:** `src/lib/db.ts` caps each Node.js process at 5 PostgreSQL connections by default (`DB_POOL_MAX` can tune this from 1 to 20), with connection-acquisition and idle timeouts. Serverless instance multiplication can still exhaust PostgreSQL connections; use Supabase's appropriate pooler and size the per-process cap against the deployment's maximum instance count.
- **Remaining unbounded reads:** Archived-client and data-lifecycle screens still request full lists, and Local Mode reads IndexedDB rows before slicing pages. Supabase/PostgREST and browser-memory limits remain practical constraints for those workflows.
- **Single active organization:** A profile has one `default_organization_id`. Memberships support more than one organization, but there is no organization switcher or explicit active-organization session model.
- **Financial hot rows:** Grant allocation and invoice settlement lock the client row to prevent double spending. This is correct for consistency, but a client with many simultaneous transactions becomes a serialization point.
- **Growing ledgers and storage:** Grant, invoice, notification, and object-storage records accumulate. Define retention, archival, object cleanup, and operational monitoring before high volume; partition only after measured growth warrants it.
- **Vault challenge delivery:** Challenge/grant state and the three-attempt-per-15-minute user limit now use Upstash Redis, with TTLs and an atomic Lua sliding-window update shared across instances. Reveal remains disabled outside development until a real OTP delivery provider is integrated. Configure a stable `VAULT_CHALLENGE_SECRET` and Upstash credentials on all instances.
- **No billing entitlement source:** Paid plans and plan-gated backup are not implemented. Do not show or enforce paid-only functions based on client-side flags.
- **No live SQL verification:** The schema and RPCs must be applied and tested in a staging Supabase project. A passing Next.js build does not parse or execute PostgreSQL functions.

## Deployment Verification Checklist

Run these checks in the target Supabase project before production. Review results without exposing connection secrets.

```sql
select current_user,
       rolsuper,
       rolbypassrls
from pg_roles
where rolname = current_user;

select schemaname, tablename, rowsecurity, forcerowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Also test as two users in different organizations and as each supported role. Verify that a viewer cannot mutate clients, documents, credentials, grants, or invoice state; that one tenant cannot read another tenant's rows or storage objects; that outstanding invoices cannot be hidden by changing status; and that uploads cannot race a purge.

## Overall Assessment

The schema has broad tenant RLS coverage, private storage, and security-definer functions with explicit search paths. Source fixes address role-based writes, payment recording, purge races, and archive timestamp protection. Do not treat the system as production-ready for financial data until the updated schema is applied to staging, cross-role and cross-tenant tests pass, the direct PostgreSQL role is proven not to bypass RLS, and payment reversals and operational recovery are defined.