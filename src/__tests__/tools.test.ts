import { DescribeTableTool } from '../tools/describe-table.js';
import { ListTablesTool } from '../tools/list-tables.js';
import { ParameterValidator } from '../validation.js';

describe('DescribeTableTool.buildQuery', () => {
  it("uses single-quoted string literals for schema and table, not bracket identifiers", () => {
    const q = DescribeTableTool.buildQuery('dbo', 'Users');
    expect(q).toContain("TABLE_SCHEMA = 'dbo'");
    expect(q).toContain("TABLE_NAME = 'Users'");
    expect(q).not.toContain('[dbo]');
    expect(q).not.toContain('[Users]');
  });

  it("works for non-default schema", () => {
    const q = DescribeTableTool.buildQuery('sales', 'Orders');
    expect(q).toContain("TABLE_SCHEMA = 'sales'");
    expect(q).toContain("TABLE_NAME = 'Orders'");
  });
});

describe('ListTablesTool.buildQuery', () => {
  it("uses single-quoted string literal for schema, not bracket identifier", () => {
    const q = ListTablesTool.buildQuery('dbo');
    expect(q).toContain("TABLE_SCHEMA = 'dbo'");
    expect(q).not.toContain('[dbo]');
  });

  it("omits TABLE_SCHEMA clause when schema is undefined", () => {
    const q = ListTablesTool.buildQuery(undefined);
    expect(q).not.toContain('TABLE_SCHEMA =');
    expect(q).toContain("TABLE_TYPE = 'BASE TABLE'");
  });
});

describe('Input validation rejects dangerous schema/table names before SQL is built', () => {
  it("rejects schema containing semicolon injection", () => {
    expect(() =>
      ParameterValidator.validateTableDescriptionParameters({
        table_name: 'Users',
        schema: "dbo'; DROP TABLE Users --",
      })
    ).toThrow();
  });

  it("rejects schema containing SQL comment marker", () => {
    expect(() =>
      ParameterValidator.validateTableDescriptionParameters({
        table_name: 'Users',
        schema: 'dbo--',
      })
    ).toThrow();
  });

  it("rejects schema containing spaces", () => {
    expect(() =>
      ParameterValidator.validateTableDescriptionParameters({
        table_name: 'Users',
        schema: 'schema with space',
      })
    ).toThrow();
  });

  it("rejects table_name containing injection attempt", () => {
    expect(() =>
      ParameterValidator.validateTableDescriptionParameters({
        table_name: "Users'; DROP",
        schema: 'dbo',
      })
    ).toThrow();
  });
});