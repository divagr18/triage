# Pull Guard

Pull Guard is a maintainer cockpit for overloaded open-source pull request queues.
It helps maintainers deslopify incoming PRs by clustering duplicate contribution
attempts, detecting AI-flood patterns, ranking the strongest canonical PR, and
explaining which changes deserve review first.

The project is CLI-first, cache-first, and read-only by default. It uses the
GitHub CLI for ingestion, local JSON caches for repeatable demos, local MiniLM
embeddings for semantic similarity, Responses API calls for patch-text alignment,
and Codex-backed reasoning for PR explain, compare, and maintainer action
recommendations.

Pull Guard is built for the new maintainer problem created by widely available
coding agents: lots of PRs can arrive quickly, many of them shallow, duplicated,
generic, or mismatched with the actual patch. The goal is not to replace
maintainers or punish new contributors. The goal is to preserve maintainer
attention by turning a flat PR list into clusters, queues, trust signals, and
clear review paths.

## What It Does

- Ingests GitHub pull requests through `gh`.
- Caches normalized PR metadata and file patches locally.
- Supports date/window filtering, refreshes, and offline cache reads.
- Extracts deterministic triage signals from paths, diffs, reviews, checks, and PR text.
- Computes transparent contributor trust scores.
- Builds semantic changelets for each PR.
- Uses local embeddings for duplicate and near-duplicate clustering.
- Detects AI-flood waves from timing, semantic overlap, repeated files, low-context text, contributor mix, and alignment signals.
- Ranks canonical PRs inside duplicate clusters.
- Compares competing PRs with Codex reasoning.
- Explains individual PRs with Codex.
- Scores patch-text alignment with the Responses API.
- Produces terminal reports and a Vite frontend dashboard.

## Quick Start

Install Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Authenticate the GitHub CLI:

```bash
gh auth login
```

Scan a repository:

```bash
python triage.py scan microsoft/coreutils --state open --limit 50 --since 2026-05-01
```

Run derived analysis again from cache:

```bash
python triage.py derive microsoft/coreutils --refresh-analysis
```

Inspect the results:

```bash
python triage.py report microsoft/coreutils
python triage.py clusters microsoft/coreutils
python triage.py flood microsoft/coreutils
python triage.py changelets microsoft/coreutils --limit 10
```

Use Codex and alignment features:

```bash
python triage.py align microsoft/coreutils 123
python triage.py explain microsoft/coreutils 123
python triage.py compare microsoft/coreutils 123 456
python triage.py recommend microsoft/coreutils --limit 10
python triage.py enrich microsoft/coreutils --align --limit 50
```

Cache files are stored at:

```text
.triage/cache/{owner}_{repo}/prs.json
```

Offline mode reads the latest cache and never calls GitHub:

```bash
python triage.py scan microsoft/coreutils --offline
```

## Frontend Dashboard

Pull Guard includes a local Vite dashboard for exploring cached scans.

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The dashboard auto-discovers repositories in `.triage/cache` and includes:

- overview metrics
- signal and file-bucket summaries
- review queue
- AI-flood clusters
- duplicate cluster and trend stats
- PR detail drawer with cached AI outputs
- local trusted-user exclusions in Settings

Trusted-user exclusions are frontend-only. They hide selected authors from risk
counts, focus queues, flood clusters, and noisy flags in the local browser view
without mutating the cache or touching GitHub.

## Analysis Pipeline

The core pipeline is:

```text
scan -> derive -> clusters -> flood -> canonical ranking -> AI enrichment -> report/dashboard
```

`scan` collects metadata, patches, reviews, checks, labels, and contributor
history through `gh`. It writes a normalized cache and runs derived analysis by
default.

`derive` persists analysis into the cache under `analysis`, including duplicate
clusters, AI-flood waves, review queues, canonical recommendations, and AI cache
status.

`enrich` runs optional API-backed analysis and stores the results in local AI
cache files. There are no fake success paths for these commands: if the provider
is unavailable, the command reports the failure instead of fabricating output.

## Signals

Pull Guard extracts and persists deterministic signals such as:

- file buckets: code, tests, docs, config, lockfile, generated, other
- touched modules and changed file paths
- patch keywords from symbols, imports, config keys, dependencies, and error strings
- dependency and lockfile changes
- docs-only, README-only, comment-only, and formatting churn
- core changes without tests
- large unrelated refactors
- generic descriptions
- CI and review state
- contributor history within the repo
- burst behavior and concurrent open PRs

Common flags include:

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
- `patch_text_mismatch`
- `claim_tests_missing`
- `claim_perf_but_formatting`
- `sensitive_change_low_context`

## Contributor Trust

Contributor trust is an explainable prioritization signal, not an automatic
close reason. It combines repo-local history, prior merged and closed PRs,
account association, concurrent open PRs, CI/review state, and current triage
flags.

Example output:

```text
Contributor trust: 72/100
Known contributor, prior merged PRs, current CI passing.

Contributor trust: 28/100
First-time contributor, several open PRs, repeated low-context signals.
```

## Duplicate Clustering

Duplicate clustering uses a hybrid similarity score with separate local
embeddings for:

- title/body intent
- normalized changelets and patch-derived behavior

The hybrid score also uses changed-file overlap, patch-keyword overlap, and
linked issue overlap. Clusters are persisted under `analysis.clusters` and each
member receives a recommendation bucket:

- `review_first`
- `safe_close_duplicate`
- `needs_human`
- `probably_junk`
- `risky_but_maybe_valuable`

## AI-Flood Detection

AI-flood detection is built on top of persisted clusters and burst anchors. It
looks for repeated specific intent, close creation windows, repeated files,
generic descriptions, shallow diffs, no-test patterns, new-contributor
concentration, and patch-text mismatch signals when alignment results exist.

Each flood wave includes:

- wave label
- score
- member PRs
- best review candidate
- origin PR when there is a clear original
- per-member trust and alignment signals
- recommended maintainer action

## Codex And LLM Features

Pull Guard uses API-backed reasoning where it adds real maintainer value:

- `align` checks whether the PR title/body matches the actual patch.
- `explain` summarizes a PR, risks, tests, and likely maintainer action.
- `compare` judges two competing PRs and identifies the better review target.
- `recommend` creates a short action plan for risky or high-priority PRs.
- `enrich` runs alignment, explain, and recommendation jobs in batch.

Alignment results feed back into flags, canonical ranking, AI-flood scoring, and
frontend badges. Deterministic alignment estimates are stored separately and are
never presented as LLM output.

## REST And GraphQL

Live scans default to GitHub REST because it behaves better on large PR lists.
GraphQL remains available:

```bash
python triage.py scan agno-agi/agno --api graphql --limit 20 --refresh
```

REST scans use GitHub's core REST API through `gh` for PR lists, files, reviews,
checks, and repository contributor counts. GraphQL scans can still be useful for
some metadata paths, but they may hit tighter search limits on large repositories.

## Development

Run backend tests:

```bash
python -m unittest discover -s tests
```

Run frontend checks:

```bash
cd frontend
npm run lint
npm run build
```

## Current Shape

Pull Guard currently implements the main CLI, persisted analysis cache,
embedding-based duplicate clustering, AI-flood detection, contributor trust,
canonical ranking, patch-text alignment, Codex explain/compare/recommend, and a
multi-page frontend dashboard.

Remaining planned work includes generated static HTML reports, LLM-generated
semantic changelets, LLM cluster labels, repo vision alignment, a stronger
low-value PR classifier, test realism scoring, and dry-run label/comment plans.
