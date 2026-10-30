import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConnector } from '../src/main/connectors/registry'
import { verificationContext } from '../src/main/connectors/testkit'

interface Attempt {
  connector: string
  target: string
  country: string
  ok: boolean
  message: string
  sampleCount: number
  sampleTitles: string[]
  latencyMs: number
}

const ATS_CANDIDATES: { connector: string; configs: { label: string; config: Record<string, unknown> }[] }[] = [
  {
    connector: 'greenhouse',
    configs: ['stripe', 'figma', 'discord', 'datadog', 'cloudflare', 'gitlab'].map((token) => ({
      label: token,
      config: { boards: [token] }
    }))
  },
  {
    connector: 'lever',
    configs: ['gopuff', 'kraken'].map((token) => ({ label: token, config: { boards: [token] } }))
  },
  {
    connector: 'ashby',
    configs: ['openai', 'ramp', 'linear'].map((token) => ({ label: token, config: { boards: [token] } }))
  },
  {
    connector: 'smartrecruiters',
    configs: ['Ubisoft2', 'Visa'].map((token) => ({ label: token, config: { boards: [token] } }))
  },
  {
    connector: 'workable',
    configs: ['workable', 'huggingface'].map((token) => ({ label: token, config: { boards: [token] } }))
  }
]

const AGGREGATORS = ['remotive', 'arbeitnow', 'jobicy', 'himalayas', 'remoteok', 'themuse']

const CAREER_PAGES = [
  'https://jobs.lever.co/gopuff/bfa7bc15-793e-486c-a3f5-b27d84c53025',
  'https://job-boards.greenhouse.io/gitlab',
  'https://himalayas.app/jobs',
  'https://www.smartrecruiters.com/Ubisoft2'
]

async function run(): Promise<void> {
  const attempts: Attempt[] = []
  const startedAt = new Date()

  for (const group of ATS_CANDIDATES) {
    const connector = getConnector(group.connector)
    if (!connector?.test) continue
    for (const candidate of group.configs) {
      const ctx = verificationContext(group.connector, candidate.config)
      const result = await safeTest(connector.test.bind(connector), ctx)
      attempts.push({
        connector: group.connector,
        target: candidate.label,
        country: 'US',
        ...result
      })
      console.log(`${group.connector}/${candidate.label}: ${result.ok ? 'OK' : 'FAIL'} — ${result.message}`)
    }
  }

  for (const id of AGGREGATORS) {
    const connector = getConnector(id)
    if (!connector?.test) continue
    const result = await safeTest(connector.test.bind(connector), verificationContext(id, {}))
    attempts.push({ connector: id, target: '(default feed)', country: 'US', ...result })
    console.log(`${id}: ${result.ok ? 'OK' : 'FAIL'} — ${result.message}`)
  }

  const jsonld = getConnector('jsonld')
  if (jsonld?.test) {
    for (const url of CAREER_PAGES) {
      const result = await safeTest(jsonld.test.bind(jsonld), verificationContext('jsonld', { urls: [url] }))
      attempts.push({ connector: 'jsonld', target: url, country: 'US', ...result })
      console.log(`jsonld ${url}: ${result.ok ? 'OK' : 'FAIL'} — ${result.message}`)
    }
  }

  for (const id of ['adzuna', 'usajobs']) {
    const connector = getConnector(id)
    if (!connector?.test) continue
    const result = await safeTest(connector.test.bind(connector), verificationContext(id, {}, {}))
    attempts.push({ connector: id, target: '(credentials required)', country: 'US', ...result })
    console.log(`${id}: ${result.ok ? 'OK' : 'expected credential failure'} — ${result.message}`)
  }

  const docsDir = join(process.cwd(), 'docs')
  mkdirSync(docsDir, { recursive: true })
  writeFileSync(join(docsDir, 'source-verification.json'), JSON.stringify({ checkedAt: startedAt.toISOString(), attempts }, null, 2))

  const lines: string[] = []
  lines.push('# Source verification')
  lines.push('')
  lines.push(`Checked: ${startedAt.toISOString()}`)
  lines.push('')
  lines.push('Read-only GET requests from a residential connection. A passing result means the endpoint answered with parseable data at this time; it is not a guarantee of continued availability.')
  lines.push('')
  lines.push('| Connector | Target | Country | Result | Items | Latency | Message |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const attempt of attempts) {
    lines.push(
      `| ${attempt.connector} | ${attempt.target.replace(/\|/g, '\\|')} | ${attempt.country} | ${attempt.ok ? 'ok' : 'fail'} | ${attempt.sampleCount} | ${attempt.latencyMs} ms | ${attempt.message.replace(/\|/g, '\\|')} |`
    )
  }
  lines.push('')
  writeFileSync(join(docsDir, 'SOURCE-VERIFICATION.md'), lines.join('\n'))
  console.log(`\nWrote docs/SOURCE-VERIFICATION.md and docs/source-verification.json (${attempts.length} attempts).`)
}

async function safeTest(
  test: (ctx: ReturnType<typeof verificationContext>) => Promise<{
    ok: boolean
    message: string
    sampleCount?: number
    sampleTitles?: string[]
    latencyMs?: number
  }>,
  ctx: ReturnType<typeof verificationContext>
): Promise<Omit<Attempt, 'connector' | 'target' | 'country'>> {
  try {
    const result = await test(ctx)
    return {
      ok: result.ok,
      message: result.message,
      sampleCount: result.sampleCount ?? 0,
      sampleTitles: result.sampleTitles ?? [],
      latencyMs: result.latencyMs ?? 0
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      sampleCount: 0,
      sampleTitles: [],
      latencyMs: 0
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
