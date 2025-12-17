import { executeQuery } from '../db/index.js';
import { describeTableSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: schema_describe_table
 * Get detailed information about a table's structure
 */
export async function schemaDescribeTable(args: unknown): Promise<ToolResponse> {
  try {
    const { table, schema } = describeTableSchema.parse(args);

    // Get columns with detailed info
    const columnsQuery = `
      SELECT
        c.name AS [name],
        t.name AS [dataType],
        c.max_length AS [maxLength],
        c.precision AS [precision],
        c.scale AS [scale],
        c.is_nullable AS [isNullable],
        c.is_identity AS [isIdentity],
        c.is_computed AS [isComputed],
        OBJECT_DEFINITION(c.default_object_id) AS [defaultValue],
        ep.value AS [description]
      FROM sys.columns c
      INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
      INNER JOIN sys.tables tbl ON c.object_id = tbl.object_id
      INNER JOIN sys.schemas s ON tbl.schema_id = s.schema_id
      LEFT JOIN sys.extended_properties ep
        ON ep.major_id = c.object_id
        AND ep.minor_id = c.column_id
        AND ep.name = 'MS_Description'
      WHERE tbl.name = @table
        AND s.name = @schema
      ORDER BY c.column_id
    `;

    // Get primary key columns
    const pkQuery = `
      SELECT
        c.name AS [column]
      FROM sys.index_columns ic
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE i.is_primary_key = 1
        AND t.name = @table
        AND s.name = @schema
      ORDER BY ic.key_ordinal
    `;

    // Get foreign keys
    const fkQuery = `
      SELECT
        fk.name AS [name],
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS [column],
        OBJECT_SCHEMA_NAME(fkc.referenced_object_id) AS [referencedSchema],
        OBJECT_NAME(fkc.referenced_object_id) AS [referencedTable],
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS [referencedColumn]
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.name = @table
        AND s.name = @schema
    `;

    // Get indexes
    const indexQuery = `
      SELECT
        i.name AS [name],
        i.type_desc AS [type],
        i.is_unique AS [isUnique],
        i.is_primary_key AS [isPrimaryKey],
        STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS [columns]
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.name = @table
        AND s.name = @schema
        AND i.name IS NOT NULL
      GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
    `;

    // Get table stats
    const statsQuery = `
      SELECT
        p.rows AS [rowCount],
        CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [sizeMB],
        t.create_date AS [createdAt],
        t.modify_date AS [modifiedAt]
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
      LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE t.name = @table
        AND s.name = @schema
      GROUP BY p.rows, t.create_date, t.modify_date
    `;

    const params = { table, schema };

    const [columns, pk, fk, indexes, stats] = await Promise.all([
      executeQuery(columnsQuery, params, 500),
      executeQuery(pkQuery, params, 50),
      executeQuery(fkQuery, params, 100),
      executeQuery(indexQuery, params, 100),
      executeQuery(statsQuery, params, 1),
    ]);

    return formatSuccess({
      schema,
      table,
      columns: columns.rows,
      primaryKey: pk.rows.map((r) => (r as { column: string }).column),
      foreignKeys: fk.rows,
      indexes: indexes.rows,
      stats: stats.rows[0] || null,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for schema_describe_table
 */
export const schemaDescribeTableDefinition = {
  name: 'schema_describe_table',
  description:
    'Get detailed information about a table including columns, primary key, foreign keys, indexes, and statistics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        description: 'Table name to describe',
      },
      schema: {
        type: 'string',
        default: 'dbo',
        description: 'Schema name (default: dbo)',
      },
    },
    required: ['table'],
  },
};
