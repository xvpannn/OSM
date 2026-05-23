import { Database } from 'node-sqlite3-wasm';
import { Pool } from 'pg';
import { existsSync, rmSync } from 'fs';
import path from 'path';

// Connection pooling for PostgreSQL
let pgPool: Pool | null = null;

function getPgPool(): Pool {
  if (!pgPool) {
    console.log('[DB] Connecting to central Supabase PostgreSQL Pool...');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Required for secure Supabase connections
    });
  }
  return pgPool;
}

// Convert SQLite query param syntax (?) to Postgres index syntax ($1, $2...)
// Also handles translating SQLite specific features like INSERT OR IGNORE and datetime functions
function translateQuery(sql: string): string {
  let converted = sql;

  // 1. Translate SQLite's INSERT OR IGNORE INTO to standard INSERT INTO ... ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE\s+INTO/gi.test(converted)) {
    converted = converted.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    if (!/ON\s+CONFLICT/gi.test(converted)) {
      converted = `${converted} ON CONFLICT DO NOTHING`;
    }
  }

  // 2. Translate SQLite's datetime('now', 'localtime') or datetime('now') to CURRENT_TIMESTAMP
  converted = converted.replace(/datetime\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'CURRENT_TIMESTAMP');
  converted = converted.replace(/datetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');

  // 3. Convert (?) to ($1, $2...) parameter indexes
  let index = 1;
  converted = converted.replace(/\?/g, () => `$${index++}`);
  
  return converted;
}

// Translate SQLite schema SQL to Postgres compatible SQL on execution
function translateSchemaSql(sql: string): string {
  let converted = sql;
  
  // Replace auto-increment primary keys
  converted = converted.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  
  // Replace composite unique keys
  // SQLite: UNIQUE(source_url, dataset) -> PG: CONSTRAINT unique_source_dataset UNIQUE(source_url, dataset)
  // SQLite: UNIQUE(url, dataset) -> PG: CONSTRAINT unique_url_dataset UNIQUE(url, dataset)
  converted = converted.replace(/(?<!CONSTRAINT\s+[\w_]+\s+)UNIQUE\s*\(([^)]+)\)/gi, (match, cols) => {
    const cleanCols = cols.replace(/['"`\s]/g, '');
    const constraintName = `unique_${cleanCols.replace(/,/g, '_')}`;
    return `CONSTRAINT ${constraintName} UNIQUE(${cols})`;
  });

  // Replace datetime default values
  converted = converted.replace(/DATETIME DEFAULT\s*\(datetime\('now', 'localtime'\)\)/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  converted = converted.replace(/DATETIME DEFAULT\s*\(datetime\('now'\)\)/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  
  // Replace standalone datetime functions
  converted = converted.replace(/datetime\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'CURRENT_TIMESTAMP');
  converted = converted.replace(/datetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');

  return converted;
}

function normalizeParams(params: any): any[] {
  if (params === undefined || params === null) {
    return [];
  }
  if (Array.isArray(params)) {
    return params;
  }
  return [params];
}

export interface StatementClient {
  all(params?: any): Promise<any[]>;
  get(params?: any): Promise<any>;
  run(params?: any): Promise<{ changes: number }>;
  finalize(): Promise<void>;
}

export interface DbClient {
  all(sql: string, params?: any): Promise<any[]>;
  get(sql: string, params?: any): Promise<any>;
  run(sql: string, params?: any): Promise<{ changes: number; lastID: number }>;
  exec(sql: string): Promise<void>;
  prepare(sql: string): StatementClient;
  close(): Promise<void>;
}

class SqliteStatementClient implements StatementClient {
  private stmt: any;
  constructor(stmt: any) {
    this.stmt = stmt;
  }
  async all(params: any = []): Promise<any[]> {
    return this.stmt.all(params);
  }
  async get(params: any = []): Promise<any> {
    return this.stmt.get(params);
  }
  async run(params: any = []): Promise<{ changes: number }> {
    const res = this.stmt.run(params);
    return { changes: typeof res === 'number' ? res : 1 };
  }
  async finalize(): Promise<void> {
    this.stmt.finalize();
  }
}

class PostgresStatementClient implements StatementClient {
  private sql: string;
  private pool: Pool;
  private isPragma: boolean;
  constructor(sql: string, pool: Pool) {
    this.sql = translateQuery(sql);
    this.pool = pool;
    this.isPragma = sql.trim().toUpperCase().startsWith('PRAGMA');
  }
  async all(params: any = []): Promise<any[]> {
    if (this.isPragma) return [];
    const normalized = normalizeParams(params);
    const res = await this.pool.query(this.sql, normalized);
    return res.rows;
  }
  async get(params: any = []): Promise<any> {
    if (this.isPragma) return undefined;
    const normalized = normalizeParams(params);
    const res = await this.pool.query(this.sql, normalized);
    return res.rows[0];
  }
  async run(params: any = []): Promise<{ changes: number }> {
    if (this.isPragma) return { changes: 0 };
    const normalized = normalizeParams(params);
    const res = await this.pool.query(this.sql, normalized);
    return { changes: res.rowCount || 0 };
  }
  async finalize(): Promise<void> {
    // No-op
  }
}

class SqliteDbClient implements DbClient {
  private db: Database;
  constructor(dbPath: string) {
    try {
      if (existsSync(`${dbPath}.lock`)) {
        rmSync(`${dbPath}.lock`, { recursive: true, force: true });
      }
    } catch {}
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
  }

  async all(sql: string, params: any = []): Promise<any[]> {
    return this.db.all(sql, params);
  }

  async get(sql: string, params: any = []): Promise<any> {
    return this.db.get(sql, params);
  }

  async run(sql: string, params: any = []): Promise<{ changes: number; lastID: number }> {
    const res = this.db.run(sql, params);
    return { changes: typeof res === 'number' ? res : 1, lastID: 0 };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementClient {
    return new SqliteStatementClient(this.db.prepare(sql));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresDbClient implements DbClient {
  private pool: Pool;
  constructor() {
    this.pool = getPgPool();
  }

  async all(sql: string, params: any = []): Promise<any[]> {
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) return [];
    const translatedSql = translateQuery(sql);
    const normalized = normalizeParams(params);
    const res = await this.pool.query(translatedSql, normalized);
    return res.rows;
  }

  async get(sql: string, params: any = []): Promise<any> {
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) return undefined;
    const translatedSql = translateQuery(sql);
    const normalized = normalizeParams(params);
    const res = await this.pool.query(translatedSql, normalized);
    return res.rows[0];
  }

  async run(sql: string, params: any = []): Promise<{ changes: number; lastID: number }> {
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) return { changes: 0, lastID: 0 };
    const translatedSql = translateQuery(sql);
    const normalized = normalizeParams(params);
    const res = await this.pool.query(translatedSql, normalized);
    return { changes: res.rowCount || 0, lastID: 0 };
  }

  async exec(sql: string): Promise<void> {
    const queries = sql
      .split(';')
      .map(q => q.trim())
      .filter(q => q && !q.toUpperCase().startsWith('PRAGMA'));

    if (queries.length === 0) return;

    const translatedSql = translateSchemaSql(queries.join(';\n'));
    await this.pool.query(translatedSql);
  }

  prepare(sql: string): StatementClient {
    return new PostgresStatementClient(sql, this.pool);
  }

  async close(): Promise<void> {
    // No-op: keep PG connection pool alive for other requests!
  }
}

export function getDatabaseConnection(dbPath: string): DbClient {
  if (process.env.DATABASE_URL) {
    return new PostgresDbClient();
  } else {
    return new SqliteDbClient(dbPath);
  }
}
