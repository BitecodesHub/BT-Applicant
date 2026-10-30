# Architecture — BT Applicant

Version 0.1.0. Desktop application for macOS, Windows, and Linux; verified running on macOS arm64, with Windows and Linux artifacts built by the same configuration. No server, no cloud database, no background daemon.

## 1. System at a glance

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Electron main process (Node 24.22, Electron 45.1)                          │
│                                                                            │
│  AppContainer                                                              │
│   ├─ Db (node:sqlite, WAL) ── 32 tables, hand-written migrations           │
│   ├─ PipelineService ── normalize → dedupe → evaluate → score → route      │
│   ├─ ApplicationService ── draft → approve → outbox → deliver → submitted  │
│   ├─ MailService ── mock (.eml) or SMTP (nodemailer), kill switch          │
│   ├─ AiService ── Ollama / Anthropic / OpenAI / Gemini / compatible        │
│   ├─ ChatService ── Telegram long poll + WhatsApp loopback webhook         │
│   ├─ WorkerService ── leased task slots, retries, reaper                   │
│   ├─ SchedulerService ── cron rows → idempotent queue tasks                │
│   └─ ReportingService ── daily metrics, digest, event history              │
│                                                                            │
│  IPC router (one typed channel + validated payloads)                       │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ contextBridge (preload)
┌───────────────────────────────┴────────────────────────────────────────────┐
│ Renderer (sandboxed, contextIsolation, no Node)                            │
│  React 19 · React Router 7 (HashRouter) · TanStack Query/Table · Radix     │
│  20 pages, one design system, local timezone, light and dark themes        │
└────────────────────────────────────────────────────────────────────────────┘
```

The renderer never opens the database. It calls a single IPC channel, `api:invoke`, with a channel name and payload. The main process validates both with Zod, executes the operation, and returns a typed result. Filesystem, keychain, external links, and the guided web window use separate system channels.

Why this shape:

- one process owns SQLite, so queue claims are atomic without a database server;
- the renderer has no Node access, so a cross-site scripting bug cannot read files or secrets;
- typed IPC gives the UI the same contracts as an HTTP API without a network listener.

## 2. Process and trust boundaries

| Boundary | Control |
| --- | --- |
| Renderer → main | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; only the functions in `src/preload/index.ts` are exposed |
| Web content → app | external links open in the OS browser; employer forms open in a separate sandboxed `BrowserWindow` with a persistent partition |
| Main → network | explicit connector endpoints; user-supplied URLs only in the JSON-LD connector |
| Secrets | Electron `safeStorage` (macOS Keychain, Windows DPAPI, or the Linux Secret Service keyring) encrypts before SQLite; never sent to the renderer |
| Renderer → user data | responses are typed DTOs, no raw database rows and no secrets |

Content Security Policy is applied in production (`default-src 'self'`, no remote scripts, no frames). Development adds the Vite websocket and eval allowances.

## 3. Module map

```
src/
  main/
    index.ts            app lifecycle, window, notifications, CSP, IPC registration
    ipc.ts              channel handlers, input validation, data-changed broadcasts
    core/               logger, secrets, settings, cron, time, hashing, JSON, text
    db/                 DatabaseSync wrapper, migrations, typed repositories
    connectors/         14 source adapters + HTTP helper + registry
    pipeline/           normalization, location, salary, skills, dedupe, email
                        extraction, scoring, routing, targeting
    eligibility/        rules data, signal detection, deterministic engine
    resume/             local text extraction (PDF, DOCX, RTF, text) and parser
    services/           container, pipeline, applications, mail, AI, worker,
                        scheduler, reporting, resume, roles, chat
  preload/index.ts      contextBridge surface
  renderer/src/
    pages/              20 route components
    components/         app shell, UI primitives, dialogs, onboarding
    lib/                API client, formatting, hooks
    styles.css          design tokens, light/dark themes, layout
  shared/               DTOs, settings types, channel map, labels
data/
  work-authorization-rules.json
