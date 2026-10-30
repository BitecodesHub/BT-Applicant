import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pino, { type Logger } from 'pino'

const REDACT_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'token',
  '*.token',
  '*.*.token',
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  'secret',
  '*.secret',
  '*.*.secret',
  'authorization',
  'headers.authorization',
  '*.authorization',
  'smtp.password',
  'appPassword',
  '*.appPassword',
  'raw',
  '*.raw'
]

export interface LoggerOptions {
  dir: string
  level?: string
  pretty?: boolean
}

let rootLogger: Logger | null = null
let logFilePath: string | null = null

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > 8 * 1024 * 1024) {
      renameSync(file, `${file}.1`)
    }
  } catch {
    // Rotation is best effort; a failure must never prevent logging.
  }
}

export function createLogger(options: LoggerOptions): Logger {
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, 'app.log')
  logFilePath = file
  rotateIfNeeded(file)

  const destination = options.pretty
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' }
      })
    : pino.destination({ dest: file, sync: true, mkdir: true })

  rootLogger = pino(
    {
      level: options.level ?? 'info',
      base: { app: 'bt-applicant' },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    destination
  )
  return rootLogger
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = pino({ level: 'silent', redact: { paths: REDACT_PATHS, censor: '[redacted]' } })
  }
  return rootLogger
}

export function getLogFilePath(): string | null {
  return logFilePath
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings)
}
