export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function parseJsonObject<T extends object>(text: string | null | undefined, fallback: T): T {
  const parsed = parseJson<unknown>(text, fallback)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
  return fallback
}
