import { QueryValidator } from '../security.js';

describe('QueryValidator.validateQuery - Bug #1: false positives from substring keyword matching', () => {
  describe('should NOT be blocked (currently fail before fix)', () => {
    it('SELECT CreatedDate, IsDeleted FROM Users', () => {
      const { isValid, error } = QueryValidator.validateQuery(
        'SELECT CreatedDate, IsDeleted FROM Users'
      );
      expect(isValid).toBe(true);
      expect(error).toBeUndefined();
    });

    it('SELECT UpdatedBy, LastUpdated FROM Logs', () => {
      const { isValid, error } = QueryValidator.validateQuery(
        'SELECT UpdatedBy, LastUpdated FROM Logs'
      );
      expect(isValid).toBe(true);
      expect(error).toBeUndefined();
    });

    it('SELECT * FROM Executions', () => {
      const { isValid, error } = QueryValidator.validateQuery(
        'SELECT * FROM Executions'
      );
      expect(isValid).toBe(true);
      expect(error).toBeUndefined();
    });

    it("SELECT * FROM Users WHERE Status = 'CREATED'", () => {
      const { isValid, error } = QueryValidator.validateQuery(
        "SELECT * FROM Users WHERE Status = 'CREATED'"
      );
      expect(isValid).toBe(true);
      expect(error).toBeUndefined();
    });

    // Doubled single-quote escape: O''Brien - naive /'[^']*'/g misparses this.
    it("SELECT * FROM Users WHERE Notes = 'O''Brien deleted his account'", () => {
      const { isValid, error } = QueryValidator.validateQuery(
        "SELECT * FROM Users WHERE Notes = 'O''Brien deleted his account'"
      );
      expect(isValid).toBe(true);
      expect(error).toBeUndefined();
    });
  });

  describe('SHOULD still be blocked (regression guard)', () => {
    it('DELETE FROM Users', () => {
      const { isValid } = QueryValidator.validateQuery('DELETE FROM Users');
      expect(isValid).toBe(false);
    });

    it('UPDATE Users SET active = 0', () => {
      const { isValid } = QueryValidator.validateQuery('UPDATE Users SET active = 0');
      expect(isValid).toBe(false);
    });

    it('INSERT INTO Users VALUES (1, 2, 3)', () => {
      const { isValid } = QueryValidator.validateQuery('INSERT INTO Users VALUES (1, 2, 3)');
      expect(isValid).toBe(false);
    });

    it('DROP TABLE Users', () => {
      const { isValid } = QueryValidator.validateQuery('DROP TABLE Users');
      expect(isValid).toBe(false);
    });

    it('CREATE TABLE foo (id int)', () => {
      const { isValid } = QueryValidator.validateQuery('CREATE TABLE foo (id int)');
      expect(isValid).toBe(false);
    });

    it('EXEC sp_who', () => {
      const { isValid } = QueryValidator.validateQuery('EXEC sp_who');
      expect(isValid).toBe(false);
    });

    it('SELECT * FROM Users; DROP TABLE Users (multi-statement)', () => {
      const { isValid } = QueryValidator.validateQuery(
        'SELECT * FROM Users; DROP TABLE Users'
      );
      expect(isValid).toBe(false);
    });

    // Comment-stripping is NOT implemented; keyword inside a comment is still
    // caught by the forbidden-keyword scan. Flagged as out-of-scope for this PR.
    it('SELECT * /* DROP TABLE */ FROM Users (forbidden keyword inside comment)', () => {
      const { isValid } = QueryValidator.validateQuery(
        'SELECT * /* DROP TABLE */ FROM Users'
      );
      expect(isValid).toBe(false);
    });
  });
});

