# Performance Limitations and Security

**Review date:** 2026-11-04  
**Scope:** Dashboard data fetching, schema indexes and grants, Supabase API configuration, and server-side database access.

## Summary

The dashboard currently starts seven Supabase reads in parallel when it loads or refreshes. With 100 users opening it at once, that is a burst of roughly 700 API requests, not necessarily 700 direct database connections. Several reads load every matching tenant row without pagination. The local Supabase API configuration caps returned rows at 1,000, so larger results may be incomplete unless the deployed API has a different limit and the client pages through results.

The source contains useful tenant-oriented indexes, but several do not match the leading filters and sort columns of the current list queries. No live database query plans or 100-user load test were available for this review; capacity depends on tenant row counts, database compute, connection pooling, network, and request mix.

## Current Query Load

`app/dashboard/page.tsx` loads these seven resources together with `Promise.all`: active clients, archived clients, documents, invoices, grant ledger rows, grant balances, and up to 100 notifications. One failure rejects the whole load. Most queries have no explicit page size and return data into browser state.

| Data | Current query shape | Index observation |
| --- | --- | --- |
| Active clients | Excludes `deleted_at`, orders by `updated_at DESC`, loads all rows | `clients_org_updated_idx` matches the tenant/order pattern when the RLS organization predicate is applied. |
| Archived clients | `status = archived OR deleted_at IS NOT NULL`, orders by `updated_at DESC`, loads all rows | The active-client partial index excludes many archived/deleted rows; validate a dedicated plan/index if this list grows. |
| Documents | Excludes deleted rows, orders all tenant documents by `created_at DESC` | Existing `(organization_id, client_id, created_at)` index is best when a client filter is supplied; the dashboard-wide query has no client filter. |
| Invoices | Excludes deleted rows, orders by `due_at ASC`, loads all rows | Existing `(organization_id, status, due_at)` index has `status` between tenant and sort key, while this query does not filter by status. |
| Grant ledger | Orders all tenant rows by `created_at DESC`, loads all rows | Existing `(organization_id, client_id, created_at)` index is less suitable without a client filter. |
| Grant balances | Loads all tenant balances | The primary key starts with `(organization_id, client_id, currency)`, which supports tenant-scoped access. |
| Notifications | Orders by `created_at DESC` and limits to 100 | Existing organization/created index matches this query. |

The local API setting `supabase/config.toml` specifies `max_rows = 1000`. An unpaged query can therefore silently stop at the API row cap rather than returning a complete tenant dataset. Confirm the production project's effective limit independently.

## Recommended Performance Work

1. **Page the large lists.** Start with 50-100 rows per page for clients, archived clients, documents, invoices, and grants. Use an explicit column projection, preserve the tenant RLS filters, and include a stable tie-breaker such as `id` in the ordering. Use keyset/cursor pagination for deep pages; offset/range pagination is simpler for shallow pages but gets more expensive as offsets grow.
2. **Load related data on demand.** Fetch documents, invoices, and grants for the selected client instead of loading every tenant's records during the initial dashboard render. Keep summary totals in small aggregate queries or RPCs rather than downloading a full ledger to calculate totals in the browser.
3. **Avoid all-or-nothing dashboard loading.** Load independent panels independently so a slow or failing ledger query does not block client details and other usable sections.
4. **Measure before adding indexes.** Use `EXPLAIN (ANALYZE, BUFFERS)` against representative staging data for the exact PostgREST-generated queries. Candidate indexes to evaluate are:

   - Documents: `(organization_id, created_at DESC) WHERE deleted_at IS NULL` for the tenant-wide document list; retain the client-leading index for per-client lists.
   - Invoices: `(organization_id, due_at, id) WHERE deleted_at IS NULL` for the current due-date ordering.
   - Grants: `(organization_id, created_at DESC, id)` for the tenant-wide ledger ordering.
   - Archived clients: an index matching the actual archived/deleted predicate and `updated_at` ordering, selected after inspecting the plan for the `OR` query.

   Indexes consume storage and add write cost. For large production tables, choose a deployment method that avoids long blocking index builds; do not add every candidate without plan evidence.
5. **Load-test the deployed setup.** Simulate simultaneous sign-ins/dashboard loads with realistic tenant sizes. Track p95/p99 latency, PostgREST errors, database CPU/I/O, pooler connections, and response bytes. A count of users alone cannot establish capacity.
6. **Check server-side PostgreSQL pooling.** `src/lib/db.ts` creates a `pg.Pool` per server process without explicit pool sizing or timeouts. In serverless deployments, multiple process pools can multiply connections. Use the appropriate Supabase pooler and set conservative per-instance limits based on the deployment model.

## Security and Data Exposure

### Credential vault

The active credential list requests only `id`, `client_id`, `portal_name`, and `last_verified`; it does not fetch encrypted values. However, the schema grants table-wide `SELECT`, `INSERT`, and `UPDATE` on `public.credentials_vault` to `authenticated`, and the RLS policy allows data access to authorized organization agents/admins. Because `public` is exposed through the Supabase API, an authenticated client can query `encrypted_username` and `encrypted_password` directly, or attempt direct writes that bypass the server action's validation/encryption flow.

The values are ciphertext, not plaintext, and the vault master key is server-side. This still exposes unnecessary sensitive material and broadens the write surface. Prefer removing direct authenticated insert/update privileges and exposing only the metadata columns needed by the browser (through column-level grants or a constrained view). Keep credential writes and decryption behind server-side actions. Before changing grants, verify the deployed policies and all callers.

The explicit reveal action returns plaintext to the requesting browser after a verification challenge. That is an intentional display path, not a hidden-column fetch; reveal is currently disabled outside development. The challenge and rate limit are in process-local memory, so they are not suitable for enabling production reveal across multiple instances or restarts without a shared short-lived store and real delivery provider.

### Client table

The dashboard uses explicit client-column projections, but `clients` has table-wide `SELECT` for `authenticated`. Its RLS read policy is tenant-scoped rather than column- or role-scoped. A caller using the Supabase API directly can request internal fields such as `purge_locked_at` and `purge_locked_by`, and can bypass UI filters such as `deleted_at IS NULL`. Tenant isolation still applies, but UI projections are not an authorization boundary. Decide whether all tenant roles should read archived/deleted rows and purge metadata; use column grants, a constrained API/view, or stricter policies if not.

### Other boundaries to retain

- RLS is enabled and forced in the schema, but source SQL does not prove that the deployed project has the latest migrations or effective grants. Verify policies and privileges in staging and production.
- Server actions use `DATABASE_URL`; verify its database role is not a superuser and does not have `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` does not constrain superusers or bypass roles. Keep explicit organization predicates in server SQL as defense in depth.
- The dashboard intentionally sends client PII (including email and passport/visa expiry fields) to authenticated tenant users because its UI uses those fields. Recheck each role's need-to-know access and minimize columns for screens that do not need them.
- Local mode stores records in browser storage and is not an encrypted, durable backup. Shared-device access and browser-data loss remain risks; use the documented backup limitations when deciding whether it is appropriate for regulated records.
- Storage paths and identifiers are not signed download URLs, but access to document bytes must continue to be enforced by the private bucket's storage policies.

## Verification Status

This is a source review, not a live database or load test. No capacity guarantee is made for 100 simultaneous users. Review [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the broader RLS, purge, and deployment checks, and confirm any SQL grant/index changes against the actual Supabase project before deployment.