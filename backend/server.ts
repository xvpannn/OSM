import express from 'express';
import cors from 'cors';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync, rmSync, readFileSync } from 'fs';
import { getDatabaseConnection, DbClient } from './db';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// Load environment variables manually from root .env
function loadDotenv() {
  const p = path.join(__dirname, '..', '.env');
  if (existsSync(p)) {
    const content = readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=');
        if (index !== -1) {
          const key = trimmed.substring(0, index).trim();
          let val = trimmed.substring(index + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1);
          }
          process.env[key] = val;
        }
      }
    }
  }
}
loadDotenv();

const app = express();
const PORT = process.env.PORT || 3001;

// Scraper lock: when scraper.lock exists, the DB is being written by scraper.ts.
// node-sqlite3-wasm on Windows cannot handle two processes accessing the same
// SQLite file concurrently — it throws DISK I/O ERROR instead of retrying.
// Solution: serve the last successful response from cache while the lock is held.
const LOCK_FILE = 'scraper.lock';
const isScraperRunning = () => existsSync(LOCK_FILE);
const dbCache: Record<string, any> = {};

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '..')));

async function seedSbaData() {
  let db: any;
  try {
    if (existsSync('edgar_data.sqlite.lock')) {
      rmSync('edgar_data.sqlite.lock', { recursive: true, force: true });
    }

    db = getDatabaseConnection('edgar_data.sqlite');
    await db.exec("PRAGMA busy_timeout = 5000;");

    try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN dataset TEXT DEFAULT 'default';"); } catch { }
    try { await db.exec("ALTER TABLE processed_filings ADD COLUMN dataset TEXT DEFAULT 'default';"); } catch { }
    try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN shares_sold REAL DEFAULT 0;"); } catch { }
    try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN shares_remaining REAL DEFAULT 0;"); } catch { }
    try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN injected_at TEXT;"); } catch { }
    try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN country TEXT DEFAULT 'us';"); } catch { }
    try { await db.exec("ALTER TABLE processed_filings ADD COLUMN country TEXT DEFAULT 'us';"); } catch { }
    try { await db.exec("ALTER TABLE sec_news ADD COLUMN country TEXT DEFAULT 'us';"); } catch { }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_country ON hnwi_signals(country);"); } catch { }
    try {
      const pragma = await db.all("PRAGMA table_info(processed_filings)") as any[];
      const pkCols = pragma.filter(c => c.pk > 0);
      if (pkCols.length > 0 && !pkCols.some(c => c.name === 'country')) {
        console.log("[Migration] Re-structuring processed_filings to include country in PRIMARY KEY...");
        await db.exec(`
          CREATE TABLE IF NOT EXISTS processed_filings_new (
            accession_number TEXT,
            form_type TEXT,
            dataset TEXT DEFAULT 'default',
            country TEXT DEFAULT 'us',
            processed_at DATETIME DEFAULT (datetime('now')),
            PRIMARY KEY (accession_number, dataset, country)
          );
        `);
        await db.exec("INSERT OR IGNORE INTO processed_filings_new (accession_number, form_type, dataset, country, processed_at) SELECT accession_number, form_type, COALESCE(dataset, 'default'), 'us', processed_at FROM processed_filings;");
        await db.exec("DROP TABLE processed_filings;");
        await db.exec("ALTER TABLE processed_filings_new RENAME TO processed_filings;");
        console.log("[Migration] processed_filings country primary key migration completed successfully.");
      }
    } catch (err) {
      console.error("[Migration Error on processed_filings PK]", err);
    }
  } catch (err) {
    console.error('[Seed Error] Failed to seed SBA signals:', (err as Error).message);
  } finally {
    if (db) await db.close();
  }
}

// Helper functions for cryptography and verification
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === checkHash;
}

function generateOTP(): string {
  return String(crypto.randomInt(100000, 999999));
}

// Session retriever helper
async function getSessionUser(req: express.Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }
  
  if (!token) return null;
  
  let authDb: any;
  try {
    authDb = getDatabaseConnection('auth.sqlite');
    await authDb.exec("PRAGMA busy_timeout = 5000;");
    const session = await authDb.get('SELECT email, expires_at FROM sessions WHERE token = ?', token) as { email: string; expires_at: number } | undefined;
    if (!session) return null;
    if (Date.now() > session.expires_at) {
      await authDb.run('DELETE FROM sessions WHERE token = ?', token);
      return null;
    }
    return session.email;
  } catch (err) {
    console.error('Session auth error:', err);
    return null;
  } finally {
    if (authDb) await authDb.close();
  }
}

