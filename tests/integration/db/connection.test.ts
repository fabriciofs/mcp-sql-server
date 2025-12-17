import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mssql before importing the module
vi.mock('mssql', () => {
  const mockPool = {
    connected: true,
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({
        recordset: [],
        rowsAffected: [0],
      }),
    })),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockPool),
      NVarChar: Symbol('NVarChar'),
      BigInt: Symbol('BigInt'),
      Float: Symbol('Float'),
      Bit: Symbol('Bit'),
    },
    connect: vi.fn().mockResolvedValue(mockPool),
    NVarChar: Symbol('NVarChar'),
    BigInt: Symbol('BigInt'),
    Float: Symbol('Float'),
    Bit: Symbol('Bit'),
  };
});

describe('Database Connection', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset modules to clear singleton state
    vi.resetModules();
    // Re-mock mssql after reset
    vi.doMock('mssql', () => {
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn().mockResolvedValue({
            recordset: [],
            rowsAffected: [0],
          }),
        })),
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      return {
        default: {
          connect: vi.fn().mockResolvedValue(mockPool),
          NVarChar: Symbol('NVarChar'),
          BigInt: Symbol('BigInt'),
          Float: Symbol('Float'),
          Bit: Symbol('Bit'),
        },
        connect: vi.fn().mockResolvedValue(mockPool),
        NVarChar: Symbol('NVarChar'),
        BigInt: Symbol('BigInt'),
        Float: Symbol('Float'),
        Bit: Symbol('Bit'),
      };
    });
  });

  describe('getPool', () => {
    it('should create a connection pool', async () => {
      const { getPool } = await import('../../../src/db/connection.js');
      const sql = await import('mssql');

      const pool = await getPool();

      expect(pool).toBeDefined();
      expect(sql.default.connect).toHaveBeenCalled();
    });

    it('should reuse existing pool on subsequent calls', async () => {
      const { getPool } = await import('../../../src/db/connection.js');
      const sql = await import('mssql');

      const pool1 = await getPool();
      const pool2 = await getPool();

      expect(pool1).toBe(pool2);
      // connect should only be called once due to singleton pattern
      expect(sql.default.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('isConnected', () => {
    it('should return connection status', async () => {
      const { getPool, isConnected } = await import('../../../src/db/connection.js');

      await getPool();
      const connected = isConnected();

      expect(typeof connected).toBe('boolean');
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics', async () => {
      const { getPool, getPoolStats } = await import('../../../src/db/connection.js');

      await getPool();
      const stats = getPoolStats();

      expect(stats).toHaveProperty('min');
      expect(stats).toHaveProperty('max');
      expect(stats).toHaveProperty('connected');
    });
  });

  describe('closePool', () => {
    it('should close the pool without error', async () => {
      const { getPool, closePool } = await import('../../../src/db/connection.js');

      await getPool();
      await expect(closePool()).resolves.not.toThrow();
    });
  });
});
