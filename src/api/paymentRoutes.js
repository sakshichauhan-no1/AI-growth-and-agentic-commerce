'use strict';

/**
 * paymentRoutes.js — Razorpay Payment Gateway Routes
 *
 * Exposes:
 *   POST /api/payment/order   — create a Razorpay order (amount in paise)
 *   POST /api/payment/verify  — verify HMAC-SHA256 payment signature
 *   POST /api/payment/outcome — record a failed or cancelled checkout
 *
 * Both routes require a valid session token (Bearer <token> header).
 * Signature verification uses Node's native `crypto` with timingSafeEqual
 * to prevent timing-based side-channel attacks.
 */

const { createHmac, timingSafeEqual } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Router } = require('express');

// Path to the shared audit log written by spine.js.
// __dirname is src/api, so ../../mock resolves to src/mock.
const AUDIT_LOG_PATH = resolve(__dirname, '..', 'mock', 'audit_log.json');

// ─── Input validation with Zod ────────────────────────────────────────────────
const { z } = require('zod');

const OrderSchema = z.object({
  amountInPaise: z
    .number({ required_error: 'amountInPaise is required.' })
    .int('amountInPaise must be an integer (whole paise).')
    .min(100, 'Minimum payable amount is ₹1 (100 paise).')
    .max(10_000_000, 'Amount exceeds the ₹1,00,000 single-transaction ceiling.'),
  currency: z.string().length(3, 'currency must be a 3-letter ISO code.').default('INR'),
  receipt: z.string().max(40, 'receipt must be ≤ 40 characters.').optional(),
  notes: z.record(z.string()).optional(),
});

const VerifySchema = z.object({
  razorpay_order_id:  z.string().min(1, 'razorpay_order_id is required.'),
  razorpay_payment_id: z.string().min(1, 'razorpay_payment_id is required.'),
  razorpay_signature:  z.string().min(1, 'razorpay_signature is required.'),
  // Optional context passed from the chat flow for audit enrichment
  itemName:    z.string().optional(),
  itemPrice:   z.string().optional(),
  amountPaise: z.number().int().positive().optional(),
});

const OutcomeSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['failed', 'cancelled']),
  error: z.string().max(500).optional(),
});

// ─── Audit log sync helper ────────────────────────────────────────────────────

/**
 * Locate a 'pending-checkout' audit entry whose order.id matches the given
 * Razorpay order ID and promote its status to 'paid'.
 *
 * This is a best-effort operation: if no matching entry is found (e.g. the
 * server was restarted between checkout and payment), we log a warning and
 * return false without throwing — the payment itself is already verified.
 *
 * @param {string} orderId    - razorpay_order_id from the verify payload
 * @param {string} paymentId  - razorpay_payment_id to stamp on the entry
 * @returns {boolean}         - true if an entry was updated, false otherwise
 */
function updateAuditEntryStatus(orderId, paymentId, status = 'paid', error = null, userId = null) {
  try {
    if (!existsSync(AUDIT_LOG_PATH)) return false;

    const raw     = readFileSync(AUDIT_LOG_PATH, 'utf8').trim();
    const entries = raw ? JSON.parse(raw) : [];

    // Find the first pending-checkout entry whose order matches this payment.
    // We guard against entries that have no `order` field (older mock records).
    const idx = entries.findIndex(
      (e) =>
        (e.order?.id === orderId || e.orderId === orderId) &&
        (!userId || e.userId === userId) &&
        (status === 'paid'
          ? (e.status === 'pending-checkout' || e.status === 'executed' || (e.status === 'paid' && e.paymentId === paymentId))
          : (!e.status || e.status.toLowerCase().includes('pending') || e.status === 'executed')),
    );

    if (idx === -1) return false;

    // Mutate in-place — preserves all other fields (cart items, gate, etc.)
    entries[idx] = {
      ...entries[idx],
      status,
      ...(status === 'paid' ? { paidAt: new Date().toISOString(), paymentId } : { [status === 'cancelled' ? 'cancelledAt' : 'failedAt']: new Date().toISOString() }),
      ...(error ? { error } : {}),
    };

    if (status === 'paid') resolveEarlierAttempts(entries, entries[idx], userId);

    writeFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    return true;
  } catch (err) {
    // Never let an audit-sync failure surface as a 500 to the client.
    console.error('[payment/verify] Failed to sync audit log entry:', err.message);
    return false;
  }
}

