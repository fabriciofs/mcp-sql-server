import { executeQuery } from '../db/index.js';
import { listColumnsSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: schema_list_columns
 * Search for columns across all tables
 */
export async function schemaListColumns(args: unknown): Promise<ToolResponse> {
  try {
    const { pattern, dataType, table, schema } = listColumnsSchema.parse(args);

    let query = `
      SELECT
        s.name AS [schema],
        t.name AS [table],
        c.name AS [column],
        ty.name AS [dataType],
        c.max_length AS [maxLength],
        c.precision AS [precision],
        c.scale AS [scale],
        c.is_nullable AS [isNullable],
        c.is_identity AS [isIdentity],
        ep.value AS [description]
      FROM sys.columns c
      INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      INNER JOIN sys.tables t ON c.object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      LEFT JOIN sys.extended_properties ep
        ON ep.major_id = c.object_id
        AND ep.minor_id = c.column_id
        AND ep.name = 'MS_Description'
      WHERE 1=1
    `;

    const params: Record<string, string> = {};

    if (pattern) {
      query += ` AND c.name LIKE @pattern`;
      params.pattern = pattern;
    }

    if (dataType) {
      query += ` AND ty.name = @dataType`;
      params.dataType = dataType;
    }

    if (table) {
      query += ` AND t.name = @table`;
      params.table = table;
    }

    if (schema) {
      query += ` AND s.name = @schema`;
      params.schema = schema;
    }

    query += ` ORDER BY s.name, t.name, c.column_id`;

    const result = await executeQuery(query, params, 1000);

    return formatSuccess({
      columns: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for schema_list_columns
 */
export const schemaListColumnsDefinition = {
  name: 'schema_list_columns',
  description:
    'Search for columns across all tables with optional filtering by name pattern, data type, table, and schema.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'LIKE pattern for column name (e.g., "%id%")',
      },
      dataType: {
        type: 'string',
        description: 'Filter by data type (e.g., "int", "varchar")',
      },
      table: {
        type: 'string',
        description: 'Filter by table name',
      },
      schema: {
        type: 'string',
        description: 'Filter by schema name',
      },
    },
  },
};
