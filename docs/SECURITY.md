# Security — BT Applicant

Scope: a single-user desktop app that stores a candidate's personal data, talks to public job sources, and can send email. This document describes the threat model, the controls that exist in the code, and the risks that remain.

## 1. Assets

- Candidate identity: name, email, phone, city, links, summary, citizenship, residence, work permits, answers to country questions.
- Resume files, extracted resume text, and application drafts.
- SMTP app password, AI API keys, Telegram bot token, WhatsApp access token, verify token, and app secret.
- Chat allowlist identifiers (Telegram chat ID or WhatsApp phone number) and one-time action codes.
- Application history, recruiter addresses, and confirmation records.
- The integrity of outbound email: a wrong or duplicate send cannot be undone.

## 2. Threat model

| Threat | Actor | Impact | Primary controls |
| --- | --- | --- | --- |
| Another local user or malware reads app data | Local | Personal data exposure | OS user isolation, keychain-encrypted secrets, no network listener, FileVault recommended |
| Stolen laptop | Physical | Data exposure | OS login and disk encryption; app has no separate lock |
| Malicious or compromised job posting | Remote | SSRF, resource exhaustion, prompt injection | URL guard, response size cap, timeouts, HTML parsed as text, AI output validated |
| Phishing or hostile career page | Remote | Credential theft, malware | Guided window is sandboxed with Node disabled; external links open in the OS browser; app never asks for employer credentials |
| Malicious or malformed resume file | Local file | Parser crash, memory exhaustion, code execution | Extension and 10 MB size check, text-only readers, 300,000-character cap, 25-second timeout, no macro or script execution, no rendering, errors contained |
| Accidental real send | Local user | Irreversible application, reputational harm | Mock default, kill switch, explicit approval, caps, SMTP verification step |
| Duplicate send after retry | Logic | Employer sees two applications | Outbox uniqueness, idempotency keys, no automatic retry of uncertain sends |
| Cross-site scripting in the renderer | Local/remote content | Data theft, arbitrary IPC calls | React escaping, CSP with no remote scripts, context isolation, validated IPC, no Node |
| Secret leakage in logs | Local | Credential theft | pino redaction paths; secrets never logged by handlers |
| Forged or replayed chat message | Remote | Unauthorized approval, data disclosure | Numeric allowlist, WhatsApp HMAC + verify token, Telegram long polling with no public inbound port, message-ID dedupe, two-step codes |
| Chat bot token theft | Remote/local | Bot impersonation, message access | Keychain encryption, token redaction, no token in renderer, revoke in @BotFather |
| Sensitive action from a stolen phone | Remote | Wrong application approved or rejected | Six-digit single-use code shown only in the requesting chat, five-minute expiry, channel binding, audit events |
| Chat notification data egress | Remote | Personal data leaves machine | Chat off by default; event summaries only; no bodies, resumes, or codes; user-controlled channel |
| Webhook exposed beyond loopback | Network | Unauthenticated command injection | Bind 127.0.0.1 only; user-managed TLS tunnel; GET verify token; HMAC on every POST; 1 MB cap; timeouts |
| Supply-chain compromise | Package ecosystem | Code execution | Small dependency set, lockfile, no postinstall scripts in the app runtime |
| Unsigned build tampering | Distribution | Malware bundle | Distribution requires signing and notarisation; see section 13 |

Non-goals: defending against a compromised OS account with debugger access, a malicious kernel, or an attacker who can read the Keychain while the user is logged in.

## 3. Electron hardening

Implemented in `src/main/index.ts` and `src/preload/index.ts`:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` for the main window.
- The preload exposes only: `invoke`, resume file dialog, open external link, open data folder, open guided web window, export, platform/versions, and two event subscriptions.
- `setWindowOpenHandler` denies all new windows and sends http(s) URLs to the OS browser.
- `will-navigate` blocks navigation away from the app bundle; external http(s) URLs open in the browser.
- Production CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'`.
- The guided employer window uses the same sandbox/context isolation flags and has no preload bridge.
- Single-instance lock prevents two processes writing the same database.

`style-src 'unsafe-inline'` is required by React inline styles and Radix; it does not allow script execution.

## 4. IPC boundary

