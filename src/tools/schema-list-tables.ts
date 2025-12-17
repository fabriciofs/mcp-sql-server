import { executeQuery } from '../db/index.js';
import { listTablesSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: schema_list_tables
 * List tables and views in the database
 */
export async function schemaListTables(args: unknown): Promise<ToolResponse> {
  try {
    const { schema, type, pattern } = listTablesSchema.parse(args);

    let query = `
      SELECT
        s.name AS [schema],
        t.name AS [name],
        CASE WHEN t.type = 'U' THEN 'TABLE' ELSE 'VIEW' END AS [type],
        p.rows AS [rowCount],
        CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [sizeMB],
        t.create_date AS [createdAt],
        t.modify_date AS [modifiedAt]
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
      LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE 1=1
    `;

    const params: Record<string, string> = {};

    if (type === 'TABLE') {
      query += ` AND t.type = 'U'`;
    } else if (type === 'VIEW') {
      query = query.replace('sys.tables t', 'sys.views t');
      query = query.replace("t.type = 'U'", "1=1");
      query = query.replace("CASE WHEN t.type = 'U' THEN 'TABLE' ELSE 'VIEW' END", "'VIEW'");
    }

    if (schema) {
      query += ` AND s.name = @schema`;
      params.schema = schema;
    }

    if (pattern) {
      query += ` AND t.name LIKE @pattern`;
      params.pattern = pattern;
    }

    query += `
      GROUP BY s.name, t.name, t.type, p.rows, t.create_date, t.modify_date
      ORDER BY s.name, t.name
    `;

    // For ALL type, union tables and views
    if (type === 'ALL') {
      query = `
        SELECT
          s.name AS [schema],
          t.name AS [name],
          'TABLE' AS [type],
          p.rows AS [rowCount],
          CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [sizeMB],
          t.create_date AS [createdAt],
          t.modify_date AS [modifiedAt]
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
        LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
        WHERE 1=1
        ${schema ? ' AND s.name = @schema' : ''}
        ${pattern ? ' AND t.name LIKE @pattern' : ''}
        GROUP BY s.name, t.name, p.rows, t.create_date, t.modify_date

        UNION ALL

        SELECT
          s.name AS [schema],
          v.name AS [name],
          'VIEW' AS [type],
          NULL AS [rowCount],
          NULL AS [sizeMB],
          v.create_date AS [createdAt],
          v.modify_date AS [modifiedAt]
        FROM sys.views v
        INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
        WHERE 1=1
        ${schema ? ' AND s.name = @schema' : ''}
        ${pattern ? ' AND v.name LIKE @pattern' : ''}
        ORDER BY [schema], [name]
      `;
    }

    const result = await executeQuery(query, params, 1000);

    return formatSuccess({
      tables: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for schema_list_tables
 */
export const schemaListTablesDefinition = {
  name: 'schema_list_tables',
  description:
    'List all tables and views in the database with optional filtering by schema, type, and name pattern.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      schema: {
        type: 'string',
        description: 'Filter by schema name (e.g., "dbo")',
      },
      type: {
        type: 'string',
        enum: ['TABLE', 'VIEW', 'ALL'],
        default: 'ALL',
        description: 'Filter by object type: TABLE, VIEW, or ALL',
      },
      pattern: {
        type: 'string',
        description: 'LIKE pattern for table name (e.g., "%user%")',
      },
    },
  },
};
