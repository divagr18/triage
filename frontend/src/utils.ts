import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import type { FloodWave, PullRequest } from './types'

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)
}

export function formatDate(iso: string): string {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

export function formatFlag(flag: string): string {
  return flag.replace(/_/g, ' ')
}

export function trustColor(bucket: string): string {
  switch (bucket) {
    case 'high':
      return 'text-emerald-300 bg-emerald-400/[0.06] border-zinc-800'
    case 'medium':
      return 'text-amber-300 bg-amber-400/[0.06] border-zinc-800'
    case 'low':
      return 'text-orange-300 bg-orange-400/[0.06] border-zinc-800'
    case 'very_low':
      return 'text-red-300 bg-red-400/[0.06] border-zinc-800'
    default:
      return 'text-zinc-400 bg-zinc-400/[0.06] border-zinc-800'
  }
}

export function ciColor(state: string): string {
  switch (state) {
    case 'passing':
      return 'text-emerald-400'
    case 'failing':
      return 'text-red-400'
    case 'pending':
      return 'text-amber-400'
    default:
      return 'text-zinc-500'
  }
}

export function reviewColor(state: string): string {
  switch (state) {
    case 'approved':
      return 'text-emerald-400'
    case 'changes_requested':
      return 'text-red-400'
    case 'reviewed':
      return 'text-blue-400'
    default:
      return 'text-zinc-500'
  }
}

export function flagColor(flag: string): string {
  if (flag.includes('risk') || flag.includes('failing') || flag.includes('without_tests')) {
    return 'text-red-300 border-zinc-800 bg-zinc-900/40'
  }
  if (flag.includes('noise') || flag.includes('generic') || flag.includes('churn') || flag.includes('lockfile')) {
    return 'text-amber-300 border-zinc-800 bg-zinc-900/40'
  }
  if (flag.includes('no_human_review')) {
    return 'text-zinc-400 border-zinc-800 bg-zinc-900/35'
  }
  return 'text-sky-300 border-zinc-800 bg-zinc-900/35'
}

export function sortPrs(prs: PullRequest[], key: SortKey): PullRequest[] {
  const copy = [...prs]
  switch (key) {
    case 'newest':
      return copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    case 'oldest':
      return copy.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    case 'trust-high':
      return copy.sort((a, b) => b.contributorTrust.score - a.contributorTrust.score)
    case 'trust-low':
      return copy.sort((a, b) => a.contributorTrust.score - b.contributorTrust.score)
    case 'changes':
      return copy.sort((a, b) => b.signals.totalChanges - a.signals.totalChanges)
    default:
      return copy
  }
}

export function isTrustedCleanPr(pr: PullRequest): boolean {
  const association = pr.contributor.accountAssociation || pr.author.association || ''
  const trustedAssociation = ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(association)
  return pr.flags.length === 0 && (trustedAssociation || pr.contributorTrust.score >= 70)
}

export function buildAiFloodWaves(prs: PullRequest[], options: FloodOptions = {}): FloodWave[] {
  const windowHours = options.windowHours ?? 72
  const minSize = options.minSize ?? 3
  const threshold = options.threshold ?? 0.55
  const candidates = new Map<string, { label: string; prs: PullRequest[] }>()

  const addCandidate = (label: string, group: PullRequest[]) => {
    if (group.length < minSize) return
    const key = group
      .map((pr) => pr.number)
      .sort((a, b) => a - b)
      .join(',')
    if (key && !candidates.has(key)) candidates.set(key, { label, prs: group })
  }

  const anchors = new Map<string, PullRequest[]>()
  for (const pr of prs) {
    for (const anchor of floodAnchors(pr)) {
      const group = anchors.get(anchor) ?? []
      group.push(pr)
      anchors.set(anchor, group)
    }
  }

  for (const [anchor, group] of anchors.entries()) {
    if (group.length < minSize) continue
    for (const window of timeWindowGroups(group, windowHours, minSize)) {
      addCandidate(anchorLabel(anchor), window)
    }
  }

  const waves = [...candidates.values()]
    .map(({ label, prs: group }) => scoreFloodWave(label, group))
    .filter((wave) => wave.score >= threshold)
    .sort((a, b) => b.score - a.score || b.prs.length - a.prs.length || a.id.localeCompare(b.id))

  return dedupeFloodWaves(waves)
}

function floodAnchors(pr: PullRequest): string[] {
  const anchors = new Set<string>()
  for (const changelet of pr.changelets ?? []) {
    if (changelet.startsWith('touch ')) continue
    if (GENERIC_CHANGELETS.has(changelet)) continue
    anchors.add(`changelet:${changelet}`)
  }
  for (const filename of pr.signals.fileNames) {
    const normalized = filename.toLowerCase()
    if (isSpecificFloodFile(normalized) || ['readme.md', 'history.md', 'changelog.md'].includes(normalized)) {
      anchors.add(`file:${normalized}`)
    }
  }
  const signature = titleSignature(pr.title)
  if (signature) anchors.add(`title:${signature}`)
  return [...anchors]
}

function timeWindowGroups(prs: PullRequest[], windowHours: number, minSize: number) {
  const sorted = [...prs].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  const groups: PullRequest[][] = []
  const seen = new Set<string>()
  for (let index = 0; index < sorted.length; index += 1) {
    const start = new Date(sorted[index].createdAt)
    const group = sorted.slice(index).filter((pr) => hoursBetween(start, new Date(pr.createdAt)) <= windowHours)
    if (group.length < minSize) continue
    const key = group.map((pr) => pr.number).sort((a, b) => a - b).join(',')
    if (!seen.has(key)) {
      seen.add(key)
      groups.push(group)
    }
  }
  return groups
}

function scoreFloodWave(label: string, prs: PullRequest[]): FloodWave {
  const dates = prs.map((pr) => new Date(pr.createdAt)).sort((a, b) => +a - +b)
  const duration = dates.length ? hoursBetween(dates[0], dates[dates.length - 1]) : 0
  const count = prs.length
  const firstTime = prs.filter((pr) => pr.signals.isNewContributor).length
  const lowContext = prs.filter(isLowContextPr).length
  const docsOnly = prs.filter((pr) => pr.signals.docsOnly).length
  const smallDiff = prs.filter((pr) => pr.signals.smallDiff).length
  const noReview = prs.filter((pr) => pr.signals.reviewState === 'none').length
  const lowTrust = prs.filter((pr) => pr.contributorTrust.score < 55).length
  const repeatedFiles = topRepeatedCount(prs.flatMap((pr) => pr.signals.fileNames))
  const repeatedChangelets = topRepeatedCount(prs.flatMap((pr) => pr.changelets ?? []))
  const repeatedTitles = topRepeatedCount(prs.map((pr) => titleSignature(pr.title)))

  let score = Math.min(0.25, 0.05 * count)
  score += duration <= 36 ? 0.18 : duration <= 72 ? 0.12 : duration <= 168 ? 0.05 : 0
  score += 0.18 * ratio(lowContext, count)
  score += 0.15 * ratio(firstTime, count)
  score += 0.12 * ratio(Math.max(repeatedFiles, repeatedChangelets, repeatedTitles), count)
  score += 0.1 * ratio(docsOnly, count)
  score += 0.08 * ratio(smallDiff, count)
  score += 0.06 * ratio(noReview, count)
  score += 0.08 * ratio(lowTrust, count)

  const best = [...prs].sort((a, b) => canonicalScore(b) - canonicalScore(a))[0]
  const rounded = Math.min(1, Number(score.toFixed(3)))
  return {
    id: `flood_${safeId(label)}_${prs.map((pr) => pr.number).sort((a, b) => a - b).join('_')}`,
    label,
    prs: [...prs].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).map((pr) => pr.number),
    score: rounded,
    window: formatHours(duration),
    bestPr: best.number,
    bestTitle: best.title,
    reasons: floodReasons({
      count,
      duration,
      firstTime,
      lowContext,
      docsOnly,
      smallDiff,
      noReview,
      lowTrust,
      repeatedFiles,
      repeatedChangelets,
      repeatedTitles,
    }),
    recommendedAction:
      rounded >= 0.7
        ? 'Sample the wave, identify a canonical PR, then apply a consistent maintainer action.'
        : 'Review as a possible burst; ask for clearer issue/context before taking bulk action.',
  }
}

