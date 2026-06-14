# Semantic PR Triage Hackathon Plan

## Summary

Build a **Codex-era maintainer assistant** that scans open PRs in a GitHub repo, groups duplicate/similar contribution attempts, detects low-value AI/slop PRs, spots AI-flood patterns, ranks canonical PRs, compares competing PRs, and estimates contributor trust signals.

Default product shape: **CLI first + generated HTML report**.

Core demo promise:

```bash
triage scan owner/repo --state open --limit 150 --since 2026-05-01
triage report
triage compare 1842 1811
triage explain 1842
```

Output:

```text
Scanned 150 PRs

Found:
22 duplicate clusters
41 low-value PRs
13 canonical candidates
6 AI-flood waves
18 risky new-contributor PRs
31 suggested maintainer actions
```

## Phased Build Plan

### Phase 1: GitHub Ingestion And Cache

Build the reliable base first.

- Use `gh` as the data layer.
- Pull PR metadata: number, title, body, author, createdAt, updatedAt, labels, additions, deletions, changedFiles, reviews, checks, URL.
- Pull per-PR file patches via `gh api repos/{owner}/{repo}/pulls/{number}/files`.
- Pull lightweight contributor history within the same repo: prior merged PR count, prior closed PR count, current open PR count, account association when available.
- Store normalized JSON in `.triage/cache/{owner}_{repo}/prs.json`.
- Add `--limit`, `--since`, `--state`, `--refresh`, and `--offline`.
- Make the demo always run from cache if GitHub rate limits or network gets weird.

CLI:

```bash
triage scan expressjs/express --limit 100 --since 2026-05-01
triage scan nodejs/node --limit 100 --offline
```

### Phase 2: Deterministic Signals

Get useful results before ML.

Extract per PR:

- changed file paths
- touched top-level packages/modules
- file type buckets: code, tests, docs, config, lockfile, generated
- additions/deletions ratio
- README-only/docs-only/comment-only
- dependency/package changes
- test presence
- CI status
- review state
- author history within scan window
- contributor trust signals
- title/body keywords
- creation-time bursts and similar-author waves

Add flags:

- `readme_only_noise`
- `docs_rewrite_noise`
- `dependency_without_usage`
- `lockfile_only`
- `formatting_churn`
- `core_change_without_tests`
- `large_unrelated_refactor`
- `test_only_mock_inflation`
- `description_too_generic`
- `ci_failing`
- `no_human_review`
- `new_contributor_high_risk`
- `possible_ai_flood_member`

### Phase 3: Contributor Trust Score

Make contributor trust a first-class maintainer signal.

Score should be transparent, not moralizing.

Inputs:

- prior merged PRs in repo
- prior reviewed/approved PRs if available
- prior closed-unmerged PRs
- current duplicate/slop flags
- CI status on current PR
- review decision
- account association from GitHub metadata
- number of concurrent open PRs in the scanned repo
- burst behavior: many similar PRs in short window

Output:

```text
Contributor trust: 72/100
Known contributor, 4 prior merged PRs, current CI passing.

Contributor trust: 28/100
First-time contributor, 7 open PRs this week, 5 resemble low-value doc rewrites.
```

Use this as a ranking feature, never as an automatic close reason by itself.

### Phase 4: Semantic Changelets

Add the main "cool ML" layer.

For each PR, summarize the patch into compact changelets:

```json
{
  "pr": 1842,
  "changelets": [
    "adds dockerfile",
    "updates ci workflow",
    "adds env var documentation",
    "touches runtime config without tests"
  ]
}
```

Implementation:

- Start with deterministic patch parsing.
- Use filename + hunk headers + added/removed lines.
- Optionally call an LLM once per PR to produce 3-8 normalized changelets.
- Cache LLM outputs permanently.
- Keep changelets short and verb-like.

Changelet examples:

- `add null guard`
- `replace deprecated api`
- `add retry wrapper`
- `modify config default`
- `edit README only`
- `add dependency`
- `touch core runtime`
- `add mock-heavy test`
- `rename option`
- `change error message`

### Phase 5: Duplicate Clustering

Cluster PRs by meaning, not just titles.

Use a hybrid similarity score:

```text
similarity =
  0.35 * title_body_embedding
+ 0.30 * changelet_embedding
+ 0.20 * changed_file_overlap
+ 0.10 * patch_keyword_overlap
+ 0.05 * linked_issue_overlap
```

Minimum viable implementation:

- Generate embeddings for title/body/changelets.
- Use cosine similarity.
- Add changed-file Jaccard similarity.
- Cluster with threshold-based connected components.
- Label each cluster using an LLM or top keywords.

Cluster output:

```text
Cluster: Add Docker support

Best candidate:
#1842 complete implementation, tests pass, minimal unrelated diff

Close candidates:
#1811 README-only duplicate
#1820 adds unused dependency
#1833 touches runtime unnecessarily

Needs human:
#1850 broader redesign, possibly valuable but high risk
```

### Phase 6: AI Flood Mode

Detect waves of similar, low-context, low-value PRs.

AI flood score combines:

- many PRs created close together
- high title/body similarity
- repeated generic descriptions
- repeated touched files or trivial docs paths
- many first-time/new contributors
- shallow diffs
- low patch-text alignment
- repeated failed/no-test patterns
- duplicate clusters created in a short time window

Output:

```text
AI flood wave: README cleanup burst
18 PRs over 36 hours
14 first-time contributors
11 docs-only rewrites
9 near-duplicate titles
Recommended action: review one canonical PR, bulk-label the rest as duplicate/needs-info.
```

Add commands:

```bash
triage flood
triage flood --since 2026-05-01
```

### Phase 7: Canonical PR Ranking

Inside each cluster, pick the best maintainer attention target.

Score:

```text
canonical_score =
  + changelet_coverage
  + tests_present
  + ci_passing
  + small_focused_diff
  + clear_description
  + reviewer_activity
  + contributor_trust
  - unrelated_change_entropy
  - dependency_bloat
  - generated_file_churn
  - core_change_without_tests
  - patch_text_mismatch
  - ai_flood_penalty
```

Output categories:

- `review_first`
- `safe_close_duplicate`
- `needs_human`
- `probably_junk`
- `risky_but_maybe_valuable`

### Phase 8: PR Compare

Make `triage compare` a core demo feature.

Command:

```bash
triage compare 1842 1811
```

Compare two PRs across:

- shared intent/changelets
- changed files
- tests
- CI status
- diff size/focus
- dependency changes
- contributor trust
- patch-text alignment
- architecture/core risk
- likely maintainer action

Output:

```text
#1842 is the better review candidate.

Why:
- Covers 5/6 cluster changelets vs #1811 covers 2/6
- Includes tests; #1811 is docs-only
- CI passing; #1811 has no checks
- Lower unrelated-change entropy
- Higher contributor trust score

Suggested action:
Review #1842 first. Mark #1811 duplicate if #1842 is accepted.
```

### Phase 9: Patch-Text Alignment Model

Add the strongest "AI slop detector" feature.

For each PR, compare what the author says with what the patch does.

Flags:

- Title says "fix bug", patch only edits docs.
- Body says "add tests", patch adds shallow mocks only.
- Body says "performance improvement", patch changes formatting.
- Description is generic but diff touches sensitive/core files.
- Claimed issue does not match changed code area.

Implementation options:

- Fast version: LLM judge with structured JSON.
- Better version: embedding similarity between `claimed_intent` and `actual_changelets`.
- Best version: both, with explanation.

### Phase 10: Vision Alignment

Let repos define local maintainer taste.

Add optional config:

```yaml
goals:
  - improve runtime stability
  - reduce flaky tests
  - preserve public API compatibility

non_goals:
  - README rewrites
  - new plugin systems
  - large refactors without issue

protected_paths:
  lib/**:
    requires:
      - tests
      - linked_issue
  package.json:
    requires:
      - dependency_justification
```

Use this to flag:

- `vision_aligned`
- `vision_drift`
- `protected_path_violation`
- `requires_maintainer_review`

### Phase 11: Report UX

Build both terminal and HTML report.

Terminal commands:

```bash
triage report
triage clusters
triage flood
triage compare 1842 1811
triage explain 1842
triage label-plan --dry-run
triage close-plan --dry-run
```

HTML sections:

- Overview metrics
- Duplicate clusters
- AI flood waves
- Canonical PR queue
- Low-value PR queue
- Risky new-contributor queue
- Contributor trust distribution
- Risky/core PR queue
- Vision-drift queue
- Per-PR explanation page
- Pairwise compare view
- Suggested labels/comments

The HTML should be the hackathon artifact.

## Feature List

### Main Track Features

- GitHub PR ingestion through `gh`.
- Local JSON cache.
- Date/window filtering.
- PR metadata + patch extraction.
- Deterministic junk flags.
- Contributor trust score.
- Semantic changelet extraction.
- Embedding-based duplicate clustering.
- AI flood detection.
- Canonical PR recommendation.
- `triage compare`.
- Patch-text consistency scoring.
- Terminal report.
- Static HTML report.
- `triage explain`.

### ML Features

- Embedding-based duplicate detection.
- LLM-generated semantic changelets.
- Patch-text consistency judge.
- Cluster name generation.
- Canonical PR explanation generation.
- Repo vision alignment classifier.
- Low-value PR classifier.
- AI flood wave detection.
- Contributor trust risk modeling.
- Unrelated-change entropy score.
- Test realism score.
- Dependency bloat detector.
- Maintainer action recommender.
- Pairwise PR comparison judge.

