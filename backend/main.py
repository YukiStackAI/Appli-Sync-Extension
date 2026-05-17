# ============================================================
# AppliSync v2 — FastAPI Backend
# Scrapling extraction + multi-provider LLM routing
# Deploy free on: Railway / Render / Fly.io
# ============================================================

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import json, re, os, httpx
from datetime import datetime
from dotenv import load_dotenv

# Load local environment variables from .env
load_dotenv()

app = FastAPI(title="AppliSync Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Chrome extension origin
    allow_methods=["POST","GET"],
    allow_headers=["*"],
)

# ── Built-in Groq key (your free default) ────────────────────
BUILTIN_GROQ_KEY   = os.getenv("GROQ_API_KEY", "")
BUILTIN_GROQ_MODEL = "llama-3.3-70b-versatile"

# ── Request Model ─────────────────────────────────────────────
class ExtractRequest(BaseModel):
    html:        str
    url:         str
    provider:    str = "groq_default"
    api_key:     Optional[str] = None
    ollama_url:  Optional[str] = "http://localhost:11434"
    model:       Optional[str] = None

# ── Extraction Prompt ────────────────────────────────────────
SYSTEM_PROMPT = """You are a job data extraction AI. Extract structured job information from the given page text.
Return ONLY valid JSON, no markdown, no explanation. If a field cannot be found, use null.
For experience_required: if not mentioned or says 'fresher/entry level/0 years', return "Fresher".
For posting_date: convert relative dates like '2 weeks ago' to approximate ISO date (YYYY-MM-DD).
For job_description: return the full JD text, max 3000 characters."""

def build_prompt(text: str, url: str) -> str:
    return f"""Extract job details from this page and return ONLY this JSON structure:

{{
  "company": "Company name",
  "role": "Job title / role",
  "location": "City, State or Remote",
  "salary": "Salary range if mentioned, else null",
  "posting_date": "YYYY-MM-DD or null",
  "experience_required": "e.g. 2-4 years or Fresher",
  "job_description": "Full job description text",
  "portal": "LinkedIn | Naukri | Indeed | Company Website"
}}

Page URL: {url}

Page content:
{text[:8000]}"""

# ── Scrapling Extraction ─────────────────────────────────────
def scrape_page(html: str) -> str:
    """Use Scrapling to extract clean meaningful text from raw HTML."""
    try:
        from scrapling import Adaptor
        page = Adaptor(html)

        # Get all meaningful text blocks, ignoring noisy tags
        text = page.get_all_text(
            ignore_tags=('script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript'),
            strip=True
        )
        return text[:10000]

    except ImportError:
        # Fallback: basic text extraction without Scrapling
        clean = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL|re.IGNORECASE)
        clean = re.sub(r'<style[^>]*>.*?</style>',  '', clean,  flags=re.DOTALL|re.IGNORECASE)
        clean = re.sub(r'<[^>]+>', ' ', clean)
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean[:10000]

    except Exception as e:
        # Ultimate fallback
        clean = re.sub(r'<[^>]+>', ' ', html)
        clean = re.sub(r'\s+', ' ', clean).strip()
        return clean[:10000]

# ── LLM Provider Calls ────────────────────────────────────────

async def call_groq(prompt: str, api_key: str, model: Optional[str]) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model":    model or BUILTIN_GROQ_MODEL,
                "messages": [
                    {"role": "system",  "content": SYSTEM_PROMPT},
                    {"role": "user",    "content": prompt}
                ],
                "max_tokens":   1500,
                "temperature":  0.1,
            }
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]

async def call_openai(prompt: str, api_key: str, model: Optional[str]) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model":    model or "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt}
                ],
                "max_tokens":  1500,
                "temperature": 0.1,
            }
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]

async def call_gemini(prompt: str, api_key: str, model: Optional[str]) -> str:
    model_name = model or "gemini-1.5-flash"
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}",
            json={
                "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1500}
            }
        )
        res.raise_for_status()
        return res.json()["candidates"][0]["content"]["parts"][0]["text"]

