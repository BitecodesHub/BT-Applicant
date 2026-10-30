import rawRules from '../../../data/work-authorization-rules.json'
import type { SponsorshipSignal } from '../../shared/types'

export type BlocEffect = 'work_without_sponsorship' | 'residence_route'
export type RouteEffect = 'employer_support_required' | 'employer_sponsorship_required'

export interface AuthorizationBloc {
  id: string
  name: string
  effect: BlocEffect
  members: string[]
  confidence: string
  note: string
  sourceUrl: string
}

export interface BilateralRoute {
  id: string
  name: string
  destination: string
  citizenships: string[]
  effect: RouteEffect
  confidence: string
  note: string
  sourceUrl: string
}

export interface SignalRule {
  id: string
  signal: SponsorshipSignal
  pattern: string
}

export interface RulesFile {
  version: number
  lastVerified: string
  disclaimer: string
  blocs: AuthorizationBloc[]
  bilateralRoutes: BilateralRoute[]
  sponsorshipSignals: SignalRule[]
}

export const rules: RulesFile = rawRules as RulesFile

export interface CompiledSignalRule extends SignalRule {
  regex: RegExp
}

export const compiledSignalRules: CompiledSignalRule[] = rules.sponsorshipSignals.flatMap((rule) => {
  try {
    return [{ ...rule, regex: new RegExp(rule.pattern, 'i') }]
  } catch {
    return []
  }
})

export function findBlocFor(destination: string, citizenships: string[]): AuthorizationBloc | undefined {
  const target = destination.toUpperCase()
  return rules.blocs.find(
    (bloc) => bloc.members.includes(target) && citizenships.some((citizenship) => bloc.members.includes(citizenship.toUpperCase()))
  )
}

export function findBilateralRoutes(destination: string, citizenships: string[]): BilateralRoute[] {
  const target = destination.toUpperCase()
  return rules.bilateralRoutes.filter((route) => {
    if (route.destination !== target) return false
    if (route.citizenships.length === 0) return true
    return citizenships.some((citizenship) => route.citizenships.includes(citizenship.toUpperCase()))
  })
}

export function hasCitizenshipSpecificRoute(destination: string, citizenships: string[]): boolean {
  const target = destination.toUpperCase()
  return rules.bilateralRoutes.some(
    (route) =>
      route.destination === target &&
      route.citizenships.length > 0 &&
      route.citizenships.some((citizenship) => citizenships.includes(citizenship.toUpperCase()))
  )
}

export function ruleSource(ruleId: string): string | null {
  const bloc = rules.blocs.find((item) => item.id === ruleId)
  if (bloc) return bloc.sourceUrl
  const route = rules.bilateralRoutes.find((item) => item.id === ruleId)
  return route?.sourceUrl ?? null
}
