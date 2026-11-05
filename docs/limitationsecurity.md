# Performance Limitations and Security

**Review date:** 2026-11-04  
**Scope:** Dashboard data fetching, schema indexes and grants, Supabase API configuration, and server-side database access.

## Summary

The dashboard now pages its client lists and selected-client documents, invoices, and grants in batches of 50. It loads related records only for the selected client and obtains exact invoice/grant counts and outstanding totals through a small summary RPC. Each page query fetches one extra row to determine whether another page exists. The local Supabase API configuration caps returned rows at 1,000, so each dashboard page stays below that cap.

This changes the initial dashboard load to about eight Supabase reads per user (two client pages and notifications, followed by five selected-client reads). A simultaneous 100-user load is therefore roughly 800 API operations, not 800 direct database connections, but response rows are bounded and ledgers are no longer downloaded in full. No live query plans or 100-user load test were available; capacity still depends on tenant size, database compute, connection pooling, network, and request mix.

## Current Query Load

`app/dashboard/page.tsx` initially loads the first 50 active and archived clients plus up to 100 notifications. When a client is selected, it loads the first 50 documents, invoices, and grants for that client, that client's balances, and its aggregate financial summary. Each list has a load-more action. One failure within either `Promise.all` group still rejects that group.

| Data | Current query shape | Index observation |
| --- | --- | --- |
| Active clients | Excludes deleted rows, orders by `updated_at DESC, id DESC`, fetches 50 plus one look-ahead row | Existing `(organization_id, updated_at DESC)` partial index supports tenant ordering; verify the extra tie-breaker in the deployed plan. |
| Archived clients | `status = archived OR deleted_at IS NOT NULL`, orders by `updated_at DESC, id DESC`, fetches 50 plus one | New partial `(organization_id, updated_at DESC, id DESC)` index in the dashboard migration matches the archived/deleted predicate. |
| Documents | Selected client only, excludes deleted rows, orders by `created_at DESC, id DESC`, fetches 50 plus one | Existing `(organization_id, client_id, created_at DESC)` index supports the tenant/client filter and order. |
| Invoices | Selected client only, excludes deleted rows, orders by `due_at ASC, id ASC`, fetches 50 plus one | New `(organization_id, client_id, due_at, id)` partial covering index supports the page query and summary lookups. |
| Grant ledger | Selected client only, orders by `created_at DESC, id DESC`, fetches 50 plus one | Existing `(organization_id, client_id, created_at DESC)` index supports the main filter/order; inspect sort plans for the ID tie-breaker. |
| Grant balances | Selected client only | The primary key starts with `(organization_id, client_id, currency)`. |
| Financial summary | One selected-client aggregate RPC, returns counts and outstanding totals by currency | Uses tenant filters and RLS; invoice index includes the summary's filter and aggregate columns. |
| Notifications | Orders by `created_at DESC` and limits to 100 | Existing organization/created index matches this query; this is a latest-100 view, not a fully paged audit history. |

The archived-clients page and data-lifecycle page still use full-list service methods for their current workflows. Local mode also reads IndexedDB rows before slicing its page, so browser-side pagination bounds rendering and transfer but does not reduce the IndexedDB scan itself. The local API setting `supabase/config.toml` specifies `max_rows = 1000`; confirm the production project's effective limit independently.

## Recommended Performance Work

1. **Validate and deploy the migration.** `20261105000000_dashboard_performance_security.sql` is source only; it has not been applied to the linked project. Apply it in staging first and verify the function, grants, RLS behavior, and index definitions.
2. **Inspect query plans.** Run `EXPLAIN (ANALYZE, BUFFERS)` against representative staging data. The migration adds archived-client and selected-client invoice indexes; existing document and grant indexes should be checked for sorts and scans. Indexes add storage and write cost, so retain only indexes supported by measured plans.
3. **Consider cursor pagination for deep pages.** The current implementation uses offset/range pagination, suitable for shallow page navigation. Switch to keyset/cursor pagination if users regularly traverse deep pages or offsets become expensive.
4. **Page remaining full-list workflows.** The archived-client and data-lifecycle screens still request full lists. These require UI-level pagination that preserves retention selection and export semantics.
5. **Load-test the deployed setup.** Simulate simultaneous sign-ins/dashboard loads with realistic tenant sizes. Track p95/p99 latency, PostgREST errors, database CPU/I/O, pooler connections, and response bytes. A count of users alone cannot establish capacity.
6. **Bound server-side PostgreSQL pools.** `src/lib/db.ts` now defaults each Node.js process to at most 5 connections, with a 10-second connection-acquisition timeout and a 30-second idle timeout. Set `DB_POOL_MAX` to an integer from 1 to 20 to tune the per-process cap. In serverless deployments, total possible connections are approximately the cap multiplied by concurrent processes, so configure the Supabase pooler and deployment scaling limits accordingly.

