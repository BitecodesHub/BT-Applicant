# Reliability — BT Applicant

Scope: what survives a crash, what retries, what deliberately does not retry, and how to recover. The app is a single-user desktop process; it does not claim 24/7 operation.

## 1. Operating envelope

- The app must be running. Quitting, sleeping, or logging out pauses discovery and delivery.
- Default worker: 3 slots, poll every 1 second, 120-second lease.
- Default automation: approval required, daily limit 10 applications, minimum score 55, at most 1 application per company per day.
- SQLite is the single source of truth. Nothing critical lives only in memory.
- State survives restarts; schedules catch up on launch; in-flight tasks are requeued.

## 2. Durability model

| Mechanism | Detail |
| --- | --- |
| Journal | WAL, `synchronous = NORMAL`, `foreign_keys = ON`, 5s busy timeout |
| Migrations | Ordered SQL, applied in a transaction, recorded in `schema_migrations`; a failed migration aborts startup instead of half-applying |
| Queue writes | Claim, completion, retry, and dead-letter are single statements or transactions |
| Outbox | Row created before send; delivery result recorded after; `(application_id, attempt)` is unique |
| Events | Append-only; every state transition and maintenance action is recorded |
| Exports | Jobs, applications, events, and outbox can be exported to CSV/JSON from the UI; the data folder can be opened from Diagnostics |

The database is not encrypted at rest. Secrets inside it are encrypted individually through the OS secret store (macOS Keychain, Windows DPAPI, or the Linux Secret Service keyring). FileVault, BitLocker, or an encrypted Linux home directory is the recommended baseline for the machine.

## 3. Queue semantics

States: `pending → running → done | failed → pending (retry) | dead | cancelled`.

- **Claim** is atomic (`BEGIN IMMEDIATE`): only one slot can own a task, and attempts increment at claim time. A crash after claiming therefore consumes an attempt, which is the conservative choice.
- **Lease** is 120 seconds by default. A running task must finish, retry, or be reaped before the lease expires.
- **Retry** uses exponential backoff: `min(600s, 2s × 2^(attempt−1))` with ±25% jitter. Default maximum is 5 attempts.
- **Dead-letter** is terminal. The task remains visible in Queue with its last error and can be retried manually.
- **Reaper** runs every 5 minutes. Expired leases under the limit return to `pending`; expired leases at the limit become `dead`.
- **Startup recovery** requeues tasks left `running` by the previous process and logs the recovery.
- **Cancellation** is cooperative. Discovery checks the abort signal between network calls and database writes; shutdown aborts active tasks and requeues them.
- **Idempotency keys** on scheduled tasks and dispatch prevent double enqueue when a tick overlaps a restart.

Concurrency is capped by the slot count, not by table scans. Multiple Electron windows share the same main-process worker; closing a window does not stop it, quitting the app does.

## 4. Scheduler

Schedules are rows, not timers. Every 10 seconds the scheduler:

1. syncs required schedules (maintenance, digest, one poll per enabled target country);
2. finds rows whose `next_run_at` is due;
3. computes the next occurrence with `cron-parser` in the configured timezone;
4. inserts an idempotent task keyed by `schedule:<id>:<runAt>`;
5. records the result.

A schedule fires at most once per `next_run_at`, even if the app restarts between steps 4 and 5. Missed occurrences are not replayed one by one; the next future occurrence is used. That prevents a wake-up storm after a long sleep.

Invalid cron expressions disable the schedule and log an event instead of crashing the loop.

The digest uses the user's selected local time. If the app is closed at that time, the digest is generated on the next launch (the schedule is due) and the OS notification fires then. The Daily report page can generate a digest on demand.

## 5. Failure matrix