### Stretch Features If Ahead Of Time

- `triage label-plan --dry-run` to suggest GitHub labels.
- `triage comment-plan --dry-run` to generate polite close/review comments.
- `triage watch owner/repo` to rescan periodically.
- Reviewer routing based on touched paths.
- Timeline view of duplicate waves.
- Embedding visualization of PR clusters.
- GitHub Action mode that posts a report artifact.
- Configurable model provider.
- Offline fixture mode for guaranteed demo reliability.
- Synthetic PR flood generator for backup demos.
- Export to Markdown issue comment.
- "Safe close" confidence thresholds.
- Natural-language search: `triage ask "which PRs add Docker support?"`.

## Suggested Internal Data Shape

PR record:

```json
{
  "number": 1842,
  "title": "Add Docker support",
  "body": "...",
  "author": "...",
  "createdAt": "...",
  "url": "...",
  "additions": 120,
  "deletions": 14,
  "changedFiles": 5,
  "files": [
    {
      "filename": "Dockerfile",
      "status": "added",
      "patch": "..."
    }
  ],
  "contributor": {
    "trustScore": 72,
    "priorMergedPrs": 4,
    "priorClosedPrs": 1,
    "currentOpenPrs": 2,
    "accountAssociation": "CONTRIBUTOR"
  },
  "signals": {},
  "changelets": [],
  "scores": {},
  "recommendation": {}
}
```

Recommendation:

```json
{
  "bucket": "review_first",
  "confidence": 0.87,
  "cluster": "add-docker-support",
  "reasons": [
    "covers main cluster changelets",
    "tests pass",
    "minimal unrelated diff",
    "trusted contributor history"
  ],
  "risks": [
    "touches CI config"
  ]
}
```

AI flood record:

```json
{
  "id": "flood_readme_cleanup_2026_05",
  "label": "README cleanup burst",
  "prs": [1811, 1817, 1820, 1824],
  "score": 0.84,
  "window": "36 hours",
  "reasons": [
    "high title similarity",
    "docs-only diffs",
    "mostly first-time contributors",
    "low patch-text alignment"
  ]
}
```

## Demo Plan

Use a popular JS/Python repo only after testing which one has the clearest PR stream.

Candidate categories:

- JS frameworks/libs: Express, Next.js, Node.js ecosystem packages.
- Python web/libs: Flask, FastAPI, Django-adjacent packages.
- Docs-heavy repos if needing obvious low-value PR examples.

Live demo flow:

```bash
triage scan owner/repo --limit 150 --since 2026-05-01
triage report
triage flood
triage clusters
triage compare <canonical-pr> <duplicate-pr>
triage explain <canonical-pr>
```

Backup demo:

- Pre-cache one real repo scan.
- Include a synthetic "AI-flooded repo" fixture with obvious duplicate/slop PRs.
- If live scan is boring, show real repo first, then synthetic fixture to demonstrate the full power.

## Test Plan

- Unit test PR normalization from `gh` JSON.
- Unit test patch parsing and file bucket classification.
- Unit test contributor trust score from fixture history.
- Unit test AI flood detection from clustered timestamp/title/file fixtures.
- Unit test junk flags: docs-only, lockfile-only, dependency-without-usage, core-without-tests.
- Unit test similarity scoring with known duplicate/non-duplicate pairs.
- Unit test `triage compare` output for canonical vs low-value PR pair.
- Snapshot test terminal report.
- Snapshot test HTML report generation.
- Fixture test using 20-50 cached PR JSON records.
- Offline mode test that never calls GitHub.
- Failure test for missing `gh`, unauthenticated `gh`, rate limits, empty PR list, and missing patch data.

## Assumptions And Defaults

- Build as a **new CLI tool**, likely Python for lower code size and faster ML-ish iteration.
- Use `gh` instead of building GitHub OAuth.
- Use cached JSON as the source of truth after scan.
- Use OpenAI embeddings/LLM calls for semantic features, but every LLM output must be cached.
- Do not auto-label, auto-close, or comment on PRs during the hackathon demo.
- Contributor trust is an explainable prioritization signal, not a moral judgment or automatic rejection rule.
- AI flood mode identifies review pressure patterns, not author intent.
- Default mode is read-only and maintainer-safe.
- Repo selection is deferred until implementation testing; the product supports any GitHub repo accepted by `gh`.
- If time gets tight, prioritize: ingestion, contributor trust, heuristics, changelets, clustering, AI flood mode, compare, canonical recommendation, and HTML report.
