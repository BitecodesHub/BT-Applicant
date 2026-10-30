import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DigestSummary } from '../../shared/types'
import { Db } from '../db/database'
import { applyMigrations } from '../db/migrate'
import { seedDefaults } from '../db/seed'
import { recoverInterruptedTasks, removeHeartbeat } from '../db/repos/tasks'
import { expireJobs } from '../db/repos/jobs'
import { markStaleAsUncertain } from '../db/repos/applications'
import { logEvent } from '../db/repos/events'
import { getSection } from '../core/settings'
import { plural } from '../core/text'
import { SecretStore, type SecretCipher } from '../core/secrets'
import { AiService } from './ai'
import { MailService } from './mail'
import { ApplicationService } from './applications'
import { PipelineService } from './pipeline'
import { WorkerService } from './worker'
import { SchedulerService } from './scheduler'
import { ChatService } from './chat/service'
import { enqueue } from '../db/repos/tasks'

export interface ContainerOptions {
  userDataDir: string
  version: string
  cipher: SecretCipher
  onChange?: () => void
  onDigest?: (summary: DigestSummary) => void
}

export interface ContainerPaths {
  userDataDir: string
  database: string
  mockOutbox: string
  resumes: string
}

export class AppContainer {
  readonly db: Db
  readonly paths: ContainerPaths
  readonly secrets: SecretStore
  readonly ai: AiService
  readonly mail: MailService
  readonly applications: ApplicationService
  readonly pipeline: PipelineService
  readonly worker: WorkerService
  readonly scheduler: SchedulerService
  readonly chat: ChatService
  private started = false

  constructor(readonly options: ContainerOptions) {
    const userDataDir = options.userDataDir
    const paths: ContainerPaths = {
      userDataDir,
      database: join(userDataDir, 'bt-applicant.db'),
      mockOutbox: join(userDataDir, 'mock-outbox'),
      resumes: join(userDataDir, 'resumes')
    }
    mkdirSync(dirname(paths.database), { recursive: true })
    mkdirSync(paths.mockOutbox, { recursive: true })
    mkdirSync(paths.resumes, { recursive: true })
    this.paths = paths

    this.db = new Db(paths.database)
    applyMigrations(this.db)
    seedDefaults(this.db)
    this.secrets = new SecretStore(this.db, options.cipher)
    this.ai = new AiService(this.db, this.secrets)
    this.mail = new MailService(this.db, this.secrets, paths.mockOutbox)
    this.applications = new ApplicationService(this.db, this.ai, this.mail)
    this.pipeline = new PipelineService(this.db, this.secrets)

    const workerSettings = getSection(this.db, 'worker')
    this.worker = new WorkerService(this.db, this.pipeline, this.applications, {
      version: options.version,
      concurrency: workerSettings.concurrency,
      pollIntervalMs: workerSettings.pollIntervalMs,
      leaseMs: workerSettings.leaseMs,
      onChange: options.onChange,
      onDigest: options.onDigest
    })
    this.scheduler = new SchedulerService(this.db, (type, payload, idempotencyKey) => {
      enqueue(this.db, { type: type as Parameters<typeof enqueue>[1]['type'], payload, idempotencyKey })
    })
    this.chat = new ChatService({
      db: this.db,
      secrets: this.secrets,
      applications: this.applications,
      onProfileChanged: () => this.pipeline.reEvaluateJobs(200),
      onChange: options.onChange
    })
  }

  start(): void {
    if (this.started) return
    this.started = true
    const recovered = recoverInterruptedTasks(this.db)
    const expired = expireJobs(this.db, Date.now())
    const uncertain = markStaleAsUncertain(this.db, Date.now() - 5 * 60_000)
    logEvent(this.db, {
      category: 'system.startup',
      message: `Startup recovery requeued ${plural(recovered.requeued, 'task')}, dead-lettered ${recovered.dead}, expired ${plural(expired, 'job')}, marked ${plural(uncertain, 'delivery', 'deliveries')} uncertain`,
      actor: 'system'
    })
    this.scheduler.start()
    this.worker.start()
    this.chat.start()
  }

  async stop(): Promise<void> {
    this.scheduler.stop()
    await this.worker.stop()
    await this.chat.stop()
    removeHeartbeat(this.db, this.worker.id)
    this.db.checkpoint()
    this.db.close()
  }

  syncSchedules(): void {
    this.scheduler.sync()
  }
}
