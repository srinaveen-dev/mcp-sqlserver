import { ExecuteQueryTool } from '../tools/execute-query.js';
import { GetTableStatsTool } from '../tools/get-table-stats.js';
import { SqlServerConnection } from '../connection.js';
import { TableStats } from '../types.js';

// OP-2: tools that apply addRowLimit must surface truncated and rowLimit in
// their responses so callers can distinguish "got everything" from "hit the cap."

const ROW_LIMIT = 3; // small cap so tests stay fast

function mockConnection(rows: any[]): SqlServerConnection {
  return {
    connect: () => Promise.resolve(),
    query: () => Promise.resolve({ recordset: rows }),
    getConfig: () => ({ database: 'testdb' }),
    isConnected: () => false,
    disconnect: () => Promise.resolve(),
  } as unknown as SqlServerConnection;
}

// ── execute_query ────────────────────────────────────────────────────────────

describe('OP-2: execute_query surfaces truncation signal', () => {
  const sampleRow = { id: 1, name: 'row' };
  const query = 'SELECT id, name FROM dbo.T';

  it('truncated: true and rowLimit present when row count equals the cap', async () => {
    const rows = Array(ROW_LIMIT).fill(sampleRow);
    const tool = new ExecuteQueryTool(mockConnection(rows), ROW_LIMIT);
    const result: any = await tool.execute({ query, limit: ROW_LIMIT });
    expect(result.truncated).toBe(true);
    expect(result.rowLimit).toBe(ROW_LIMIT);
  });

  it('truncated: false and rowLimit present when row count is below the cap', async () => {
    const rows = Array(ROW_LIMIT - 1).fill(sampleRow);
    const tool = new ExecuteQueryTool(mockConnection(rows), ROW_LIMIT);
    const result: any = await tool.execute({ query, limit: ROW_LIMIT });
    expect(result.truncated).toBe(false);
    expect(result.rowLimit).toBe(ROW_LIMIT);
  });

  it('truncated: false and rowLimit present for empty results', async () => {
    const tool = new ExecuteQueryTool(mockConnection([]), ROW_LIMIT);
    const result: any = await tool.execute({ query, limit: ROW_LIMIT });
    expect(result.truncated).toBe(false);
    expect(result.rowLimit).toBe(ROW_LIMIT);
    expect(result.rowCount).toBe(0);
  });

  it('existing fields are unchanged — columns, rows, rowCount, executionTime still present', async () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    const tool = new ExecuteQueryTool(mockConnection(rows), ROW_LIMIT);
    const result: any = await tool.execute({ query, limit: ROW_LIMIT });
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rowCount).toBe(2);
    expect(typeof result.executionTime).toBe('number');
  });
});

// ── get_table_stats ──────────────────────────────────────────────────────────
// Representative second tool: enumerates whole-database table stats and is
// most likely to hit the cap in a large schema.

describe('OP-2: get_table_stats surfaces truncation signal', () => {
  const sampleStat: TableStats = {
    table_schema: 'dbo',
    table_name: 'T',
    row_count: 500,
    total_size_kb: 8,
    data_size_kb: 8,
    index_size_kb: 0,
  };

  it('truncated: true and rowLimit present when row count equals the cap', async () => {
    const rows = Array(ROW_LIMIT).fill(sampleStat);
    const tool = new GetTableStatsTool(mockConnection(rows), ROW_LIMIT);
    const result: any = await tool.execute({});
    expect(result.truncated).toBe(true);
    expect(result.rowLimit).toBe(ROW_LIMIT);
  });

  it('truncated: false and rowLimit present when row count is below the cap', async () => {
    const rows = Array(ROW_LIMIT - 1).fill(sampleStat);
    const tool = new GetTableStatsTool(mockConnection(rows), ROW_LIMIT);
    const result: any = await tool.execute({});
    expect(result.truncated).toBe(false);
    expect(result.rowLimit).toBe(ROW_LIMIT);
  });
});