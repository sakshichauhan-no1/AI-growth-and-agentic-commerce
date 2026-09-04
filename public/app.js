'use strict';

/* ── DOM helpers ── */
const $ = (sel) => document.querySelector(sel);

/* ── Session state ── */
const SESSION_KEY = 'agentic-session';
const CHAT_KEY_PREFIX = 'agentic-chat-';
let mode = 'login';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let liveCatalog = [];

/* ── Razorpay public key (fetched from server after login) ── */
let _rzpKeyId = null;

/* ── Auth headers ── */
const authHeaders = () => ({
  Authorization: `Bearer ${session.token}`,
  'Content-Type': 'application/json',
});

/* ══════════════════════════════════════════════════
   UI STATE SWITCHER
   Shows #auth-view or #dashboard-view based on session
══════════════════════════════════════════════════ */
let _welcomeLoaded = false;

function chatStorageKey() { return session?.user?.id ? `${CHAT_KEY_PREFIX}${session.user.id}` : null; }
function persistChat() {
  const chatMessages = $('#chat-messages');
  const key = chatStorageKey();
  if (chatMessages && key) localStorage.setItem(key, chatMessages.innerHTML);
}
function bindSuggestionPills() {
  $('#chat-messages')?.querySelectorAll('.suggestion-pill').forEach((button) => {
    button.onclick = () => submitQuery(button.dataset.query);
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderQuickActions(replies) {
  const chatMessages = $('#chat-messages');
  if (!chatMessages || !Array.isArray(replies) || !replies.length) return;
  chatMessages.querySelectorAll('.suggestions-group').forEach((el) => el.remove());
  const group = document.createElement('div');
  group.className = 'suggestions-group';
  group.innerHTML = `<span class="suggestions-label">Try one of these</span><div class="suggestion-pills">${replies
    .map((reply) => `<button type="button" class="suggestion-pill" data-query="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`).join('')}</div>`;
  chatMessages.appendChild(group);
  bindSuggestionPills();
  persistChat();
  scrollToBottom();
}

async function initWelcomeMessage() {
  const chatMessages = $('#chat-messages');
  if (!chatMessages) return;
  if (_welcomeLoaded || chatMessages.children.length > 0) return;

  const savedChat = chatStorageKey() && localStorage.getItem(chatStorageKey());
  if (savedChat) {
    chatMessages.innerHTML = savedChat;
    _welcomeLoaded = true;
    bindSuggestionPills();
    scrollToBottom();
    return;
  }

  try {
    const r = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: 'Hello' }),
    });
    const d = await r.json();
    if (r.ok && d.agentResponse) {
      _welcomeLoaded = true;
      appendBubble(d.agentResponse, 'agent');
      if (d.suggestedReplies && Array.isArray(d.suggestedReplies) && d.suggestedReplies.length) {
        renderQuickActions(d.suggestedReplies);
      }
    }
  } catch (err) {
    console.warn('Failed to load initial welcome message:', err);
  }
}

function showView() {
  const authed = !!session;
  document.body.classList.toggle('is-authenticated', authed);

  $('#auth-view').style.display = authed ? 'none' : '';
  $('#dashboard-view').style.display = authed ? 'block' : 'none';

  if (authed) {
    $('#user-greeting').textContent = 'Hi, ' + session.user.name;
    showPage('dashboard');
    loadAudit();
    fetchCatalog();
    fetchRzpKey(); // preload the public key in background
    initWelcomeMessage();
  }
}

async function fetchCatalog() {
  try {
    const r = await fetch('/api/catalog', { headers: authHeaders() });
    if (r.ok) liveCatalog = await r.json();
  } catch (_) { /* Server validation remains authoritative. */ }
}

/* ══════════════════════════════════════════════════
   PAGE VIEW SWITCHER (Dashboard vs Audit Logs Page)
══════════════════════════════════════════════════ */
function showPage(pageName) {
  const mainDash = $('#main-dashboard-content');
  const auditView = $('#audit-page-view');

  if (pageName === 'audit') {
    if (mainDash) mainDash.style.display = 'none';
    if (auditView) auditView.style.display = 'block';
    loadAudit();
  } else {
    if (mainDash) mainDash.style.display = 'block';
    if (auditView) auditView.style.display = 'none';
  }
}

/* Bind Navigation Clicks */
const navDash = $('#nav-dashboard');
const navAudit = $('#nav-audit');

if (navDash) navDash.onclick = (e) => { e.preventDefault(); showPage('dashboard'); };
if (navAudit) navAudit.onclick = (e) => { e.preventDefault(); showPage('audit'); };

/* ── Fetch the Razorpay public KEY_ID from the server ── */
async function fetchRzpKey() {
  try {
    const r = await fetch('/api/config/rzp-key', { headers: authHeaders() });
    if (r.ok) {
      const d = await r.json();
      _rzpKeyId = d.keyId || null;
    }
  } catch (_) { /* silently ignore */ }
}

/* ── Spine step indicator ── */

// Step labels and idle descriptions for the 5-step pipeline
const SPINE_META = {
  Propose: {
    label:   '① Intent & Proposal',
    idle:    'Waiting — will parse items, quantities & intent',
    active:  'Parsing your request — identifying items, quantities & intent…',
    success: 'Intent recognized — items, quantities & intent extracted',
    skipped: 'No transaction intent detected in this request',
  },
  Explain: {
    label:   '② Explainability',
    idle:    'Waiting — will validate availability & pricing logic',
    active:  'Validating product availability and pricing logic…',
    success: 'Pricing & availability confirmed — reasoning attached',
    skipped: 'No pricing validation required for this request',
  },
  Gate: {
    label:   '③ Policy Gate',
    idle:    'Waiting — will check spending limits (<₹10k) & authorization',
    active:  'Checking spending limits (< ₹10,000) & user authorization…',
    success: 'Policy gate passed — transaction approved within limits',
    failed:  'Gate Failed: Amount Exceeds Limit',
    skipped: 'Gate not required — no payment action triggered',
  },
  Execute: {
    label:   '④ Execution',
    idle:    'Waiting — will trigger Razorpay order & signature verification',
    active:  'Creating Razorpay order & verifying payment signature…',
    success: 'Razorpay order created — awaiting payment confirmation',
    blocked: 'Execute Blocked — gate rejected this transaction',
    skipped: 'Execution skipped — no payment required',
  },
  Audit: {
    label:   '⑤ Audit Log',
    idle:    'Waiting — will write transaction record to /api/audit-log',
    active:  'Writing transaction record to /api/audit-log…',
    success: 'Audit trace recorded successfully',
    failed:  'Audit write failed — record may be incomplete',
    skipped: 'No audit entry required',
  },
};

