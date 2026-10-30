import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type SqlValue = null | number | bigint | string | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/**
 * Thin synchronous SQLite wrapper around node:sqlite.
 *
 * Synchronous access is deliberate: it removes native-module ABI problems and
 * makes the queue's claim transaction atomic without an async pool.
 */
export class Db {
  readonly raw: DatabaseSync
  private statements = new Map<string, StatementSync>()
  private txDepth = 0

  constructor(filePath: string) {
    this.raw = new DatabaseSync(filePath)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    this.raw.exec('PRAGMA temp_store = MEMORY')
  }

  prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql)
    if (cached) return cached
    const statement = this.raw.prepare(sql)
    this.statements.set(sql, statement)
    return statement
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[]
  }

  run(sql: string, ...params: SqlValue[]): RunResult {
    const result = this.prepare(sql).run(...params)
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid)
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    this.txDepth += 1
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        // A rollback failure means the transaction is already gone.
      }
      throw error
    } finally {
      this.txDepth -= 1
    }
  }

  checkpoint(): void {
    this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  clearStatementCache(): void {
    this.statements.clear()
  }

  close(): void {
    this.statements.clear()
    this.raw.close()
  }
}