async def call_anthropic(prompt: str, api_key: str, model: Optional[str]) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type":      "application/json"
            },
            json={
                "model":      model or "claude-haiku-4-5-20251001",
                "max_tokens": 1500,
                "system":     SYSTEM_PROMPT,
                "messages":   [{"role": "user", "content": prompt}]
            }
        )
        res.raise_for_status()
        return res.json()["content"][0]["text"]

async def call_ollama(prompt: str, ollama_url: Optional[str], model: Optional[str]) -> str:
    url = (ollama_url or "http://localhost:11434").rstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:  # longer timeout for local
        res = await client.post(
            f"{url}/api/chat",
            json={
                "model":  model or "llama3.1",
                "stream": False,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt}
                ]
            }
        )
        res.raise_for_status()
        return res.json()["message"]["content"]

async def call_openrouter(prompt: str, api_key: str, model: Optional[str]) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization":   f"Bearer {api_key}",
                "Content-Type":    "application/json",
                "HTTP-Referer":    "https://applli-sync.vercel.app",
                "X-Title":         "AppliSync"
            },
            json={
                "model":    model or "mistralai/mixtral-8x7b-instruct",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt}
                ],
                "max_tokens":  1500,
                "temperature": 0.1,
            }
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]

# ── Parse LLM Response ────────────────────────────────────────
def parse_llm_response(raw: str) -> dict:
    # Strip markdown code fences if present
    clean = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.IGNORECASE)
    clean = re.sub(r'\s*```$', '', clean)

    try:
        data = json.loads(clean)
    except json.JSONDecodeError:
        # Try to extract JSON object from response
        match = re.search(r'\{.*\}', clean, re.DOTALL)
        if match:
            data = json.loads(match.group())
        else:
            data = {}

    # Ensure defaults
    if not data.get('experience_required'):
        data['experience_required'] = 'Fresher'

    return data

# ── Main Extraction Endpoint ──────────────────────────────────
@app.post("/extract")
async def extract(req: ExtractRequest):
    # 1. Scrapling: clean the HTML into readable text
    page_text = scrape_page(req.html)

    # 2. Build prompt
    prompt = build_prompt(page_text, req.url)

    # 3. Route to selected LLM
    try:
        provider = req.provider

        if provider == "groq_default":
            if not BUILTIN_GROQ_KEY:
                raise HTTPException(400, "No built-in Groq key configured on server")
            raw = await call_groq(prompt, BUILTIN_GROQ_KEY, BUILTIN_GROQ_MODEL)

        elif provider == "groq":
            if not req.api_key:
                raise HTTPException(400, "Groq API key required")
            raw = await call_groq(prompt, req.api_key, req.model or BUILTIN_GROQ_MODEL)

        elif provider == "openai":
            if not req.api_key:
                raise HTTPException(400, "OpenAI API key required")
            raw = await call_openai(prompt, req.api_key, req.model)

        elif provider == "gemini":
            if not req.api_key:
                raise HTTPException(400, "Gemini API key required")
            raw = await call_gemini(prompt, req.api_key, req.model)

        elif provider == "anthropic":
            if not req.api_key:
                raise HTTPException(400, "Anthropic API key required")
            raw = await call_anthropic(prompt, req.api_key, req.model)

        elif provider == "ollama":
            raw = await call_ollama(prompt, req.ollama_url, req.model)

        elif provider == "openrouter":
            if not req.api_key:
                raise HTTPException(400, "OpenRouter API key required")
            raw = await call_openrouter(prompt, req.api_key, req.model)

        else:
            raise HTTPException(400, f"Unknown provider: {provider}")

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"LLM API error ({provider}): {e.response.status_code} — {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {str(e)}")

    # 4. Parse + return
    data = parse_llm_response(raw)
    return data

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0", "time": datetime.utcnow().isoformat()}
