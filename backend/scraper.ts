import { getDatabaseConnection } from './db';

// Load environment variables manually from root .env
function loadDotenv() {
  const paths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env')
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8');
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
        break;
      } catch (err) {}
    }
  }
}

loadDotenv();
import Bottleneck from 'bottleneck';
import { XMLParser } from 'fast-xml-parser';
import { writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const datasetArg = process.argv.find(arg => arg.startsWith('--dataset='));
const datasetName = datasetArg ? decodeURIComponent(datasetArg.split('=')[1]).replace(/['"]/g, '').trim() : 'default';

const countryArg = process.argv.find(arg => arg.startsWith('--country='));
const countryName = countryArg ? decodeURIComponent(countryArg.split('=')[1]).replace(/['"]/g, '').trim() : 'us';

const userEmailArg = process.argv.find(arg => arg.startsWith('--user-email='));
const userEmail = userEmailArg ? decodeURIComponent(userEmailArg.split('=')[1]).replace(/['"]/g, '').trim() : 'master';

if (countryName === 'uk') {
  console.log(`[SYS] Redirecting UK crawl request to scraper_uk.ts...`);
  const args = process.argv.slice(2);
  const result = spawnSync('npx', ['tsx', 'scraper_uk.ts', ...args], {
    stdio: 'inherit',
    shell: true
  });
  process.exit(result.status ?? 0);
}

const startDateArg = process.argv.find(arg => arg.startsWith('--startdate='));
const endDateArg = process.argv.find(arg => arg.startsWith('--enddate='));
const customStartDate: string | null = startDateArg ? startDateArg.split('=')[1].replace(/['"]/g, '').trim() || null : null;
const customEndDate: string | null = endDateArg ? endDateArg.split('=')[1].replace(/['"]/g, '').trim() || null : null;
const newsOnly = process.argv.includes('--news-only');

console.log(`[SYS] Active Dataset Target: "${datasetName}" | Country: "${countryName}"`);
if (customStartDate && customEndDate) {
  console.log(`[SYS] Date Window: ${customStartDate} → ${customEndDate}`);
} else {
  console.log('[SYS] Date Window: rolling 24h (default)');
}

const dbPath = countryName === 'uk' ? 'edgar_data_uk.sqlite' : 'edgar_data.sqlite';

try {
  if (existsSync(`${dbPath}.lock`)) {
    rmSync(`${dbPath}.lock`, { recursive: true, force: true });
  }
} catch (err) {}


async function main() {
  const db = getDatabaseConnection(dbPath);
  await db.exec("PRAGMA busy_timeout = 5000;");
  if (countryName === 'uk') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS processed_filings (
        accession_number TEXT,
        form_type TEXT,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'uk',
        processed_at DATETIME DEFAULT (datetime('now')),
        PRIMARY KEY (accession_number, dataset, country)
      );
      CREATE TABLE IF NOT EXISTS hnwi_signals (
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
        source_url TEXT UNIQUE,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'uk',
        injected_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS sec_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT,
        ticker TEXT,
        item_codes TEXT,
        url TEXT UNIQUE,
        published_at TEXT,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'uk'
      );
    `);
    try {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_country ON hnwi_signals(country);");
    } catch (err) {}
    try {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_dataset ON hnwi_signals(dataset);");
    } catch (err) {}
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS processed_filings (
        accession_number TEXT,
        form_type TEXT,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'us',
        processed_at DATETIME DEFAULT (datetime('now')),
        PRIMARY KEY (accession_number, dataset, country)
      );
      CREATE TABLE IF NOT EXISTS hnwi_signals (
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
        source_url TEXT UNIQUE,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'us',
        injected_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS sec_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT,
        ticker TEXT,
        item_codes TEXT,
        url TEXT UNIQUE,
        published_at TEXT,
        dataset TEXT DEFAULT 'default',
        country TEXT DEFAULT 'us'
      );
    `);
    try {
      await db.exec("ALTER TABLE hnwi_signals ADD COLUMN dataset TEXT DEFAULT 'default';");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE hnwi_signals ADD COLUMN country TEXT DEFAULT 'us';");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE processed_filings ADD COLUMN country TEXT DEFAULT 'us';");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE sec_news ADD COLUMN country TEXT DEFAULT 'us';");
    } catch (err) {}
    try {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_country ON hnwi_signals(country);");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE hnwi_signals ADD COLUMN injected_at TEXT;");
    } catch (err) {}
    try {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_dataset ON hnwi_signals(dataset);");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE hnwi_signals ADD COLUMN shares_sold REAL DEFAULT 0;");
    } catch (err) {}
    try {
      await db.exec("ALTER TABLE hnwi_signals ADD COLUMN shares_remaining REAL DEFAULT 0;");
    } catch (err) {}
  
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
  
    try {
      await db.exec("ALTER TABLE processed_filings ADD COLUMN dataset TEXT DEFAULT 'default';");
    } catch (err) {}
  }
  
  
  
  process.on('SIGINT', async () => {
    try { await db.close(); } catch {}
    process.exit(0);
  });
  
  const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 200 });
  
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  
  const fetchSEC = limiter.wrap(async (url: string): Promise<string> => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ValiverSystem/1.0 (admin@valiver.ai)',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    if (res.status === 429) throw new Error('HTTP 429: rate limit — back off');
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
    return res.text();
  });
  
  const fetchSECSoft = limiter.wrap(async (url: string): Promise<string | null> => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ValiverSystem/1.0 (admin@valiver.ai)',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    if (res.status === 429) throw new Error('HTTP 429: rate limit — back off');
    if (res.status >= 500) {
      console.warn(`[warn] HTTP ${res.status} — stopping pagination`);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
    return res.text();
  });
  
  function accessionFromUrn(urn: string): string | null {
    const parts = urn.split('=');
    return parts.length === 2 ? parts[1] : null;
  }
  
  function cikFromTitle(entryXml: string): string | null {
    const m = entryXml.match(/<title>[^<]*\((\d{10})\)/);
    if (!m) return null;
    return String(parseInt(m[1], 10));
  }
  
  function cikFromLink(entryXml: string): string | null {
    const m = entryXml.match(/href="https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d+)\//);
    return m ? m[1] : null;
  }
  
  function parseNum(v: unknown): number {
    const n = parseFloat(String(v ?? '0'));
    return isNaN(n) ? 0 : n;
  }
  
  function ensureString(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) {
      return ensureString(v[0]);
    }
    if (typeof v === 'object') {
      if ('#text' in v) return ensureString((v as any)['#text']);
      return '';
    }
    return String(v);
  }
  
  function classifyUrgency(sellRatio: number, txValue: number): string {
    if (sellRatio > 0.5 || txValue > 10_000_000) return 'CRITICAL';
    if (sellRatio > 0.2 || txValue > 1_000_000) return 'HIGH';
    if (sellRatio >= 0.05) return 'MEDIUM';
    return 'LOW';
  }
  
  function buildWindowUrl(base: string): string {
    const ts = Math.floor(Date.now() / 1000);
    if (customStartDate && customEndDate) {
      return `${base}&dateRange=custom&startdt=${customStartDate}&enddt=${customEndDate}&ts=${ts}`;
    }
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return `${base}&dateRange=custom&startdt=${fmt(yesterday)}&enddt=${fmt(now)}&ts=${ts}`;
  }
  
  let checkStmt: any;
  let insertFilingStmt: any;
  let insertSignalStmt: any;
  let insertNewsStmt: any;
  
  async function runForm4Pipeline(): Promise<void> {
    console.log('\n[Form 4] Reading live feed...');
  
    const ts = Math.floor(Date.now() / 1000);
    const form4BaseUrl = customStartDate && customEndDate
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom&dateRange=custom&startdt=${customStartDate}&enddt=${customEndDate}&ts=${ts}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom&ts=${ts}`;
  
    const feedXml = await fetchSEC(form4BaseUrl);
  
    const entries = [...feedXml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    console.log(`[Form 4] ${entries.length} entries in feed`);
  
    for (const [, entryXml] of entries) {
      const idMatch = entryXml.match(/<id>(.*?)<\/id>/);
      if (!idMatch) continue;
  
      const accessionNumber = accessionFromUrn(idMatch[1]);
      if (!accessionNumber) continue;
  
      const cik = cikFromTitle(entryXml);
      if (!cik) {
        console.warn(`[Form 4] Cannot extract CIK from title for: ${accessionNumber}`);
        continue;
      }
  
      if (await checkStmt.get([accessionNumber, datasetName, countryName, userEmail])) continue;
  
      const accNoDash = accessionNumber.replace(/-/g, '');
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${accessionNumber}.txt`;
  
      try {
        const rawText = await fetchSEC(filingUrl);
        const xmlBlock = rawText.match(/<XML>([\s\S]*?)<\/XML>/i);
        if (!xmlBlock) { await insertFilingStmt.run([accessionNumber, '4', datasetName, countryName, userEmail]); continue; }
  
        const doc = parser.parse(xmlBlock[1])?.ownershipDocument;
        if (!doc) { await insertFilingStmt.run([accessionNumber, '4', datasetName, countryName, userEmail]); continue; }
  
        const companyName: string = ensureString(doc.issuer?.issuerName);
        const ticker: string = ensureString(doc.issuer?.issuerTradingSymbol);
        const insiderName: string = ensureString(doc.reportingOwner?.reportingOwnerId?.rptOwnerName);
        const insiderTitle: string = ensureString(
          doc.reportingOwner?.reportingOwnerRelationship?.officerTitle ?? 'Director'
        );
  
        const signalDate: string = ensureString(doc.periodOfReport) || new Date().toISOString().split('T')[0];
  
        let totalSharesSold = 0;
        let sharesRemaining = 0;
        let transactionValue = 0;
  
        const txns: unknown[] = [].concat(
          doc.nonDerivativeTable?.nonDerivativeTransaction ?? []
        );
  
        for (const t of txns as Record<string, unknown>[]) {
          const amounts = t.transactionAmounts as Record<string, unknown> | undefined;
          if (!amounts) continue;
          const code = (amounts.transactionAcquiredDisposedCode as Record<string, string>)?.value;
          if (code !== 'D') continue;
  
          const shares = parseNum((amounts.transactionShares as Record<string, unknown>)?.value);
          const price = parseNum((amounts.transactionPricePerShare as Record<string, unknown>)?.value);
          totalSharesSold += shares;
          transactionValue += shares * price;
  
          const post = t.postTransactionAmounts as Record<string, unknown> | undefined;
          sharesRemaining = parseNum(
            (post?.sharesOwnedFollowingTransaction as Record<string, unknown>)?.value
          );
        }
  
        if (totalSharesSold > 0 && transactionValue > 0) {
          const sellRatio = totalSharesSold / (totalSharesSold + sharesRemaining);
          if (sellRatio >= 0.05) {
            const urgency = classifyUrgency(sellRatio, transactionValue);
            await insertSignalStmt.run([
              companyName, ticker, insiderName, insiderTitle, '4',
              transactionValue, sellRatio, urgency, signalDate, filingUrl, datasetName, countryName,
              totalSharesSold, sharesRemaining, userEmail
            ]);
            console.log(
              `[Form 4] SIGNAL  ${insiderName} (${companyName}) ` +
              `ratio=${(sellRatio * 100).toFixed(1)}%  urgency=${urgency}`
            );
          }
        }
  
        await insertFilingStmt.run([accessionNumber, '4', datasetName, countryName, userEmail]);
      } catch (err) {
        console.error(`[Form 4] Failed ${accessionNumber}:`, (err as Error).message);
      }
    }
  
    console.log('[Form 4] Cycle complete.');
  }
  
  async function runForm144Pipeline(): Promise<void> {
    console.log('\n[Form 144] Reading live feed...');
  
    const ts = Math.floor(Date.now() / 1000);
    const form144BaseUrl = customStartDate && customEndDate
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=144&count=100&output=atom&dateRange=custom&startdt=${customStartDate}&enddt=${customEndDate}&ts=${ts}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=144&count=100&output=atom&ts=${ts}`;
  
    const feedXml = await fetchSEC(form144BaseUrl);
  
    const entries = [...feedXml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    console.log(`[Form 144] ${entries.length} entries in feed`);
  
    for (const [, entryXml] of entries) {
      const idMatch = entryXml.match(/<id>(.*?)<\/id>/);
      if (!idMatch) continue;
  
      const accessionNumber = accessionFromUrn(idMatch[1]);
      if (!accessionNumber) continue;
  
      const cik = cikFromTitle(entryXml);
      if (!cik) {
        console.warn(`[Form 144] Cannot extract CIK from title for: ${accessionNumber}`);
        continue;
      }
  
      if (await checkStmt.get([accessionNumber, datasetName, countryName, userEmail])) continue;
  
      const accNoDash = accessionNumber.replace(/-/g, '');
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${accessionNumber}.txt`;
  
      try {
        const rawText = await fetchSEC(filingUrl);
        const xmlBlock = rawText.match(/<XML>([\s\S]*?)<\/XML>/i);
        if (!xmlBlock) { await insertFilingStmt.run([accessionNumber, '144', datasetName, countryName, userEmail]); continue; }
  
        const root = parser.parse(xmlBlock[1])?.edgarSubmission?.formData;
        if (!root) { await insertFilingStmt.run([accessionNumber, '144', datasetName, countryName, userEmail]); continue; }
  
        const issuerInfo = root.issuerInfo ?? {};
        const secInfoList: any[] = [].concat(root.securitiesInformation ?? []);
        const primarySecInfo = secInfoList[0] ?? {};
  
        const companyName: string = ensureString(issuerInfo.issuerName);
        const insiderName: string = ensureString(
          issuerInfo.nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold
        );
        const relationship: string = ensureString(
          issuerInfo.relationshipsToIssuer?.relationshipToIssuer ?? 'Insider'
        );
  
        const signalDate: string =
          ensureString(primarySecInfo.dateOfSale) ||
          ensureString(root.signatureInfo?.dateSigned) ||
          new Date().toISOString().split('T')[0];
  
        let sharesSold = 0;
        let estimatedValue = 0;
        let outstandingShares = 0;
  
        for (const info of secInfoList) {
          sharesSold += parseNum(info.noOfUnitsSold) || parseNum(info.noOfSharesToClassToBeSold);
          estimatedValue += parseNum(info.aggregateMarketValue);
          outstandingShares = Math.max(outstandingShares, parseNum(info.noOfSharesOutstanding));
        }
  
        const sellRatio = outstandingShares > 0 ? (sharesSold / outstandingShares) : 0.05;
  
        if (sharesSold > 0 || estimatedValue > 0) {
          const urgency = classifyUrgency(sellRatio, estimatedValue);
          await insertSignalStmt.run([
            companyName, '', insiderName, relationship, '144',
            estimatedValue, sellRatio, urgency, signalDate, filingUrl, datasetName, countryName,
            sharesSold, outstandingShares - sharesSold, userEmail
          ]);
          console.log(
            `[Form 144] SIGNAL  ${insiderName} (${companyName}) ` +
            `shares=${sharesSold}  est_value=$${estimatedValue.toLocaleString()}  urgency=${urgency}`
          );
        }
  
        await insertFilingStmt.run([accessionNumber, '144', datasetName, countryName, userEmail]);
      } catch (err) {
        console.error(`[Form 144] Failed ${accessionNumber}:`, (err as Error).message);
      }
    }
  
    console.log('[Form 144] Cycle complete.');
  }
  
  async function run8KPipeline(): Promise<void> {
    console.log('\n[8-K] Running EFTS search...');
  
    const baseUrl =
      'https://efts.sec.gov/LATEST/search-index' +
      '?q=%22acquisition%22+OR+%22merger%22+OR+%22definitive+agreement%22' +
      '&forms=8-K';
  
    let offset = 0;
    const pageSize = 100;
    let totalProcessed = 0;
  
    while (true) {
      const url = buildWindowUrl(baseUrl) + `&from=${offset}&size=${pageSize}`;
  
      const rawText = await fetchSECSoft(url);
      if (rawText === null) break;
  
      const json = JSON.parse(rawText);
      const hits: Record<string, unknown>[] = (json?.hits?.hits as Record<string, unknown>[]) ?? [];
  
      if (hits.length === 0) break;
  
      for (const hit of hits) {
        const src = hit._source as Record<string, unknown>;
        const accessionNumber: string = (src.adsh as string) ?? '';
        if (!accessionNumber) continue;
  
        const items: string[] = (src.items as string[]) ?? [];
        if (!items.some(i => i === '1.01' || i === '2.01')) continue;
  
        if (await checkStmt.get([accessionNumber, datasetName, countryName, userEmail])) continue;
  
        const companyName: string =
          (src.display_names as string[])?.[0]?.split('(')[0]?.trim() ?? '';
        const ticker: string =
          ((src.display_names as string[])?.[0]?.match(/\(([A-Z]+)\)/)?.[1]) ?? '';
  
        const ciks: string[] = (src.ciks as string[]) ?? [];
        const cik = ciks[0]?.replace(/^0+/, '') ?? '';
        const accNoDash = accessionNumber.replace(/-/g, '');
        const filingUrl =
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${accessionNumber}-index.htm`;
        const signalDate: string =
          (src.file_date as string) || new Date().toISOString().split('T')[0];
  
        await insertNewsStmt.run([
          companyName, ticker, items.join(', '), filingUrl, signalDate, datasetName, countryName, userEmail
        ]);
        await insertFilingStmt.run([accessionNumber, '8-K', datasetName, countryName, userEmail]);
        totalProcessed++;
        console.log(`[8-K] NEWS    ${companyName}  items=${items.join(',')}  date=${signalDate}`);
      }
  
      if (hits.length < pageSize) break;
      offset += pageSize;
    }
  
    console.log(`[8-K] Cycle complete. ${totalProcessed} new signals.`);
  }
  
  async function exportCSV(): Promise<void> {
    const rows = await db.all(`
      SELECT
        company_name, ticker, insider_name, title, form_type,
        ROUND(CAST(transaction_value AS numeric), 2)  AS transaction_value,
        ROUND(CAST(sell_ratio AS numeric), 4)         AS sell_ratio,
        urgency                      AS urgency_score,
        source_url                   AS filing_url,
        signal_date
      FROM hnwi_signals
      WHERE dataset = ? AND country = ? AND user_email = ?
      ORDER BY
        CASE urgency WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        signal_date DESC
    `, [datasetName, countryName, userEmail]) as Record<string, unknown>[];
  
    if (rows.length === 0) return;
  
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
  
    writeFileSync('output_signals.csv', csv, 'utf8');
    console.log(`\nCSV exported: output_signals.csv (${rows.length} rows)`);
  }
  
  async function main(): Promise<void> {
    console.log(`SEC EDGAR HNWI Signal Scraper — ${new Date().toISOString()}`);
    try {
      checkStmt = db.prepare('SELECT 1 FROM processed_filings WHERE accession_number = ? AND dataset = ? AND country = ? AND user_email = ?');
      insertFilingStmt = db.prepare(
        'INSERT OR IGNORE INTO processed_filings (accession_number, form_type, dataset, country, user_email) VALUES (?, ?, ?, ?, ?)'
      );
      if (countryName === 'uk') {
        insertSignalStmt = db.prepare(`
          INSERT OR IGNORE INTO hnwi_signals
            (company_name, company_number, sic_codes, registered_address, ebitda_estimate,
             turnover, employees, directors, owners_psc, decision_makers, urgency, signal_date, source_url, dataset, country, injected_at, user_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
        `);
      } else {
        insertSignalStmt = db.prepare(`
          INSERT OR IGNORE INTO hnwi_signals
            (company_name, ticker, insider_name, title, form_type,
             transaction_value, sell_ratio, urgency, signal_date, source_url, dataset, country,
             shares_sold, shares_remaining, injected_at, user_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
        `);
      }
      insertNewsStmt = db.prepare(`
        INSERT OR IGNORE INTO sec_news
          (company_name, ticker, item_codes, url, published_at, dataset, country, user_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
  
      if (countryName === 'uk') {
        throw new Error('[SYS] Dedicated UK pipeline must be run via scraper_uk.ts. Interception failed.');
      } else {
        if (newsOnly) {
          console.log('[SYS] News-only mode active. Running 8-K pipeline...');
          await run8KPipeline();
        } else {
          await runForm4Pipeline();
          await runForm144Pipeline();
          await run8KPipeline();
          await exportCSV();
        }
      }
  
      const signalCount = (await db.get('SELECT COUNT(*) as n FROM hnwi_signals') as { n: number }).n;
      const filingCount = (await db.get('SELECT COUNT(*) as n FROM processed_filings') as { n: number }).n;
      const newsCount = (await db.get('SELECT COUNT(*) as n FROM sec_news') as { n: number }).n;
      console.log(`Done. Processed filings: ${filingCount}  |  Signals stored: ${signalCount}  |  News stored: ${newsCount}`);
    } finally {
      if (checkStmt) await checkStmt.finalize();
      if (insertFilingStmt) await insertFilingStmt.finalize();
      if (insertSignalStmt) await insertSignalStmt.finalize();
      if (insertNewsStmt) await insertNewsStmt.finalize();
      await db.close();
    }
  }
  
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
  
}
main().catch(err => {
  console.error('[FATAL SCRAPER ERROR]', err);
  process.exit(1);
});
