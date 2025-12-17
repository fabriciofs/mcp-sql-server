import { executeQuery } from '../db/index.js';
import { formatSuccess, formatError } from '../utils/formatters.js';
import type { ToolResponse } from '../types.js';

/**
 * Tool: monitor_database_size
 * Monitor database size and file usage
 */
export async function monitorDatabaseSize(): Promise<ToolResponse> {
  try {
    // Database size summary
    const sizeQuery = `
      SELECT
        DB_NAME() AS [database],
        SUM(CASE WHEN type = 0 THEN size END) * 8.0 / 1024 AS [dataSizeMB],
        SUM(CASE WHEN type = 1 THEN size END) * 8.0 / 1024 AS [logSizeMB],
        SUM(size) * 8.0 / 1024 AS [totalSizeMB]
      FROM sys.database_files
    `;

    // File details
    const filesQuery = `
      SELECT
        f.name AS [fileName],
        f.type_desc AS [fileType],
        f.physical_name AS [physicalPath],
        CAST(f.size * 8.0 / 1024 AS DECIMAL(18,2)) AS [sizeMB],
        CAST(FILEPROPERTY(f.name, 'SpaceUsed') * 8.0 / 1024 AS DECIMAL(18,2)) AS [usedMB],
        CAST((f.size - FILEPROPERTY(f.name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(18,2)) AS [freeMB],
        CAST(100.0 * FILEPROPERTY(f.name, 'SpaceUsed') / NULLIF(f.size, 0) AS DECIMAL(5,2)) AS [usedPercent],
        CASE f.max_size
          WHEN -1 THEN 'UNLIMITED'
          WHEN 0 THEN 'NO GROWTH'
          ELSE CAST(CAST(f.max_size * 8.0 / 1024 AS DECIMAL(18,2)) AS VARCHAR(20)) + ' MB'
        END AS [maxSize],
        CASE f.growth
          WHEN 0 THEN 'NONE'
          ELSE CASE f.is_percent_growth
            WHEN 1 THEN CAST(f.growth AS VARCHAR(10)) + '%'
            ELSE CAST(CAST(f.growth * 8.0 / 1024 AS DECIMAL(18,2)) AS VARCHAR(20)) + ' MB'
          END
        END AS [growthSetting]
      FROM sys.database_files f
    `;

    // Table sizes
    const tablesQuery = `
      SELECT TOP 20
        s.name AS [schema],
        t.name AS [table],
        p.rows AS [rowCount],
        CAST(ROUND(SUM(a.total_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [totalSizeMB],
        CAST(ROUND(SUM(a.used_pages) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [usedSizeMB],
        CAST(ROUND((SUM(a.total_pages) - SUM(a.used_pages)) * 8.0 / 1024, 2) AS DECIMAL(18,2)) AS [unusedSizeMB]
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.indexes i ON t.object_id = i.object_id
      INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
      INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE t.is_ms_shipped = 0
      GROUP BY s.name, t.name, p.rows
      ORDER BY SUM(a.total_pages) DESC
    `;

    const [size, files, tables] = await Promise.all([
      executeQuery(sizeQuery, {}, 1),
      executeQuery(filesQuery, {}, 100),
      executeQuery(tablesQuery, {}, 20),
    ]);

    return formatSuccess({
      summary: size.rows[0],
      files: files.rows,
      largestTables: tables.rows,
    });
  } catch (error) {
    return formatError(error);
  }
}

/**
 * Tool definition for monitor_database_size
 */
export const monitorDatabaseSizeDefinition = {
  name: 'monitor_database_size',
  description:
    'Monitor database size including file usage, space allocation, and largest tables.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