// Safe database schema migrations helper
async function migrateDatabaseSchema(dbPath: string, country: string) {
  let db: any;
  try {
    db = getDatabaseConnection(dbPath);
    await db.exec("PRAGMA busy_timeout = 5000;");
    
    // 1. Check if user_email column exists in hnwi_signals
    const info = await db.all("PRAGMA table_info(hnwi_signals)") as any[];
    const hasUserEmail = info.some(c => c.name === 'user_email');
    
    if (!hasUserEmail) {
      console.log(`[Migration] Running user_email migration on ${dbPath}...`);
      try { await db.exec("ALTER TABLE hnwi_signals ADD COLUMN user_email TEXT DEFAULT 'master';"); } catch {}
      try { await db.exec("ALTER TABLE processed_filings ADD COLUMN user_email TEXT DEFAULT 'master';"); } catch {}
      try { await db.exec("ALTER TABLE sec_news ADD COLUMN user_email TEXT DEFAULT 'master';"); } catch {}
      console.log(`[Migration] Added user_email columns to ${dbPath}`);
    }

    // 2. Re-create processed_filings with PK including user_email
    const pragmaFiling = await db.all("PRAGMA table_info(processed_filings)") as any[];
    const pkFiling = pragmaFiling.filter(c => c.pk > 0);
    if (pkFiling.length > 0 && !pkFiling.some(c => c.name === 'user_email')) {
      console.log(`[Migration] Upgrading processed_filings primary key on ${dbPath}...`);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS processed_filings_new (
          accession_number TEXT,
          form_type TEXT,
          dataset TEXT DEFAULT 'default',
          country TEXT DEFAULT '${country}',
          processed_at DATETIME DEFAULT (datetime('now')),
          user_email TEXT DEFAULT 'master',
          PRIMARY KEY (accession_number, dataset, country, user_email)
        );
      `);
      await db.exec(`
        INSERT OR IGNORE INTO processed_filings_new 
        (accession_number, form_type, dataset, country, processed_at, user_email)
        SELECT accession_number, form_type, COALESCE(dataset, 'default'), COALESCE(country, '${country}'), processed_at, COALESCE(user_email, 'master')
        FROM processed_filings;
      `);
      await db.exec("DROP TABLE processed_filings;");
      await db.exec("ALTER TABLE processed_filings_new RENAME TO processed_filings;");
    }

    // 3. Re-create hnwi_signals with composite unique constraint (source_url, dataset, user_email)
    const indexes = await db.all("PRAGMA index_list(hnwi_signals)") as any[];
    let hasUniqueComposite = false;
    for (const idx of indexes) {
      const idxInfo = await db.all(`PRAGMA index_info(\`${idx.name}\`)`) as any[];
      const isMatch = idxInfo.some(c => c.name === 'source_url') && idxInfo.some(c => c.name === 'dataset') && idxInfo.some(c => c.name === 'user_email');
      if (isMatch) {
        hasUniqueComposite = true;
        break;
      }
    }

    if (!hasUniqueComposite) {
      console.log(`[Migration] Upgrading hnwi_signals unique constraints on ${dbPath}...`);
      if (country === 'uk') {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS hnwi_signals_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT,
            company_number TEXT,
            sic_codes TEXT,
            registered_address TEXT,
            ebitda_estimate TEXT,
            turnover TEXT,
            employees INTEGER DEFAULT 0,
            directors TEXT,
            owners_psc TEXT,
            decision_makers TEXT,
            urgency TEXT DEFAULT 'MEDIUM',
            signal_date TEXT,
            source_url TEXT,
            dataset TEXT DEFAULT 'default',
            country TEXT DEFAULT 'uk',
            injected_at TEXT DEFAULT (datetime('now', 'localtime')),
            user_email TEXT DEFAULT 'master',
            UNIQUE(source_url, dataset, user_email)
          );
        `);
        await db.exec(`
          INSERT OR IGNORE INTO hnwi_signals_new 
          (id, company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, dataset, country, injected_at, user_email)
          SELECT id, company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, COALESCE(dataset, 'default'), 'uk', injected_at, COALESCE(user_email, 'master')
          FROM hnwi_signals;
        `);
      } else {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS hnwi_signals_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT,
            ticker TEXT,
            insider_name TEXT,
            title TEXT,
            form_type TEXT,
            transaction_value REAL,
            sell_ratio REAL,
            urgency TEXT,
            signal_date TEXT,
            source_url TEXT,
            dataset TEXT DEFAULT 'default',
            country TEXT DEFAULT 'us',
            injected_at TEXT DEFAULT (datetime('now', 'localtime')),
            shares_sold REAL DEFAULT 0,
            shares_remaining REAL DEFAULT 0,
            user_email TEXT DEFAULT 'master',
            UNIQUE(source_url, dataset, user_email)
          );
        `);
        await db.exec(`
          INSERT OR IGNORE INTO hnwi_signals_new 
          (id, company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, dataset, country, injected_at, shares_sold, shares_remaining, user_email)
          SELECT id, company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, COALESCE(dataset, 'default'), 'us', injected_at, shares_sold, shares_remaining, COALESCE(user_email, 'master')
          FROM hnwi_signals;
        `);
      }
      await db.exec("DROP TABLE hnwi_signals;");
      await db.exec("ALTER TABLE hnwi_signals_new RENAME TO hnwi_signals;");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_country ON hnwi_signals(country);");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_dataset ON hnwi_signals(dataset);");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_user_email ON hnwi_signals(user_email);");
    }

    // 4. Re-create sec_news table to allow unique URL + dataset + user_email
    const newsIndexes = await db.all("PRAGMA index_list(sec_news)") as any[];
    let hasNewsComposite = false;
    for (const idx of newsIndexes) {
      const idxInfo = await db.all(`PRAGMA index_info(\`${idx.name}\`)`) as any[];
      const isMatch = idxInfo.some(c => c.name === 'url') && idxInfo.some(c => c.name === 'dataset') && idxInfo.some(c => c.name === 'user_email');
      if (isMatch) {
        hasNewsComposite = true;
        break;
      }
    }

    if (!hasNewsComposite) {
      console.log(`[Migration] Upgrading sec_news unique constraints on ${dbPath}...`);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sec_news_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_name TEXT,
          ticker TEXT,
          item_codes TEXT,
          url TEXT,
          published_at TEXT,
          dataset TEXT DEFAULT 'default',
          country TEXT DEFAULT '${country}',
          user_email TEXT DEFAULT 'master',
          UNIQUE(url, dataset, user_email)
        );
      `);
      await db.exec(`
        INSERT OR IGNORE INTO sec_news_new 
        (id, company_name, ticker, item_codes, url, published_at, dataset, country, user_email)
        SELECT id, company_name, ticker, item_codes, url, published_at, COALESCE(dataset, 'default'), COALESCE(country, '${country}'), COALESCE(user_email, 'master')
        FROM sec_news;
      `);
      await db.exec("DROP TABLE sec_news;");
      await db.exec("ALTER TABLE sec_news_new RENAME TO sec_news;");
    }
  } catch (err) {
    console.error(`[Migration Error on ${dbPath}]`, err);
  } finally {
    if (db) await db.close();
  }
}

// Master initialization routine
async function initializeSystem() {
  console.log('[SYS] Bootstrapping OSM system configurations...');

  if (process.env.DATABASE_URL) {
    console.log('[SYS] PostgreSQL mode detected. Running unified schema migrations on central database...');
    let db: any;
    try {
      db = getDatabaseConnection('master');
      
      // 1. Create tables with super-schema columns
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          email VARCHAR(255) PRIMARY KEY,
          password_hash TEXT,
          otp_code VARCHAR(10),
          otp_expires_at BIGINT,
          is_verified INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS sessions (
          token VARCHAR(255) PRIMARY KEY,
          email VARCHAR(255) REFERENCES users(email),
          expires_at BIGINT
        );
        
        CREATE TABLE IF NOT EXISTS processed_filings (
          accession_number VARCHAR(255),
          form_type VARCHAR(50),
          dataset VARCHAR(255) DEFAULT 'default',
          country VARCHAR(50) DEFAULT 'us',
          processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          user_email VARCHAR(255) DEFAULT 'master',
          PRIMARY KEY (accession_number, dataset, country, user_email)
        );
        
        CREATE TABLE IF NOT EXISTS hnwi_signals (
          id SERIAL PRIMARY KEY,
          company_name TEXT,
          company_number VARCHAR(100),
          sic_codes TEXT,
          registered_address TEXT,
          ebitda_estimate TEXT,
          turnover TEXT,
          employees INTEGER DEFAULT 0,
          directors TEXT,
          owners_psc TEXT,
          decision_makers TEXT,
          urgency VARCHAR(50) DEFAULT 'MEDIUM',
          signal_date VARCHAR(50),
          source_url TEXT,
          dataset VARCHAR(255) DEFAULT 'default',
          country VARCHAR(50) DEFAULT 'us',
          injected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ticker VARCHAR(50),
          insider_name TEXT,
          title TEXT,
          form_type VARCHAR(50),
          transaction_value REAL,
          sell_ratio REAL,
          shares_sold REAL DEFAULT 0,
          shares_remaining REAL DEFAULT 0,
          user_email VARCHAR(255) DEFAULT 'master',
          CONSTRAINT unique_source_dataset_user UNIQUE(source_url, dataset, user_email)
        );
        
        CREATE TABLE IF NOT EXISTS sec_news (
          id SERIAL PRIMARY KEY,
          company_name TEXT,
          ticker VARCHAR(50),
          item_codes TEXT,
          url TEXT,
          published_at VARCHAR(50),
          dataset VARCHAR(255) DEFAULT 'default',
          country VARCHAR(50) DEFAULT 'us',
          user_email VARCHAR(255) DEFAULT 'master',
          CONSTRAINT unique_url_dataset_user UNIQUE(url, dataset, user_email)
        );
      `);
      
      // 2. Create indexes
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_hnwi_country ON hnwi_signals(country);"); } catch (err) {}
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_hnwi_dataset ON hnwi_signals(dataset);"); } catch (err) {}
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_hnwi_user_email ON hnwi_signals(user_email);"); } catch (err) {}
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_news_country ON sec_news(country);"); } catch (err) {}
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_news_dataset ON sec_news(dataset);"); } catch (err) {}
      try { await db.exec("CREATE INDEX IF NOT EXISTS idx_news_user_email ON sec_news(user_email);"); } catch (err) {}

      // 3. Pre-seed master account
      const masterEmail = 'pandukusumautama@gmail.com';
      const masterPw = 'Pandu2008';
      const existingMaster = await db.get('SELECT email FROM users WHERE email = ?', [masterEmail]);
      if (!existingMaster) {
        const hash = hashPassword(masterPw);
        await db.run('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 1)', [masterEmail, hash]);
        console.log('[Postgres DB] Master account pre-seeded successfully.');
      }
      
      console.log('[Postgres DB] Unified schema migrations and seeding finished successfully!');
    } catch (err) {
      console.error('[Postgres DB Init Error]', err);
    } finally {
      if (db) await db.close();
    }
    
    console.log('[SYS] OSM Bootstrap complete. All systems online.');
    return;
  }

  // SQLite Fallback branch
  await seedSbaData();

  let authDb: any;
  try {
    authDb = getDatabaseConnection('auth.sqlite');
    await authDb.exec("PRAGMA busy_timeout = 5000;");
    await authDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password_hash TEXT,
        otp_code TEXT,
        otp_expires_at INTEGER,
        is_verified INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        email TEXT,
        expires_at INTEGER,
        FOREIGN KEY(email) REFERENCES users(email)
      );
    `);

    // Pre-seed master account
    const masterEmail = 'pandukusumautama@gmail.com';
    const masterPw = 'Pandu2008';
    const existingMaster = await authDb.get('SELECT email FROM users WHERE email = ?', masterEmail);
    if (!existingMaster) {
      const hash = hashPassword(masterPw);
      await authDb.run('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 1)', [masterEmail, hash]);
      console.log('[Auth DB] Master account pre-seeded successfully.');
    }
  } catch (err) {
    console.error('[Auth DB Init Error]', err);
  } finally {
    if (authDb) await authDb.close();
  }

  // Migrate US and UK databases
  if (existsSync('edgar_data.sqlite')) {
    await migrateDatabaseSchema('edgar_data.sqlite', 'us');
  } else {
    try {
      const db = getDatabase('us');
      await db.close();
      await migrateDatabaseSchema('edgar_data.sqlite', 'us');
    } catch {}
  }

  if (existsSync('edgar_data_uk.sqlite')) {
    await migrateDatabaseSchema('edgar_data_uk.sqlite', 'uk');
  } else {
    try {
      const db = getDatabase('uk');
      await db.close();
      await migrateDatabaseSchema('edgar_data_uk.sqlite', 'uk');
    } catch {}
  }
  
  console.log('[SYS] OSM Bootstrap complete. All systems online.');
}

// Helper to send emails
async function sendOTPEmail(email: string, otpCode: string): Promise<void> {
  const user = process.env.SMTP_USER || 'pandukusumautama@gmail.com';
  const pass = (process.env.SMTP_PASS || 'wzzf hrrn xtpd sfrr').replace(/\s+/g, '');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const mailOptions = {
    from: `"OSM System Node" <${user}>`,
    to: email,
    subject: 'Terminal Authorisation OTP Required',
    html: `
      <div style="background-color: #09090b; color: #f4f4f5; font-family: monospace; padding: 40px; text-align: center; border: 1px solid #27272a; border-radius: 8px; max-width: 500px; margin: 0 auto;">
        <div style="margin-bottom: 24px;">
          <span style="display: inline-block; width: 8px; height: 8px; background-color: #ffffff; border-radius: 50%; box-shadow: 0 0 8px #ffffff; margin-right: 8px;"></span>
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #71717a; font-weight: bold;">OSM Quantitative Node</span>
        </div>
        <h2 style="font-size: 20px; font-weight: bold; letter-spacing: 0.15em; color: #ffffff; margin: 0 0 16px 0; text-transform: uppercase;">TERMINAL ACCESS OTP</h2>
        <p style="font-size: 12px; color: #a1a1aa; line-height: 1.6; margin: 0 0 24px 0;">Use the 6-digit cryptographic verification code below to authorize your secure terminal connection. This code will expire in 5 minutes.</p>
        <div style="background-color: #020202; border: 1px solid #27272a; border-radius: 6px; padding: 16px; font-size: 32px; font-weight: bold; letter-spacing: 0.3em; color: #ffffff; margin: 0 auto 24px auto; width: fit-content; font-family: 'Courier New', monospace; box-shadow: inset 0 0 10px rgba(255,255,255,0.02);">
          ${otpCode}
        </div>
        <div style="font-size: 9px; color: #52525b; text-transform: uppercase; letter-spacing: 0.15em; border-top: 1px solid #18181b; padding-top: 16px;">
          SYSTEM: SECURE_STANDBY &bull; NODE_VERIFICATION_REQ
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Authentication Endpoint handlers
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  // Check master account exception rules
  if (cleanEmail === 'pandukusumautama@gmail.com' && password !== 'Pandu2008') {
    return res.status(400).json({ error: 'Master account password must be Pandu2008.' });
  }

  let authDb: any;
  try {
    authDb = getDatabaseConnection('auth.sqlite');
    await authDb.exec("PRAGMA busy_timeout = 5000;");

    const existing = await authDb.get('SELECT email, is_verified FROM users WHERE email = ?', cleanEmail) as { email: string; is_verified: number } | undefined;
    if (existing && existing.is_verified === 1) {
      return res.status(400).json({ error: 'Email is already registered. Please log in.' });
    }

    const otpCode = generateOTP();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000;
    const hash = hashPassword(password);

    console.log(`[SYS OTP MONITOR] Generated Signup OTP for ${cleanEmail} is: ${otpCode}`);

    if (existing) {
      await authDb.run('UPDATE users SET password_hash = ?, otp_code = ?, otp_expires_at = ?, is_verified = 0 WHERE email = ?', [hash, otpCode, otpExpiresAt, cleanEmail]);
    } else {
      await authDb.run('INSERT INTO users (email, password_hash, otp_code, otp_expires_at, is_verified) VALUES (?, ?, ?, ?, 0)', [cleanEmail, hash, otpCode, otpExpiresAt]);
    }

    // Fire-and-forget: dispatch email in the background without blocking the HTTP response
    sendOTPEmail(cleanEmail, otpCode)
      .then(() => {
        console.log(`[SMTP] Email successfully dispatched to ${cleanEmail}`);
      })
      .catch((err) => {
        console.warn(`[SMTP Send Fallback Warning] Gmail SMTP offline. Error: ${err.message}`);
      });

    // Respond immediately to the frontend so the transition to the OTP input screen is instant
    res.json({ 
      success: true, 
      message: 'A secure 6-digit access code has been dispatched.' 
    });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (authDb) await authDb.close();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Enforce master account exception PW checks
  if (cleanEmail === 'pandukusumautama@gmail.com' && password !== 'Pandu2008') {
    return res.status(401).json({ error: 'Invalid master credentials.' });
  }

  let authDb: any;
  try {
    authDb = getDatabaseConnection('auth.sqlite');
    await authDb.exec("PRAGMA busy_timeout = 5000;");

    const user = await authDb.get('SELECT email, password_hash, is_verified FROM users WHERE email = ?', cleanEmail) as { email: string; password_hash: string; is_verified: number } | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const otpCode = generateOTP();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000;

    console.log(`[SYS OTP MONITOR] Generated Login OTP for ${cleanEmail} is: ${otpCode}`);

    await authDb.run('UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE email = ?', [otpCode, otpExpiresAt, cleanEmail]);

    // Fire-and-forget: dispatch email in the background without blocking the HTTP response
    sendOTPEmail(cleanEmail, otpCode)
      .then(() => {
        console.log(`[SMTP] Email successfully dispatched to ${cleanEmail}`);
      })
      .catch((err) => {
        console.warn(`[SMTP Send Fallback Warning] Gmail SMTP offline. Error: ${err.message}`);
      });

    // Respond immediately to the frontend so the transition to the OTP input screen is instant
    res.json({ 
      success: true, 
      message: 'A secure 6-digit access code has been dispatched.' 
    });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (authDb) await authDb.close();
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otpCode } = req.body as { email?: string; otpCode?: string };
  if (!email || !otpCode || typeof email !== 'string' || typeof otpCode !== 'string') {
    return res.status(400).json({ error: 'Email and OTP code are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = otpCode.trim();

  let authDb: any;
  try {
    authDb = getDatabaseConnection('auth.sqlite');
    await authDb.exec("PRAGMA busy_timeout = 5000;");

    const user = await authDb.get('SELECT email, otp_code, otp_expires_at FROM users WHERE email = ?', cleanEmail) as { email: string; otp_code: string; otp_expires_at: number } | undefined;
    if (!user || !user.otp_code) {
      return res.status(401).json({ error: 'Invalid verification request.' });
    }

    if (user.otp_code !== cleanOtp) {
      return res.status(401).json({ error: 'Invalid OTP code.' });
    }

    if (Date.now() > user.otp_expires_at) {
      return res.status(401).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Auth succeeded! Clear OTP, set verified, create session token
    await authDb.run('UPDATE users SET otp_code = NULL, otp_expires_at = NULL, is_verified = 1 WHERE email = ?', cleanEmail);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 Hours

    await authDb.run('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)', [token, cleanEmail, expiresAt]);

    const isMaster = cleanEmail === 'pandukusumautama@gmail.com';
    res.json({
      success: true,
      token,
      email: cleanEmail,
      isMaster
    });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (authDb) await authDb.close();
  }
});

app.get(['/', '/dashboard', '/dashboard/:country', '/library'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

function getDatabase(country: string): DbClient {
  const c = String(country || 'us').toLowerCase();
  const dbPath = c === 'uk' ? 'edgar_data_uk.sqlite' : 'edgar_data.sqlite';
  return getDatabaseConnection(dbPath);
}

app.get('/api/datasets', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const country = String(req.query.country || 'us').toLowerCase();
  let db: any;
  try {
    db = getDatabase(country);
    let rows: { dataset: string }[] = [];
    if (isMaster) {
      rows = await db.all(`
        SELECT DISTINCT dataset FROM hnwi_signals WHERE country = ?
        UNION
        SELECT DISTINCT dataset FROM processed_filings WHERE country = ?
      `, [country, country]) as { dataset: string }[];
    } else {
      rows = await db.all(`
        SELECT DISTINCT dataset FROM hnwi_signals WHERE country = ? AND user_email = ?
        UNION
        SELECT DISTINCT dataset FROM processed_filings WHERE country = ? AND user_email = ?
      `, [country, userEmail, country, userEmail]) as { dataset: string }[];
    }
    const datasets = Array.from(new Set(rows.map(r => r.dataset).filter(Boolean)));

    if (isMaster && !datasets.includes('default')) {
      datasets.unshift('default');
    }
    res.json(datasets);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.get('/api/signals', async (req, res) => {
  const userEmail = await getSessionUser(req) || 'master'; // Fallback to 'master' for public marquee feed
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const lane = req.query.lane || 'sec';
  const dataset = req.query.dataset || 'default';
  const country = String(req.query.country || 'us').toLowerCase();
  let db: any;
  try {
    db = getDatabase(country);

    let query = '';
    let params: any[] = [];

    if (country === 'uk') {
      if (dataset === 'all') {
        if (isMaster) {
          query = `
            SELECT * FROM hnwi_signals 
            WHERE country = ?
            ORDER BY 
              CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
              signal_date DESC
          `;
          params = [country];
        } else {
          query = `
            SELECT * FROM hnwi_signals 
            WHERE country = ? AND user_email = ?
            ORDER BY 
              CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
              signal_date DESC
          `;
          params = [country, userEmail];
        }
      } else {
        if (isMaster) {
          query = `
            SELECT * FROM hnwi_signals 
            WHERE dataset = ? AND country = ?
            ORDER BY 
              CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
              signal_date DESC
          `;
          params = [dataset, country];
        } else {
          query = `
            SELECT * FROM hnwi_signals 
            WHERE dataset = ? AND country = ? AND user_email = ?
            ORDER BY 
              CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
              signal_date DESC
          `;
          params = [dataset, country, userEmail];
        }
      }
    } else {
      if (lane === 'sec') {
        if (dataset === 'all') {
          if (isMaster) {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type IN ('4', '144') AND country = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [country];
          } else {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type IN ('4', '144') AND country = ? AND user_email = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [country, userEmail];
          }
        } else {
          if (isMaster) {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type IN ('4', '144') AND dataset = ? AND country = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [dataset, country];
          } else {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type IN ('4', '144') AND dataset = ? AND country = ? AND user_email = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [dataset, country, userEmail];
          }
        }
      } else {
        if (dataset === 'all') {
          if (isMaster) {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type = 'SBA' AND country = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [country];
          } else {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type = 'SBA' AND country = ? AND user_email = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [country, userEmail];
          }
        } else {
          if (isMaster) {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type = 'SBA' AND dataset = ? AND country = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [dataset, country];
          } else {
            query = `
              SELECT * FROM hnwi_signals 
              WHERE form_type = 'SBA' AND dataset = ? AND country = ? AND user_email = ?
              ORDER BY 
                CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                signal_date DESC
            `;
            params = [dataset, country, userEmail];
          }
        }
      }
    }

    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

let lastNewsScrapeTime = 0;

app.get('/api/news', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const dataset = req.query.dataset || 'default';
  const country = String(req.query.country || 'us').toLowerCase();
  let db: any;
  try {
    db = getDatabase(country);
    
    // Trigger auto background scrape if 5 minutes have passed since last one
    const now = Date.now();
    if (now - lastNewsScrapeTime > 5 * 60 * 1000) {
      lastNewsScrapeTime = now;
      console.log(`[Auto Scrape] Triggering automatic background news scraping...`);
      
      const scraperProcess = spawn('npx', [
        'tsx', 'scraper.ts', 
        '--news-only', 
        `--dataset=global`,
        `--country=${country}`,
        `--user-email=${encodeURIComponent(userEmail)}`
      ], {
        cwd: process.cwd(),
        shell: true
      });

      scraperProcess.on('close', (code) => {
        console.log(`[Auto Scrape] Background news scraping finished with exit code ${code}`);
      });
      
      scraperProcess.stderr.on('data', (data) => {
        console.error(`[Auto Scrape Error] ${data.toString().trim()}`);
      });
    }

    // News is a global feed of market events, so return records matching the requested country & scope.
    // Standard accounts also receive the public master news feed so their dashboards are fully populated on startup!
    let query = '';
    let params: any[] = [];
    if (isMaster) {
      query = `SELECT * FROM sec_news WHERE country = ? ORDER BY published_at DESC LIMIT 100`;
      params = [country];
    } else {
      query = `SELECT * FROM sec_news WHERE country = ? AND (user_email = ? OR user_email = 'master') ORDER BY published_at DESC LIMIT 100`;
      params = [country, userEmail];
    }

    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.get('/api/stats', async (req, res) => {
  const userEmail = await getSessionUser(req) || 'master'; // Fallback to 'master' for public landing stats
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const dataset = req.query.dataset || 'default';
  const country = String(req.query.country || 'us').toLowerCase();
  let db: any;
  try {
    db = getDatabase(country);

    let filings: { n: number };
    let signals: { n: number };
    let secSignals: { n: number };
    let sbaSignals: { n: number };
    let urgencyBreakdown: { urgency: string; count: number }[];
    let formBreakdown: { form_type: string; count: number }[];

    if (country === 'uk') {
      if (dataset === 'all') {
        if (isMaster) {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE country = ?", [country]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE country = ?', [country]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ?
            GROUP BY urgency
          `, [country]) as { urgency: string; count: number }[];
        } else {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE country = ? AND user_email = ?", [country, userEmail]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE country = ? AND user_email = ?', [country, userEmail]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ? AND user_email = ?
            GROUP BY urgency
          `, [country, userEmail]) as { urgency: string; count: number }[];
        }
        secSignals = signals;
        sbaSignals = { n: 0 };
        formBreakdown = [];
      } else {
        if (isMaster) {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE dataset = ? AND country = ?", [dataset, country]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE dataset = ? AND country = ?', [dataset, country]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ?
            GROUP BY urgency
          `, [dataset, country]) as { urgency: string; count: number }[];
        } else {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE dataset = ? AND country = ? AND user_email = ?", [dataset, country, userEmail]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE dataset = ? AND country = ? AND user_email = ?', [dataset, country, userEmail]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ? AND user_email = ?
            GROUP BY urgency
          `, [dataset, country, userEmail]) as { urgency: string; count: number }[];
        }
        secSignals = signals;
        sbaSignals = { n: 0 };
        formBreakdown = [];
      }
    } else {
      if (dataset === 'all') {
        if (isMaster) {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE form_type != '8-K' AND country = ?", [country]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE country = ?', [country]) as { n: number };
          secSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type IN ('4', '144') AND country = ?", [country]) as { n: number };
          sbaSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type = 'SBA' AND country = ?", [country]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ?
            GROUP BY urgency
          `, [country]) as { urgency: string; count: number }[];
          formBreakdown = await db.all(`
            SELECT form_type, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ?
            GROUP BY form_type
          `, [country]) as { form_type: string; count: number }[];
        } else {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE form_type != '8-K' AND country = ? AND user_email = ?", [country, userEmail]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE country = ? AND user_email = ?', [country, userEmail]) as { n: number };
          secSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type IN ('4', '144') AND country = ? AND user_email = ?", [country, userEmail]) as { n: number };
          sbaSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type = 'SBA' AND country = ? AND user_email = ?", [country, userEmail]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ? AND user_email = ?
            GROUP BY urgency
          `, [country, userEmail]) as { urgency: string; count: number }[];
          formBreakdown = await db.all(`
            SELECT form_type, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE country = ? AND user_email = ?
            GROUP BY form_type
          `, [country, userEmail]) as { form_type: string; count: number }[];
        }
      } else {
        if (isMaster) {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE dataset = ? AND form_type != '8-K' AND country = ?", [dataset, country]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE dataset = ? AND country = ?', [dataset, country]) as { n: number };
          secSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type IN ('4', '144') AND dataset = ? AND country = ?", [dataset, country]) as { n: number };
          sbaSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type = 'SBA' AND dataset = ? AND country = ?", [dataset, country]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ?
            GROUP BY urgency
          `, [dataset, country]) as { urgency: string; count: number }[];
          formBreakdown = await db.all(`
            SELECT form_type, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ?
            GROUP BY form_type
          `, [dataset, country]) as { form_type: string; count: number }[];
        } else {
          filings = await db.get("SELECT COUNT(*) as n FROM processed_filings WHERE dataset = ? AND form_type != '8-K' AND country = ? AND user_email = ?", [dataset, country, userEmail]) as { n: number };
          signals = await db.get('SELECT COUNT(*) as n FROM hnwi_signals WHERE dataset = ? AND country = ? AND user_email = ?', [dataset, country, userEmail]) as { n: number };
          secSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type IN ('4', '144') AND dataset = ? AND country = ? AND user_email = ?", [dataset, country, userEmail]) as { n: number };
          sbaSignals = await db.get("SELECT COUNT(*) as n FROM hnwi_signals WHERE form_type = 'SBA' AND dataset = ? AND country = ? AND user_email = ?", [dataset, country, userEmail]) as { n: number };
          urgencyBreakdown = await db.all(`
            SELECT urgency, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ? AND user_email = ?
            GROUP BY urgency
          `, [dataset, country, userEmail]) as { urgency: string; count: number }[];
          formBreakdown = await db.all(`
            SELECT form_type, COUNT(*) as count 
            FROM hnwi_signals 
            WHERE dataset = ? AND country = ? AND user_email = ?
            GROUP BY form_type
          `, [dataset, country, userEmail]) as { form_type: string; count: number }[];
        }
      }
    }

    const result = {
      processed_filings: filings.n,
      signals_stored: signals.n,
      sec_signals: secSignals.n,
      sba_signals: sbaSignals.n,
      urgency_breakdown: urgencyBreakdown,
      form_breakdown: formBreakdown
    };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.get('/api/track', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'Unauthorized session.' }));
    res.end();
    return;
  }

  const dataset   = String(req.query.dataset   || 'default');
  const country   = String(req.query.country   || 'us');
  const startdate = req.query.startdate as string | undefined;
  const enddate   = req.query.enddate   as string | undefined;
  const query     = req.query.query     as string | undefined;
  const company   = req.query.company   as string | undefined;
  const ebitdaMin = req.query['ebitda-min'] as string | undefined;
  const ebitdaMax = req.query['ebitda-max'] as string | undefined;
  const apiKey    = req.query.apiKey    as string | undefined;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const dateInfo = startdate && enddate ? ` [DATE RANGE: ${startdate} → ${enddate}]` : ' [DATE RANGE: LIVE FEED (last 24h)]';
  res.write(`data: ${JSON.stringify({ type: 'log', message: `[SYS] Connected to live pipeline agent for dataset: "${dataset}" (${country.toUpperCase()})${dateInfo}` })}\n\n`);

  const scriptName = country === 'uk' ? 'scraper_uk.ts' : 'scraper.ts';
  console.log(`[Server] Spawning ${scriptName} for dataset: "${dataset}" (${country})${dateInfo} by user: ${userEmail}...`);

  const scraperArgs = [
    'tsx', scriptName, 
    `--dataset=${encodeURIComponent(String(dataset))}`,
    `--country=${encodeURIComponent(String(country))}`,
    `--user-email=${encodeURIComponent(userEmail)}`
  ];
  if (startdate && enddate) {
    scraperArgs.push(`--startdate=${startdate}`, `--enddate=${enddate}`);
  }
  if (query) {
    scraperArgs.push(`--query=${encodeURIComponent(query)}`);
  }
  if (company) {
    scraperArgs.push(`--company=${encodeURIComponent(company)}`);
  }
  if (ebitdaMin) {
    scraperArgs.push(`--ebitda-min=${ebitdaMin}`);
  }
  if (ebitdaMax) {
    scraperArgs.push(`--ebitda-max=${ebitdaMax}`);
  }

  const spawnEnv = { ...process.env };
  if (apiKey) {
    spawnEnv.COMPANIES_HOUSE_API_KEY = apiKey;
  }

  const scraperProcess = spawn('npx', scraperArgs, {
    cwd: process.cwd(),
    shell: true,
    env: spawnEnv
  });

  scraperProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine) {
        res.write(`data: ${JSON.stringify({ type: 'log', message: cleanLine })}\n\n`);
      }
    }
  });

  scraperProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: cleanLine })}\n\n`);
      }
    }
  });

  scraperProcess.on('close', (code) => {
    console.log(`[Server] Scraper process completed with exit code ${code}`);
    res.write(`data: ${JSON.stringify({ type: 'complete', code })}\n\n`);
    res.end();
  });
});

app.get('/api/export', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const dataset = req.query.dataset || 'default';
  const country = String(req.query.country || 'us').toLowerCase();
  if (isScraperRunning()) {
    return res.status(503).json({ error: 'Scraper is currently running. Export will be available when extraction completes.' });
  }
  let db: any;
  try {
    db = getDatabase(country);

    let query = '';
    if (country === 'uk') {
      query = `
        SELECT
          company_name,
          company_number,
          sic_codes,
          registered_address,
          ebitda_estimate,
          turnover,
          employees,
          directors,
          owners_psc,
          decision_makers,
          urgency                      AS urgency_score,
          source_url                   AS company_url,
          signal_date,
          dataset,
          injected_at
        FROM hnwi_signals
        WHERE country = ?
      `;
    } else {
      query = `
        SELECT
          company_name, ticker, insider_name, title, form_type,
          ROUND(CAST(transaction_value AS numeric), 2)  AS transaction_value,
          ROUND(CAST(sell_ratio AS numeric), 4)         AS sell_ratio,
          urgency                      AS urgency_score,
          source_url                   AS filing_url,
          signal_date,
          dataset,
          injected_at
        FROM hnwi_signals
        WHERE country = ?
      `;
    }
    let params: any[] = [country];

    if (dataset !== 'all') {
      query += ` AND dataset = ? `;
      params.push(dataset);
    }

    if (!isMaster) {
      query += ` AND user_email = ? `;
      params.push(userEmail);
    }

    query += `
      ORDER BY
        CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        signal_date DESC
    `;

    const rows = await db.all(query, params) as Record<string, unknown>[];

    if (rows.length === 0) {
      return res.status(404).json({ error: `No signals found in dataset: "${dataset}" to export.` });
    }

    const cols = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const csv = [
      cols.join(','),
      ...rows.map(r => cols.map(c => escape(r[c])).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="output_signals_${dataset}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.delete('/api/signals/:id', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const signalId = req.params.id;
  const country = String(req.query.country || 'us').toLowerCase();
  let db: any;
  try {
    db = getDatabase(country);

    let result;
    if (isMaster) {
      result = await db.run('DELETE FROM hnwi_signals WHERE id = ?', signalId);
    } else {
      result = await db.run('DELETE FROM hnwi_signals WHERE id = ? AND user_email = ?', [signalId, userEmail]);
    }

    if (result.changes > 0) {
      res.json({ success: true, message: `Signal ${signalId} deleted successfully.` });
    } else {
      res.status(404).json({ error: `Signal ${signalId} not found.` });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.delete('/api/dataset/:dataset', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const { dataset } = req.params;
  const country = String(req.query.country || 'us').toLowerCase();
  if (!dataset) {
    return res.status(400).json({ error: 'Dataset name is required.' });
  }
  let db: any;
  try {
    db = getDatabase(country);
    if (isMaster) {
      await db.run('DELETE FROM hnwi_signals WHERE dataset = ? AND country = ?', [dataset, country]);
      await db.run('DELETE FROM processed_filings WHERE dataset = ? AND country = ?', [dataset, country]);
    } else {
      await db.run('DELETE FROM hnwi_signals WHERE dataset = ? AND country = ? AND user_email = ?', [dataset, country, userEmail]);
      await db.run('DELETE FROM processed_filings WHERE dataset = ? AND country = ? AND user_email = ?', [dataset, country, userEmail]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.post('/api/merge', async (req, res) => {
  const userEmail = await getSessionUser(req);
  if (!userEmail) return res.status(401).json({ error: 'Unauthorized session.' });
  const isMaster = userEmail === 'pandukusumautama@gmail.com';

  const { source, target, country = 'us' } = req.body as { source: string; target: string; country?: string };
  if (!source || !target) {
    return res.status(400).json({ error: 'source and target dataset names are required.' });
  }
  let db: any;
  try {
    db = getDatabase(country);

    if (isMaster) {
      await db.run(`
        INSERT OR IGNORE INTO processed_filings (accession_number, form_type, processed_at, dataset, country)
        SELECT accession_number, form_type, processed_at, ?, ?
        FROM processed_filings WHERE dataset = ? AND country = ?
      `, [target, country, source, country]);

      if (String(country).toLowerCase() === 'uk') {
        await db.run(`
          INSERT INTO hnwi_signals
            (company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, dataset, country, injected_at)
          SELECT company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, ?, ?, COALESCE(injected_at, datetime('now', 'localtime'))
          FROM hnwi_signals s1
          WHERE s1.dataset = ? AND s1.country = ?
            AND NOT EXISTS (
              SELECT 1 FROM hnwi_signals s2
              WHERE s2.dataset = ? AND s2.country = ? AND s2.source_url = s1.source_url
            )
        `, [target, country, source, country, target, country]);
      } else {
        await db.run(`
          INSERT INTO hnwi_signals
            (company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, dataset, country, injected_at)
          SELECT company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, ?, ?, COALESCE(injected_at, datetime('now', 'localtime'))
          FROM hnwi_signals s1
          WHERE s1.dataset = ? AND s1.country = ?
            AND NOT EXISTS (
              SELECT 1 FROM hnwi_signals s2
              WHERE s2.dataset = ? AND s2.country = ? AND s2.source_url = s1.source_url
            )
        `, [target, country, source, country, target, country]);
      }
    } else {
      // Restrict merge operations exclusively to the authenticated user's records
      await db.run(`
        INSERT OR IGNORE INTO processed_filings (accession_number, form_type, processed_at, dataset, country, user_email)
        SELECT accession_number, form_type, processed_at, ?, ?, ?
        FROM processed_filings WHERE dataset = ? AND country = ? AND user_email = ?
      `, [target, country, userEmail, source, country, userEmail]);

      if (String(country).toLowerCase() === 'uk') {
        await db.run(`
          INSERT INTO hnwi_signals
            (company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, dataset, country, injected_at, user_email)
          SELECT company_name, company_number, sic_codes, registered_address, ebitda_estimate, turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, ?, ?, COALESCE(injected_at, datetime('now', 'localtime')), ?
          FROM hnwi_signals s1
          WHERE s1.dataset = ? AND s1.country = ? AND s1.user_email = ?
            AND NOT EXISTS (
              SELECT 1 FROM hnwi_signals s2
              WHERE s2.dataset = ? AND s2.country = ? AND s2.source_url = s1.source_url AND s2.user_email = ?
            )
        `, [target, country, userEmail, source, country, userEmail, target, country, userEmail]);
      } else {
        await db.run(`
          INSERT INTO hnwi_signals
            (company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, dataset, country, injected_at, user_email)
          SELECT company_name, ticker, insider_name, title, form_type, transaction_value, sell_ratio, urgency, signal_date, source_url, ?, ?, COALESCE(injected_at, datetime('now', 'localtime')), ?
          FROM hnwi_signals s1
          WHERE s1.dataset = ? AND s1.country = ? AND s1.user_email = ?
            AND NOT EXISTS (
              SELECT 1 FROM hnwi_signals s2
              WHERE s2.dataset = ? AND s2.country = ? AND s2.source_url = s1.source_url AND s2.user_email = ?
            )
        `, [target, country, userEmail, source, country, userEmail, target, country, userEmail]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (db) await db.close();
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ isRunning: isScraperRunning() });
});

app.listen(PORT, () => {
  initializeSystem();
  console.log(`=======================================================`);
  console.log(`  OSM INTELLIGENCE SYSTEM SERVER RUNNING AT:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
