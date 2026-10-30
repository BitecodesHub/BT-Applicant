import { _electron as electron } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

delete process.env.ELECTRON_RUN_AS_NODE

const root = '/tmp/bt-applicant-packaged'
const userData = join(root, 'userdata')
rmSync(root, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

const executablePath = join(process.cwd(), 'release', 'mac-arm64', 'BT Applicant.app', 'Contents', 'MacOS', 'BT Applicant')
const app = await electron.launch({
  executablePath,
  env: { ...process.env, BT_APPLICANT_USER_DATA: userData },
  timeout: 60_000
})

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await page.waitForSelector('.onboarding', { timeout: 30_000 })
  await page.waitForTimeout(800)

  const bootstrap = await page.evaluate(() => globalThis.api.invoke('app.bootstrap'))
  assert.equal(bootstrap.system.version, '0.1.0', 'package version')
  assert.equal(bootstrap.system.schemaVersion, 4, 'schema version')
  assert.equal(bootstrap.onboarded, false, 'fresh install is not onboarded')
  assert.equal(bootstrap.settings.chat.enabled, false, 'chat is off by default')
  assert.equal(bootstrap.settings.chat.telegram.enabled, false, 'telegram is off by default')
  assert.equal(bootstrap.settings.chat.whatsapp.enabled, false, 'whatsapp is off by default')
  assert.equal(bootstrap.settings.ai.mode, 'enhanced', 'AI mode default')
  assert.ok(
    bootstrap.aiProviders.filter((provider) => provider.id !== 'ollama').every((provider) => !provider.configured),
    'no cloud AI provider is configured'
  )
  assert.equal(bootstrap.counts.applications, 0, 'no applications on a fresh install')
  assert.equal(bootstrap.counts.pendingTasks, 0, 'no queued work on a fresh install')

  await page.addStyleTag({ content: '.toast-viewport { display: none !important }' })
  await page.screenshot({ path: join(process.cwd(), 'docs', 'screenshots', '36-packaged-first-run.png'), fullPage: true })

  await app.close()

  const db = new DatabaseSync(join(userData, 'bt-applicant.db'), { readOnly: true })
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chat_%' ORDER BY name").all().map((row) => row.name)
  const migrations = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version
  const secrets = db.prepare('SELECT COUNT(*) AS n FROM secrets').get().n
  const settings = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'app'").get()?.value ?? 'null')
  db.close()

  assert.deepEqual(tables, ['chat_actions', 'chat_messages', 'chat_state'], 'chat tables created')
  assert.equal(migrations, 4, 'migration v4 recorded')
  assert.equal(secrets, 0, 'no secrets on a fresh install')
  assert.equal(settings?.chat?.enabled ?? false, false, 'stored chat setting is off')
  assert.deepEqual(errors, [], `renderer errors: ${errors.join('; ')}`)

  console.log(JSON.stringify({
    version: bootstrap.system.version,
    schemaVersion: bootstrap.system.schemaVersion,
    migrations,
    tables,
    secrets,
    onboarded: bootstrap.onboarded,
    chat: bootstrap.settings.chat.enabled,
    pageErrors: errors.length
  }, null, 2))
} finally {
  await app.close().catch(() => undefined)
}
