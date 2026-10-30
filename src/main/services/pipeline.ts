import type { Db } from '../db/database'
import type { SecretStore } from '../core/secrets'
import { getSection } from '../core/settings'
import { logEvent } from '../db/repos/events'
import {
  closeMissingJobs,
  findDuplicateCandidates,
  getJob,
  getEvaluation,
  listJobsNeedingEvaluation,
  upsertEvaluation,
  upsertJob,
  type JobInsert,
  type JobRecord
} from '../db/repos/jobs'
import { getSource, listSources, logSourceFetch, recordSourceFailure, recordSourceSuccess } from '../db/repos/sources'
import {
  getProfile,
  getTargetCountry,
  listTargetCountries,
  listWorkAuthorizations,
  listResumes,
  profileCompleteness,
  profileFingerprint,
  touchTargetRun,
  type TargetCountryRecord
} from '../db/repos/profile'
import { createApplication, getActiveApplicationForJob } from '../db/repos/applications'
import { enqueue } from '../db/repos/tasks'
import { effectiveRoleTitles } from '../db/repos/roles'
import { getConnector } from '../connectors/registry'
import { normalizeJob, computeDedupeKey, computeFingerprint, stripHtml } from './../pipeline/normalize'
import { findDuplicate, canonicalizeUrl } from '../pipeline/dedupe'
import { evaluateTargetMatch } from '../pipeline/targeting'
import { evaluateEligibility, isEligibleVerdict } from '../eligibility/engine'
import { scoreJob } from '../pipeline/score'
import { decideApplicationRoute } from '../pipeline/routing'
import { detectCountry, detectRemoteType, isWorldwideRemote } from '../pipeline/location'
import type { EligibilityResult, RouteDecision } from '../../shared/types'

export interface PollResult {
  sourceId: string
  countryCode: string
  fetched: number
  inserted: number
  duplicates: number
  filtered: number
  closed: number
  error: string | null
}

export interface EvaluationOutcome {
  jobId: number
  verdict: EligibilityResult['verdict']
  score: number
  route: RouteDecision
  applicationId: number | null
  reason: string
}

const MAX_JOBS_PER_POLL = 400

function mergeRoleTitles(base: string[], roleTitles: string[]): string[] {
  if (roleTitles.length === 0) return base
  const merged = [...base]
  const seen = new Set(base.map((title) => title.trim().toLowerCase()))
  for (const title of roleTitles) {
    const key = title.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(title)
  }
  return merged
}

