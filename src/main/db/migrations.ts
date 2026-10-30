export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT,
  city TEXT,
  country_code TEXT,
  citizenships TEXT NOT NULL DEFAULT '[]',
  residence_country TEXT,
  linkedin TEXT,
  website TEXT,
  github TEXT,
  summary TEXT,
  years_experience REAL,
  skills TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  salary_expectation TEXT,
  notice_period TEXT,
  earliest_start TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE work_authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('citizen','permanent_resident','work_permit','student_permit','dependent_permit','none')),
  permit_type TEXT,
  valid_from TEXT,
  valid_until TEXT,
  needs_sponsorship INTEGER NOT NULL DEFAULT 0 CHECK (needs_sponsorship IN (0,1)),
  evidence_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (country_code)
);

CREATE TABLE country_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_key TEXT NOT NULL,
  question_text TEXT NOT NULL,
  country_code TEXT,
  answer TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_country_answers_key ON country_answers(question_key, IFNULL(country_code, ''));

CREATE TABLE resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_resumes_default ON resumes(is_default) WHERE is_default = 1;

CREATE TABLE target_countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  remote_preference TEXT NOT NULL DEFAULT 'any' CHECK (remote_preference IN ('remote','hybrid','onsite','any')),
  employment_types TEXT NOT NULL DEFAULT '[]',
  job_titles TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  exclude_keywords TEXT NOT NULL DEFAULT '[]',
  min_salary REAL,
  currency TEXT,
  seniority TEXT NOT NULL DEFAULT '[]',
  schedule_cron TEXT NOT NULL DEFAULT '0 */6 * * *',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  sources TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_run_at INTEGER
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  label TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  countries TEXT NOT NULL DEFAULT '[]',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_item_count INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_domain TEXT,
  country_code TEXT,
  location_raw TEXT,
  remote_type TEXT NOT NULL DEFAULT 'unknown' CHECK (remote_type IN ('remote','hybrid','onsite','unknown')),
  employment_type TEXT NOT NULL DEFAULT 'unknown' CHECK (employment_type IN ('full_time','part_time','contract','internship','temporary','unknown')),
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT,
  description_html TEXT,
  description_text TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '[]',
  posted_at INTEGER,
  expires_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  url TEXT NOT NULL,
  apply_url TEXT,
  application_email TEXT,
  application_email_evidence TEXT,
  application_instructions TEXT,
  sponsor_signal TEXT NOT NULL DEFAULT 'unstated' CHECK (sponsor_signal IN ('sponsorship_offered','sponsorship_not_offered','existing_right_to_work_required','citizenship_or_clearance_required','unstated')),
  sponsor_evidence TEXT,
  work_auth_statements TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  seniority TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','closed','duplicate','removed')),
  raw TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_id, external_id)
);
CREATE INDEX ix_jobs_dedupe ON jobs(dedupe_key);
CREATE INDEX ix_jobs_status ON jobs(status);
CREATE INDEX ix_jobs_company ON jobs(company);
CREATE INDEX ix_jobs_country ON jobs(country_code);
CREATE INDEX ix_jobs_posted ON jobs(posted_at DESC);
CREATE INDEX ix_jobs_source ON jobs(source_id);

CREATE TABLE job_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('eligible','eligible_needs_sponsorship_offered','ineligible','needs_review')),
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reasons TEXT NOT NULL DEFAULT '[]',
  rule_ids TEXT NOT NULL DEFAULT '[]',
  authorization_basis TEXT,
  matched_bloc TEXT,
  requires_sponsorship INTEGER NOT NULL DEFAULT 0 CHECK (requires_sponsorship IN (0,1)),
  profile_hash TEXT,
  evaluated_at INTEGER NOT NULL
);
CREATE INDEX ix_evaluations_verdict ON job_evaluations(verdict);

CREATE TABLE job_duplicates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  duplicate_of_job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  similarity REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (job_id)
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','web','manual')),
  channel_reason TEXT NOT NULL,
  decision_evidence TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('draft','awaiting_approval','approved','queued','sending','submitted','failed','uncertain','needs_human','rejected','withdrawn')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  attempt INTEGER NOT NULL DEFAULT 1,
  resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
  template_id INTEGER,
  subject TEXT,
  body TEXT,
  recipient TEXT,
  apply_url TEXT,
  last_error TEXT,
  confirmation TEXT,
  approved_at INTEGER,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_applications_active ON applications(job_id) WHERE active = 1;
CREATE INDEX ix_applications_status ON applications(status);
CREATE INDEX ix_applications_channel ON applications(channel);
CREATE INDEX ix_applications_submitted ON applications(submitted_at DESC);

