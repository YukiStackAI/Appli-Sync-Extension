-- ============================================================
-- AppliSync v2 — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS applications (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Job Info (from LLM extraction)
  portal               TEXT DEFAULT 'Company Website',
  company              TEXT NOT NULL,
  role                 TEXT NOT NULL,
  location             TEXT,
  salary               TEXT,
  posting_date         DATE,
  experience_required  TEXT DEFAULT 'Fresher',
  job_description      TEXT,
  job_url              TEXT,

  -- Application Info
  applied_date         TIMESTAMPTZ DEFAULT NOW(),
  status               TEXT DEFAULT 'Applied'
    CHECK (status IN ('Applied','Screening','Interview','Technical','Offered','Rejected','Withdrawn','Ghosted')),

  -- Form data captured by extension
  form_fields          JSONB,        -- { "Phone": "9876543210", "Cover Letter": "..." }
  files_submitted      JSONB,        -- ["Rahul_Resume_2025.pdf", "Cover_Letter.pdf"]

  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own"   ON applications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own" ON applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own" ON applications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "delete own" ON applications FOR DELETE USING (auth.uid() = user_id);

-- ── Auto updated_at ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX idx_apps_user      ON applications(user_id);
CREATE INDEX idx_apps_date      ON applications(applied_date DESC);
CREATE INDEX idx_apps_status    ON applications(status);
CREATE INDEX idx_apps_portal    ON applications(portal);
CREATE INDEX idx_apps_company   ON applications(company);

-- ── Stats View ────────────────────────────────────────────────
CREATE OR REPLACE VIEW application_stats AS
SELECT
  user_id,
  COUNT(*)                                                      AS total,
  COUNT(*) FILTER (WHERE status = 'Applied')                    AS applied,
  COUNT(*) FILTER (WHERE status IN ('Interview','Technical'))   AS interviews,
  COUNT(*) FILTER (WHERE status = 'Offered')                    AS offers,
  COUNT(*) FILTER (WHERE status = 'Rejected')                   AS rejected,
  COUNT(*) FILTER (WHERE applied_date >= NOW() - INTERVAL '7 days')  AS this_week,
  COUNT(*) FILTER (WHERE applied_date >= NOW() - INTERVAL '30 days') AS this_month,
  COUNT(DISTINCT company)                                       AS unique_companies,
  COUNT(DISTINCT portal)                                        AS portals_used
FROM applications
GROUP BY user_id;
