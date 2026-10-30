# Implementation Plan — BT-Applicant

Autonomous job discovery and application platform. Offline desktop application.

> Historical document. This is the approved build plan, kept for context. What shipped, including the database, router, and HTTP choices that changed during implementation, is described in [ARCHITECTURE.md](./ARCHITECTURE.md) and [DECISIONS.md](./DECISIONS.md). Do not use the stack table below as a description of the current code.

Date: 2026-10-28.

---

## Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| Delivery | Desktop only, fully offline | No server, no hosting cost, no candidate data leaves the machine. Automation runs only while the machine is awake. |
| Email sending | SMTP with app password, plus mock adapter | Works for one user immediately. No Google app-verification process. Gmail API OAuth can be added behind the same interface later. |
| AI providers | All of them, behind one abstraction: local Ollama, Anthropic, OpenAI, Google Gemini, and a generic OpenAI-compatible adapter | Failover chain across providers. Every provider can be down and the product still works. |
| Outbound during build | Hard blocked. Mock provider only | A real email cannot reach a real employer until the kill switch is explicitly flipped after testing. |
| Nationality | First-class profile field driving a sponsorship and eligibility engine | Jobs the user is not legally eligible for never reach the outbox. |

---

## 1. What "offline desktop" forces us to change

The original brief assumed a server architecture with Postgres, Redis, and an always-on worker. None of that can ship inside an offline desktop app without bundling a database server. The replacements:

| Server design | Offline desktop replacement | Why |
|---|---|---|
| Postgres | SQLite in WAL mode via `better-sqlite3` | Embedded, zero-install, transactional, fast enough for one user. Schema kept Postgres-portable in case a server mode is ever added. |
| BullMQ / Redis or pg-boss | Durable queue implemented on SQLite tables (~300 lines) | Both alternatives need a server process. The spec's required semantics (leases, idempotency keys, bounded retries with jitter, dead-letter queue, heartbeats) are straightforward on a single-writer SQLite file. This is a deliberate, documented exception to "do not build custom infrastructure". |
| HTTP API + CSRF + session auth | Typed RPC over Electron IPC | There is no network listener, so there is no CSRF surface, no open port, and no session hijacking surface. Auth becomes OS-level plus an optional app lock. |
| Secrets in env vars or a vault | OS keychain via Electron `safeStorage`, then AES-256-GCM field encryption in SQLite | macOS Keychain-backed. No master password to manage, no secret in a dotfile. |
| Hosted cron | In-process scheduler with missed-run catch-up on wake | Honest framing: schedules resume and catch up when the machine wakes; they do not run while it sleeps. |

### Honesty requirement carried into the UI

A desktop-only build cannot claim 24/7 operation. The status bar and System Health page must state plainly: automation runs while the app is running, pauses on sleep or quit, and catches up on next launch. Documented in `docs/RELIABILITY.md`, not buried.

---

## 2. Stack

**Shell:** Electron. Chosen over Tauri because the entire core is Node-heavy — SMTP, HTML parsing, SQLite, HTTP connectors. Tauri's Rust core would require shipping a Node sidecar anyway, losing the size advantage and adding a process boundary.

**One extra benefit of Electron:** web-form applications are driven by a hidden Electron `BrowserWindow` rather than a bundled Playwright browser. No second browser download, and when an application needs a human (CAPTCHA, MFA, an unusual question) the window is simply made visible and the user finishes it themselves. That is a better answer to the "manual action required" requirement than aborting.

| Layer | Choice | Reason |
|---|---|---|
| Shell | Electron + `electron-vite` + `electron-builder` | Node runtime in main process; mature packaging for macOS arm64. |
| UI | React 19 + TypeScript + Tailwind v4 + Radix primitives | Radix is headless and accessible; styling stays original rather than templated. |
| Routing / data / tables | TanStack Router, TanStack Query over IPC, TanStack Table | Needed for the filterable job and application grids. |
| Database | SQLite (`better-sqlite3`, WAL) + Drizzle ORM + `drizzle-kit` migrations | Real SQL migrations, typed queries, transactions. |
| Queue + scheduler | Custom, on SQLite. `cron-parser` for recurrence | See table above. |
| HTTP | `undici` with per-source rate limiting and timeouts | Built-in, no heavy dependency. |
| Parsing | `cheerio` for HTML, native JSON, JSON-LD `JobPosting` extractor | Deterministic, no AI needed. |
| Email | `nodemailer` behind a `MailAdapter` interface. Adapters: SMTP, mock sink, (later) Gmail API | Mock is the default and the only one enabled during the build. |
| Web automation | Electron `BrowserWindow` driver behind a `FormDriver` interface | No extra browser; visible human handoff. |
| AI | Thin custom `AiProvider` interface + adapters for Ollama, Anthropic, OpenAI, Gemini, OpenAI-compatible | A thin interface beats a framework here because the requirement is failover and circuit breaking, not framework features. Every response is validated against a Zod schema or discarded. |
| Validation | Zod at every boundary: IPC, connector output, AI output, file upload | Single source of truth for types. |
| Secrets | Electron `safeStorage` (OS keychain) + AES-256-GCM | Never crosses into the renderer. |
| Tests | Vitest (unit, integration) + Playwright `_electron` (end-to-end) | Playwright has first-class Electron support. |
| Logging | `pino` to a rotating local file, with a redaction list | Personal data and credentials are redacted by field name, enforced by a test. |

