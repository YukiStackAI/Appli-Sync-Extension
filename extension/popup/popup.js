// AppliSync Popup JS
const $ = id => document.getElementById(id);
const msg = (type, payload = {}) => new Promise(resolve => {
  chrome.runtime.sendMessage({ type, ...payload }, r => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
    else resolve(r);
  });
});

const PORTAL_INITIALS = {
  'LinkedIn': 'LI', 'Naukri': 'NK', 'Indeed': 'IN',
  'Internshala': 'IS', 'Glassdoor': 'GD', 'Wellfound': 'WF',
  'Lever': 'LV', 'Greenhouse': 'GH', 'Workday': 'WD', 'Company Website': 'CW'
};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showScreen(name) {
  ['s-auth','s-main'].forEach(id => $(id)?.classList.add('hidden'));
  $(`s-${name}`)?.classList.remove('hidden');
}

// ── Auth ──────────────────────────────────────────────────────
async function handleSignIn() {
  const email = $('p-email').value.trim();
  const pass  = $('p-pass').value;
  const btn   = $('p-signin');
  const err   = $('p-err');

  err.textContent = '';
  if (!email || !pass) { err.textContent = 'Enter email and password.'; return; }

  btn.textContent = 'Signing in…';
  btn.disabled    = true;

  const res = await msg('SIGN_IN', { email, password: pass });
  btn.textContent = 'Sign In';
  btn.disabled    = false;

  if (res?.ok) { showScreen('main'); loadMain(); }
  else err.textContent = res?.error || 'Sign in failed.';
}

// ── Main ──────────────────────────────────────────────────────
async function loadMain() {
  loadProviderPill();
  loadApps();
}

async function loadProviderPill() {
  const res = await msg('GET_SETTINGS');
  const s   = res?.data || {};
  const map  = {
    groq_default: 'Groq (Default · Free)',
    groq:         'Groq · ' + (s.model || 'llama-3.3-70b'),
    ollama:       'Ollama · Local',
    openai:       'OpenAI · ' + (s.model || 'gpt-4o-mini'),
    gemini:       'Gemini · ' + (s.model || 'gemini-1.5-flash'),
    anthropic:    'Claude · ' + (s.model || 'claude-haiku'),
    openrouter:   'OpenRouter · ' + (s.model || 'mixtral'),
  };
  $('provider-name').textContent = map[s.provider || 'groq_default'] || 'Groq (Default)';
}

async function loadApps() {
  const list = $('p-apps');
  list.innerHTML = '<div class="loading">Loading…</div>';

  const res  = await msg('GET_APPLICATIONS', { limit: 8 });
  const apps = res?.data || [];

  $('st-total').textContent = apps.length;
  const week = apps.filter(a => (Date.now() - new Date(a.applied_date)) < 7*864e5).length;
  $('st-week').textContent  = week;
  $('st-inter').textContent = apps.filter(a => a.status === 'Interview').length;

  if (!apps.length) {
    list.innerHTML = '<div class="empty">No applications yet.<br>Open a job page to start!</div>';
    return;
  }

  list.innerHTML = apps.map(a => `
    <div class="app-card">
      <div class="app-portal">${esc(PORTAL_INITIALS[a.portal] || '?')}</div>
      <div class="app-info">
        <div class="app-role">${esc(a.role)}</div>
        <div class="app-company">${esc(a.company)}</div>
      </div>
      <span class="app-status status-${esc(a.status)}">${esc(a.status)}</span>
    </div>
  `).join('');
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $('p-signin').addEventListener('click', handleSignIn);
  $('p-pass').addEventListener('keydown', e => { if (e.key === 'Enter') handleSignIn(); });

  $('p-out')?.addEventListener('click', async () => {
    await msg('SIGN_OUT');
    showScreen('auth');
  });

  $('p-dash')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://applli-sync.vercel.app/dashboard' });
  });

  $('p-settings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('change-provider')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $('p-overlay')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'SHOW_OVERLAY' });
    window.close();
  });

  const res = await msg('GET_SESSION');
  if (res?.data) { showScreen('main'); loadMain(); }
  else showScreen('auth');
});
