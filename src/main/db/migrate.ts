import type { Db } from './database'
import { migrations, type Migration } from './migrations'

export interface MigrationResult {
  applied: number
  version: number
}

export function applyMigrations(db: Db, list: Migration[] = migrations): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const rows = db.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')
  const applied = new Set(rows.map((row) => row.version))
  const ordered = [...list].sort((a, b) => a.version - b.version)

  let count = 0
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue
    db.tx(() => {
      db.exec(migration.sql)
      db.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        Date.now()
      )
    })
    count += 1
  }

  db.clearStatementCache()
  const current = db.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')
  return { applied: count, version: current?.version ?? 0 }
}

export function currentSchemaVersion(db: Db): number {
  const table = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
  )
  if (!table) return 0
  const row = db.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')
  return row?.version ?? 0
}
