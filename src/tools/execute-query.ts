import { BaseTool } from './base.js';
import { QueryResult } from '../types.js';
import { ParameterValidator } from '../validation.js';
import { ErrorHandler } from '../errors.js';

export class ExecuteQueryTool extends BaseTool {
  getName(): string {
    return 'execute_query';
  }

  getDescription(): string {
    return 'Execute a read-only SELECT query against the database.';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL SELECT query to execute (read-only operations only)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (optional)',
          minimum: 1,
          maximum: 10000,
        },
      },
      required: ['query'],
    };
  }

  async execute(params: { query: string; limit?: number }): Promise<QueryResult & { truncated: boolean; rowLimit: number }> {
    const validatedParams = ParameterValidator.validateQueryParameters(params);
    const { query, limit } = validatedParams;
    const maxRows = limit;

    const startTime = Date.now();

    try {
      await this.connection.connect();

      // Override the maxRows for this specific query
      const originalMaxRows = this.maxRows;
      this.maxRows = maxRows;

      const result = await this.executeQuery(query);
      const executionTime = Date.now() - startTime;

      // Restore original maxRows
      this.maxRows = originalMaxRows;

      // Extract column names
      const columns = result.length > 0 ? Object.keys(result[0]) : [];

      // Convert to rows array
      const rows = result.map(row => columns.map(col => row[col]));

      return {
        columns,
        rows,
        rowCount: result.length,
        executionTime,
        truncated: result.length === maxRows,
        rowLimit: maxRows,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const mcpError = ErrorHandler.handleSqlServerError(error);
      mcpError.message = `${mcpError.message} (execution time: ${executionTime}ms)`;
      throw mcpError;
    }
  }
}