| Failure | Effect | Recovery |
| --- | --- | --- |
| App quit during discovery | Task is aborted; source may have partial results | Startup requeues the task; dedupe prevents duplicates |
| App quit during evaluation | Evaluation transaction rolls back | Task is requeued |
| App quit during drafting | Draft status remains consistent; no outbox row yet | Task is requeued |
| Crash after outbox row created, before send | Row remains `pending` | Reconcile/delivery resumes or is marked failed by retry logic; no duplicate row for the attempt |
| Crash after adapter accepted, before marking sent | Row remains `sending` | After 5 minutes reconcile marks it `uncertain`; it is **not** retried automatically |
| SMTP timeout | Send fails; application `failed` with error | User reviews and retries; a new attempt has a new idempotency key |
| Provider rate limit (HTTP 429) | Connector backs off using `Retry-After` when present | Later poll retries; source health records the error |
| Source returns HTML instead of JSON | Connector validation fails | Source marked unhealthy with the parser error; other sources continue |
| AI provider down | Circuit breaker opens after repeated failures | Deterministic fallback; requests skip the provider until cooldown |
| All AI providers down | AI calls fail closed | Core pipeline continues; drafts use the deterministic template |
| Resume text extraction fails (encrypted, scanned, corrupt, legacy `.doc`) | File and metadata are kept; extraction error is shown; profile is unchanged | Re-upload a readable PDF/DOCX/TXT/Markdown/RTF; review the warning |
| Resume parser misses or misreads a field | Review shows confidence and warnings; import is still explicit | Correct the profile manually or re-read after re-uploading; existing values are never overwritten |
| Invalid role selection or custom title | IPC validation rejects the request; stored roles are unchanged | Correct the selection; the limit is 8 effective titles and custom titles are 2–80 characters |
| Disk full | SQLite write fails; task fails | Reaper/retry; Diagnostics shows database size and retained errors |
| Database locked | 5s busy timeout, then error | Single-writer design makes this rare; retry the operation |
| Clock moved backwards | Timers may delay | Schedules are recomputed from wall-clock cron on the next tick |
| System sleep | Timers pause | On wake, due schedules catch up once; leases may expire and tasks requeue |
| Telegram network failure | Poll fails; backoff grows to a ceiling; last error is shown | Polling continues; a later success clears the error |
| Telegram rejects the token (401/409) | Polling stops retrying aggressively; status shows the error | Correct or replace the token in Chat; revoke the old one in @BotFather |
| Another process polls the same bot (409) | Updates are taken by the other process; this app reports the conflict | Stop the other bot client; polling resumes on the next attempt |
| WhatsApp webhook port busy | Listener fails to bind; status says the webhook is not listening | Free the port or change it in Chat; outbound notifications still fail safely until configured |
| WhatsApp webhook body malformed or oversized | Request is rejected before parsing (400/413) | No state change; the sender can resend |
| WhatsApp signature mismatch | Request is rejected with 401 | Check the app secret matches the Meta app; no command runs |
| Chat rate limit exceeded | Command or notification is refused with a short reply | Wait for the window to reset; no action is queued |
| Notification delivery fails | Message row records the error; retry is bounded | Next event or retry delivers; the app never blocks the pipeline on chat |
| App quit while polling | In-flight HTTP call is aborted | Startup resumes polling; Telegram retains updates and the cursor avoids duplicates |
| App closed while WhatsApp webhook is down | Meta retries are not received | Start the app and tunnel; there is no offline queue for WhatsApp |

## 6. Delivery uncertainty

The rule is: a duplicate is worse than a documented uncertainty.

- Only an adapter confirmation moves an application to `submitted`.
- A send with no confirmation is `uncertain`. The UI explains that the provider may have accepted it and that retrying can duplicate.
- Reconcile never retries `uncertain` or `sending` rows automatically; it only flags stale `sending` rows.
- Mock mode cannot be uncertain in normal operation: writing the `.eml` file either succeeds or fails synchronously.

## 7. AI resilience

