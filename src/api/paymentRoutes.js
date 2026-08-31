'use strict';

/**
 * paymentRoutes.js — Razorpay Payment Gateway Routes
 *
 * Exposes:
 *   POST /api/payment/order   — create a Razorpay order (amount in paise)
 *   POST /api/payment/verify  — verify HMAC-SHA256 payment signature
 *
 * Both routes require a valid session token (Bearer <token> header).
 * Signature verification uses Node's native `crypto` with timingSafeEqual
 * to prevent timing-based side-channel attacks.
 */

const { createHmac, timingSafeEqual } = require('node:crypto');
const { Router } = require('express');

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
  razorpay_order_id: z.string().min(1, 'razorpay_order_id is required.'),
  razorpay_payment_id: z.string().min(1, 'razorpay_payment_id is required.'),
  razorpay_signature: z.string().min(1, 'razorpay_signature is required.'),
});

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

    // 4. Signature is valid — safe to fulfil the order
    console.info(
      '[payment/verify] Payment verified successfully.',
      { orderId: razorpay_order_id, paymentId: razorpay_payment_id, userId: req.currentUser.id }
    );

    return res.json({
      success: true,
      message: 'Payment verified successfully.',
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
  });

  return router;
}

module.exports = { createPaymentRouter };
