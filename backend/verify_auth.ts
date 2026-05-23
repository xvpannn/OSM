import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Database } from 'node-sqlite3-wasm';

// Load environmental variables
import { existsSync, readFileSync } from 'fs';
import path from 'path';

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

// 1. Password cryptography test
console.log('--- 1. Cryptography Verification ---');
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

const rawPw = 'Pandu2008';
const hashed = hashPassword(rawPw);
console.log(`Raw: "${rawPw}"`);
console.log(`Hashed format: ${hashed.substring(0, 30)}...`);
const isMatch = verifyPassword(rawPw, hashed);
const isMismatch = verifyPassword('WrongPw123', hashed);
console.log(`Match Check (should be true): ${isMatch}`);
console.log(`Mismatch Check (should be false): ${isMismatch}`);

if (isMatch && !isMismatch) {
  console.log('=> Cryptography test: SUCCESS');
} else {
  console.error('=> Cryptography test: FAILED');
}

// 2. SMTP Transport check
console.log('\n--- 2. SMTP Transport Verification ---');
const user = process.env.SMTP_USER || 'pandukusumautama@gmail.com';
const pass = (process.env.SMTP_PASS || 'wzzf hrrn xtpd sfrr').replace(/\s+/g, '');
console.log(`Config: User="${user}" Pass="${pass.substring(0, 4)} **** **** ****"`);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass }
});

console.log('Sending SMTP verify request to Google...');
transporter.verify((err, success) => {
  if (err) {
    console.error('=> SMTP Handshake: FAILED');
    console.error(err);
  } else {
    console.log('=> SMTP Handshake: SUCCESS (Server is ready to deliver messages)');
  }
});