- Each provider has a circuit breaker: consecutive failures open it, and a cooldown allows a probe.
- Calls are bounded by timeout and abort signal; shutdown aborts them.
- Outputs are schema-validated. Invalid output is a provider failure and the chain continues.
- Quota counters and call logs are stored locally; there is no billing surprise from a retry loop.
- The app can run entirely with AI off. `simulated_outage` forces the fallback path for testing.

## 8. Health checks (Diagnostics page)

The page evaluates stored state, not assumptions:

- database readable, schema version, file size, storage path;
- worker heartbeat age and in-flight count;
- queue pending/running/dead counts;
- source health and last fetch result per source;
- profile completeness and work-authorization record count;
- resume availability;
- AI provider configuration and circuit state;
- delivery guard status: effective mode, kill switch, SMTP completeness;
- retained error events;
- version, Electron, Node, Chrome, timezone.

"All checks passed" is green only when every check is satisfied. A failing check shows the specific remedy.

## 9. Observability

- **Events** table: every significant action with category, level, actor, job/application/task IDs, and structured detail. Visible in Activity and on detail pages.
- **Logs**: pino to `<userData>/logs/app.log`, rotated at 8 MB to `app.log.1`. Passwords, tokens, API keys, authorization headers, and raw payload fields are redacted.
- **Heartbeats**: one row per worker instance, updated every 10 seconds while running and once on stop. Stale heartbeats are visible in Queue and Diagnostics.
- **AI calls**: provider, model, latency, status, and error per call, pruned by retention.
- **Source fetches**: per-source count, latency, HTTP status, and error message.

No telemetry is sent anywhere. Export is user-initiated.

## 10. Chat resilience

Chat is a control surface, not a dependency. Discovery, scoring, drafting, and delivery do not wait for it.

- **Isolation:** every send and poll is wrapped; a provider error is recorded and returned, never thrown into the worker. A chat outage cannot pause the queue.
- **Telegram polling:** long poll with bounded backoff (starting at 2 seconds, capped at 60), a persisted update cursor, and a per-process lock. On startup the cursor is read from `chat_state`; if absent it starts at the current maximum event ID, so enabling chat does not replay history. Duplicate updates are ignored by update ID.
- **WhatsApp webhook:** binds loopback, verifies the token on GET and the HMAC on every POST, caps the body at 1 MB, and acknowledges before running the command. A crash can lose one message but cannot execute it twice.
- **Commands:** unknown text gets a help reply, never an action. Approval and rejection always require a fresh six-digit code; the code is hashed, single-use, expires in five minutes, and is bound to channel, chat, and application. If notification delivery fails, the code remains valid until expiry but is not retried indefinitely.
- **Notifications:** each provider has a cursor that advances only after a successful send, with at most eight events per scan and ten notifications per minute. A failed send leaves the cursor in place, so that event is retried on the next scan instead of being lost. Restarting does not resend what was already delivered.
- **Configuration changes:** saving chat settings restarts only the affected provider. Turning chat or a provider off aborts its poll, closes the webhook, and clears running status. Invalid configuration is reported in Chat and does not crash the app.
- **Secrets:** token and app-secret values are redacted from errors before storage or display. Removing a secret rewrites the configuration so the provider reports "missing" immediately.

## 11. Runbook

**An application is stuck in "queued".**
1. Open Queue and check for a pending/running `application.dispatch` task.
2. Check Diagnostics for a dead worker or an open circuit (not applicable to mail).
3. Check Automation for pause state, daily limit, and per-company cap.
4. Run Refresh; reconcile runs every 10 minutes. Manual retry is available on the application page.

**An application failed.**
Read the error on the detail page. Fix the cause (missing resume, missing recipient evidence, automation paused), then Retry. Retries use a new outbox row and do not duplicate a confirmed send.

**Delivery is uncertain.**
Check the mailbox/provider for the message before retrying. The app deliberately will not decide for you. Record the outcome manually.

**A task is dead-lettered.**
Open Queue, inspect the last error, fix the cause, and retry the task. Dead tasks do not block other work.

