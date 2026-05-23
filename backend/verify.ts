import { Database } from 'node-sqlite3-wasm';
import { existsSync, rmSync } from 'fs';

console.log("=== COMPREHENSIVE DATABASE INSPECTION ===");

function inspectDb(dbName: string) {
  console.log(`\n================== ${dbName.toUpperCase()} ==================`);
  try {
    if (existsSync(`${dbName}.lock`)) {
      rmSync(`${dbName}.lock`, { recursive: true, force: true });
    }
  } catch (err) {}

  if (!existsSync(dbName)) {
    console.log(`Database file ${dbName} does not exist.`);
    return;
  }

  let db: any;
  try {
    db = new Database(dbName);
    db.exec("PRAGMA busy_timeout = 5000;");

    // Check tables
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'") as { name: string }[];
    console.log("Tables:", tables.map(t => t.name).join(", "));

    if (tables.some(t => t.name === 'hnwi_signals')) {
      const totalSignals = db.get("SELECT COUNT(*) as n FROM hnwi_signals") as { n: number };
      console.log("Total HNWI Signals:", totalSignals.n);

      const datasets = db.all("SELECT dataset, country, COUNT(*) as count FROM hnwi_signals GROUP BY dataset, country") as any[];
      console.log("Datasets in hnwi_signals:", datasets);

      const sample = db.all("SELECT id, company_name, dataset, country, urgency, signal_date FROM hnwi_signals ORDER BY id DESC LIMIT 5") as any[];
      console.log("Latest 5 Signals:");
      sample.forEach(s => console.log(`  [ID: ${s.id}] ${s.company_name} | Dataset: ${s.dataset} | Country: ${s.country} | Urgency: ${s.urgency} | Date: ${s.signal_date}`));
    } else {
      console.log("Table 'hnwi_signals' does not exist.");
    }

    if (tables.some(t => t.name === 'processed_filings')) {
      const totalFilings = db.get("SELECT COUNT(*) as n FROM processed_filings") as { n: number };
      console.log("Total Processed Filings:", totalFilings.n);

      const datasets = db.all("SELECT dataset, country, COUNT(*) as count FROM processed_filings GROUP BY dataset, country") as any[];
      console.log("Datasets in processed_filings:", datasets);
    }

    if (tables.some(t => t.name === 'sec_news')) {
      const totalNews = db.get("SELECT COUNT(*) as n FROM sec_news") as { n: number };
      console.log("Total News Feed items:", totalNews.n);

      const datasets = db.all("SELECT dataset, country, COUNT(*) as count FROM sec_news GROUP BY dataset, country") as any[];
      console.log("Datasets in sec_news:", datasets);

      const newsSample = db.all("SELECT id, company_name, dataset, country FROM sec_news LIMIT 3") as any[];
      console.log("News Sample:", newsSample);
    }

  } catch (err) {
    console.error(`Error inspecting ${dbName}:`, err);
  } finally {
    if (db) db.close();
  }
}

inspectDb('edgar_data.sqlite');
inspectDb('edgar_data_uk.sqlite');

