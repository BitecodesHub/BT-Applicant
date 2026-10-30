# BT Applicant

A local-first job discovery and application desk for macOS, Windows, and Linux. It polls public job sources, decides whether a role is legally reachable for you, scores it, drafts an application, and delivers it only after your approval. Everything runs on your own machine: SQLite, the queue, the scheduler, resumes, and the outbox.

![Dashboard](docs/screenshots/01-dashboard.png)

## What it does

- **Discovery** from 14 connectors: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Remotive, Arbeitnow, Jobicy, Himalayas, Remote OK, The Muse, Adzuna, USAJOBS, and schema.org `JobPosting` pages.
- **Work authorization first**: citizenship, residence, and permits are modelled separately; EU/EEA/Switzerland free movement, UK–Ireland, Trans-Tasman, Nordic, GCC, and Mercosur routes plus employer-sponsored routes for the US, Canada, UK, Germany, Netherlands, and Australia. Every rule cites a source. Unknown is never treated as eligible.
- **Evidence, not guesses**: an email application exists only when the posting quotes a recipient address. Sponsorship and right-to-work signals keep the exact sentence.
- **Deterministic core**: eligibility, scoring, drafting, and delivery never depend on AI. Ollama, Anthropic, OpenAI, Gemini, and OpenAI-compatible endpoints are optional overlays with circuit breakers and a simulated-outage test mode.
- **Durable queue**: leased tasks, bounded retries with jitter, dead-letter, idempotent dispatch, crash recovery, schedules that catch up after sleep.
- **Local resume reading**: PDF, DOCX, TXT, Markdown, and RTF files are copied into the managed folder, extracted on-device, and parsed deterministically into contact details, summary, skills, dated roles with bullets and technologies, education, certifications, languages, projects, and awards. You review every field before importing; import only fills blanks and merges skills and languages, never overwriting existing profile data.
- **Role targeting and recommendations**: choose from 20 role families or add custom titles. Selected titles expand discovery queries and job scoring without changing eligibility. The recommendation screen ranks roles against your resume, profile, certifications, and jobs already discovered in your target countries, shows the evidence behind each score, and opens with a plain-language disclaimer. No AI provider and no network call are involved.
- **Safe delivery**: mock `.eml` outbox by default, kill switch on, human approval required, daily and per-company caps, transactional outbox.
- **Chat control, without a model**: connect Telegram through the official Bot API or WhatsApp through the official Cloud API. Receive event notifications, ask for status, pause or resume automation, fix missing profile facts, and prepare approvals, rejections, or retries. Approve, reject, and retry always need a six-digit, single-use, five-minute confirmation code. Commands are matched deterministically and work with AI switched off.
- **20 pages**: 18 pages in the navigation plus job and application detail, covering dashboard, daily report, jobs, applications, approvals, sources, targets, roles, profile, authorization, resumes, templates, AI, automation, chat, queue, activity, and diagnostics. A ⌘K (Ctrl+K on Windows and Linux) palette reaches every page and the quick actions.
- **Daily reporting**: what was discovered, drafted, submitted, and what needs you, plus an archived digest.

## Quick start

