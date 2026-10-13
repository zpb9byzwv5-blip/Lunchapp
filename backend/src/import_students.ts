import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function sanitizeNfcUid(raw: string): string {
  return (raw || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

function parseFsmFlag(raw: string): boolean {
  const cleaned = (raw || '').trim().toUpperCase();
  return ['YES', 'Y', 'TRUE', '1', 'FSM'].includes(cleaned);
}

async function importStudentsCsv(csvFilePath: string) {
  if (!fs.existsSync(csvFilePath)) {
    console.error(`File not found: ${csvFilePath}`);
    process.exit(1);
  }
  const rawContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    console.error('CSV file is empty or only contains headers.');
    process.exit(1);
  }

  const client = await pool.connect();
  let importedCount = 0;
  let skippedCount = 0;

  try {
    await client.query('BEGIN');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length < 5) {
        skippedCount++;
        continue;
      }
      const email = cols[0].toLowerCase();
      const fullName = cols[1];
      const yearGroup = cols[2] || 'Unassigned';
      const nfcUid = sanitizeNfcUid(cols[3]);
      const isFsm = parseFsmFlag(cols[4]);
      const pinCode = (cols[5] || '0000').padStart(4, '0').slice(0, 4);
      const initialWalletPence = Math.max(0, parseInt(cols[6] || '0', 10) || 0);

      if (!email.includes('@') || !fullName || nfcUid.length < 4) {
        skippedCount++;
        continue;
      }

      await client.query(
        `INSERT INTO users (email, full_name, year_group, nfc_uid, is_fsm, pin_code, wallet_pence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (nfc_uid) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           year_group = EXCLUDED.year_group,
           is_fsm = EXCLUDED.is_fsm,
           pin_code = EXCLUDED.pin_code`,
        [email, fullName, yearGroup, nfcUid, isFsm, pinCode, initialWalletPence]
      );
      importedCount++;
    }
    await client.query('COMMIT');
    console.log(`CSV Import Complete: ${importedCount} students synced, ${skippedCount} rows skipped.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('CSV Import failed — all changes rolled back safely:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

const fileArg = process.argv[2] || path.join(__dirname, '..', 'students.csv');
importStudentsCsv(fileArg);
