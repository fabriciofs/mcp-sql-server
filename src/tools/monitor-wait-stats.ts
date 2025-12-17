import { executeQuery } from '../db/index.js';
import { waitStatsSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_wait_stats
 * Monitor wait statistics
 */
export async function monitorWaitStats(args: unknown): Promise<ToolResponse> {
  try {
    const { top, excludeIdle } = waitStatsSchema.parse(args);

    // Benign/idle wait types to exclude
    const idleWaits = [
      'BROKER_EVENTHANDLER',
      'BROKER_RECEIVE_WAITFOR',
      'BROKER_TASK_STOP',
      'BROKER_TO_FLUSH',
      'BROKER_TRANSMITTER',
      'CHECKPOINT_QUEUE',
      'CHKPT',
      'CLR_AUTO_EVENT',
      'CLR_MANUAL_EVENT',
      'CLR_SEMAPHORE',
      'DBMIRROR_DBM_EVENT',
      'DBMIRROR_EVENTS_QUEUE',
      'DBMIRROR_WORKER_QUEUE',
      'DBMIRRORING_CMD',
      'DIRTY_PAGE_POLL',
      'DISPATCHER_QUEUE_SEMAPHORE',
      'EXECSYNC',
      'FSAGENT',
      'FT_IFTS_SCHEDULER_IDLE_WAIT',
      'FT_IFTSHC_MUTEX',
      'HADR_CLUSAPI_CALL',
      'HADR_FILESTREAM_IOMGR_IOCOMPLETION',
      'HADR_LOGCAPTURE_WAIT',
      'HADR_NOTIFICATION_DEQUEUE',
      'HADR_TIMER_TASK',
      'HADR_WORK_QUEUE',
      'KSOURCE_WAKEUP',
      'LAZYWRITER_SLEEP',
      'LOGMGR_QUEUE',
      'MEMORY_ALLOCATION_EXT',
      'ONDEMAND_TASK_QUEUE',
      'PREEMPTIVE_XE_GETTARGETSTATE',
      'PWAIT_ALL_COMPONENTS_INITIALIZED',
      'PWAIT_DIRECTLOGCONSUMER_GETNEXT',
      'QDS_PERSIST_TASK_MAIN_LOOP_SLEEP',
      'QDS_ASYNC_QUEUE',
      'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP',
      'REQUEST_FOR_DEADLOCK_SEARCH',
      'RESOURCE_QUEUE',
      'SERVER_IDLE_CHECK',
      'SLEEP_BPOOL_FLUSH',
      'SLEEP_DBSTARTUP',
      'SLEEP_DCOMSTARTUP',
      'SLEEP_MASTERDBREADY',
      'SLEEP_MASTERMDREADY',
      'SLEEP_MASTERUPGRADED',
      'SLEEP_MSDBSTARTUP',
      'SLEEP_SYSTEMTASK',
      'SLEEP_TASK',
      'SLEEP_TEMPDBSTARTUP',
      'SNI_HTTP_ACCEPT',
      'SP_SERVER_DIAGNOSTICS_SLEEP',
      'SQLTRACE_BUFFER_FLUSH',
      'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
      'SQLTRACE_WAIT_ENTRIES',
      'WAIT_FOR_RESULTS',
      'WAITFOR',
      'WAITFOR_TASKSHUTDOWN',
      'WAIT_XTP_RECOVERY',
      'WAIT_XTP_HOST_WAIT',
      'WAIT_XTP_OFFLINE_CKPT_NEW_LOG',
      'WAIT_XTP_CKPT_CLOSE',
      'XE_DISPATCHER_JOIN',
      'XE_DISPATCHER_WAIT',
      'XE_TIMER_EVENT',
    ];

    let query = `
      SELECT TOP (@top)
        wait_type AS [waitType],
        waiting_tasks_count AS [waitingTasksCount],
        wait_time_ms AS [totalWaitTimeMs],
        max_wait_time_ms AS [maxWaitTimeMs],
        signal_wait_time_ms AS [signalWaitTimeMs],
        wait_time_ms - signal_wait_time_ms AS [resourceWaitTimeMs],
        CAST(100.0 * wait_time_ms / SUM(wait_time_ms) OVER() AS DECIMAL(5,2)) AS [percentTotal]
      FROM sys.dm_os_wait_stats
      WHERE waiting_tasks_count > 0
    `;

    if (excludeIdle) {
      query += ` AND wait_type NOT IN ('${idleWaits.join("','")}')`;
      query += ` AND wait_type NOT LIKE 'PREEMPTIVE%'`;
      query += ` AND wait_type NOT LIKE 'SQLTRACE%'`;
      query += ` AND wait_type NOT LIKE 'XE_%'`;
    }

    query += `
      ORDER BY wait_time_ms DESC
    `;

    const result = await executeQuery(query, { top }, top);

    return formatSuccess({
      waitStats: result.rows,
      count: result.rowCount,
      excludedIdleWaits: excludeIdle,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_wait_stats
 */
export const monitorWaitStatsDefinition = {
  name: 'monitor_wait_stats',
  description:
    'Monitor wait statistics to identify performance bottlenecks. Shows wait types, counts, and times.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      top: {
        type: 'number',
        default: 10,
        minimum: 1,
        maximum: 100,
        description: 'Number of wait types to return (default: 10)',
      },
      excludeIdle: {
        type: 'boolean',
        default: true,
        description: 'Exclude idle/benign waits (default: true)',
      },
    },
  },
};