function sameCart(a, b) {
  if (!a?.cartItems?.length || !b?.cartItems?.length) return false;
  const normalize = (entry) => entry.cartItems
    .map((item) => `${item.productId || item.name}:${item.quantity || 1}`)
    .sort()
    .join('|');
  return normalize(a) === normalize(b);
}

function resolveEarlierAttempts(entries, successfulEntry, userId) {
  for (const entry of entries) {
    if (entry === successfulEntry || entry.userId !== userId || !['failed', 'cancelled'].includes(entry.status)) continue;
    const sameAmount = Number(entry.amountPaise) === Number(successfulEntry.amountPaise);
    if (sameAmount && (sameCart(entry, successfulEntry) || !entry.cartItems?.length || !successfulEntry.cartItems?.length)) {
      entry.retryResolved = true;
      entry.resolvedByOrderId = successfulEntry.order?.id || successfulEntry.orderId || null;
      entry.resolvedAt = new Date().toISOString();
    }
  }
}

function appendFallbackPaidAudit({ user, orderId, paymentId, itemName, amountPaise }) {
  try {
    const raw = existsSync(AUDIT_LOG_PATH) ? readFileSync(AUDIT_LOG_PATH, 'utf8').trim() : '';
    const entries = raw ? JSON.parse(raw) : [];
    const source = entries.find((entry) =>
      entry.userId === user.id && (entry.order?.id === orderId || entry.orderId === orderId),
    );
    const successfulEntry = {
      actionId: `payment_${Date.now()}`,
      actionType: 'CART_CHECKOUT',
      userId: user.id,
      user: { id: user.id, name: user.name, email: user.email },
      executedAt: new Date().toISOString(),
      status: 'paid',
      itemName: itemName || source?.itemName || 'Purchase',
      amountPaise: amountPaise || source?.amountPaise || 0,
      cartItems: source?.cartItems || [{ name: itemName || source?.itemName || 'Purchase', quantity: 1, totalPaise: amountPaise || source?.amountPaise || 0 }],
      order: { id: orderId },
      paidAt: new Date().toISOString(),
      paymentId,
    };
    entries.push(successfulEntry);
    resolveEarlierAttempts(entries, successfulEntry, user.id);
    writeFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    return true;
  } catch (err) {
    console.error('[payment/verify] Failed to append fallback paid audit entry:', err.message);
    return false;
  }
}

function appendFallbackOutcomeAudit({ user, orderId, status, error }) {
  try {
    const raw = existsSync(AUDIT_LOG_PATH) ? readFileSync(AUDIT_LOG_PATH, 'utf8').trim() : '';
    const entries = raw ? JSON.parse(raw) : [];
    const source = entries.find((entry) =>
      entry.userId === user.id && (entry.order?.id === orderId || entry.orderId === orderId),
    );
    const timestamp = new Date().toISOString();
    entries.push({
      actionId: `payment_attempt_${Date.now()}`,
      actionType: 'CART_CHECKOUT',
      userId: user.id,
      user: { id: user.id, name: user.name, email: user.email },
      executedAt: timestamp,
      status,
      cartItems: source?.cartItems || [],
      amountPaise: source?.amountPaise || 0,
      order: { id: orderId },
      [status === 'cancelled' ? 'cancelledAt' : 'failedAt']: timestamp,
      ...(error ? { error } : {}),
      ...(source?.status === 'paid' ? { retryResolved: true, resolvedByOrderId: orderId, resolvedAt: timestamp } : {}),
    });
    writeFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    return true;
  } catch (err) {
    console.error('[payment/outcome] Failed to append fallback outcome audit entry:', err.message);
    return false;
  }
}

// ─── Route factory ─────────────────────────────────────────────────────────────

/**
 * @param {function} tokenUser   — the existing auth helper from server.js
 * @param {object}   razorpay    — Razorpay SDK instance (new Razorpay({...}))
 * @param {string}   keySecret   — RAZORPAY_KEY_SECRET for signature verification
 */
