import { executeQuery } from '../db/index.js';
import { listProceduresSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: schema_list_procedures
 * List stored procedures in the database
 */
export async function schemaListProcedures(args: unknown): Promise<ToolResponse> {
  try {
    const { schema, pattern } = listProceduresSchema.parse(args);

    let query = `
      SELECT
        s.name AS [schema],
        p.name AS [name],
        p.type_desc AS [type],
        p.create_date AS [createdAt],
        p.modify_date AS [modifiedAt],
        (
          SELECT COUNT(*)
          FROM sys.parameters param
          WHERE param.object_id = p.object_id
        ) AS [parameterCount],
        OBJECT_DEFINITION(p.object_id) AS [definition]
      FROM sys.procedures p
      INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
      WHERE 1=1
    `;

    const params: Record<string, string> = {};

    if (schema) {
      query += ` AND s.name = @schema`;
      params.schema = schema;
    }

    if (pattern) {
      query += ` AND p.name LIKE @pattern`;
      params.pattern = pattern;
    }

    query += ` ORDER BY s.name, p.name`;

    const result = await executeQuery(query, params, 500);

    // Truncate definition to avoid huge responses
    const procedures = result.rows.map((row) => {
      const proc = row as { definition?: string };
      if (proc.definition && proc.definition.length > 2000) {
        proc.definition = proc.definition.substring(0, 2000) + '... [truncated]';
      }
      return proc;
    });

    return formatSuccess({
      procedures,
      count: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for schema_list_procedures
 */
export const schemaListProceduresDefinition = {
  name: 'schema_list_procedures',
  description:
    'List stored procedures in the database with optional filtering by schema and name pattern.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      schema: {
        type: 'string',
        description: 'Filter by schema name (e.g., "dbo")',
      },
      pattern: {
        type: 'string',
        description: 'LIKE pattern for procedure name',
      },
    },
  },
};