**Verification debt:** the connector endpoints in section 4 are from documentation knowledge, not yet tested. Phase 1 tests every one with a real request and records live or dead status with the date in `docs/RESEARCH.md`. No connector is listed as working in the UI until it has returned real data.

---

## 3. Nationality, work authorization, and sponsorship engine

This is the new requirement and it gates everything downstream. It is a standalone, testable module — nothing else may decide eligibility.

### Candidate side

```
citizenships[]            ISO-3166 codes. Multiple supported (dual nationality).
residence_country         Where the user currently lives.
work_authorizations[]     Per country or bloc:
                            status: citizen | permanent_resident | work_permit
                                  | student_permit | dependent_permit | none
                            permit_type, valid_from, valid_until
                            needs_sponsorship: boolean
                            evidence_note (user-entered, never inferred)
country_answers[]         Verified answers to recurring application questions.
```

### Rules data, not hardcoded logic

`data/work-authorization-rules.json` holds blocs and bilateral routes, each entry carrying `effect`, `confidence`, `source_url`, and `last_verified`:

- Freedom-of-movement blocs: EU/EEA plus Switzerland, UK–Ireland Common Travel Area, Nordic Convention, Trans-Tasman (AU/NZ), Mercosur residence agreement, GCC, CARICOM.
- Bilateral routes: US TN (Canada, Mexico), US E-3 (Australia), US H-1B (sponsorship required, lottery), UK Skilled Worker (licensed sponsor required), Germany EU Blue Card, Canada CUSMA, Japan/Korea specified skilled worker categories.

Keeping this as data means rules can be corrected without a code change, and every verdict can cite its rule and source.

### Job side — deterministic sponsorship signal extraction

A phrase matcher classifies each posting into one of five states and **records the quoted sentence plus character offsets as provenance**:

| Signal | Example trigger |
|---|---|
| `sponsorship_offered` | "visa sponsorship available", "we sponsor" |
| `sponsorship_explicitly_not_offered` | "we are unable to sponsor", "no sponsorship" |
| `existing_right_to_work_required` | "must have the right to work in", "no visa support" |
| `citizenship_or_clearance_required` | "US citizens only", "security clearance required" |
| `unstated` | no match |

AI may refine this when available, but only as an overlay on top of the deterministic result, and only if its output validates.

### Verdict matrix

Candidate authorization for the job's country, crossed with the job's sponsorship signal, yields exactly one of:

- `eligible` — authorized, no sponsorship needed.
- `eligible_needs_sponsorship_offered` — not authorized, but the employer states it sponsors.
- `ineligible` — authorized status missing and the employer explicitly excludes it. Never applied to. Reason shown.
- `needs_review` — anything unknown or contradictory.

Hard rules enforced in code and in tests:

1. `unstated` + no authorization never resolves to `eligible`. Unknown is never optimistic.
2. The engine never invents, upgrades, or assumes work authorization, citizenship, or clearance.
3. Application form questions about sponsorship or right to work are answered **only** from stored profile data. No stored answer means the application pauses for human input.
4. Only `eligible` and `eligible_needs_sponsorship_offered` can reach the outbox.

---

## 4. Source connector layer

One interface, many connectors. Each declares its id, supported countries, auth needs, documented rate limit, and whether it can yield a verified application email.

**Tier 1 — ATS public job boards** (employers publish these deliberately; no auth, no scraping):
Greenhouse, Lever, Ashby, SmartRecruiters, Workable. Highest-quality structured data, reliable application URLs.

**Tier 2 — aggregator APIs:** Adzuna (needs a free key, broad country coverage), USAJOBS, Arbeitnow, Remotive, RemoteOK, Himalayas, Jobicy, The Muse.

**Tier 3 — generic career page connector:** extracts schema.org `JobPosting` JSON-LD. This is structured data published for exactly this purpose.

Rules applied across all of them: per-source rate limit and timeout, bounded retry, health tracking, pagination, incremental fetch by cursor or date, and a provenance record linking every extracted field back to its source document. No CAPTCHA bypass, no authentication bypass, no anti-bot evasion. A source that needs a human is reported as such and skipped.

**Application email policy:** an email is a valid application target only when the source or posting text explicitly publishes it as the application destination. A guessed address, a generic `info@`, or a pattern-derived address is never a send target. This is enforced in the router and covered by tests.

---

## 5. Pipeline

Twelve task types, each idempotent, each with a deterministic implementation and an optional AI overlay:

```
source.poll → job.normalize → job.dedupe → job.enrich(AI optional)
  → job.score → job.eligibility → application.route
  → application.draft → application.approve → outbox.send | web.submit
  → application.reconcile
```