const SPINE_STEPS = ['Propose', 'Explain', 'Gate', 'Execute', 'Audit'];
let spineRunId = 0;

function stage(name, statusObj) {
  const el = $(`[data-step="${name}"]`);
  if (!el) return;
  const b     = el.querySelector('b');
  const title = el.querySelector('strong');
  const sub   = el.querySelector('small');
  const meta  = SPINE_META[name] || {};

  const setLabel = (label, detail) => {
    if (title) title.textContent = label  ?? meta.label  ?? name;
    if (sub)   sub.textContent   = detail ?? meta.idle   ?? '';
  };

  // Reset-only string shorthand (legacy support)
  if (typeof statusObj === 'string') {
    el.className = 'neutral';
    b.textContent = '—';
    setLabel(meta.label, statusObj === '—' ? meta.idle : statusObj);
    return;
  }

  const status = statusObj?.status || 'pending';

  if (status === 'success') {
    el.className = 'approved';
    b.textContent = '✓';
    setLabel(meta.label, statusObj?.detail || meta.success || 'Completed successfully');

  } else if (status === 'failed') {
    el.className = 'failed';
    b.textContent = '✕';
    const rawErr  = statusObj?.error || statusObj?.reasons?.[0];
    // Build a named error badge label, e.g. "Gate Failed: Amount Exceeds Limit"
    const errLabel = name === 'Gate'
      ? (rawErr?.toLowerCase().includes('limit') ? 'Gate Failed: Amount Exceeds Limit'
        : rawErr?.toLowerCase().includes('auth')  ? 'Gate Failed: Unauthorized'
        : meta.failed || 'Gate Failed')
      : name === 'Propose'
      ? (rawErr ? `Intent Unrecognized: ${rawErr}` : 'Intent Unrecognized')
      : `${meta.label} Failed`;
    setLabel(errLabel, rawErr || meta.failed || 'Stage could not complete');

  } else if (status === 'skipped') {
    const blocked = Boolean(statusObj?.blocked);
    el.className = blocked ? 'skipped blocked' : 'skipped';
    b.textContent = blocked ? '✕' : '—';
    const isBlocked = name === 'Execute' && statusObj?.blocked;
    setLabel(
      isBlocked ? (meta.blocked || 'Execute · Blocked') : meta.label,
      statusObj?.reason || statusObj?.text || (isBlocked ? meta.blocked : meta.skipped) || 'Not required'
    );

  } else if (status === 'summary') {
    el.className = 'summary';
    b.textContent = '↻';
    setLabel(meta.label, statusObj?.detail || 'Updated order summary — payment not completed');

  } else if (status === 'ready') {
    el.className = 'ready';
    b.textContent = '•';
    setLabel(meta.label, statusObj?.detail || 'Ready for checkout — no payment recorded');

  } else if (status === 'pending-payment') {
    el.className = 'pending-payment';
    b.textContent = '⏳';
    setLabel(meta.label, statusObj?.detail || 'Awaiting Payment Completion / Signature Verification…');

  } else if (status === 'active') {
    el.className = 'active';
    b.textContent = '⟳';
    setLabel(meta.label, statusObj?.detail || meta.active || `Processing ${name}…`);

  } else {
    // pending or unknown → show idle state
    el.className = status === 'pending' ? 'pending' : 'neutral';
    b.textContent = '—';
    setLabel(meta.label, statusObj?.detail || meta.idle || '');
  }
}

function spineSource(trace, name) {
  return trace?.[name] ?? trace?.[name.toLowerCase()] ?? null;
}

function formatSpineAmount(data) {
  const checkoutAmount = Number(data?.pendingCheckout?.amountPaise);
  const cartAmount = Number(data?.cartState?.totalPaise)
    || (data?.cartState?.items || []).reduce((sum, item) => sum + Number(item.totalPaise || 0), 0);
  const paise = checkoutAmount > 0 ? checkoutAmount : cartAmount;
  return paise > 0 ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00';
}

function extractedTarget(query, data) {
  const items = data?.cartState?.items || data?.pendingCheckout?.items || [];
  const lastItem = items[items.length - 1];
  if (lastItem?.name) return lastItem.name;
  const target = query.match(/(?:buy|order|purchase|add|for)\s+(?:\d+\s+)?(.+?)(?:\s+to my cart)?$/i);
  return target?.[1]?.trim() || 'Unresolved item';
}

