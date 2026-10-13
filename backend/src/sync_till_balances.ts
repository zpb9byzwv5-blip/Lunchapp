import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:4000';
const SYNC_API_KEY = process.env.SYNC_API_KEY || 'dev-till-sync-key-change-in-prod';

const INBOUND_BALANCES_CSV = path.join(__dirname, '..', 'till_balances.csv');
const OUTBOUND_FOLDER = path.join(__dirname, '..', 'till_exports');

async function runTillSync() {
  if (fs.existsSync(INBOUND_BALANCES_CSV)) {
    const rawCsv = fs.readFileSync(INBOUND_BALANCES_CSV, 'utf-8');
    const lines = rawCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const balances: { nfcUid: string; balancePounds: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length >= 2 && cols[0]) {
        balances.push({ nfcUid: cols[0], balancePounds: cols[1] });
      }
    }

    if (balances.length > 0) {
      const res = await fetch(`${API_URL}/api/webhooks/till-balance-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-api-key': SYNC_API_KEY,
        },
        body: JSON.stringify({ balances }),
      });
      const data = await res.json();
      console.log(`[Inbound Sync] Synced ${data.updatedCount ?? 0} student wallet balances from Till.`);
    }
  }

  const exportRes = await fetch(`${API_URL}/api/webhooks/export-preorder-deductions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-api-key': SYNC_API_KEY,
    },
  });

  if (!exportRes.ok) return;
  const exportData = await exportRes.json();
  const deductions = Array.isArray(exportData.deductions) ? exportData.deductions : [];
  if (deductions.length === 0) {
    console.log('[Outbound Sync] No new pre-order wallet charges to export.');
    return;
  }

  if (!fs.existsSync(OUTBOUND_FOLDER)) {
    fs.mkdirSync(OUTBOUND_FOLDER, { recursive: true });
  }

  const dateStr = exportData.serviceDate || new Date().toISOString().slice(0, 10);
  const outPath = path.join(OUTBOUND_FOLDER, `till_deductions_${dateStr}_${Date.now()}.csv`);

  const csvHeader = 'nfc_uid,email,full_name,deduct_pence,deduct_pounds,description\n';
  const csvRows = deductions
    .map(
      (d: any) =>
        `${d.nfcUid},${d.email},"${String(d.fullName).replace(/"/g, '')}",${d.deductPence},${d.deductPounds},"${String(d.description).replace(/"/g, '')}"`
    )
    .join('\n');

  fs.writeFileSync(outPath, csvHeader + csvRows, 'utf-8');
  console.log(`[Outbound Sync] Wrote ${deductions.length} pre-order wallet deductions to ${outPath}`);
}

runTillSync().catch((err) => {
  console.error('Till Sync Error:', err);
  process.exit(1);
});
