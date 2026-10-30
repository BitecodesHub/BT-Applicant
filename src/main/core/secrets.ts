import type { Db } from '../db/database'

export interface SecretCipher {
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

/**
 * Stores integration secrets (SMTP password, API keys) encrypted with the OS
 * keychain through Electron safeStorage. Secrets never live in plaintext in
 * SQLite, logs, or the settings table.
 */
export class SecretStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: SecretCipher
  ) {}

  set(key: string, value: string): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      this.delete(key)
      return
    }
    this.db.run(
      `INSERT INTO secrets (key, ciphertext, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      key,
      this.cipher.encrypt(trimmed),
      Date.now()
    )
  }

  get(key: string): string | null {
    const row = this.db.get<{ ciphertext: string }>('SELECT ciphertext FROM secrets WHERE key = ?', key)
    if (!row) return null
    try {
      return this.cipher.decrypt(row.ciphertext)
    } catch {
      return null
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    this.db.run('DELETE FROM secrets WHERE key = ?', key)
  }

  listKeys(): string[] {
    return this.db.all<{ key: string }>('SELECT key FROM secrets ORDER BY key').map((row) => row.key)
  }
}

/** Test-only cipher. Never used by the running application. */
export function createMemoryCipher(): SecretCipher {
  return {
    encrypt: (plainText) => `plain:${Buffer.from(plainText, 'utf8').toString('base64')}`,
    decrypt: (cipherText) => {
      if (!cipherText.startsWith('plain:')) throw new Error('Unsupported ciphertext')
      return Buffer.from(cipherText.slice(6), 'base64').toString('utf8')
    }
  }
}
