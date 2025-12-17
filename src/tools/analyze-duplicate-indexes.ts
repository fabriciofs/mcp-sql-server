import { executeQuery } from '../db/index.js';
import { duplicateIndexesSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: analyze_duplicate_indexes
 * Find duplicate or overlapping indexes
 */
export async function analyzeDuplicateIndexes(args: unknown): Promise<ToolResponse> {
  try {
    const { table } = duplicateIndexesSchema.parse(args);

    let query = `
      WITH IndexColumns AS (
        SELECT
          i.object_id,
          i.index_id,
          i.name AS index_name,
          i.type_desc,
          i.is_unique,
          i.is_primary_key,
          (
            SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
            FROM sys.index_columns ic
            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
          ) AS key_columns,
          (
            SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY c.name)
            FROM sys.index_columns ic
            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
          ) AS included_columns
        FROM sys.indexes i
        WHERE i.type > 0
          AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
      )
      SELECT
        OBJECT_SCHEMA_NAME(ic1.object_id) AS [schema],
        OBJECT_NAME(ic1.object_id) AS [table],
        ic1.index_name AS [index1Name],
        ic1.type_desc AS [index1Type],
        ic1.key_columns AS [index1KeyColumns],
        ic1.included_columns AS [index1IncludedColumns],
        ic2.index_name AS [index2Name],
        ic2.type_desc AS [index2Type],
        ic2.key_columns AS [index2KeyColumns],
        ic2.included_columns AS [index2IncludedColumns],
        CASE
          WHEN ic1.key_columns = ic2.key_columns AND ISNULL(ic1.included_columns, '') = ISNULL(ic2.included_columns, '')
            THEN 'EXACT DUPLICATE'
          WHEN ic1.key_columns = ic2.key_columns
            THEN 'SAME KEY COLUMNS'
          WHEN ic2.key_columns LIKE ic1.key_columns + ',%'
            THEN 'SUBSET (index1 is prefix of index2)'
          WHEN ic1.key_columns LIKE ic2.key_columns + ',%'
            THEN 'SUBSET (index2 is prefix of index1)'
          ELSE 'OVERLAPPING'
        END AS [duplicateType],
        ps1.used_page_count * 8.0 / 1024 AS [index1SizeMB],
        ps2.used_page_count * 8.0 / 1024 AS [index2SizeMB]
      FROM IndexColumns ic1
      INNER JOIN IndexColumns ic2 ON ic1.object_id = ic2.object_id
        AND ic1.index_id < ic2.index_id
        AND (
          ic1.key_columns = ic2.key_columns
          OR ic2.key_columns LIKE ic1.key_columns + ',%'
          OR ic1.key_columns LIKE ic2.key_columns + ',%'
        )
      INNER JOIN sys.dm_db_partition_stats ps1 ON ic1.object_id = ps1.object_id AND ic1.index_id = ps1.index_id
      INNER JOIN sys.dm_db_partition_stats ps2 ON ic2.object_id = ps2.object_id AND ic2.index_id = ps2.index_id
      WHERE 1=1
    `;

    const params: Record<string, string> = {};

    if (table) {
      query += ` AND OBJECT_NAME(ic1.object_id) = @table`;
      params.table = table;
    }

    query += `
      ORDER BY OBJECT_SCHEMA_NAME(ic1.object_id), OBJECT_NAME(ic1.object_id), ic1.index_name
    `;

    const result = await executeQuery(query, params, 100);

    // Calculate potential space savings
    const duplicates = result.rows.map((row) => {
      const r = row as {
        duplicateType: string;
        index1SizeMB: number;
        index2SizeMB: number;
        index1Name: string;
        index2Name: string;
      };
      return {
        ...r,
        recommendation:
          r.duplicateType === 'EXACT DUPLICATE'
            ? `Consider dropping one of these indexes. Suggested: DROP INDEX [${r.index2Name}]`
            : r.duplicateType === 'SAME KEY COLUMNS'
              ? 'Consider consolidating these indexes if possible'
              : r.duplicateType.startsWith('SUBSET')
                ? 'The larger index may cover queries for the smaller one'
                : 'Review if both indexes are necessary',
      };
    });

    const totalDuplicateSizeMB = duplicates.reduce((sum, row) => {
      if (row.duplicateType === 'EXACT DUPLICATE') {
        return sum + Math.min(row.index1SizeMB || 0, row.index2SizeMB || 0);
      }
      return sum;
    }, 0);

    return formatSuccess({
      duplicateIndexes: duplicates,
      count: result.rowCount,
      potentialSpaceSavingsMB: Math.round(totalDuplicateSizeMB * 100) / 100,
      note: 'Duplicate indexes waste space and slow down writes. Consider consolidating or removing redundant indexes.',
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for analyze_duplicate_indexes
 */
export const analyzeDuplicateIndexesDefinition = {
  name: 'analyze_duplicate_indexes',
  description:
    'Find duplicate or overlapping indexes that could be consolidated or removed.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        description: 'Filter for a specific table',
      },
    },
  },
};
