# Research — BT Applicant

Date: 2026-10-29. Scope: desktop job discovery and application tool for one candidate, offline by default.

This document records the research that shaped the build. It separates what was verified live from what is a documented assumption. Live source checks are in [SOURCE-VERIFICATION.md](./SOURCE-VERIFICATION.md), raw results in [source-verification.json](./source-verification.json).

## 1. Findings that changed the product

### 1.1 Public job data is structured, but only some of it is meant for machine reading

Most large employers publish openings through an applicant tracking system (ATS) with a public job board:

| Source | Access model | Verified on 2026-10-28 |
| --- | --- | --- |
| Greenhouse | Public board API per company token | 6 of 6 boards returned postings (Stripe 715, Datadog 424, Cloudflare 461, GitLab 236, Figma 142, Discord 46) |
| Lever | Public postings API per company | 2 of 2 boards responded (GoPuff 5, Kraken 0 at check time) |
| Ashby | Public job board API per organization | 3 of 3 responded (OpenAI 805, Ramp 172, Linear 32) |
| SmartRecruiters | Public postings API per company | 2 of 2 responded |
| Workable | Public account endpoint | 1 of 2 responded; the generic `workable` account returned HTTP 404 |
| Remotive, Arbeitnow, Jobicy, Himalayas, Remote OK, The Muse | Public feeds | All 6 responded |
| Adzuna, USAJOBS | Credentials required | Not tested; missing credentials reported honestly in the UI |
| schema.org `JobPosting` JSON-LD | Any public job page | 1 of 4 sample pages had usable JSON-LD; career index pages and a 403 page did not |

Consequence: the app ships fourteen connectors instead of scraping one aggregator. Each connector reports its own health, sample count, and last error, so a dead endpoint is visible rather than silently producing zero jobs. The UI calls the board an ATS source, not "the web".