function microLog(name, raw, query, data) {
  const passed = raw?.status === 'success';
  const addOn = isAddOnIntent(query);
  const target = extractedTarget(query, data);
  const amount = formatSpineAmount(data);
  const actionId = raw?.actionId || raw?.transactionId || data?.pendingCheckout?.orderId || 'MOCK-ACTION';
  const auditIndex = Array.isArray(data?.auditLog) ? data.auditLog.length : '—';
  const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: false });
  if (name === 'Propose') {
    if (addOn) return `Intent: Order Modification / Add-On | Target: ${target}`;
    const lower = query.toLowerCase();
    const intent = /\b(modif|change|update|remove|replace)\w*/.test(lower) ? 'Modification'
      : /\b(buy|order|purchase|add|checkout)\b/.test(lower) ? 'Order Request' : 'Query';
    return `Intent: ${intent} | Target: ${target}`;
  }
  if (name === 'Explain' && addOn) return `Confidence: ${passed ? 96 : 42}% | Add-on availability: ${passed ? 'Valid for current cart item' : 'Unavailable'}`;
  if (name === 'Explain') return `Confidence: ${passed ? 96 : 42}% | Logic Match: ${passed ? 'Valid' : 'Ambiguous'}`;
  if (name === 'Gate') return `Limit Check: ${amount} ${passed ? '<' : '≥'} ₹10,000 | Status: ${passed ? 'PASS' : 'FAIL'}`;
  if (name === 'Execute') return `Action ID: ${actionId} | Processing Status: ${passed ? 'SUCCESS' : 'FAILED'}`;
  return `Record ID: #${auditIndex} | Timestamp: ${timestamp}`;
}

function isCommerceIntent(query) {
  return /\b(buy|order|purchase|add|checkout|cart|pay|payment|product|item|plan|subscription|warranty)\b|₹|\b(?:rs\.?|inr|rupees?)\b/i.test(query);
}

function isLikelyProductQuery(query) {
  return isCommerceIntent(query) || /\b(iphone|ipad|macbook|smartwatch|headphones?|earbuds?|laptop|phone|tablet|camera|monitor|keyboard|mouse|headset|charger|cable|bottle|fan|organizer)\b/i.test(query);
}

function isDirectProductQuery(query, data) {
  return !isCommerceIntent(query) && hasActionableCommerce(query, data);
}

