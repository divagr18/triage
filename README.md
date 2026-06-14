# triage

Semantic PR triage for AI-flooded repositories.

This is a CLI-first maintainer assistant. It currently implements GitHub
ingestion through `gh`, normalized local caching, date/window filtering,
per-PR file patch collection, lightweight contributor history, and
deterministic triage signals.

## Usage

```bash
python triage.py scan microsoft/coreutils --state open --limit 50 --since 2026-05-01
python triage.py scan microsoft/coreutils --offline
python triage.py report microsoft/coreutils
python triage.py cache-path microsoft/coreutils
```

`scan` writes normalized data to:

```text
.triage/cache/{owner}_{repo}/prs.json
```

Live scans require the GitHub CLI:

```bash
gh auth login
```

Offline scans read the latest cache and never call GitHub.

## Deterministic Signals

`scan` enriches cached PR records with:

- file buckets: code, tests, docs, config, lockfile, generated, other
- touched modules and title/body keywords
- CI and review state
- contributor history signals
- flags such as `readme_only_noise`, `dependency_without_usage`,
  `core_change_without_tests`, `ci_failing`, and `possible_ai_flood_member`
