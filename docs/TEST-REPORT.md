# Test report — BT Applicant 0.1.0

Date: 2026-10-31 (previous pass 2026-10-30). Machine: macOS 27.2 (arm64). Electron 45.1.0; build and test tooling on Node 26.6.0.

## 1. Summary

| Check | Command | Result |
| --- | --- | --- |
| TypeScript, main + renderer | `npm run typecheck` | Pass |
| Unit and integration tests | `npm test` | 9 files, **121 tests passed** |
| End-to-end Electron walkthrough | `npm run test:e2e` | **2 passed**, 48.6 s for the whole script, screenshots 01–35 regenerated |
| Packaged app boot | `npm run verify:packaged` on `release/mac-arm64/BT Applicant.app` with fresh user data | Onboarding rendered, schema v4 created, chat off, 0 secrets, **0 page errors**, 4.2 s |
| Installer build | `npm run dist` | DMG (127 MB), ZIP (123 MB), and blockmaps produced |
| Everything in one command | `npm run verify:all` | Five steps, all pass: typecheck 0.9 s, tests 1.0 s, E2E 48.6 s, build 55.8 s, packaged boot 4.2 s |
| Cross-target builds | `npx electron-builder --win --linux --dir` from this macOS host | `release/win-arm64-unpacked/bt-applicant.exe` and `release/linux-arm64-unpacked/bt-applicant` produced. **Not installed or launched** on native hardware |
| Source endpoints | `npm run verify:sources` (2026-10-28) | 21 of 27 checks passed; details in [SOURCE-VERIFICATION.md](./SOURCE-VERIFICATION.md) |

The end-to-end run is offline: the fixture creates the database, jobs, applications, and mail sink locally. It does not call job boards or chat providers. Connector behaviour against live endpoints is covered separately by the verification script and is not part of the repeatable test suite.

## 2. Unit and integration coverage

| File | Tests | Focus |
| --- | --- | --- |
| `tests/queue.test.ts` | 12 | Atomic claims, lease expiry, retry/backoff bounds, dead-letter, cancellation, idempotency |
| `tests/applications.test.ts` | 14 | State transitions, approval, daily and per-company caps, mock delivery, outbox idempotency, uncertain sends, web handoff |
| `tests/pipeline.test.ts` | 22 | Normalization, dedupe, location, salary, skills, email evidence, scoring, routing |
| `tests/eligibility.test.ts` | 20 | Citizenship, permits, blocs, bilateral routes, sponsorship signals, unknown and clearance cases |
| `tests/ai.test.ts` | 6 | Provider failover, circuit breaking, simulated outage, deterministic fallback |
| `tests/http.test.ts` | 5 | Loopback/private/metadata URL rejection, redirect guard inputs, protocol and credential rejection |
| `tests/resume.test.ts` | 14 | TXT/Markdown/PDF/DOCX/RTF extraction, legacy format rejection, rich field parsing, projects and awards, certificate issuer handling, contact fallback, stored analysis, non-destructive profile import |
| `tests/roles.test.ts` | 6 | Role selection persistence and limits, catalog aliases, custom titles, fingerprint changes, recommended-role ranking, profile-only fallback |
| `tests/chat.test.ts` | 22 | Command router, numeric allowlist, update/message dedupe, Telegram cursor handling, WhatsApp signature and webhook parsing, confirmation-code expiry/single-use/channel binding, notification cursors, error redaction, message retention |

The database layer is exercised through an in-memory SQLite database with the real migrations. AI, mail, resume-extraction, and chat tests are deterministic; no network and no real mailbox or chat account are involved.

## 3. End-to-end scenarios

### 3.1 Offline walkthrough, approval, delivery, and persistence

One Playwright test launches the built Electron app with an isolated user-data directory and walks the product:

