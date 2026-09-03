'use strict';

/**
 * src/agent/index.js — Conversational State Machine for Agentic Commerce
 *
 * Replaces the direct-to-checkout behavior with a full conversational state machine:
 *  - Welcoming greetings showcasing catalog items
 *  - Multi-item cart management mapped to the user/session in-memory
 *  - Price bifurcation displaying base price + applicable taxes (18% GST)
 *  - Dynamic suggested replies array based on current conversational state
 *  - Full preservation of the Propose → Explain → Gate → Audit spine pipeline
 *
 * Also maintains backwards-compatible exports: parseBuyerQuery, checkout, runDemoScenarios.
 */

const catalogData = require('../mock/catalog.json');
const { createRazorpayClient } = require('../api/razorpayClient');
const { proposeAction, explain, gate, execute, audit, runSpine } = require('./spine');

// ─── Configuration & Constants ────────────────────────────────────────────────

/** Applicable Goods and Services Tax rate (18% GST). */
const GST_RATE = 0.18;

/** Default currency code. */
const CURRENCY = 'INR';

// ─── In-Memory Cart Store ─────────────────────────────────────────────────────

/**
 * @typedef {Object} CartItem
 * @property {string} productId
 * @property {string} name
 * @property {number} quantity
 * @property {number} basePricePerUnit   - base price in paise
 * @property {number} gstPerUnit         - GST portion in paise (18%)
 * @property {number} totalPerUnit       - GST-inclusive price in paise
 * @property {number} totalPaise         - totalPerUnit * quantity
 * @property {string} displayPrice       - formatted base price (e.g. "₹1,299")
 */

/**
 * @typedef {Object} CartState
 * @property {CartItem[]} items
 * @property {string}     lastUpdatedAt
 */

/** @type {Map<string, CartState>} */
const _userCarts = new Map();
const _lastCheckoutCarts = new Map();

/**
 * Retrieve the active cart for a user/session, creating one if absent.
 * @param {string} userId
 * @returns {CartState}
 */
function getCart(userId = 'default_user') {
  if (!_userCarts.has(userId)) {
    _userCarts.set(userId, { items: [], lastUpdatedAt: new Date().toISOString() });
  }
  return _userCarts.get(userId);
}

/**
 * Clear the user's cart state.
 * @param {string} userId
 */
function clearCart(userId = 'default_user') {
  _userCarts.delete(userId);
}

function restoreLastCheckout(userId) {
  const previous = _lastCheckoutCarts.get(userId);
  if (!previous?.length) return false;
  _userCarts.set(userId, { items: previous.map((item) => ({ ...item })), lastUpdatedAt: new Date().toISOString() });
  return true;
}

// ─── Formatting & Calculation Helpers ─────────────────────────────────────────

/**
 * Formats paise to Indian Rupee currency format (e.g. ₹1,299).
 * @param {number} paise
 * @returns {string}
 */
function fmt(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(paise / 100));
}

/**
 * Calculate GST portion and total price in paise.
 * @param {number} basePaise
 * @returns {{ gst: number, total: number }}
 */
function gstInclusive(basePaise) {
  const gst = Math.round(basePaise * GST_RATE);
  return { gst, total: basePaise + gst };
}

/**
 * Sum up the total of all items in cart (GST inclusive).
 * @param {CartState} cart
 * @returns {number}
 */
function cartTotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.totalPaise, 0);
}

/**
 * Create a formatted text breakdown of the cart with clean bullet pointers.
 * @param {CartState} cart
 * @returns {string}
 */
function cartSummaryText(cart) {
  if (!cart.items.length) return '🛒 Your cart is currently empty.';

  const lines = [
    '🛒 **Your Cart Items:**\n',
    ...cart.items.map((item, idx) =>
      `• **${item.name}** (Qty: ${item.quantity}) — **${fmt(item.totalPaise)}**\n  ↳ Base: ${fmt(item.basePricePerUnit * item.quantity)} | GST (18%): ${fmt(item.gstPerUnit * item.quantity)}`
    ),
    '',
    `🧾 **Cart Total:** **${fmt(cartTotal(cart))}** (incl. 18% GST)`
  ];
  return lines.join('\n');
}

// ─── Suggested Replies Helpers ────────────────────────────────────────────────

/**
 * Suggested replies for greeting / welcome state.
 * Strictly 'Browse Catalog' per welcome message requirements.
 * @param {Array} catalog
 * @returns {string[]}
 */
