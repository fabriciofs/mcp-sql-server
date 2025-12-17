import { executeQuery } from '../db/index.js';
import { fragmentationSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: analyze_fragmentation
 * Analyze index fragmentation
 */
export async function analyzeFragmentation(args: unknown): Promise<ToolResponse> {
  try {
    const { table, minFragmentation, minPageCount } = fragmentationSchema.parse(args);

    let query = `
      SELECT
        OBJECT_SCHEMA_NAME(ips.object_id) AS [schema],
        OBJECT_NAME(ips.object_id) AS [table],
        i.name AS [indexName],
        i.type_desc AS [indexType],
        ips.partition_number AS [partition],
        ips.index_type_desc AS [indexTypeDesc],
        ips.alloc_unit_type_desc AS [allocationType],
        CAST(ips.avg_fragmentation_in_percent AS DECIMAL(5,2)) AS [fragmentationPercent],
        ips.fragment_count AS [fragmentCount],
        ips.avg_fragment_size_in_pages AS [avgFragmentSizePages],
        ips.page_count AS [pageCount],
        CAST(ips.page_count * 8.0 / 1024 AS DECIMAL(18,2)) AS [sizeMB],
        ips.avg_page_space_used_in_percent AS [avgPageSpaceUsedPercent],
        ips.record_count AS [recordCount],
        ips.ghost_record_count AS [ghostRecordCount],
        ips.forwarded_record_count AS [forwardedRecordCount],
        CASE
          WHEN ips.avg_fragmentation_in_percent < 10 THEN 'OK - No action needed'
          WHEN ips.avg_fragmentation_in_percent < 30 THEN 'REORGANIZE recommended'
          ELSE 'REBUILD recommended'
        END AS [recommendation],
        CASE
          WHEN ips.avg_fragmentation_in_percent >= 30 THEN
            'ALTER INDEX [' + i.name + '] ON [' + OBJECT_SCHEMA_NAME(ips.object_id) + '].[' + OBJECT_NAME(ips.object_id) + '] REBUILD WITH (ONLINE = ON)'
          WHEN ips.avg_fragmentation_in_percent >= 10 THEN
            'ALTER INDEX [' + i.name + '] ON [' + OBJECT_SCHEMA_NAME(ips.object_id) + '].[' + OBJECT_NAME(ips.object_id) + '] REORGANIZE'
          ELSE NULL
        END AS [maintenanceDDL]
      FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
      INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
      WHERE ips.avg_fragmentation_in_percent >= @minFragmentation
        AND ips.page_count >= @minPageCount
        AND ips.index_id > 0
        AND OBJECTPROPERTY(ips.object_id, 'IsUserTable') = 1
    `;

    const params: Record<string, string | number> = { minFragmentation, minPageCount };

    if (table) {
      query += ` AND OBJECT_NAME(ips.object_id) = @table`;
      params.table = table;
    }

    query += `
      ORDER BY ips.avg_fragmentation_in_percent DESC
    `;

    const result = await executeQuery(query, params, 100);

    // Categorize by fragmentation level
    const summary = {
      needsRebuild: 0,
      needsReorganize: 0,
      ok: 0,
    };

    result.rows.forEach((row) => {
      const r = row as { fragmentationPercent: number };
      if (r.fragmentationPercent >= 30) {
        summary.needsRebuild++;
      } else if (r.fragmentationPercent >= 10) {
        summary.needsReorganize++;
      } else {
        summary.ok++;
      }
    });

    return formatSuccess({
      fragmentation: result.rows,
      count: result.rowCount,
      summary,
      thresholds: {
        rebuild: '30% or higher',
        reorganize: '10% to 30%',
        ok: 'Below 10%',
      },
      note: 'REBUILD operations are more thorough but can be resource-intensive. REORGANIZE is less intrusive but may not fully defragment.',
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for analyze_fragmentation
 */
export const analyzeFragmentationDefinition = {
  name: 'analyze_fragmentation',
  description:
    'Analyze index fragmentation levels and get maintenance recommendations (REBUILD or REORGANIZE).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        description: 'Filter for a specific table',
      },
      minFragmentation: {
        type: 'number',
        default: 10,
        minimum: 0,
        maximum: 100,
        description: 'Minimum fragmentation percentage (default: 10)',
      },
      minPageCount: {
        type: 'number',
        default: 1000,
        minimum: 1,
        description: 'Minimum page count (default: 1000)',
      },
    },
  },
};
