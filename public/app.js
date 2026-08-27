'use strict';

/* ── DOM helpers ── */
const $ = (sel) => document.querySelector(sel);

/* ── Session state ── */
const SESSION_KEY = 'agentic-session';
let mode = 'login';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');

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

function renderAuditLog(auditLog) {
  const tableBody = $('#tx-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = auditLog.slice().reverse()
    .map(x => `<tr>
      <td>${new Date(x.executedAt || Date.now()).toLocaleTimeString()}</td>
      <td>${x.actionType || 'N/A'}</td>
      <td>${x.gate?.approved ? 'Approved' : 'Rejected'}</td>
      <td>${x.status}</td>
    </tr>`).join('') ||
    '<tr><td colspan="4">No transactions yet.</td></tr>';
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
   CHAT FORM
══════════════════════════════════════════════════ */
$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();

  const q = $('#query').value;
  if (!q.trim()) return;

  appendBubble(q, 'user');
  $('#query').value = '';

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
    stage('Gate', d.spine.gate);
    stage('Execute', d.spine.execute);
    stage('Audit', d.spine.audit);
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