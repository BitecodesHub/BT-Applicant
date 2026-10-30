import { COUNTRIES } from '../../shared/countries'

const ALIASES: Record<string, string[]> = {
  US: ['united states', 'usa', 'u.s.', 'u.s.a', 'america', 'new york', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'denver', 'atlanta', 'remote us', 'us remote'],
  GB: ['united kingdom', 'uk', 'u.k.', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'manchester', 'edinburgh', 'bristol', 'leeds', 'cambridge'],
  IE: ['ireland', 'dublin', 'cork', 'galway'],
  DE: ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'stuttgart', 'düsseldorf'],
  FR: ['france', 'paris', 'lyon', 'toulouse', 'marseille'],
  NL: ['netherlands', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'the hague', 'eindhoven'],
  BE: ['belgium', 'brussels', 'bruxelles', 'antwerp'],
  LU: ['luxembourg'],
  CH: ['switzerland', 'zurich', 'zürich', 'geneva', 'basel', 'lausanne'],
  AT: ['austria', 'vienna', 'wien', 'graz'],
  ES: ['spain', 'madrid', 'barcelona', 'valencia', 'seville'],
  PT: ['portugal', 'lisbon', 'lisboa', 'porto'],
  IT: ['italy', 'milan', 'milano', 'rome', 'roma', 'turin'],
  SE: ['sweden', 'stockholm', 'gothenburg', 'malmö'],
  NO: ['norway', 'oslo', 'bergen'],
  DK: ['denmark', 'copenhagen', 'københavn', 'aarhus'],
  FI: ['finland', 'helsinki', 'espoo'],
  IS: ['iceland', 'reykjavik'],
  PL: ['poland', 'warsaw', 'warszawa', 'krakow', 'kraków', 'wroclaw', 'gdańsk'],
  CZ: ['czechia', 'czech republic', 'prague', 'praha', 'brno'],
  SK: ['slovakia', 'bratislava'],
  HU: ['hungary', 'budapest'],
  RO: ['romania', 'bucharest', 'cluj'],
  BG: ['bulgaria', 'sofia'],
  GR: ['greece', 'athens', 'thessaloniki'],
  HR: ['croatia', 'zagreb', 'split'],
  SI: ['slovenia', 'ljubljana'],
  EE: ['estonia', 'tallinn'],
  LV: ['latvia', 'riga'],
  LT: ['lithuania', 'vilnius'],
  CY: ['cyprus', 'nicosia', 'limassol'],
  MT: ['malta', 'valletta'],
  UA: ['ukraine', 'kyiv', 'kiev', 'lviv'],
  RS: ['serbia', 'belgrade'],
  TR: ['turkey', 'türkiye', 'istanbul', 'ankara', 'izmir'],
  AE: ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah'],
  SA: ['saudi arabia', 'riyadh', 'jeddah'],
  QA: ['qatar', 'doha'],
  KW: ['kuwait'],
  BH: ['bahrain', 'manama'],
  OM: ['oman', 'muscat'],
  IL: ['israel', 'tel aviv', 'jerusalem', 'haifa'],
  JO: ['jordan', 'amman'],
  EG: ['egypt', 'cairo', 'alexandria'],
  ZA: ['south africa', 'cape town', 'johannesburg', 'durban', 'pretoria'],
  NG: ['nigeria', 'lagos', 'abuja'],
  KE: ['kenya', 'nairobi'],
  GH: ['ghana', 'accra'],
  MA: ['morocco', 'casablanca', 'rabat'],
  IN: ['india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi', 'hyderabad', 'pune', 'chennai', 'gurgaon', 'gurugram', 'noida', 'kochi'],
  PK: ['pakistan', 'karachi', 'lahore', 'islamabad'],
  BD: ['bangladesh', 'dhaka'],
  LK: ['sri lanka', 'colombo'],
  NP: ['nepal', 'kathmandu'],
  SG: ['singapore'],
  MY: ['malaysia', 'kuala lumpur', 'penang'],
  ID: ['indonesia', 'jakarta', 'bali'],
  PH: ['philippines', 'manila', 'cebu', 'makati'],
  VN: ['vietnam', 'hanoi', 'ho chi minh', 'saigon'],
  TH: ['thailand', 'bangkok', 'chiang mai'],
  JP: ['japan', 'tokyo', 'osaka', 'kyoto'],
  KR: ['south korea', 'korea', 'seoul', 'busan'],
  CN: ['china', 'shanghai', 'beijing', 'shenzhen', 'hangzhou'],
  HK: ['hong kong'],
  TW: ['taiwan', 'taipei'],
  AU: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra'],
  NZ: ['new zealand', 'auckland', 'wellington', 'christchurch'],
  CA: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton', 'quebec'],
  MX: ['mexico', 'mexico city', 'cdmx', 'guadalajara', 'monterrey'],
  BR: ['brazil', 'são paulo', 'sao paulo', 'rio de janeiro', 'belo horizonte', 'curitiba'],
  AR: ['argentina', 'buenos aires', 'córdoba', 'cordoba'],
  CL: ['chile', 'santiago'],
  CO: ['colombia', 'bogotá', 'bogota', 'medellín', 'medellin'],
  PE: ['peru', 'lima'],
  UY: ['uruguay', 'montevideo'],
  PY: ['paraguay', 'asuncion'],
  CR: ['costa rica', 'san jose'],
  PA: ['panama', 'panama city'],
  JM: ['jamaica', 'kingston'],
  TT: ['trinidad', 'port of spain'],
  BB: ['barbados', 'bridgetown'],
  BZ: ['belize'],
  DM: ['dominica'],
  GD: ['grenada']
}