function greetingSuggestions(catalog = []) {
  return ['Browse Catalog'];
}

/**
 * Suggested replies after items are in the cart.
 * Includes 'Browse Catalog' so the user can easily add more items.
 * @param {CartState} cart
 * @returns {string[]}
 */
function cartSuggestions(cart) {
  const total = cartTotal(cart);
  const replies = ['Browse Catalog'];

  const hasWarranty = cart.items.some((i) => /warranty/i.test(i.name));
  if (!hasWarranty) {
    replies.push('Add Extended Warranty');
  }

  replies.push(`Proceed to Checkout (${fmt(total)})`);
  replies.push('View Cart');
  replies.push('Clear Cart');

  return replies;
}

function warrantyQuantity(cart) {
  return cart.items
    .filter((item) => !/warranty/i.test(item.name))
    .reduce((sum, item) => sum + item.quantity, 0);
}

function syncWarranty(cart) {
  const warranty = cart.items.find((item) => /warranty/i.test(item.name));
  if (!warranty) return;
  warranty.quantity = warrantyQuantity(cart);
  warranty.totalPaise = warranty.totalPerUnit * warranty.quantity;
}

/**
 * Fallback suggestions when query is unrecognized.
 * @returns {string[]}
 */
function fallbackSuggestions() {
  return ['Browse Catalog', 'View Cart', 'Start over'];
}

// ─── Normalization & Fuzzy Search ─────────────────────────────────────────────

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Finds a matching catalog product based on user query tokens.
 * Works with both rawCatalog (with .keywords and .priceInPaise) and standard catalog.
 */
function findCatalogProduct(query, products = catalogData) {
  if (!query || typeof query !== 'string') return null;
  const qLower = normalize(query);
  const queryWords = new Set(qLower.split(' ').filter(Boolean));
  if (!queryWords.size) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const item of products) {
    const itemWords = normalize(item.name).split(' ').filter(Boolean);
    const keywords = (item.keywords || []).flatMap((kw) => normalize(kw).split(' ').filter(Boolean));
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

  return bestMatch;
}

/**
 * Detects conversational intent from the user message.
 */
