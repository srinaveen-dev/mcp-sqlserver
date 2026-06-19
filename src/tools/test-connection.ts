import { BaseTool } from './base.js';

interface ConnectionTestResult {
  isConnected: boolean;
  serverInfo?: {
    serverName: string;
    version: string;
    edition: string;
  };
  database?: string;
  connectionTime?: number;
  error?: string;
  details?: {
    canExecuteQueries: boolean;
    hasSystemAccess: boolean;
    encryptionEnabled: boolean;
  };
}

export class TestConnectionTool extends BaseTool {
  getName(): string {
    return 'test_connection';
  }

  getDescription(): string {
    return 'Test the SQL Server connection and validate permissions';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const result: ConnectionTestResult = {
      isConnected: false,
    };

    try {
      // Test basic connection
      await this.connection.connect();
      const connectionTime = Date.now() - startTime;
      
      result.isConnected = true;
      result.connectionTime = connectionTime;

      // Get basic server info
      try {
        const serverQuery = `
          SELECT 
            @@SERVERNAME as serverName,
            @@VERSION as version,
            SERVERPROPERTY('Edition') as edition,
            DB_NAME() as currentDatabase,
            CASE WHEN ENCRYPT_OPTION = 'TRUE' THEN 1 ELSE 0 END as encryptionEnabled
          FROM (SELECT 'TRUE' as ENCRYPT_OPTION) as dummy
        `;
        
        const serverInfo = await this.executeQuery(serverQuery);
        if (serverInfo.length > 0) {
          const info = serverInfo[0];
          result.serverInfo = {
            serverName: info.serverName,
            version: info.version,
            edition: info.edition,
          };
          result.database = info.currentDatabase;
        }
      } catch (error) {
        result.error = `Failed to get server info: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      // Test permissions
      const details = {
        canExecuteQueries: false,
        hasSystemAccess: false,
        encryptionEnabled: false,
      };

      // Test basic query execution
      try {
        await this.executeQuery('SELECT 1 as test');
        details.canExecuteQueries = true;
      } catch (error) {
        // Query execution failed
      }

      // Test system view access
      try {
        await this.executeQuery('SELECT TOP 1 name FROM sys.databases');
        details.hasSystemAccess = true;
      } catch (error) {
        // System access failed
      }

      // Check encryption status
      try {
        const encQuery = await this.executeQuery("SELECT ENCRYPT_OPTION() as encryption_status");
        details.encryptionEnabled = encQuery.length > 0;
      } catch (error) {
        // Encryption check failed
      }

      result.details = details;

    } catch (error) {
      result.isConnected = false;
      result.connectionTime = Date.now() - startTime;
      
      if (error instanceof Error) {
        const message = error.message || error.name || error.toString() || '';
        if (message.includes('Login failed')) {
          result.error = 'Authentication failed: Invalid username or password';
        } else if (message.includes('server was not found')) {
          result.error = 'Connection failed: Server not found or not accessible';
        } else if (message.includes('timeout')) {
          result.error = 'Connection failed: Timeout occurred';
        } else if (message.includes('SSL')) {
          result.error = 'Connection failed: SSL/Encryption configuration issue';
        } else if (message.includes('certificate')) {
          result.error = 'Connection failed: Certificate validation issue';
        } else if (!message || message === 'ConnectionError') {
          result.error = 'Connection failed: Unable to reach SQL Server — check host, credentials, VPN, and firewall';
        } else {
          result.error = `Connection failed: ${message}`;
        }
      } else {
        result.error = 'Connection failed: Unknown error';
      }
    }

    return result;
  }
}