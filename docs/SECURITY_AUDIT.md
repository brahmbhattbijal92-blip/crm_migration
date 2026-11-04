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

**Remaining action:** Add a separately authorized void/reversal workflow before allowing invoices to be voided. Test concurrent payment and purge calls in staging.

### High: Direct PostgreSQL access is safe only with a non-bypass role

`executeTenantQuery` sets `app.current_organization_id` from the server-validated organization inside a transaction. The RLS helper returns this setting when `auth.uid()` is null, as it is for a direct PostgreSQL connection. `getClients` also queries clients without an explicit organization predicate and relies on RLS. `FORCE ROW LEVEL SECURITY` does not constrain superusers or roles with `BYPASSRLS`.

**Impact:** If `DATABASE_URL` uses a Supabase owner, superuser, or other bypass role, raw server-action queries may read or mutate across tenants despite the transaction setting.

**Recommendation:** Use a dedicated least-privilege database role with `NOBYPASSRLS`, never the `postgres` owner for application queries. Verify the deployed role's `rolsuper` and `rolbypassrls` flags. Add explicit `organization_id` predicates to server SQL as defense in depth and test cross-tenant access with the actual production role.

### Addressed in source: Purge lock and document-write race

The schema now serializes document metadata writes against client row locks, rejects document metadata for archived/deleted/purge-locked clients, and validates both organization and client in the storage path. Storage writes require an editable role; object deletion is admin-only. The Cloud upload flow removes the uploaded object if metadata creation fails.

**Remaining action:** The storage object and SQL metadata operations are still separate systems. Add a durable purge job with retries and orphan-object reconciliation before handling large numbers of documents.

### Addressed in source: Archive timestamp tampering

Direct authenticated client updates no longer include status, archive timestamp, or deletion timestamp. Archive and restore use role-checked functions, and both purge claim and finalization check the 90-day retention period.

**Remaining action:** Validate function ownership and execution against RLS in the live project. Add an immutable archive event log if regulatory auditability is required.

### Medium: Notification rows allow broader edits than the UI needs

The notification UPDATE policy restricts which recipient can update a row, but the table grant is for all columns. A recipient can potentially alter fields beyond `read_at`, including message or delivery metadata, while keeping the row assigned to themselves and inside the same organization.

**Recommendation:** Grant UPDATE only on `read_at`, and use a `WITH CHECK` policy that preserves immutable notification fields.

### Medium: Organization and profile UPDATE grants are broader than necessary

Authenticated users receive table-wide UPDATE on their own profile, including `default_organization_id`; organization admins receive table-wide UPDATE on their organization row. Membership checks prevent an arbitrary default organization from granting access by themselves, but these grants still allow unnecessary changes and can break a user's active organization selection.

**Recommendation:** Grant only the columns required by each UI operation. Validate that a new default organization is an existing membership. Limit organization updates to approved fields such as `name`.

### Medium: Local records are not a durable or device-protected backup

Local records are stored in browser storage, scoped by signed-in user. They are not encrypted with a device key, do not sync, and can be lost when browser site data is removed or the browser evicts storage. The full Local backup/export feature is not implemented. Legacy anonymous Local records are not automatically imported into the new user-scoped store.

**Recommendation:** Treat Local Mode as convenience storage, not the only copy of regulated financial records. Implement and test a versioned backup/restore flow before promoting Local Mode for important data.

## RLS Coverage Snapshot

The schema includes RLS enablement and tenant policies for `organizations`, `profiles`, `organization_memberships`, `clients`, `documents`, `credentials_vault`, `financial_invoices`, `financial_invoice_payments`, `grants_ledger`, `client_grant_balances`, and `governance_notifications`. The `client-documents` bucket is private and has organization/client path policies on `storage.objects`.

No intentional anon read policy for application rows was found in the schema. However, the grant ledger still has an INSERT policy even though direct INSERT is revoked from `authenticated`; remove the stale policy to make the intended RPC-only write path clearer. Confirm effective privileges in the deployed database because SQL privileges can differ from this file.

## Scaling and Architecture Limits

- **Database connection growth:** `src/lib/db.ts` creates a `pg.Pool` per server process with no explicit size, timeouts, or pooler configuration. Serverless instance multiplication can exhaust PostgreSQL connections. Use Supabase's appropriate pooler and set a conservative per-instance connection limit.
- **Unbounded reads:** Several dashboard services load all clients, invoices, grants, and documents into the browser. Supabase/PostgREST row limits and browser memory become practical limits. Add pagination, server-side filtering, and summary queries before tenant datasets grow.
- **Single active organization:** A profile has one `default_organization_id`. Memberships support more than one organization, but there is no organization switcher or explicit active-organization session model.
- **Financial hot rows:** Grant allocation and invoice settlement lock the client row to prevent double spending. This is correct for consistency, but a client with many simultaneous transactions becomes a serialization point.
- **Growing ledgers and storage:** Grant, invoice, notification, and object-storage records accumulate. Define retention, archival, object cleanup, and operational monitoring before high volume; partition only after measured growth warrants it.
- **In-memory vault challenges:** OTP challenges and rate limits live in a process-local `Map` with a per-process signing key. They do not survive restarts or work reliably across multiple instances. Reveal is disabled outside development today; production reveal needs a shared short-lived store, provider-backed delivery, and user-bound challenges.
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