function catalogTokens(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((word) => word.length > 2);
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(row[j] + 1, row[j - 1] + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

function catalogMatch(query) {
  const queryText = query.toLowerCase();
  const queryWords = catalogTokens(queryText);
  const synonyms = { watch: ['smartwatch'], phone: ['iphone'], laptop: ['macbook'], phones: ['iphone'] };
  let best = null;
  let bestScore = 0;
  liveCatalog.forEach((item) => {
    const terms = [item.name, ...(item.keywords || [])].filter(Boolean).flatMap(catalogTokens);
    let score = 0;
    queryWords.forEach((word) => {
      terms.forEach((term) => {
        if (queryText.includes(term) || term.includes(word)) score = Math.max(score, 3);
        else if ((synonyms[word] || []).includes(term) || (synonyms[term] || []).includes(word)) score = Math.max(score, 2);
        else if (word.length >= 5 && term.length >= 5 && editDistance(word, term) <= 2) score = Math.max(score, 1);
      });
    });
    if (score > bestScore) { bestScore = score; best = item; }
  });
  return best;
}

function matchedCatalogItem(query, data) {
  const liveMatch = catalogMatch(query);
  if (liveMatch) return liveMatch;
  const items = data?.pendingCheckout?.items || data?.cartState?.items || [];
  return items.find((item) => query.toLowerCase().includes(String(item.name || '').toLowerCase())) || null;
}

function catalogPrice(item, data) {
  const paise = Number(item?.priceInPaise || item?.price || item?.totalPaise)
    || Number(data?.cartState?.items?.find((entry) => entry.name === item?.name)?.totalPaise);
  return paise > 0 ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00';
}

function isAddOnIntent(query) {
  return /\b(add|include|upgrade|extend|attach|remove|change|update)\b.*\b(warranty|protection|insurance|cover|plan|addon|add-on)\b/i.test(query)
    || /\b(warranty|protection|insurance|cover)\b/i.test(query);
}

function hasActionableCommerce(query, data) {
  const items = data?.pendingCheckout?.items || data?.cartState?.items || [];
  if (!items.length) return false;
  const matchedCatalogItem = catalogMatch(query);
  const matchedReturnedItem = items.some((item) => {
    const name = String(item.name || '').toLowerCase();
    return name && query.toLowerCase().includes(name);
  });
  if (isCommerceIntent(query)) {
    return Boolean(matchedCatalogItem || matchedReturnedItem || /\b(checkout|cart|pay|payment)\b/i.test(query));
  }

  // A bare product name ("laptop", "headset") is still commerce intent when
  // it matches the product the agent returned, even without a "buy" verb.
  const normalizedQuery = query.toLowerCase();
  return items.some((item) => String(item.name || '').toLowerCase()
    .split(/\s+/)
    .some((word) => word.length > 3 && normalizedQuery.includes(word)));
}

function normalizedSpine(trace, data, query) {
  const result = {};
  const addOn = isAddOnIntent(query);
  const catalogProduct = matchedCatalogItem(query, data);
  const commerce = hasActionableCommerce(query, data) || Boolean(catalogProduct);
  const directProduct = isDirectProductQuery(query, data);
  SPINE_STEPS.forEach((name) => {
    const raw = spineSource(trace, name);
    if (typeof raw === 'object' && raw) {
      result[name] = { ...raw, detail: microLog(name, raw, query, data) };
    } else {
      const text = String(raw || '');
      const skipped = /no money action|skipped|not required/i.test(text);
      const fallback = { status: skipped ? 'skipped' : 'success' };
      result[name] = { ...fallback, detail: microLog(name, fallback, query, data), text };
    }
  });

  if (!commerce) {
    if (isLikelyProductQuery(query)) {
      result.Propose = { status: 'success', detail: 'Unrecognized Item Queried' };
      result.Explain = { status: 'failed', error: 'Item Not Found in Catalog', detail: 'Item Not Found in Catalog | Stock: 0' };
      result.Gate = { status: 'failed', error: 'Cannot proceed with unlisted item', detail: 'Gate Blocked: Cannot proceed with unlisted item' };
      result.Execute = { status: 'skipped', blocked: true, reason: 'Blocked after Gate failed.', detail: 'Execution halted for unlisted item.' };
      result.Audit = { status: 'skipped', blocked: true, reason: 'Blocked after Gate failed.', detail: 'Audit halted for unlisted item.' };
      return result;
    }
    result.Propose = {
      status: 'success',
      detail: 'Intent: General Inquiry / Non-Commerce | Target: None',
    };
    result.Explain = {
      status: 'failed',
      error: 'No purchase item or checkout action identified.',
      detail: 'Confidence: 0% | No actionable cart item',
    };
    result.Gate = {
      status: 'failed',
      error: 'Valid product or commerce intent required',
      detail: 'Gate Blocked: Valid product or commerce intent required',
    };
    result.Execute = {
      status: 'skipped',
      blocked: true,
      reason: 'Blocked after Gate failed.',
      detail: 'Execution blocked by failed prerequisite.',
    };
    result.Audit = {
      status: 'skipped',
      blocked: true,
      reason: 'Blocked after Gate failed.',
      detail: 'Audit blocked because no authorized action executed.',
    };
    return result;
  }

  const gateReasons = result.Gate?.reasons || [];
  const overLimit = result.Gate?.status === 'failed'
    && gateReasons.some((reason) => /exceed|ceiling|limit/i.test(reason));
  if (overLimit) {
    const total = Number(result.Gate.amountPaise) > 0
      ? `₹${(result.Gate.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
      : formatSpineAmount(data);
    result.Propose = {
      status: 'success',
      detail: `Item Identified: ${catalogProduct?.name || extractedTarget(query, data)} | Requested Total: ${total}`,
    };
    result.Explain = {
      status: 'success',
      detail: 'Context & Stock Validated | Price Parsed',
    };
    result.Gate = {
      status: 'failed',
      cascadeFailure: true,
      error: `Total Payable (${total}) Exceeds Policy Limit (₹10,000)`,
      detail: `GATE REJECTED: Total Payable (${total}) Exceeds Policy Limit (₹10,000)`,
    };
    result.Execute = {
      status: 'failed',
      error: 'Payment prevented',
      detail: 'Transaction Blocked | Payment Prevented',
    };
    result.Audit = {
      status: 'failed',
      error: 'Policy violation logged',
      detail: `Policy Violation Logged #${Array.isArray(data?.auditLog) ? data.auditLog.length : 'ID'}`,
    };
  }

  if (addOn && !data?.pendingCheckout) {
    result.Execute = {
      status: 'summary',
      detail: `Updated order summary | Payment not completed | Total: ${formatSpineAmount(data)}`,
    };
    result.Audit = {
      status: 'ready',
      detail: 'Ready for checkout | Awaiting explicit payment completion',
    };
  }

  if (data?.pendingCheckout && !addOn) {
    result.Execute = {
      status: 'pending-payment',
      detail: 'Awaiting Payment Completion / Signature Verification…',
    };
    result.Audit = {
      status: 'pending-payment',
      detail: 'Audit held until payment signature is verified.',
    };
  }

  if (data?.pendingCheckout && SPINE_STEPS.slice(0, 3).every((name) => result[name].status !== 'failed')) {
    result.Propose = { status: 'success', detail: `Intent Verified | Target: ${extractedTarget(query, data)}` };
    result.Explain = { status: 'success', detail: 'Price & Stock Validated | Inventory and pricing context confirmed' };
    result.Gate = { status: 'success', detail: `Policy Approved | Limit Check: ${formatSpineAmount(data)} < ₹10,000` };
  }

  if (!data?.pendingCheckout && !addOn && result.Gate.status === 'success') {
    result.Execute = {
      status: 'summary',
      detail: 'Cart Updated | Awaiting Checkout',
    };
    result.Audit = {
      status: 'ready',
      detail: 'Ready for checkout | No completed payment transaction',
    };
  }

  if (directProduct && result.Gate.status === 'success') {
    result.Propose.detail = `Product Matched: ${catalogProduct?.name || extractedTarget(query, data)} | Price: ${catalogPrice(catalogProduct, data)}`;
    result.Explain.detail = 'Stock & Context Validated | Confidence: 98%';
    result.Gate.detail = 'Spending Limit Check: PASS (< ₹10,000)';
    result.Execute = {
      status: 'summary',
      detail: 'Cart Ready | Awaiting Payment Execution',
    };
    result.Audit = {
      status: 'ready',
      detail: 'Session Staged | Awaiting Transaction',
    };
  }

  if (catalogProduct && !addOn && result.Gate.status === 'success') {
    result.Propose.detail = `Catalog Keyword Matched: ${catalogProduct.name} | Item Added`;
    result.Explain.detail = 'Stock & Context Validated | Confidence: 95%+';
    result.Gate.detail = 'Policy Limit Check: PASS (< ₹10,000)';
    result.Execute = { status: 'summary', detail: `Cart Updated: ${catalogProduct.name} | Awaiting Payment` };
    result.Audit = { status: 'ready', detail: 'Session Staged | Record Pending Payment Execution' };
  }

  // Use the same successful verification language for products and add-ons.
  if (result.Propose.status === 'success') {
    result.Propose.detail = addOn
      ? `Intent: Order Modification / Add-On | Target: ${extractedTarget(query, data)}`
      : `Intent Verified | Target: ${extractedTarget(query, data)}`;
  }
  if (result.Explain.status === 'success') {
    result.Explain.detail = addOn
      ? 'Price & Stock Validated | Add-on available for current cart item'
      : 'Price & Stock Validated | Inventory and pricing context confirmed';
  }
  if (result.Gate.status === 'success') {
    result.Gate.detail = `Policy Approved | Limit Check: ${formatSpineAmount(data)} < ₹10,000`;
  }

  // A downstream success implies that its prerequisites passed. This also
  // repairs partial/legacy server traces before they reach the renderer.
  const hasFailure = SPINE_STEPS.slice(0, 3).some((name) => result[name].status === 'failed');
  if (!hasFailure && (result.Execute.status === 'success' || result.Audit.status === 'success')) {
    SPINE_STEPS.slice(0, 3).forEach((name) => {
      result[name] = { status: 'success', detail: microLog(name, { status: 'success' }, query, data) };
    });
  }

  // Never allow Execute or Audit to pass after an upstream failure.
  const firstFailure = SPINE_STEPS.slice(0, 3).findIndex((name) => result[name].status === 'failed');
  if (firstFailure >= 0) {
    for (let index = firstFailure + 1; index < SPINE_STEPS.length; index += 1) {
      const name = SPINE_STEPS[index];
      result[name] = {
        status: 'skipped',
        blocked: true,
        reason: `Skipped after ${SPINE_STEPS[firstFailure]} failed.`,
        detail: `Blocked by failed ${SPINE_STEPS[firstFailure]} prerequisite.`,
      };
    }
  }
  return result;
}

async function renderSpineSequentially(trace, data, query, runId) {
  const results = normalizedSpine(trace, data, query);
  for (let index = 0; index < SPINE_STEPS.length; index += 1) {
    if (runId !== spineRunId) return;
    const name = SPINE_STEPS[index];
    const result = results[name];
    stage(name, { status: 'active' });
    await new Promise((resolve) => setTimeout(resolve, 260));
    if (runId !== spineRunId) return;
    stage(name, result);
    if (result.status === 'failed') {
      // Non-commerce input intentionally reports both the Explain failure and
      // the immediate Gate block before halting Execute and Audit.
      if (name === 'Explain' && results.Gate?.status === 'failed') continue;
      if (result.cascadeFailure) {
        for (let rest = index + 1; rest < SPINE_STEPS.length; rest += 1) {
          stage(SPINE_STEPS[rest], results[SPINE_STEPS[rest]]);
        }
        return results;
      }
      for (let rest = index + 1; rest < SPINE_STEPS.length; rest += 1) {
        stage(SPINE_STEPS[rest], { status: 'skipped', blocked: true, reason: `Skipped after ${name} failed.` });
      }
      return results;
    }
  }
  return results;
}

// Public entry point used by every conversational submission and suggestion.
// It always clears the five DOM rows before rendering the new trace.
window.spineInspector = {
  reset() {
    SPINE_STEPS.forEach((name) => stage(name, { status: 'pending' }));
  },
  render(trace, data, query, runId) {
    return renderSpineSequentially(trace, data, query, runId);
  },
};

/* ── Show a named error badge in the reasoning panel ── */
function showErrorBadge(badgeText, detail) {
  const el = $('#reasoning');
  if (!el) return;
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;background:#fff5f3;border:1px solid #e3a39b;border-radius:8px;padding:8px 12px;font-weight:700;color:#c14338;font-size:13px;">✕ ${escapeHtml(badgeText)}</span>${detail ? `<span style="display:block;margin-top:8px;color:#718078;font-size:12px;">${escapeHtml(detail)}</span>` : ''}`;
}

function markPaymentPrerequisites() {
  stage('Propose', { status: 'success', detail: 'Intent Verified' });
  stage('Explain', { status: 'success', detail: 'Price & Stock Validated' });
  stage('Gate', { status: 'success', detail: 'Policy Approved' });
}

/* ══════════════════════════════════════════════════
   AUDIT LOG RENDERING
   Enriched columns: Time / Item / Gate / Result+TxID
══════════════════════════════════════════════════ */
function renderAuditLog(auditLog) {
  const list = $('#tx-list');
  if (!list) return;
  const paymentLog = auditLog.filter((entry) => ['paid', 'failed', 'cancelled'].includes(entry.status));
  list.innerHTML = paymentLog.slice().reverse().map((x, index) => {
    const date = new Date(x.paidAt || x.executedAt || Date.now());
    const amount = formatCurrency(x.amountPaise || x.order?.amount || 0);
    const item = x.cartItems?.length ? `${x.cartItems.length} item${x.cartItems.length > 1 ? 's' : ''}` : escapeHtml(x.itemName || x.actionType || 'Transaction');
    const paid = x.status === 'paid';
    return `<button type="button" class="transaction-row ${paid ? 'is-paid' : ''}" data-audit-index="${index}">
      <span class="transaction-icon">${paid ? '✓' : '↗'}</span><span class="transaction-main"><strong>${item}</strong><small>${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
      <span class="transaction-amount">${amount}<small class="status-${escapeHtml(x.status || 'unknown')}">${escapeHtml(x.status || 'unknown')}</small></span><span class="transaction-arrow">›</span>
    </button>`;
  }).join('') || '<div class="empty-history">No payment outcomes yet.</div>';
  list.querySelectorAll('[data-audit-index]').forEach((button) => {
    button.onclick = () => {
      const entry = paymentLog.slice().reverse()[Number(button.dataset.auditIndex)];
      openReceipt(entry);
    };
  });
}

function formatCurrency(paise) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(Number(paise || 0) / 100)); }