Requirements: Node 24 or newer and pnpm 9 to build and test (the app itself uses the built-in `node:sqlite`, so there is no native module to rebuild). End users only need the packaged app for their platform. Verified on macOS 27.2 arm64 with Node 26.6.0; on Windows and Linux the same commands are intended to work, and the platform-specific code paths are listed in [Packaging status](#packaging-status).

```bash
pnpm install
pnpm dev
```

First run opens a five-step onboarding: identity, work authorization, targets, resume, review. Nothing is discovered or sent until you finish it.

> Safety default: outbound is mock-only and kill-switched. A fresh install can write `.eml` files to the local mock outbox but cannot send email. SMTP must be configured, verified, and unlocked explicitly on **Automation & outbound**.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development app with hot reload |
| `pnpm build` | Build main, preload, and renderer into `out/` |
| `pnpm typecheck` | TypeScript for both process and renderer |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm test:e2e` | Build, seed the E2E fixture, run the Playwright Electron walkthrough, regenerate screenshots |
| `pnpm verify:sources` | Read-only live check of every connector; writes `docs/SOURCE-VERIFICATION.md` |
| `pnpm package` | Unsigned unpacked app for **this** platform, in `release/` |
| `pnpm dist` | Unsigned installer and ZIP for **this** platform: DMG/ZIP, NSIS/ZIP, or AppImage/ZIP |
| `pnpm dist:mac` \| `dist:win` \| `dist:linux` | Build one platform's artifacts from another (macOS can build all three; a Windows or Linux host cannot build the macOS target) |
| `pnpm verify:packaged` | Launch the packaged app with fresh user data and assert schema, defaults, and zero renderer errors |
| `pnpm verify:all` | Full local verification: typecheck, unit tests, E2E, release build, and packaged-app smoke test |

Run every local check, the full UI walkthrough, the release build, and the fresh-install smoke test with one command:

```bash
pnpm verify:all
```

The same command works on macOS, Windows, and Linux (`npm run verify:all` if you use npm). It runs the five steps in order, stops at the first failure, prints the time each step took, builds for the platform you are on, and regenerates the screenshots. Live source checks stay separate because they need network access: `pnpm verify:sources`.

## Where data lives

Everything is under Electron's user-data directory for your platform:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/BT Applicant/` |
| Windows | `%APPDATA%\BT Applicant\` |
| Linux | `~/.config/BT Applicant/` |

Inside it: `bt-applicant.db` (SQLite, WAL), `logs/app.log` (rotating, redacted), `resumes/` (uploaded copies), and `mock-outbox/` (mock `.eml` files).

Secrets (SMTP password, AI keys, Telegram bot token, WhatsApp access token, verify token, and app secret) are encrypted through Electron `safeStorage`, which uses the macOS Keychain, Windows data protection (DPAPI), or the Linux Secret Service keyring. The database itself is not encrypted; use FileVault, BitLocker, or an encrypted Linux home directory. Chat is off by default.

## Documentation

- [Research and sources](docs/RESEARCH.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions and trade-offs](docs/DECISIONS.md)
- [Reliability and recovery](docs/RELIABILITY.md)
- [Security and threat model](docs/SECURITY.md)
- [Test report and screenshots](docs/TEST-REPORT.md)
- [Source verification](docs/SOURCE-VERIFICATION.md)
- [Original plan](docs/PLAN.md) (historical; see Decisions for implementation deviations)

## Packaging status

`npm run dist` produces an **unsigned** build for the machine you build on: DMG and ZIP on macOS, NSIS installer and ZIP on Windows, AppImage and ZIP on Linux. It runs locally but is not ready for public distribution: a macOS release needs a Developer ID signature, hardened runtime, and notarisation; a Windows release needs Authenticode; a Linux release needs a signed repository or Flatpak. The steps are in [SECURITY.md](docs/SECURITY.md#13-packaging-and-distribution).

macOS builds and the fresh-install boot check are verified on this repository's machine. Windows and Linux artifacts build successfully from macOS, but neither has been installed or launched on real Windows or Linux hardware yet, so treat those platforms as **build-verified, not run-verified**.

## Scope and honesty

- One user, one machine per install. There is no server, account system, sync, or telemetry, and no data moves between platforms.
- Automation runs only while the app is open. Schedules catch up on the next launch; they do not run during sleep.
- No CAPTCHA solving, login automation, or scraping of pages that forbid it. Web applications open in a guided window and are submitted by you.
- Work authorization rules are a decision aid, not legal advice. Review the cited rule and your permit before applying.
- AI is optional and cannot change eligibility or send anything.
- Chat is optional. Telegram needs a bot token from @BotFather. WhatsApp needs a Meta app, a permanent access token, and a public HTTPS tunnel to the loopback webhook; the app does not create or host the tunnel. Notifications leave the machine through the channel you enable.