describe('QueryValidator.validateQuery - SEC-1: missing high-risk keywords', () => {
  // CTE-wrapped forms bypass startsWithAllowed (starts with WITH, which is
  // allowed). These are the tests that actually prove the forbidden-keyword
  // scan catches each keyword - without the CTE wrapper, the startsWithAllowed
  // guard would fire first and the keyword-list addition would have no test.
  describe('CTE-wrapped: should be blocked by keyword scan (currently fail before fix)', () => {
    it("WITH x AS (SELECT 1) BACKUP DATABASE [mydb] TO DISK='\\\\x\\y'", () => {
      const { isValid } = QueryValidator.validateQuery(
        "WITH x AS (SELECT 1) BACKUP DATABASE [mydb] TO DISK='\\\\x\\y'"
      );
      expect(isValid).toBe(false);
    });

    it("WITH x AS (SELECT 1) RESTORE DATABASE [mydb] FROM DISK='\\\\x\\y'", () => {
      const { isValid } = QueryValidator.validateQuery(
        "WITH x AS (SELECT 1) RESTORE DATABASE [mydb] FROM DISK='\\\\x\\y'"
      );
      expect(isValid).toBe(false);
    });

    it('WITH x AS (SELECT 1) DBCC CHECKDB', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH x AS (SELECT 1) DBCC CHECKDB'
      );
      expect(isValid).toBe(false);
    });

    it('WITH x AS (SELECT 1) SHUTDOWN', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH x AS (SELECT 1) SHUTDOWN'
      );
      expect(isValid).toBe(false);
    });

    it("SELECT * FROM OPENQUERY(linked, 'SELECT 1')", () => {
      const { isValid } = QueryValidator.validateQuery(
        "SELECT * FROM OPENQUERY(linked, 'SELECT 1')"
      );
      expect(isValid).toBe(false);
    });
  });

  // Bare forms are blocked by startsWithAllowed (not by keyword scan), but
  // we keep them to document that these statements are rejected regardless.
  describe('bare form: already blocked by startsWithAllowed (pass before and after fix)', () => {
    it("RESTORE DATABASE [mydb] FROM DISK='\\\\x\\y'", () => {
      const { isValid } = QueryValidator.validateQuery(
        "RESTORE DATABASE [mydb] FROM DISK='\\\\x\\y'"
      );
      expect(isValid).toBe(false);
    });

    it('DBCC CHECKDB', () => {
      const { isValid } = QueryValidator.validateQuery('DBCC CHECKDB');
      expect(isValid).toBe(false);
    });

    it('SHUTDOWN', () => {
      const { isValid } = QueryValidator.validateQuery('SHUTDOWN');
      expect(isValid).toBe(false);
    });
  });
});

describe('addRowLimit - Bug #3: pagination compatibility', () => {
  describe('should NOT add TOP when OFFSET/FETCH pagination is present (currently fail)', () => {
    it('OFFSET/FETCH NEXT — query must be returned unchanged', () => {
      const q = 'SELECT * FROM Orders ORDER BY Id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe(q);
    });

    it('OFFSET/FETCH FIRST variant — query must be returned unchanged', () => {
      const q = 'SELECT * FROM Orders ORDER BY Id OFFSET 0 ROWS FETCH FIRST 50 ROWS ONLY';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe(q);
    });

    it('lowercase pagination keywords — query must be returned unchanged', () => {
      const q = 'select * from t order by id offset 5 rows fetch next 5 rows only';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe(q);
    });
  });

  describe('should still add TOP when pagination keywords are absent (regression guard)', () => {
    it('simple SELECT — TOP injected', () => {
      const result = QueryValidator.addRowLimit('SELECT * FROM Orders', 1000);
      expect(result).toMatch(/SELECT\s+TOP\s+1000/i);
    });

    it('SELECT with WHERE — TOP injected', () => {
      const result = QueryValidator.addRowLimit(
        'SELECT id, name FROM Users WHERE active = 1',
        500
      );
      expect(result).toMatch(/SELECT\s+TOP\s+500/i);
    });

    it('CTE — TOP injected on terminal SELECT (Bug #9 fix)', () => {
      const q = 'WITH x AS (SELECT 1 AS n) SELECT * FROM x';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe('WITH x AS (SELECT 1 AS n) SELECT TOP 1000 * FROM x');
    });
  });

  describe('pagination keywords in column names or string literals must not skip TOP injection', () => {
    // A naive includes('OFFSET') would false-positive here; word-boundary match avoids it.
    it('column name OFFSET_HOURS — TOP is injected', () => {
      const result = QueryValidator.addRowLimit('SELECT OFFSET_HOURS FROM Schedule', 1000);
      expect(result).toMatch(/SELECT\s+TOP\s+1000/i);
    });

    // A naive includes('FETCH') would false-positive here; stripping string literals avoids it.
    it("string literal 'FETCH' — TOP is injected", () => {
      const result = QueryValidator.addRowLimit(
        "SELECT * FROM Logs WHERE Action = 'FETCH'",
        1000
      );
      expect(result).toMatch(/SELECT\s+TOP\s+1000/i);
    });
  });
});

