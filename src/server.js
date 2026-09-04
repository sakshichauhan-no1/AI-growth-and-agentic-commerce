'use strict';
require('dotenv').config({ quiet: true });
const express = require('express'); const { randomUUID, createHmac, timingSafeEqual } = require('node:crypto'); const { existsSync, readFileSync, writeFileSync } = require('node:fs'); const { join, resolve } = require('node:path');
const Razorpay = require('razorpay');
const { createRazorpayClient } = require('./api/razorpayClient');
const { createPaymentRouter } = require('./api/paymentRoutes');
const { proposeAction, explain, gate, execute, readAuditLog, audit: writeAudit } = require('./agent/spine');
const { processMessage } = require('./agent');

const rawCatalog = [
  { id: 'sku_mouse', name: 'Wireless Mouse', keywords: ['mouse', 'wireless mouse', 'gaming mouse'], priceInPaise: 129900, displayPrice: '₹1,299' },
  { id: 'sku_keyboard', name: 'Mechanical Keyboard', keywords: ['keyboard', 'mechanical keyboard', 'key board'], priceInPaise: 349900, displayPrice: '₹3,499' },
  { id: 'sku_headset', name: 'Gaming Headset', keywords: ['headset', 'headphones', 'earphones', 'head phone'], priceInPaise: 249900, displayPrice: '₹2,499' },
  { id: 'sku_warranty', name: 'Extended Warranty', keywords: ['warranty', 'extended warranty', 'guarantee'], priceInPaise: 49900, displayPrice: '₹499' },
  { id: 'sku_cable', name: 'USB-C Cable', keywords: ['cable', 'usb cable', 'charger', 'charger cable'], priceInPaise: 29900, displayPrice: '₹299' },
  { id: 'sku_pad', name: 'Mouse Pad', keywords: ['mouse pad', 'mousepad', 'mat'], priceInPaise: 19900, displayPrice: '₹199' },
  { id: 'sku_stand', name: 'Laptop Stand', keywords: ['stand', 'laptop stand', 'holder'], priceInPaise: 89900, displayPrice: '₹899' },
  { id: 'sku_hub', name: 'USB Docking Station', keywords: ['usb hub', 'dock', 'docking station', 'adapter'], priceInPaise: 189900, displayPrice: '₹1,899' },
  { id: 'sku_webcam', name: 'HD Webcam', keywords: ['webcam', 'camera', 'hd camera'], priceInPaise: 219900, displayPrice: '₹2,199' },
  { id: 'sku_powerbank', name: 'Power Bank', keywords: ['powerbank', 'power bank', 'portable charger'], priceInPaise: 149900, displayPrice: '₹1,499' },
  { id: 'sku_lamp', name: 'Desk LED Lamp', keywords: ['lamp', 'desk lamp', 'led lamp', 'light'], priceInPaise: 79900, displayPrice: '₹799' },
  { id: 'sku_bottle', name: 'Thermal Water Bottle', keywords: ['bottle', 'water bottle', 'flask', 'thermos'], priceInPaise: 59900, displayPrice: '₹599' },
  { id: 'sku_fan', name: 'Mini Desk Fan', keywords: ['fan', 'desk fan', 'mini fan', 'cooler'], priceInPaise: 49900, displayPrice: '₹499' },
  { id: 'sku_organizer', name: 'Desk Cable Organizer', keywords: ['organizer', 'cable organizer', 'desk organizer'], priceInPaise: 29900, displayPrice: '₹299' },
  { id: 'sku_workstation', name: 'Pro Workstation Laptop', keywords: ['workstation', 'pro laptop', 'high performance laptop'], priceInPaise: 8500000, displayPrice: '₹85,000' },
  { id: 'sku_server_unit', name: 'Enterprise Server Unit', keywords: ['server', 'enterprise server', 'server unit'], priceInPaise: 12000000, displayPrice: '₹1,20,000' }
];

const catalog = rawCatalog.map(c => ({ ...c, price: c.priceInPaise, stock: 100 }));

