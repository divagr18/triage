# Phasewise Plan: Proper Phase 5, 6, 7, and 9 Completion

## Summary

Bring the project from "working heuristics plus AI commands" to a coherent triage pipeline:

```text
scan -> derive -> clusters -> flood -> canonical ranking -> AI enrichment -> report/frontend
```

The main change is to stop treating clustering, flood, canonical scoring, and AI analysis as separate one-off commands. They should become persisted derived analysis attached to the repo cache and consumed consistently by CLI and frontend.

## Phase 5: Proper Duplicate Clustering

- Replace the current single combined embedding with separate embeddings:
  - `titleBodyEmbedding`: title + body + linked issue text.
  - `changeletEmbedding`: normalized changelets + patch-derived behavior summary.
- Update hybrid similarity to match the plan:
  - `0.35 title/body embedding`
  - `0.30 changelet embedding`
  - `0.20 changed-file Jaccard`
  - `0.10 patch-keyword overlap`
  - `0.05 linked-issue overlap`
- Add deterministic patch keyword extraction from patch hunks:
  - symbols/functions/classes/imports/config keys/dependency names/error strings.
- Add cluster member classification:
  - `review_first`
  - `safe_close_duplicate`
  - `needs_human`
  - `probably_junk`
  - `risky_but_maybe_valuable`
- Persist clusters into cache under `analysis.clusters`.
- Keep `triage clusters` as a read/print command, but make it use persisted analysis unless `--refresh-analysis` is passed.
- Add optional Codex cluster label generation only for cluster labels, cached under `ai/cluster_label`; fallback to deterministic label if Codex is unavailable or not requested.

## Phase 6: Proper AI Flood Mode

- Rebuild flood detection on top of persisted clusters plus direct burst anchors.
- Flood score inputs:
  - close creation window
  - semantic cluster overlap
  - title/body embedding similarity
  - repeated generic descriptions
  - repeated touched files or trivial docs paths
  - first-time/new contributor concentration
  - shallow diff ratio
  - no-test or failing-CI ratio
  - patch-text mismatch ratio when alignment cache exists
- Tighten wave eligibility:
  - require either semantic cluster membership or repeated specific intent.
  - do not flood-tag merely because broad files or generic changelets overlap.
- Persist waves into `analysis.floodWaves`.
- Each wave should include:
  - `bestPr`
  - `bestReason`
  - `originPr` when earliest PR is meaningfully earlier
  - `prs` with per-member trust score, flags, alignment verdict if available.
- Update `triage flood` to print cluster-style wave output, not just PR lists.
- Frontend AI Flood page should read persisted `analysis.floodWaves`, show clusters/waves, highlight origin or highest-trust canonical PR, and avoid recomputing differently from CLI.

## Phase 7: Proper Canonical PR Ranking

- Replace `canonical_score(pr) -> int` with `canonical_recommendation(pr, cluster?, flood?, alignment?) -> object`.
- New recommendation object:
  - `bucket`
  - `score`
  - `confidence`
  - `reasons`
  - `risks`
  - `scoreBreakdown`
- Score factors:
  - positive: changelet coverage, tests present, CI passing, small focused diff, clear description, reviewer activity, contributor trust.
  - negative: unrelated-change entropy, dependency bloat, generated-file churn, core change without tests, patch-text mismatch, AI flood penalty.
- Add deterministic helpers:
  - `changelet_coverage(pr, cluster)`
  - `unrelated_change_entropy(pr)`
  - `dependency_bloat_score(pr)`
  - `generated_churn_score(pr)`
  - `description_clarity_score(pr)`
- Persist per-PR recommendations into `pr.recommendation`.
- Persist cluster-level canonical choice using the same recommendation object, not separate logic.
- `triage report` should include:
  - review-first queue
  - safe-close duplicate queue
  - needs-human queue
  - probably-junk queue
  - risky-but-maybe-valuable queue.

## Phase 9: Proper Patch-Text Alignment Integration

- Keep current commands:
  - `triage align`
  - `triage explain`
  - `triage compare`
  - `triage recommend`
- Add `triage enrich`:
  - `triage enrich owner/repo --align --limit 50`
  - `triage enrich owner/repo --explain --prs 123,456`
  - `triage enrich owner/repo --recommend --limit 10`
  - `triage enrich owner/repo --refresh-ai`
- Alignment results remain real API outputs only; no fake fallback.
- Add deterministic alignment estimate only as a separate field:
  - `alignment.estimatedScore`
  - never label it as LLM/Codex output.
- Feed cached alignment into:
  - PR flags: `patch_text_mismatch`, `claim_tests_missing`, `claim_perf_but_formatting`, `sensitive_change_low_context`.
  - canonical score penalties.
  - AI flood scoring.
  - frontend PR cards and queue filters.
- Add `analysis.aiStatus` index:
  - per PR: `hasAlignment`, `hasExplain`, `hasCompare`, cached timestamps, provider.
- Frontend should show:
  - dashboard Codex review plan from cached `recommend`.
  - PR drawer AI tab with buttons and cached outputs.
  - queue badges for alignment/Codex availability.
  - filter: "AI mismatch" once alignment flags exist.

## Public Interfaces And Data Shape

- Cache schema moves to `schemaVersion: 5`.
- Add top-level `analysis`:

```json
{
  "analysis": {
    "clusters": [],
    "floodWaves": [],
    "reviewQueue": [],
    "aiStatus": {},
    "generatedAt": "...",
    "analysisVersion": "phase-7-v1"
  }
}
```

- Add per-PR fields:

```json
{
  "recommendation": {
    "bucket": "review_first",
    "score": 82,
    "confidence": 0.78,
    "reasons": [],
    "risks": [],
    "scoreBreakdown": {}
  },
  "alignment": {
    "cached": true,
    "verdict": "aligned",
    "score": 0.95
  }
}
```

- Add command:

```bash
triage derive owner/repo --refresh-analysis
```

This computes Phase 5/6/7 persisted analysis from cache. `scan` should call `derive` automatically unless `--no-derive` is passed.

## Test Plan

- Unit tests:
  - separate title/body and changelet embeddings are combined with planned weights.
  - patch keyword extraction finds symbols/config/dependency/error tokens.
  - clusters reject broad/generic overlap and accept true semantic duplicates.
  - flood requires repeated specific intent or semantic cluster overlap.
  - flood score increases when cached alignment mismatch exists.
  - canonical recommendation returns correct bucket and score breakdown.
  - `triage enrich` caches real/mock AI outputs and never fabricates success.
- Integration tests:
  - scan cache -> derive -> clusters/flood/report all read the same persisted analysis.
  - frontend API returns `analysis` and `aiStatus`.
  - frontend build and lint pass.
- Manual acceptance:
  - Run on `openclaw/openclaw --limit 300`.
  - Confirm clusters are not broad/random.
  - Confirm flood waves are meaningfully similar.
  - Confirm PR drawer AI buttons create cache and refresh UI.
  - Confirm report queues match frontend queues.

## Assumptions

- Use the existing Python CLI and Vite frontend.
- Keep `.triage/cache` ignored; real repo scans remain local demo artifacts.
- Use local MiniLM embeddings for clustering by default.
- Use Responses API for patch-text alignment.
- Use Codex SDK first, CLI fallback, for explain/compare/recommend.
- No fixtures or synthetic success paths in production commands.