function floodReasons(values: FloodReasonInputs) {
  const reasons = [`${values.count} PRs over ${formatHours(values.duration)}`]
  const majority = Math.max(2, Math.floor(values.count / 2))
  const entries: Array<[number, string]> = [
    [values.firstTime, 'mostly new or unknown contributors'],
    [values.lowContext, 'low-context or low-value PR signals'],
    [values.docsOnly, 'docs-only edits'],
    [values.smallDiff, 'small shallow diffs'],
    [values.noReview, 'no human review'],
    [values.lowTrust, 'low contributor trust scores'],
  ]
  for (const [amount, label] of entries) {
    if (amount >= majority) reasons.push(`${amount} ${label}`)
  }
  if (values.repeatedFiles >= majority) reasons.push('repeated touched files')
  if (values.repeatedChangelets >= majority) reasons.push('repeated semantic changelets')
  if (values.repeatedTitles >= majority) reasons.push('near-duplicate title intent')
  return reasons.slice(0, 6)
}

function dedupeFloodWaves(waves: FloodWave[], maxOverlap = 0.55) {
  const selected: FloodWave[] = []
  for (const wave of waves) {
    if (selected.every((existing) => floodWaveOverlap(wave, existing) <= maxOverlap)) {
      selected.push(wave)
    }
  }
  return selected
}

