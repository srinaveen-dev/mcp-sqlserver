import { jest } from '@jest/globals';
import { SchemaCache } from '../schema-cache.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, rmSync, existsSync as fsExistsSync } from 'fs';

describe('SchemaCache.getSchemaOnce - Bug #6: servedThisSession set before successful delivery', () => {

  // Test 1: cache file path exists as a directory — existsSync returns true but
  // readFileSync throws EISDIR. Before fix the flag was set before the I/O, so
  // the second call short-circuits to null instead of retrying.
  it('keeps flag false when readFileSync throws — second call retries instead of returning null', async () => {
    // os.tmpdir() is always a real directory:
    //   existsSync(tmpdir()) === true
    //   readFileSync(tmpdir(), 'utf-8') throws EISDIR
    const cache = new SchemaCache(tmpdir());
    const queryFn = jest.fn() as any;

    await expect(cache.getSchemaOnce(queryFn, 'testdb')).rejects.toThrow();
    expect(cache.servedThisSession).toBe(false);

    // Bug: flag was set before readFileSync, so second call returns null.
    // Fix: flag not set on throw, so second call retries and also throws.
    const outcome = await cache.getSchemaOnce(queryFn, 'testdb')
      .then(() => 'returned')
      .catch(() => 'threw');
    expect(outcome).toBe('threw');
  });

  // Test 2: no cache file, queryFn throws on first call. Before fix the flag
  // was set at the top of getSchemaOnce, so the second call (with a working
  // queryFn) returned null instead of generating and returning the schema.
  it('keeps flag false when generateSchema throws — retries and sets flag on successful retry', async () => {
    const cacheDir = join(tmpdir(), `schema-bug6-test-${Date.now()}`);
    const cachePath = join(cacheDir, 'schema.md');
    const cache = new SchemaCache(cachePath);

    try {
      const throwingFn = jest.fn(() => Promise.reject(new Error('DB connection failed'))) as any;
      await expect(cache.getSchemaOnce(throwingFn, 'testdb')).rejects.toThrow('DB connection failed');
      expect(cache.servedThisSession).toBe(false);

      // Bug: servedThisSession was already true → returns null.
      // Fix: flag not set → generateSchema runs with workingFn and returns markdown.
      const workingFn = jest.fn(() => Promise.resolve({ recordset: [] })) as any;
      const schema = await cache.getSchemaOnce(workingFn, 'testdb');
      expect(typeof schema).toBe('string');
      expect(schema).toContain('testdb Schema');
      expect(cache.servedThisSession).toBe(true);
    } finally {
      if (fsExistsSync(cacheDir)) rmSync(cacheDir, { recursive: true });
    }
  });

  // Test 3: regression — verify the fix didn't break the happy path.
  // Successful read must still set the flag and make the second call return null.
  it('sets flag after successful file read and returns null on subsequent call', async () => {
    const tmpFile = join(tmpdir(), `schema-regression-${Date.now()}.md`);
    writeFileSync(tmpFile, '# Regression Schema', 'utf-8');

    try {
      const cache = new SchemaCache(tmpFile);
      const queryFn = jest.fn() as any;

      const first = await cache.getSchemaOnce(queryFn, 'testdb');
      expect(first).toBe('# Regression Schema');
      expect(cache.servedThisSession).toBe(true);
      expect(queryFn).not.toHaveBeenCalled();

      const second = await cache.getSchemaOnce(queryFn, 'testdb');
      expect(second).toBeNull();
    } finally {
      if (fsExistsSync(tmpFile)) rmSync(tmpFile);
    }
  });
});