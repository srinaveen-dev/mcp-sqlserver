import { DescribeTableTool } from '../tools/describe-table.js';
import { ListTablesTool } from '../tools/list-tables.js';
import { GetTableStatsTool } from '../tools/get-table-stats.js';
import { GetForeignKeysTool } from '../tools/get-foreign-keys.js';
import { ListViewsTool } from '../tools/list-views.js';
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

describe('GetTableStatsTool.buildQuery', () => {
  it("filters by table and schema when table_name is provided", () => {
    const q = GetTableStatsTool.buildQuery('Users', 'dbo');
    expect(q).toContain("t.name = 'Users'");
    expect(q).toContain("s.name = 'dbo'");
  });

  it("works with a non-default schema", () => {
    const q = GetTableStatsTool.buildQuery('Orders', 'billing');
    expect(q).toContain("t.name = 'Orders'");
    expect(q).toContain("s.name = 'billing'");
  });

  it("omits both table and schema conditions when table_name is undefined", () => {
    const q = GetTableStatsTool.buildQuery(undefined, 'dbo');
    expect(q).not.toContain("t.name =");
    expect(q).not.toContain("s.name =");
  });
});

describe('GetForeignKeysTool.buildQuery', () => {
  it("filters by table and schema using single-quoted string literals", () => {
    const q = GetForeignKeysTool.buildQuery('Users', 'dbo');
    expect(q).toContain("OBJECT_NAME(fk.parent_object_id) = 'Users'");
    expect(q).toContain("OBJECT_SCHEMA_NAME(fk.parent_object_id) = 'dbo'");
  });

  it("works with a non-default schema", () => {
    const q = GetForeignKeysTool.buildQuery('Orders', 'billing');
    expect(q).toContain("OBJECT_NAME(fk.parent_object_id) = 'Orders'");
    expect(q).toContain("OBJECT_SCHEMA_NAME(fk.parent_object_id) = 'billing'");
  });

  it("omits WHERE clause entirely when table_name is undefined", () => {
    const q = GetForeignKeysTool.buildQuery(undefined, 'dbo');
    expect(q).not.toContain('WHERE');
    // OBJECT_NAME(...) also appears in the SELECT column list, so check
    // specifically for the comparison form that only appears in WHERE.
    expect(q).not.toContain("OBJECT_NAME(fk.parent_object_id) = '");
  });
});

describe('ListViewsTool.buildQuery', () => {
  it("uses single-quoted string literal for schema, not bracket identifier", () => {
    const q = ListViewsTool.buildQuery('dbo');
    expect(q).toContain("TABLE_SCHEMA = 'dbo'");
    expect(q).not.toContain('[dbo]');
  });

  it("works with a non-default schema", () => {
    const q = ListViewsTool.buildQuery('reporting');
    expect(q).toContain("TABLE_SCHEMA = 'reporting'");
  });

  it("omits TABLE_SCHEMA WHERE clause when schema is undefined", () => {
    const q = ListViewsTool.buildQuery(undefined);
    expect(q).not.toContain('TABLE_SCHEMA =');
  });
});

// These inputs pass through .replace(/'/g, "''") unmodified (no single quotes to
// escape) but are rejected by the validator's /^[a-zA-Z_][a-zA-Z0-9_]*$/ regex.
// They prove the validator is necessary — the .replace path alone would silently
// embed 'dbo!' or 'my-schema' into live SQL.
describe('validateForeignKeyParameters / validateListTablesParameters reject inputs .replace accepts', () => {
  it("rejects schema with non-alphanumeric characters", () => {
    expect(() => ParameterValidator.validateForeignKeyParameters({ table_name: 'Users', schema: 'dbo!' })).toThrow();
    expect(() => ParameterValidator.validateForeignKeyParameters({ table_name: 'Users', schema: 'my-schema' })).toThrow();
    expect(() => ParameterValidator.validateForeignKeyParameters({ table_name: 'Users', schema: 'a b' })).toThrow();
  });

  it("rejects table_name with non-alphanumeric characters", () => {
    expect(() => ParameterValidator.validateForeignKeyParameters({ table_name: 'Users!', schema: 'dbo' })).toThrow();
    expect(() => ParameterValidator.validateForeignKeyParameters({ table_name: 't.Users', schema: 'dbo' })).toThrow();
  });

  it("rejects schema for list-views with non-alphanumeric characters", () => {
    expect(() => ParameterValidator.validateListTablesParameters({ schema: 'dbo!' })).toThrow();
    expect(() => ParameterValidator.validateListTablesParameters({ schema: 'my.schema' })).toThrow();
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