The `JobPosting` vocabulary ([schema.org/JobPosting](https://schema.org/JobPosting)) is the fallback for employers without a feed. It is also the only connector that accepts a user-supplied URL, so its limits are explicit: one job page at a time and no CAPTCHA or login handling.

### 1.2 "Can this person work here?" is not one field

Work authorization depends on citizenship, residence, permit status, and the destination country's rules. Residence in a country does not imply the right to work there (a student or dependent permit is a common counterexample). The engine therefore keeps these facts separate:

- citizenships (multiple allowed);
- country of residence;
- per-country permits with status (`citizen`, `permanent_resident`, `work_permit`, `student_permit`, `dependent_permit`, `none`), validity dates, and whether sponsorship is needed;
- the job's own statements about sponsorship, right-to-work, citizenship, or security clearance.

Rules that are encoded as data, with a citation on each rule:

- EU/EEA/Switzerland free movement (31 countries) — work without employer sponsorship.
- UK–Ireland Common Travel Area (5 jurisdictions) — work without employer sponsorship.
- Australia–New Zealand Trans-Tasman travel arrangement (2 countries).
- Nordic labour-market arrangements (5 countries).
- Gulf Cooperation Council (6 countries) — a residence route, not automatic work rights.
- Mercosur (4 countries) — a residence route, not automatic work rights.
- Employer-supported routes for the US (TN, E-3, H-1B), Canada (CUSMA), UK (Skilled Worker), Germany (EU Blue Card), Netherlands (Highly Skilled Migrant), Australia (Temporary Skill Shortage).

The US H-1B, UK Skilled Worker, German Blue Card, Dutch HSM, and Australian TSS routes are employer-sponsored, not self-authorized. They are modelled as "needs a willing employer" rather than "eligible now".

Sources used for the rules: [EU free movement](https://european-union.europa.eu/choose-country-eu/eu-countries_en), [EU Blue Card Directive 2021/1883](https://eur-lex.europa.eu/eli/dir/2021/1883/oj), [Make it in Germany — EU Blue Card](https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card), [UK Skilled Worker visa](https://www.gov.uk/skilled-worker-visa), [Canada Express Entry](https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html), [USCIS H-1B](https://www.uscis.gov/working-in-the-united-states/temporary-workers/h-1b-specialty-occupations), [USCIS TN](https://www.uscis.gov/working-in-the-united-states/temporary-workers/tn-nafta-professionals), [Australian TSS](https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-skill-shortage-482).

The rules file carries a disclaimer: it is a decision aid, not legal advice. The UI repeats that.

### 1.3 Sponsorship language is noisy and easy to over-read

Postings use many variants: "we sponsor visas", "we are unable to sponsor", "must have existing right to work", "US citizenship required", "active security clearance". A single keyword match produces false positives ("we do not sponsor" contains "sponsor").

The pipeline therefore uses ordered phrase patterns and records the exact quoted sentence that produced the signal. Detection is deliberately conservative:

- an explicit negative ("unable to sponsor", "must have the right to work") wins over a generic positive;
- citizenship or clearance restrictions are separate from sponsorship;
- no phrase means `unknown`, not `offered`;
- unknown never counts as eligible.

This is also why every job row exposes the evidence text in the UI.

### 1.4 Email applications need a published address, not a guessed one

Many small and mid-size employers still accept applications by email, especially in Germany. Guessing `careers@company.com` produces bounces and, worse, sends a candidate's CV to an address that never consented.

The app only creates an email application when the posting itself contains an address. The extractor:

- reads `mailto:` links, visible addresses, and addresses in job descriptions;
- rejects image-like strings, example domains, and addresses belonging to job boards;
- stores the quoted sentence as evidence next to the address;
- routes the job to a guided web form when no address has evidence.

The UI shows "Email available" or "No email evidence" on every job.

### 1.5 Local AI is optional; the core must not depend on it

Small local models are useful for tone and rephrasing, not for facts. Cloud models add cost, latency, and a data-egress path. An application platform that stops working when a model is down is not reliable.

The build therefore has three layers:

1. deterministic discovery, eligibility, scoring, drafting, routing, delivery;
2. an optional AI overlay that can rewrite a draft or summarise a posting;
3. strict validation and a deterministic fallback for every AI result.

The UI exposes `enhanced`, `off`, and `simulated_outage` modes. The simulated outage is not a demo switch: it exercises the real fallback path and is covered by the end-to-end run.

### 1.6 Desktop-only changes the reliability story

A server can claim 24/7 operation. A desktop app cannot. Schedules only fire while the app is running; sleep, logout, and quit pause the loop.

The honest design:

- schedules are stored in SQLite and miss-runs are caught up on the next launch;
- each schedule fires at most once per `next_run_at`, even across restarts;
- the queue survives crashes with leases and startup recovery;
- the UI says "runs while this app is open" instead of implying a cloud worker.

This was treated as a product requirement, not a footnote.

### 1.7 Outbound email is the highest-risk action, so it is the last thing enabled

Sending a CV to an employer is irreversible. The research on mail delivery also matters: SMTP with an app password works for a single user without an OAuth verification project, but it requires correct SPF/DKIM at the sending domain, and provider rate limits apply.

Design consequences:

- default mode is `mock`: `.eml` files in a local outbox, no network;
- a kill switch forces mock mode even when SMTP is configured;
- SMTP must be configured and explicitly verified before it becomes effective;
- every send goes through a transactional outbox with an idempotency key, so a retry cannot duplicate a message;
- daily and per-company caps limit accidental volume;
- uncertain deliveries are surfaced, never retried automatically.

## 2. Live source verification

Method: read-only `GET` requests from a residential connection, no credentials, no scraping workarounds. A passing check means the endpoint answered with parseable data at that moment, not a guarantee of future availability.

Result on 2026-10-28: **21 of 27 checks passed**.

- 20 of 21 credential-free ATS/feed checks passed; the one failure was a nonexistent Workable account (HTTP 404).
- 1 of 4 schema.org checks passed; index pages did not expose job-level JSON-LD and one site returned HTTP 403.
- Adzuna and USAJOBS were not attempted without credentials and report that state in the app.

Full table: [SOURCE-VERIFICATION.md](./SOURCE-VERIFICATION.md). The verification script is `scripts/verify-sources.ts`; rerun with `npm run verify:sources`.

## 3. Standards and references consulted

- schema.org JobPosting: <https://schema.org/JobPosting>
- Greenhouse job board API: <https://developers.greenhouse.io/job-board.html>
- Lever postings API: <https://github.com/lever/postings-api>
- Ashby job posting API: <https://developers.ashbyhq.com/reference/jobpostinglist>
- SmartRecruiters postings API: <https://developers.smartrecruiters.com/>
- Workable jobs API: <https://workable.readme.io/reference/jobs>
- Remotive API: <https://remotive.com/api/remote-jobs>
- Arbeitnow API: <https://www.arbeitnow.com/api/job-board-api>
- Jobicy API: <https://jobicy.com/api/v2/remote-jobs>
- Himalayas API: <https://himalayas.app/jobs/api>
- Remote OK API: <https://remoteok.com/api>
- The Muse API: <https://www.themuse.com/developers/api/v2>
- Adzuna API: <https://developer.adzuna.com/>
- USAJOBS API: <https://developer.usajobs.gov/>
- Electron security checklist: <https://www.electronjs.org/docs/latest/tutorial/security>
- OWASP Application Security Verification Standard: <https://owasp.org/www-project-application-security-verification-standard/>

## 4. Assumptions and open questions

- The candidate is the only user. Multi-user accounts, sharing, and team review are out of scope.
- The machine is trusted and physically controlled. The database is not full-disk encrypted by the app; secrets are.
- Public endpoints remain available and permit this volume of use. The app rate-limits and identifies itself, but it cannot guarantee third-party terms.
- Immigration rules change. The bundled rules carry a `lastVerified` date and must be reviewed before relying on a verdict; the app never claims legal certainty.
- Email deliverability depends on the user's mail provider and domain configuration. A successful SMTP login is not proof that a message avoided spam.
- Auto-apply at scale is not a goal. The product optimises for a small number of correct, evidence-backed applications.
