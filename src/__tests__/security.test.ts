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