e2e/                    Playwright Electron suite and fixture
scripts/                source verification
build/                  icon assets for packaging
```

## 4. Data model

SQLite file: `<userData>/bt-applicant.db` (WAL, foreign keys on, 5s busy timeout). Schema version is tracked in `schema_migrations`; migrations are ordered and applied in a transaction at startup.

| Group | Tables |
| --- | --- |
| Identity and targets | `profile`, `work_authorizations`, `country_answers`, `resumes`, `resume_extractions`, `role_selections`, `target_countries` |
| Discovery | `sources`, `source_fetches`, `jobs`, `job_evaluations`, `job_duplicates` |
| Applications | `applications`, `web_runs`, `responses`, `templates`, `template_versions` |
| Delivery | `outbox_messages`, `outbox_attempts` |
| Automation | `tasks`, `schedules`, `worker_heartbeats` |
| Reporting | `events`, `daily_metrics`, `digests` |
| AI | `ai_calls`, `ai_provider_state` |
| Chat | `chat_actions`, `chat_messages`, `chat_state` |
| Platform | `settings`, `secrets` |

Design notes:

- Jobs store the raw payload plus normalized fields, so a source change can be re-normalized without refetching.
- `resume_extractions` stores the full extracted text plus the parsed structured result, the parser version, confidence, warnings, and section names. Re-reading a file replaces the cached row; the original resume file is untouched.
- `role_selections` stores catalog keys and custom titles (maximum 8 effective titles). The profile fingerprint includes the effective titles, so changing roles marks stored job evaluations stale.
- `job_evaluations` is keyed by job and profile hash; changing the profile, work authorization, or selected roles marks evaluations stale and re-evaluates active jobs.
- Applications carry channel, recipient, evidence, attempt counter, confirmation, and timestamps. A single active application per job is enforced in application code and indexed lookup.
- Outbox rows are unique per `(application_id, attempt)`; attempts are logged separately with adapter response and duration.
- Events are append-only and drive the Activity page, diagnostics, and per-application timeline.
- `chat_messages` stores direction, provider, a short summary, command name, status, and error. Message bodies and confirmation codes are not stored. `chat_state` holds each provider's update/event cursor and last success or error; `chat_actions` holds hashed one-time codes bound to a provider and chat reference.

## 5. Discovery pipeline

```
source.poll
  → fetch (rate-limited, timeout, bounded retries)
  → normalize (HTML → text, salary, location, remote/hybrid)
  → dedupe (canonical URL, source job id, content fingerprint)
  → target filter (country, target titles plus selected roles, arrangement, salary floor)
  → eligibility (deterministic; profile hash)
  → score (skills, title fit, salary, recency, sponsorship confidence)
  → route (email with evidence / web form / ineligible / needs review)
  → draft application for eligible, routable jobs
```

Verdicts:

| Verdict | Meaning |
| --- | --- |
| `eligible` | Authorized now, no sponsorship needed |
| `eligible_needs_sponsorship_offered` | Not authorized now, but the posting offers sponsorship and a route applies |
| `needs_review` | Missing or conflicting evidence; never auto-sent |
| `ineligible` | Explicitly blocked: no authorization and no sponsorship, citizenship/clearance restriction, or missing right to work |
| `duplicate` / `closed` | Job lifecycle states, separate from eligibility |

Eligibility is pure and unit-tested against citizenship, permit, bloc, bilateral, and posting-signal cases. AI is not called in this stage.

Scoring is deterministic and explainable: each component contributes points and a reason string. Selected roles contribute their catalog title aliases to the role-fit component; they never change eligibility. The score is a sorting aid, not an eligibility decision.

Routing decides how an application can be delivered:

- **email** only when the posting quotes a recipient address;
- **web** when the employer uses a form (the app prepares a guided window and never submits it);
- **manual** when no safe channel exists.

## 6. Application lifecycle

```
draft → awaiting_approval → approved → queued → sending → submitted
                                   ↘ needs_human (web form or missing fact)
                                   ↘ failed → retry
                                   ↘ uncertain (delivery unknown)
                                   ↘ rejected / withdrawn
