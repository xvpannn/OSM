const { Database } = require('node-sqlite3-wasm');
const fs = require('fs');

// ---------------------------------------------------------------------------
// DB LOCK CLEANUP ON STARTUP
// ---------------------------------------------------------------------------
try {
  if (fs.existsSync('edgar_data.sqlite.lock')) {
    fs.rmSync('edgar_data.sqlite.lock', { recursive: true, force: true });
  }
} catch (err) {}

let db;
try {
  db = new Database('edgar_data.sqlite');
  db.exec("PRAGMA busy_timeout = 5000;");

  const f = db.get('SELECT COUNT(*) n FROM processed_filings');
  const s = db.get('SELECT COUNT(*) n FROM hnwi_signals');
  console.log('processed_filings:', f.n);
  console.log('hnwi_signals     :', s.n);

  console.log('\n--- by form_type ---');
  db.all('SELECT form_type, COUNT(*) n FROM hnwi_signals GROUP BY form_type ORDER BY n DESC')
    .forEach(r => console.log(' ', r.form_type + ':', r.n));

  console.log('\n--- by urgency ---');
  db.all("SELECT urgency, COUNT(*) n FROM hnwi_signals GROUP BY urgency ORDER BY n DESC")
    .forEach(r => console.log(' ', r.urgency + ':', r.n));

  console.log('\n--- CRITICAL signals ---');
  db.all(
    "SELECT form_type, company_name, insider_name, ROUND(sell_ratio*100,1) pct, " +
    "ROUND(transaction_value) val, urgency FROM hnwi_signals WHERE urgency='CRITICAL'"
  ).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- Form 144 samples ---');
  db.all(
    "SELECT company_name, insider_name, ROUND(transaction_value) val, urgency " +
    "FROM hnwi_signals WHERE form_type='144' LIMIT 5"
  ).forEach(r => console.log(JSON.stringify(r)));

  const dupes = db.get(
    'SELECT COUNT(*) n FROM (SELECT accession_number FROM processed_filings GROUP BY accession_number HAVING COUNT(*) > 1)'
  );
  console.log('\nduplicates:', dupes.n, '(expected: 0)');

} catch (err) {
  if (err.message && err.message.includes('locked')) {
    console.error('[Error] DB locked — run: Remove-Item edgar_data.sqlite.lock');
  } else {
    console.error(err);
  }
} finally {
  if (db) db.close();
}
