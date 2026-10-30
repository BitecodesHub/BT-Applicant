export interface ParsedSalary {
  min: number | null
  max: number | null
  currency: string | null
  period: 'year' | 'month' | 'hour' | null
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  'C$': 'CAD',
  A$: 'AUD'
}

const SALARY_CONTEXT =
  /\b(salary|compensation|compensation package|comp|pay range|pay|base|remuneration|per annum|annual|annually|hourly|monthly|per hour|per month|per year|rate|ote)\b/i

function toAmount(raw: string, suffix: string | undefined): number {
  const numeric = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return NaN
  const multiplier = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1
  return Math.round(numeric * multiplier)
}

function currencyFrom(symbol: string | undefined, code: string | undefined): string | null {
  if (code) return code.toUpperCase()
  if (!symbol) return null
  return CURRENCY_BY_SYMBOL[symbol] ?? null
}

/**
 * Extracts a salary range from free text. Returns null rather than guessing:
 * a bare number without currency or salary context is ignored.
 */
export function parseSalary(text: string): ParsedSalary | null {
  if (!text) return null
  const sample = text.slice(0, 20_000)

  const rangePattern =
    /(?:(C\$|A\$|[$€£₹¥])|(USD|EUR|GBP|INR|CAD|AUD|JPY))?\s?(\d[\d,.]*)\s*(k|m)?\s*(?:-|–|—|to)\s*(?:(C\$|A\$|[$€£₹¥])|(USD|EUR|GBP|INR|CAD|AUD|JPY))?\s?(\d[\d,.]*)\s*(k|m)?/i

  const range = rangePattern.exec(sample)
  if (range) {
    const index = range.index
    const contextWindow = sample.slice(Math.max(0, index - 80), Math.min(sample.length, index + range[0].length + 80))
    const currency = currencyFrom(range[1] ?? range[5], range[2] ?? range[6])
    if (!currency && !SALARY_CONTEXT.test(contextWindow)) return null
    const min = toAmount(range[3] ?? '', range[4] ?? undefined)
    const max = toAmount(range[7] ?? '', range[8] ?? undefined)
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    if (min < 100 || max < 100 || max < min) return null
    if (max > 100_000_000) return null
    return {
      min,
      max,
      currency,
      period: detectPeriod(contextWindow, max)
    }
  }

  const singlePattern = /(?:(C\$|A\$|[$€£₹¥])|(USD|EUR|GBP|INR|CAD|AUD|JPY))\s?(\d[\d,.]*)\s*(k|m)?/i
  const single = singlePattern.exec(sample)
  if (single) {
    const index = single.index
    const contextWindow = sample.slice(Math.max(0, index - 80), Math.min(sample.length, index + single[0].length + 80))
    if (!SALARY_CONTEXT.test(contextWindow)) return null
    const amount = toAmount(single[3] ?? '', single[4] ?? undefined)
    if (!Number.isFinite(amount) || amount < 100 || amount > 100_000_000) return null
    return {
      min: amount,
      max: null,
      currency: currencyFrom(single[1], single[2]),
      period: detectPeriod(contextWindow, amount)
    }
  }

  return null
}

function detectPeriod(context: string, amount: number): 'year' | 'month' | 'hour' | null {
  if (/\b(per hour|hourly|\/hour|\/hr|an hour)\b/i.test(context)) return 'hour'
  if (/\b(per month|monthly|\/month|a month)\b/i.test(context)) return 'month'
  if (/\b(per year|per annum|annual|annually|\/year|\/yr|a year)\b/i.test(context)) return 'year'
  if (amount < 500) return 'hour'
  if (amount < 20_000) return 'month'
  return 'year'
}
