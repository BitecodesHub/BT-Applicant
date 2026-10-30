import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Award,
  Briefcase,
  CheckCircle2,
  FileSearch,
  FileText,
  FolderOpen,
  GraduationCap,
  Languages,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload
} from 'lucide-react'
import type { ResumeDTO, ResumeExtractionDTO } from '@shared/api'
import { call } from '../lib/api'
import { fmtDateTime, formatBytes, timeAgo } from '../lib/format'
import { machineName } from '../lib/platform'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  StatCard,
  useToast
} from '../components/ui'

function confidenceTone(confidence: number): 'success' | 'warn' | 'danger' {
  if (confidence >= 70) return 'success'
  if (confidence >= 45) return 'warn'
  return 'danger'
}

function dateRange(start: string | null, end: string | null, current: boolean): string {
  if (!start && !end) return ''
  return `${start ?? 'Unknown'} – ${current ? 'Present' : (end ?? 'Unknown')}`
}

export default function Resumes() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [pendingDelete, setPendingDelete] = useState<ResumeDTO | null>(null)
  const [reviewId, setReviewId] = useState<number | null>(null)

  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => call('resumes.list') })
  const extractions = useQuery({ queryKey: ['resume-extractions'], queryFn: () => call('resumes.extractions') })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['resumes'] })
    void queryClient.invalidateQueries({ queryKey: ['resume-extractions'] })
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    void queryClient.invalidateQueries({ queryKey: ['profile'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    void queryClient.invalidateQueries({ queryKey: ['roles'] })
  }

  const upload = useMutation({
    mutationFn: () => call('resumes.upload'),
    onSuccess: (uploaded) => {
      if (!uploaded) return
      refresh()
      if (uploaded.extraction) {
        toast.success(`${uploaded.resume.fileName} stored and read locally.`)
        setReviewId(uploaded.resume.id)
      } else if (uploaded.extractionError) {
        toast.info(`Resume stored, but it could not be read: ${uploaded.extractionError}`)
      } else {
        toast.success(`${uploaded.resume.fileName} added to the local resume library.`)
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const analyze = useMutation({
    mutationFn: (id: number) => call('resumes.analyze', { id }),
    onSuccess: (extraction) => {
      refresh()
      setReviewId(extraction.resumeId)
      toast.success(`Resume read locally: ${extraction.data.skills.length} skills and ${extraction.data.experience.length} roles found.`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const importToProfile = useMutation({
    mutationFn: (id: number) => call('resumes.import', { id }),
    onSuccess: (result) => {
      refresh()
      setReviewId(null)
      const kept = result.keptExisting.length
      toast.success(
        result.imported.length > 0
          ? `Imported ${result.imported.join(', ')}.${kept > 0 ? ` Kept ${kept} existing value${kept === 1 ? '' : 's'}.` : ''}`
          : 'Nothing to import: the profile already contains every extracted value.'
      )
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const makeDefault = useMutation({
    mutationFn: (id: number) => call('resumes.default', { id }),
    onSuccess: () => {
      toast.success('Default resume updated. New drafts attach this file.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (id: number) => call('resumes.delete', { id }),
    onSuccess: () => {
      toast.success('Resume removed from the library. The managed file was deleted.')
      setPendingDelete(null)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const reveal = useMutation({
    mutationFn: (id: number) => call('resumes.reveal', { id }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  if (resumes.isLoading && !resumes.data) return <PageLoading label="Reading the resume library" />
  if (resumes.error) return <PageError error={resumes.error} onRetry={() => resumes.refetch()} />

  const items = resumes.data ?? []
  const defaultResume = items.find((item) => item.isDefault) ?? null
  const extractionByResume = new Map((extractions.data ?? []).map((item) => [item.resumeId, item]))
  const readCount = items.filter((item) => extractionByResume.has(item.id)).length
  const reviewResume = items.find((item) => item.id === reviewId) ?? null
  const reviewExtraction = reviewId ? extractionByResume.get(reviewId) : undefined

  return (
    <>
      <PageHeader
        eyebrow="Candidate file"
        title="Resumes"
        desc={`Files are copied into the app’s managed folder, hashed for integrity, and read on ${machineName}. Text extraction and field detection are deterministic; no AI provider and no network call is involved.`}
        actions={
          <Button variant="primary" onClick={() => upload.mutate()} loading={upload.isPending}>
            <Upload /> Add resume
          </Button>
        }
      />

      <div className="stat-grid mb-4">
        <StatCard label="Files stored" value={items.length} unit={items.length === 1 ? 'resume' : 'resumes'} icon={FileText} foot="Managed locally" />
        <StatCard
          label="Default attachment"
          value={defaultResume ? defaultResume.label : 'None'}
          foot={defaultResume ? `Updated ${timeAgo(defaultResume.createdAt)}` : 'Set one before applications are drafted'}
          tone={defaultResume ? 'success' : 'warn'}
          icon={Star}
        />
        <StatCard
          label="Read locally"
          value={`${readCount}/${items.length}`}
          unit="parsed"
          foot={items.length === 0 ? 'Add a resume to begin' : 'Skills, roles, education, certificates'}
          tone={readCount > 0 ? 'success' : 'warn'}
          icon={ScanText}
        />
        <StatCard
          label="Email attachments"
          value={defaultResume ? 'Ready' : items.length > 0 ? 'Ready if chosen' : 'Missing'}
          foot={defaultResume ? 'Attached to every new draft' : 'Drafts fall back to the default resume'}
          tone={defaultResume || items.length > 0 ? 'success' : 'danger'}
          icon={ShieldCheck}
        />
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FileText}
            title="No resumes in the library yet"
            desc="Add a PDF, Word document, Markdown, RTF, or plain-text resume. The app reads it locally, shows what it found, and lets you import details into your profile before anything is used."
            action={
              <Button variant="primary" onClick={() => upload.mutate()} loading={upload.isPending}>
                <Upload /> Choose a file
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="split-2">
          <div>
            <Panel title="Library" sub={`${items.length} file${items.length === 1 ? '' : 's'} · newest first`} flush>
              <div className="list">
                {[...items]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((resume) => {
                    const extraction = extractionByResume.get(resume.id)
                    return (
                      <div className="list-row" key={resume.id} style={{ alignItems: 'flex-start', paddingTop: 16, paddingBottom: 16 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            border: '1px solid var(--line)',
                            background: 'var(--panel-2)',
                            display: 'grid',
                            placeItems: 'center',
                            flex: 'none'
                          }}
                        >
                          <FileText size={17} className={resume.isDefault ? 'color-accent' : 'color-muted'} />
                        </div>
                        <div className="list-row-main">
                          <div className="row wrap" style={{ gap: 8 }}>
                            <span className="strong">{resume.label}</span>
                            {resume.isDefault ? (
                              <Badge tone="accent" icon={CheckCircle2}>
                                Default
                              </Badge>
                            ) : null}
                            {extraction ? (
                              <Badge tone={confidenceTone(extraction.confidence)} icon={ScanText}>
                                {extraction.confidence}% confidence
                              </Badge>
                            ) : (
                              <Badge tone="neutral">Not read yet</Badge>
                            )}
                          </div>
                          <div className="tiny faint mt-2" style={{ lineHeight: 1.7 }}>
                            {resume.fileName} · {formatBytes(resume.sizeBytes)} · added {fmtDateTime(resume.createdAt)}
                            <br />
                            <span className="mono">SHA-256 {resume.sha256.slice(0, 20)}…</span>
                          </div>
                          {extraction ? (
                            <div className="tiny muted mt-2">
                              {countLabel(extraction.data.skills.length, 'skill')} ·{' '}
                              {countLabel(extraction.data.experience.length, 'role')} ·{' '}
                              {countLabel(extraction.data.education.length, 'education entry', 'education entries')} ·{' '}
                              {countLabel(extraction.data.certifications.length, 'certificate')} ·{' '}
                              {countLabel(extraction.data.languages.length, 'language')} · read {timeAgo(extraction.extractedAt)}
                            </div>
                          ) : (
                            <div className="tiny faint mt-2">Read the file to extract skills, experience, education, and certifications.</div>
                          )}
                          <div className="row mt-3 wrap" style={{ gap: 6 }}>
                            {extraction ? (
                              <Button size="sm" variant="secondary" onClick={() => setReviewId(resume.id)}>
                                <FileSearch /> Review details
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => analyze.mutate(resume.id)}
                                loading={analyze.isPending && analyze.variables === resume.id}
                              >
                                <ScanText /> Read resume
                              </Button>
                            )}
                            {!resume.isDefault ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => makeDefault.mutate(resume.id)}
                                loading={makeDefault.isPending && makeDefault.variables === resume.id}
                              >
                                <Star /> Make default
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => reveal.mutate(resume.id)}
                              loading={reveal.isPending && reveal.variables === resume.id}
                            >
                              <FolderOpen /> Show in Finder
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingDelete(resume)}
                              disabled={items.length === 1}
                              title={items.length === 1 ? 'Keep at least one resume in the library' : 'Remove this resume'}
                            >
                              <Trash2 /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </Panel>
          </div>

          <div>
            <Panel title="How reading works" sub="Local, deterministic, reviewable.">
              <div className="stack small muted" style={{ lineHeight: 1.65 }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={15} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>
                    <strong className="color-green">On-device extraction.</strong> PDF, DOCX, RTF, Markdown, and text files are read with local
                    libraries. The document never leaves {machineName} and is never sent to an AI provider.
                  </span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={15} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>
                    <strong className="color-green">You decide what is imported.</strong> The review screen shows every field before anything reaches
                    your profile. Import only fills blank fields and merges skills and languages; existing values are never overwritten.
                  </span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={15} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>
                    <strong className="color-green">Evidence, not invention.</strong> A field is shown only when the document states it. Missing
                    details stay empty, and low-confidence documents are flagged with warnings.
                  </span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={15} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>
                    <strong className="color-green">Default resume.</strong> New application drafts attach the resume marked default. Existing drafts
                    keep the file chosen when they were prepared.
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title="File requirements" sub="Checked before anything is stored.">
              <div className="kv small">
                <dt>Formats</dt>
                <dd>PDF, DOCX, TXT, Markdown, RTF</dd>
                <dt>Maximum size</dt>
                <dd>10 MB per file</dd>
                <dt>Legacy .doc</dt>
                <dd>Save as PDF or DOCX first</dd>
                <dt>Integrity</dt>
                <dd>SHA-256 recorded on upload</dd>
                <dt>Outbound copy</dt>
                <dd>Attached to email drafts only</dd>
              </div>
              {!defaultResume ? (
                <Notice tone="warn" className="mt-3">
                  No default resume is set. Application drafting may still begin, but choose a default so email drafts know which file to attach.
                </Notice>
              ) : null}
              <div className="mt-3">
                <Link className="small color-accent" to="/profile">
                  Review profile completeness
                </Link>
              </div>
            </Panel>

            <Notice tone="info">
              Reading a resume does not change your profile or any application. Import is a separate, explicit action, and role recommendations use the
              imported profile plus the extracted document details.
            </Notice>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(reviewResume)}
        onOpenChange={(open) => {
          if (!open) setReviewId(null)
        }}
        title={reviewResume ? reviewResume.label : 'Resume details'}
        desc={
          reviewExtraction
            ? `Read ${timeAgo(reviewExtraction.extractedAt)} from ${reviewResume?.fileName ?? 'this file'} · parser v${reviewExtraction.parserVersion} · ${reviewExtraction.textChars.toLocaleString()} characters`
            : 'This file has not been read yet.'
        }
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewId(null)}>
              Close
            </Button>
            {reviewResume ? (
              <Button
                variant="secondary"
                onClick={() => analyze.mutate(reviewResume.id)}
                loading={analyze.isPending && analyze.variables === reviewResume.id}
              >
                <RefreshCw /> Read again
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={!reviewExtraction}
              loading={importToProfile.isPending}
              onClick={() => {
                if (reviewResume) importToProfile.mutate(reviewResume.id)
              }}
            >
              <Sparkles /> Import into profile
            </Button>
          </>
        }
      >
        {reviewExtraction ? <ExtractionReview extraction={reviewExtraction} /> : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Remove this resume?"
        description={
          pendingDelete ? (
            <>
              <strong>{pendingDelete.fileName}</strong> will be removed from the library, its managed copy deleted, and its extracted details
              discarded. Applications that already reference it keep their stored outbox record, but future drafts will use the default resume. This
              cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Remove resume"
        busy={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </>
  )
}

function ExtractionReview({ extraction }: { extraction: ResumeExtractionDTO }) {
  const data = extraction.data
  const projects = data.projects ?? []
  const awards = data.awards ?? []
  const contact = [
    data.email,
    data.phone,
    data.location,
    data.linkedin ? `LinkedIn: ${data.linkedin}` : null,
    data.github ? `GitHub: ${data.github}` : null,
    data.website ? `Website: ${data.website}` : null
  ].filter((value): value is string => Boolean(value))

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={confidenceTone(extraction.confidence)} icon={ScanText}>
          {extraction.confidence}% confidence
        </Badge>
        <Badge tone="neutral">{countLabel(extraction.sectionsFound.length, 'section')} found</Badge>
        <Badge tone="neutral">{countLabel(data.skills.length, 'skill')}</Badge>
        <Badge tone="neutral">{countLabel(data.experience.length, 'role')}</Badge>
        <Badge tone="neutral">{countLabel(data.certifications.length, 'certificate')}</Badge>
        {projects.length > 0 ? <Badge tone="neutral">{countLabel(projects.length, 'project')}</Badge> : null}
        {awards.length > 0 ? <Badge tone="neutral">{countLabel(awards.length, 'award')}</Badge> : null}
        {data.yearsExperience !== null ? <Badge tone="accent">{data.yearsExperience.toFixed(1)} years experience</Badge> : null}
      </div>

      {extraction.warnings.length > 0 ? (
        <Notice tone="warn">
          <div className="stack" style={{ gap: 4 }}>
            {extraction.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        </Notice>
      ) : null}

      <div className="review-grid">
        <div>
          <div className="review-label">Name</div>
          <div className="review-value">{data.name ?? <span className="faint">Not found</span>}</div>
        </div>
        <div>
          <div className="review-label">Headline</div>
          <div className="review-value">{data.headline ?? <span className="faint">Not found</span>}</div>
        </div>
      </div>

      <div>
        <div className="review-label">Contact</div>
        {contact.length > 0 ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {contact.map((value) => (
              <Badge key={value} tone="neutral">
                {value}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="small faint">No contact details were found in the readable text.</div>
        )}
      </div>

      {data.summary ? (
        <div>
          <div className="review-label">Summary</div>
          <div className="small muted" style={{ lineHeight: 1.65 }}>
            {data.summary}
          </div>
        </div>
      ) : null}

      <div>
        <div className="review-label">Skills ({data.skills.length})</div>
        {data.skills.length > 0 ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {data.skills.map((skill) => (
              <Badge key={skill} tone="accent">
                {skill}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="small faint">No skills were detected.</div>
        )}
      </div>

      <div>
        <div className="review-label">
          <Briefcase size={13} /> Experience
        </div>
        {data.experience.length > 0 ? (
          <div className="stack" style={{ gap: 10 }}>
            {data.experience.map((role, index) => (
              <div className="review-card" key={`${role.title}-${index}`}>
                <div className="row wrap" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span className="strong">{role.title}</span>
                  {role.company ? <span className="small muted">{role.company}</span> : null}
                  <span className="tiny faint" style={{ marginLeft: 'auto' }}>
                    {dateRange(role.startDate, role.endDate, role.current)}
                    {role.location ? ` · ${role.location}` : ''}
                  </span>
                </div>
                {role.bullets.length > 0 ? (
                  <ul className="small muted" style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
                    {role.bullets.slice(0, 4).map((bullet, bulletIndex) => (
                      <li key={bulletIndex}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
                {role.technologies.length > 0 ? (
                  <div className="tiny faint mt-2">Technologies: {role.technologies.join(', ')}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="small faint">No dated roles were detected.</div>
        )}
      </div>

      <div className="review-grid">
        <div>
          <div className="review-label">
            <GraduationCap size={13} /> Education
          </div>
          {data.education.length > 0 ? (
            <div className="stack" style={{ gap: 6 }}>
              {data.education.map((entry, index) => (
                <div className="small" key={`${entry.degree}-${index}`}>
                  <span className="strong">{entry.degree}</span>
                  {entry.institution ? <span className="muted"> · {entry.institution}</span> : null}
                  {entry.startDate || entry.endDate ? (
                    <span className="tiny faint"> · {dateRange(entry.startDate, entry.endDate, false)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="small faint">None found.</div>
          )}
        </div>
        <div>
          <div className="review-label">
            <Award size={13} /> Certifications
          </div>
          {data.certifications.length > 0 ? (
            <div className="stack" style={{ gap: 6 }}>
              {data.certifications.map((certification, index) => (
                <div className="small" key={`${certification.name}-${index}`}>
                  <span className="strong">{certification.name}</span>
                  {certification.issuer ? <span className="muted"> · {certification.issuer}</span> : null}
                  {certification.year ? <span className="tiny faint"> · {certification.year}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="small faint">None found.</div>
          )}
        </div>
      </div>

      {data.languages.length > 0 ? (
        <div>
          <div className="review-label">
            <Languages size={13} /> Languages
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {data.languages.map((language) => (
              <Badge key={language.language} tone="neutral">
                {language.language}
                {language.level ? ` · ${language.level}` : ''}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {projects.length > 0 || awards.length > 0 ? (
        <div className="review-grid">
          <div>
            <div className="review-label">
              <FolderOpen size={13} /> Projects
            </div>
            {projects.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {projects.map((project, index) => (
                  <div className="review-card" key={`${project.name}-${index}`}>
                    <div className="small">
                      <span className="strong">{project.name}</span>
                    </div>
                    {project.detail ? (
                      <div className="small muted" style={{ marginTop: 3, lineHeight: 1.55 }}>
                        {project.detail}
                      </div>
                    ) : null}
                    {project.technologies.length > 0 ? (
                      <div className="tiny faint mt-2">Technologies: {project.technologies.join(', ')}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="small faint">None found.</div>
            )}
          </div>
          <div>
            <div className="review-label">
              <Star size={13} /> Awards
            </div>
            {awards.length > 0 ? (
              <ul className="small muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                {awards.map((award) => (
                  <li key={award}>{award}</li>
                ))}
              </ul>
            ) : (
              <div className="small faint">None found.</div>
            )}
          </div>
        </div>
      ) : null}

      <div>
        <div className="review-label">Readable text preview</div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 260,
            overflow: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            lineHeight: 1.6,
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 12,
            margin: 0
          }}
        >
          {extraction.textPreview}
          {extraction.textChars > extraction.textPreview.length ? '\n\n… preview truncated …' : ''}
        </pre>
      </div>

      <Notice tone="info">
        Import fills blank profile fields and merges new skills and languages. It never overwrites a value you already entered. Experience entries stay
        attached to this resume and are used as evidence for role recommendations.
      </Notice>
    </div>
  )
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
