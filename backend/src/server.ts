import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-school-secret-key-change-in-prod';
const SYNC_API_KEY = process.env.SYNC_API_KEY || 'dev-till-sync-key-change-in-prod';

const MAIN_PRICE_PENCE = 265;     // £2.65
const DRINK_PRICE_PENCE = 100;    // £1.00
const FSM_ALLOWANCE_PENCE = 265;  // £2.65

let latestScanEvent: any = { scanId: 0 };

interface AuthenticatedRequest extends Request {
  userId?: string;
}

function calculateOrderMath(hasMain: boolean, hasDrink: boolean, isFsm: boolean) {
  const subtotalPence = (hasMain ? MAIN_PRICE_PENCE : 0) + (hasDrink ? DRINK_PRICE_PENCE : 0);
  const availableFsm = isFsm ? FSM_ALLOWANCE_PENCE : 0;
  const fsmCoveredPence = Math.min(subtotalPence, availableFsm);
  const walletChargedPence = Math.max(0, subtotalPence - fsmCoveredPence);
  return { subtotalPence, fsmCoveredPence, walletChargedPence };
}

function parseToPence(rawAmount: unknown, isAlreadyPence = false): number {
  if (typeof rawAmount === 'number' && !Number.isNaN(rawAmount)) {
    return isAlreadyPence ? Math.round(rawAmount) : Math.round(rawAmount * 100);
  }
  const cleaned = String(rawAmount ?? '').replace(/[£$,\s]/g, '').trim();
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;
  return isAlreadyPence ? Math.round(parsed) : Math.round(parsed * 100);
}

function requireStudentAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please sign in to your school account.' });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string };
    if (!payload?.userId) {
      res.status(401).json({ error: 'Invalid session token.' });
      return;
    }
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

function requireSyncSecret(req: Request, res: Response, next: NextFunction) {
  const providedKey = req.headers['x-sync-api-key'];
  if (!providedKey || providedKey !== SYNC_API_KEY) {
    res.status(401).json({ error: 'Unauthorized sync key.' });
    return;
  }
  next();
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'school-lunch-backend' });
});

