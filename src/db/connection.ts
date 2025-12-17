import sql from 'mssql';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ConnectionError } from '../utils/errors.js';

/**
 * Singleton connection pool
 */
let pool: sql.ConnectionPool | null = null;

/**
 * SQL Server configuration
 */
const sqlConfig: sql.config = {
  user: config.SQL_USER,
  password: config.SQL_PASSWORD,
  server: config.SQL_SERVER,
  database: config.SQL_DATABASE,
  port: config.SQL_PORT,
  options: {
    encrypt: config.SQL_ENCRYPT,
    trustServerCertificate: config.SQL_TRUST_CERT,
    enableArithAbort: true,
  },
  pool: {
    min: config.POOL_MIN,
    max: config.POOL_MAX,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: config.QUERY_TIMEOUT,
};

/**
 * Get the connection pool (creates if not exists)
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) {
    return pool;
  }

  try {
    logger.info('Connecting to SQL Server', {
      server: config.SQL_SERVER,
      database: config.SQL_DATABASE,
      port: config.SQL_PORT,
    });

    pool = await sql.connect(sqlConfig);

    logger.info('Connected to SQL Server successfully');

    // Handle pool errors
    pool.on('error', (err) => {
      logger.error('Connection pool error', { error: err.message });
    });

    return pool;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown connection error';
    logger.error('Failed to connect to SQL Server', { error: message });
    throw new ConnectionError(`Failed to connect to SQL Server: ${message}`);
  }
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
      pool = null;
      logger.info('Connection pool closed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error closing connection pool', { error: message });
    }
  }
}

/**
 * Check if the pool is connected
 */
export function isConnected(): boolean {
  return pool?.connected ?? false;
}

/**
 * Get pool statistics
 */
export function getPoolStats(): { min: number; max: number; connected: boolean } {
  return {
    min: config.POOL_MIN,
    max: config.POOL_MAX,
    connected: pool?.connected ?? false,
  };
}

// Re-export sql for type usage
export { sql };