## Security and Data Exposure

### Credential vault

The active credential list requests only `id`, `client_id`, `portal_name`, and `last_verified`; it does not fetch encrypted values. The new dashboard migration revokes table-wide authenticated access to `public.credentials_vault` and grants only the metadata columns needed by the list. Credential writes remain on server actions. This permission change is not effective in a deployed project until the migration is applied and verified.

The values are ciphertext, not plaintext, and the vault master key is server-side. Keep credential writes and decryption behind server-side actions and verify the deployed column grants before relying on this boundary.

The explicit reveal action returns plaintext to the requesting browser after a verification challenge. That is an intentional display path, not a hidden-column fetch; reveal remains disabled outside development until a real delivery provider is configured. Challenge state is stored in Upstash Redis with a five-minute TTL, verified grants expire after 30 seconds and are one-time, and an atomic Redis-time sliding window limits each user to three verification attempts per 15 minutes across instances. Redis or signing-key configuration errors fail closed.

Two challenge-state designs are supported conceptually:

- **Encrypted JWT/JWE:** The server signs and encrypts a short-lived challenge state containing the user, organization, credential, field, OTP digest, and expiry, then returns it to the client. This avoids challenge lookup state, but a token alone cannot enforce the global three-per-15-minute limit or prevent replay after successful verification; those controls still require shared state.
- **Upstash Redis (implemented):** Redis stores challenge and one-time grant keys with automatic TTLs. `GETDEL` makes consumption single-use, and one Lua operation applies the global sliding-window attempt limit. This is the recommended option for the current security requirements.

Configure `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and a stable 32-byte hex `VAULT_CHALLENGE_SECRET` on every server instance. Keep the reveal feature disabled in production until a real OTP delivery provider is integrated; the development code simulation is not a production delivery mechanism.

### Client table

The dashboard uses explicit client-column projections. The new migration replaces table-wide authenticated client privileges with column-level SELECT/INSERT/UPDATE grants, excluding `purge_locked_at` and `purge_locked_by` and preventing direct writes to status/archive timestamps. The read grant still includes `deleted_at` because current list filters use it, and tenant members can read PII required by the dashboard. Tenant isolation still depends on the RLS policy. These changes are source-only until deployed and verified.

### Other boundaries to retain

- RLS is enabled and forced in the schema, but source SQL does not prove that the deployed project has the latest migrations or effective grants. Verify policies and privileges in staging and production.
- Server actions use `DATABASE_URL`; each direct PostgreSQL transaction now rejects a superuser or `BYPASSRLS` role, and current server queries include explicit organization predicates. `FORCE ROW LEVEL SECURITY` does not constrain privileged roles; configure and verify a dedicated least-privilege database role in staging and production.
- Cloud operations now stay in the selected Cloud domain when requests fail; they do not silently write to Local storage. Cloud client reads use explicit permitted columns, and document uploads use organization/client-scoped storage paths and the `documents` metadata table.
- The dashboard intentionally sends client PII (including email and passport/visa expiry fields) to authenticated tenant users because its UI uses those fields. Recheck each role's need-to-know access and minimize columns for screens that do not need them.
- Local mode stores records in browser storage and is not an encrypted, durable backup. Shared-device access and browser-data loss remain risks; use the documented backup limitations when deciding whether it is appropriate for regulated records.
- Storage paths and identifiers are not signed download URLs, but access to document bytes must continue to be enforced by the private bucket's storage policies.

## Verification Status

This is a source review, not a live database or load test. TypeScript validation does not parse or execute PostgreSQL; local Supabase SQL lint was blocked because Postgres is not running on port `54322`. No capacity guarantee is made for 100 simultaneous users. Review [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for broader RLS, purge, and deployment checks, and verify this migration in staging before production deployment.