describe('addRowLimit - Bug #9: CTE queries bypass row limit', () => {
  describe('CTE queries — TOP injected on terminal SELECT (currently fail before fix)', () => {
    it('simple single CTE', () => {
      const q = 'WITH c AS (SELECT * FROM t) SELECT * FROM c';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe(
        'WITH c AS (SELECT * FROM t) SELECT TOP 1000 * FROM c'
      );
    });

    it('multiple CTEs', () => {
      const q = 'WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a JOIN b ON a.x = b.y';
      const result = QueryValidator.addRowLimit(q, 500);
      expect(result).toMatch(/\) SELECT TOP 500 \* FROM a/i);
    });

    it('CTE with nested parens in definition', () => {
      const q = 'WITH c AS (SELECT * FROM t WHERE x IN (SELECT id FROM u)) SELECT * FROM c';
      expect(QueryValidator.addRowLimit(q, 1000)).toBe(
        'WITH c AS (SELECT * FROM t WHERE x IN (SELECT id FROM u)) SELECT TOP 1000 * FROM c'
      );
    });

    it('CTE with string literal containing SELECT and )', () => {
      const q = "WITH c AS (SELECT * FROM t WHERE name = 'SELECT FROM x)') SELECT * FROM c";
      const result = QueryValidator.addRowLimit(q, 1000);
      expect(result).toContain("SELECT TOP 1000 * FROM c");
      expect(result).toContain("name = 'SELECT FROM x)'");
    });

    it('CTE with single-line comment containing )', () => {
      const q = 'WITH c AS (SELECT * FROM t -- bad )\n) SELECT * FROM c';
      expect(QueryValidator.addRowLimit(q, 1000)).toContain('SELECT TOP 1000 * FROM c');
    });

    it('CTE with block comment containing )', () => {
      const q = 'WITH c AS (SELECT * FROM t /* ) SELECT */) SELECT * FROM c';
      expect(QueryValidator.addRowLimit(q, 1000)).toContain('SELECT TOP 1000 * FROM c');
    });

    it('CTE with SELECT TOP N in inner definition — outer terminal SELECT still gets capped', () => {
      const q = 'WITH c AS (SELECT TOP 5 * FROM t) SELECT * FROM c';
      const result = QueryValidator.addRowLimit(q, 1000);
      expect(result).toContain('SELECT TOP 5 * FROM t');
      expect(result).toMatch(/\) SELECT TOP 1000 \* FROM c/i);
    });
  });

  describe('malformed CTEs — addRowLimit throws (currently return query unchanged)', () => {
    it('unbalanced parens — missing closing paren', () => {
      const q = 'WITH c AS (SELECT * FROM t SELECT * FROM c';
      expect(() => QueryValidator.addRowLimit(q, 1000)).toThrow();
    });

    it('WITH keyword but no terminal SELECT', () => {
      const q = 'WITH c AS (SELECT * FROM t)';
      expect(() => QueryValidator.addRowLimit(q, 1000)).toThrow();
    });
  });

  describe('validator wiring — WITH + DML keywords are rejected (should already pass)', () => {
    it('WITH c AS (...) DELETE FROM c is rejected by validateQuery', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH c AS (SELECT * FROM t) DELETE FROM t'
      );
      expect(isValid).toBe(false);
    });

    it('WITH c AS (...) INSERT INTO c is rejected by validateQuery', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH c AS (SELECT * FROM t) INSERT INTO t SELECT * FROM c'
      );
      expect(isValid).toBe(false);
    });

    it('WITH c AS (...) UPDATE c SET is rejected by validateQuery', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH c AS (SELECT * FROM t) UPDATE t SET x = 1'
      );
      expect(isValid).toBe(false);
    });

    it('WITH c AS (...) MERGE is rejected by validateQuery', () => {
      const { isValid } = QueryValidator.validateQuery(
        'WITH c AS (SELECT * FROM t) MERGE INTO t USING c ON (t.id = c.id) WHEN MATCHED THEN UPDATE SET x = 1'
      );
      expect(isValid).toBe(false);
    });
  });
});