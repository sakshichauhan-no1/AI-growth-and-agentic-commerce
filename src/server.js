'use strict';
require('dotenv').config({ quiet: true });
const express = require('express'); const { randomUUID, createHmac, timingSafeEqual } = require('node:crypto'); const { existsSync, readFileSync, writeFileSync } = require('node:fs'); const { join, resolve } = require('node:path');
const Razorpay = require('razorpay');
const { createRazorpayClient } = require('./api/razorpayClient');
const { createPaymentRouter } = require('./api/paymentRoutes');
const { proposeAction, explain, gate, execute, readAuditLog, audit: writeAudit } = require('./agent/spine');

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
  { id: 'sku_organizer', name: 'Desk Cable Organizer', keywords: ['organizer', 'cable organizer', 'desk organizer'], priceInPaise: 29900, displayPrice: '₹299' }
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
const app = express(), PORT = Number(process.env.PORT) || 3000, USERS_PATH = resolve(__dirname, 'mock', 'users.json'), TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'agentic-checkout-local-secret'; app.use(express.json()); app.use(express.static(join(__dirname, '..', 'public')));
const email = v => typeof v === 'string' ? v.trim().toLowerCase() : ''; const users = () => { const s = existsSync(USERS_PATH) ? readFileSync(USERS_PATH, 'utf8').trim() : ''; return s ? JSON.parse(s) : [] }; const save = u => writeFileSync(USERS_PATH, `${JSON.stringify(u, null, 2)}\n`, 'utf8'); const publicUser = u => ({ id: u.id, name: u.name, email: u.email });
function tokenFor(u) { const p = Buffer.from(u.id).toString('base64url'), sig = createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url'); return `${p}.${sig}`; } function tokenUser(req) { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return null; const [p, s] = m[1].split('.'); if (!p || !s) return null; const expected = createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url'); if (s.length !== expected.length || !timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null; return users().find(u => u.id === Buffer.from(p, 'base64url').toString()) || null; }
app.post('/api/auth/signup', (req, res) => { const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '', e = email(req.body?.email), password = req.body?.password; if (!name || !e.includes('@') || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Name, valid email, and password (8+ characters) are required.' }); const list = users(); if (list.some(u => u.email === e)) return res.status(409).json({ error: 'An account already exists for this email.' }); const user = { id: randomUUID(), name, email: e, password }; list.push(user); save(list); return res.status(201).json({ success: true, token: tokenFor(user), user: publicUser(user) }); });
app.post('/api/auth/login', (req, res) => { const user = users().find(u => u.email === email(req.body?.email) && u.password === req.body?.password); if (!user) return res.status(401).json({ error: 'Invalid email or password.' }); return res.json({ success: true, token: tokenFor(user), user: publicUser(user) }); }); app.get('/api/auth/me', (req, res) => { const user = tokenUser(req); return user ? res.json({ user: publicUser(user) }) : res.status(401).json({ error: 'Invalid or expired session.' }); });
app.post('/api/agent/chat', async (req, res) => {
  try {
    const user = tokenUser(req); if (!user) return res.status(401).json({ error: 'Please sign in before using checkout.' });
    const spine = { propose: { status: 'pending' }, explain: { status: 'pending' }, gate: { status: 'pending' }, execute: { status: 'pending' }, audit: { status: 'pending' } };
    let agentResponse = '', success = false, request, proposed, explained, gated, auditLogEntry;

    try { request = parseBuyerQuery(req.body?.query); } catch (e) { spine.propose = { status: 'failed', error: e.message }; return res.json({ success: false, agentResponse: e.message, spine, auditLog: readAuditLog().filter(x => x.userId === user.id) }); }

    if (request.type === 'GREETING') {
      const greetingSpine = { propose: '—', explain: '—', gate: 'Informational Query', execute: 'No Money Action', audit: 'Skipped' };
      return res.json({ success: true, agentResponse: "Hello", spine: greetingSpine, auditLog: readAuditLog().filter(x => x.userId === user.id) });
    }

    if (request.type === 'FAREWELL') {
      const farewellSpine = { propose: '—', explain: '—', gate: 'Informational Query', execute: 'No Money Action', audit: 'Skipped' };
      return res.json({ success: true, agentResponse: "Bye, see u soon", spine: farewellSpine, auditLog: readAuditLog().filter(x => x.userId === user.id) });
    }

    if (request.type === 'FALLBACK') {
      spine.propose = { status: 'failed', error: 'Out-of-Catalog Fallback' };
      return res.json({ success: false, agentResponse: "I couldn't find exactly what you're looking for. Some examples of what I have: Wireless Mouse, Mechanical Keyboard, HD Webcam, or Desk LED Lamp.", spine, auditLog: readAuditLog().filter(x => x.userId === user.id) });
    }

    try {
      proposed = proposeAction({ ...request, customerId: user.email, userId: user.id, userName: user.name, userEmail: user.email }, catalog); spine.propose = { status: 'success' };
      explained = explain(proposed); spine.explain = { status: 'success' };
      gated = gate(explained, { merchantOptIn: true }); spine.gate = { status: gated.gate.approved ? 'success' : 'failed', reasons: gated.gate.reasons };
      const formattedPrice = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(proposed.amountPaise / 100);
      if (!gated.gate.approved) {
        spine.execute = { status: 'skipped', blocked: true }; spine.audit = { status: 'skipped' };
        if (proposed.amountPaise > 1000000) {
          agentResponse = `❌ Order Rejected: ${proposed.product.name} (${formattedPrice}) exceeds the agent spending ceiling limit of ₹10,000.`;
          spine.gate.reasons = ['>₹10k Limit'];
        } else {
          agentResponse = `Gate rejected: ${gated.gate.reasons.join(' ')}`;
        }
        writeAudit({ actionId: gated.id, actionType: gated.type, userId: gated.userId, user: { id: gated.userId, name: gated.userName, email: gated.userEmail }, executedAt: new Date().toISOString(), gate: gated.gate, status: 'rejected' });
      }
      else {
        try {
          // Create a real Razorpay order via the SDK (keys required in .env)
          // The frontend will open the checkout modal and call /api/payment/verify.
          const matchedItem = rawCatalog.find(c => c.id === proposed.product.id);
          const dispPrice = matchedItem ? matchedItem.displayPrice : formattedPrice;

          let rzpOrderId = null;
          const rzpKeyId = process.env.RAZORPAY_KEY_ID;
          const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

          if (rzpKeyId && rzpSecret) {
            // Real Razorpay order — modal will open on the frontend
            try {
              const rzpSdk = new Razorpay({ key_id: rzpKeyId, key_secret: rzpSecret });
              const order = await rzpSdk.orders.create({
                amount: proposed.amountPaise,
                currency: proposed.currency,
                receipt: `chat_${gated.id.slice(-12)}`,
                notes: {
                  userId: user.id,
                  userEmail: user.email,
                  productId: proposed.product.id,
                  itemName: proposed.product.name,
                  itemPrice: String(proposed.amountPaise),
                },
              });
              rzpOrderId = order.id;
            } catch (rzpErr) {
              console.warn('[agent/chat] Razorpay orders.create() failed:', rzpErr?.error ?? rzpErr.message);
              // rzpOrderId stays null — pendingCheckout will be null, no modal
            }
          }

          // Write a 'pending-checkout' audit entry (will be updated to 'paid' by /verify)
          auditLogEntry = writeAudit({
            actionId: gated.id,
            actionType: gated.type,
            userId: gated.userId,
            user: { id: gated.userId, name: gated.userName, email: gated.userEmail },
            executedAt: new Date().toISOString(),
            gate: gated.gate,
            status: rzpOrderId ? 'pending-checkout' : 'executed',
            itemName: proposed.product.name,
            itemPrice: dispPrice,
            amountPaise: proposed.amountPaise,
            order: rzpOrderId ? { id: rzpOrderId } : { id: `mock_${Date.now()}` },
          });

          spine.execute = { status: 'success' };
          spine.audit = { status: 'success' };
          agentResponse = rzpOrderId
            ? `🛒 Initiating checkout for ${proposed.quantity} x ${proposed.product.name} (${dispPrice})…`
            : `✅ Item added to transaction: ${proposed.quantity} x ${proposed.product.name} (${dispPrice}). Transaction executed successfully!`;
          success = true;

          // Return pendingCheckout so the frontend opens the Razorpay modal
          return res.json({
            success,
            agentResponse,
            spine,
            auditLog: readAuditLog().filter(x => x.userId === user.id),
            pendingCheckout: rzpOrderId ? {
              orderId: rzpOrderId,
              amountPaise: proposed.amountPaise,
              currency: proposed.currency,
              itemName: proposed.product.name,
              itemPrice: dispPrice,
              userName: user.name,
              userEmail: user.email,
            } : null,
          });
        }
        catch (e) {
          spine.execute = { status: 'failed', error: e.message }; spine.audit = { status: 'failed' };
          agentResponse = `Execution failed: ${e.message}`;
        }
      }
    } catch (e) { agentResponse = `Error: ${e.message}`; }
    return res.json({ success, agentResponse, spine, auditLog: readAuditLog().filter(x => x.userId === user.id) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/audit', (req, res) => { const user = tokenUser(req); if (!user) return res.status(401).json({ error: 'Please sign in to view audit history.' }); return res.json(readAuditLog().filter(x => x.userId === user.id)); });
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
