import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, RefreshCw, Sparkles, Target, Trash2, TriangleAlert } from 'lucide-react'
import type { RoleRecommendationDTO, RoleSelectionPageDTO } from '@shared/api'
import { call } from '../lib/api'
import { timeAgo } from '../lib/format'
import {
  Badge,
  Button,
  Input,
  Meter,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  SearchInput,
  useToast
} from '../components/ui'

const FIT_LABELS: Record<RoleRecommendationDTO['fit'], string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  stretch: 'Stretch',
  low: 'Low fit'
}

const FIT_TONES: Record<RoleRecommendationDTO['fit'], 'success' | 'accent' | 'warn' | 'danger'> = {
  strong: 'success',
  good: 'accent',
  stretch: 'warn',
  low: 'danger'
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

export default function Roles() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [customTitles, setCustomTitles] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')
  const [initialised, setInitialised] = useState(false)

  const page = useQuery({ queryKey: ['roles'], queryFn: () => call('roles.page') })

  useEffect(() => {
    if (!page.data || initialised) return
    setSelectedKeys(page.data.catalog.filter((role) => role.selected).map((role) => role.key))
    setCustomTitles(page.data.customSelections.map((item) => item.title))
    setInitialised(true)
  }, [page.data, initialised])

  const applyPage = (next: RoleSelectionPageDTO) => {
    setSelectedKeys(next.catalog.filter((role) => role.selected).map((role) => role.key))
    setCustomTitles(next.customSelections.map((item) => item.title))
  }

  const invalidateAfterSave = () => {
    void queryClient.invalidateQueries({ queryKey: ['roles'] })
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
  }

  const save = useMutation({
    mutationFn: (input: { selectedKeys: string[]; customTitles: string[] }) => call('roles.save', input),
    onSuccess: (next) => {
      applyPage(next)
      invalidateAfterSave()
      toast.success(
        next.effectiveTitles.length > 0
          ? `Target roles saved. Discovery now matches ${next.effectiveTitles.length} title variations.`
          : 'Target roles cleared. Discovery will use only the job titles on each target country.'
      )
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const recommend = useMutation({
    mutationFn: () => call('roles.recommend'),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const pageSelectedKeys = useMemo(
    () => (page.data?.catalog ?? []).filter((role) => role.selected).map((role) => role.key),
    [page.data]
  )
  const pageCustomTitles = useMemo(
    () => (page.data?.customSelections ?? []).map((item) => item.title),
    [page.data]
  )
  const dirty = initialised && (!sameSet(pageSelectedKeys, selectedKeys) || !sameSet(pageCustomTitles, customTitles))

  if (page.isLoading && !page.data) return <PageLoading label="Loading the role catalog" />
  if (page.error) return <PageError error={page.error} onRetry={() => page.refetch()} />

  const catalog = page.data?.catalog ?? []
  const filtered = catalog.filter((role) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return `${role.title} ${role.family} ${role.description} ${role.titleAliases.join(' ')}`.toLowerCase().includes(needle)
  })
  const families = [...new Set(catalog.map((role) => role.family))]

  const toggleRole = (key: string) => {
    setSelectedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key)
      if (current.length >= 8) {
        toast.error('Select at most 8 roles. Extra roles make discovery and scoring too broad.')
        return current
      }
      return [...current, key]
    })
  }

  const addCustom = () => {
    const title = customInput.replace(/\s+/g, ' ').trim()
    if (title.length < 2 || title.length > 80) {
      toast.error('Custom role titles must be between 2 and 80 characters.')
      return
    }
    if ([...customTitles, ...selectedKeys.map((key) => catalog.find((role) => role.key === key)?.title ?? '')].some((value) => value.toLowerCase() === title.toLowerCase())) {
      toast.error('That role is already in your target list.')
      return
    }
    if (selectedKeys.length + customTitles.length >= 8) {
      toast.error('Select at most 8 roles, including custom titles.')
      return
    }
    setCustomTitles((current) => [...current, title])
    setCustomInput('')
  }

  const saveCurrent = (nextKeys = selectedKeys, nextCustom = customTitles) => {
    if (nextKeys.length + nextCustom.length > 8) {
      toast.error('Select at most 8 roles, including custom titles.')
      return
    }
    save.mutate({ selectedKeys: nextKeys, customTitles: nextCustom })
  }

  const addFromRecommendation = (key: string) => {
    if (selectedKeys.includes(key)) return
    if (selectedKeys.length + customTitles.length >= 8) {
      toast.error('Select at most 8 roles, including custom titles.')
      return
    }
    const next = [...selectedKeys, key]
    setSelectedKeys(next)
    saveCurrent(next, customTitles)
  }

  const selectedCount = selectedKeys.length + customTitles.length

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Roles"
        desc="Choose the roles you want to be considered for. Selected roles expand into their common title variations for discovery and scoring, and the recommender ranks the catalog against your stored evidence."
        actions={
          <Button variant="primary" onClick={() => saveCurrent()} loading={save.isPending} disabled={!dirty}>
            {dirty ? 'Save role targets' : 'Saved'}
          </Button>
        }
      />

      <Notice tone="info" className="mb-4">
        Role selection broadens what the app looks for; it does not loosen work-authorization checks. A job still has to pass your nationality, residence,
        and permit rules before any application is prepared. Recommendations are a ranked reading of evidence and are explained before they appear.
      </Notice>

      <div className="split-2">
        <div>
          <Panel
            title="Target roles"
            sub={`${selectedCount} of 8 selected · ${catalog.length} catalog roles plus custom titles`}
          >
            <SearchInput value={search} onChange={setSearch} placeholder="Search roles, families, or titles" />

            <div className="role-grid mt-3">
              {filtered.map((role) => {
                const selected = selectedKeys.includes(role.key)
                return (
                  <button
                    type="button"
                    key={role.key}
                    className="role-option"
                    data-selected={selected}
                    aria-pressed={selected}
                    onClick={() => toggleRole(role.key)}
                  >
                    <span className="role-check">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    <span>
                      <span className="role-title">{role.title}</span>
                      <span className="role-meta">
                        {role.family} · expects {role.minYears}+ years
                      </span>
                    </span>
                  </button>
                )
              })}
              {filtered.length === 0 ? <div className="small faint">No roles match that search.</div> : null}
            </div>

            <div className="mt-4">
              <div className="review-label">Custom role title</div>
              <div className="row" style={{ gap: 8 }}>
                <Input
                  value={customInput}
                  onChange={(event) => setCustomInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addCustom()
                    }
                  }}
                  placeholder="For example: Platform Reliability Lead"
                  maxLength={80}
                />
                <Button variant="secondary" onClick={addCustom}>
                  <Plus /> Add
                </Button>
              </div>
              {customTitles.length > 0 ? (
                <div className="row wrap mt-3" style={{ gap: 6 }}>
                  {customTitles.map((title) => (
                    <span className="badge badge-neutral" key={title}>
                      {title}
                      <button
                        type="button"
                        aria-label={`Remove ${title}`}
                        onClick={() => setCustomTitles((current) => current.filter((item) => item !== title))}
                        style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, display: 'grid' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="tiny faint mt-2">Custom titles are treated as exact titles; catalog aliases are not added to them.</div>
              )}
            </div>

            <div className="row wrap mt-4" style={{ gap: 8 }}>
              <Button variant="primary" onClick={() => saveCurrent()} loading={save.isPending} disabled={!dirty}>
                {dirty ? 'Save role targets' : 'Saved'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedKeys([])
                  setCustomTitles([])
                  setCustomInput('')
                }}
                disabled={selectedCount === 0}
              >
                Clear selection
              </Button>
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="What selection changes" sub="Discovery and scoring, never eligibility.">
            <div className="stack small muted" style={{ lineHeight: 1.65 }}>
              <div>
                <strong>Discovery.</strong> Every selected catalog role contributes its canonical title and common aliases to
                the title list used when connectors search and when postings are filtered.
              </div>
              <div>
                <strong>Scoring.</strong> Title similarity is measured against the combined list, so a posting that says
                “Site Reliability Engineer” can match a “Platform Engineer” target. Skills, salary, location, and recency keep their existing weights.
              </div>
              <div>
                <strong>Eligibility stays absolute.</strong> Citizenship, residence, permits, and sponsorship evidence are
                evaluated exactly as before. A role target cannot make an unreachable job reachable.
              </div>
              <div>
                <strong>Re-evaluation.</strong> Saving roles re-scores recently discovered jobs against the new title list; it
                does not send anything or bypass approval.
              </div>
            </div>
          </Panel>

          <Panel title="Effective title list" sub={`${page.data?.effectiveTitles.length ?? 0} variations currently used`}>
            {page.data && page.data.effectiveTitles.length > 0 ? (
              <div className="row wrap" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
                {page.data.effectiveTitles.map((title) => (
                  <Badge key={title} tone="accent">
                    {title}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="small faint">No roles selected. Each target country’s own job titles are used.</div>
            )}
            <div className="tiny faint mt-3">
              Saving writes the list above to this Mac. Selected roles are stored separately from target countries; both are applied together.
            </div>
          </Panel>

          <Panel title="Catalog coverage" sub="Twenty role families, no network lookup.">
            <div className="row wrap" style={{ gap: 6 }}>
              {families.map((family) => (
                <Badge key={family} tone="neutral">
                  {family}
                </Badge>
              ))}
            </div>
            <div className="tiny faint mt-3">
              The catalog is defined in the app, so recommendations work offline. A custom title outside the catalog can still be targeted, but it will
              not receive catalog-level skill or certification expectations.
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="Recommended roles"
          sub="Deterministic ranking from your resume, profile, and discovered jobs"
          actions={
            <Button variant="primary" onClick={() => recommend.mutate()} loading={recommend.isPending}>
              {recommend.data ? <RefreshCw /> : <Sparkles />}
              {recommend.data ? 'Rank again' : 'Get recommendations'}
            </Button>
          }
        >
          <Notice tone="warn" icon={TriangleAlert}>
            <div className="stack" style={{ gap: 6 }}>
              <div>
                <strong>Read this before using a recommendation.</strong> The ranking is a decision aid, not legal, immigration, or career advice. It
                compares only the evidence stored on this Mac: extracted resume text, profile skills, stated experience, certifications, and postings
                already discovered in your enabled countries.
              </div>
              <div>
                It cannot see unstated experience, does not predict hiring outcomes, and does not verify that a posting is still open. Missing evidence
                lowers the score and confidence instead of being treated as a match. Review the role, the posting, and every eligibility reason yourself
                before applying. No AI provider is used for this ranking.
              </div>
            </div>
          </Notice>

          {recommend.isPending ? (
            <div className="small muted mt-4">Ranking roles against the evidence stored locally…</div>
          ) : null}

          {recommend.data ? (
            <div className="mt-4">
              <div className="row wrap" style={{ gap: 8 }}>
                <Badge tone="neutral">
                  Generated {timeAgo(recommend.data.generatedAt)}
                </Badge>
                {recommend.data.resumeLabel ? (
                  <Badge tone="accent">
                    Evidence: {recommend.data.resumeLabel} · {recommend.data.resumeConfidence ?? 0}% confidence
                  </Badge>
                ) : (
                  <Badge tone="warn">No resume evidence; profile only</Badge>
                )}
                {recommend.data.usedProfileOnly ? <Badge tone="warn">Import a resume for stronger evidence</Badge> : null}
              </div>

              <div className="stack mt-4" style={{ gap: 12 }}>
                {recommend.data.recommendations.map((recommendation) => (
                  <RecommendationCard
                    key={recommendation.key}
                    recommendation={recommendation}
                    selected={selectedKeys.includes(recommendation.key)}
                    busy={save.isPending}
                    onAdd={() => addFromRecommendation(recommendation.key)}
                  />
                ))}
              </div>

              <div className="tiny faint mt-3">
                Scores are out of 100 and sum skills (40), experience and titles (25), certifications (10), and market evidence (25). Market evidence is
                neutral when no matching postings have been discovered yet. Re-run after importing a resume or discovering more jobs.
              </div>
            </div>
          ) : !recommend.isPending ? (
            <div className="small muted mt-4">
              Nothing is calculated until you ask. The button ranks all twenty catalog roles against the local evidence and shows the reasons for each
              score, including what is missing.
            </div>
          ) : null}
        </Panel>
      </div>
    </>
  )
}

function RecommendationCard({
  recommendation,
  selected,
  busy,
  onAdd
}: {
  recommendation: RoleRecommendationDTO
  selected: boolean
  busy: boolean
  onAdd: () => void
}) {
  return (
    <div className="rec-card">
      <div className="rec-head">
        <div style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="strong" style={{ fontSize: 15 }}>
              {recommendation.title}
            </span>
            <Badge tone={FIT_TONES[recommendation.fit]}>{FIT_LABELS[recommendation.fit]}</Badge>
            {selected ? (
              <Badge tone="accent" icon={Check}>
                Targeted
              </Badge>
            ) : null}
          </div>
          <div className="small muted mt-2" style={{ lineHeight: 1.55 }}>
            {recommendation.description}
          </div>
          <div className="row wrap mt-2" style={{ gap: 6 }}>
            <Badge tone="neutral">{recommendation.family}</Badge>
            <Badge tone={recommendation.confidence >= 70 ? 'success' : recommendation.confidence >= 45 ? 'warn' : 'danger'}>
              {recommendation.confidence}% evidence confidence
            </Badge>
            <Badge tone="neutral">
              {recommendation.market.activeJobs} active posting{recommendation.market.activeJobs === 1 ? '' : 's'}
            </Badge>
            {recommendation.market.evaluatedJobs > 0 ? (
              <Badge tone="neutral">
                {recommendation.market.eligibleJobs}/{recommendation.market.evaluatedJobs} eligible
              </Badge>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="rec-score">{recommendation.score}</div>
          <div className="tiny faint">of 100</div>
        </div>
      </div>

      <div className="rec-components">
        {recommendation.components.map((component) => (
          <div className="rec-component" key={component.key}>
            <div className="rec-component-head">
              <span>{component.label}</span>
              <span className="mono">
                {component.score}/{component.max}
              </span>
            </div>
            <Meter value={component.score} max={component.max} tone={component.score / component.max >= 0.6 ? 'green' : 'accent'} />
            <div className="tiny faint">{component.detail}</div>
          </div>
        ))}
      </div>

      <ul className="rec-evidence">
        {recommendation.evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="row wrap mt-3" style={{ gap: 6 }}>
        {recommendation.matchedSkills.length > 0 ? (
          <>
            <span className="tiny faint">Matched:</span>
            {recommendation.matchedSkills.map((skill) => (
              <Badge key={skill} tone="success">
                {skill}
              </Badge>
            ))}
          </>
        ) : null}
        {recommendation.missingSkills.length > 0 ? (
          <>
            <span className="tiny faint" style={{ marginLeft: 6 }}>
              Missing:
            </span>
            {recommendation.missingSkills.map((skill) => (
              <Badge key={skill} tone="neutral">
                {skill}
              </Badge>
            ))}
          </>
        ) : null}
        {recommendation.matchedCertifications.length > 0 ? (
          <>
            <span className="tiny faint" style={{ marginLeft: 6 }}>
              Certifications:
            </span>
            {recommendation.matchedCertifications.map((certification) => (
              <Badge key={certification} tone="accent">
                {certification}
              </Badge>
            ))}
          </>
        ) : null}
      </div>

      <div className="row mt-3" style={{ justifyContent: 'flex-end', gap: 8 }}>
        {recommendation.market.countries.length > 0 ? (
          <span className="tiny faint" style={{ marginRight: 'auto' }}>
            Market: {recommendation.market.countries.join(', ')}
          </span>
        ) : null}
        <Button variant={selected ? 'ghost' : 'secondary'} size="sm" disabled={selected || busy} onClick={onAdd}>
          {selected ? (
            <>
              <Check /> In your targets
            </>
          ) : (
            <>
              <Target /> Add to target roles
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
