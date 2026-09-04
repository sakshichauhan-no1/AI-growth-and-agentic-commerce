'use strict';

/* ── DOM helpers ── */
const $ = (sel) => document.querySelector(sel);

/* ── Session state ── */
const SESSION_KEY = 'agentic-session';
const CHAT_KEY_PREFIX = 'agentic-chat-';
let mode = 'login';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');

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
    fetchRzpKey(); // preload the public key in background
    initWelcomeMessage();
  }
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
    b.textContent = '--';
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
    el.className = 'skipped';
    b.textContent = '--';
    const isBlocked = name === 'Execute' && statusObj?.blocked;
    setLabel(
      isBlocked ? (meta.blocked || 'Execute · Blocked') : meta.label,
      statusObj?.reason || statusObj?.text || (isBlocked ? meta.blocked : meta.skipped) || 'Not required'
    );

  } else if (status === 'active') {
    el.className = 'active';
    b.textContent = '…';
    setLabel(meta.label, statusObj?.detail || meta.active || `Processing ${name}…`);

  } else {
    // pending or unknown → show idle state
    el.className = status === 'pending' ? 'pending' : 'neutral';
    b.textContent = '--';
    setLabel(meta.label, statusObj?.detail || meta.idle || '');
  }
}

/* ── Show a named error badge in the reasoning panel ── */
function showErrorBadge(badgeText, detail) {
  const el = $('#reasoning');
  if (!el) return;
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;background:#fff5f3;border:1px solid #e3a39b;border-radius:8px;padding:8px 12px;font-weight:700;color:#c14338;font-size:13px;">✕ ${escapeHtml(badgeText)}</span>${detail ? `<span style="display:block;margin-top:8px;color:#718078;font-size:12px;">${escapeHtml(detail)}</span>` : ''}`;
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
          // Update spine — payment not completed
          stage('Audit', { status: 'failed', error: 'Payment cancelled by customer' });
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

            stage('Audit', { status: 'success' });

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
            stage('Audit', { status: 'failed', error: 'Signature mismatch' });
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
      stage('Audit', { status: 'failed', error: desc });
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
  $('#chat-messages').querySelectorAll('.suggestions-group').forEach((el) => el.remove());
  appendBubble(q, 'user');
  $('#query').value = '';

  // Reset all steps to pending and advance Propose to active immediately
  ['Propose','Explain','Gate','Execute','Audit'].forEach((name) => stage(name, { status: 'pending' }));
  stage('Propose', { status: 'active' });
  const reasoningEl = $('#reasoning');
  if (reasoningEl) reasoningEl.textContent = 'Processing your request through the safety spine…';

  try {
    const r = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: q }),
    });
    const d = await r.json();

    if (!r.ok) {
      // Network/server error — mark Propose as failed with error badge
      const errMsg = d.error || 'Request failed';
      stage('Propose', { status: 'failed', error: errMsg });
      showErrorBadge('Intent Unrecognized', errMsg);
      return;
    }

    appendBubble(d.agentResponse, 'agent');
    if (d.suggestedReplies?.length) renderQuickActions(d.suggestedReplies);

    if (d.spine) {
      // Apply each step result sequentially — prior passing steps remain green
      ['Propose','Explain','Gate','Execute','Audit'].forEach((name) => stage(name, d.spine[name]));

      // Determine which step failed (if any) and show the error badge
      const steps = ['Propose','Explain','Gate','Execute','Audit'];
      const failedStep = steps.find((n) => d.spine[n]?.status === 'failed');

      if (failedStep) {
        const failData = d.spine[failedStep];
        const rawErr   = failData?.error || failData?.reasons?.[0] || '';
        let badge;
        if (failedStep === 'Gate') {
          badge = rawErr?.toLowerCase().includes('limit') ? 'Gate Failed: Amount Exceeds Limit'
                : rawErr?.toLowerCase().includes('auth')  ? 'Gate Failed: Unauthorized'
                : 'Gate Failed';
        } else if (failedStep === 'Propose') {
          badge = 'Intent Unrecognized';
        } else {
          badge = `${SPINE_META[failedStep]?.label || failedStep} Failed`;
        }
        showErrorBadge(badge, rawErr || d.spine[failedStep]?.reasons?.join(' ') || '');
      } else if (d.spine?.Gate?.reasons?.length) {
        if (reasoningEl) reasoningEl.textContent = d.spine.Gate.reasons.join(' ');
      } else {
        if (reasoningEl) reasoningEl.textContent = 'Trace complete — all 5 spine steps evaluated.';
      }
    } else {
      if (reasoningEl) reasoningEl.textContent = 'Trace complete.';
    }

    if (d.auditLog) renderAuditLog(d.auditLog); else loadAudit();
    if (d.pendingCheckout) setTimeout(() => openRazorpayCheckout(d.pendingCheckout), 600);

  } catch (error) {
    stage('Propose', { status: 'failed', error: 'Cannot reach agent' });
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
