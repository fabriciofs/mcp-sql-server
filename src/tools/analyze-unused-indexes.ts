import { executeQuery } from '../db/index.js';
import { unusedIndexesSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: analyze_unused_indexes
 * Find indexes that are not being used
 */
export async function analyzeUnusedIndexes(args: unknown): Promise<ToolResponse> {
  try {
    const { table, minSizeMB, minAgeDays } = unusedIndexesSchema.parse(args);

    let query = `
      SELECT
        OBJECT_SCHEMA_NAME(i.object_id) AS [schema],
        OBJECT_NAME(i.object_id) AS [table],
        i.name AS [indexName],
        i.type_desc AS [type],
        i.is_unique AS [isUnique],
        i.is_primary_key AS [isPrimaryKey],
        ps.row_count AS [rowCount],
        CAST(ROUND(ps.used_page_count * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [sizeMB],
        ISNULL(ius.user_seeks, 0) AS [seeks],
        ISNULL(ius.user_scans, 0) AS [scans],
        ISNULL(ius.user_lookups, 0) AS [lookups],
        ISNULL(ius.user_updates, 0) AS [updates],
        ius.last_user_seek AS [lastSeek],
        ius.last_user_scan AS [lastScan],
        ius.last_user_lookup AS [lastLookup],
        STATS_DATE(i.object_id, i.index_id) AS [statsDate],
        DATEDIFF(DAY, ISNULL(
          CASE
            WHEN ius.last_user_seek IS NOT NULL AND ius.last_user_scan IS NOT NULL
              THEN CASE WHEN ius.last_user_seek > ius.last_user_scan THEN ius.last_user_seek ELSE ius.last_user_scan END
            WHEN ius.last_user_seek IS NOT NULL THEN ius.last_user_seek
            WHEN ius.last_user_scan IS NOT NULL THEN ius.last_user_scan
            ELSE DATEADD(DAY, -365, GETDATE())
          END,
          DATEADD(DAY, -365, GETDATE())
        ), GETDATE()) AS [daysSinceLastUse],
        'DROP INDEX [' + i.name + '] ON [' + OBJECT_SCHEMA_NAME(i.object_id) + '].[' + OBJECT_NAME(i.object_id) + ']' AS [dropDDL]
      FROM sys.indexes i
      INNER JOIN sys.dm_db_partition_stats ps ON i.object_id = ps.object_id AND i.index_id = ps.index_id
      LEFT JOIN sys.dm_db_index_usage_stats ius ON i.object_id = ius.object_id AND i.index_id = ius.index_id AND ius.database_id = DB_ID()
      WHERE i.type > 0  -- Exclude heaps
        AND i.is_primary_key = 0
        AND i.is_unique_constraint = 0
        AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
        AND ISNULL(ius.user_seeks, 0) + ISNULL(ius.user_scans, 0) + ISNULL(ius.user_lookups, 0) = 0
        AND ps.used_page_count * 8.0 / 1024 >= @minSizeMB
    `;

    const params: Record<string, string | number> = { minSizeMB, minAgeDays };

    if (table) {
      query += ` AND OBJECT_NAME(i.object_id) = @table`;
      params.table = table;
    }

    query += `
      ORDER BY ps.used_page_count DESC
    `;

    const result = await executeQuery(query, params, 100);

    // Calculate potential space savings
    const totalSizeMB = result.rows.reduce((sum, row) => {
      const r = row as { sizeMB: number };
      return sum + (r.sizeMB || 0);
    }, 0);

    return formatSuccess({
      unusedIndexes: result.rows,
      count: result.rowCount,
      potentialSpaceSavingsMB: Math.round(totalSizeMB * 100) / 100,
      note: 'These indexes have not been used for seeks, scans, or lookups. Consider dropping them to save space and improve write performance. Always verify in a non-production environment first.',
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for analyze_unused_indexes
 */
export const analyzeUnusedIndexesDefinition = {
  name: 'analyze_unused_indexes',
  description:
    'Find indexes that are not being used and could be dropped to save space and improve write performance.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        description: 'Filter for a specific table',
      },
      minSizeMB: {
        type: 'number',
        default: 1,
        minimum: 0,
        description: 'Minimum index size in MB (default: 1)',
      },
      minAgeDays: {
        type: 'number',
        default: 30,
        minimum: 0,
        description: 'Minimum days since last use (default: 30)',
      },
    },
  },
};
