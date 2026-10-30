# Source verification

Checked: 2026-10-28T07:00:07.448Z

Read-only GET requests from a residential connection. A passing result means the endpoint answered with parseable data at this time; it is not a guarantee of continued availability.

| Connector | Target | Country | Result | Items | Latency | Message |
| --- | --- | --- | --- | --- | --- | --- |
| greenhouse | stripe | US | ok | 715 | 1347 ms | Greenhouse board "stripe" responded with 715 postings. |
| greenhouse | figma | US | ok | 142 | 308 ms | Greenhouse board "figma" responded with 142 postings. |
| greenhouse | discord | US | ok | 46 | 342 ms | Greenhouse board "discord" responded with 46 postings. |
| greenhouse | datadog | US | ok | 424 | 395 ms | Greenhouse board "datadog" responded with 424 postings. |
| greenhouse | cloudflare | US | ok | 461 | 333 ms | Greenhouse board "cloudflare" responded with 461 postings. |
| greenhouse | gitlab | US | ok | 236 | 311 ms | Greenhouse board "gitlab" responded with 236 postings. |
| lever | gopuff | US | ok | 5 | 14555 ms | Lever company "gopuff" responded with 5 postings. |
| lever | kraken | US | ok | 0 | 1823 ms | Lever company "kraken" responded with 0 postings. |
| ashby | openai | US | ok | 805 | 767 ms | Ashby organization "openai" responded with 805 postings. |
| ashby | ramp | US | ok | 172 | 371 ms | Ashby organization "ramp" responded with 172 postings. |
| ashby | linear | US | ok | 32 | 271 ms | Ashby organization "linear" responded with 32 postings. |
| smartrecruiters | Ubisoft2 | US | ok | 5 | 765 ms | SmartRecruiters company "Ubisoft2" responded with 5 postings. |
| smartrecruiters | Visa | US | ok | 0 | 474 ms | SmartRecruiters company "Visa" responded with 0 postings. |
| workable | workable | US | fail | 0 | 524 ms | Workable account "workable" failed: HTTP 404 |
| workable | huggingface | US | ok | 6 | 548 ms | Workable account "huggingface" responded with 6 postings. |
| remotive | (default feed) | US | ok | 10 | 236 ms | Remotive responded with 10 jobs. |
| arbeitnow | (default feed) | US | ok | 300 | 402 ms | Arbeitnow responded with 300 jobs on page 1. |
| jobicy | (default feed) | US | ok | 5 | 7895 ms | Jobicy responded with 5 jobs. |
| himalayas | (default feed) | US | ok | 5 | 486 ms | Himalayas responded with 131264 jobs. |
| remoteok | (default feed) | US | ok | 99 | 2312 ms | Remote OK responded with 99 jobs. |
| themuse | (default feed) | US | ok | 20 | 543 ms | The Muse responded with 414937 jobs. |
| jsonld | https://jobs.lever.co/gopuff/bfa7bc15-793e-486c-a3f5-b27d84c53025 | US | ok | 1 | 766 ms | Found 1 schema.org JobPosting entries on https://jobs.lever.co/gopuff/bfa7bc15-793e-486c-a3f5-b27d84c53025. |
| jsonld | https://job-boards.greenhouse.io/gitlab | US | fail | 0 | 1042 ms | The page loaded but no schema.org JobPosting JSON-LD was found on https://job-boards.greenhouse.io/gitlab. |
| jsonld | https://himalayas.app/jobs | US | fail | 0 | 145 ms | Career page failed: HTTP 403 |
| jsonld | https://www.smartrecruiters.com/Ubisoft2 | US | fail | 0 | 2261 ms | The page loaded but no schema.org JobPosting JSON-LD was found on https://www.smartrecruiters.com/Ubisoft2. |
| adzuna | (credentials required) | US | fail | 0 | 0 ms | Adzuna credentials are missing. |
| usajobs | (credentials required) | US | fail | 0 | 0 ms | USAJOBS credentials are missing. |
