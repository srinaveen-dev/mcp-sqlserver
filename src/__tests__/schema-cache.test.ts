import { jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SchemaCache } from '../schema-cache.js';

function makeSidecar(overrides?: Partial<{ maxModifyDate: string | null; objectCount: number }>) {
  return JSON.stringify({
    maxModifyDate: overrides?.maxModifyDate ?? '2026-06-19T00:00:00.000Z',
    objectCount: overrides?.objectCount ?? 100,
    generatedAt: '2026-06-19T00:00:00.000Z',
  });
}

describe('SchemaCache', () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'schema-cache-test-'));
    cachePath = join(tmpDir, 'schema.md');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe('readCachedIfFresh', () => {
    it('returns null when cache file is missing', async () => {
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn();

      const result = await cache.readCachedIfFresh(queryFn as any);

      expect(result).toBeNull();
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('returns null when sidecar is missing', async () => {
      writeFileSync(cachePath, '# Schema', 'utf-8');
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn();

      const result = await cache.readCachedIfFresh(queryFn as any);

      expect(result).toBeNull();
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('returns null when objectCount differs', async () => {
      writeFileSync(cachePath, '# Schema', 'utf-8');
      writeFileSync(`${cachePath}.meta.json`, makeSidecar({ objectCount: 100 }), 'utf-8');
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn().mockResolvedValue({
        recordset: [{ LastModified: new Date('2026-06-19T00:00:00.000Z'), ObjectCount: 101 }],
      });

      const result = await cache.readCachedIfFresh(queryFn as any);

      expect(result).toBeNull();
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('returns null when maxModifyDate differs', async () => {
      writeFileSync(cachePath, '# Schema', 'utf-8');
      writeFileSync(`${cachePath}.meta.json`, makeSidecar({ maxModifyDate: '2026-06-19T00:00:00.000Z' }), 'utf-8');
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn().mockResolvedValue({
        recordset: [{ LastModified: new Date('2026-06-19T01:00:00.000Z'), ObjectCount: 100 }],
      });

      const result = await cache.readCachedIfFresh(queryFn as any);

      expect(result).toBeNull();
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('returns cached markdown when objectCount and maxModifyDate both match', async () => {
      writeFileSync(cachePath, '# Schema', 'utf-8');
      writeFileSync(`${cachePath}.meta.json`, makeSidecar(), 'utf-8');
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn().mockResolvedValue({
        recordset: [{ LastModified: new Date('2026-06-19T00:00:00.000Z'), ObjectCount: 100 }],
      });

      const result = await cache.readCachedIfFresh(queryFn as any);

      expect(result).toBe('# Schema');
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateSchema', () => {
    it('writes both cache file and sidecar with staleness data from DB', async () => {
      const cache = new SchemaCache(cachePath);
      const queryFn = jest.fn(async (sqlText: string) => {
        if (sqlText.includes('sys.objects')) {
          return {
            recordset: [{ LastModified: new Date('2026-06-19T00:00:00.000Z'), ObjectCount: 42 }],
          };
        }
        return { recordset: [] };
      });

      await cache.generateSchema(queryFn as any, 'testdb');

      expect(existsSync(cachePath)).toBe(true);
      expect(existsSync(`${cachePath}.meta.json`)).toBe(true);
      const sidecar = JSON.parse(readFileSync(`${cachePath}.meta.json`, 'utf-8'));
      expect(sidecar.objectCount).toBe(42);
      expect(sidecar.maxModifyDate).toBe('2026-06-19T00:00:00.000Z');
    });
  });
});
