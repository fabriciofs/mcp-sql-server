import { executeQuery } from '../db/index.js';
import { perfCountersSchema } from '../validators/schemas.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_performance_counters
 * Monitor SQL Server performance counters
 */
export async function monitorPerformanceCounters(args: unknown): Promise<ToolResponse> {
  try {
    const { category } = perfCountersSchema.parse(args);

    const counterFilters: Record<string, string[]> = {
      buffer: [
        'Buffer cache hit ratio',
        'Buffer cache hit ratio base',
        'Page life expectancy',
        'Checkpoint pages/sec',
        'Page reads/sec',
        'Page writes/sec',
        'Lazy writes/sec',
        'Free pages',
        'Total pages',
        'Target pages',
        'Database pages',
      ],
      sql: [
        'Batch Requests/sec',
        'SQL Compilations/sec',
        'SQL Re-Compilations/sec',
        'Auto-Param Attempts/sec',
        'Failed Auto-Params/sec',
        'Safe Auto-Params/sec',
        'Unsafe Auto-Params/sec',
      ],
      locks: [
        'Lock Requests/sec',
        'Lock Timeouts/sec',
        'Lock Timeouts (timeout > 0)/sec',
        'Lock Waits/sec',
        'Lock Wait Time (ms)',
        'Number of Deadlocks/sec',
        'Average Wait Time (ms)',
      ],
      memory: [
        'Total Server Memory (KB)',
        'Target Server Memory (KB)',
        'Memory Grants Pending',
        'Memory Grants Outstanding',
        'Connection Memory (KB)',
        'Lock Memory (KB)',
        'Optimizer Memory (KB)',
        'SQL Cache Memory (KB)',
        'Database Cache Memory (KB)',
      ],
    };

    let query = `
      SELECT
        object_name AS [object],
        counter_name AS [counter],
        instance_name AS [instance],
        cntr_value AS [value],
        cntr_type AS [type]
      FROM sys.dm_os_performance_counters
      WHERE 1=1
    `;

    if (category !== 'all') {
      const counters = counterFilters[category];
      if (counters && counters.length > 0) {
        query += ` AND counter_name IN ('${counters.join("','")}')`;
      }
    } else {
      // For 'all', include all relevant counters
      const allCounters = Object.values(counterFilters).flat();
      query += ` AND counter_name IN ('${allCounters.join("','")}')`;
    }

    query += ` ORDER BY object_name, counter_name, instance_name`;

    const result = await executeQuery(query, {}, 500);

    // Calculate buffer cache hit ratio (special handling for ratio counters)
    const counters = result.rows as Array<{
      object: string;
      counter: string;
      instance: string;
      value: number;
      type: number;
    }>;

    const hitRatio = counters.find((c) => c.counter.includes('Buffer cache hit ratio') && !c.counter.includes('base'));
    const hitRatioBase = counters.find((c) => c.counter.includes('Buffer cache hit ratio base'));

    let bufferCacheHitRatio: number | null = null;
    if (hitRatio && hitRatioBase && hitRatioBase.value > 0) {
      bufferCacheHitRatio = Math.round((hitRatio.value / hitRatioBase.value) * 100 * 100) / 100;
    }

    // Group by category
    const grouped: Record<string, unknown[]> = {};
    for (const counter of counters) {
      const obj = counter.object.trim();
      if (!grouped[obj]) {
        grouped[obj] = [];
      }
      grouped[obj].push({
        counter: counter.counter.trim(),
        instance: counter.instance?.trim() || null,
        value: counter.value,
      });
    }

    return formatSuccess({
      category,
      bufferCacheHitRatio: bufferCacheHitRatio !== null ? `${bufferCacheHitRatio}%` : null,
      counters: grouped,
      totalCounters: result.rowCount,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_performance_counters
 */
export const monitorPerformanceCountersDefinition = {
  name: 'monitor_performance_counters',
  description:
    'Monitor SQL Server performance counters by category: buffer, sql, locks, memory, or all.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: ['buffer', 'sql', 'locks', 'memory', 'all'],
        default: 'all',
        description: 'Counter category: buffer, sql, locks, memory, or all',
      },
    },
  },
};