- **Dedupe:** canonical URL, then source id, then token-set similarity on title plus company plus location. Handles reposts, expiries, and materially changed listings.
- **Routing:** email, web, or manual — with the evidence for the choice recorded. Uncertainty routes to manual, never to a guess.
- **Outbox:** transactional outbox with an attempt log. A crash between send and record is resolved by reconciliation, not a blind retry, so a duplicate email cannot be sent.
- **Duplicate protection:** unique idempotency key per (job, application attempt). A second application to the same job requires a deliberate, logged reapplication.

### AI is an overlay, never a dependency

Enforced structurally: every stage's deterministic path is the real implementation. AI output must pass Zod validation or it is dropped. Each provider gets a timeout, a bounded retry, a circuit breaker, and a position in the failover chain. A `Simulate AI outage` control forces every adapter to fail so the fallback is observable, and an `AI-free mode` disables the layer entirely.

The acceptance test for this: with every provider disabled, a complete workflow must run from discovery through to a mock-dispatched email, with no AI call attempted.

---

## 6. Pages

All 18 from the brief, each with real data, loading, empty, and error states: Overview dashboard, Onboarding wizard, Country and search management, Job discovery, Job details, Application center, Application detail and preview, Email outbox, Web application workflow, Automation control center, Activity timeline, Source management, Resume and candidate profile, Message and template library, Integrations, System health and diagnostics, Settings and privacy, Preview and test workspace.

Desktop-specific additions: a tray icon showing live status, a launch-on-login option, and a global emergency stop reachable from the tray.

Design is reviewed against the installed `apple-design-skill` (Apple Human Interface Guidelines) each time a page group is finished — applying the principles, not imitating the branding. Every control must work; no decorative buttons.

---

## 7. Security model for a desktop build

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a narrow preload bridge. Locked CSP. No remote content in app windows.
- Credentials and API keys live only in the main process, encrypted through the OS keychain. The renderer receives masked values and test results, never the secret.
- Every IPC call validated with Zod on the main side. The renderer is treated as untrusted.
- Resume uploads validated by magic bytes and size, stored outside the web-accessible path, scanned for macro content in Office formats.
- Log redaction enforced by an automated test that fails if a credential or personal field can reach a log file.
- Data export and hard delete, with retention cleanup. An app-lock option for the whole database.
- Dependency audit in CI with a documented review step.

---

## 8. Build phases

Each phase ends with something runnable, and work continues from the repository state.

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0. Scaffold** | Electron + Vite + React + Tailwind, typed IPC, SQLite, Drizzle migrations, logging, app shell with navigation | App launches, navigates, writes to the database |
| **1. Source research and verification** | Live test of every connector endpoint; `docs/RESEARCH.md` with verified/dead status and dates; decision matrices in `docs/DECISIONS.md` | Each connector marked verified or dropped, with evidence |
| **2. Core engine** | Durable queue, scheduler with catch-up, worker host, heartbeats, retries with jitter, dead-letter queue, graceful shutdown | Queue survives a forced kill mid-task; no duplicate execution |
| **3. Discovery** | Connectors, normalization, dedupe, provenance, freshness and closure detection, source health | Real jobs from at least three verified sources, deduplicated |
| **4. Eligibility and routing** | Nationality and sponsorship engine, rules data, signal extractor, scoring, channel decision engine | Full verdict matrix covered by unit tests |
| **5. Application pipeline** | Template library, resume selection, draft preview, approval gate, transactional outbox, mock dispatch, reconciliation, Electron form driver with human handoff | End-to-end from country selection to mock-sent application |
| **6. AI layer** | Provider registry, five adapters, circuit breakers, failover chain, health reporting, outage simulation, AI-free mode | Acceptance test passes with all providers disabled |
| **7. Full UI** | All 18 pages wired to real state, plus tray, design review pass, accessibility and responsive pass | Every page reviewed against screenshots; every control functional |
| **8. Testing and handover** | Vitest suites, Playwright Electron end-to-end, fault injection (AI down, SMTP down, source down, crash mid-send), `docs/PREVIEW.md`, `docs/SECURITY.md`, `docs/RELIABILITY.md`, packaged macOS build, honest test report | Failure scenarios demonstrated; limitations listed explicitly |

---

## 9. Things this plan will not claim

- Not 24/7. Offline desktop automation runs while the machine is awake.
- No connector is called working until it has returned real data, with the date recorded.
- No email reaches a real employer during the build. The kill switch blocks it at the adapter layer.
- Gmail API OAuth is designed for but not delivered; SMTP app password is the working path.
- Code signing and notarization for distribution need an Apple Developer certificate. A local unsigned or ad-hoc-signed build works for personal use.
- The work-authorization rules are a decision aid with cited sources, not legal advice. Every verdict shows its rule so it can be checked.

---

## 10. Open items to confirm before Phase 5

1. Target countries for the first real discovery run, so Phase 1 verification prioritizes the right connectors.
2. Whether the resume should be parsed into structured profile fields automatically, or entered by hand and only attached as a file.
3. Daily application cap and the minimum suitability score for unattended sending, once the pipeline is observable.