// 1. STUDENT LOGIN
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pinCode = String(req.body.pinCode || '').trim();
    if (!email || !pinCode) {
      res.status(400).json({ error: 'Please enter both your school email and 4-digit PIN.' });
      return;
    }
    const userRes = await pool.query(
      `SELECT id, full_name, year_group, is_fsm, wallet_pence, pin_code FROM users WHERE LOWER(email) = $1`,
      [email]
    );
    if (userRes.rowCount === 0) {
      res.status(401).json({ error: 'No student account found with that school email.' });
      return;
    }
    const user = userRes.rows[0];
    if (String(user.pin_code) !== pinCode) {
      res.status(401).json({ error: 'Incorrect 4-digit PIN.' });
      return;
    }
    const token = jwt.sign({ userId: String(user.id) }, JWT_SECRET, { expiresIn: '90d' });
    res.json({
      token,
      student: {
        id: String(user.id),
        fullName: String(user.full_name),
        yearGroup: String(user.year_group),
        isFsm: Boolean(user.is_fsm),
        walletPence: Number(user.wallet_pence),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

// 2. LOAD STUDENT MENU & TODAY'S ORDER
app.get('/api/me/today', requireStudentAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const userRes = await pool.query(
      `SELECT id, full_name, year_group, is_fsm, wallet_pence FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rowCount === 0) {
      res.status(404).json({ error: 'Student account not found.' });
      return;
    }
    const user = userRes.rows[0];
    const menuRes = await pool.query(
      `SELECT id, course_type, dish_name, price_pence, stock_remaining
       FROM menu_items WHERE service_date = CURRENT_DATE AND is_active = true
       ORDER BY course_type DESC, dish_name ASC`
    );
    const orderRes = await pool.query(
      `SELECT id, summary_text, subtotal_pence, fsm_covered_pence, wallet_charged_pence, status
       FROM pre_orders WHERE user_id = $1 AND service_date = CURRENT_DATE`,
      [userId]
    );
    res.json({
      student: {
        id: String(user.id),
        fullName: String(user.full_name),
        yearGroup: String(user.year_group),
        isFsm: Boolean(user.is_fsm),
        walletPence: Number(user.wallet_pence),
        fsmAllowancePence: user.is_fsm ? FSM_ALLOWANCE_PENCE : 0,
      },
      mains: menuRes.rows.filter((r) => r.course_type === 'MAIN'),
      drinks: menuRes.rows.filter((r) => r.course_type === 'DRINK'),
      existingOrder: orderRes.rows[0] ?? null,
    });
  } catch {
    res.status(500).json({ error: 'Could not load menu.' });
  }
});

// 3. PLACE PRE-ORDER (ATOMIC ACID TRANSACTION)
app.post('/api/orders', requireStudentAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { mainItemId, drinkItemId } = req.body;
  if (!mainItemId && !drinkItemId) {
    res.status(400).json({ error: 'Please select at least a main meal or a drink.' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `SELECT id, is_fsm, wallet_pence FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (userRes.rowCount === 0) throw new Error('Student not found.');
    const user = userRes.rows[0];

    const existingRes = await client.query(
      `SELECT id FROM pre_orders WHERE user_id = $1 AND service_date = CURRENT_DATE`,
      [userId]
    );
    if ((existingRes.rowCount ?? 0) > 0) {
      throw new Error('You have already placed a lunch pre-order for today.');
    }

    const summaryParts: string[] = [];
    if (mainItemId) {
      const mainRes = await client.query(
        `UPDATE menu_items SET stock_remaining = stock_remaining - 1
         WHERE id = $1 AND course_type = 'MAIN' AND service_date = CURRENT_DATE AND stock_remaining > 0
         RETURNING dish_name`,
        [mainItemId]
      );
      if (mainRes.rowCount === 0) throw new Error('Selected main meal just sold out.');
      summaryParts.push(String(mainRes.rows[0].dish_name));
    }
    if (drinkItemId) {
      const drinkRes = await client.query(
        `UPDATE menu_items SET stock_remaining = stock_remaining - 1
         WHERE id = $1 AND course_type = 'DRINK' AND service_date = CURRENT_DATE AND stock_remaining > 0
         RETURNING dish_name`,
        [drinkItemId]
      );
      if (drinkRes.rowCount === 0) throw new Error('Selected drink just sold out.');
      summaryParts.push(String(drinkRes.rows[0].dish_name));
    }

    const math = calculateOrderMath(Boolean(mainItemId), Boolean(drinkItemId), Boolean(user.is_fsm));
    if (Number(user.wallet_pence) < math.walletChargedPence) {
      throw new Error(
        `Insufficient wallet balance. Need £${(math.walletChargedPence / 100).toFixed(2)}, you have £${(user.wallet_pence / 100).toFixed(2)}.`
      );
    }

    if (math.walletChargedPence > 0) {
      await client.query(`UPDATE users SET wallet_pence = wallet_pence - $1 WHERE id = $2`, [
        math.walletChargedPence,
        userId,
      ]);
    }

    const insertOrder = await client.query(
      `INSERT INTO pre_orders
       (user_id, service_date, main_item_id, drink_item_id, summary_text, subtotal_pence, fsm_covered_pence, wallet_charged_pence, status)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, 'PLACED')
       RETURNING id, summary_text, subtotal_pence, fsm_covered_pence, wallet_charged_pence, status`,
      [
        userId,
        mainItemId || null,
        drinkItemId || null,
        summaryParts.join(' + '),
        math.subtotalPence,
        math.fsmCoveredPence,
        math.walletChargedPence,
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, order: insertOrder.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err?.message || 'Order failed. Your wallet was not charged.' });
  } finally {
    client.release();
  }
});

// 4. KITCHEN NFC SCANNER ENDPOINT + LIVE POLLING
app.get('/api/kitchen/latest-scan', (_req: Request, res: Response) => {
  res.json(latestScanEvent);
});

app.post('/api/kitchen/scan', async (req: Request, res: Response) => {
  try {
    const rawUid = String(req.body.nfcUid || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    if (!rawUid) {
      res.status(400).json({ scanStatus: 'INVALID_CARD', message: 'Empty card scan' });
      return;
    }
    const userRes = await pool.query(
      `SELECT id, full_name, year_group FROM users WHERE UPPER(nfc_uid) = $1`,
      [rawUid]
    );
    if (userRes.rowCount === 0) {
      const payload = {
        scanId: Date.now(),
        scanStatus: 'UNKNOWN_CARD',
        nfcUid: rawUid,
        studentName: 'Unregistered NFC Card',
        yearGroup: '-',
        summaryText: `Card UID (${rawUid}) is not linked to a student profile`,
      };
      latestScanEvent = payload;
      res.json(payload);
      return;
    }
    const student = userRes.rows[0];
    const orderRes = await pool.query(
      `SELECT id, summary_text, status, collected_at FROM pre_orders WHERE user_id = $1 AND service_date = CURRENT_DATE`,
      [student.id]
    );
    if (orderRes.rowCount === 0) {
      const payload = {
        scanId: Date.now(),
        scanStatus: 'NO_ORDER',
        studentName: String(student.full_name),
        yearGroup: String(student.year_group),
        summaryText: 'No pre-order placed for today',
      };
      latestScanEvent = payload;
      res.json(payload);
      return;
    }
    const order = orderRes.rows[0];
    if (order.status === 'COLLECTED') {
      const timeStr = order.collected_at
        ? new Date(order.collected_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : 'earlier';
      const payload = {
        scanId: Date.now(),
        scanStatus: 'ALREADY_COLLECTED',
        studentName: String(student.full_name),
        yearGroup: String(student.year_group),
        summaryText: String(order.summary_text),
        collectedTime: timeStr,
      };
      latestScanEvent = payload;
      res.json(payload);
      return;
    }
    await pool.query(`UPDATE pre_orders SET status = 'COLLECTED', collected_at = NOW() WHERE id = $1`, [order.id]);
    const payload = {
      scanId: Date.now(),
      scanStatus: 'COLLECTED_NOW',
      studentName: String(student.full_name),
      yearGroup: String(student.year_group),
      summaryText: String(order.summary_text),
    };
    latestScanEvent = payload;
    res.json(payload);
  } catch (err) {
    console.error('NFC scan error:', err);
    res.status(500).json({ scanStatus: 'ERROR', summaryText: 'Database connection error' });
  }
});

// 5. ADMIN MENU & TALLY ENDPOINTS
app.post('/api/admin/menu', async (req: Request, res: Response) => {
  try {
    const dishName = String(req.body.dishName || '').trim();
    const courseType = req.body.courseType === 'DRINK' ? 'DRINK' : 'MAIN';
    const stock = Math.max(1, Number(req.body.stock) || 150);
    if (!dishName) {
      res.status(400).json({ error: 'Dish name is required.' });
      return;
    }
    const autoPricePence = courseType === 'MAIN' ? MAIN_PRICE_PENCE : DRINK_PRICE_PENCE;
    const result = await pool.query(
      `INSERT INTO menu_items (service_date, course_type, dish_name, price_pence, stock_remaining)
       VALUES (CURRENT_DATE, $1, $2, $3, $4)
       RETURNING id, course_type, dish_name, price_pence, stock_remaining`,
      [courseType, dishName, autoPricePence, stock]
    );
    res.json({ success: true, item: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Failed to add menu item.' });
  }
});

app.get('/api/kitchen/tally', async (_req: Request, res: Response) => {
  try {
    const tallyRes = await pool.query(
      `SELECT m.id, m.course_type, m.dish_name, m.price_pence, m.stock_remaining,
              COUNT(p.id)::int AS ordered_count
       FROM menu_items m
       LEFT JOIN pre_orders p ON (p.main_item_id = m.id OR p.drink_item_id = m.id) AND p.service_date = CURRENT_DATE
       WHERE m.service_date = CURRENT_DATE
       GROUP BY m.id ORDER BY m.course_type DESC, m.dish_name ASC`
    );
    res.json({ items: tallyRes.rows ?? [] });
  } catch {
    res.status(500).json({ items: [] });
  }
});

// 6. PARENTPAY & TILL SYNC WEBHOOKS
app.post('/api/webhooks/parentpay-topup', requireSyncSecret, async (req: Request, res: Response) => {
  const externalRef = String(req.body.transactionId || '').trim();
  const nfcUid = String(req.body.nfcUid || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const topupPence = parseToPence(req.body.amountPence ?? req.body.amountPounds, req.body.amountPence !== undefined);

  if (!externalRef || topupPence <= 0 || (!nfcUid && !email)) {
    res.status(400).json({ error: 'Missing transactionId, positive amount, or student identifier.' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dupCheck = await client.query(`SELECT id FROM wallet_transactions WHERE external_ref = $1`, [externalRef]);
    if ((dupCheck.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.json({ status: 'ALREADY_PROCESSED', message: 'Duplicate webhook safely ignored.' });
      return;
    }
    const userRes = await client.query(
      `SELECT id, wallet_pence FROM users WHERE UPPER(nfc_uid) = $1 OR LOWER(email) = $2 FOR UPDATE`,
      [nfcUid || 'NONE', email || 'NONE']
    );
    if (userRes.rowCount === 0) throw new Error('Student not found for top-up.');
    const user = userRes.rows[0];
    const newBalancePence = Number(user.wallet_pence) + topupPence;
    await client.query(`UPDATE users SET wallet_pence = $1 WHERE id = $2`, [newBalancePence, user.id]);
    await client.query(
      `INSERT INTO wallet_transactions (user_id, external_ref, tx_type, amount_pence, balance_after_pence)
       VALUES ($1, $2, 'PARENTPAY_TOPUP', $3, $4)`,
      [user.id, externalRef, topupPence, newBalancePence]
    );
    await client.query('COMMIT');
    res.json({ status: 'SUCCESS', newBalancePence });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err?.message || 'Top-up failed.' });
  } finally {
    client.release();
  }
});

app.post('/api/webhooks/till-balance-sync', requireSyncSecret, async (req: Request, res: Response) => {
  const records = Array.isArray(req.body.balances) ? req.body.balances : [];
  if (records.length === 0) {
    res.status(400).json({ error: 'No balance records provided.' });
    return;
  }
  const client = await pool.connect();
  let updatedCount = 0;
  try {
    await client.query('BEGIN');
    for (const row of records) {
      const nfcUid = String(row.nfcUid || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
      if (!nfcUid) continue;
      const tillBalancePence = Math.max(
        0,
        parseToPence(row.balancePence ?? row.balancePounds, row.balancePence !== undefined)
      );
      const updateRes = await client.query(
        `UPDATE users u
         SET wallet_pence = GREATEST(0, $1 - COALESCE((
           SELECT SUM(p.wallet_charged_pence)::int FROM pre_orders p
           WHERE p.user_id = u.id AND p.service_date = CURRENT_DATE AND p.synced_to_till = false
         ), 0))
         WHERE UPPER(u.nfc_uid) = $2 RETURNING u.id`,
        [tillBalancePence, nfcUid]
      );
      if ((updateRes.rowCount ?? 0) > 0) updatedCount++;
    }
    await client.query('COMMIT');
    res.json({ success: true, updatedCount });
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Batch balance sync failed; rolled back safely.' });
  } finally {
    client.release();
  }
});

app.post('/api/webhooks/export-preorder-deductions', requireSyncSecret, async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pendingRes = await client.query(
      `SELECT p.id AS order_id, u.nfc_uid, u.email, u.full_name, p.wallet_charged_pence, p.summary_text
       FROM pre_orders p JOIN users u ON u.id = p.user_id
       WHERE p.service_date = CURRENT_DATE AND p.wallet_charged_pence > 0 AND p.synced_to_till = false
       FOR UPDATE OF p`
    );
    const rows = pendingRes.rows ?? [];
    if (rows.length > 0) {
      await client.query(`UPDATE pre_orders SET synced_to_till = true WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.order_id),
      ]);
    }
    await client.query('COMMIT');
    res.json({
      serviceDate: new Date().toISOString().slice(0, 10),
      deductionCount: rows.length,
      deductions: rows.map((r) => ({
        orderId: String(r.order_id),
        nfcUid: String(r.nfc_uid),
        email: String(r.email),
        fullName: String(r.full_name),
        deductPence: Number(r.wallet_charged_pence),
        deductPounds: (Number(r.wallet_charged_pence) / 100).toFixed(2),
        description: `Pre-Order: ${r.summary_text}`,
      })),
    });
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to export pre-order deductions.' });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`School Lunch API running on port ${PORT}`));
