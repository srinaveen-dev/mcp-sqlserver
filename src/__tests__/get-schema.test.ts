import { jest } from '@jest/globals';
import { GetSchemaTool } from '../tools/get-schema.js';
import { SqlServerConnection } from '../connection.js';
import { SchemaCache } from '../schema-cache.js';

function mockConnection(): SqlServerConnection {
  return {
    connect: () => Promise.resolve(),
    query: () => Promise.resolve({ recordset: [] }),
    getConfig: () => ({ database: 'testdb' }),
    isConnected: () => false,
    disconnect: () => Promise.resolve(),
  } as unknown as SqlServerConnection;
}

describe('GetSchemaTool', () => {
  it('returns cached schema when readCached() returns content — no DB connection required', async () => {
    const cache = {
      readCached: () => '# TestDB Schema\n## dbo.Users\nid int PK',
    } as unknown as SchemaCache;
    const tool = new GetSchemaTool(mockConnection(), 1000);
    tool.setSchemaCache(cache);

    const result = await tool.execute({} as never);
    expect(result.schema).toBe('# TestDB Schema\n## dbo.Users\nid int PK');
  });

  it('generates and returns schema when readCached() returns null — cold path', async () => {
    const generateSchema = jest.fn<() => Promise<{ markdown: string; tables: number; columns: number }>>()
      .mockResolvedValue({ markdown: '# Generated Schema', tables: 3, columns: 12 });

    const cache = {
      readCached: () => null,
      generateSchema,
    } as unknown as SchemaCache;
    const tool = new GetSchemaTool(mockConnection(), 1000);
    tool.setSchemaCache(cache);

    const result = await tool.execute({} as never);
    expect(result.schema).toBe('# Generated Schema');
    expect(generateSchema).toHaveBeenCalledTimes(1);
  });

  it('throws when schemaCache is not configured', async () => {
    const tool = new GetSchemaTool(mockConnection(), 1000);
    // setSchemaCache deliberately not called

    await expect(tool.execute({} as never)).rejects.toThrow(
      'Schema cache not configured. Set SQLSERVER_SCHEMA_CACHE_PATH environment variable.'
    );
  });
});