- All application operations go through `api:invoke`; payloads are validated with Zod per channel.
- Unknown channels are rejected. Secrets are never returned to the renderer; the UI receives booleans and masked hints.
- `system:open-external` accepts only http(s).
- `system:open-path` is restricted to the app's user-data directory.
- `system:open-web-run` requires an existing application with channel `web` and an exact match on the stored apply URL. It cannot open an arbitrary URL.
- Resume upload uses an OS file dialog; the chosen file is copied into the app's data folder, with an extension and size check. Extraction and parsing happen in the main process, and the renderer receives typed extracted fields plus a bounded text preview.
- Export writes only to a path chosen by the user in a save dialog.
- Chat settings and commands use dedicated channels (`chat.page`, `chat.save`, `chat.test`, `chat.sendTest`, `chat.command`). The Telegram chat ID must be numeric, WhatsApp phone fields are length-checked, the Graph version and webhook path are pattern-checked, and secrets can only be written through the `chat.*` allowlist entries.

## 5. Secrets

- SMTP password, AI keys, and the four chat credentials (Telegram bot token, WhatsApp access token, verify token, app secret) are encrypted with Electron `safeStorage`, which is backed by the macOS Keychain.
- If `safeStorage.isEncryptionAvailable()` is false, encryption and decryption fail closed; the app refuses to store or use secrets.
- Ciphertext is stored in the `secrets` table. There is no plaintext fallback in production. A memory cipher exists only in tests.
- The renderer never receives a secret value. Settings show whether a secret is present.
- Logs redact `password`, `token`, `apiKey`, `secret`, `authorization`, `smtp.password`, `appPassword`, and `raw` fields. Chat provider errors additionally replace the token or app secret value with `[redacted]` before reaching the interface, events, or logs.
- The database itself is not encrypted; it relies on the OS account and disk encryption. Backups/exported files inherit whatever protection the user gives them.

## 6. Network egress

Outbound requests exist only for job sources (and AI if configured).

- Connectors use documented public endpoints. There is no scraping of authenticated pages, no CAPTCHA solving, and no proxy rotation.
- The JSON-LD connector accepts user-supplied career-page URLs. `requestText` now:
  - accepts only http/https;
  - rejects embedded credentials;
  - rejects `localhost`, `.local`, `.internal`, `.home.arpa`, single-label hostnames, and numeric-only hosts;
  - rejects loopback, private, carrier-grade NAT, link-local (including `169.254.169.254`), multicast, and reserved IPv4 ranges;
  - rejects loopback, unique-local, link-local, and multicast IPv6, including IPv4-mapped private addresses;
  - follows at most three redirects, validating every hop;
  - caps responses at 16 MB and 20 seconds per attempt.
- Connectors have per-source rate limits and bounded retries; `429` respects `Retry-After`.
- DNS rebinding is not fully solved: the guard checks the hostname, not the resolved address. A hostile domain could resolve to a private IP after the check. Fully pinning the resolved address requires a custom HTTP dispatcher and is not implemented.

Chat adds two fixed outbound providers: `api.telegram.org` when Telegram is enabled, and `graph.facebook.com` when WhatsApp is enabled. The WhatsApp webhook listens only on `127.0.0.1`; a user-supplied HTTPS tunnel is the only inbound path. No general URL is accepted for chat.

AI providers are contacted only when AI is enabled and configured. Prompts may include job text and draft content. The user can select local Ollama or turn AI off to keep all content on the machine. Eligibility is never sent to or decided by a model. Resume files and extracted resume text are not sent to an AI provider: extraction, role recommendations, and profile import are entirely local.

## 7. Web content and application forms

- Job descriptions are converted to plain text before storage and rendering; React escapes all output. No `dangerouslySetInnerHTML` is used for employer content.
- The guided employer window is a real browser window: a hostile page can set cookies in its own partition, request notifications, or show a phishing form. The user is told to complete the form themselves. The app never types credentials or submits the form.
- CAPTCHAs, MFA, and unusual questions are always handed to the human. No bypass.
- External links open in the default browser with the OS sandbox.

## 8. Outbound email safety

- Defaults: mock adapter, kill switch on. A fresh install cannot send email.
- Effective SMTP requires: mode `smtp`, kill switch off, host, user, from address, and a stored password. Otherwise the call silently falls back to mock and says so in the UI.
- Application emails require an address quoted from the posting. The app does not guess addresses or use job-board relays.
- Approval is required by default. Daily and per-company caps apply before an outbox row is created.
- Every attempt has a unique outbox row and idempotency key. Uncertain deliveries are not retried automatically.
- Mail bodies are plain text; the resume is an attachment. No tracking pixels, no open/click tracking, no hidden recipients.
- SMTP login verification is separate from sending and reports success without contacting an employer.