function detectIntent(query, catalog = catalogData) {
  const q = (query || '').trim();
  const ql = q.toLowerCase();

  if (/^(hi|hello|hey|good\s+morning|good\s+evening|greetings|yello|hola)\b/i.test(q)) {
    return { type: 'GREETING' };
  }
  if (/^(bye|goodbye|see\s+ya|thanks|thank\s+you|cya)\b/i.test(q)) {
    return { type: 'FAREWELL' };
  }
  if (/\b(browse(\s+catalog)?|catalog|view\s+catalog|show\s+catalog|all\s+items|products|what\s+can\s+i\s+buy|menu|list\s+items|shop)\b/i.test(ql)) {
    return { type: 'BROWSE_CATALOG' };
  }
  if (/\b(checkout|proceed|pay\s+now|buy\s+now|confirm|place\s+order|finish|done)\b/i.test(ql)) {
    return { type: 'CHECKOUT' };
  }
  if (/\b(retry|try again|pay again|resume)\b.*\b(payment|checkout|order|purchase)\b|\b(payment|checkout)\b.*\b(retry|again|resume)\b/i.test(ql)) {
    return { type: 'RETRY_PAYMENT' };
  }
  if (/\b(clear\s+cart|empty\s+cart|reset\s+cart|remove\s+all|start\s+over)\b/i.test(ql)) {
    return { type: 'CLEAR_CART' };
  }
  if (/\b(my\s+cart|view\s+cart|show\s+cart|what.*added|basket|my\s+items)\b/i.test(ql)) {
    return { type: 'VIEW_CART' };
  }

  const product = findCatalogProduct(ql, catalog);
  if (product) {
    const quantityMatch = ql.match(/\b(\d+)\b/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    return { type: 'ADD_ITEM', product, quantity: Math.max(1, quantity) };
  }

  return { type: 'FALLBACK' };
}

// ─── Spine Trace Helpers ──────────────────────────────────────────────────────

function pendingSpine() {
  return {
    propose: { status: 'pending' },
    explain: { status: 'pending' },
    gate:    { status: 'pending' },
    execute: { status: 'pending' },
    audit:   { status: 'pending' },
  };
}

function infoSpine(label) {
  return {
    propose: '—',
    explain: '—',
    gate:    label,
    execute: 'No Money Action',
    audit:   'Skipped',
  };
}

// ─── Conversational State Machine: processMessage ─────────────────────────────

/**
 * Process a message turn through the conversational state machine.
 *
 * @param {string} userId                      - session/user ID
 * @param {string} query                       - buyer query text
 * @param {Object} options
 * @param {Object} options.user                - authenticated user object
 * @param {Array}  options.catalog             - catalog items
 * @param {Array}  options.rawCatalog          - raw catalog items with display info
 * @param {Function} [options.createRazorpayOrder] - async function to create real Razorpay order
 * @returns {Promise<Object>}
 */
async function processMessage(userId, query, options = {}) {
  const user = options.user || { id: userId, name: 'Customer', email: `${userId}@example.com` };
  const rawCatalog = options.rawCatalog || options.catalog || catalogData;
  const catalog = options.catalog || catalogData;
  const createRazorpayOrder = options.createRazorpayOrder || null;

  // 1. Guard against blank queries
  if (typeof query !== 'string' || !query.trim()) {
    return {
      success: false,
      agentResponse: 'Please let me know what you would like to purchase, or say "Hello" to see available items.',
      suggestedReplies: greetingSuggestions(rawCatalog),
      spineTrace: infoSpine('Empty query'),
      cartState: getCart(userId),
      pendingCheckout: null,
    };
  }

  const intent = detectIntent(query, rawCatalog);
  const cart = getCart(userId);

  if (intent.type === 'RETRY_PAYMENT') {
    if (!cart.items.length && !restoreLastCheckout(userId)) {
      return {
        success: false,
        agentResponse: 'I could not find the previous cart. Please add the items again before retrying payment.',
        suggestedReplies: greetingSuggestions(rawCatalog),
        spineTrace: infoSpine('Retry unavailable — cart expired'),
        cartState: getCart(userId),
        pendingCheckout: null,
      };
    }
    return processMessage(userId, 'Proceed to Checkout', options);
  }

  // ── GREETING STATE ──────────────────────────────────────────────────────────
  if (intent.type === 'GREETING') {
    const previewItems = rawCatalog
      .slice(0, 6)
      .map((p) => `• **${p.name}** — ${p.displayPrice || fmt(p.price || p.priceInPaise)}`)
      .join('\n');

    return {
      success: true,
      agentResponse: [
        `👋 Welcome to Agentic Commerce! I am your autonomous shopping agent.\n`,
        `📦 **Featured Catalog Items:**\n`,
        previewItems,
        ``,
        `💡 Type or click **"Browse Catalog"** below to explore all available products and start shopping!`
      ].join('\n'),
      suggestedReplies: ['Browse Catalog'],
      spineTrace: infoSpine('Informational — greeting'),
      cartState: cart,
      pendingCheckout: null,
    };
  }

  // ── BROWSE_CATALOG STATE ───────────────────────────────────────────────────
  if (intent.type === 'BROWSE_CATALOG') {
    const productList = rawCatalog
      .map((p) => `• **${p.name}** — ${p.displayPrice || fmt(p.price || p.priceInPaise)}`)
      .join('\n');

    const agentResponse = [
      `📦 **Available Products in Catalog:**\n`,
      productList,
      ``,
      `💡 Tap any suggestion below or type the item name to add it to your cart:`
    ].join('\n');

    const replies = rawCatalog.slice(0, 5).map((p) => `Buy ${p.name}`);
    if (cart.items.length) {
      replies.push(`Proceed to Checkout (${fmt(cartTotal(cart))})`, 'View Cart');
    }

    return {
      success: true,
      agentResponse,
      suggestedReplies: replies,
      spineTrace: infoSpine('Informational — browse catalog'),
      cartState: cart,
      pendingCheckout: null,
    };
  }

  // ── FAREWELL STATE ──────────────────────────────────────────────────────────
  if (intent.type === 'FAREWELL') {
    return {
      success: true,
      agentResponse: '👋 Thank you for checking out with us! Have a great day.',
      suggestedReplies: ['Browse catalog', 'Start over'],
      spineTrace: infoSpine('Informational — farewell'),
      cartState: cart,
      pendingCheckout: null,
    };
  }

  // ── VIEW_CART STATE ─────────────────────────────────────────────────────────
  if (intent.type === 'VIEW_CART') {
    const empty = cart.items.length === 0;
    return {
      success: true,
      agentResponse: empty
        ? '🛒 Your cart is currently empty. Tell me what product you would like to buy!'
        : `🛒 **Current Cart**\n\n${cartSummaryText(cart)}`,
      suggestedReplies: empty ? greetingSuggestions(rawCatalog) : cartSuggestions(cart),
      spineTrace: infoSpine('Informational — view cart'),
      cartState: cart,
      pendingCheckout: null,
    };
  }

  // ── CLEAR_CART STATE ────────────────────────────────────────────────────────
  if (intent.type === 'CLEAR_CART') {
    clearCart(userId);
    _lastCheckoutCarts.delete(userId);
    return {
      success: true,
      agentResponse: '🗑️ Your cart has been cleared. What would you like to buy next?',
      suggestedReplies: greetingSuggestions(rawCatalog),
      spineTrace: infoSpine('Informational — cart cleared'),
      cartState: getCart(userId),
      pendingCheckout: null,
    };
  }

  // ── CHECKOUT STATE ──────────────────────────────────────────────────────────
  if (intent.type === 'CHECKOUT') {
    if (cart.items.length === 0) {
      return {
        success: false,
        agentResponse: '🛒 Your cart is empty! Please add items to your cart before proceeding to checkout.',
        suggestedReplies: greetingSuggestions(rawCatalog),
        spineTrace: infoSpine('Checkout skipped — cart empty'),
        cartState: cart,
        pendingCheckout: null,
      };
    }

    const total = cartTotal(cart);
    const spineTrace = pendingSpine();
    _lastCheckoutCarts.set(userId, cart.items.map((item) => ({ ...item })));

    let rzpOrderId = null;
    if (typeof createRazorpayOrder === 'function') {
      try {
        const rzpOrder = await createRazorpayOrder({
          amount: total,
          currency: CURRENCY,
          receipt: `rcpt_${userId.slice(-6)}_${Date.now().toString(36)}`.slice(0, 40),
          notes: {
            userId: user.id,
            userEmail: user.email,
            itemCount: String(cart.items.length),
            items: cart.items.map((i) => `${i.quantity}x ${i.name}`).join(', ').slice(0, 200),
          },
        });
        rzpOrderId = rzpOrder.id;
        spineTrace.execute = { status: 'success' };
        spineTrace.audit   = { status: 'success' };
      } catch (err) {
        console.warn('[agent/checkout] Razorpay order creation failed:', err?.error ?? err.message);
        spineTrace.execute = { status: 'failed', error: err.message };
        spineTrace.audit   = { status: 'failed' };
      }
    } else {
      spineTrace.execute = { status: 'skipped', reason: 'No payment order factory provided' };
      spineTrace.audit   = { status: 'skipped' };
    }

    // Persist a pending-checkout audit entry for the entire cart
    audit({
      actionId: `checkout_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      actionType: 'CART_CHECKOUT',
      userId: user.id,
      user: { id: user.id, name: user.name, email: user.email },
      executedAt: new Date().toISOString(),
      status: rzpOrderId ? 'pending-checkout' : 'executed',
      cartItems: cart.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        totalPaise: i.totalPaise,
      })),
      amountPaise: total,
      order: rzpOrderId ? { id: rzpOrderId } : { id: `mock_${Date.now()}` },
    });

    const checkedOutItems = [...cart.items];
    clearCart(userId);

    const itemsSummary = checkedOutItems
      .map((i) => `• **${i.name}** × ${i.quantity} — ${fmt(i.totalPaise)}`)
      .join('\n');

    const agentResponse = rzpOrderId
      ? [
          `🛒 **Initiating Checkout:**\n`,
          itemsSummary,
          ``,
          `🧾 **Total Payable:** **${fmt(total)}** (incl. 18% GST)`,
          `💳 Opening Razorpay payment gateway…`,
        ].join('\n')
      : [
          `✅ **Order Created:**\n`,
          itemsSummary,
          ``,
          `🧾 **Total Payable:** **${fmt(total)}** (incl. 18% GST)`,
        ].join('\n');

    return {
      success: true,
      agentResponse,
      suggestedReplies: ['Browse Catalog', 'Start over'],
      spineTrace,
      cartState: getCart(userId),
      pendingCheckout: rzpOrderId
        ? {
            orderId: rzpOrderId,
            amountPaise: total,
            currency: CURRENCY,
            items: checkedOutItems.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              totalPaise: i.totalPaise,
            })),
            userName: user.name,
            userEmail: user.email,
          }
        : null,
    };
  }

  // ── ADD_ITEM STATE ──────────────────────────────────────────────────────────
  if (intent.type === 'ADD_ITEM') {
    const { product: matchedProduct } = intent;
    const requestedQuantity = intent.quantity;
    const isWarranty = /warranty/i.test(matchedProduct.name);
    const quantity = isWarranty ? Math.max(1, warrantyQuantity(cart)) : requestedQuantity;
    const spineTrace = pendingSpine();

    const baseUnitPaise = matchedProduct.priceInPaise || matchedProduct.price || 0;
    const { gst: gstPerUnit, total: totalPerUnit } = gstInclusive(baseUnitPaise);

    // Spine Pipeline: Propose → Explain → Gate
    let proposed, explained, gated;
    try {
      proposed = proposeAction(
        {
          productId: matchedProduct.id,
          quantity,
          actionType: /\b(add|upsell|warranty)\b/i.test(query) ? 'UPSELL' : 'CREATE_ORDER',
          customerId: user.email,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
        },
        [{ id: matchedProduct.id, name: matchedProduct.name, price: totalPerUnit, stock: 100 }]
      );
      spineTrace.propose = { status: 'success' };

      explained = explain(proposed);
      spineTrace.explain = { status: 'success' };

      gated = gate(explained, { merchantOptIn: true });
      spineTrace.gate = {
        status: gated.gate.approved ? 'success' : 'failed',
        reasons: gated.gate.reasons,
      };
    } catch (err) {
      spineTrace.propose = { status: 'failed', error: err.message };
      return {
        success: false,
        agentResponse: `⚠️ Could not propose action: ${err.message}`,
        suggestedReplies: fallbackSuggestions(),
        spineTrace,
        cartState: cart,
        pendingCheckout: null,
      };
    }

    // Gate rejection (e.g. ₹10k ceiling)
    if (!gated.gate.approved) {
      spineTrace.execute = { status: 'skipped', blocked: true };
      spineTrace.audit   = { status: 'success' };

      audit({
        actionId: gated.id,
        actionType: gated.type,
        userId: user.id,
        user: { id: user.id, name: user.name, email: user.email },
        executedAt: new Date().toISOString(),
        gate: gated.gate,
        status: 'rejected',
        itemName: matchedProduct.name,
        amountPaise: gated.amountPaise,
      });

      const reason = gated.amountPaise > 1000000
        ? 'exceeds the ₹10,000 agent spending ceiling limit'
        : gated.gate.reasons.join('; ');

      return {
        success: false,
        agentResponse: `❌ **${matchedProduct.name}** was rejected by gate: ${reason}.`,
        suggestedReplies: cart.items.length ? cartSuggestions(cart) : greetingSuggestions(rawCatalog),
        spineTrace,
        cartState: cart,
        pendingCheckout: null,
      };
    }

    // Gate approved — Add to in-memory cart with Price Bifurcation
    const cartItem = {
      productId: matchedProduct.id,
      name: matchedProduct.name,
      quantity,
      basePricePerUnit: baseUnitPaise,
      gstRate: GST_RATE,
      gstPerUnit,
      totalPerUnit,
      totalPaise: totalPerUnit * quantity,
      displayPrice: matchedProduct.displayPrice || fmt(baseUnitPaise),
    };

    if (isWarranty) {
      const existingWarranty = cart.items.find((item) => /warranty/i.test(item.name));
      if (existingWarranty) {
        existingWarranty.quantity = quantity;
        existingWarranty.totalPaise = existingWarranty.totalPerUnit * quantity;
      } else {
        cart.items.push(cartItem);
      }
    } else {
      cart.items.push(cartItem);
      syncWarranty(cart);
    }
    cart.lastUpdatedAt = new Date().toISOString();

    spineTrace.execute = { status: 'success' };
    spineTrace.audit   = { status: 'success' };

    // Record 'cart-add' audit log entry
    audit({
      actionId: gated.id,
      actionType: gated.type,
      userId: user.id,
      user: { id: user.id, name: user.name, email: user.email },
      executedAt: new Date().toISOString(),
      gate: gated.gate,
      status: 'cart-add',
      itemName: matchedProduct.name,
      itemPrice: cartItem.displayPrice,
      quantity,
      basePaise: baseUnitPaise * quantity,
      gstPaise: gstPerUnit * quantity,
      amountPaise: cartItem.totalPaise,
    });

    // Detailed Price Bifurcation in clean pointers
    const baseTotal = fmt(baseUnitPaise * quantity);
    const gstTotal  = fmt(gstPerUnit * quantity);
    const itemTotal = fmt(cartItem.totalPaise);
    const runTotal  = cartTotal(cart);
    const warranty = cart.items.find((item) => /warranty/i.test(item.name));
    const warrantyNote = !isWarranty && warranty
      ? `\n🛡️ Extended Warranty updated to **${warranty.quantity} × ${fmt(warranty.totalPerUnit)}** for every product in your cart.`
      : '';

    const agentResponse = [
      `✅ Added **${quantity} × ${matchedProduct.name}** to your cart!\n`,
      `📋 **Price Breakdown:**`,
      `• Base Price: ${baseTotal}`,
      `• Applicable GST (18%): ${gstTotal}`,
      `• Item Total: **${itemTotal}**\n`,
      `🛒 **Cart Summary:**`,
      `• Total Items in Cart: ${cart.items.length}`,
      `• Running Cart Total: **${fmt(runTotal)}** (incl. 18% GST)`,
      warrantyNote,
    ].join('\n');

    return {
      success: true,
      agentResponse,
      suggestedReplies: cartSuggestions(cart),
      spineTrace,
      cartState: { ...cart },
      pendingCheckout: null,
    };
  }

  // ── FALLBACK STATE ──────────────────────────────────────────────────────────
  const preview = rawCatalog.slice(0, 4).map((p) => `• **${p.name}**`).join('\n');
  return {
    success: false,
    agentResponse: [
      `🤔 I could not find a match for that. Here are some popular options:\n`,
      preview,
      ``,
      `💡 Say **"Browse catalog"** to view all available products.`
    ].join('\n'),
    suggestedReplies: ['Browse Catalog', ...rawCatalog.slice(0, 3).map((p) => `Buy ${p.name}`)],
    spineTrace: infoSpine('Out-of-catalog fallback'),
    cartState: cart,
    pendingCheckout: null,
  };
}

// ─── Backwards Compatibility Shims ────────────────────────────────────────────

/**
 * Legacy query parser for backwards compatibility with tests and demo runners.
 */
function parseBuyerQuery(query, products = catalogData) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Please tell me which catalog item you want to buy.');
  }

  const product = findCatalogProduct(query, products);
  if (!product) throw new Error(`I could not find a catalog item matching "${query}".`);

  const normalizedQuery = normalize(query);
  const quantityMatch = normalizedQuery.match(/\b(\d+)\b/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const actionType = /\b(add|upsell|warranty)\b/.test(normalizedQuery) ? 'UPSELL' : 'CREATE_ORDER';

  return { productId: product.id, quantity, actionType };
}

/**
 * Legacy single-query checkout for scripts/tests.
 */
async function checkout(query, options = {}) {
  const request = parseBuyerQuery(query, options.catalog ?? catalogData);
  return runSpine(
    { ...request, customerId: options.customerId ?? 'conversational-buyer' },
    {
      catalog: options.catalog ?? catalogData,
      client: options.client ?? createRazorpayClient(),
      policy: { merchantOptIn: options.merchantOptIn === true },
      auditLogPath: options.auditLogPath,
    }
  );
}

/**
 * Legacy demo scenario runner.
 */
async function runDemoScenarios(options = {}) {
  const shared = {
    ...options,
    merchantOptIn: true,
    client: options.client ?? createRazorpayClient(),
  };
  const scenarios = [
    { name: 'Scenario A: standard checkout', query: 'I want to buy a wireless mouse' },
    { name: 'Scenario B: extended-warranty upsell', query: 'Add an extended warranty' },
    { name: 'Scenario C: ceiling rejection', query: 'I want to buy a premium laptop' },
  ];

  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push({ ...scenario, result: await checkout(scenario.query, shared) });
    } catch (error) {
      results.push({ ...scenario, result: error.audit ?? { status: 'failed', error: error.message } });
    }
  }
  return results;
}

if (require.main === module) {
  runDemoScenarios()
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  // State Machine API
  processMessage,
  getCart,
  clearCart,
  detectIntent,
  findCatalogProduct,
  cartTotal,
  gstInclusive,
  GST_RATE,
  CURRENCY,

  // Backwards-compatible legacy exports
  parseBuyerQuery,
  checkout,
  runDemoScenarios,
};
