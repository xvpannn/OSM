const fs = require('fs');

try {
  if (fs.existsSync('edgar_data_uk.sqlite')) {
    fs.rmSync('edgar_data_uk.sqlite', { recursive: true, force: true });
    console.log('[CLEANUP] Successfully deleted edgar_data_uk.sqlite.');
  }
  if (fs.existsSync('edgar_data_uk.sqlite.lock')) {
    fs.rmSync('edgar_data_uk.sqlite.lock', { recursive: true, force: true });
    console.log('[CLEANUP] Successfully deleted edgar_data_uk.sqlite.lock.');
  }
  console.log('[CLEANUP] UK Database successfully cleaned. It will be re-created with the correct schema on startup.');
} catch (err) {
  console.error('[CLEANUP ERROR]', err.message);
}