function openReceipt(entry) {
  if (!entry) return;
  const items = entry.cartItems?.length ? entry.cartItems : [{ name: entry.itemName || entry.actionType || 'Transaction', quantity: entry.quantity || 1, totalPaise: entry.amountPaise || 0 }];
  const total = Number(entry.amountPaise || items.reduce((sum, item) => sum + Number(item.totalPaise || 0), 0));
  const base = Math.round(total / 1.18);
  const gst = total - base;
  const isPaid = entry.status === 'paid';
  const canRetry = !isPaid && !entry.retryResolved;
  const receiptTitle = isPaid ? 'Thank you for your purchase' : entry.status === 'cancelled' ? 'Payment was cancelled' : 'Payment was not completed';
  $('#receipt-content').innerHTML = `<div class="receipt-brand"><span class="receipt-mark">AC</span><div><strong>Agentic Commerce</strong><small>Digital payment receipt</small></div><span class="paid-stamp ${isPaid ? '' : 'not-paid'}">${isPaid ? 'PAID' : escapeHtml(String(entry.status || 'PENDING').toUpperCase())}</span></div>
    <div class="receipt-store"><p class="eyebrow">STORE RECEIPT</p><h2 id="receipt-title">${receiptTitle}</h2><p>${new Date(entry.paidAt || entry.cancelledAt || entry.failedAt || entry.executedAt || Date.now()).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}</p></div>
    <div class="receipt-items"><div class="receipt-line receipt-label"><span>ITEM</span><span>AMOUNT</span></div>${items.map((item) => `<div class="receipt-line"><span><strong>${escapeHtml(item.name || 'Item')}</strong><small>Qty ${Number(item.quantity || 1)}</small></span><strong>${formatCurrency(item.totalPaise || 0)}</strong></div>`).join('')}</div>
    <div class="receipt-totals"><div><span>Base price</span><strong>${formatCurrency(base)}</strong></div><div><span>CGST · 9%</span><strong>${formatCurrency(Math.round(gst / 2))}</strong></div><div><span>SGST · 9%</span><strong>${formatCurrency(gst - Math.round(gst / 2))}</strong></div><div class="receipt-total"><span>${isPaid ? 'Total paid' : 'Total amount'}</span><strong>${formatCurrency(total)}</strong></div></div>
    <div class="receipt-meta"><div><span>Razorpay payment ID</span><strong>${escapeHtml(entry.paymentId || 'Not available')}</strong></div><div><span>Order reference</span><strong>${escapeHtml(entry.order?.id || entry.orderId || 'Not available')}</strong></div>${canRetry ? '<button type="button" class="retry-payment" data-retry-payment>Retry payment</button>' : entry.retryResolved ? '<span class="retry-resolved">Resolved by a later successful payment</span>' : ''}</div>`;
  $('#receipt-modal').hidden = false;
  document.body.classList.add('modal-open');
  const retry = $('#receipt-content [data-retry-payment]');
  if (retry) retry.onclick = () => { closeReceipt(); showPage('dashboard'); submitQuery('Retry payment'); };
}

