// AppliSync Settings JS

const msg = (type, payload = {}) => new Promise(resolve => {
  chrome.runtime.sendMessage({ type, ...payload }, r => {
    if (chrome.runtime.lastError) resolve({ ok: false });
    else resolve(r);
  });
});

// ── Tab Navigation ────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tab = link.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
  });
});

// ── Ollama custom model toggle ────────────────────────────────
document.getElementById('ollama-model')?.addEventListener('change', function () {
  const wrap = document.getElementById('ollama-custom-wrap');
  if (wrap) wrap.style.display = this.value === 'custom' ? 'flex' : 'none';
});

// ── Load Settings ─────────────────────────────────────────────
async function loadSettings() {
  const res = await msg('GET_SETTINGS');
  const s   = res?.data || {};

  // Select provider radio
  const radio = document.querySelector(`input[name="provider"][value="${s.provider || 'groq_default'}"]`);
  if (radio) radio.checked = true;

  // Fill fields
  setValue('groq-key',          s.groq_key         || '');
  setValue('groq-model',        s.groq_model        || 'llama-3.1-70b-versatile');
  setValue('ollama-url',        s.ollama_url        || 'http://localhost:11434');
  setValue('ollama-model',      s.ollama_model      || 'llama3.1');
  setValue('ollama-custom',     s.ollama_custom     || '');
  setValue('openai-key',        s.openai_key        || '');
  setValue('openai-model',      s.openai_model      || 'gpt-4o-mini');
  setValue('gemini-key',        s.gemini_key        || '');
  setValue('gemini-model',      s.gemini_model      || 'gemini-1.5-flash');
  setValue('anthropic-key',     s.anthropic_key     || '');
  setValue('anthropic-model',   s.anthropic_model   || 'claude-haiku-4-5-20251001');
  setValue('openrouter-key',    s.openrouter_key    || '');
  setValue('openrouter-model',  s.openrouter_model  || '');

  // Supabase tab
  setValue('sb-url',  s.supabase_url  || '');
  setValue('sb-key',  s.supabase_key  || '');
  setValue('be-url',  s.backend_url   || '');

  // Custom ollama toggle
  if (s.ollama_model === 'custom') {
    const wrap = document.getElementById('ollama-custom-wrap');
    if (wrap) wrap.style.display = 'flex';
  }
}

// ── Save AI Settings ──────────────────────────────────────────
document.getElementById('save-btn')?.addEventListener('click', async () => {
  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'groq_default';

  const settings = {
    provider,
    groq_key:         getValue('groq-key'),
    groq_model:       getValue('groq-model'),
    ollama_url:       getValue('ollama-url') || 'http://localhost:11434',
    ollama_model:     getValue('ollama-model') === 'custom'
                        ? getValue('ollama-custom')
                        : getValue('ollama-model'),
    openai_key:       getValue('openai-key'),
    openai_model:     getValue('openai-model'),
    gemini_key:       getValue('gemini-key'),
    gemini_model:     getValue('gemini-model'),
    anthropic_key:    getValue('anthropic-key'),
    anthropic_model:  getValue('anthropic-model'),
    openrouter_key:   getValue('openrouter-key'),
    openrouter_model: getValue('openrouter-model'),
    // Preserve supabase settings
    supabase_url:     getValue('sb-url'),
    supabase_key:     getValue('sb-key'),
    backend_url:      getValue('be-url'),
  };

  const res = await msg('SAVE_SETTINGS', { settings });
  const statusEl = document.getElementById('save-status');

  if (res?.ok) {
    statusEl.textContent = '✅ Saved!';
    statusEl.className   = 'status-ok';
  } else {
    statusEl.textContent = '❌ Failed to save';
    statusEl.className   = 'status-err';
  }

  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

// ── Save Supabase Settings ────────────────────────────────────
document.getElementById('sb-save')?.addEventListener('click', async () => {
  const res = await msg('GET_SETTINGS');
  const existing = res?.data || {};

  const settings = {
    ...existing,
    supabase_url: getValue('sb-url'),
    supabase_key: getValue('sb-key'),
    backend_url:  getValue('be-url'),
  };

  const r = await msg('SAVE_SETTINGS', { settings });
  const statusEl = document.getElementById('sb-status');
  statusEl.textContent = r?.ok ? '✅ Saved!' : '❌ Failed';
  statusEl.className   = r?.ok ? 'status-ok' : 'status-err';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

// ── Helpers ───────────────────────────────────────────────────
function getValue(id)      { return document.getElementById(id)?.value?.trim() || ''; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

// ── Init ──────────────────────────────────────────────────────
loadSettings();
