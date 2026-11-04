import { Pool, PoolClient } from 'pg';

// Initialize a shared, global database connection engine pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  validateDatabaseUrl();
  const client = await pool.connect();
  let shouldDestroyClient = false;

  try {
    await client.query('BEGIN');
    
    // Inject the tenant organization ID context into the session parameters
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_organization_id',
      organizationId,
    ]);
    
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
