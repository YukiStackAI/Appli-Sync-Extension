# AppliSync v2 — Complete Setup Guide

## Project Structure
```
applisync-v2/
├── extension/
│   ├── manifest.json
│   ├── background.js          ← Supabase + LLM routing
│   ├── content/
│   │   ├── content.js         ← Floating overlay + form tracker
│   │   └── overlay.css        ← Overlay styles
│   ├── popup/
│   │   ├── popup.html/css/js  ← Extension popup
│   ├── settings/
│   │   ├── settings.html/css/js ← AI provider settings page
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── backend/
│   ├── main.py                ← FastAPI: Scrapling + LLM routing
│   └── requirements.txt
├── supabase-schema.sql
└── README.md
```

---

## Step 1 — Supabase

1. Create project at supabase.com
2. SQL Editor → Run `supabase-schema.sql`
3. Settings → API → copy **Project URL** and **anon key**

---

## Step 2 — Backend (FastAPI + Scrapling)

```bash
cd backend
pip install -r requirements.txt

# Create .env file
echo "GROQ_API_KEY=your_free_groq_key_here" > .env

# Run locally
uvicorn main:app --reload --port 8000

# Test
curl http://localhost:8000/health
```

### Deploy to Railway (free)
1. Push backend/ to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add env variable: `GROQ_API_KEY=gsk_...`
4. Copy your Railway URL: `https://your-app.up.railway.app`

### Deploy to Render (free)
1. render.com → New Web Service → connect GitHub
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env var: `GROQ_API_KEY`

---

## Step 3 — Extension

### Fill in your URLs in background.js:
```js
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';
const BACKEND_URL   = 'https://your-app.up.railway.app';
```

### Add icons:
Put your AppliSync "A" logo in icons/ at:
- icon16.png  (16×16)
- icon48.png  (48×48)
- icon128.png (128×128)

### Load in Chrome:
1. `chrome://extensions/` → Enable **Developer mode**
2. **Load unpacked** → select `extension/` folder
3. Pin AppliSync to toolbar

---

## Step 4 — Configure AI Provider

1. Click extension icon → ⚙️ Settings
2. Choose your AI provider:
   - **Groq Default** → works immediately, no setup
   - **Ollama** → install ollama.com, run `ollama pull llama3.1`
   - **Others** → paste your API key
3. Save Settings

---

## How to Use

1. Open any job page (LinkedIn, Naukri, Indeed, company site)
2. The **AppliSync floating card** appears bottom-right
3. Click **⚡ Extract This Page** → AI reads & fills the form
4. Fill the application form on the page (fields auto-captured)
5. Upload resume (filename auto-captured)
6. Click **Apply** on the job site
7. Click **💾 Save Application** on the AppliSync card
8. ✅ Saved to Supabase with all details!

### Multi-page apply forms (LinkedIn Easy Apply):
- The card stays open across all steps
- Fill each page → card keeps collecting your inputs
- On final step, click Save → everything saved at once

---

## What Gets Saved

| Field | Source |
|---|---|
| Portal | Detected from URL |
| Company | AI extracts from page |
| Role | AI extracts from page |
| Location | AI extracts from page |
| Salary | AI extracts from page |
| Posting Date | AI extracts (parses "2 weeks ago") |
| Experience Required | AI extracts (defaults to Fresher) |
| Job Description | AI extracts full JD |
| Applied Date | Current timestamp |
| Form Fields | Every input/textarea you filled |
| Files Submitted | Filename of uploaded resume/docs |

---

## Supported Portals

Auto-detected: LinkedIn, Naukri, Indeed, Internshala, Glassdoor,
Wellfound, Lever, Greenhouse, Workday, any company website

---

## Supported AI Providers

| Provider | Cost | Notes |
|---|---|---|
| Groq Default | Free | Built into AppliSync |
| Groq (own key) | Free | Higher limits |
| Ollama | Free | Local, private |
| OpenAI | ~₹0.05/call | GPT-4o-mini |
| Gemini | Free tier | 1.5 Flash |
| Anthropic | ~₹0.04/call | Claude Haiku |
| OpenRouter | Some free | 100+ models |
