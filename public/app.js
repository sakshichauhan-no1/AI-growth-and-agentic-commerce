'use strict';

/* ── DOM helpers ── */
const $ = (sel) => document.querySelector(sel);

/* ── Session state ── */
const SESSION_KEY = 'agentic-session';
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
function showView() {
  const authed = !!session;

  $('#auth-view').style.display = authed ? 'none' : '';
  $('#dashboard-view').style.display = authed ? 'block' : 'none';

  if (authed) {
    $('#user-greeting').textContent = 'Hi, ' + session.user.name;
    showPage('dashboard');
    loadAudit();
    fetchRzpKey(); // preload the public key in background
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
function stage(name, statusObj) {
  const el = $(`[data-step="${name}"]`);
  if (!el) return;
  const b = el.querySelector('b');

  if (typeof statusObj === 'string') {
    el.className = '';
    b.textContent = '--';
    if (statusObj === '—') {
      el.firstChild.textContent = name + ' ';
    } else {
      el.firstChild.textContent = name + ': ' + statusObj + ' ';
    }
    return;
  }

  if (statusObj?.status === 'success') {
    el.className = 'approved';
    b.textContent = '✓';
    el.firstChild.textContent = name + ' ';
  } else if (statusObj?.status === 'failed') {
    el.className = 'failed';
    b.textContent = '❌';
    if (name === 'Gate' && statusObj.reasons && statusObj.reasons.some(r => r.includes('>₹10k Limit') || r.includes('spending ceiling'))) {
      el.firstChild.textContent = 'Gate: Rejected (>₹10k Limit) ';
    } else {
      el.firstChild.textContent = name + ' ';
    }
  } else if (statusObj?.status === 'skipped') {
    el.className = '';
    b.textContent = '--';
    if (name === 'Execute' && statusObj.blocked) {
      el.firstChild.textContent = 'Execute: Blocked ';
    } else if (name === 'Propose' && statusObj.text) {
      el.firstChild.textContent = statusObj.text + ' ';
    } else {
      el.firstChild.textContent = name + ' ';
    }
  } else {
    el.className = '';
    b.textContent = '--';
    el.firstChild.textContent = name + ' ';
  }
}

/* ══════════════════════════════════════════════════
   AUDIT LOG RENDERING
   Enriched columns: Time / Item / Gate / Result+TxID
══════════════════════════════════════════════════ */
function renderAuditLog(auditLog) {
  const tableBody = $('#tx-table-body');
  if (!tableBody) return;

  const rows = auditLog.slice().reverse().map(x => {
    const time     = new Date(x.executedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const gateOk   = x.gate?.approved;
    const gateText = gateOk ? '✅ Passed' : '❌ Rejected';

    // Determine item label — prefer the enriched fields written by the chat flow
    let itemLabel = x.actionType || 'N/A';
    if (x.itemName) {
      const price = x.itemPrice || (x.amountPaise ? `₹${(x.amountPaise / 100).toLocaleString('en-IN')}` : '');
      itemLabel = `${x.itemName}${price ? ` (${price})` : ''}`;
    }

    // Result column — show payment ID for verified transactions
    let resultLabel = x.status || 'N/A';
    if (x.status === 'executed' || x.status === 'pending-checkout') {
      resultLabel = `<span style="color:#0a5743;font-weight:600;">PENDING</span>`;
    } else if (x.status === 'paid') {
      const txId = x.paymentId ? `<br><span style="font-size:12px;opacity:0.7;">${x.paymentId}</span>` : '';
      resultLabel = `<span style="color:#16a34a;font-weight:700;">✅ SUCCESS${txId}</span>`;
    } else if (x.status === 'rejected') {
      resultLabel = `<span style="color:#dc2626;font-weight:600;">REJECTED</span>`;
    } else if (x.status === 'failed') {
      resultLabel = `<span style="color:#dc2626;font-weight:600;">FAILED</span>`;
    }

    // Gate column — show Razorpay verified badge if applicable
    let gateDisplay = gateText;
    if (x.status === 'paid') {
      gateDisplay = '✅ Razorpay Signature Verified';
    }

    return `<tr>
      <td>${time}</td>
      <td>${itemLabel}</td>
      <td>${gateDisplay}</td>
      <td>${resultLabel}</td>
    </tr>`;
  }).join('');

  tableBody.innerHTML = rows || '<tr><td colspan="4">No transactions yet.</td></tr>';
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
  session = null;
  _rzpKeyId = null;
  localStorage.removeItem(SESSION_KEY);
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
    chatMessages.innerHTML += `
      <div class="bubble-group ${sender}">
        <div class="bubble ${sender}">${text}</div>
        <div class="bubble-timestamp">${time}</div>
      </div>
    `;
    scrollToBottom();
  }
}

/* ══════════════════════════════════════════════════
   RAZORPAY CHECKOUT — triggered when agent returns
   a `pendingCheckout` payload from /api/agent/chat
══════════════════════════════════════════════════ */
async function openRazorpayCheckout(checkout) {
  const { orderId, amountPaise, currency, itemName, itemPrice, userName, userEmail } = checkout;

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

  return new Promise((resolve) => {
    const options = {
      key:         _rzpKeyId,
      amount:      amountPaise,
      currency:    currency || 'INR',
      name:        'Agentic Commerce',
      description: itemName || 'Purchase',
      order_id:    orderId,
      prefill: {
        name: "Demo Customer",
        email: "demo@example.com",
        contact: "+919999999999",
      },
      readonly: {
        contact: true,
        email: true
      },
      theme: { color: '#0a5743' },
      modal: {
        ondismiss() {
          appendBubble('🚫 Payment cancelled. You can restart the checkout anytime.', 'agent');
          // Update spine — payment not completed
          stage('Audit', { status: 'failed', error: 'Payment dismissed by user' });
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
            // ✅ Payment verified — update chat, spine, and audit table
            appendBubble(
              `✅ <strong>Payment Successful!</strong><br>
               <span style="font-size:14px;opacity:0.85;">
                 Purchased: ${itemName} (${itemPrice})<br>
                 Payment ID: ${razorpay_payment_id}
               </span>`,
              'agent'
            );

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

            // Also refresh from server to pick up any server-persisted records
            setTimeout(loadAudit, 800);

            resolve({ success: true, paymentId: razorpay_payment_id });
          } else {
            appendBubble(
              `❌ <strong>Verification Failed</strong><br>${vData.error || 'Signature mismatch. Contact support.'}<br>Payment ID: ${razorpay_payment_id}`,
              'agent'
            );
            stage('Audit', { status: 'failed', error: 'Signature mismatch' });
            resolve({ success: false });
          }
        } catch (_) {
          appendBubble(
            `⚠️ Network error during verification. Contact support with: <strong>${razorpay_payment_id}</strong>`,
            'agent'
          );
          resolve({ success: false });
        }
      },
    };

    const rzp = new Razorpay(options);

    rzp.on('payment.failed', function (response) {
      const desc   = response.error?.description ?? 'The payment could not be completed.';
      const reason = response.error?.reason ?? '';
      appendBubble(
        `❌ <strong>Payment Failed</strong><br>${desc}${reason ? ` (${reason})` : ''}`,
        'agent'
      );
      resolve({ success: false });
    });

    rzp.open();
  });
}

/* ── Inject a paid row into the audit table immediately (optimistic UI) ── */
function injectPaidAuditRow(entry) {
  const tableBody = $('#tx-table-body');
  if (!tableBody) return;

  const time      = new Date(entry.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const itemLabel = `${entry.itemName} (${entry.itemPrice})`;
  const txIdHtml  = `<br><span style="font-size:12px;opacity:0.7;">${entry.paymentId}</span>`;
  const resultHtml = `<span style="color:#16a34a;font-weight:700;">✅ SUCCESS${txIdHtml}</span>`;

  const newRow = document.createElement('tr');
  newRow.innerHTML = `
    <td>${time}</td>
    <td>${itemLabel}</td>
    <td>✅ Razorpay Signature Verified</td>
    <td>${resultHtml}</td>
  `;

  // Prepend so newest is at the top (matching the reverse-sorted server list)
  tableBody.insertBefore(newRow, tableBody.firstChild);

  // Remove the placeholder "No transactions" row if present
  const placeholder = tableBody.querySelector('td[colspan]');
  if (placeholder) placeholder.closest('tr').remove();
}

/* ══════════════════════════════════════════════════
   CHAT FORM
══════════════════════════════════════════════════ */
$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();

  const q = $('#query').value;
  if (!q.trim()) return;

  appendBubble(q, 'user');
  $('#query').value = '';

  // Reset spine to pending state while request is in-flight
  ['Propose','Explain','Gate','Execute','Audit'].forEach(s => stage(s, { status: 'pending' }));
  $('#reasoning').textContent = 'Thinking…';

  const r = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query: q }),
  });
  const d = await r.json();

  if (!r.ok) {
    $('#reasoning').textContent = d.error;
    return;
  }

  appendBubble(d.agentResponse, 'agent');

  if (d.spine) {
    stage('Propose', d.spine.propose);
    stage('Explain', d.spine.explain);
    stage('Gate',    d.spine.gate);
    stage('Execute', d.spine.execute);
    stage('Audit',   d.spine.audit);
  }

  if (d.spine?.gate?.reasons?.length) {
    $('#reasoning').textContent = d.spine.gate.reasons.join(' ');
  } else if (d.spine?.propose?.error) {
    $('#reasoning').textContent = d.spine.propose.error;
  } else {
    $('#reasoning').textContent = 'Ready.';
  }

  if (d.auditLog) {
    renderAuditLog(d.auditLog);
  } else {
    loadAudit();
  }

  // ── Razorpay checkout if the agent returned a pendingCheckout ──────────────
  if (d.pendingCheckout) {
    // Small delay so the user sees the agent message before the modal opens
    setTimeout(() => openRazorpayCheckout(d.pendingCheckout), 600);
  }
};

/* ══════════════════════════════════════════════════
   QUICK-ACTION BUTTONS
══════════════════════════════════════════════════ */
document.querySelectorAll('[data-query]').forEach(btn => {
  btn.onclick = () => {
    $('#query').value = btn.dataset.query;
    $('#chat-form').requestSubmit();
  };
});

/* ══════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════ */
if (session) {
  fetch('/api/auth/me', { headers: authHeaders() })
    .then(r => r.ok ? showView() : signOut());
} else {
  showView();
}