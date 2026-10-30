import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSection, saveSection } from '@main/core/settings'
import { recordAiFailure } from '@main/db/repos/ai'
import { createTestContext, setAiMode, type TestContext } from './helpers'

let ctx: TestContext

beforeEach(() => {
  ctx = createTestContext()
})

afterEach(() => {
  ctx.close()
})

function complete() {
  return ctx.ai.complete({ purpose: 'test', system: 'system', prompt: 'prompt' })
}

describe('AI overlay', () => {
  it('fails closed when AI is turned off', async () => {
    setAiMode(ctx.db, 'off')
    expect(ctx.ai.isEnabled()).toBe(false)
    const result = await complete()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('disabled')
    expect(result.text).toBeNull()
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_calls')?.n).toBe(0)
  })

  it('reports simulated outages explicitly', async () => {
    setAiMode(ctx.db, 'simulated_outage')
    const result = await complete()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('simulated_outage')
    expect(ctx.ai.isEnabled()).toBe(false)
  })

  it('reports when no provider is configured', async () => {
    const ai = getSection(ctx.db, 'ai')
    saveSection(ctx.db, 'ai', {
      ...ai,
      mode: 'enhanced',
      chain: ['openai'],
      ollamaBaseUrl: ''
    })
    expect(ctx.ai.isEnabled()).toBe(false)
    const result = await complete()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_provider')
  })

  it('enforces the daily AI call budget', async () => {
    const ai = getSection(ctx.db, 'ai')
    saveSection(ctx.db, 'ai', { ...ai, mode: 'enhanced', chain: ['ollama'], maxCallsPerDay: 0 })
    const result = await complete()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('quota')
  })

  it('skips providers whose circuit is open', async () => {
    const ai = getSection(ctx.db, 'ai')
    saveSection(ctx.db, 'ai', { ...ai, mode: 'enhanced', chain: ['ollama'] })
    for (let index = 0; index < 3; index += 1) {
      recordAiFailure(ctx.db, 'ollama', 'connection refused')
    }

    const health = ctx.ai.health()
    expect(health[0]?.circuitState).toBe('open')
    expect(health[0]?.consecutiveFailures).toBe(3)

    const result = await complete()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('error')
    expect(result.error).toContain('circuit open')
  })

  it('reports configured providers in health output', () => {
    const health = ctx.ai.health()
    expect(health.map((provider) => provider.id)).toEqual(['ollama', 'anthropic', 'openai', 'gemini'])
    expect(health[0]?.label).toContain('Ollama')
    expect(health[0]?.model).toBe('llama3.2')
    expect(health[0]?.circuitState).toBe('closed')
  })
})