```

- Default settings require human approval before delivery.
- Unattended mode is off by default; when enabled it still respects daily caps, per-company caps, eligibility, and the kill switch.
- The worker claims a task with a lease, creates one outbox row per attempt, and calls the adapter.
- Mock mode writes a `.eml` file and completes immediately. SMTP mode uses nodemailer with the stored app password.
- A send that cannot be confirmed becomes `uncertain`; it is never retried automatically.
- Web applications become `web_runs`: the guided window opens the employer form; the user completes it and records the submission with a note/reference.

## 7. Queue and scheduler

Queue table semantics:

- atomic claim with `BEGIN IMMEDIATE`, status `pending → running`, attempt increment, lease owner and expiry;
- bounded retries with exponential backoff plus ±25% jitter, default 5 attempts;
- dead-letter status after exhaustion;
- a reaper every 5 minutes requeues expired leases under the attempt limit and dead-letters the rest;
- startup recovery requeues tasks left running by a crash;
- idempotency keys on schedules and dispatch prevent duplicate work.

Schedules:

| Key | Cron | Purpose |
| --- | --- | --- |
| `metrics.rollup` | hourly at :07 | Write the hourly snapshot used by charts |
| `application.reconcile` | every 10 minutes | Requeue stale queued work; mark stale sends uncertain |
| `maintenance.reaper` | every 5 minutes | Lease recovery |
| `maintenance.retention` | daily 03:20 | Prune events, AI calls, metrics, and old jobs by retention settings |
| `digest.generate` | user-selected local time | Daily report and OS notification |
| `target:<id>:poll` | per target | Discovery for one country |

The scheduler materialises rows at startup and every 10 seconds. A schedule fires at most once per `next_run_at`. Missed runs are caught up on next launch, not backfilled repeatedly. Nothing runs while the app is closed.

## 8. AI layer

`AiService` exposes narrow tasks (draft rewriting, posting summarisation, extraction assistance) behind one interface. Providers: local Ollama, Anthropic, OpenAI, Google Gemini, and any OpenAI-compatible endpoint.

- Chain order is user-configurable; unconfigured providers are skipped.
- Per-provider circuit state is stored in `ai_provider_state`: consecutive failures open the circuit, a cooldown closes it again.
- Each call has a timeout and is recorded in `ai_calls` with latency, token counts where available, and outcome.
- Responses are validated against a Zod schema; invalid output is a failure, not a partial success.
- Every AI failure returns a deterministic fallback. Discovery, eligibility, drafting, approval, and delivery never require a model.
- `off` mode disables AI entirely. `simulated_outage` makes every provider fail so the fallback path can be tested in the UI and E2E suite.

## 9. Resumes and role targeting

Resume handling is fully local:

```
choose file → validate type/size → SHA-256 → copy into <userData>/resumes
  → extract text (PDF, DOCX, RTF, TXT, Markdown)
  → deterministic parser (sections, dates, contact, skills, education, certificates)
  → store text + structured result in resume_extractions
  → review in the UI → explicit import → re-evaluate jobs
