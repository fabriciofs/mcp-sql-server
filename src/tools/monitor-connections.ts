import { executeQuery } from '../db/index.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_connections
 * Monitor active connections to the database
 */
export async function monitorConnections(): Promise<ToolResponse> {
  try {
    // Connection summary
    const summaryQuery = `
      SELECT
        COUNT(*) AS [totalConnections],
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS [activeConnections],
        SUM(CASE WHEN status = 'sleeping' THEN 1 ELSE 0 END) AS [sleepingConnections],
        SUM(CASE WHEN is_user_process = 1 THEN 1 ELSE 0 END) AS [userConnections],
        SUM(CASE WHEN is_user_process = 0 THEN 1 ELSE 0 END) AS [systemConnections],
        COUNT(DISTINCT host_name) AS [uniqueHosts],
        COUNT(DISTINCT login_name) AS [uniqueLogins],
        COUNT(DISTINCT program_name) AS [uniquePrograms]
      FROM sys.dm_exec_sessions
    `;

    // Connections by login
    const byLoginQuery = `
      SELECT
        login_name AS [loginName],
        COUNT(*) AS [connections],
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS [active],
        MAX(last_request_end_time) AS [lastActivity]
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1
      GROUP BY login_name
      ORDER BY COUNT(*) DESC
    `;

    // Connections by host
    const byHostQuery = `
      SELECT
        ISNULL(host_name, 'N/A') AS [hostName],
        COUNT(*) AS [connections],
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS [active],
        MAX(last_request_end_time) AS [lastActivity]
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1
      GROUP BY host_name
      ORDER BY COUNT(*) DESC
    `;

    // Connections by program
    const byProgramQuery = `
      SELECT
        ISNULL(program_name, 'N/A') AS [programName],
        COUNT(*) AS [connections],
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS [active],
        MAX(last_request_end_time) AS [lastActivity]
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1
      GROUP BY program_name
      ORDER BY COUNT(*) DESC
    `;

    // Connection details
    const detailsQuery = `
      SELECT TOP 50
        s.session_id AS [sessionId],
        s.login_name AS [loginName],
        s.host_name AS [hostName],
        s.program_name AS [programName],
        s.status AS [status],
        DB_NAME(s.database_id) AS [database],
        s.cpu_time AS [cpuTimeMs],
        s.memory_usage * 8 AS [memoryKB],
        s.reads AS [reads],
        s.writes AS [writes],
        s.login_time AS [loginTime],
        s.last_request_start_time AS [lastRequestStart],
        s.last_request_end_time AS [lastRequestEnd],
        c.client_net_address AS [clientAddress],
        c.local_net_address AS [serverAddress]
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
      WHERE s.is_user_process = 1
      ORDER BY s.cpu_time DESC
    `;

    const [summary, byLogin, byHost, byProgram, details] = await Promise.all([
      executeQuery(summaryQuery, {}, 1),
      executeQuery(byLoginQuery, {}, 50),
      executeQuery(byHostQuery, {}, 50),
      executeQuery(byProgramQuery, {}, 50),
      executeQuery(detailsQuery, {}, 50),
    ]);

    return formatSuccess({
      summary: summary.rows[0],
      byLogin: byLogin.rows,
      byHost: byHost.rows,
      byProgram: byProgram.rows,
      details: details.rows,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_connections
 */
export const monitorConnectionsDefinition = {
  name: 'monitor_connections',
  description:
    'Monitor active connections to the database including summaries by login, host, and program.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
