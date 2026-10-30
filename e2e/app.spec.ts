import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST, SHOTS } from './paths'

interface Manifest {
  userData: string
  database: string
  mockOutbox: string
  uploadFile: string
  initialEmlCount: number
  initialEmlFiles: string[]
  jobs: Record<'stripe' | 'datadog' | 'figma' | 'cloudflare' | 'discord' | 'gitlab' | 'openai' | 'huggingface', number>
  jobTitles: Record<string, string>
  applications: { stripe: number; datadog: number; figma: number }
  targets: { de: number; in: number }
  sourceId: string
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
const screenshotDir = SHOTS
mkdirSync(screenshotDir, { recursive: true })

delete process.env.ELECTRON_RUN_AS_NODE

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      BT_APPLICANT_USER_DATA: manifest.userData,
      NODE_ENV: 'test'
    }
  })
}

async function invoke<T = unknown>(page: Page, channel: string, payload?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel, payload }) => (globalThis as unknown as { api: { invoke: (c: string, p?: unknown) => Promise<unknown> } }).api.invoke(channel, payload),
    { channel, payload }
  ) as Promise<T>
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450)
  const hideToasts = await page.addStyleTag({ content: '.toast-viewport { display: none !important }' })
  await page.waitForTimeout(60)
  await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true })
  await hideToasts.evaluate((node) => node.remove())
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((target) => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = target
  }, hash)
  await page.waitForTimeout(700)
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function open(page: Page, label: string, title: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click()
  await expect(page.locator('h1.page-title').first()).toContainText(title)
  await page.waitForTimeout(500)
}

