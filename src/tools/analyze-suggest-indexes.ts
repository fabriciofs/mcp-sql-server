import { executeQuery } from '../db/index.js';
import { suggestIndexesSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: analyze_suggest_indexes
 * Suggest missing indexes based on query analyzer
 */
export async function analyzeSuggestIndexes(args: unknown): Promise<ToolResponse> {
  try {
    const { table, minImpact, top } = suggestIndexesSchema.parse(args);

    let query = `
      SELECT TOP (@top)
        OBJECT_SCHEMA_NAME(mid.object_id) AS [schema],
        OBJECT_NAME(mid.object_id) AS [table],
        mid.equality_columns AS [equalityColumns],
        mid.inequality_columns AS [inequalityColumns],
        mid.included_columns AS [includedColumns],
        migs.unique_compiles AS [uniqueCompiles],
        migs.user_seeks AS [userSeeks],
        migs.user_scans AS [userScans],
        migs.avg_total_user_cost AS [avgTotalUserCost],
        migs.avg_user_impact AS [avgUserImpact],
        CAST(migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS DECIMAL(18,2)) AS [improvementMeasure],
        'CREATE NONCLUSTERED INDEX [IX_' + OBJECT_NAME(mid.object_id) + '_' +
          REPLACE(REPLACE(REPLACE(ISNULL(mid.equality_columns, ''), ', ', '_'), '[', ''), ']', '') +
          CASE WHEN mid.inequality_columns IS NOT NULL THEN '_' +
            REPLACE(REPLACE(REPLACE(mid.inequality_columns, ', ', '_'), '[', ''), ']', '')
          ELSE '' END +
        '] ON [' + OBJECT_SCHEMA_NAME(mid.object_id) + '].[' + OBJECT_NAME(mid.object_id) + '] (' +
          ISNULL(mid.equality_columns, '') +
          CASE WHEN mid.inequality_columns IS NOT NULL
            THEN CASE WHEN mid.equality_columns IS NOT NULL THEN ', ' ELSE '' END + mid.inequality_columns
            ELSE '' END +
        ')' +
        CASE WHEN mid.included_columns IS NOT NULL
          THEN ' INCLUDE (' + mid.included_columns + ')'
          ELSE '' END AS [suggestedIndexDDL]
      FROM sys.dm_db_missing_index_details mid
      INNER JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
      INNER JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
      WHERE mid.database_id = DB_ID()
        AND migs.avg_user_impact >= @minImpact
    `;

    const params: Record<string, string | number> = { top, minImpact };

    if (table) {
      query += ` AND OBJECT_NAME(mid.object_id) = @table`;
      params.table = table;
    }

    query += `
      ORDER BY migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) DESC
    `;

    const result = await executeQuery(query, params, top);

    // Add recommendations
    const suggestions = result.rows.map((row) => {
      const suggestion = row as {
        avgUserImpact: number;
        userSeeks: number;
        userScans: number;
        improvementMeasure: number;
      };
      return {
        ...suggestion,
        recommendation:
          suggestion.improvementMeasure > 100000
            ? 'HIGH PRIORITY - Significant performance improvement expected'
            : suggestion.improvementMeasure > 10000
              ? 'MEDIUM PRIORITY - Moderate performance improvement expected'
              : 'LOW PRIORITY - Minor performance improvement expected',
      };
    });

    return formatSuccess({
      suggestions,
      count: result.rowCount,
      note: 'These suggestions are based on the query optimizer analysis. Always test indexes in a non-production environment first.',
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for analyze_suggest_indexes
 */
export const analyzeSuggestIndexesDefinition = {
  name: 'analyze_suggest_indexes',
  description:
    'Suggest missing indexes based on query analyzer recommendations. Returns DDL statements to create suggested indexes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        description: 'Filter suggestions for a specific table',
      },
      minImpact: {
        type: 'number',
        default: 10,
        minimum: 0,
        maximum: 100,
        description: 'Minimum impact percentage to include (default: 10)',
      },
      top: {
        type: 'number',
        default: 20,
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of suggestions (default: 20)',
      },
    },
  },
};
