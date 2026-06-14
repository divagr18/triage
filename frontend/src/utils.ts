import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import type { PullRequest } from './types'

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
      return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    case 'medium':
      return 'text-amber-400 bg-amber-400/10 border-amber-400/20'
    case 'low':
      return 'text-orange-400 bg-orange-400/10 border-orange-400/20'
    case 'very_low':
      return 'text-red-400 bg-red-400/10 border-red-400/20'
    default:
      return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20'
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
    return 'text-red-400 border-red-400/20 bg-red-400/10'
  }
  if (flag.includes('noise') || flag.includes('generic') || flag.includes('churn') || flag.includes('lockfile')) {
    return 'text-amber-400 border-amber-400/20 bg-amber-400/10'
  }
  if (flag.includes('no_human_review')) {
    return 'text-zinc-400 border-zinc-400/20 bg-zinc-400/10'
  }
  return 'text-blue-400 border-blue-400/20 bg-blue-400/10'
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

export type SortKey = 'newest' | 'oldest' | 'trust-high' | 'trust-low' | 'changes'