```

- PDF text comes from `unpdf` (pdf.js, no rendering); DOCX is unzipped with `fflate` and read from `word/document.xml`; RTF and plain text use in-repo converters. Legacy `.doc`, password-protected, empty, and oversized files are rejected with a readable message.
- The parser is versioned and deterministic: section-heading aliases, date ranges, role/company/location splitting, degree and institution detection, certification issuer/year handling, language levels, projects with technologies, awards, a skill lexicon, confidence, and warnings. It makes no AI call and no network request.
- The review step is mandatory by product design: import only fills profile fields that are blank and merges skills and languages. It never overwrites a value the user typed, and it reports both imported and kept fields.
- Resumes are capped at 10 MB, extraction at 300,000 characters and 25 seconds. A failed extraction leaves the stored file and metadata intact so it can be retried.
- Files are never uploaded. Extracted text lives in SQLite next to the rest of the local data; the Security document covers the threat model.

Role targeting:

- A built-in catalog of 20 role families supplies canonical titles, aliases, expected years, core skills, and relevant certifications. Users select up to 8 roles and may add custom titles.
- The effective title list is merged into country target titles for discovery and into the deterministic role-fit component for scoring. It does not touch eligibility, sponsorship, routing, or approval.
- The profile fingerprint includes the effective titles, so changing roles invalidates and re-runs stored evaluations.
- Recommendations score each catalog role from resume evidence (40), experience (25), certifications (10), and market evidence (25). Market evidence counts active discovered jobs from the last 120 days in enabled target countries and their evaluation verdicts.
- Every recommendation shows its component scores, evidence lines, matched and missing skills, certifications, and market countries. Missing evidence lowers the score and confidence. The screen opens with a plain-language disclaimer, and no AI provider participates.

## 10. Delivery and outbound safety

`MailService` chooses an effective mode at call time:

1. kill switch on → mock;
2. outbound mode `mock` → mock;
3. SMTP incomplete → mock;
4. otherwise → SMTP.

Mock mode writes RFC 5322 `.eml` files under the app's mock outbox directory (`<userData>/mock-outbox`), including attachments. It never opens a socket.

SMTP uses nodemailer with the app password decrypted from the OS secret store at send time. The app verifies SMTP login on request and reports the result; verification does not send an application.

Defaults are `mode: mock`, `killSwitch: true`. Turning both off is an explicit, documented action in Automation & outbound. Daily and per-company limits apply before the outbox row is created.

## 11. Chat interface

Chat is an optional control and notification surface over the same local database. It is off by default; enabling it does not create a second automation engine, a server, or an AI dependency.

```
Telegram Bot API  ── long polling (outbound HTTPS) ──┐
                                                     ├─ ChatService ── ChatCommandRouter ── ApplicationService/profile
WhatsApp Cloud API ── outbound HTTPS ────────────────┤        │
Meta webhook ── HTTPS tunnel → 127.0.0.1:4780 ───────┘        └─ chat_state / chat_messages / events
```

- **Telegram** uses `getMe`, `getChat`, `getUpdates`, and `sendMessage` against `api.telegram.org`. Long polling means there is no public inbound port. The update offset is stored, so a restart continues from the last acknowledged update instead of replaying the backlog.
- **WhatsApp** uses `GET /{phone-number-id}` and `POST /{phone-number-id}/messages` against `graph.facebook.com`. Inbound messages arrive at a loopback-only HTTP server. Meta requires a public HTTPS address, so the user publishes the loopback endpoint through a trusted tunnel; the app does not create or operate the tunnel. GET verification compares the configured verify token, and every POST must carry a valid `X-Hub-Signature-256` HMAC over the raw body.
- **Identity allowlist.** Only the configured numeric Telegram chat ID or normalized WhatsApp phone number can issue commands. Messages from anyone else are logged and ignored. Telegram numeric IDs are required because the Bot API reports numeric chat IDs; the linking flow replies with the number.
- **Commands are deterministic.** `ChatCommandRouter` matches status, report, approvals, applications, jobs, missing, approve, reject, retry, confirm, set, scan, pause, resume, and help. The same message always produces the same result; no model is consulted.
- **Sensitive actions are two-step.** Approve, reject, and retry first create a `chat_actions` row and return a random six-digit code. The database stores only a SHA-256 hash, bound to the provider and chat reference. A code expires after five minutes, is consumed on first use, and cannot be confirmed from another channel. Execution still goes through `ApplicationService`, so caps, approval state, and delivery safeguards apply.
- **Notifications** are generated from the append-only event log with per-provider cursors, at most eight per scan and ten per minute. Event categories are filtered by the notification settings. A failed delivery does not advance the cursor, so the event is retried rather than lost. Enabling chat later starts at the current event ID instead of replaying history.
- **Limits and audit.** Inbound commands are limited to 20 per minute per channel; setup replies are not commands and cannot change state. Each inbound and outbound message is recorded as a short summary with status; full bodies and confirmation codes are never written. Events record rejected senders, prepared actions, confirmations, failures, and provider lifecycle changes.
- **Failure behaviour.** Telegram polling uses bounded exponential backoff and stops on unauthorized/conflict errors. The WhatsApp server reports bind failures and rejects unreadable or oversized bodies. Outbound requests have timeouts plus the application lifecycle signal, so shutdown cancels them. Chat failures never block discovery, approval, or delivery.

## 12. Rendering and UI

- React Router with `HashRouter` because the production build loads from `file://`; hash routing avoids server rewrites.
- TanStack Query caches local IPC reads. `staleTime` is 0 so a mount always reflects the database; a data-changed broadcast invalidates all queries after worker and IPC mutations.
- TanStack Table powers the job and application grids; filters are local and instant.
- Radix primitives provide accessible dialogs, selects, switches, tabs, and tooltips.
- Design tokens in `styles.css` define light and dark themes; the app follows the OS appearance. The layout is a fixed sidebar, a top status bar, and a scrollable content area.
- 20 pages: Dashboard, Daily report, Jobs, Job detail, Applications, Application detail, Approvals, Sources, Targets, Roles, Profile, Work authorization, Resumes, Templates, AI providers, Automation & outbound, Chat, Queue, Activity, Diagnostics.
- A ⌘K / Ctrl+K palette searches every page and runs quick actions (pause or resume autopilot, queue a scan, refresh data, open chat settings). Arrow keys and Enter work without leaving the search field.
- All counts are computed from stored rows and labelled with their time window. No placeholder numbers.