function floodWaveOverlap(left: FloodWave, right: FloodWave) {
  const leftSet = new Set(left.prs)
  const rightSet = new Set(right.prs)
  const shared = [...leftSet].filter((number) => rightSet.has(number)).length
  return shared / Math.min(leftSet.size, rightSet.size)
}

function isLowContextPr(pr: PullRequest) {
  return (
    pr.flags.some((flag) => LOW_VALUE_FLAGS.has(flag)) ||
    pr.flags.includes('possible_ai_flood_member') ||
    pr.signals.genericDescription ||
    pr.signals.descriptionLength < 80
  )
}

function canonicalScore(pr: PullRequest) {
  let score = pr.contributorTrust.score
  if (pr.signals.hasTests) score += 12
  if (pr.signals.ciState === 'passing') score += 12
  if (pr.signals.smallDiff) score += 8
  if (['approved', 'reviewed'].includes(pr.signals.reviewState)) score += 8
  score -= pr.flags.filter((flag) => LOW_VALUE_FLAGS.has(flag)).length * 5
  if (pr.flags.includes('core_change_without_tests')) score -= 10
  if (pr.flags.includes('large_unrelated_refactor')) score -= 10
  return score
}

function titleSignature(title: string) {
  const words = title
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g)
    ?.filter((word) => !TITLE_STOP_WORDS.has(word))
  return words && words.length >= 2 ? words.slice(0, 4).join(' ') : ''
}

function isSpecificFloodFile(filename: string) {
  if (!filename) return false
  if (filename.startsWith('.github/') || filename.startsWith('examples/')) return false
  if (BROAD_FILES.has(filename)) return false
  const name = filename.split('/').pop() ?? ''
  return !DEPENDENCY_FILES.has(name) && !LOCKFILES.has(name)
}

function topRepeatedCount(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Math.max(0, ...counts.values())
}

function ratio(part: number, whole: number) {
  return whole ? part / whole : 0
}

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (+end - +start) / 36e5)
}

function formatHours(hours: number) {
  if (hours < 1) return '<1 hour'
  if (hours < 48) return `${Math.round(hours)} hours`
  return `${formatNumber(hours / 24)} days`
}

function anchorLabel(anchor: string) {
  const [kind, value] = anchor.split(/:(.*)/)
  if (kind === 'file') return `Repeated edits to ${value}`
  if (kind === 'title') return `Repeated title intent: ${value}`
  return value
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'wave'
}

export type SortKey = 'newest' | 'oldest' | 'trust-high' | 'trust-low' | 'changes'

interface FloodOptions {
  windowHours?: number
  minSize?: number
  threshold?: number
}

interface FloodReasonInputs {
  count: number
  duration: number
  firstTime: number
  lowContext: number
  docsOnly: number
  smallDiff: number
  noReview: number
  lowTrust: number
  repeatedFiles: number
  repeatedChangelets: number
  repeatedTitles: number
}

const GENERIC_CHANGELETS = new Set([
  'add or update tests',
  'touch core runtime',
  'fix bug',
  'add feature',
  'modify project configuration',
  'modify dependency metadata',
  'improve error handling',
])

const LOW_VALUE_FLAGS = new Set([
  'readme_only_noise',
  'docs_rewrite_noise',
  'dependency_without_usage',
  'lockfile_only',
  'formatting_churn',
  'description_too_generic',
])

const TITLE_STOP_WORDS = new Set([
  'add',
  'adds',
  'and',
  'chore',
  'docs',
  'feat',
  'fix',
  'for',
  'from',
  'the',
  'update',
  'with',
])

const DEPENDENCY_FILES = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'cargo.toml', 'go.mod'])
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'cargo.lock', 'go.sum'])
const BROAD_FILES = new Set(['history.md', 'package.json', 'lib/application.js', 'lib/response.js'])