**A source is failing.**
Open Sources, read the last error, and test the source. Disable it if the endpoint is gone; other sources continue. For ATS boards, verify the company token still exists.

**The app was closed for days.**
Launch it. Startup recovery requeues interrupted work, schedules resume at their next occurrence, and the digest is generated if it was missed. No replay storm.

**The database is corrupt or migration fails.**
The app aborts instead of writing partial data. Restore the database file from backup or export; logs name the failing migration. Deleting the database resets the app and loses history, so export first.

**A new version must be installed.**
Quit the app before replacing the bundle. The database lives outside the app bundle and survives upgrades. Migrations run on first launch.

**Chat says "configured but not polling".**
Open Chat and read the provider detail and last error. For Telegram, confirm the bot token and numeric chat ID, send `/start` to the bot, and check that no other client is polling the same token. For WhatsApp, confirm the access token, phone number ID, recipient number, verify token, and app secret, then confirm the tunnel forwards to the local webhook URL shown on the page.

**The WhatsApp webhook is not listening.**
Check the port (default in Chat), stop whatever else uses it, and save the settings again. The app binds only to `127.0.0.1`; a tunnel is required for Meta to reach it.

**A chat command was rejected.**
Only the allowlisted chat can issue commands. Approve/reject codes expire after five minutes and work once; request a new one with `/approve <id>` or `/reject <id>`. Rate-limited replies reset on their own.

**Chat notifications stopped.**
Check the provider status and last error. Notifications are best-effort and independent of the worker; a failed send does not affect applications. A later event retries.

## 12. Limits

- One writer; not a multi-user service.
- No replication, no remote backup. Backups are the user's responsibility (Time Machine or manual export).
- A crash during an SMTP send can produce an uncertain outcome; this is inherent to SMTP.
- A laptop that sleeps will not run schedules on time.
- Retention pruning is irreversible; exports are the way to keep history.
- Queue throughput is bounded by external APIs, not by SQLite.
- Chat requires the app to be running. Telegram catches up on launch; WhatsApp webhook messages sent while the app is closed are not received.
- WhatsApp inbound requires a user-provided HTTPS tunnel. The app does not provision or monitor it.

## 13. Test evidence

- 12 queue tests: atomic claims, lease expiry, retry/backoff bounds, dead-letter, cancellation, idempotency.
- 14 application tests: state transitions, caps, approval, outbox idempotency, uncertain handling, web handoff.
- 22 pipeline tests: normalization, dedupe, evidence extraction, scoring, routing.
- 14 resume tests: per-format extraction, rejected files, parser fields including projects and awards, contact fallback, stored analysis, non-destructive import.
- 6 role tests: selection limits, aliases, fingerprint invalidation, recommendation ranking, profile-only fallback.
- 22 chat tests: command router, allowlist, dedupe, Telegram update handling and cursor, WhatsApp signature/webhook parsing, confirmation-code expiry/single-use/channel binding, notification cursors, redaction, retention.
- 20 eligibility tests, 6 AI tests, and 5 HTTP guard tests cover authorization rules, failover/circuit behavior, and SSRF rejection. 121 tests across 9 files, all passing.
- E2E: full offline run including roles, resume upload and review, approval, mock delivery, a simulated AI outage, chat settings with validation and secret lifecycle, the command palette, relaunch persistence, and a stale-cache regression check on the submitted application page. Two Playwright scenarios, both passing.
- `npm run verify:all` runs typecheck, the 121 tests, both E2E scenarios, the release build for the current platform, and the packaged first-run check in one command, stopping at the first failure. Last full run on 2026-10-31: all five steps passed on macOS 27.2 arm64 (about 111 seconds).
- Windows and Linux targets build from this macOS host; neither has been run on native hardware, so their platform-specific behaviour (secret store, notifications, window chrome) is unverified. See [TEST-REPORT.md 3.4](./TEST-REPORT.md#34-cross-platform-pass-2026-10-31).
- Details: [TEST-REPORT.md](./TEST-REPORT.md).