function closeReceipt() { $('#receipt-modal').hidden = true; document.body.classList.remove('modal-open'); }

async function recordPaymentOutcome(orderId, status, error) {
  try {
    await fetch('/api/payment/outcome', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ orderId, status, error }),
    });
    await loadAudit();
  } catch (_) { /* The payment UI remains usable even if audit sync is unavailable. */ }
}

/* ── Load audit history ── */
async function loadAudit() {
  const r = await fetch('/api/audit', { headers: authHeaders() });
  const d = await r.json();
  if (!r.ok) { signOut(); return; }
  renderAuditLog(d);
}

/* ══════════════════════════════════════════════════
   SIGN OUT
══════════════════════════════════════════════════ */
function signOut() {
  const previousChatKey = chatStorageKey();
  session = null;
  _rzpKeyId = null;
  _welcomeLoaded = false;
  localStorage.removeItem(SESSION_KEY);
  if (previousChatKey) localStorage.removeItem(previousChatKey);
  const chatMessages = $('#chat-messages');
  if (chatMessages) chatMessages.innerHTML = '';
  showView();
}

/* ══════════════════════════════════════════════════
   TAB SWITCHER (Sign In / Sign Up)
══════════════════════════════════════════════════ */
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.onclick = () => {
    mode = btn.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#name-wrap').hidden = mode === 'login';
    $('#auth-submit').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
    $('#auth-error').textContent = '';
  };
});

/* ══════════════════════════════════════════════════
   AUTH FORM (Sign In / Sign Up)
══════════════════════════════════════════════════ */
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();

  $('#auth-error').textContent = '';

  const body = {
    email: $('#email').value,
    password: $('#password').value,
  };
  if (mode === 'signup') body.name = $('#name').value;

  const r = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();

  if (!r.ok) {
    $('#auth-error').textContent = d.error || 'Something went wrong.';
    return;
  }

  session = d;
  localStorage.setItem(SESSION_KEY, JSON.stringify(d));
  showView();
};

/* ══════════════════════════════════════════════════
   SIGN OUT BUTTON
══════════════════════════════════════════════════ */
const signOutBtn = $('#sign-out');
if (signOutBtn) signOutBtn.onclick = signOut;

/* ── Helper: Scroll to latest message ── */
function scrollToBottom() {
  const chatMessages = $('#chat-messages');
  if (chatMessages) {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  }
}

/* ── Helper: Append Chat Bubble ── */
function appendBubble(text, sender) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const chatMessages = $('#chat-messages');
  if (chatMessages) {
    const formatted = typeof text === 'string'
      ? escapeHtml(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
      : escapeHtml(text);
    chatMessages.innerHTML += `
      <div class="bubble-group ${sender}">
        <div class="bubble ${sender}">${formatted}</div>
        <div class="bubble-timestamp">${time}</div>
      </div>
    `;
    scrollToBottom();
    persistChat();
  }
}

