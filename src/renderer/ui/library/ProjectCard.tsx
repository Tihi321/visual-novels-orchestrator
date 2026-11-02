import { useState } from 'react'
import type { ProjectSummary } from '../../../shared/protocol'
import { typeBadge, type TypeGroup } from '../../lib/bookTypes'
import { projectChoices, projectGroup } from '../../lib/libraryFilter'
import { failedStep, isProjectFinished, isRunning, mergeSteps, stepRows } from '../../lib/pipeline'
import { projectAssetUrl } from '../../lib/urls'
import { langName } from '../../lib/voice'
import { useVn } from '../../store/hooks'
import { vnStore } from '../../store/store'

const MAX_LANGS = 3

function hueOf(slug: string): number {
  let h = 0
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function initials(title: string): string {
  const w = title.split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? (w[w.length - 1]![0] ?? '') : '')).toUpperCase()
}

function badgeOf(p: ProjectSummary): { text: string; group: TypeGroup } | null {
  const b = typeBadge(p.format)
  const group = projectGroup(p)
  if (group === 'picture' && b?.group !== 'picture') return { text: 'Picture book', group }
  if (b) return { text: b.text, group: b.group }
  return projectChoices(p) ? { text: 'Choices', group } : null
}

function detailText(p: ProjectSummary): string {
  const parts = [p.genre, p.theme ?? 'auto theme', p.voice ? 'voice' : null, `${p.chapters} chapters, ${p.characters} characters, ${p.places} places`]
  return parts.filter(Boolean).join(', ')
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const live = useVn((s) => s.progress[project.slug])
  const [coverFailed, setCoverFailed] = useState(false)
  const steps = mergeSteps(project.pipeline, live)
  const rows = stepRows(steps, project.voice)
  const running = isRunning(rows)
  const failed = failedStep(rows)
  const finished = isProjectFinished(project) || steps.build?.status === 'done'
  const { ready, total } = project.assets
  const badge = badgeOf(project)
  const showCover = !!project.coverRel && !coverFailed

  let tone: 'running' | 'failed' | 'built' | 'dim'
  let status: string
  if (running) {
    const row = rows.find((r) => r.state === 'running' || r.state === 'queued')
    tone = 'running'
    status = `Running: ${row?.label ?? 'pipeline'}`
  } else if (failed) {
    tone = 'failed'
    status = `Failed at ${failed.label}`
  } else if (finished) {
    tone = 'built'
    status = 'Built'
  } else {
    tone = 'dim'
    status = total > 0 ? `In progress, ${ready} of ${total} assets` : 'In progress'
  }
  const fraction = tone === 'built' ? 1 : total > 0 ? Math.min(1, ready / total) : 0
  const langs = project.editions
  const detail = detailText(project)

  return (
    <button className="lib-card" onClick={() => vnStore.getState().openProject(project.slug)} title={`${project.title}\n${detail}`} data-testid={`project-${project.slug}`}>
      <div className="lib-cover">
        {showCover ? (
          <img src={projectAssetUrl(project.slug, project.coverRel!, project.updatedAt)} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
        ) : (
          <div className="lib-tile" style={{ ['--hue' as string]: hueOf(project.slug) }} aria-hidden="true">
            {initials(project.title)}
          </div>
        )}
        {badge && <span className={`badge t-${badge.group} lib-badge`}>{badge.text}</span>}
        <div className="lib-progress" aria-hidden="true">
          <i className={tone === 'built' ? 'built' : ''} style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      </div>
      <div className="lib-body">
        <div className="lib-card-title">{project.title}</div>
        <div className="lib-langs">
          {langs.slice(0, MAX_LANGS).map((l) => (
            <span key={l} className="lib-lang" title={langName(l)}>
              {l.toUpperCase()}
            </span>
          ))}
          {langs.length > MAX_LANGS && (
            <span className="lib-lang more" title={langs.slice(MAX_LANGS).map(langName).join(', ')}>
              +{langs.length - MAX_LANGS}
            </span>
          )}
        </div>
        <div className={`lib-status ${tone}`}>
          <span className="lib-dot" />
          <span>{status}</span>
          {project.warnings > 0 && <span className="lib-warn">, {project.warnings} warnings</span>}
        </div>
        <div className="lib-detail">{detail}</div>
      </div>
    </button>
  )
}