function createPaymentRouter(tokenUser, razorpay, keySecret) {
  if (typeof tokenUser !== 'function') throw new Error('tokenUser must be a function.');
  if (!razorpay || typeof razorpay.orders?.create !== 'function') {
    throw new Error('razorpay must be an initialized Razorpay SDK instance.');
  }
  if (!keySecret || typeof keySecret !== 'string') {
    throw new Error('keySecret must be a non-empty string (RAZORPAY_KEY_SECRET).');
  }

  const router = Router();

  // ── Middleware: require auth on all payment routes ───────────────────────────
  router.use((req, res, next) => {
    const user = tokenUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in to make a payment.' });
    req.currentUser = user;
    next();
  });

  // ── POST /api/payment/order ──────────────────────────────────────────────────
  router.post('/order', async (req, res) => {
    // 1. Validate request body
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid order payload.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { amountInPaise, currency, receipt, notes } = parsed.data;

    // 2. Create Razorpay order
    try {
      const order = await razorpay.orders.create({
        amount: amountInPaise,        // Razorpay always expects paise
        currency,
        receipt: receipt ?? `rcpt_${Date.now()}`,
        notes: {
          userId: req.currentUser.id,
          userEmail: req.currentUser.email,
          ...(notes ?? {}),
        },
      });

      return res.status(201).json({
        success: true,
        orderId: order.id,
        amount: order.amount,         // paise — frontend uses this
        currency: order.currency,
        receipt: order.receipt,
      });
    } catch (err) {
      console.error('[payment/order] Razorpay order creation failed:', err?.error ?? err);
      return res.status(502).json({
        error: 'Payment gateway error. Could not create order — please try again.',
      });
    }
  });

  // ── POST /api/payment/verify ─────────────────────────────────────────────────
  router.post('/verify', (req, res) => {
    // 1. Validate incoming webhook-like payload
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid verification payload.',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

    // 2. Reconstruct the signed message exactly as Razorpay does:
    //    HMAC-SHA256( "<order_id>|<payment_id>", key_secret )
    const signedPayload = `${razorpay_order_id}|${razorpay_payment_id}`;

    let expectedSignature;
    try {
      expectedSignature = createHmac('sha256', keySecret)
        .update(signedPayload)
        .digest('hex');
    } catch (err) {
      console.error('[payment/verify] HMAC computation error:', err);
      return res.status(500).json({ error: 'Internal signature computation error.' });
    }

    // 3. timingSafeEqual to prevent timing attacks
    let isValid = false;
    try {
      const expected = Buffer.from(expectedSignature, 'hex');
      const received = Buffer.from(razorpay_signature, 'hex');
      // Buffers must be same length before timingSafeEqual
      isValid = expected.length === received.length &&
                timingSafeEqual(expected, received);
    } catch (_) {
      // Malformed hex in signature — treat as invalid
      isValid = false;
    }

    if (!isValid) {
      console.warn(
        '[payment/verify] Signature mismatch — possible tampered payload.',
        { orderId: razorpay_order_id, userId: req.currentUser.id }
      );
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed: signature mismatch. Do not fulfil this order.',
      });
    }

    // 4. Signature is valid — sync the audit log entry, then respond
    let auditUpdated = updateAuditEntryStatus(razorpay_order_id, razorpay_payment_id, 'paid', null, req.currentUser.id);
    if (!auditUpdated) {
      // A successful payment must remain visible even if the browser/server lost
      // the pending record or Razorpay reused an order after an earlier attempt.
      auditUpdated = appendFallbackPaidAudit({
        user: req.currentUser,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        itemName: parsed.data.itemName,
        amountPaise: parsed.data.amountPaise,
      });
    } else {
      console.info(
        '[payment/verify] Audit entry promoted to \'paid\'.',
        { orderId: razorpay_order_id, paymentId: razorpay_payment_id, userId: req.currentUser.id },
      );
    }

    return res.json({
      success:     true,
      message:     'Payment verified successfully.',
      orderId:     razorpay_order_id,
      paymentId:   razorpay_payment_id,
      auditSynced: auditUpdated,
      // Echo back metadata so the frontend can build a rich audit row
      itemName:    parsed.data.itemName    ?? null,
      itemPrice:   parsed.data.itemPrice   ?? null,
      amountPaise: parsed.data.amountPaise ?? null,
    });
  });

  // ── POST /api/payment/outcome ──────────────────────────────────────────────
  router.post('/outcome', (req, res) => {
    const parsed = OutcomeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payment outcome.' });
    const { orderId, status, error } = parsed.data;
    const updated = updateAuditEntryStatus(orderId, null, status, error || null, req.currentUser.id)
      || appendFallbackOutcomeAudit({ user: req.currentUser, orderId, status, error: error || null });
    return res.json({ success: updated, status });
  });

  return router;
}

module.exports = { createPaymentRouter };
