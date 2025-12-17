import { executeQuery } from '../db/index.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_blocking
 * Monitor blocking sessions and lock chains
 */
export async function monitorBlocking(): Promise<ToolResponse> {
  try {
    const query = `
      WITH BlockingChain AS (
        SELECT
          r.session_id AS [blockedSessionId],
          r.blocking_session_id AS [blockingSessionId],
          r.wait_type AS [waitType],
          r.wait_time AS [waitTimeMs],
          r.wait_resource AS [waitResource],
          DB_NAME(r.database_id) AS [database],
          s.login_name AS [blockedLogin],
          s.host_name AS [blockedHost],
          SUBSTRING(t.text, (r.statement_start_offset/2)+1,
            ((CASE r.statement_end_offset
              WHEN -1 THEN DATALENGTH(t.text)
              ELSE r.statement_end_offset
            END - r.statement_start_offset)/2) + 1) AS [blockedQuery],
          0 AS [level]
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
        CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE r.blocking_session_id > 0
      )
      SELECT
        bc.*,
        bs.login_name AS [blockingLogin],
        bs.host_name AS [blockingHost],
        bs.program_name AS [blockingProgram],
        CASE WHEN br.sql_handle IS NOT NULL
          THEN (SELECT text FROM sys.dm_exec_sql_text(br.sql_handle))
          ELSE NULL
        END AS [blockingQuery]
      FROM BlockingChain bc
      LEFT JOIN sys.dm_exec_sessions bs ON bc.blockingSessionId = bs.session_id
      LEFT JOIN sys.dm_exec_requests br ON bc.blockingSessionId = br.session_id
      ORDER BY bc.waitTimeMs DESC
    `;

    const result = await executeQuery(query, {}, 100);

    // Get head blockers (sessions that are blocking others but not blocked themselves)
    const headBlockersQuery = `
      SELECT DISTINCT r.blocking_session_id AS [sessionId]
      FROM sys.dm_exec_requests r
      WHERE r.blocking_session_id > 0
        AND r.blocking_session_id NOT IN (
          SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0
        )
    `;

    const headBlockers = await executeQuery(headBlockersQuery, {}, 100);

    // Truncate long queries
    const blockingInfo = result.rows.map((row) => {
      const info = row as { blockedQuery?: string; blockingQuery?: string };
      if (info.blockedQuery && info.blockedQuery.length > 1000) {
        info.blockedQuery = info.blockedQuery.substring(0, 1000) + '... [truncated]';
      }
      if (info.blockingQuery && info.blockingQuery.length > 1000) {
        info.blockingQuery = info.blockingQuery.substring(0, 1000) + '... [truncated]';
      }
      return info;
    });

    return formatSuccess({
      blocking: blockingInfo,
      headBlockers: headBlockers.rows.map((r) => (r as { sessionId: number }).sessionId),
      count: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_blocking
 */
export const monitorBlockingDefinition = {
  name: 'monitor_blocking',
  description:
    'Monitor blocking sessions and lock chains. Shows which sessions are blocking others and identifies head blockers.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
