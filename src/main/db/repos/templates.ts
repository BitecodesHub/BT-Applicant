import type { TemplateKind } from '../../../shared/types'
import type { Db } from '../database'

export interface TemplateRecord {
  id: number
  name: string
  kind: TemplateKind
  subject: string
  body: string
  isDefault: boolean
  version: number
  createdAt: number
  updatedAt: number
}

interface TemplateRow {
  id: number
  name: string
  kind: TemplateKind
  subject: string
  body: string
  is_default: number
  version: number
  created_at: number
  updated_at: number
}

function mapTemplate(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    subject: row.subject,
    body: row.body,
    isDefault: row.is_default === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listTemplates(db: Db, kind?: TemplateKind): TemplateRecord[] {
  if (kind) {
    return db
      .all<TemplateRow>('SELECT * FROM templates WHERE kind = ? ORDER BY is_default DESC, name', kind)
      .map(mapTemplate)
  }
  return db.all<TemplateRow>('SELECT * FROM templates ORDER BY kind, is_default DESC, name').map(mapTemplate)
}

export function getTemplate(db: Db, id: number): TemplateRecord | undefined {
  const row = db.get<TemplateRow>('SELECT * FROM templates WHERE id = ?', id)
  return row ? mapTemplate(row) : undefined
}

export function getDefaultTemplate(db: Db, kind: TemplateKind): TemplateRecord | undefined {
  const row = db.get<TemplateRow>('SELECT * FROM templates WHERE kind = ? AND is_default = 1', kind)
  return row ? mapTemplate(row) : undefined
}

export function createTemplate(
  db: Db,
  input: { name: string; kind: TemplateKind; subject: string; body: string; isDefault?: boolean }
): TemplateRecord {
  const now = Date.now()
  const makeDefault = input.isDefault === true
  let id = 0
  db.tx(() => {
    if (makeDefault) db.run('UPDATE templates SET is_default = 0 WHERE kind = ?', input.kind)
    const result = db.run(
      `INSERT INTO templates (name, kind, subject, body, is_default, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      input.name,
      input.kind,
      input.subject,
      input.body,
      makeDefault ? 1 : 0,
      now,
      now
    )
    id = result.lastInsertRowid
    db.run(
      'INSERT INTO template_versions (template_id, subject, body, version, note, created_at) VALUES (?, ?, ?, 1, ?, ?)',
      id,
      input.subject,
      input.body,
      'Initial version',
      now
    )
  })
  return getTemplate(db, id)!
}

export function updateTemplate(
  db: Db,
  id: number,
  input: { name?: string; subject: string; body: string; note?: string }
): TemplateRecord {
  const current = getTemplate(db, id)
  if (!current) throw new Error(`Template ${id} not found`)
  const now = Date.now()
  const nextVersion = current.version + 1
  db.tx(() => {
    db.run(
      `UPDATE templates SET name = ?, subject = ?, body = ?, version = ?, updated_at = ? WHERE id = ?`,
      input.name ?? current.name,
      input.subject,
      input.body,
      nextVersion,
      now,
      id
    )
    db.run(
      'INSERT INTO template_versions (template_id, subject, body, version, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      input.subject,
      input.body,
      nextVersion,
      input.note ?? null,
      now
    )
  })
  return getTemplate(db, id)!
}

export function setDefaultTemplate(db: Db, id: number): TemplateRecord {
  const template = getTemplate(db, id)
  if (!template) throw new Error(`Template ${id} not found`)
  db.tx(() => {
    db.run('UPDATE templates SET is_default = 0 WHERE kind = ?', template.kind)
    db.run('UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?', Date.now(), id)
  })
  return getTemplate(db, id)!
}

export function deleteTemplate(db: Db, id: number): void {
  const template = getTemplate(db, id)
  if (!template) return
  if (template.isDefault) throw new Error('Cannot delete the default template for a kind')
  db.run('DELETE FROM templates WHERE id = ?', id)
}

export interface TemplateVersionRecord {
  id: number
  templateId: number
  subject: string
  body: string
  version: number
  note: string | null
  createdAt: number
}

export function listTemplateVersions(db: Db, templateId: number): TemplateVersionRecord[] {
  return db
    .all<{
      id: number
      template_id: number
      subject: string
      body: string
      version: number
      note: string | null
      created_at: number
    }>('SELECT * FROM template_versions WHERE template_id = ? ORDER BY version DESC', templateId)
    .map((row) => ({
      id: row.id,
      templateId: row.template_id,
      subject: row.subject,
      body: row.body,
      version: row.version,
      note: row.note,
      createdAt: row.created_at
    }))
}
