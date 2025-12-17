import { executeQuery } from '../db/index.js';
import { activeQueriesSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_active_queries
 * Monitor currently running queries
 */
export async function monitorActiveQueries(args: unknown): Promise<ToolResponse> {
  try {
    const { minDurationMs, includeSystemQueries } = activeQueriesSchema.parse(args);

    const query = `
      SELECT
        r.session_id AS [sessionId],
        r.request_id AS [requestId],
        r.status AS [status],
        r.command AS [command],
        DB_NAME(r.database_id) AS [database],
        r.wait_type AS [waitType],
        r.wait_time AS [waitTimeMs],
        r.blocking_session_id AS [blockingSessionId],
        r.cpu_time AS [cpuTimeMs],
        r.total_elapsed_time AS [elapsedTimeMs],
        r.reads AS [reads],
        r.writes AS [writes],
        r.logical_reads AS [logicalReads],
        r.row_count AS [rowCount],
        r.percent_complete AS [percentComplete],
        CAST(r.estimated_completion_time / 1000.0 AS DECIMAL(18,2)) AS [estimatedCompletionSec],
        s.login_name AS [loginName],
        s.host_name AS [hostName],
        s.program_name AS [programName],
        SUBSTRING(t.text, (r.statement_start_offset/2)+1,
          ((CASE r.statement_end_offset
            WHEN -1 THEN DATALENGTH(t.text)
            ELSE r.statement_end_offset
          END - r.statement_start_offset)/2) + 1) AS [currentStatement],
        t.text AS [fullQuery]
      FROM sys.dm_exec_requests r
      INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
      CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE r.session_id <> @@SPID
        AND r.total_elapsed_time >= @minDurationMs
        ${includeSystemQueries ? '' : "AND s.is_user_process = 1"}
      ORDER BY r.total_elapsed_time DESC
    `;

    const result = await executeQuery(query, { minDurationMs }, 100);

    // Truncate long queries
    const queries = result.rows.map((row) => {
      const query = row as { fullQuery?: string; currentStatement?: string };
      if (query.fullQuery && query.fullQuery.length > 2000) {
        query.fullQuery = query.fullQuery.substring(0, 2000) + '... [truncated]';
      }
      if (query.currentStatement && query.currentStatement.length > 1000) {
        query.currentStatement = query.currentStatement.substring(0, 1000) + '... [truncated]';
      }
      return query;
    });

    return formatSuccess({
      activeQueries: queries,
      count: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_active_queries
 */
export const monitorActiveQueriesDefinition = {
  name: 'monitor_active_queries',
  description:
    'Monitor currently running queries with execution statistics, wait info, and blocking information.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      minDurationMs: {
        type: 'number',
        default: 0,
        description: 'Filter queries with minimum duration in milliseconds',
      },
      includeSystemQueries: {
        type: 'boolean',
        default: false,
        description: 'Include system queries (default: false)',
      },
    },
  },
};
