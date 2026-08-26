'use strict';

/* ── DOM helpers ── */
const $ = (sel) => document.querySelector(sel);

/* ── Session state ── */
const SESSION_KEY = 'agentic-session';
let mode    = 'login';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');

/* ── Auth headers ── */
const authHeaders = () => ({
  Authorization: `Bearer ${session.token}`,
  'Content-Type': 'application/json',
});

/* ══════════════════════════════════════════════════
   UI STATE SWITCHER
   Shows #auth-view or #dashboard-view based on
   whether a valid session object is in memory.
══════════════════════════════════════════════════ */
function showView() {
  const authed = !!session;

  /* Hide/show with display so CSS transitions work cleanly */
  $('#auth-view').style.display      = authed ? 'none'  : '';
  $('#dashboard-view').style.display = authed ? 'block' : 'none';

  if (authed) {
    $('#user-greeting').textContent = 'Hi, ' + session.user.name;
    loadAudit();
  }
}

/* ── Spine step indicator ── */
function stage(name, ok) {
  const el = $(`[data-step="${name}"]`);
  el.className = ok ? 'approved' : 'failed';
  el.querySelector('b').textContent = ok ? 'V' : 'X';
}

/* ── Load audit history ── */
async function loadAudit() {
  const r = await fetch('/api/audit', { headers: authHeaders() });
  const d = await r.json();
  if (!r.ok) { signOut(); return; }
  $('#rows').innerHTML = d.slice().reverse()
    .map(x => `<tr>
      <td>${new Date(x.executedAt).toLocaleTimeString()}</td>
      <td>${x.actionType}</td>
      <td>${x.gate.approved ? 'Approved' : 'Rejected'}</td>
      <td>${x.status}</td>
    </tr>`).join('') ||
    '<tr><td colspan="4">No transactions yet.</td></tr>';
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
   TAB SWITCHER  (Sign In / Sign Up)
══════════════════════════════════════════════════ */
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.onclick = () => {
    mode = btn.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#name-wrap').hidden       = mode === 'login';
    $('#auth-submit').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
    $('#auth-error').textContent  = '';
  };
});

/* ══════════════════════════════════════════════════
   AUTH FORM  (Sign In / Sign Up)
══════════════════════════════════════════════════ */
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();   /* Prevent page reload — CRITICAL */

  $('#auth-error').textContent = '';

  const body = {
    email:    $('#email').value,
    password: $('#password').value,
  };
  if (mode === 'signup') body.name = $('#name').value;

  const r = await fetch(`/api/auth/${mode}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const d = await r.json();

  if (!r.ok) {
    $('#auth-error').textContent = d.error || 'Something went wrong.';
    return;
  }

  /* Store session and switch view */
  session = d;
  localStorage.setItem(SESSION_KEY, JSON.stringify(d));
  showView();
};

/* ══════════════════════════════════════════════════
   SIGN OUT BUTTON
══════════════════════════════════════════════════ */
$('#sign-out').onclick = signOut;

/* ══════════════════════════════════════════════════
   CHAT FORM
══════════════════════════════════════════════════ */
$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();   /* Prevent page reload — CRITICAL */

  const q = $('#query').value;
  const r = await fetch('/api/agent/chat', {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ query: q }),
  });
  const d = await r.json();

  if (!r.ok) {
    $('#reasoning').textContent = d.error;
    return;
  }

  ['Propose', 'Explain', 'Gate', 'Execute', 'Audit'].forEach((name, i) => {
    stage(name, i < 3 ? d.gate.approved : d.execution?.status === 'executed');
  });

  $('#reasoning').textContent =
    d.gate.reasons.join(' ') || d.explained?.explanation || '';
  $('#query').value = '';
  loadAudit();
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
   BOOTSTRAP  –  validate existing session on load
══════════════════════════════════════════════════ */
if (session) {
  fetch('/api/auth/me', { headers: authHeaders() })
    .then(r => r.ok ? showView() : signOut());
} else {
  showView();
}