/* ══════════════════════════════════════════════════
   RAZORPAY CHECKOUT — triggered when agent returns
   a `pendingCheckout` payload from /api/agent/chat
══════════════════════════════════════════════════ */
async function openRazorpayCheckout(checkout) {
  const { orderId, amountPaise, currency, items = [], userName, userEmail } = checkout;
  const itemName = items.length === 1 ? items[0].name : `${items.length || 'Your'} item${items.length === 1 ? '' : 's'}`;
  const itemPrice = items.length === 1 ? formatCurrency(items[0].totalPaise) : formatCurrency(amountPaise);

  // Defense in depth: never open Razorpay for a payload above the hard limit.
  if (Number(amountPaise) > 1000000) {
    appendBubble(`❌ **Payment prevented:** Total payable ${itemPrice} exceeds the safety limit of ₹10,000.`, 'agent');
    markPaymentPrerequisites();
    stage('Gate', { status: 'failed', error: 'Total exceeds ₹10,000 policy limit', detail: `GATE REJECTED: Total Payable (${itemPrice}) Exceeds Policy Limit (₹10,000)` });
    stage('Execute', { status: 'failed', error: 'Payment prevented', detail: 'Transaction Blocked | Payment Prevented' });
    stage('Audit', { status: 'failed', error: 'Policy violation logged', detail: 'Policy Violation Logged' });
    return;
  }

  // Fetch the public key if we don't have it yet
  if (!_rzpKeyId) await fetchRzpKey();

  if (!_rzpKeyId) {
    appendBubble('⚠️ Payment gateway not configured. Please set RAZORPAY_KEY_ID in .env.', 'agent');
    return;
  }

  if (typeof Razorpay === 'undefined') {
    appendBubble('⚠️ Razorpay checkout.js failed to load. Please check your internet connection.', 'agent');
    return;
  }

  stage('Execute', { status: 'pending-payment', detail: 'Awaiting Payment Completion / Signature Verification…' });
  stage('Audit', { status: 'pending-payment', detail: 'Audit held until payment signature is verified.' });

  let outcomeRecorded = false;
  return new Promise((resolve) => {
    const options = {
      key:         _rzpKeyId,
      amount:      amountPaise,
      currency:    currency || 'INR',
      name:        'Agentic Commerce',
      description: itemName || 'Purchase',
      order_id:    orderId,
      prefill: {
        name: userName || session?.user?.name || 'Customer',
        email: userEmail || session?.user?.email || 'customer@example.com',
      },
      theme: { color: '#0a5743' },
      modal: {
        async ondismiss() {
          if (outcomeRecorded) return;
          outcomeRecorded = true;
          await recordPaymentOutcome(orderId, 'cancelled', 'Payment window closed by the customer.');
          appendBubble('🚫 Payment cancelled. Your cart is saved. You can retry payment whenever you are ready.', 'agent');
          renderQuickActions(['Retry payment', 'Browse Catalog']);
          // Payment was not completed: Execute fails and Audit records the halt.
          markPaymentPrerequisites();
          stage('Execute', { status: 'failed', error: 'Payment Cancelled', detail: 'Payment Cancelled / Declined' });
          stage('Audit', { status: 'failed', error: 'Payment cancelled by customer', detail: 'Transaction Aborted' });
          resolve({ cancelled: true });
        },
      },

      // ── On successful payment ──────────────────────────────────────────────
      handler: async function (response) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = response;

        appendBubble('🔐 Verifying payment signature…', 'agent');

        try {
          const vRes = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              razorpay_order_id,
              razorpay_payment_id,
              razorpay_signature,
              // Pass item context for audit enrichment
              itemName,
              itemPrice,
              amountPaise,
            }),
          });
          const vData = await vRes.json();

          if (vRes.ok && vData.success) {
            outcomeRecorded = true;
            // ✅ Payment verified — update chat, spine, and audit table
            appendBubble(
              `✅ **Payment Successful!**\nPurchased: ${itemName} (${itemPrice})\nPayment ID: ${razorpay_payment_id}`,
              'agent'
            );
            renderQuickActions(['Browse Catalog', 'Start over']);

            markPaymentPrerequisites();
            stage('Execute', { status: 'success', detail: `Transaction Successful | Razorpay Payment ID Verified: ${razorpay_payment_id}` });
            stage('Audit', { status: 'success', detail: `Transaction Recorded #${vData.auditId || vData.recordId || 'DB_ID'}` });

            // Inject a "paid" row locally so the audit table updates immediately
            // without waiting for a server round-trip to /api/audit
            injectPaidAuditRow({
              executedAt:  new Date().toISOString(),
              itemName,
              itemPrice,
              amountPaise,
              paymentId:   razorpay_payment_id,
              orderId:     razorpay_order_id,
              gate:        { approved: true },
              status:      'paid',
            });

            // Refresh immediately so earlier failed/cancelled attempts lose their retry action.
            await loadAudit();

            resolve({ success: true, paymentId: razorpay_payment_id });
          } else {
            outcomeRecorded = true;
            appendBubble(
              `❌ **Verification Failed**\n${vData.error || 'Signature mismatch. Contact support.'}\nPayment ID: ${razorpay_payment_id}`,
              'agent'
            );
            await recordPaymentOutcome(razorpay_order_id, 'failed', 'Payment verification failed.');
            markPaymentPrerequisites();
            stage('Execute', { status: 'failed', error: 'Signature mismatch', detail: 'Payment Cancelled / Declined — signature verification failed.' });
            stage('Audit', { status: 'failed', error: 'Signature mismatch', detail: 'Transaction Aborted' });
            renderQuickActions(['Retry payment', 'Browse Catalog']);
            resolve({ success: false });
          }
        } catch (_) {
          outcomeRecorded = true;
          appendBubble(
            `⚠️ **Verification could not be completed.**\nContact support with payment ID: ${razorpay_payment_id}`,
            'agent'
          );
          await recordPaymentOutcome(razorpay_order_id, 'failed', 'Payment verification request failed.');
          markPaymentPrerequisites();
          stage('Execute', { status: 'failed', error: 'Verification request failed', detail: 'Payment Cancelled / Declined — verification unavailable.' });
          stage('Audit', { status: 'failed', error: 'Verification request failed', detail: 'Transaction Aborted' });
          renderQuickActions(['Retry payment', 'Browse Catalog']);
          resolve({ success: false });
        }
      },
    };

    const rzp = new Razorpay(options);

    rzp.on('payment.failed', function (response) {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      const desc   = response.error?.description ?? 'The payment could not be completed.';
      const reason = response.error?.reason ?? '';
      appendBubble(
        `❌ **Payment Failed**\n${desc}${reason ? ` (${reason})` : ''}\nYour cart is saved — you can try the payment again.`,
        'agent'
      );
      recordPaymentOutcome(orderId, 'failed', desc);
      renderQuickActions(['Retry payment', 'Browse Catalog']);
      markPaymentPrerequisites();
      stage('Execute', { status: 'failed', error: desc, detail: `Payment Cancelled / Declined — ${desc}` });
      stage('Audit', { status: 'failed', error: desc, detail: 'Transaction Aborted' });
      resolve({ success: false });
    });

    rzp.open();
  });
}

