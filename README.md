# triage

Semantic PR triage for AI-flooded repositories.

This is a CLI-first maintainer assistant. Phase 1 implements GitHub ingestion
through `gh`, normalized local caching, date/window filtering, per-PR file patch
collection, and lightweight contributor history.

## Usage

```bash
python triage.py scan microsoft/coreutils --state open --limit 50 --since 2026-05-01
python triage.py scan microsoft/coreutils --offline
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
