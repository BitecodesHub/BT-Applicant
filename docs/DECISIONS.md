# Decisions — BT Applicant

Date: 2026-10-29. Format: context, options, decision, consequences. Decisions marked **Superseded** were changed during implementation; the replacement is linked.

## D1. Electron as the application shell

**Context.** The core is Node-heavy: SQLite, SMTP, HTML parsing, HTTP connectors, scheduled work.

**Options.** Tauri (smaller binary, Rust core, Node sidecar needed); Electron (Node in the main process, mature packaging).

**Decision.** Electron 45 with `electron-vite`.

**Consequences.** One runtime for all domain code; native module risk is avoided by using the built-in `node:sqlite`. The app is large (~324 MB unpacked) and packaging is a separate step. Web-form handoff can reuse an Electron window instead of bundling a second browser.

## D2. SQLite through `node:sqlite`, not `better-sqlite3` + Drizzle

**Context.** The plan named `better-sqlite3` with WAL and Drizzle migrations. Native modules require an ABI rebuild for Electron and add packaging risk.

**Decision.** Use the built-in `node:sqlite` `DatabaseSync`, a thin `Db` wrapper, hand-written SQL migrations, and typed repository functions.

**Consequences.** No native rebuild, no prebuild download, deterministic packaging. The synchronous API is a good fit for a single-user desktop app and makes queue claims atomic. Trade-offs: no ORM type generation, SQL is written by hand, and the Node version must be recent enough (Electron 45 bundles Node 24.22). `PRAGMA user_version` is not used; a `schema_migrations` table is.

**Supersedes.** PLAN.md database and ORM choices.

## D3. A queue on SQLite instead of BullMQ or pg-boss

**Context.** Required semantics: leases, idempotency, bounded retries with jitter, dead-letter, crash recovery, heartbeats. Redis and Postgres are server processes and cannot ship in an offline desktop app.

**Decision.** Implement the queue in SQLite (`tasks`, `schedules`, `worker_heartbeats`) with atomic `BEGIN IMMEDIATE` claims.

**Consequences.** No extra service, no port, inspectable state in the UI. This is custom infrastructure and must be tested; the queue has dedicated unit tests for claim contention, retry/backoff, lease expiry, dead-letter, and idempotency. Single-writer throughput is far above this workload.

## D4. Typed IPC instead of a local HTTP API

**Context.** The original design assumed an HTTP API with sessions and CSRF protection.

**Decision.** Expose one `api:invoke` channel plus narrow system channels through a context bridge. Validate at the boundary with Zod.

**Consequences.** No listening port, no CSRF, no session tokens. The renderer cannot call arbitrary main-process functions. IPC contracts live in `src/shared/api.ts` and are checked at compile time. Testing requires the Electron bridge rather than plain HTTP clients, so the E2E suite launches the real app.

## D5. Eligibility is deterministic and is the only gate

**Context.** AI could read a posting and "decide" eligibility, but it can hallucinate facts and cannot be audited.

**Decision.** All eligibility decisions come from a pure engine over stored facts and cited rules. Job postings contribute only detected sponsorship/right-to-work/citizenship signals with quoted evidence. AI is not consulted in this stage.

**Consequences.** Verdicts are reproducible and testable; the UI can explain every reason. The rules require maintenance and never constitute legal advice. The product deliberately errs toward `needs_review`.

## D6. Model citizenship, residence, and permits separately

**Context.** "Nationality" alone cannot answer whether someone can work in a country. Residence is not authorization; a permit may be expired or tied to an employer.

**Decision.** Store multiple citizenships, country of residence, per-country permit records with status and validity, and sponsorship need. Apply blocs, bilateral routes, and posting restrictions in a defined order.

**Consequences.** The profile is slightly more work to fill in, but eligibility is honest. A user with a valid permit is not blocked by a citizenship-only rule; a user without one is not treated as authorized because they live there.

## D7. Sponsorship detection is conservative and evidence-first

**Context.** Phrase matching can invert meaning ("we do not sponsor" vs "we sponsor"). Guessing is dangerous.

**Decision.** Ordered negative-first patterns, exact quoted evidence, and `unknown` when nothing matches. `unknown` never becomes `eligible`.

**Consequences.** Some genuinely eligible jobs land in `needs_review`, which is acceptable. The user can read the quote and decide. No hidden heuristic score can silently promote a job.

## D8. Email applications require a published address

**Context.** Address pattern guessing causes bounces and can send personal data to the wrong recipient.

**Decision.** Only use an address that appears in the posting, with a stored evidence quote. Otherwise route to a web form or manual action.

**Consequences.** Fewer email applications, but every recipient is defensible. Job-board relay addresses are rejected. The UI shows "Email available" or "No email evidence" per job.