function parseBuyerQuery(query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Please tell me what you want to buy.');
  const q = query.toLowerCase();

  if (/^(hi|hello|hey|good morning|good evening|greetings|yello|hola)\b/i.test(q.trim())) {
    return { type: 'GREETING' };
  }
  if (/^(bye|goodbye|see ya|thanks|thank you|cya|see you soon)\b/i.test(q.trim())) {
    return { type: 'FAREWELL' };
  }

  const queryWords = q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);

  let bestMatch = null;
  let bestScore = 0;
  for (const item of catalog) {
    const itemWords = item.name.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
    const keywords = item.keywords.flatMap(kw => kw.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/));
    const allSearchable = new Set([...itemWords, ...keywords]);
    let score = 0;
    for (const w of queryWords) {
      if (allSearchable.has(w)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  if (!bestMatch) {
    return { type: 'FALLBACK' };
  }

  const quantityMatch = q.match(/\b(\d+)\b/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const actionType = /\b(add|upsell|warranty)\b/.test(q) ? 'UPSELL' : 'CREATE_ORDER';
  return { type: 'ORDER', productId: bestMatch.id, quantity, actionType, displayPrice: bestMatch.displayPrice };
}
const app = express(), PORT = Number(process.env.PORT) || 3000, USERS_PATH = resolve(__dirname, 'mock', 'users.json'), TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'agentic-checkout-local-secret', SERVER_BOOT_ID = randomUUID(); app.use(express.json()); app.use(express.static(join(__dirname, '..', 'public')));
const email = v => typeof v === 'string' ? v.trim().toLowerCase() : ''; const users = () => { const s = existsSync(USERS_PATH) ? readFileSync(USERS_PATH, 'utf8').trim() : ''; return s ? JSON.parse(s) : [] }; const save = u => writeFileSync(USERS_PATH, `${JSON.stringify(u, null, 2)}\n`, 'utf8'); const publicUser = u => ({ id: u.id, name: u.name, email: u.email });
function tokenFor(u) { const p = Buffer.from(u.id).toString('base64url'), sig = createHmac('sha256', TOKEN_SECRET).update(`${p}.${SERVER_BOOT_ID}`).digest('base64url'); return `${p}.${sig}`; } function tokenUser(req) { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return null; const [p, s] = m[1].split('.'); if (!p || !s) return null; const expected = createHmac('sha256', TOKEN_SECRET).update(`${p}.${SERVER_BOOT_ID}`).digest('base64url'); if (s.length !== expected.length || !timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null; return users().find(u => u.id === Buffer.from(p, 'base64url').toString()) || null; }
app.post('/api/auth/signup', (req, res) => { const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '', e = email(req.body?.email), password = req.body?.password; if (!name || !e.includes('@') || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Name, valid email, and password (8+ characters) are required.' }); const list = users(); if (list.some(u => u.email === e)) return res.status(409).json({ error: 'An account already exists for this email.' }); const user = { id: randomUUID(), name, email: e, password }; list.push(user); save(list); return res.status(201).json({ success: true, token: tokenFor(user), user: publicUser(user) }); });
app.post('/api/auth/login', (req, res) => { const user = users().find(u => u.email === email(req.body?.email) && u.password === req.body?.password); if (!user) return res.status(401).json({ error: 'Invalid email or password.' }); return res.json({ success: true, token: tokenFor(user), user: publicUser(user) }); }); app.get('/api/auth/me', (req, res) => { const user = tokenUser(req); return user ? res.json({ user: publicUser(user) }) : res.status(401).json({ error: 'Invalid or expired session.' }); });
app.get('/api/catalog', (req, res) => { if (!tokenUser(req)) return res.status(401).json({ error: 'Please sign in.' }); return res.json(rawCatalog.map(({ id, name, keywords, priceInPaise, displayPrice }) => ({ id, name, keywords, priceInPaise, displayPrice, stock: 100 }))); });
app.post('/api/agent/chat', async (req, res) => {
  try {
    // ── Auth guard ────────────────────────────────────────────────────────────
    const user = tokenUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in before using checkout.' });

    // ── Delegate to the conversational state machine ──────────────────────────
    // processMessage handles: intent detection, cart management, GST calculation,
    // and the full Propose → Explain → Gate → Audit spine pipeline.
    const result = await processMessage(user.id, req.body?.query ?? '', {
      user,
      catalog,
      rawCatalog,
      // Provide a Razorpay order factory only when credentials are available.
      // The agent checks for null before calling, so startup always succeeds.
      createRazorpayOrder: (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
        ? async (params) => {
            const rzp = new Razorpay({
              key_id:     process.env.RAZORPAY_KEY_ID,
              key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            return rzp.orders.create(params);
          }
        : null,
    });

    // ── Shape and return the HTTP response ────────────────────────────────────
    return res.json({
      success:          result.success,
      agentResponse:    result.agentResponse,
      suggestedReplies: result.suggestedReplies,
      spine:            result.spineTrace,
      cartState:        result.cartState,
      auditLog:         userPaymentAudit(user.id),
      pendingCheckout:  result.pendingCheckout ?? null,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});
const paymentOutcomes = new Set(['paid', 'failed', 'cancelled']);
const userPaymentAudit = (userId) => readAuditLog().filter((x) => x.userId === userId && paymentOutcomes.has(x.status));
app.get('/api/audit', (req, res) => { const user = tokenUser(req); if (!user) return res.status(401).json({ error: 'Please sign in to view audit history.' }); return res.json(userPaymentAudit(user.id)); });
// Exposes only the PUBLIC key — safe for the browser. KEY_SECRET never leaves the server.
app.get('/api/config/rzp-key', (req, res) => { const user = tokenUser(req); if (!user) return res.status(401).json({ error: 'Please sign in.' }); return res.json({ keyId: process.env.RAZORPAY_KEY_ID || null }); });

// ─── Razorpay Payment Routes ────────────────────────────────────────────────
// Mounted at /api/payment — exposes POST /api/payment/order & /api/payment/verify
// Requires MOCK_MODE=false and valid KEY_ID / KEY_SECRET in .env for live payments.
// In mock/test mode the SDK will still initialise; checkout.js test cards work fine.
const _rzpKeyId = process.env.RAZORPAY_KEY_ID;
const _rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
if (_rzpKeyId && _rzpKeySecret) {
  const _rzpSdk = new Razorpay({ key_id: _rzpKeyId, key_secret: _rzpKeySecret });
  app.use('/api/payment', createPaymentRouter(tokenUser, _rzpSdk, _rzpKeySecret));
} else {
  // Keys not set — stub the payment routes so the app still starts cleanly
  app.use('/api/payment', (_req, res) =>
    res.status(503).json({ error: 'Razorpay keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.' })
  );
  console.warn('[server] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — payment routes disabled.');
}

app.use((_q, res) => res.sendFile(join(__dirname, '..', 'public', 'index.html'))); if (require.main === module) app.listen(PORT, () => console.log(`Agentic Commerce UI listening on http://localhost:${PORT}`)); module.exports = { app, users, tokenFor };