1. Dashboard renders the candidate name and live counts.
2. All 20 pages render: Daily report, Jobs, Job detail, Applications, Application detail, Approvals, Sources, Targets, Roles, Profile, Work authorization, Resumes, Templates, AI providers, Chat, Automation & outbound, Queue, Activity, Diagnostics.
3. Approval preview opens and closes.
4. Source edit persists (`Greenhouse — tech employers` → `Greenhouse — tech (E2E)`).
5. Target country NL is added with scanning disabled and persists.
6. The Roles page shows the pre-selected catalog roles, the recommendation disclaimer, and a ranked recommendation with an evidence source; the agent invokes `roles.recommend` and captures the result.
7. Resume upload goes through the real file dialog path (stubbed to a fixture file); the library grows to two, a review dialog opens automatically, and the uploaded file's parsed fields are captured. The review dialog is reopened through **Review details** to verify the stored extraction, including projects and awards.
8. Default application template is edited and saved as a new version.
9. AI mode is switched to `simulated_outage` and saved.
10. The Chat page renders with chat off, runs `/status` through the local command console, and shows the deterministic reply.
11. `⌘K` opens the command palette; searching "chat" filters to the Chat page; Enter navigates there.
12. The Stripe application is approved from the Approvals page and the worker delivers it through the mock adapter.
13. The application detail shows **Submitted**, a green "Submission recorded" notice, and the note that no network email was sent.
14. The mock outbox contains exactly one new `.eml` addressed to `stripe-jobs@example.test`, with the expected subject, body, resume attachment, and `X-Delivery-Mode: mock (no network transmission)`.
15. The app is closed and relaunched. Settings, source label, target, resumes, template version, and the submitted application all survive.
16. Both renderer sessions finish with zero `pageerror` or console errors.

The fixture seeds a programmatically generated PDF resume (one page, extractable text) and runs the production extraction and parser during seeding, so the Roles page and resume library demonstrate real parsed data rather than mocked DTOs. The uploaded TXT exercises the upload → extract → review path inside the running app.

### 3.2 Chat settings without credentials

A second test starts from a clean fixture, turns AI off, and exercises the Chat setup path:

1. Chat is off by default; the page states that nothing polls and no webhook listens.
2. **Test connection** for Telegram without a token fails with a clear message, not a crash.
3. **Test connection** for WhatsApp without credentials fails with a clear message.
4. A Telegram chat ID of `@username` is rejected; a numeric ID is accepted at the field level.
5. A WhatsApp recipient phone number shorter than 7 digits is rejected.
6. WhatsApp settings save successfully once the fields are shaped correctly.
7. Commands can be disabled independently of chat; the console becomes read-only and reports "Commands are disabled."
8. Chat is returned to off with commands enabled, and the console becomes writable again.
9. A WhatsApp verify token is stored through the UI, the page body never contains the value, and `chat.page` reports the secret as stored.
10. The token is removed through the confirmation dialog; `chat.page` reports the secret as absent, and the provider test fails clearly without it.
11. The renderer finishes with zero errors.

Capture: `e2e/app.spec.ts`, screenshots in [`docs/screenshots`](./screenshots).

### 3.3 Defects found and fixed during this run

The chat work surfaced several issues, all fixed before the final run:

- **Allowlist accepted `@username`.** Telegram updates carry numeric chat IDs, so a username allowlist could never match and every command would be rejected silently. Validation is now numeric in the schema, the form, and the documentation.
- **Failed replies advanced the success timestamp.** The inbound handler patched `lastSuccessAt` even when the reply failed, producing a green status after a failed send. Only activity is recorded; success is set by the send path.
- **Fresh poll state was misdetected.** `undefined !== null` treated a missing cursor as initialized. The check is now explicit, and the first run starts from the current event maximum so enabling chat does not replay history.
- **State patch could be a no-op.** `patchChatState` skipped the insert when no row existed. It now ensures the row first, so cursors and activity survive the first message.
- **Chat summaries were kept forever.** The retention job now prunes `chat_messages` and expired `chat_actions`, and the maintenance event reports the counts.
- **Secret inputs had no accessible name.** Each chat secret field and its Save button now carry an `aria-label`.

The previous run also fixed a cache regression: after approval, the detail page could show **Queued** while the database said **submitted**. Queries now use `staleTime: 0`, every worker task broadcasts `app:data-changed`, and an open detail page polls every 10 seconds. The assertion remains in the E2E suite.

### 3.4 Cross-platform pass (2026-10-31)

Making the single command work on macOS, Windows, and Linux found these problems, all fixed in this pass:

