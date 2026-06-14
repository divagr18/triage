import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import type { FloodWave, PrCluster, PullRequest, TrendItem, TrendReport } from './types'

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
      return 'text-emerald-200 bg-emerald-400/[0.1] border-emerald-400/25'
    case 'medium':
      return 'text-amber-200 bg-amber-400/[0.1] border-amber-400/25'
    case 'low':
      return 'text-orange-200 bg-orange-400/[0.1] border-orange-400/25'
    case 'very_low':
      return 'text-red-200 bg-red-400/[0.1] border-red-400/25'
    default:
      return 'text-zinc-300 bg-zinc-400/[0.08] border-zinc-700'
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
    return 'text-red-200 border-red-400/25 bg-red-400/[0.08]'
  }
  if (flag.includes('noise') || flag.includes('generic') || flag.includes('churn') || flag.includes('lockfile')) {
    return 'text-amber-200 border-amber-400/25 bg-amber-400/[0.08]'
  }
  if (flag.includes('no_human_review')) {
    return 'text-violet-200 border-violet-400/20 bg-violet-400/[0.07]'
  }
  return 'text-sky-200 border-sky-400/20 bg-sky-400/[0.07]'
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
  const windowHours = options.windowHours ?? 48
  const minSize = options.minSize ?? 3
  const threshold = options.threshold ?? 0.72
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
    .filter(({ prs: group }) => floodGroupHasRepeatedIntent(group))
    .map(({ label, prs: group }) => scoreFloodWave(label, group))
    .filter((wave) => wave.score >= threshold)
    .sort((a, b) => b.score - a.score || b.prs.length - a.prs.length || a.id.localeCompare(b.id))

  return dedupeFloodWaves(waves)
}

export function buildFloodClusters(prs: PullRequest[], waves: FloodWave[]): PrCluster[] {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]))
  const clusters = waves
    .map((wave) => {
      const members = wave.prs
        .map((number) => byNumber.get(number))
        .filter((pr): pr is PullRequest => Boolean(pr))
      if (members.length < 3) return null
      const best = [...members].sort((a, b) => canonicalScore(b) - canonicalScore(a))[0]
      return {
        id: `flood_cluster_${safeId(wave.label)}_${wave.prs.join('_')}`,
        label: wave.label,
        prs: members.map((pr) => pr.number),
        size: members.length,
        bestPr: best.number,
        bestTitle: best.title,
        reasons: [
          `${members.length} PRs in ${wave.window}`,
          ...wave.reasons.filter((reason) => !reason.startsWith(`${members.length} PRs`)).slice(0, 2),
        ],
      }
    })
    .filter((cluster): cluster is PrCluster => Boolean(cluster))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))

  return dedupeClusters(clusters, 0.55).slice(0, 18)
}

export function buildPrClusters(prs: PullRequest[], minSize = 2): PrCluster[] {
  const anchors = new Map<string, PullRequest[]>()
  for (const pr of prs) {
    for (const anchor of clusterAnchors(pr)) {
      const group = anchors.get(anchor) ?? []
      group.push(pr)
      anchors.set(anchor, group)
    }
  }

  const clusters = [...anchors.entries()]
    .map(([anchor, group]) => {
      const unique = dedupePrs(group)
      if (unique.length < minSize) return null
      const best = [...unique].sort((a, b) => canonicalScore(b) - canonicalScore(a))[0]
      return {
        id: `cluster_${safeId(anchor)}_${unique.map((pr) => pr.number).sort((a, b) => a - b).join('_')}`,
        label: anchorLabel(anchor),
        prs: unique.map((pr) => pr.number).sort((a, b) => b - a),
        size: unique.length,
        bestPr: best.number,
        bestTitle: best.title,
        reasons: clusterReasons(anchor, unique),
      }
    })
    .filter((cluster): cluster is PrCluster => Boolean(cluster))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))

  return dedupeClusters(clusters).slice(0, 24)
}

export function buildTrendReport(prs: PullRequest[]): TrendReport {
  return {
    dailyPrs: countBy(
      prs,
      (pr) => new Date(pr.createdAt).toISOString().slice(0, 10),
      { limit: 14, chronological: true },
    ),
    topChangelets: countBy(prs.flatMap((pr) => pr.changelets ?? []), (value) => value, { limit: 8 }),
    topFiles: countBy(prs.flatMap((pr) => pr.signals.fileNames), (value) => value, { limit: 8 }),
    trustBuckets: countBy(prs, (pr) => pr.contributorTrust.bucket.replace('_', ' '), { limit: 4 }),
    reviewStates: countBy(prs, (pr) => pr.signals.reviewState.replace(/_/g, ' '), { limit: 5 }),
  }
}

function floodAnchors(pr: PullRequest): string[] {
  const anchors = new Set<string>()
  for (const changelet of pr.changelets ?? []) {
    if (changelet.startsWith('touch ')) continue
    if (changelet === 'edit README only' || changelet === 'update documentation') {
      anchors.add(`changelet:${changelet}`)
    } else if (isSpecificFloodChangelet(changelet)) {
      anchors.add(`changelet:${changelet}`)
    }
  }
  for (const filename of pr.signals.fileNames) {
    const normalized = filename.toLowerCase()
    if (pr.signals.docsOnly && ['readme.md', 'history.md', 'changelog.md'].includes(normalized)) {
      anchors.add(`file:${normalized}`)
    }
  }
  const signature = titleSignature(pr.title)
  if (signature) anchors.add(`title:${signature}`)
  return [...anchors]
}