## 9. AI-specific risks

- **Prompt injection:** employer text can contain instructions aimed at the model. The model has no tools, cannot call IPC, cannot change eligibility, and cannot send mail. Its output is treated as untrusted text, schema-validated, and only offered as a draft suggestion.
- **Hallucinated facts:** AI is not used to invent experience, contact details, or eligibility. Draft templates use stored candidate data.
- **Data egress:** cloud AI is optional. Ollama keeps inference local. The AI page states which provider receives content.
- **Cost and quota:** per-provider call logs, circuit breakers, and timeouts bound usage.

## 10. Chat channel security

Chat is optional and off until the user configures it. It uses official APIs only: Telegram Bot API long polling and WhatsApp Cloud API outbound plus a loopback webhook.

**Inbound trust**

- Telegram: the app makes outbound `getUpdates` calls; no port is opened. Updates are accepted only from the configured bot token, and only from the numeric chat ID on the allowlist. Usernames are rejected at the schema and UI level because they are mutable and do not appear in updates.
- WhatsApp: the webhook binds to `127.0.0.1` only. Meta reaches it through a user-managed HTTPS tunnel. A GET handshake must present the configured verify token; every POST must carry a valid `X-Hub-Signature-256` HMAC over the raw body using the app secret. Missing, malformed, or mismatched signatures return 401 before parsing.
- WhatsApp bodies are capped at 1 MB, the HTTP server has 10-second request and header timeouts, and only text messages from allowed senders are processed.
- Message IDs are deduplicated per provider, so a redelivered update or webhook retry cannot execute a command twice.
- The webhook acknowledges with 200 after signature verification and before command execution; a crash mid-command can lose that one message. It cannot replay or duplicate one.

**Commands and confirmations**

- The router is deterministic: `/status`, `/report`, `/approvals`, `/applications`, `/jobs`, `/missing`, `/set`, `/scan`, `/pause`, `/resume`, `/approve`, `/reject`, `/retry`, `/confirm`, `/help`. Free text is never interpreted as a command beyond the documented plain-word aliases.
- Approve, reject, and retry require a second step. The app replies with a six-digit code, stored as a SHA-256 hash, bound to provider, chat, and application, single-use, and valid for five minutes. The code is shown only in the requesting chat and is never written to the database, events, or logs.
- Codes are consumed transactionally; an expired, reused, or mismatched code is rejected without changing state.
- Per-chat rate limits apply to commands and notifications. Rejections are audited with reasons.

**Outbound notifications**

- Only event summaries leave the machine: application status, queue counts, failures, and confirmations. Message bodies, resume text, tokens, and codes are never included.
- Each provider keeps a notification cursor that advances only after a successful send, at most eight events per scan and ten notifications per minute. A failed notification is retried on the next scan rather than lost.
- Telegram notifications go to `api.telegram.org`; WhatsApp notifications go to `graph.facebook.com`. Both are fixed hosts; no user-supplied URL is accepted.
- Provider errors are redacted of token and app-secret values before reaching the UI, events, or logs.

**Data handling**

- `chat_messages` stores direction, chat reference, a summary capped at 500 characters, command name, status, and a truncated error. No full bodies.
- `chat_actions` stores the code hash, reason, timestamps, and consumption state; expired rows are pruned by the retention job.
- Chat credentials live in the Keychain and are never returned to the renderer.
- Turning chat off stops polling and closes the webhook; the credentials remain until removed.

## 11. Logging, events, and retention

- pino logs rotate at 8 MB, keeping one previous file. Field redaction is enforced by configuration.
- The event table records recipients, subjects, and error messages. These are local and may contain personal data; the retention job prunes older events.
- Log files and events are not uploaded anywhere. There is no telemetry or crash reporting.

## 12. Data lifecycle

- All data lives in the Electron user-data directory: database, logs, resumes, extracted resume text, mock outbox, exports.
- Uninstalling the app does not delete user data by default; the user must remove the folder.
- Retention settings prune events, AI calls, metrics, and old jobs. Applications and outbox records are retained.
- Exports are explicit and written wherever the user chooses. They are not encrypted by the app.

