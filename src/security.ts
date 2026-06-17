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

    // Don't inject TOP when OFFSET/FETCH pagination is present — SQL Server
    // rejects SELECT TOP N ... OFFSET M ROWS FETCH NEXT N ROWS ONLY.
    // Strip string literals first so column names (OFFSET_HOURS) and string
    // values ('FETCH') don't false-positive.
    const queryWithoutStrings = normalizedQuery.replace(/'(?:[^']|'')*'/g, '');
    if (/\bOFFSET\b/.test(queryWithoutStrings) || /\bFETCH\b/.test(queryWithoutStrings)) {
      return query;
    }

    // CTE queries (WITH ... SELECT ...): find the terminal SELECT by walking
    // past all CTE definitions with a paren-depth counter, then inject TOP N
    // only at the terminal SELECT. The global 'TOP ' guard is intentionally
    // skipped here so inner CTE definitions that use TOP do not prevent the
    // outer (terminal) SELECT from being capped.
    if (/^\s*WITH\s/i.test(query)) {
      const terminalOffset = QueryValidator.findCteTerminalSelect(query);
      const fromTerminal = query.slice(terminalOffset);
      if (/^SELECT\s+TOP\s/i.test(fromTerminal)) {
        return query;
      }
      return query.slice(0, terminalOffset) + fromTerminal.replace(/^(SELECT\s+)/i, `$1TOP ${maxRows} `);
    }

    // If query already has TOP clause, don't modify (non-CTE path)
    if (normalizedQuery.includes('TOP ')) {
      return query;
    }

    // Add TOP clause after SELECT
    return query.replace(
      /^(\s*SELECT\s+)/i,
      `$1TOP ${maxRows} `
    );
  }

  private static findCteTerminalSelect(query: string): number {
    let depth = 0;
    let hadPositiveDepth = false;
    let i = 0;
    while (i < query.length) {
      const ch = query[i];
      // String literal: skip '...' with '' escape
      if (ch === "'") {
        i++;
        while (i < query.length) {
          if (query[i] === "'" && query[i + 1] === "'") { i += 2; }
          else if (query[i] === "'") { i++; break; }
          else { i++; }
        }
        continue;
      }
      // Line comment: skip -- to end of line
      if (ch === '-' && query[i + 1] === '-') {
        while (i < query.length && query[i] !== '\n') i++;
        continue;
      }
      // Block comment: skip /* ... */
      if (ch === '/' && query[i + 1] === '*') {
        i += 2;
        while (i < query.length - 1 && !(query[i] === '*' && query[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (ch === '(') { depth++; hadPositiveDepth = true; }
      else if (ch === ')') { depth--; }
      else if (depth === 0 && hadPositiveDepth && /^SELECT\s/i.test(query.slice(i))) {
        return i;
      }
      i++;
    }
    throw new Error('CTE query must have a terminal SELECT after the last CTE definition');
  }
}