## D9. AI is optional, fail-closed, and never blocks the core

**Context.** Providers go down; keys expire; local models are slow. The product must still discover, evaluate, draft, approve, and deliver.

**Decision.** A narrow `AiService` with a provider chain, per-provider circuit breakers, timeouts, quota tracking, schema validation, and deterministic fallbacks. Modes: `enhanced`, `off`, `simulated_outage`.

**Consequences.** The app is useful with no model installed. AI adds polish, not correctness. `simulated_outage` is a real test path, covered end to end. AI output cannot create an application, change a verdict, or send mail.

## D10. Mock delivery is the default; SMTP is opt-in and kill-switched

**Context.** An accidental real email is irreversible. During the build, outbound had to be hard-blocked.

**Decision.** Ship with `outbound.mode = mock` and `killSwitch = true`. Mock writes `.eml` files locally. SMTP becomes effective only when the mode is SMTP, the kill switch is off, and host/user/from/password are all present. A "verify" action tests login without sending an application.

**Consequences.** A fresh install cannot email anyone. The user must deliberately change three settings. Mock messages are inspectable and testable. SMTP requires an app password; OAuth (Gmail API) is left behind the same interface for a later version.

## D11. Transactional outbox with idempotency keys

**Context.** A crash or timeout during send can cause a duplicate application, which is worse than a missed one.

**Decision.** Create one `outbox_messages` row per `(application, attempt)` before sending, claim it, send, then mark it sent. The application transitions to `submitted` only after a confirmed adapter result. Stale `sending` rows become `uncertain`, not retried.

**Consequences.** Retries are safe and auditable. A duplicate cannot be produced by re-running a task. The user must resolve `uncertain` deliveries manually.

## D12. Human approval by default; guided web forms; no bypass

**Context.** Automated form submission is brittle, often against terms, and CAPTCHAs must not be bypassed.

**Decision.** `requireApproval` defaults to true. Web applications open an isolated, visible Electron window; the user completes and records the submission. The app never solves CAPTCHAs, bypasses logins, or hides automation from a site.

**Consequences.** The product is a careful assistant, not a spam engine. Unattended mode exists but is explicit, capped, and still cannot handle web forms or unresolved facts.

## D13. Secrets in the OS secret store, never in the renderer

**Context.** SMTP passwords and AI API keys are high-value and easy to leak through logs or UI state.

**Decision.** Encrypt with Electron `safeStorage` before writing to SQLite (`secrets` table). Decrypt only inside the main process at call time. Renderer APIs return presence/flags, never values. Logs redact password/token/secret/authorization fields.

**Consequences.** A copied database does not expose secrets without the OS secret store behind it: the macOS Keychain, Windows data protection (DPAPI), or a Linux Secret Service keyring. Moving the database to another machine requires re-entering secrets. Where the OS offers no encryption, `safeStorage.isEncryptionAvailable()` is false and secret storage fails closed rather than writing plaintext.

## D14. Local reads are always fresh

**Context.** The E2E suite exposed a real staleness bug: a cached application detail showed "queued" after the background worker had delivered it, because `staleTime` was 5 seconds and a preview fetch had refreshed the cache.

**Decision.** Set TanStack Query `staleTime: 0`, broadcast `app:data-changed` after worker and IPC mutations, and poll an open application detail every 10 seconds as a fallback.

**Consequences.** Every mount reads the current SQLite state; the cost is negligible for local IPC. The class of "UI shows an old state after a background task" bugs is removed. A 10-second poll still covers an open page when a broadcast is missed.

## D15. HashRouter for a `file://` renderer

**Context.** The production renderer is loaded from disk, not a web server.

**Decision.** React Router `HashRouter`.

**Consequences.** Deep links work without rewrites; the URL is not pretty. IPC and file paths are unaffected.

## D16. Retention defaults are bounded

**Context.** A local database can grow indefinitely with events, AI calls, and old jobs.

**Decision.** Daily maintenance prunes by configurable day counts (events, AI calls, metrics, jobs). Applications, outbox records, and templates are retained. Vacuum is not automatic.

**Consequences.** Predictable disk use and fast diagnostics. The user can raise retention if they need history. Pruning is logged as a maintenance event.

## D17. Unsigned local packaging, documented distribution path

**Context.** Signing and notarisation require an Apple Developer ID and network access to Apple services. The build environment has no credentials.

**Decision.** `electron-builder` packages an unsigned build for the host platform with `identity: null` and hardened runtime off: DMG/ZIP on macOS, NSIS/ZIP on Windows, AppImage/ZIP on Linux. The README and SECURITY.md describe what a distributed build must add.