const COUNTRY_NAMES = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country.code]))

const MATCHERS: { code: string; pattern: RegExp }[] = Object.entries(ALIASES).flatMap(([code, aliases]) =>
  aliases.map((alias) => ({
    code,
    pattern: new RegExp(`(^|[^a-z])${escapeRegExp(alias)}([^a-z]|$)`)
  }))
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORLDWIDE = /(worldwide|anywhere|global|remote worldwide|work from anywhere)/i

export function detectCountry(location: string | null | undefined): string | null {
  if (!location) return null
  const normalized = location.toLowerCase()

  for (const [name, code] of COUNTRY_NAMES) {
    if (normalized.includes(name)) return code
  }

  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(normalized)) return matcher.code
  }

  const explicit = normalized.match(/(?:^|[\s,(\-])(us|usa|uk|uae)(?:$|[\s,)\-])/)
  if (explicit?.[1]) {
    const code = explicit[1] === 'usa' ? 'US' : explicit[1] === 'us' ? 'US' : explicit[1] === 'uk' ? 'GB' : 'AE'
    return code
  }
  return null
}

export function isWorldwideRemote(location: string | null | undefined): boolean {
  return Boolean(location && WORLDWIDE.test(location))
}

export function detectRemoteType(location: string | null | undefined, title: string | null | undefined): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
  const haystack = `${location ?? ''} ${title ?? ''}`.toLowerCase()
  if (/\bhybrid\b/.test(haystack)) return 'hybrid'
  if (/\b(remote|work from home|wfh|distributed|telecommute|anywhere)\b/.test(haystack)) return 'remote'
  if (/\b(on-?site|in-?office|in person)\b/.test(haystack)) return 'onsite'
  return 'unknown'
}

export function normalizeEmploymentType(value: string | null | undefined): 'full_time' | 'part_time' | 'contract' | 'internship' | 'temporary' | 'unknown' {
  if (!value) return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized.includes('intern')) return 'internship'
  if (normalized.includes('part') || normalized.includes('pt')) return 'part_time'
  if (normalized.includes('contract') || normalized.includes('freelance')) return 'contract'
  if (normalized.includes('temp') || normalized.includes('seasonal')) return 'temporary'
  if (normalized.includes('full') || normalized.includes('permanent')) return 'full_time'
  return 'unknown'
}