- **`npm run verify:packaged` was broken as written.** The script carried TypeScript annotations but the npm script ran it with plain `node`, so it failed at parse time with `SyntaxError: Unexpected token ':'`. It now runs as plain JavaScript, which is what the `verify:all` chain needs on Windows.
- **Packaged-app discovery assumed a Mac bundle.** Binary lookup is now per platform: `BT Applicant.app/Contents/MacOS/…` on macOS, `bt-applicant.exe` on Windows, `bt-applicant` on Linux, with a clear "not implemented for this platform" error otherwise.
- **Test paths were Unix-only.** E2E and packaged verification used fixed `/tmp/...` paths; both now use `os.tmpdir()`, which resolves to `%TEMP%` on Windows.
- **The all-in-one command relied on shell `&&`.** `npm run verify:all` now executes a Node runner (`scripts/verify-all.mjs`) that spawns each step directly, prints per-step timings, and stops at the first failure. PowerShell 5.1 does not support `&&`, so the previous chain would have failed there.
- **The UI claimed Mac-only facts.** A single module (`src/renderer/src/lib/platform.ts`) now supplies the palette shortcut (⌘K / Ctrl K), the secret-store name (Keychain / DPAPI / Secret Service keyring), and machine wording, used across eight pages, the app shell, and onboarding. Text like "never leaves this Mac" and "stored in the keychain" is gone; the E2E assertions follow the same source.
- **Window setup was Mac-shaped.** `trafficLightPosition` is applied only on macOS, the minimum window dropped from 1120x760 to 980x640 so it is not taller than a 768p laptop, and `app.setAppUserModelId()` is set on Windows so taskbar grouping and toasts attribute to the app.
- **Packaging config was macOS-only.** `electron-builder.yml` now declares Windows (NSIS + ZIP, `build/icon.ico`) and Linux (AppImage + ZIP, `build/icon.png`, desktop entry synced to `com.bitecodes.btapplicant.desktop`) targets. `executableName` moved from the root into the `win` and `linux` blocks, because setting it globally renamed the macOS bundle to `bt-applicant.app`; macOS keeps `BT Applicant.app`.
- **`linux.desktop` was written in a shape electron-builder 26 rejects.** Schema validation failed the whole build; the desktop metadata now uses the supported `synopsis`, `description`, `category`, and `syncDesktopName` fields.

Verification state: everything above was executed on macOS. The Windows and Linux targets build, but no Windows or Linux machine has installed, launched, or exercised them, so the platform-specific secret store, notification delivery, and window behaviour are **unverified**, not working.

## 4. Visual verification

Each screenshot was reviewed for layout, copy, and consistency. Fixes made during review:

- success notices render green instead of gold;
- mock delivery wording states that no network email was sent;
- singular/plural copy corrected across dashboard, jobs, queue, diagnostics, and backend event messages ("1 application", "1 needs sponsorship", "2 records", "1 file");
- "Discovered today" now counts the canonical jobs table, so the dashboard card, chart, and Daily report agree;
- Queue's "Next run" shows the next enabled schedule when no task is pending;
- the now 18-item sidebar fits the default window height without clipping;
- role cards show the title and the family/experience line on separate rows instead of running together;
- the resume review dialog constrains long certification and experience text, and the document is scrollable;
- chat secret fields show **Stored**/**Missing** without ever rendering the value, and removal requires confirmation;
- documentation screenshots hide transient toasts.

| Screenshot | What it verifies |
| --- | --- |
| `01-dashboard.png` | Live counts, 7-day chart, backlog, digest attention |
| `02-daily-report.png` | Daily metrics and stored digest |
| `03-jobs.png` | Eligibility totals, sponsorship breakdown, filters |
| `04-job-detail.png` | Posting, evidence, evaluation reasons |
| `05-applications.png` | Application list and states |
| `06-application-detail.png` | Draft, routing evidence, timeline |
| `07-approvals.png` | Pending approvals and blocked work |
| `08-approval-preview.png` | Pre-send review dialog |
| `09-sources.png` | Connector health and configuration |
| `10-targets.png` | Country targets and schedules |
| `11-profile.png` | Candidate facts |
| `12-work-authorization.png` | Citizenship and permits |
| `13-resumes.png` | Resume library with parse status |
| `14-templates.png` | Versioned templates |
| `15-ai-providers.png` | Provider chain and modes |
| `16-chat.png` | Chat off by default, channels, local command console |
| `17-command-palette.png` | `⌘K` search across pages and actions |
| `18-automation.png` | Approval, caps, outbound guard |
| `19-queue.png` | Pending/running/completed and schedules |
| `20-activity.png` | Event ledger |
| `21-diagnostics.png` | Readiness checklist and runtime |
| `22-roles.png` | Role catalog selection and effective titles |
| `23-role-recommendations.png` | Deterministic ranking, disclaimer, evidence and confidence |
| `24-source-edited.png` | Persisted source edit |
| `25-target-added.png` | Persisted target |
| `26-resume-uploaded.png` | Uploaded TXT parsed locally, library counts |
| `27-resume-review.png` | Extracted identity, skills, experience, education, certificates, languages, projects, awards |
| `28-template-edited.png` | New template version |
| `29-ai-outage-saved.png` | Simulated outage persisted |
| `30-application-submitted.png` | Submitted state, mock confirmation |
| `31-dashboard-after-approval.png` | Counts after delivery |
| `32-relaunch-dashboard.png` | Persistence after relaunch |
| `33-chat-validation.png` | Validation banner blocks saving when the chat ID or phone number is malformed |
| `34-chat-security.png` | Security model, allowlist, two-step actions, encrypted credentials, no message archive |
| `35-chat-channels.png` | Loopback webhook, missing provider credentials, notification and secret-handling notes |
| `36-packaged-first-run.png` | Packaged app onboarding with no fixture data |

Screenshots 01–35 use the dark theme from the E2E fixture. Screenshot 36 is the empty first run of the packaged app and follows the machine's light appearance, which also exercises the light theme.

## 5. Packaging verification

- `release/mac-arm64/BT Applicant.app` — 339 MB on disk with the same 68 MB ASAR of production dependencies (`unpdf` with its bundled pdf.js, `fflate`).
- `release/BT Applicant-0.1.0-mac-arm64.dmg` — 127 MB.
- `release/BT Applicant-0.1.0-arm64-mac.zip` — 123 MB.
- Cross-target builds from this macOS host: `release/win-arm64-unpacked` (440 MB, `bt-applicant.exe`) and `release/linux-arm64-unpacked` (371 MB, `bt-applicant`). The NSIS installer (116 MB) and AppImage (133 MB) were produced during the same pass before the directory was rebuilt.
- `npm run verify:packaged` launches the packaged binary with a fresh user-data directory and asserts:
  - onboarding renders before any data exists;
  - app version is 0.1.0 and schema migrations reach version 4;
  - `chat_actions`, `chat_messages`, and `chat_state` exist on a fresh database;
  - chat, Telegram, and WhatsApp are off;
  - no cloud AI provider is configured;
  - the `secrets` table is empty, so no credential is seeded;
  - there are no applications or queued tasks;
  - the renderer reports zero page or console errors.
- The same run writes `36-packaged-first-run.png`.
- The bundle is **unsigned** and not notarised. Gatekeeper will warn on other machines. See [SECURITY.md](./SECURITY.md#13-packaging-and-distribution).

## 6. Not covered

- Live chat delivery. No real Telegram bot or WhatsApp business account was used, and no public tunnel was exposed. The clients, signature verification, webhook parser, command router, and confirmation codes are covered by unit tests; an end-to-end message from a real account is not.
- Live connector polling inside the UI. Endpoints were verified by script; the E2E suite is deliberately offline.
- Real SMTP delivery. Sending is mock-only in the test environment; SMTP is covered by unit-level adapter tests and a login-verification action, not by sending to a real inbox.
- macOS notarisation and Gatekeeper acceptance, because the build is unsigned.
- Screen-reader and keyboard-only audits. The UI uses Radix primitives and native controls, but no formal accessibility audit was run.
- Multi-day scheduling, sleep/wake, and long-running soak tests. Queue recovery semantics are unit-tested; wall-clock behaviour over days was not.
- Running the app on Windows or Linux. Both targets build from this macOS host, and the code paths that differ by platform are listed in 3.4, but neither has been installed or launched on native hardware. The packaged first-run check (`npm run verify:packaged`) only tests the platform you build on.
- Automated dependency vulnerability audit.

## 7. Reproduce

```bash
npm install
npm run verify:all      # typecheck, tests, E2E, release build, packaged first-run check
```

Or step by step:

```bash
npm run typecheck
npm test
npm run test:e2e        # rebuilds, seeds the E2E fixture, runs Playwright
npm run package         # unsigned unpacked app for this platform
npm run verify:packaged # fresh-user-data smoke test of the packaged app
npm run dist            # DMG + ZIP (macOS), NSIS + ZIP (Windows), AppImage + ZIP (Linux)
npm run dist:win        # cross-build from macOS or Linux
npm run dist:linux      # cross-build from macOS or Linux
```

The E2E and packaged runs use `os.tmpdir()`: `/tmp/bt-applicant-e2e` and `/tmp/bt-applicant-packaged` on macOS and Linux, `%TEMP%\bt-applicant-e2e` on Windows. Screenshots are written to `docs/screenshots`.
