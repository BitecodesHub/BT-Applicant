import type { ConnectorMeta } from '../../shared/types'
import type { Connector } from './types'
import { greenhouseConnector } from './greenhouse'
import { leverConnector } from './lever'
import { ashbyConnector } from './ashby'
import { smartRecruitersConnector } from './smartrecruiters'
import { workableConnector } from './workable'
import { remotiveConnector } from './remotive'
import { arbeitnowConnector } from './arbeitnow'
import { jobicyConnector } from './jobicy'
import { himalayasConnector } from './himalayas'
import { remoteOkConnector } from './remoteok'
import { museConnector } from './themuse'
import { adzunaConnector } from './adzuna'
import { usaJobsConnector } from './usajobs'
import { jsonLdConnector } from './jsonld'

const ALL: Connector[] = [
  greenhouseConnector,
  leverConnector,
  ashbyConnector,
  smartRecruitersConnector,
  workableConnector,
  remotiveConnector,
  arbeitnowConnector,
  jobicyConnector,
  himalayasConnector,
  remoteOkConnector,
  museConnector,
  adzunaConnector,
  usaJobsConnector,
  jsonLdConnector
]

export const CONNECTORS: Record<string, Connector> = Object.fromEntries(
  ALL.map((connector) => [connector.meta.id, connector])
)

export const CONNECTOR_METAS: ConnectorMeta[] = ALL.map((connector) => connector.meta).sort((a, b) =>
  a.label.localeCompare(b.label)
)

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS[id]
}

export function connectorSupportsCountry(meta: ConnectorMeta, countryCode: string): boolean {
  return meta.countries === 'global' || meta.countries.includes(countryCode.toUpperCase())
}
