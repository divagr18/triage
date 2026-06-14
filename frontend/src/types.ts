export interface Author {
  login: string
  name: string
  association: string | null
}

export interface Label {
  name: string
  color: string
}

export interface Review {
  author: string
  state: string
  submittedAt: string | null
}

export interface Check {
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface FileChange {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch: string
  rawUrl: string | null
  blobUrl: string | null
  previousFilename: string | null
}

export interface Contributor {
  login: string
  priorMergedPrs: number
  priorClosedPrs: number
  priorClosedUnmergedPrs: number
  currentOpenPrs: number
  currentOpenPrsInScan: number
  accountAssociation: string | null
  repoCommitContributions?: number
  historySource?: string
  recentPrUrls: string[]
  trustScore?: number
  trustBucket?: string
}

export interface ContributorTrust {
  score: number
  bucket: 'high' | 'medium' | 'low' | 'very_low'
  positives: string[]
  risks: string[]
  explanation: string
}

export interface FileBuckets {
  code: number
  tests: number
  docs: number
  config: number
  lockfile: number
  generated: number
  other: number
}

export interface Signals {
  fileBuckets: FileBuckets
  touchedModules: string[]
  fileNames: string[]
  keywords: string[]
  hasTests: boolean
  hasCode: boolean
  docsOnly: boolean
  readmeOnly: boolean
  lockfileOnly: boolean
  configOnly: boolean
  dependencyFilesChanged: string[]
  generatedFilesChanged: number
  coreFilesChanged: string[]
  addedLines: number
  removedLines: number
  totalChanges: number
  addDeleteRatio: number
  commentOnly: boolean
  formattingChurn: boolean
  descriptionLength: number
  titleLength: number
  genericDescription: boolean
  ciState: 'none' | 'passing' | 'pending' | 'failing' | 'unknown'
  reviewState: 'none' | 'approved' | 'reviewed' | 'changes_requested' | string
  authorPriorMergedPrs: number
  authorCurrentOpenPrs: number
  authorOpenPrsInScan: number
  authorAssociation: string | null
  isNewContributor: boolean
  largeDiff: boolean
  smallDiff: boolean
}

export interface PullRequest {
  number: number
  title: string
  body: string
  author: Author
  createdAt: string
  updatedAt: string
  url: string
  state: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  labels: Label[]
  reviews: Review[]
  checks: Check[]
  reviewDecision: string | null
  mergeable: string | null
  mergeStateStatus: string | null
  files: FileChange[]
  contributor: Contributor
  signals: Signals
  flags: string[]
  changelets?: string[]
  contributorTrust: ContributorTrust
}

export interface SignalSummary {
  flagCounts: Record<string, number>
  fileBucketCounts: Record<string, number>
  lowValuePrs: number
  riskyNewContributorPrs: number
  lowTrustPrs: number
  averageContributorTrust: number | null
}

export interface TriageCache {
  schemaVersion: number
  tool: string
  repo: string
  state: string
  limit: number
  since: string | null
  scannedAt: string
  source: string
  prs: PullRequest[]
  signalSummary: SignalSummary
}

export interface FloodWave {
  id: string
  label: string
  prs: number[]
  score: number
  window: string
  bestPr: number
  bestTitle: string
  reasons: string[]
  recommendedAction: string
}

export interface RepoMeta {
  slug: string
  repo: string
  exists: boolean
}