export class PipelineService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore
  ) {}

  async pollSource(sourceId: string, targetCountryId: number, signal: AbortSignal, taskId?: number): Promise<PollResult> {
    const source = getSource(this.db, sourceId)
    if (!source) throw new Error(`Source ${sourceId} not found`)
    const target = getTargetCountry(this.db, targetCountryId)
    if (!target) throw new Error(`Target country ${targetCountryId} not found`)
    const connector = getConnector(source.connector)
    if (!connector) throw new Error(`Connector ${source.connector} is not registered`)
    if (!source.enabled) {
      return { sourceId, countryCode: target.countryCode, fetched: 0, inserted: 0, duplicates: 0, filtered: 0, closed: 0, error: null }
    }
    if (connector.meta.countries !== 'global' && !connector.meta.countries.includes(target.countryCode.toUpperCase())) {
      return { sourceId, countryCode: target.countryCode, fetched: 0, inserted: 0, duplicates: 0, filtered: 0, closed: 0, error: null }
    }

    const startedAt = Date.now()
    const roleTitles = effectiveRoleTitles(this.db)
    const searchTitles = mergeRoleTitles(target.jobTitles, roleTitles)
    const credentials: Record<string, string> = {}
    for (const field of connector.meta.credentialFields) {
      const value = this.secrets.get(`source.${source.id}.${field.key}`)
      if (value) credentials[field.key] = value
    }

    let rawJobs
    try {
      rawJobs = await connector.fetch({
        source,
        credentials,
        target: {
          countryCode: target.countryCode,
          jobTitles: searchTitles,
          keywords: target.keywords,
          remotePreference: target.remotePreference,
          pageLimit: 2
        },
        fetchImpl: fetch,
        signal,
        userAgent: 'BTApplicant/0.1 (+personal job search; respects API terms)'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordSourceFailure(this.db, source.id, message)
      logSourceFetch(this.db, {
        sourceId: source.id,
        startedAt,
        finishedAt: Date.now(),
        status: 'error',
        items: 0,
        newItems: 0,
        error: message
      })
      logEvent(this.db, {
        category: 'source.failed',
        level: 'error',
        message: `Source ${source.label} failed: ${message}`,
        sourceId: source.id,
        taskId: taskId ?? null,
        detail: { countryCode: target.countryCode }
      })
      throw error
    }

    signal.throwIfAborted()

    const automation = getSection(this.db, 'automation')
    const profileHash = profileFingerprint(this.db)
    const targetConfig = {
      countryCode: target.countryCode,
      jobTitles: searchTitles,
      keywords: target.keywords,
      excludeKeywords: target.excludeKeywords,
      remotePreference: target.remotePreference,
      minSalary: target.minSalary,
      currency: target.currency
    }

    const seen = new Set<string>()
    let inserted = 0
    let duplicates = 0
    let filtered = 0
    const uniqueRaw = rawJobs
      .filter((job) => {
        if (!job.title || !job.url) return false
        const key = `${job.externalId}|${job.url}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_JOBS_PER_POLL)

    for (const raw of uniqueRaw) {
      signal.throwIfAborted()
      const remoteHint =
        raw.remoteType === 'remote' ||
        isWorldwideRemote(raw.locationRaw) ||
        detectRemoteType(raw.locationRaw, raw.title) === 'remote'
      const normalized = normalizeJob(raw, {
        sourceId: source.id,
        sourceName: source.label,
        fallbackCountry: remoteHint ? target.countryCode : (raw.countryCode ?? detectCountry(raw.locationRaw))
      })

      const match = evaluateTargetMatch(
        {
          title: normalized.job.title,
          company: normalized.job.company,
          descriptionText: normalized.job.descriptionText,
          countryCode: normalized.job.countryCode,
          remoteType: normalized.job.remoteType,
          salaryMin: normalized.job.salaryMin,
          salaryCurrency: normalized.job.salaryCurrency
        },
        targetConfig,
        automation.excludeCompanies
      )
      if (!match.keep) {
        filtered += 1
        continue
      }

      const dedupeKey = computeDedupeKey(normalized.job.company, normalized.job.title, normalized.job.countryCode)
      const fingerprint = computeFingerprint(normalized.job.title, normalized.job.company, normalized.job.descriptionText)
      const duplicate = findDuplicate(this.db, {
        dedupeKey,
        fingerprint,
        company: normalized.job.company,
        title: normalized.job.title,
        locationRaw: normalized.job.locationRaw,
        url: canonicalizeUrl(normalized.job.url),
        countryCode: normalized.job.countryCode
      })
      if (duplicate) {
        duplicates += 1
        logEvent(this.db, {
          category: 'job.duplicate',
          message: `${normalized.job.title} at ${normalized.job.company} matched existing job #${duplicate.id}`,
          jobId: duplicate.id,
          sourceId: source.id,
          detail: { reason: duplicate.reason, similarity: duplicate.similarity }
        })
        continue
      }

      const insert: JobInsert = {
        ...normalized.job,
        dedupeKey,
        fingerprint
      }
      const { id, created } = upsertJob(this.db, insert, normalized.sponsor.evidence, normalized.sponsor.statements)
      if (created) {
        inserted += 1
        logEvent(this.db, {
          category: 'job.discovered',
          message: `Found ${normalized.job.title} at ${normalized.job.company}`,
          jobId: id,
          sourceId: source.id,
          detail: {
            countryCode: normalized.job.countryCode,
            location: normalized.job.locationRaw,
            remoteType: normalized.job.remoteType,
            salaryMin: normalized.job.salaryMin,
            source: source.label
          }
        })
      }

      enqueue(this.db, {
        type: 'job.evaluate',
        payload: { jobId: id },
        priority: 2,
        idempotencyKey: `evaluate:${id}:${profileHash}`
      })
    }

    let closed = 0
    if (source.config.closeMissing === true) {
      closed = closeMissingJobs(this.db, source.id, uniqueRaw.map((job) => job.externalId))
    }

    recordSourceSuccess(this.db, source.id, uniqueRaw.length)
    logSourceFetch(this.db, {
      sourceId: source.id,
      startedAt,
      finishedAt: Date.now(),
      status: 'ok',
      items: uniqueRaw.length,
      newItems: inserted,
      error: null
    })
    logEvent(this.db, {
      category: 'source.fetched',
      message: `Source ${source.label} returned ${uniqueRaw.length} jobs for ${target.countryCode}`,
      sourceId: source.id,
      taskId: taskId ?? null,
      detail: { fetched: uniqueRaw.length, inserted, duplicates, filtered, closed }
    })

    return {
      sourceId,
      countryCode: target.countryCode,
      fetched: uniqueRaw.length,
      inserted,
      duplicates,
      filtered,
      closed,
      error: null
    }
  }

  async pollTarget(targetCountryId: number, signal: AbortSignal, taskId?: number): Promise<PollResult[]> {
    const target = getTargetCountry(this.db, targetCountryId)
    if (!target) throw new Error(`Target country ${targetCountryId} not found`)
    if (!target.enabled) return []
    const automation = getSection(this.db, 'automation')
    const results: PollResult[] = []
    for (const source of listSources(this.db)) {
      if (!source.enabled) continue
      if (source.countries.length > 0 && !source.countries.includes(target.countryCode.toUpperCase())) continue
      if (signal.aborted) break
      try {
        results.push(await this.pollSource(source.id, targetCountryId, signal, taskId))
      } catch (error) {
        results.push({
          sourceId: source.id,
          countryCode: target.countryCode,
          fetched: 0,
          inserted: 0,
          duplicates: 0,
          filtered: 0,
          closed: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    touchTargetRun(this.db, target.id)
    logEvent(this.db, {
      category: 'target.polled',
      message: `Polled ${results.length} sources for ${target.countryCode}`,
      taskId: taskId ?? null,
      detail: {
        sources: results.length,
        inserted: results.reduce((sum, item) => sum + item.inserted, 0),
        errors: results.filter((item) => item.error).length,
        automationPaused: automation.paused
      }
    })
    return results
  }

  evaluateJob(jobId: number): EvaluationOutcome {
    const job = getJob(this.db, jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)
    const profile = getProfile(this.db)
    const authorizations = listWorkAuthorizations(this.db)
    const profileHash = profileFingerprint(this.db)
    const targets = listTargetCountries(this.db)
    const target = job.countryCode ? targets.find((item) => item.countryCode === job.countryCode) ?? null : null
    const roleTitles = effectiveRoleTitles(this.db)

    const eligibility = evaluateEligibility(
      {
        countryCode: job.countryCode,
        sponsorSignal: job.sponsorSignal,
        workAuthStatements: job.workAuthStatements
      },
      {
        citizenships: profile.citizenships,
        residenceCountry: profile.residenceCountry,
        authorizations: authorizations.map((item) => ({
          countryCode: item.countryCode,
          status: item.status,
          validUntil: item.validUntil,
          needsSponsorship: item.needsSponsorship
        }))
      }
    )

    const source = getSource(this.db, job.sourceId)
    const connector = source ? getConnector(source.connector) : null
    const score = scoreJob(
      {
        title: job.title,
        descriptionText: job.descriptionText,
        countryCode: job.countryCode,
        remoteType: job.remoteType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        postedAt: job.postedAt,
        skills: job.skills,
        applicationEmail: job.applicationEmail,
        applyUrl: job.applyUrl
      },
      target
        ? {
            countryCode: target.countryCode,
            jobTitles: mergeRoleTitles(target.jobTitles, roleTitles),
            minSalary: target.minSalary,
            currency: target.currency,
            remotePreference: target.remotePreference
          }
        : null,
      { skills: profile.skills, yearsExperience: profile.yearsExperience },
      connector?.meta.kind ?? 'aggregator'
    )

    upsertEvaluation(this.db, job.id, eligibility, score.total, score, profileHash)

    const route = decideApplicationRoute(job)
    const automation = getSection(this.db, 'automation')
    const resumes = listResumes(this.db)
    const completeness = profileCompleteness(profile, resumes.length, authorizations.length)

    logEvent(this.db, {
      category:
        eligibility.verdict === 'eligible' || eligibility.verdict === 'eligible_needs_sponsorship_offered'
          ? 'job.eligible'
          : eligibility.verdict === 'ineligible'
            ? 'job.ineligible'
            : 'job.needs_review',
      level: eligibility.verdict === 'needs_review' ? 'warn' : 'info',
      message:
        eligibility.verdict === 'ineligible'
          ? `${job.title} at ${job.company} is not eligible: ${eligibility.reasons[0]?.message ?? 'no reason'}`
          : `${job.title} at ${job.company}: ${eligibility.verdict.replace(/_/g, ' ')} (score ${score.total})`,
      jobId: job.id,
      detail: {
        verdict: eligibility.verdict,
        score: score.total,
        requiresSponsorship: eligibility.requiresSponsorship,
        sponsorSignal: eligibility.sponsorSignal,
        route: route.channel
      }
    })

    if (!isEligibleVerdict(eligibility.verdict)) {
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: null, reason: 'Not eligible for an application.' }
    }
    if (job.status !== 'active') {
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: null, reason: 'Job is no longer active.' }
    }
    if (score.total < automation.minScore) {
      logEvent(this.db, {
        category: 'job.below_threshold',
        message: `Skipped ${job.title}: score ${score.total} is below the minimum ${automation.minScore}`,
        jobId: job.id
      })
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: null, reason: 'Below the minimum score.' }
    }
    if (!completeness.readyToApply) {
      logEvent(this.db, {
        category: 'job.profile_incomplete',
        level: 'warn',
        message: `Cannot apply to ${job.title}: ${completeness.missing.join(', ')}`,
        jobId: job.id
      })
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: null, reason: 'Profile or resume incomplete.' }
    }
    if (!automation.allowedChannels.includes(route.channel)) {
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: null, reason: `Channel ${route.channel} is disabled.` }
    }

    const existing = getActiveApplicationForJob(this.db, job.id)
    if (existing) {
      return { jobId: job.id, verdict: eligibility.verdict, score: score.total, route, applicationId: existing.id, reason: 'Application already exists.' }
    }

    const { application, created } = createApplication(this.db, {
      jobId: job.id,
      channel: route.channel,
      channelReason: route.reason,
      decisionEvidence: route.evidence,
      status: route.channel === 'manual' ? 'needs_human' : 'draft',
      recipient: route.recipient ?? null,
      applyUrl: route.applyUrl ?? null,
    })

    if (created) {
      logEvent(this.db, {
        category: 'application.created',
        message:
          route.channel === 'manual'
            ? `Manual action required for ${job.title}: ${route.reason}`
            : `Application draft created for ${job.title} via ${route.channel}`,
        applicationId: application.id,
        jobId: job.id,
        detail: { channel: route.channel, routeReason: route.reason }
      })

      if (route.channel === 'manual') {
        logEvent(this.db, {
          category: 'application.needs_human',
          level: 'warn',
          message: `Manual application needed for ${job.title} at ${job.company}`,
          applicationId: application.id,
          jobId: job.id
        })
      } else {
        enqueue(this.db, {
          type: 'application.draft',
          payload: { applicationId: application.id },
          priority: 4,
          idempotencyKey: `draft:${application.id}:${profileHash}`
        })
      }
    }

    return {
      jobId: job.id,
      verdict: eligibility.verdict,
      score: score.total,
      route,
      applicationId: application.id,
      reason: created ? 'Application prepared.' : 'Existing application reused.'
    }
  }

  reEvaluateJobs(limit = 200): { evaluated: number; errors: number } {
    const profileHash = profileFingerprint(this.db)
    const jobs = listJobsNeedingEvaluation(this.db, profileHash, limit)
    let evaluated = 0
    let errors = 0
    for (const job of jobs) {
      try {
        this.evaluateJob(job.id)
        evaluated += 1
      } catch (error) {
        errors += 1
        logEvent(this.db, {
          category: 'job.evaluate_failed',
          level: 'error',
          message: `Evaluation failed for job #${job.id}: ${error instanceof Error ? error.message : String(error)}`,
          jobId: job.id
        })
      }
    }
    return { evaluated, errors }
  }

  hasEvaluation(jobId: number): boolean {
    return Boolean(getEvaluation(this.db, jobId))
  }

  previewTargetMatch(job: JobRecord, target: TargetCountryRecord): boolean {
    return evaluateTargetMatch(
      {
        title: job.title,
        company: job.company,
        descriptionText: job.descriptionText,
        countryCode: job.countryCode,
        remoteType: job.remoteType,
        salaryMin: job.salaryMin,
        salaryCurrency: job.salaryCurrency
      },
      {
        countryCode: target.countryCode,
        jobTitles: target.jobTitles,
        keywords: target.keywords,
        excludeKeywords: target.excludeKeywords,
        remotePreference: target.remotePreference,
        minSalary: target.minSalary,
        currency: target.currency
      },
      getSection(this.db, 'automation').excludeCompanies
    ).keep
  }
}

export function jobDescriptionText(job: JobRecord): string {
  return job.descriptionText || stripHtml(job.descriptionHtml)
}

export function duplicatePreview(db: Db, job: Pick<JobRecord, 'company' | 'countryCode'>): number {
  return findDuplicateCandidates(db, job.company, job.countryCode).length
}