## 13. Packaging

`electron-vite` produces three bundles under `out/`: main, preload, renderer. `electron-builder` packages `out/` plus production dependencies into an ASAR, with per-platform icons (`build/icon.icns`, `build/icon.ico`, `build/icon.png`) and the platform's own executable name (`BT Applicant` on macOS, `bt-applicant.exe` on Windows, `bt-applicant` on Linux).

- `npm run package` → unsigned unpacked app for the machine you build on, in `release/`.
- `npm run dist` → that platform's artifacts: DMG + ZIP on macOS, NSIS installer + ZIP on Windows, AppImage + ZIP on Linux.
- `npm run dist:mac`, `dist:win`, `dist:linux` → build one platform from another. From this macOS host all three targets were produced; electron-builder needs macOS for the macOS target, so Windows and Linux hosts build only their own.
- Signing identity is explicitly `null` and the hardened runtime is off for the local build. A distributed macOS build needs a Developer ID plus notarisation, Windows needs Authenticode, Linux needs a signed repository or Flatpak; see [SECURITY.md](./SECURITY.md#13-packaging-and-distribution).
- The app writes only to its Electron user-data directory (`~/Library/Application Support/BT Applicant`, `%APPDATA%\BT Applicant`, or `~/.config/BT Applicant`): database, logs, uploaded resumes, mock outbox, exports.
- Platform branches in code: `titleBarStyle` and `trafficLightPosition` apply only on macOS, `app.setAppUserModelId` only on Windows (taskbar grouping and toast attribution), the window keeps the native title bar elsewhere, `⌘K` becomes `Ctrl+K`, and secret-store copy names the store the OS actually uses. Minimum window size is 980x640, relaxed from 1120x760 so the window is not taller than a 768p laptop screen; the rendering at that size has not been reviewed visually on any platform.

## 14. Deliberate limits

- One user, one machine, one writer. SQLite is not a shared database.
- No background service: automation pauses when the app quits or the machine sleeps.
- No CAPTCHA solving, no login automation, no bypass of site protections.
- No scraping of sites that forbid it; connectors use documented public endpoints.
- AI is an overlay, never a source of truth for eligibility or facts.
- Web applications are always human-confirmed.
- Chat requires the app to be running. Telegram works without an inbound port; WhatsApp requires the user to operate an HTTPS tunnel to the loopback webhook.

## 15. Related documents

- [RESEARCH.md](./RESEARCH.md) — evidence and sources
- [DECISIONS.md](./DECISIONS.md) — decisions and trade-offs
- [RELIABILITY.md](./RELIABILITY.md) — queue, recovery, and failure handling
- [SECURITY.md](./SECURITY.md) — threat model and controls
- [TEST-REPORT.md](./TEST-REPORT.md) — verification results and screenshots
