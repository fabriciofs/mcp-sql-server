import { getPool, sql } from './connection.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateQuery } from '../validators/query-validator.js';
import {
  QueryValidationError,
  ReadOnlyViolationError,
  TimeoutError,
  getErrorMessage,
} from '../utils/errors.js';
import type { QueryResult, SqlParamValue } from '../types.js';

/**
 * SQL parameter types mapping
 */
function getSqlType(value: SqlParamValue): sql.ISqlTypeFactoryWithNoParams {
  if (value === null) {
    return sql.NVarChar;
  }
  if (typeof value === 'string') {
    return sql.NVarChar;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? sql.BigInt : sql.Float;
  }
  if (typeof value === 'boolean') {
    return sql.Bit;
  }
  return sql.NVarChar;
}

/**
 * Execute a SQL query with parameters
 *
 * @param query SQL query with @param placeholders
 * @param params Named parameters (without @)
 * @param maxRows Maximum rows to return
 * @returns Query result with rows and metadata
 */
export async function executeQuery(
  query: string,
  params: Record<string, SqlParamValue> = {},
  maxRows: number = 100
): Promise<QueryResult> {
  const startTime = Date.now();

  // Validate query in READONLY mode
  if (config.READONLY) {
    const validation = validateQuery(query);
    if (!validation.valid) {
      throw new QueryValidationError(validation.reason || 'Query validation failed');
    }
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    // Add parameters
    for (const [name, value] of Object.entries(params)) {
      const sqlType = getSqlType(value);
      request.input(name, sqlType, value);
    }

    // Execute query
    const result = await request.query(query);

    const duration = Date.now() - startTime;

    // Get rows (handle multiple result sets)
    const rows = result.recordset || [];
    const totalRows = rows.length;

    // Apply maxRows limit
    const limitedRows = rows.slice(0, maxRows);

    logger.debug('Query executed', {
      rowsReturned: limitedRows.length,
      totalRows,
      duration,
      readonly: config.READONLY,
    });

    // Extract column information
    const fields = result.recordset?.columns
      ? Object.entries(result.recordset.columns).map(([name, col]) => ({
          name,
          type: (col as { type?: { name?: string } }).type?.name || 'unknown',
        }))
      : [];

    return {
      rows: limitedRows,
      rowCount: totalRows,
      fields,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = getErrorMessage(error);

    logger.error('Query execution failed', {
      error: message,
      duration,
      query: query.substring(0, 200),
    });

    // Handle specific SQL Server errors
    if (message.includes('timeout') || message.includes('Timeout')) {
      throw new TimeoutError(duration);
    }

    throw error;
  }
}

/**
 * Execute a write operation (INSERT, UPDATE, DELETE)
 * Only allowed when READONLY is false
 *
 * @param query SQL query
 * @param params Named parameters
 * @returns Number of affected rows
 */
export async function executeWrite(
  query: string,
  params: Record<string, SqlParamValue> = {}
): Promise<{ affectedRows: number; duration: number }> {
  if (config.READONLY) {
    throw new ReadOnlyViolationError('Write operations are not allowed in READONLY mode');
  }

  const startTime = Date.now();

  try {
    const pool = await getPool();
    const request = pool.request();

    // Add parameters
    for (const [name, value] of Object.entries(params)) {
      const sqlType = getSqlType(value);
      request.input(name, sqlType, value);
    }

    // Execute query
    const result = await request.query(query);

    const duration = Date.now() - startTime;

    logger.info('Write operation executed', {
      affectedRows: result.rowsAffected[0] || 0,
      duration,
    });

    return {
      affectedRows: result.rowsAffected[0] || 0,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = getErrorMessage(error);

    logger.error('Write operation failed', {
      error: message,
      duration,
      query: query.substring(0, 200),
    });

    throw error;
  }
}

/**
 * Execute a query that returns a single scalar value
 */
export async function executeScalar<T>(
  query: string,
  params: Record<string, SqlParamValue> = {}
): Promise<T | null> {
  const result = await executeQuery(query, params, 1);

  if (result.rows.length === 0) {
    return null;
  }

  const firstRow = result.rows[0] as Record<string, unknown>;
  const keys = Object.keys(firstRow);

  if (keys.length === 0) {
    return null;
  }

  return firstRow[keys[0]] as T;
}

/**
 * Build a parameterized INSERT query
 */
export function buildInsertQuery(
  schema: string,
  table: string,
  data: Record<string, SqlParamValue>
): { query: string; params: Record<string, SqlParamValue> } {
  const columns = Object.keys(data);
  const paramNames = columns.map((col) => `@${col}`);

  const query = `
    INSERT INTO [${schema}].[${table}] ([${columns.join('], [')}])
    VALUES (${paramNames.join(', ')});
    SELECT SCOPE_IDENTITY() AS insertedId;
  `;

  return { query, params: data };
}

/**
 * Build a parameterized UPDATE query
 */
export function buildUpdateQuery(
  schema: string,
  table: string,
  data: Record<string, SqlParamValue>,
  whereClause: string,
  whereParams: Record<string, SqlParamValue>
): { query: string; params: Record<string, SqlParamValue> } {
  const setClause = Object.keys(data)
    .map((col) => `[${col}] = @${col}`)
    .join(', ');

  const query = `
    UPDATE [${schema}].[${table}]
    SET ${setClause}
    WHERE ${whereClause};
    SELECT @@ROWCOUNT AS affectedRows;
  `;

  return { query, params: { ...data, ...whereParams } };
}

/**
 * Build a parameterized DELETE query
 */
export function buildDeleteQuery(
  schema: string,
  table: string,
  whereClause: string,
  whereParams: Record<string, SqlParamValue>
): { query: string; params: Record<string, SqlParamValue> } {
  const query = `
    DELETE FROM [${schema}].[${table}]
    WHERE ${whereClause};
    SELECT @@ROWCOUNT AS affectedRows;
  `;

  return { query, params: whereParams };
}
