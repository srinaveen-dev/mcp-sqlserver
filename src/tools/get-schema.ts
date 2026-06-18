import { BaseTool } from './base.js';
import { ErrorHandler } from '../errors.js';
import { SchemaCache } from '../schema-cache.js';

export class GetSchemaTool extends BaseTool {
  private schemaCache: SchemaCache | null = null;

  setSchemaCache(cache: SchemaCache): void {
    this.schemaCache = cache;
  }

  getName(): string {
    return 'get_schema';
  }

  getDescription(): string {
    return (
      'Returns the full SQL Server database schema as markdown: all tables, column ' +
      'names, data types, primary keys, and foreign key relationships. Call this ' +
      'before running execute_query on the first SQL task of a session, or after ' +
      'running snapshot_schema to pick up schema changes. Returns the cached schema ' +
      'if available, otherwise generates and caches it on first call.'
    );
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(_params: Record<string, never>): Promise<{ schema: string }> {
    if (!this.schemaCache) {
      throw new Error('Schema cache not configured. Set SQLSERVER_SCHEMA_CACHE_PATH environment variable.');
    }

    try {
      const cached = this.schemaCache.readCached();
      if (cached !== null) {
        return { schema: cached };
      }

      await this.connection.connect();
      const dbName = this.connection.getConfig().database ?? 'unknown';
      const queryFn = this.connection.query.bind(this.connection);
      const result = await this.schemaCache.generateSchema(queryFn, dbName);
      return { schema: result.markdown };
    } catch (error) {
      const mcpError = ErrorHandler.handleSqlServerError(error);
      throw mcpError;
    }
  }
}