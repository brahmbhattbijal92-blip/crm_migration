import 'server-only';

import { Pool, PoolClient } from 'pg';

const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 20;

function getPoolMax(): number {
  const configuredMax = process.env.DB_POOL_MAX?.trim();
  if (!configuredMax) return DEFAULT_POOL_MAX;

  const poolMax = Number(configuredMax);
  if (!Number.isSafeInteger(poolMax) || poolMax < 1 || poolMax > MAX_POOL_MAX) {
    throw new Error(`DB_POOL_MAX must be a whole number between 1 and ${MAX_POOL_MAX}.`);
  }
  return poolMax;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: getPoolMax(),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

function validateDatabaseUrl(): void {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('Database is not configured. Set DATABASE_URL in .env to a PostgreSQL connection URI.');
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URI.');
  }

  if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
  }
  if (!connectionUrl.hostname || !connectionUrl.username || !connectionUrl.password) {
    throw new Error('DATABASE_URL must include a host, username, and non-empty password.');
  }
}

/**
 * Runs your SQL queries safely enclosed in an isolated multi-tenant transaction block.
 * Ensures the row-level security (RLS) rules know who is requesting data.
 */
export async function executeTenantQuery<T>(
  organizationId: string,
  userId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  validateDatabaseUrl();
  const client = await pool.connect();
  let shouldDestroyClient = false;

  try {
    await client.query('BEGIN');

    const roleResult = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls
       FROM pg_catalog.pg_roles
       WHERE rolname = current_user`
    );
    const databaseRole = roleResult.rows[0];
    if (!databaseRole || databaseRole.rolsuper || databaseRole.rolbypassrls) {
      throw new Error('DATABASE_URL must use a non-superuser PostgreSQL role without BYPASSRLS.');
    }

    // Inject the tenant organization ID context into the session parameters
    await client.query(
      `SELECT
         set_config('request.jwt.claim.sub', $1, true),
         set_config('request.jwt.claims', $2, true),
         set_config('app.current_organization_id', $3, true)`,
      [userId, JSON.stringify({ sub: userId, role: 'authenticated' }), organizationId]
    );
    
    // Execute your business logic queries securely within the RLS sandbox container
    const result = await callback(client);
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    shouldDestroyClient = true;
    try {
      // Safely attempt rollback without overriding the base operational exception stack trace
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Database Context] Critical Error executing transaction rollback chain:', rollbackError);
    }
    throw error;
  } finally {
    // Release connection socket back into the pool line.
    // If an error occurred, destroy the connection to prevent cross-tenant parameter bleeding.
    client.release(shouldDestroyClient);
  }
}

export { pool };