**Consequences.** The packaged app runs locally and can be inspected. It is not suitable for public distribution as-is; Gatekeeper will warn on other Macs, SmartScreen will flag the unsigned Windows installer, and Linux has no signature to check. This is explicit rather than hidden.

## D18. Resumes are read locally, reviewed, and imported without overwriting

**Context.** Resume data drives role fit, but sending a CV to a cloud model would break the offline promise and make a third party part of the candidate's application. Users also need skills, roles, education, and certificates extracted, not just the file stored.

**Options.** Cloud AI extraction (best tolerance for odd layouts, but online and privacy-eroding); local deterministic extraction only; manual entry only.

**Decision.** Validate and copy the file, extract text locally with `unpdf` (PDF), `fflate` (DOCX), and in-repo RTF/text readers, then parse with a versioned deterministic parser. Identity, contact details, summary, skills, dated roles and bullets, education, certifications, languages, projects, and awards are extracted. Every result is shown in a review dialog before import. Import fills only blank profile fields and merges skills and languages; it never overwrites existing values.

**Consequences.** Resume reading works with no model, no key, and no network. Unusual layouts may be misread; the parser reports confidence, warnings, and section names, and the profile remains editable. Scanned PDFs without a text layer fail with a clear message rather than being silently guessed or sent to OCR. Two small runtime dependencies (`unpdf`, `fflate`) must be present in the packaged ASAR, which the packaging check covers.

## D19. Role selection is separate from recommendations, and recommendations are a decision aid

**Context.** The user asked to choose which roles to apply for and to receive recommendations. Automatically switching targets from a ranking would let an opaque score make a career decision, and it could quietly narrow discovery.

**Decision.** Provide a 20-role catalog with custom titles. Selection (maximum 8) changes discovery title filters and the role-fit scoring component, never eligibility, routing, or approval. Recommendations are a separate read-only ranking over resume, profile, certifications, and already-discovered jobs in enabled target countries. The screen opens with a plain-language disclaimer and shows component scores, evidence, matched and missing skills, and confidence.

**Consequences.** Selected roles are predictable and user-controlled; recommendations are explainable and cannot send or apply to anything. Sparse evidence lowers scores instead of producing confident guesses. The market component only reflects jobs this app has already discovered, not the whole market, and the disclaimer says so. No AI provider participates in either path.

## D20. Chat is an official-API control surface with deterministic commands and one-time codes

**Context.** The product needed Telegram and WhatsApp access so the user can receive updates and issue commands away from the desktop. A chat bot that reuses free-form AI or accepts "approve" in one message would widen the attack surface and could send an application without a deliberate confirmation.

**Decision.** Integrate the official Telegram Bot API and WhatsApp Cloud API only. Telegram uses outbound long polling; WhatsApp uses outbound Graph API calls plus a loopback-only webhook behind a user-managed HTTPS tunnel. Commands are matched deterministically by `ChatCommandRouter` with no model. Only the configured numeric chat ID or phone number is accepted. Approve, reject, and retry create a prepared action and require a separate six-digit, single-use, five-minute code bound to the same channel. Message bodies and codes are not stored; events and short summaries form the audit trail. Chat is off by default and secrets live in the keychain.

**Consequences.** Status, pause/resume, profile fixes, and notifications work with AI off and no public Telegram endpoint. Sensitive actions need two messages and cannot be replayed from another chat. WhatsApp requires a Meta app and a tunnel the user must supply; Telegram is the simpler path. A compromised Telegram bot token can read bot updates, so the token is treated as a high-value secret and redacted from logs and errors. A hostile sender can discover the bot and request a linking code, but cannot execute commands until the user pastes their numeric chat ID into the desktop app.

## D21. Deviation log from PLAN.md

| Plan | Built | Reason |
| --- | --- | --- |
| `better-sqlite3` + Drizzle | `node:sqlite` + hand-written SQL | Avoid native ABI rebuilds and packaging risk |
| TanStack Router | React Router 7 HashRouter | `file://` routing with less setup; no server needed |
| `undici` | built-in `fetch` | Node 24 `fetch` covers timeouts, headers, and abort |
| Separate `FormDriver` abstraction | Electron `BrowserWindow` handoff | One browser, human-confirmed submission, no extra automation surface |
| `db:seed` script in package.json | removed | No seed script was shipped; onboarding and the E2E fixture create real data instead |
| Server-style API | typed IPC | No listener or session surface in a desktop app |
| No chat surface in the original plan | Official Telegram/WhatsApp integration added later | The product needs remote status and approvals without exposing the database or adding a server |

The rest of PLAN.md (queue semantics, eligibility, safety rules, page set) is implemented as written.