## 13. Packaging and distribution

The local build is intentionally unsigned:

- `identity: null`, `hardenedRuntime: false`, no notarisation.
- It runs on the build machine and can be inspected. On other machines macOS Gatekeeper will warn or block it.

Before distributing:

1. Sign with a Developer ID Application certificate.
2. Enable hardened runtime and sign entitlements appropriate to Electron (typically `com.apple.security.cs.allow-jit`).
3. Notarise with `notarytool` and staple the ticket.
4. Publish over HTTPS with a checksum and a changelog.
5. Keep the app free of remote code loading; updates should ship as signed app bundles, not downloaded scripts.

There is no auto-update channel. Remote code loading would undermine the CSP and review model.

## 14. Accepted risks and limitations

| Risk | Why accepted | Mitigation / advice |
| --- | --- | --- |
| Database not encrypted at rest | Keychain-backed full-DB encryption adds complexity and key-loss risk for a single user | Use FileVault; protect the OS account |
| No app-level lock | OS session is the practical boundary | Lock the screen; separate OS account for shared machines |
| DNS rebinding in URL fetch | In-process fetch resolves again; pinning needs a custom dispatcher | Only add trusted career-page URLs; the response is never forwarded |
| Hostile employer pages | The app cannot audit third-party sites | Guided window is sandboxed; user completes forms manually |
| SMTP delivery uncertainty | SMTP has no transaction ID | Outbox marks `sending` as uncertain; manual check before retry |
| Email addresses in events/logs | Useful audit trail for the user | Local only; retention pruning; do not share exports blindly |
| Unsigned build | No Apple credentials in this environment | Sign and notarise before distribution |
| Dependency vulnerabilities | Not audited as part of this build | Run `pnpm audit --prod` and update before distribution |
| Schedules while asleep | Desktop constraint | Missed runs catch up on launch; the UI states this |
| WhatsApp tunnel is user-managed | The app cannot provision or audit third-party tunnel services | Terminate TLS at a trusted tunnel; keep the webhook path and verify token secret; stop the tunnel when chat is off |
| Telegram bot token in request URL | The Bot API puts the token in the path, so it can appear in local proxy logs | No proxy is configured by the app; revoke and reissue in @BotFather if a token leaks |
| Webhook acknowledged before execution | 200 is sent before the command runs, per Cloud API expectations, so a crash can drop one message | Commands are idempotent or deduplicated; the user can resend; no state changes twice |
| Six-digit code hash is low entropy | A local attacker who can read the database could brute-force 10^6 hashes | Codes expire in five minutes, are single-use, and require the allowlisted chat; database read access already implies broad local compromise |
| WhatsApp messages while the app is closed | No listener runs, so Meta retries are not received | Telegram retains updates and catches up on launch; WhatsApp expects the webhook to be reachable |

## 15. Verification

- `tests/http.test.ts` covers loopback, private, link-local, metadata, numeric-host, protocol, credential, and single-label rejection.
- `tests/resume.test.ts` covers text extraction from each supported format, rejection of legacy and empty files, parser output, and non-destructive profile import.
- `tests/chat.test.ts` covers the command router, numeric allowlist, dedupe, Telegram update handling, WhatsApp signature verification and webhook parsing, confirmation-code expiry/single-use/channel binding, notification cursors, error redaction, and message retention.
- The E2E suite configures Telegram and WhatsApp without credentials and asserts a safe failure, validates malformed chat IDs and phone numbers, stores and removes a WhatsApp verify token through the UI, and confirms the secret never appears in the page body.
- The E2E run watches renderer `pageerror` and console errors; the suite fails on unexpected errors.
- Secret handling is covered indirectly by application tests that store and use an SMTP password through the secret store.
- No live Telegram or WhatsApp credential was used in automated tests, and no inbound tunnel was exercised. Those flows are covered by unit tests around the clients and the webhook handler, not by an end-to-end message from a real account.
- No automated penetration test or dependency audit has been run. Treat this document as a design description, not a certification.

## 16. Reporting a security issue

Report privately to the repository owner with a description, reproduction steps, and affected version. Do not open a public issue for a vulnerability that could expose user data or enable unwanted email. There is no bug bounty.
