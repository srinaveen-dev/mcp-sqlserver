export class QueryValidator {
  private static readonly ALLOWED_STATEMENTS = [
    'SELECT',
    'WITH',
    'SHOW',
    'DESCRIBE',
    'EXPLAIN',
  ];

  private static readonly FORBIDDEN_KEYWORDS = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
    'SP_',
    'XP_',
    'OPENROWSET',
    'OPENDATASOURCE',
    'BULK',
    'MERGE',
    'GRANT',
    'REVOKE',
    'DENY',
    'BACKUP',
    'RESTORE',
    'DBCC',
    'OPENQUERY',
    'SHUTDOWN',
  ];

  static validateQuery(query: string): { isValid: boolean; error?: string } {
    const normalizedQuery = query.trim().toUpperCase();

    if (!normalizedQuery) {
      return { isValid: false, error: 'Empty query not allowed' };
    }

    // Check if query starts with allowed statement
    const startsWithAllowed = this.ALLOWED_STATEMENTS.some(stmt => 
      normalizedQuery.startsWith(stmt)
    );

    if (!startsWithAllowed) {
      return { 
        isValid: false, 
        error: `Query must start with one of: ${this.ALLOWED_STATEMENTS.join(', ')}` 
      };
    }

    // Strip string literals before scanning; /'(?:[^']|'')*'/g handles SQL's
    // doubled-quote escape (e.g. O''Brien) that naive /'[^']*'/g misparses.
    const queryWithoutStrings = normalizedQuery.replace(/'(?:[^']|'')*'/g, '');

    // Check for forbidden keywords using word boundaries so identifiers like
    // CreatedDate or Executions don't false-positive against CREATE/EXEC.
    // SP_ and XP_ are prefix patterns - _ is a word char so only a leading \b
    // is used; the following identifier characters provide natural separation.
    for (const forbidden of this.FORBIDDEN_KEYWORDS) {
      const pattern = forbidden.endsWith('_')
        ? new RegExp(`\\b${forbidden}`)
        : new RegExp(`\\b${forbidden}\\b`);
      if (pattern.test(queryWithoutStrings)) {
        return {
          isValid: false,
          error: `Forbidden keyword detected: ${forbidden}`
        };
      }
    }

    // Additional security checks
    if (this.containsSqlInjectionPatterns(normalizedQuery)) {
      return { 
        isValid: false, 
        error: 'Potential SQL injection pattern detected' 
      };
    }

    return { isValid: true };
  }

  private static containsSqlInjectionPatterns(query: string): boolean {
    const patterns = [
      /--/,  // SQL comments
      /\/\*/,  // Multi-line comments
      /;.*SELECT/,  // Statement injection
      /UNION.*SELECT/,  // Union injection
      /'\s*OR\s*'.*'/,  // OR injection
      /'\s*AND\s*'.*'/,  // AND injection
    ];

    return patterns.some(pattern => pattern.test(query));
  }

  static sanitizeQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/;$/, '');    // Remove trailing semicolon
  }

  static addRowLimit(query: string, maxRows: number): string {
    const normalizedQuery = query.trim().toUpperCase();
    
    // If query already has TOP clause, don't modify
    if (normalizedQuery.includes('TOP ')) {
      return query;
    }

    // Add TOP clause after SELECT
    return query.replace(
      /^(\s*SELECT\s+)/i,
      `$1TOP ${maxRows} `
    );
  }
}