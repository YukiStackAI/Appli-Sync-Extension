// ============================================================
// AppliSync v2 — Background Service Worker
// Handles: LLM routing, Supabase, Auth, Messaging
// ============================================================

// ─── Supabase Config (hardcoded fallbacks) ────────────────────
const SUPABASE_URL     = 'https://fzzgoimfokcqpejnbrdx.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6emdvaW1mb2tjcXBlam5icmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTk1MzgsImV4cCI6MjA5NDU5NTUzOH0.N1jkw0yqbVgHLAELuRUBtWkPDfSUeSPkYRTXeg1hnaM';
const BACKEND_URL      = 'https://applisync-backend.onrender.com';

// ─── Supabase Helpers ─────────────────────────────────────────

async function sbReq(endpoint, method = 'GET', body = null, token = null) {
  const settings = await getSettings();
  const url  = settings.supabase_url  || SUPABASE_URL;
  const anon = settings.supabase_key  || SUPABASE_ANON;

  const headers = {
    'Content-Type':  'application/json',
    'apikey':        anon,
    'Authorization': `Bearer ${token || anon}`,
  };
  if (method === 'POST') headers['Prefer'] = 'return=representation';

  const res  = await fetch(`${url}/rest/v1/${endpoint}`, {
    method, headers, body: body ? JSON.stringify(body) : null
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

async function getSession() {
  return new Promise(r => chrome.storage.local.get(['sb_session'], d => r(d.sb_session || null)));
}

async function setSession(s) {
  return new Promise(r => chrome.storage.local.set({ sb_session: s }, r));
}

async function getSettings() {
  return new Promise(r => chrome.storage.local.get(['as_settings'], d => r(d.as_settings || {})));
}

// ─── Auth ─────────────────────────────────────────────────────

async function signIn(email, password) {
  const settings = await getSettings();
  const url  = settings.supabase_url  || SUPABASE_URL;
  const anon = settings.supabase_key  || SUPABASE_ANON;

  const res  = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': anon },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Login failed');
  await setSession(data);
  return data;
}

async function signOut() {
  await chrome.storage.local.remove(['sb_session']);
}

// ─── LLM Extraction via Backend ───────────────────────────────

async function extractWithAI(html, url) {
  const settings = await getSettings();

  const provider   = settings.provider   || 'groq_default';
  const ollamaUrl  = settings.ollama_url  || 'http://localhost:11434';
  const backendUrl = settings.backend_url || BACKEND_URL;

  let apiKey = '';
  let model  = '';

  if (provider === 'groq') {
    apiKey = settings.groq_key   || '';
    model  = settings.groq_model  || 'llama-3.3-70b-versatile';
  } else if (provider === 'openai') {
    apiKey = settings.openai_key  || '';
    model  = settings.openai_model || 'gpt-4o-mini';
  } else if (provider === 'gemini') {
    apiKey = settings.gemini_key  || '';
    model  = settings.gemini_model || 'gemini-1.5-flash';
  } else if (provider === 'anthropic') {
    apiKey = settings.anthropic_key  || '';
    model  = settings.anthropic_model || 'claude-haiku-4-5-20251001';
  } else if (provider === 'openrouter') {
    apiKey = settings.openrouter_key  || '';
    model  = settings.openrouter_model || '';
  } else if (provider === 'ollama') {
    model  = settings.ollama_model  || '';
  }

  const res = await fetch(`${backendUrl}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, url, provider, api_key: apiKey, ollama_url: ollamaUrl, model })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backend error: ${err}`);
  }

  return await res.json(); // { company, role, posting_date, experience_required, job_description, location, portal }
}

// ─── Save Application ─────────────────────────────────────────

async function saveApplication(data) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');

  const record = {
    user_id:             session.user.id,
    portal:              data.portal              || 'Company Website',
    company:             data.company             || 'Unknown',
    role:                data.role                || 'Unknown',
    posting_date:        data.posting_date        || null,
    job_description:     data.job_description     || null,
    experience_required: data.experience_required || 'Fresher',
    applied_date:        new Date().toISOString(),
    location:            data.location            || null,
    salary:              data.salary              || null,
    job_url:             data.job_url             || null,
    form_fields:         data.form_fields         ? JSON.stringify(data.form_fields) : null,
    files_submitted:     data.files_submitted     ? JSON.stringify(data.files_submitted) : null,
    mode_of_work:          data.mode_of_work          || null,
    skills_required:       data.skills_required       || null,
    important_information: data.important_information || null,
    status:              'Applied',
    notes:               data.notes               || null,
  };

  const result = await sbReq('applications', 'POST', record, session.access_token);

  chrome.notifications.create({
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   '✅ AppliSync — Saved!',
    message: `${record.role} at ${record.company}`
  });

  return result;
}

async function getApplications(limit = 8) {
  const session = await getSession();
  if (!session) return [];
  return sbReq(
    `applications?user_id=eq.${session.user.id}&order=applied_date.desc&limit=${limit}`,
    'GET', null, session.access_token
  );
}

// ─── Message Router ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = async () => {
    try {
      switch (msg.type) {

        case 'SIGN_IN':
          return { ok: true, data: await signIn(msg.email, msg.password) };

        case 'SIGN_OUT':
          await signOut();
          return { ok: true };

        case 'GET_SESSION':
          return { ok: true, data: await getSession() };

        case 'GET_SETTINGS':
          return { ok: true, data: await getSettings() };

        case 'SAVE_SETTINGS':
          await chrome.storage.local.set({ as_settings: msg.settings });
          return { ok: true };

        case 'EXTRACT_PAGE': {
          const result = await extractWithAI(msg.html, msg.url);
          return { ok: true, data: result };
        }

        case 'SAVE_APPLICATION': {
          const result = await saveApplication(msg.data);
          return { ok: true, data: result };
        }

        case 'GET_APPLICATIONS': {
          const apps = await getApplications(msg.limit || 8);
          return { ok: true, data: apps };
        }

        default:
          return { ok: false, error: 'Unknown message type' };
      }
    } catch (e) {
      console.error('[AppliSync BG]', e);
      return { ok: false, error: e.message };
    }
  };

  run().then(reply);
  return true;
});

console.log('[AppliSync] Background v2 ready ✅');
