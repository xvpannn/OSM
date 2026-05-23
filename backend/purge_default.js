const { Database } = require('node-sqlite3-wasm');
const fs = require('fs');

function purgeDb(dbFile) {
  if (!fs.existsSync(dbFile)) {
    console.log(`[PURGE] Database file ${dbFile} does not exist. Skipping.`);
    return;
  }

  let db;
  try {
    const lockFile = `${dbFile}.lock`;
    if (fs.existsSync(lockFile)) {
      fs.rmSync(lockFile, { recursive: true, force: true });
    }
    
    db = new Database(dbFile);
    db.exec('PRAGMA busy_timeout = 5000;');

    const s = db.run("DELETE FROM hnwi_signals WHERE dataset IN ('default', 'global') OR dataset IS NULL");
    const f = db.run("DELETE FROM processed_filings WHERE dataset IN ('default', 'global') OR dataset IS NULL");
    const n = db.run("DELETE FROM sec_news WHERE dataset IN ('default', 'global') OR dataset IS NULL");
    console.log(`[PURGE] ${dbFile}: Deleted ${s.changes} signal(s), ${f.changes} filing(s), and ${n.changes} news item(s) from dataset=default/global.`);
  } catch (err) {
    console.error(`[PURGE ERROR] Failed to purge ${dbFile}:`, err.message);
  } finally {
    if (db) db.close();
  }
}

console.log('=== STARTING DATABASE CLEANUP FOR STANDARD DEFAULT DATASETS ===');
purgeDb('edgar_data.sqlite');
purgeDb('edgar_data_uk.sqlite');
console.log('=== DATABASE CLEANUP COMPLETE ===');