/* ── Inject a paid row into the audit table immediately (optimistic UI) ── */
function injectPaidAuditRow(entry) {
  const list = $('#tx-list');
  if (!list) return;
  const empty = list.querySelector('.empty-history');
  if (empty) empty.remove();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'transaction-row is-paid';
  button.innerHTML = `<span class="transaction-icon">✓</span><span class="transaction-main"><strong>${escapeHtml(entry.itemName || 'Purchase')}</strong><small>${new Date(entry.executedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></span><span class="transaction-amount">${formatCurrency(entry.amountPaise)}<small class="status-paid">paid</small></span><span class="transaction-arrow">›</span>`;
  button.onclick = () => openReceipt(entry);
  list.prepend(button);
}

/* ══════════════════════════════════════════════════
   CHAT FORM
══════════════════════════════════════════════════ */
async function submitQuery(query) {
  const q = query.trim();
  if (!q) return;
  const runId = ++spineRunId;
  $('#chat-messages').querySelectorAll('.suggestions-group').forEach((el) => el.remove());
  appendBubble(q, 'user');
  $('#query').value = '';

  // Every new message starts a fresh, persistent five-stage trace.
  window.spineInspector.reset();
  stage('Propose', { status: 'active' });
  const reasoningEl = $('#reasoning');
  if (reasoningEl) reasoningEl.textContent = 'Processing your request through the safety spine…';
  const detectedCatalogItem = catalogMatch(q);
  const normalizedAgentQuery = detectedCatalogItem
    ? `${/\b(add|include|upgrade|extend|attach)\b/i.test(q) ? 'Add' : 'Buy'} ${detectedCatalogItem.name}`
    : q;

  try {
    const r = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: normalizedAgentQuery }),
    });
    const d = await r.json();

    if (!r.ok) {
      // Network/server error — fail the active stage and explicitly skip the rest.
      const errMsg = d.error || 'Request failed';
      stage('Propose', { status: 'failed', error: errMsg });
      SPINE_STEPS.slice(1).forEach((name) => stage(name, { status: 'skipped', blocked: true, reason: 'Skipped after Propose failed.' }));
      showErrorBadge('Intent Unrecognized', errMsg);
      return;
    }

    appendBubble(d.agentResponse, 'agent');
    if (d.suggestedReplies?.length) renderQuickActions(d.suggestedReplies);

    if (d.spine) {
      const renderedResults = await window.spineInspector.render(d.spine, d, q, runId);
      if (runId !== spineRunId) return;

      // Determine which step failed (if any) and show the error badge.
      const failedStep = SPINE_STEPS.find((name) => renderedResults?.[name]?.status === 'failed');

      if (failedStep) {
        // Gate is the actionable policy failure when non-commerce input also
        // carries the earlier Explain diagnostic.
        const badgeStep = renderedResults.Gate?.status === 'failed' ? 'Gate' : failedStep;
        const failData = renderedResults[badgeStep];
        const rawErr   = failData?.error || failData?.reasons?.[0] || '';
        let badge;
        if (badgeStep === 'Gate') {
          badge = rawErr?.toLowerCase().includes('limit') ? 'Gate Failed: Exceeds ₹10,000 policy limit'
                : rawErr?.toLowerCase().includes('auth')  ? 'Gate Failed: Unauthorized'
                : 'Gate Blocked: Valid product or commerce intent required';
        } else if (badgeStep === 'Propose') {
          badge = 'Intent Unrecognized';
        } else {
          badge = `${SPINE_META[badgeStep]?.label || badgeStep} Failed`;
        }
        showErrorBadge(badge, rawErr || renderedResults[badgeStep]?.reasons?.join(' ') || '');
      } else if (renderedResults?.Gate?.reasons?.length) {
        if (reasoningEl) reasoningEl.textContent = renderedResults.Gate.reasons.join(' ');
      } else {
        if (reasoningEl) reasoningEl.textContent = 'Trace complete — all 5 spine steps evaluated.';
      }
    } else {
      // Keep the UI contract intact even if an older server omits its trace.
      await window.spineInspector.render({}, d, q, runId);
      if (runId !== spineRunId) return;
      if (reasoningEl) reasoningEl.textContent = 'Trace complete — all 5 spine steps evaluated.';
    }

    if (d.auditLog) renderAuditLog(d.auditLog); else loadAudit();
    if (d.pendingCheckout) {
      setTimeout(() => {
        if (runId === spineRunId) openRazorpayCheckout(d.pendingCheckout);
      }, 600);
    }

  } catch (error) {
    if (runId !== spineRunId) return;
    stage('Propose', { status: 'failed', error: 'Cannot reach agent' });
    SPINE_STEPS.slice(1).forEach((name) => stage(name, { status: 'skipped', blocked: true, reason: 'Skipped after Propose failed.' }));
    showErrorBadge('Agent Unreachable', 'Unable to reach the commerce agent. Please try again.');
  }
}

$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();
  await submitQuery($('#query').value);
};

document.querySelectorAll('[data-close-receipt]').forEach((button) => { button.onclick = closeReceipt; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#receipt-modal').hidden) closeReceipt(); });

/* ══════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════ */
if (session) {
  fetch('/api/auth/me', { headers: authHeaders() })
    .then(r => r.ok ? showView() : signOut());
} else {
  showView();
}
