import type { Db } from '../database'
import { ROLE_BY_KEY } from '../../../shared/roles'

export interface RoleSelectionRecord {
  roleKey: string
  title: string
  source: 'catalog' | 'custom'
  createdAt: number
}

interface RoleSelectionRow {
  role_key: string
  title: string
  source: 'catalog' | 'custom'
  created_at: number
}

export function listRoleSelections(db: Db): RoleSelectionRecord[] {
  return db
    .all<RoleSelectionRow>('SELECT * FROM role_selections ORDER BY created_at, role_key')
    .map((row) => ({
      roleKey: row.role_key,
      title: row.title,
      source: row.source,
      createdAt: row.created_at
    }))
}

export function replaceRoleSelections(
  db: Db,
  selections: { roleKey: string; title: string; source: 'catalog' | 'custom' }[]
): RoleSelectionRecord[] {
  const now = Date.now()
  db.tx(() => {
    db.run('DELETE FROM role_selections')
    for (const selection of selections) {
      db.run(
        'INSERT INTO role_selections (role_key, title, source, created_at) VALUES (?, ?, ?, ?)',
        selection.roleKey,
        selection.title,
        selection.source,
        now
      )
    }
  })
  return listRoleSelections(db)
}

export function effectiveRoleTitles(db: Db): string[] {
  const titles: string[] = []
  const seen = new Set<string>()
  const add = (title: string) => {
    const trimmed = title.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) return
    seen.add(key)
    titles.push(trimmed)
  }
  for (const selection of listRoleSelections(db)) {
    if (selection.source === 'custom') {
      add(selection.title)
      continue
    }
    const role = ROLE_BY_KEY.get(selection.roleKey)
    if (!role) continue
    add(role.title)
    for (const alias of role.titleAliases) add(alias)
  }
  return titles
}