function clusterAnchors(pr: PullRequest): string[] {
  const anchors = new Set<string>()
  for (const changelet of pr.changelets ?? []) {
    if (changelet.startsWith('touch ')) continue
    if (!GENERIC_CLUSTER_CHANGELETS.has(changelet)) anchors.add(`changelet:${changelet}`)
  }
  for (const filename of pr.signals.fileNames) {
    const normalized = filename.toLowerCase()
    if (isSpecificFloodFile(normalized)) anchors.add(`file:${normalized}`)
  }
  const signature = titleSignature(pr.title)
  if (signature) anchors.add(`title:${signature}`)
  return [...anchors]
}

function clusterReasons(anchor: string, prs: PullRequest[]) {
  const reasons = [`${prs.length} PRs share ${anchorLabel(anchor).toLowerCase()}`]
  const files = topRepeatedValues(prs.flatMap((pr) => pr.signals.fileNames), 2)
  const changelets = topRepeatedValues(prs.flatMap((pr) => pr.changelets ?? []), 2)
  if (files.length) reasons.push(`common files: ${files.map((item) => item.label).join(', ')}`)
  if (changelets.length) reasons.push(`common changelets: ${changelets.map((item) => item.label).join(', ')}`)
  return reasons.slice(0, 3)
}

function dedupePrs(prs: PullRequest[]) {
  return [...new Map(prs.map((pr) => [pr.number, pr])).values()]
}

function dedupeClusters(clusters: PrCluster[], maxOverlap = 0.65) {
  const selected: PrCluster[] = []
  for (const cluster of clusters) {
    if (selected.every((existing) => clusterOverlap(cluster, existing) <= maxOverlap)) {
      selected.push(cluster)
    }
  }
  return selected
}

function clusterOverlap(left: PrCluster, right: PrCluster) {
  const leftSet = new Set(left.prs)
  const rightSet = new Set(right.prs)
  const shared = [...leftSet].filter((number) => rightSet.has(number)).length
  return shared / Math.min(leftSet.size, rightSet.size)
}

function countBy<T>(items: T[], getLabel: (item: T) => string, options: CountOptions = {}): TrendItem[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const label = getLabel(item)
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const rows = [...counts.entries()].map(([label, count]) => ({ label, count }))
  const sorted = options.chronological
    ? rows.sort((a, b) => a.label.localeCompare(b.label))
    : rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return sorted.slice(0, options.limit ?? 10)
}

function topRepeatedValues(values: string[], limit: number) {
  return countBy(values, (value) => value, { limit }).filter((item) => item.count > 1)
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
  const repeatedChangelets = topRepeatedCount(
    prs.flatMap((pr) =>
      (pr.changelets ?? []).filter(
        (changelet) =>
          isSpecificFloodChangelet(changelet) ||
          changelet === 'edit README only' ||
          changelet === 'update documentation',
      ),
    ),
  )
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

function floodGroupHasRepeatedIntent(prs: PullRequest[]) {
  const count = prs.length
  const majority = Math.max(2, Math.floor(count / 2))
  const repeatedTitles = topRepeatedCount(prs.map((pr) => titleSignature(pr.title)))
  const repeatedChangelets = topRepeatedCount(
    prs.flatMap((pr) =>
      (pr.changelets ?? []).filter(
        (changelet) =>
          isSpecificFloodChangelet(changelet) ||
          changelet === 'edit README only' ||
          changelet === 'update documentation',
      ),
    ),
  )
  if (repeatedTitles >= majority || repeatedChangelets >= majority) return true

  const docsOnly = prs.filter((pr) => pr.signals.docsOnly)
  if (docsOnly.length >= majority) {
    const docFiles = docsOnly.flatMap((pr) =>
      pr.signals.fileNames
        .map((filename) => filename.toLowerCase())
        .filter((filename) => ['readme.md', 'history.md', 'changelog.md'].includes(filename)),
    )
    return topRepeatedCount(docFiles) >= majority
  }
  return false
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

function isSpecificFloodChangelet(changelet: string) {
  const normalized = changelet.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized || normalized.startsWith('touch ')) return false
  if (GENERIC_FLOOD_CHANGELETS.has(normalized)) return false
  const words = normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? []
  return words.length >= 3
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

const GENERIC_CLUSTER_CHANGELETS = new Set([
  ...GENERIC_CHANGELETS,
  'change async or streaming flow',
  'change database or persistence behavior',
  'update examples or cookbook',
])

const GENERIC_FLOOD_CHANGELETS = new Set([
  ...GENERIC_CLUSTER_CHANGELETS,
  'add guard or validation',
  'add or modify tool integration',
  'modify dependency metadata',
  'modify project configuration',
  'update model/provider behavior',
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

interface CountOptions {
  limit?: number
  chronological?: boolean
}
