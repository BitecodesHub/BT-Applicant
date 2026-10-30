export interface CountryOption {
  code: string
  name: string
  region: string
}

export const COUNTRIES: CountryOption[] = [
  { code: 'US', name: 'United States', region: 'North America' },
  { code: 'CA', name: 'Canada', region: 'North America' },
  { code: 'MX', name: 'Mexico', region: 'North America' },
  { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  { code: 'IE', name: 'Ireland', region: 'Europe' },
  { code: 'DE', name: 'Germany', region: 'Europe' },
  { code: 'FR', name: 'France', region: 'Europe' },
  { code: 'NL', name: 'Netherlands', region: 'Europe' },
  { code: 'BE', name: 'Belgium', region: 'Europe' },
  { code: 'LU', name: 'Luxembourg', region: 'Europe' },
  { code: 'CH', name: 'Switzerland', region: 'Europe' },
  { code: 'AT', name: 'Austria', region: 'Europe' },
  { code: 'ES', name: 'Spain', region: 'Europe' },
  { code: 'PT', name: 'Portugal', region: 'Europe' },
  { code: 'IT', name: 'Italy', region: 'Europe' },
  { code: 'SE', name: 'Sweden', region: 'Europe' },
  { code: 'NO', name: 'Norway', region: 'Europe' },
  { code: 'DK', name: 'Denmark', region: 'Europe' },
  { code: 'FI', name: 'Finland', region: 'Europe' },
  { code: 'IS', name: 'Iceland', region: 'Europe' },
  { code: 'PL', name: 'Poland', region: 'Europe' },
  { code: 'CZ', name: 'Czechia', region: 'Europe' },
  { code: 'SK', name: 'Slovakia', region: 'Europe' },
  { code: 'HU', name: 'Hungary', region: 'Europe' },
  { code: 'RO', name: 'Romania', region: 'Europe' },
  { code: 'BG', name: 'Bulgaria', region: 'Europe' },
  { code: 'GR', name: 'Greece', region: 'Europe' },
  { code: 'HR', name: 'Croatia', region: 'Europe' },
  { code: 'SI', name: 'Slovenia', region: 'Europe' },
  { code: 'EE', name: 'Estonia', region: 'Europe' },
  { code: 'LV', name: 'Latvia', region: 'Europe' },
  { code: 'LT', name: 'Lithuania', region: 'Europe' },
  { code: 'CY', name: 'Cyprus', region: 'Europe' },
  { code: 'MT', name: 'Malta', region: 'Europe' },
  { code: 'UA', name: 'Ukraine', region: 'Europe' },
  { code: 'RS', name: 'Serbia', region: 'Europe' },
  { code: 'TR', name: 'Türkiye', region: 'Europe' },
  { code: 'AE', name: 'United Arab Emirates', region: 'Middle East' },
  { code: 'SA', name: 'Saudi Arabia', region: 'Middle East' },
  { code: 'QA', name: 'Qatar', region: 'Middle East' },
  { code: 'KW', name: 'Kuwait', region: 'Middle East' },
  { code: 'BH', name: 'Bahrain', region: 'Middle East' },
  { code: 'OM', name: 'Oman', region: 'Middle East' },
  { code: 'IL', name: 'Israel', region: 'Middle East' },
  { code: 'JO', name: 'Jordan', region: 'Middle East' },
  { code: 'EG', name: 'Egypt', region: 'Africa' },
  { code: 'ZA', name: 'South Africa', region: 'Africa' },
  { code: 'NG', name: 'Nigeria', region: 'Africa' },
  { code: 'KE', name: 'Kenya', region: 'Africa' },
  { code: 'GH', name: 'Ghana', region: 'Africa' },
  { code: 'MA', name: 'Morocco', region: 'Africa' },
  { code: 'IN', name: 'India', region: 'Asia Pacific' },
  { code: 'PK', name: 'Pakistan', region: 'Asia Pacific' },
  { code: 'BD', name: 'Bangladesh', region: 'Asia Pacific' },
  { code: 'LK', name: 'Sri Lanka', region: 'Asia Pacific' },
  { code: 'NP', name: 'Nepal', region: 'Asia Pacific' },
  { code: 'SG', name: 'Singapore', region: 'Asia Pacific' },
  { code: 'MY', name: 'Malaysia', region: 'Asia Pacific' },
  { code: 'ID', name: 'Indonesia', region: 'Asia Pacific' },
  { code: 'PH', name: 'Philippines', region: 'Asia Pacific' },
  { code: 'VN', name: 'Vietnam', region: 'Asia Pacific' },
  { code: 'TH', name: 'Thailand', region: 'Asia Pacific' },
  { code: 'JP', name: 'Japan', region: 'Asia Pacific' },
  { code: 'KR', name: 'South Korea', region: 'Asia Pacific' },
  { code: 'CN', name: 'China', region: 'Asia Pacific' },
  { code: 'HK', name: 'Hong Kong', region: 'Asia Pacific' },
  { code: 'TW', name: 'Taiwan', region: 'Asia Pacific' },
  { code: 'AU', name: 'Australia', region: 'Asia Pacific' },
  { code: 'NZ', name: 'New Zealand', region: 'Asia Pacific' },
  { code: 'BR', name: 'Brazil', region: 'Latin America' },
  { code: 'AR', name: 'Argentina', region: 'Latin America' },
  { code: 'CL', name: 'Chile', region: 'Latin America' },
  { code: 'CO', name: 'Colombia', region: 'Latin America' },
  { code: 'PE', name: 'Peru', region: 'Latin America' },
  { code: 'UY', name: 'Uruguay', region: 'Latin America' },
  { code: 'PY', name: 'Paraguay', region: 'Latin America' },
  { code: 'CR', name: 'Costa Rica', region: 'Latin America' },
  { code: 'PA', name: 'Panama', region: 'Latin America' },
  { code: 'JM', name: 'Jamaica', region: 'Caribbean' },
  { code: 'TT', name: 'Trinidad and Tobago', region: 'Caribbean' },
  { code: 'BB', name: 'Barbados', region: 'Caribbean' },
  { code: 'BZ', name: 'Belize', region: 'Caribbean' },
  { code: 'DM', name: 'Dominica', region: 'Caribbean' },
  { code: 'GD', name: 'Grenada', region: 'Caribbean' }
]

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]))

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  return COUNTRY_BY_CODE.get(code.toUpperCase())?.name ?? code.toUpperCase()
}

export function isKnownCountry(code: string): boolean {
  return COUNTRY_BY_CODE.has(code.toUpperCase())
}

export function countryByCode(code: string): CountryOption | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase())
}

export const COMMON_COUNTRY_CODES = ['US', 'GB', 'DE', 'NL', 'CA', 'AU', 'IE', 'SG', 'AE', 'IN']