test('offline walkthrough, approval, delivery, and persistence', async () => {
  test.setTimeout(240_000)
  const app = await launch()
  const page = await app.firstWindow()
  const errors = watchErrors(page)

  await page.waitForSelector('.app-shell', { timeout: 30_000 })
  await expect(page.locator('h1.page-title').first()).toContainText('Jordan')
  await page.evaluate(() => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready)
  await capture(page, '01-dashboard')

  await open(page, 'Daily report', 'Today’s report')
  await capture(page, '02-daily-report')

  await open(page, 'Jobs', 'Discovered jobs')
  await capture(page, '03-jobs')

  await go(page, `#/jobs/${manifest.jobs.stripe}`)
  await expect(page.locator('h1.job-title')).toContainText(manifest.jobTitles.stripe!)
  await capture(page, '04-job-detail')

  await open(page, 'Applications', 'Applications')
  await capture(page, '05-applications')

  await go(page, `#/applications/${manifest.applications.stripe}`)
  await expect(page.locator('h1.job-title')).toContainText(manifest.jobTitles.stripe!)
  await capture(page, '06-application-detail')

  await open(page, 'Approvals', 'Approvals & blocked applications')
  await capture(page, '07-approvals')

  await page.getByRole('button', { name: `Preview ${manifest.jobTitles.stripe}` }).click()
  const preview = page.getByRole('dialog')
  await expect(preview).toBeVisible()
  await capture(page, '08-approval-preview')
  await preview.getByRole('button', { name: 'Close' }).click()
  await expect(preview).toBeHidden()

  await open(page, 'Sources', 'Discovery connectors')
  await capture(page, '09-sources')

  await open(page, 'Targets', 'Target countries')
  await capture(page, '10-targets')

  await open(page, 'Profile', 'Applicant profile')
  await capture(page, '11-profile')

  await open(page, 'Work authorization', 'Nationality & work authorization')
  await capture(page, '12-work-authorization')

  await open(page, 'Resumes', 'Resumes')
  await capture(page, '13-resumes')

  await open(page, 'Templates', 'Templates')
  await capture(page, '14-templates')

  await open(page, 'AI providers', 'AI providers')
  await capture(page, '15-ai-providers')

  await open(page, 'Chat', 'Chat')
  await expect(page.getByText('Chat is off.').first()).toBeVisible()
  await expect(page.getByText('Recent activity').first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('/status')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('BT Applicant · status').first()).toBeVisible()
  await capture(page, '16-chat')

  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog')
  await expect(palette).toBeVisible()
  const paletteSearch = palette.getByRole('combobox', { name: 'Search pages and actions' })
  await paletteSearch.fill('chat')
  await expect(palette.getByRole('option', { name: /Chat/ }).first()).toBeVisible()
  await capture(page, '17-command-palette')
  await paletteSearch.press('Enter')
  await expect(page.locator('h1.page-title').first()).toContainText('Chat')

  await open(page, 'Automation & outbound', 'Automation & outbound')
  await capture(page, '18-automation')

  await open(page, 'Queue', 'Queue')
  await capture(page, '19-queue')

  await open(page, 'Activity', 'Activity')
  await capture(page, '20-activity')

  await open(page, 'Diagnostics', 'Diagnostics')
  await capture(page, '21-diagnostics')

  await open(page, 'Roles', 'Roles')
  await capture(page, '22-roles')
  await expect(page.getByText('Read this before using a recommendation.')).toBeVisible()
  await page.getByRole('button', { name: 'Get recommendations' }).click()
  await expect(page.locator('.rec-card').first()).toBeVisible()
  await page
    .locator('section.panel')
    .filter({ hasText: 'Recommended roles' })
    .evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await capture(page, '23-role-recommendations')

  await open(page, 'Sources', 'Discovery connectors')
  await page.getByRole('button', { name: 'Edit Greenhouse — tech employers' }).click()
  const sourceDialog = page.getByRole('dialog')
  await sourceDialog.getByLabel('Label').fill('Greenhouse — tech (E2E)')
  await sourceDialog.getByRole('button', { name: 'Save changes' }).click()
  await expect
    .poll(async () => {
      const sources = await invoke<Array<{ id: string; label: string }>>(page, 'sources.list')
      return sources.find((source) => source.id === manifest.sourceId)?.label
    })
    .toBe('Greenhouse — tech (E2E)')
  await capture(page, '24-source-edited')

  await open(page, 'Targets', 'Target countries')
  await page.getByRole('button', { name: 'Add target' }).first().click()
  const targetDialog = page.getByRole('dialog')
  await targetDialog.getByLabel(/^Country\b/).selectOption('NL')
  await targetDialog.getByPlaceholder('e.g. DevOps Engineer').fill('Platform Engineer')
  await targetDialog.getByPlaceholder('e.g. DevOps Engineer').press('Enter')
  const scanSwitch = targetDialog.getByRole('switch', { name: 'Scan this country automatically' })
  if (await scanSwitch.isChecked()) await scanSwitch.click()
  await targetDialog.getByRole('button', { name: 'Add target' }).click()
  await expect(page.getByText('Netherlands', { exact: true })).toBeVisible()
  await expect
    .poll(async () => {
      const targets = await invoke<Array<{ countryCode: string; enabled: boolean }>>(page, 'targets.list')
      return targets.find((target) => target.countryCode === 'NL')?.enabled
    })
    .toBe(false)
  await capture(page, '25-target-added')

  await open(page, 'Resumes', 'Resumes')
  await app.evaluate(({ dialog }, filePath) => {
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, manifest.uploadFile)
  await page.getByRole('button', { name: 'Add resume' }).click()
  const reviewDialog = page.getByRole('dialog')
  await expect(reviewDialog).toBeVisible()
  await expect(reviewDialog.getByText('Import into profile')).toBeVisible()
  await expect(reviewDialog.getByText('1 project', { exact: true })).toBeVisible()
  await expect(reviewDialog.getByText('1 award', { exact: true })).toBeVisible()
  await reviewDialog.getByLabel('Close').click()
  await expect(page.getByText('upload-resume', { exact: false }).first()).toBeVisible()
  await expect
    .poll(async () => (await invoke<unknown[]>(page, 'resumes.list')).length)
    .toBe(2)
  await capture(page, '26-resume-uploaded')

  await page.getByRole('button', { name: 'Review details' }).first().click()
  await expect(reviewDialog).toBeVisible()
  await capture(page, '27-resume-review')
  await reviewDialog.getByLabel('Close').click()

  await open(page, 'Templates', 'Templates')
  const templateRow = page.locator('.list-row').filter({ hasText: 'Standard application email' }).first()
  await templateRow.getByRole('button', { name: 'Edit' }).click()
  const templateDialog = page.getByRole('dialog')
  const editedSubject = 'Application for {{job_title}} — {{candidate_name}} (E2E)'
  await templateDialog.getByLabel('Subject').fill(editedSubject)
  await templateDialog.getByRole('button', { name: 'Save new version' }).click()
  await expect
    .poll(async () => {
      const templates = await invoke<Array<{ isDefault: boolean; kind: string; subject: string }>>(page, 'templates.list', {})
      return templates.find((template) => template.kind === 'application_email' && template.isDefault)?.subject
    })
    .toBe(editedSubject)
  await capture(page, '28-template-edited')

  await open(page, 'AI providers', 'AI providers')
  await page.getByRole('button', { name: /Simulated AI outage/ }).click()
  await page.getByRole('button', { name: 'Save AI settings' }).click()
  await expect
    .poll(async () => (await invoke<{ ai: { mode: string } }>(page, 'settings.get')).ai.mode)
    .toBe('simulated_outage')
  await capture(page, '29-ai-outage-saved')

  await open(page, 'Approvals', 'Approvals & blocked applications')
  await page.getByRole('button', { name: `Preview ${manifest.jobTitles.stripe}` }).click()
  const approvalDialog = page.getByRole('dialog')
  await approvalDialog.getByRole('button', { name: 'Approve and queue' }).click()
  await expect(page.getByText('Approved and queued. The worker will handle delivery.')).toBeVisible()

  let finalStatus = ''
  await expect
    .poll(
      async () => {
        const bundle = await invoke<{ application: { status: string; lastError: string | null } }>(page, 'applications.get', {
          id: manifest.applications.stripe
        })
        finalStatus = bundle.application.status
        if (finalStatus === 'failed' || finalStatus === 'uncertain') {
          throw new Error(`Stripe application ended as ${finalStatus}: ${bundle.application.lastError ?? 'unknown error'}`)
        }
        return finalStatus
      },
      { timeout: 30_000, intervals: [400, 700, 1000] }
    )
    .toBe('submitted')

  await go(page, `#/applications/${manifest.applications.stripe}`)
  await expect(page.locator('h1.job-title')).toContainText(manifest.jobTitles.stripe!)
  await expect(page.getByText('Submitted', { exact: false }).first()).toBeVisible()
  await capture(page, '30-application-submitted')

  await open(page, 'Dashboard', 'Jordan')
  await expect(page.getByText('Recent applications')).toBeVisible()
  await capture(page, '31-dashboard-after-approval')

  await app.close()

  const emlFiles = readdirSync(manifest.mockOutbox).filter((name) => name.endsWith('.eml'))
  expect(emlFiles.length).toBe(manifest.initialEmlCount + 1)
  const stripeMail = emlFiles
    .map((name) => readFileSync(join(manifest.mockOutbox, name), 'utf8'))
    .find((content) => content.includes('To: stripe-jobs@example.test'))
  expect(stripeMail, 'a new mock email addressed to Stripe should exist').toBeTruthy()
  expect(stripeMail).toContain('X-Delivery-Mode: mock (no network transmission)')
  expect(stripeMail).toContain(`Subject: Application for ${manifest.jobTitles.stripe} — Jordan Vale`)
  expect(stripeMail).toContain('Dear Stripe hiring team')
  expect(stripeMail).toContain('jordan-vale-resume.pdf')

  const relaunch = await launch()
  const page2 = await relaunch.firstWindow()
  const relaunchErrors = watchErrors(page2)
  await page2.waitForSelector('.app-shell', { timeout: 30_000 })
  await expect(page2.locator('h1.page-title').first()).toContainText('Jordan')

  const settings = await invoke<{ ai: { mode: string } }>(page2, 'settings.get')
  expect(settings.ai.mode).toBe('simulated_outage')

  const sources = await invoke<Array<{ id: string; label: string }>>(page2, 'sources.list')
  expect(sources.find((source) => source.id === manifest.sourceId)?.label).toBe('Greenhouse — tech (E2E)')

  const targets = await invoke<Array<{ countryCode: string; enabled: boolean }>>(page2, 'targets.list')
  expect(targets.find((target) => target.countryCode === 'NL')?.enabled).toBe(false)

  const resumes = await invoke<unknown[]>(page2, 'resumes.list')
  expect(resumes.length).toBe(2)

  const templates = await invoke<Array<{ isDefault: boolean; kind: string; subject: string }>>(page2, 'templates.list', {})
  expect(templates.find((template) => template.kind === 'application_email' && template.isDefault)?.subject).toBe(editedSubject)

  const stripeBundle = await invoke<{ application: { status: string } }>(page2, 'applications.get', {
    id: manifest.applications.stripe
  })
  expect(stripeBundle.application.status).toBe('submitted')

  await capture(page2, '32-relaunch-dashboard')
  await relaunch.close()

  expect(errors, `unexpected renderer errors: ${errors.join('\n')}`).toEqual([])
  expect(relaunchErrors, `unexpected renderer errors after relaunch: ${relaunchErrors.join('\n')}`).toEqual([])
})

test('chat settings validate, save, and fail safely without credentials', async () => {
  test.setTimeout(120_000)
  const app = await launch()
  const page = await app.firstWindow()
  const errors = watchErrors(page)

  await page.waitForSelector('.app-shell', { timeout: 30_000 })
  const current = await invoke<{ ai: Record<string, unknown> }>(page, 'settings.get')
  await invoke(page, 'settings.save', { section: 'ai', value: { ...current.ai, mode: 'off' } })
  await open(page, 'Chat', 'Chat')

  await page.getByRole('button', { name: 'Test connection' }).first().click()
  await expect(page.locator('.notice').filter({ hasText: 'Store a Telegram bot token first.' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Send test message' }).first().click()
  await expect(page.locator('.notice').filter({ hasText: 'Store a Telegram bot token first.' })).toHaveCount(2)

  const chatId = page.getByRole('textbox', { name: /Allowed chat ID/ })
  const phone = page.getByRole('textbox', { name: /Your phone number/ })
  const save = page.getByRole('button', { name: 'Save chat settings' })

  await chatId.fill('not-a-chat')
  await phone.fill('12')
  await expect(page.getByText('The Telegram chat ID must be the numeric ID that the bot replies with.')).toBeVisible()
  await expect(page.getByText('The WhatsApp recipient number must contain 7 to 15 digits in international format.')).toBeVisible()
  await expect(save).toBeDisabled()
  await page.locator('.notice').filter({ hasText: 'The Telegram chat ID must be the numeric ID' }).scrollIntoViewIfNeeded()
  await capture(page, '33-chat-validation')

  await chatId.fill('42424242')
  await phone.fill('+49 151 2345678')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Chat settings saved.').first()).toBeVisible()
  await expect
    .poll(async () => {
      const chat = await invoke<{ settings: { telegram: { chatId: string }; whatsapp: { toPhone: string } } }>(page, 'chat.page')
      return `${chat.settings.telegram.chatId}|${chat.settings.whatsapp.toPhone}`
    })
    .toBe('42424242|+49 151 2345678')

  await page.getByRole('switch', { name: 'Enable chat control' }).click()
  await page.getByRole('switch', { name: 'Accept commands' }).click()
  await save.click()
  await expect(page.getByText('Commands are disabled.').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Command', exact: true })).toBeDisabled()
  await expect
    .poll(async () => {
      const chat = await invoke<{ settings: { enabled: boolean; commandsEnabled: boolean } }>(page, 'chat.page')
      return `${chat.settings.enabled}|${chat.settings.commandsEnabled}`
    })
    .toBe('true|false')

  await page.getByRole('switch', { name: 'Accept commands' }).click()
  await page.getByRole('switch', { name: 'Enable chat control' }).click()
  await save.click()
  await expect(page.getByText('Chat is off.').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Command', exact: true })).toBeEnabled()
  await expect
    .poll(async () => {
      const chat = await invoke<{ settings: { enabled: boolean; commandsEnabled: boolean } }>(page, 'chat.page')
      return `${chat.settings.enabled}|${chat.settings.commandsEnabled}`
    })
    .toBe('false|true')

  await page.getByRole('button', { name: 'Test connection' }).nth(1).click()
  await expect(page.locator('.notice').filter({ hasText: 'Store a WhatsApp Cloud API access token first.' }).first()).toBeVisible()

  const verifyToken = 'e2e-verify-token-123456'
  await page.getByRole('textbox', { name: 'WhatsApp verify token' }).fill(verifyToken)
  await page.getByRole('button', { name: 'Save WhatsApp verify token' }).click()
  await expect(page.getByText('WhatsApp verify token stored in the macOS keychain.').first()).toBeVisible()
  await expect
    .poll(async () => (await invoke<{ secrets: { whatsappVerifyToken: boolean } }>(page, 'chat.page')).secrets.whatsappVerifyToken)
    .toBe(true)
  await expect(page.locator('body')).not.toContainText(verifyToken)

  await page.getByTitle('Remove WhatsApp verify token').click()
  const removeDialog = page.getByRole('dialog')
  await expect(removeDialog).toContainText('Remove this secret?')
  await removeDialog.getByRole('button', { name: 'Remove secret' }).click()
  await expect
    .poll(async () => (await invoke<{ secrets: { whatsappVerifyToken: boolean } }>(page, 'chat.page')).secrets.whatsappVerifyToken)
    .toBe(false)

  await page.getByText('Security model').scrollIntoViewIfNeeded()
  await capture(page, '34-chat-security')
  await page.getByText('Loopback webhook').scrollIntoViewIfNeeded()
  await capture(page, '35-chat-channels')

  await app.close()
  expect(errors, `unexpected renderer errors: ${errors.join('\n')}`).toEqual([])
})