CREATE TABLE outbox_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  adapter TEXT NOT NULL CHECK (adapter IN ('mock','smtp')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','uncertain','cancelled')),
  to_address TEXT NOT NULL,
  from_address TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  attempt INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  error TEXT,
  queued_at INTEGER NOT NULL,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_outbox_status ON outbox_messages(status);
CREATE INDEX ix_outbox_application ON outbox_messages(application_id);

CREATE TABLE outbox_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id INTEGER NOT NULL REFERENCES outbox_messages(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT NOT NULL,
  error TEXT,
  provider_response TEXT
);
CREATE INDEX ix_outbox_attempts_message ON outbox_attempts(outbox_id);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('application_email','cover_letter','follow_up')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_templates_default ON templates(kind) WHERE is_default = 1;

CREATE TABLE template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_template_versions_template ON template_versions(template_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  category TEXT NOT NULL,
  job_id INTEGER,
  application_id INTEGER,
  source_id TEXT,
  task_id INTEGER,
  message TEXT NOT NULL,
  detail TEXT,
  actor TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX ix_events_ts ON events(ts DESC);
CREATE INDEX ix_events_category ON events(category);
CREATE INDEX ix_events_job ON events(job_id);
CREATE INDEX ix_events_application ON events(application_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','dead','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
  idempotency_key TEXT UNIQUE,
  last_error TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX ix_tasks_claim ON tasks(status, run_at, priority DESC, id);
CREATE INDEX ix_tasks_lease ON tasks(status, lease_expires_at);
CREATE INDEX ix_tasks_type ON tasks(type);

CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE worker_heartbeats (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_task_id INTEGER,
  app_version TEXT
);

CREATE TABLE ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_ai_calls_created ON ai_calls(created_at DESC);

CREATE TABLE ai_provider_state (
  provider TEXT PRIMARY KEY,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE source_fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  new_items INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_ms INTEGER
);
CREATE INDEX ix_source_fetches_source ON source_fetches(source_id, started_at DESC);

CREATE TABLE daily_metrics (
  date TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  jobs_discovered INTEGER NOT NULL DEFAULT 0,
  jobs_eligible INTEGER NOT NULL DEFAULT 0,
  jobs_ineligible INTEGER NOT NULL DEFAULT 0,
  applications_drafted INTEGER NOT NULL DEFAULT 0,
  awaiting_approval INTEGER NOT NULL DEFAULT 0,
  submitted INTEGER NOT NULL DEFAULT 0,
  email_submitted INTEGER NOT NULL DEFAULT 0,
  web_submitted INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  uncertain INTEGER NOT NULL DEFAULT 0,
  needs_human INTEGER NOT NULL DEFAULT 0,
  responses INTEGER NOT NULL DEFAULT 0,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  emails_failed INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  ai_fallbacks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_daily_metrics_date ON daily_metrics(date DESC);

CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  generated_at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  notified_at INTEGER
);

CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('acknowledgement','interview','rejection','offer','other')),
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_responses_application ON responses(application_id);
`
  },
  {
    version: 2,
    name: 'secrets_and_web_runs',
    sql: `
CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE web_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','awaiting_human','submitted','failed','cancelled')),
  steps TEXT NOT NULL DEFAULT '[]',
  prefilled TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  confirmation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_web_runs_application ON web_runs(application_id);
CREATE INDEX ix_web_runs_status ON web_runs(status);
`
  },
  {
    version: 3,
    name: 'resume_extractions_and_roles',
    sql: `
CREATE TABLE resume_extractions (
  resume_id INTEGER PRIMARY KEY REFERENCES resumes(id) ON DELETE CASCADE,
  parser_version TEXT NOT NULL,
  text TEXT NOT NULL,
  text_chars INTEGER NOT NULL,
  data TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  sections_found TEXT NOT NULL DEFAULT '[]',
  extracted_at INTEGER NOT NULL
);

CREATE TABLE role_selections (
  role_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('catalog','custom')),
  created_at INTEGER NOT NULL
);
`
  },
  {
    version: 4,
    name: 'chat_channels',
    sql: `
CREATE TABLE chat_state (
  provider TEXT PRIMARY KEY CHECK (provider IN ('telegram','whatsapp')),
  last_update_id INTEGER,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER,
  webhook_verified_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','whatsapp','local')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  external_id TEXT,
  chat_ref TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  command TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','sent','failed','ignored','rejected')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_chat_messages_external ON chat_messages(provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_chat_messages_created ON chat_messages(created_at DESC);

CREATE TABLE chat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','whatsapp','local')),
  provider_ref TEXT NOT NULL,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  reason TEXT,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_chat_actions_token ON chat_actions(token_hash);
CREATE INDEX ix_chat_actions_expiry ON chat_actions(expires_at);
`
  }
]
