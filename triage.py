#!/usr/bin/env python3
"""CLI-first semantic PR triage.

Phase 1 focuses on GitHub ingestion and cache reliability:
- read PR metadata through gh
- pull per-PR file patches
- collect lightweight contributor history
- normalize everything into a stable local JSON cache
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CACHE_ROOT = Path(".triage") / "cache"
SCHEMA_VERSION = 4
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_REASONING_MODEL = "gpt-5.4"
DEFAULT_CODEX_MODEL = "gpt-5.4"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
STOP_WORDS = {
    "a",
    "add",
    "adds",
    "an",
    "and",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "update",
    "updates",
    "with",
}
DOC_NAMES = {"readme", "changelog", "changes", "contributing", "code_of_conduct", "license"}
CONFIG_NAMES = {
    ".github",
    ".gitignore",
    ".prettierrc",
    ".eslintrc",
    "dockerfile",
    "makefile",
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
    "tsconfig.json",
}
LOCKFILE_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "cargo.lock", "go.sum"}
DEPENDENCY_FILES = {
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "cargo.toml",
    "go.mod",
    "gemfile",
}
GENERATED_MARKERS = {"dist/", "build/", "vendor/", "generated/", "docs/_build/"}
TEST_MARKERS = {"test", "tests", "__tests__", "spec", "specs"}
CORE_MARKERS = {"src", "lib", "packages", "crates", "core", "internal"}
PR_LIST_FIELDS = [
    "number",
    "title",
    "body",
    "author",
    "createdAt",
    "updatedAt",
    "labels",
    "additions",
    "deletions",
    "changedFiles",
    "reviews",
    "latestReviews",
    "statusCheckRollup",
    "reviewDecision",
    "url",
    "state",
    "isDraft",
    "mergeable",
    "mergeStateStatus",
]
SEARCH_FIELDS = [
    "number",
    "title",
    "author",
    "authorAssociation",
    "createdAt",
    "updatedAt",
    "closedAt",
    "state",
    "url",
]

FINGERPRINTING_GUIDANCE = {
    "principle": "Cluster and judge program transformations, not raw PR text.",
    "signals": [
        "semantic changelets",
        "patch-text alignment",
        "behavior delta",
        "test realism",
        "changed-path topology",
        "dependency/config mutation",
        "maintainer action cost",
    ],
    "canonical_rule": "Prefer the PR that captures the useful shared transformation with the least unrelated change mass.",
}

PATCH_TEXT_ALIGNMENT_SCHEMA = {
    "name": "patch_text_alignment",
    "schema": {
        "type": "object",
        "properties": {
            "pr": {"type": "integer"},
            "alignmentScore": {"type": "number"},
            "verdict": {"type": "string", "enum": ["aligned", "partial", "mismatch", "unclear"]},
            "claimedIntent": {"type": "string"},
            "actualChange": {"type": "string"},
            "mismatches": {"type": "array", "items": {"type": "string"}},
            "evidence": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "number"},
        },
        "required": [
            "pr",
            "alignmentScore",
            "verdict",
            "claimedIntent",
            "actualChange",
            "mismatches",
            "evidence",
            "confidence",
        ],
        "additionalProperties": False,
    },
}

CODEX_EXPLAIN_SCHEMA = {
    "name": "codex_pr_explain",
    "schema": {
        "type": "object",
        "properties": {
            "pr": {"type": "integer"},
            "summary": {"type": "string"},
            "actualChange": {"type": "string"},
            "patchTextAlignment": {"type": "string", "enum": ["aligned", "partial", "mismatch", "unclear"]},
            "riskLevel": {"type": "string", "enum": ["low", "medium", "high"]},
            "recommendedAction": {
                "type": "string",
                "enum": ["review_first", "needs_info", "duplicate", "probably_junk", "risky_but_maybe_valuable", "safe_to_ignore_for_now"],
            },
            "reasons": {"type": "array", "items": {"type": "string"}},
            "risks": {"type": "array", "items": {"type": "string"}},
            "questionsForMaintainer": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "number"},
        },
        "required": [
            "pr",
            "summary",
            "actualChange",
            "patchTextAlignment",
            "riskLevel",
            "recommendedAction",
            "reasons",
            "risks",
            "questionsForMaintainer",
            "confidence",
        ],
        "additionalProperties": False,
    },
}

CODEX_COMPARE_SCHEMA = {
    "name": "codex_pr_compare",
    "schema": {
        "type": "object",
        "properties": {
            "leftPr": {"type": "integer"},
            "rightPr": {"type": "integer"},
            "sameIntent": {"type": "boolean"},
            "betterReviewCandidate": {"type": "integer"},
            "canonicalRationale": {"type": "string"},
            "leftStrengths": {"type": "array", "items": {"type": "string"}},
            "rightStrengths": {"type": "array", "items": {"type": "string"}},
            "leftRisks": {"type": "array", "items": {"type": "string"}},
            "rightRisks": {"type": "array", "items": {"type": "string"}},
            "suggestedAction": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": [
            "leftPr",
            "rightPr",
            "sameIntent",
            "betterReviewCandidate",
            "canonicalRationale",
            "leftStrengths",
            "rightStrengths",
            "leftRisks",
            "rightRisks",
            "suggestedAction",
            "confidence",
        ],
        "additionalProperties": False,
    },
}

CODEX_RECOMMEND_SCHEMA = {
    "name": "codex_action_recommendations",
    "schema": {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pr": {"type": "integer"},
                        "action": {
                            "type": "string",
                            "enum": [
                                "review_first",
                                "needs_info",
                                "duplicate",
                                "probably_junk",
                                "risky_but_maybe_valuable",
                                "safe_to_ignore_for_now",
                            ],
                        },
                        "priority": {"type": "integer"},
                        "reason": {"type": "string"},
                        "risks": {"type": "array", "items": {"type": "string"}},
                        "confidence": {"type": "number"},
                    },
                    "required": ["pr", "action", "priority", "reason", "risks", "confidence"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string"},
        },
        "required": ["recommendations", "summary"],
        "additionalProperties": False,
    },
}


class TriageError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScanArgs:
    repo: str
    state: str
    limit: int
    since: str | None
    refresh: bool
    offline: bool
    history_limit: int
    api: str


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "scan":
            scan_command(args)
        elif args.command == "report":
            report_command(args)
        elif args.command == "changelets":
            changelets_command(args)
        elif args.command == "clusters":
            clusters_command(args)
        elif args.command == "flood":
            flood_command(args)
        elif args.command == "align":
            align_command(args)
        elif args.command == "explain":
            explain_command(args)
        elif args.command == "compare":
            compare_command(args)
        elif args.command == "recommend":
            recommend_command(args)
        elif args.command == "cache-path":
            print(cache_path_for_repo(args.repo))
        else:
            parser.print_help()
            return 2
    except TriageError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="triage",
        description="Semantic PR triage for AI-flooded repositories.",
    )
    subcommands = parser.add_subparsers(dest="command")

    scan = subcommands.add_parser("scan", help="scan a GitHub repo and cache normalized PR data")
    scan.add_argument("repo", help="repository in owner/repo form")
    scan.add_argument("--state", choices=["open", "closed", "merged", "all"], default="open")
    scan.add_argument("--limit", type=positive_int, default=100)
    scan.add_argument("--since", help="created-at lower bound, for example 2026-05-01")
    scan.add_argument("--refresh", action="store_true", help="ignore existing cache and call GitHub")
    scan.add_argument("--offline", action="store_true", help="read cache only; never call GitHub")
    scan.add_argument(
        "--api",
        choices=["rest", "graphql"],
        default="rest",
        help="GitHub API path to use for live scans; REST avoids large GraphQL list failures",
    )
    scan.add_argument(
        "--history-limit",
        type=positive_int,
        default=50,
        help="GraphQL mode only: max prior PRs to inspect per contributor via GitHub Search",
    )

    report = subcommands.add_parser("report", help="show deterministic signal summary from cache")
    report.add_argument("repo", help="repository in owner/repo form")

    changelets = subcommands.add_parser("changelets", help="show semantic changelets from cache")
    changelets.add_argument("repo", help="repository in owner/repo form")
    changelets.add_argument("--limit", type=positive_int, default=20)

    clusters = subcommands.add_parser("clusters", help="show duplicate/similar PR clusters from cache")
    clusters.add_argument("repo", help="repository in owner/repo form")
    clusters.add_argument("--threshold", type=float, default=0.62)
    clusters.add_argument("--limit", type=positive_int, default=20)
    clusters.add_argument("--model", default=DEFAULT_EMBEDDING_MODEL)
    clusters.add_argument("--refresh-embeddings", action="store_true")

    flood = subcommands.add_parser("flood", help="detect likely AI-flood PR waves from cache")
    flood.add_argument("repo", help="repository in owner/repo form")
    flood.add_argument("--since", help="created-at lower bound, for example 2026-05-01")
    flood.add_argument("--window-hours", type=positive_int, default=48)
    flood.add_argument("--min-size", type=positive_int, default=3)
    flood.add_argument("--threshold", type=float, default=0.72)
    flood.add_argument("--cluster-threshold", type=float, default=0.72)
    flood.add_argument("--limit", type=positive_int, default=20)
    flood.add_argument("--model", default=DEFAULT_EMBEDDING_MODEL)
    flood.add_argument("--refresh-embeddings", action="store_true")

    align = subcommands.add_parser("align", help="judge patch-text alignment for a PR via Responses API")
    align.add_argument("repo", help="repository in owner/repo form")
    align.add_argument("pr", type=positive_int, help="pull request number")
    align.add_argument("--model", default=DEFAULT_REASONING_MODEL)
    align.add_argument("--refresh-ai", action="store_true")

    explain = subcommands.add_parser("explain", help="explain a PR and recommend maintainer action via Codex")
    explain.add_argument("repo", help="repository in owner/repo form")
    explain.add_argument("pr", type=positive_int, help="pull request number")
    explain.add_argument("--model", default=DEFAULT_CODEX_MODEL)
    explain.add_argument("--refresh-ai", action="store_true")

    compare = subcommands.add_parser("compare", help="compare two PRs with Codex reasoning")
    compare.add_argument("repo", help="repository in owner/repo form")
    compare.add_argument("left", type=positive_int, help="first pull request number")
    compare.add_argument("right", type=positive_int, help="second pull request number")
    compare.add_argument("--model", default=DEFAULT_CODEX_MODEL)
    compare.add_argument("--refresh-ai", action="store_true")

    recommend = subcommands.add_parser("recommend", help="recommend maintainer actions for risky PRs via Codex")
    recommend.add_argument("repo", help="repository in owner/repo form")
    recommend.add_argument("--limit", type=positive_int, default=5)
    recommend.add_argument("--model", default=DEFAULT_CODEX_MODEL)
    recommend.add_argument("--refresh-ai", action="store_true")

    cache_path = subcommands.add_parser("cache-path", help="print cache file path for a repo")
    cache_path.add_argument("repo", help="repository in owner/repo form")
    return parser


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def scan_command(args: argparse.Namespace) -> None:
    scan_args = ScanArgs(
        repo=args.repo,
        state=args.state,
        limit=args.limit,
        since=args.since,
        refresh=args.refresh,
        offline=args.offline,
        history_limit=args.history_limit,
        api=args.api,
    )
    validate_repo(scan_args.repo)
    path = cache_path_for_repo(scan_args.repo)

    if scan_args.offline:
        data = read_cache(path)
        attach_deterministic_signals(data)
        print_scan_summary(data, offline=True)
        return

    if path.exists() and not scan_args.refresh:
        data = read_cache(path)
        attach_deterministic_signals(data)
        print(f"Using cached scan at {path}. Pass --refresh to call GitHub.")
        print_scan_summary(data, offline=True)
        return

    require_gh()
    data = scan_github(scan_args)
    write_cache(path, data)
    print_scan_summary(data, offline=False)
    print(f"Cache: {path}")


def report_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    print_signal_report(data)


def changelets_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    print_changelets(data, limit=args.limit)


def clusters_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    data["clusters"] = build_duplicate_clusters(
        args.repo,
        data.get("prs") or [],
        threshold=args.threshold,
        model_name=args.model,
        refresh_embeddings=args.refresh_embeddings,
    )
    print_clusters(data, limit=args.limit)


def flood_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    waves = build_ai_flood_waves(
        args.repo,
        data.get("prs") or [],
        since=args.since,
        window_hours=args.window_hours,
        min_size=args.min_size,
        threshold=args.threshold,
        cluster_threshold=args.cluster_threshold,
        model_name=args.model,
        refresh_embeddings=args.refresh_embeddings,
    )
    data["floodWaves"] = waves
    print_flood_waves(data, waves, limit=args.limit)


def align_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    pr = find_pr(data, args.pr)
    result = cached_ai_result(
        args.repo,
        "alignment",
        alignment_cache_key(pr, args.model),
        refresh=args.refresh_ai,
        compute=lambda: run_patch_text_alignment(pr, model=args.model),
    )
    print_json_result("Patch-Text Alignment", result)


def explain_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    pr = find_pr(data, args.pr)
    result = cached_ai_result(
        args.repo,
        "codex_explain",
        codex_cache_key("explain", [pr], args.model),
        refresh=args.refresh_ai,
        compute=lambda: run_codex_explain(args.repo, pr, model=args.model),
    )
    print_json_result("Codex PR Explain", result)


def compare_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    left = find_pr(data, args.left)
    right = find_pr(data, args.right)
    result = cached_ai_result(
        args.repo,
        "codex_compare",
        codex_cache_key("compare", [left, right], args.model),
        refresh=args.refresh_ai,
        compute=lambda: run_codex_compare(args.repo, left, right, model=args.model),
    )
    print_json_result("Codex PR Compare", result)


def recommend_command(args: argparse.Namespace) -> None:
    validate_repo(args.repo)
    data = read_cache(cache_path_for_repo(args.repo))
    attach_deterministic_signals(data)
    prs = select_recommendation_candidates(data, limit=args.limit)
    if not prs:
        print("No recommendation candidates found.")
        return
    result = cached_ai_result(
        args.repo,
        "codex_recommend",
        codex_cache_key("recommend", prs, args.model),
        refresh=args.refresh_ai,
        compute=lambda: run_codex_recommend(args.repo, prs, model=args.model),
    )
    print_json_result("Codex Action Recommendations", result)


def scan_github(args: ScanArgs) -> dict[str, Any]:
    if args.api == "graphql":
        return scan_github_graphql(args)
    return scan_github_rest(args)


def scan_github_graphql(args: ScanArgs) -> dict[str, Any]:
    raw_prs = fetch_pr_list_graphql(args)
    normalized_prs: list[dict[str, Any]] = []
    author_logins = sorted({login_from_author(pr.get("author")) for pr in raw_prs if login_from_author(pr.get("author"))})
    contributor_history = {
        login: fetch_contributor_history(args.repo, login, args.history_limit)
        for login in author_logins
    }

    current_open_counts: dict[str, int] = {}
    for pr in raw_prs:
        login = login_from_author(pr.get("author"))
        if login:
            current_open_counts[login] = current_open_counts.get(login, 0) + 1

    for raw in raw_prs:
        number = raw.get("number")
        if not isinstance(number, int):
            continue
        files = fetch_pr_files_rest(args.repo, number)
        normalized = normalize_pr(raw, files)
        login = normalized["author"]["login"]
        history = contributor_history.get(login, empty_contributor_history(login))
        normalized["contributor"] = {
            **history,
            "currentOpenPrsInScan": current_open_counts.get(login, 0),
            "accountAssociation": normalized["author"].get("association")
            or history.get("accountAssociation"),
        }
        normalized_prs.append(normalized)

    data = {
        "schemaVersion": SCHEMA_VERSION,
        "tool": "triage",
        "repo": args.repo,
        "state": args.state,
        "limit": args.limit,
        "since": args.since,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "source": "gh-graphql",
        "prs": normalized_prs,
    }
    attach_deterministic_signals(data)
    return data


def scan_github_rest(args: ScanArgs) -> dict[str, Any]:
    raw_prs = fetch_pr_list_rest(args)
    contributor_counts = fetch_repo_contributor_counts(args.repo)
    current_open_counts: dict[str, int] = {}
    for pr in raw_prs:
        login = login_from_rest_user(pr.get("user"))
        if login:
            current_open_counts[login] = current_open_counts.get(login, 0) + 1

    normalized_prs: list[dict[str, Any]] = []
    for raw in raw_prs:
        number = raw.get("number")
        if not isinstance(number, int):
            continue
        files = fetch_pr_files_rest(args.repo, number)
        reviews = fetch_pr_reviews_rest(args.repo, number)
        normalized = normalize_rest_pr(raw, files, reviews)
        login = normalized["author"]["login"]
        contributor = rest_contributor_history(
            login,
            normalized["author"].get("association"),
            contributor_counts,
            current_open_counts.get(login, 0),
        )
        normalized["contributor"] = contributor
        normalized_prs.append(normalized)

    data = {
        "schemaVersion": SCHEMA_VERSION,
        "tool": "triage",
        "repo": args.repo,
        "state": args.state,
        "limit": args.limit,
        "since": args.since,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "source": "gh-rest",
        "prs": normalized_prs,
    }
    attach_deterministic_signals(data)
    return data


def fetch_pr_list_graphql(args: ScanArgs) -> list[dict[str, Any]]:
    command = [
        "gh",
        "pr",
        "list",
        "--repo",
        args.repo,
        "--state",
        args.state,
        "--limit",
        str(args.limit),
        "--json",
        ",".join(PR_LIST_FIELDS),
    ]
    if args.since:
        command.extend(["--search", f"created:>={args.since}"])
    return run_gh_json(command)


def fetch_pr_list_rest(args: ScanArgs) -> list[dict[str, Any]]:
    state = "closed" if args.state == "merged" else args.state
    per_page = min(100, args.limit)
    page = 1
    prs: list[dict[str, Any]] = []
    while len(prs) < args.limit:
        endpoint = (
            f"repos/{args.repo}/pulls"
            f"?state={state}&sort=created&direction=desc&per_page={per_page}&page={page}"
        )
        batch = run_gh_json(["gh", "api", endpoint])
        if not isinstance(batch, list) or not batch:
            break
        for pr in batch:
            if not isinstance(pr, dict):
                continue
            if args.since and not iso_date_at_or_after(pr.get("created_at"), args.since):
                continue
            if args.state == "merged" and not pr.get("merged_at"):
                continue
            prs.append(pr)
            if len(prs) >= args.limit:
                break
        if len(batch) < per_page:
            break
        page += 1
    return prs


def fetch_pr_files_rest(repo: str, number: int) -> list[dict[str, Any]]:
    command = [
        "gh",
        "api",
        f"repos/{repo}/pulls/{number}/files?per_page=100",
        "--paginate",
    ]
    raw_files = run_gh_json(command)
    return [normalize_file(file) for file in raw_files if isinstance(file, dict)]


def fetch_pr_reviews_rest(repo: str, number: int) -> list[dict[str, Any]]:
    command = [
        "gh",
        "api",
        f"repos/{repo}/pulls/{number}/reviews?per_page=100",
        "--paginate",
    ]
    raw_reviews = run_gh_json(command)
    return [normalize_rest_review(review) for review in raw_reviews if isinstance(review, dict)]


def fetch_repo_contributor_counts(repo: str, limit: int = 500) -> dict[str, int]:
    per_page = 100
    page = 1
    counts: dict[str, int] = {}
    while len(counts) < limit:
        endpoint = f"repos/{repo}/contributors?per_page={per_page}&page={page}"
        batch = run_gh_json(["gh", "api", endpoint])
        if not isinstance(batch, list) or not batch:
            break
        for contributor in batch:
            if not isinstance(contributor, dict):
                continue
            login = contributor.get("login")
            if login:
                counts[login] = int_or_zero(contributor.get("contributions"))
            if len(counts) >= limit:
                break
        if len(batch) < per_page:
            break
        page += 1
    return counts


def rest_contributor_history(
    login: str,
    account_association: Any,
    contributor_counts: dict[str, int],
    current_open_in_scan: int,
) -> dict[str, Any]:
    commit_contributions = contributor_counts.get(login, 0)
    return {
        "login": login,
        "priorMergedPrs": 0,
        "priorClosedPrs": 0,
        "priorClosedUnmergedPrs": 0,
        "currentOpenPrs": current_open_in_scan,
        "currentOpenPrsInScan": current_open_in_scan,
        "accountAssociation": account_association,
        "repoCommitContributions": commit_contributions,
        "historySource": "rest_contributors",
        "recentPrUrls": [],
    }


def fetch_contributor_history(repo: str, login: str, limit: int) -> dict[str, Any]:
    merged = gh_search_prs(repo, login, limit, merged=True)
    closed = gh_search_prs(repo, login, limit, state="closed")
    open_prs = gh_search_prs(repo, login, limit, state="open")
    closed_numbers = {item.get("number") for item in closed if isinstance(item.get("number"), int)}
    merged_numbers = {item.get("number") for item in merged if isinstance(item.get("number"), int)}
    account_association = first_nonempty(
        item.get("authorAssociation")
        for item in [*open_prs, *merged, *closed]
        if isinstance(item, dict)
    )
    return {
        "login": login,
        "priorMergedPrs": len(merged_numbers),
        "priorClosedPrs": len(closed_numbers),
        "priorClosedUnmergedPrs": len(closed_numbers - merged_numbers),
        "currentOpenPrs": len(open_prs),
        "accountAssociation": account_association,
        "recentPrUrls": unique_urls([*merged, *closed], limit=6),
    }


def gh_search_prs(
    repo: str,
    login: str,
    limit: int,
    *,
    state: str | None = None,
    merged: bool = False,
) -> list[dict[str, Any]]:
    command = [
        "gh",
        "search",
        "prs",
        "--repo",
        repo,
        "--author",
        login,
        "--limit",
        str(limit),
        "--json",
        ",".join(SEARCH_FIELDS),
    ]
    if state:
        command.extend(["--state", state])
    if merged:
        command.append("--merged")
    return run_gh_json(command)


def normalize_pr(raw: dict[str, Any], files: list[dict[str, Any]]) -> dict[str, Any]:
    labels = raw.get("labels") or []
    reviews = raw.get("reviews") or raw.get("latestReviews") or []
    checks = raw.get("statusCheckRollup") or []
    return {
        "number": raw.get("number"),
        "title": raw.get("title") or "",
        "body": raw.get("body") or "",
        "author": normalize_author(raw.get("author")),
        "createdAt": raw.get("createdAt"),
        "updatedAt": raw.get("updatedAt"),
        "url": raw.get("url"),
        "state": raw.get("state"),
        "isDraft": bool(raw.get("isDraft", False)),
        "additions": int_or_zero(raw.get("additions")),
        "deletions": int_or_zero(raw.get("deletions")),
        "changedFiles": int_or_zero(raw.get("changedFiles")) or len(files),
        "labels": [normalize_label(label) for label in labels if isinstance(label, dict)],
        "reviews": [normalize_review(review) for review in reviews if isinstance(review, dict)],
        "checks": [normalize_check(check) for check in checks if isinstance(check, dict)],
        "reviewDecision": raw.get("reviewDecision"),
        "mergeable": raw.get("mergeable"),
        "mergeStateStatus": raw.get("mergeStateStatus"),
        "files": files,
    }


def normalize_rest_pr(raw: dict[str, Any], files: list[dict[str, Any]], reviews: list[dict[str, Any]]) -> dict[str, Any]:
    labels = raw.get("labels") or []
    additions = sum(int_or_zero(file.get("additions")) for file in files)
    deletions = sum(int_or_zero(file.get("deletions")) for file in files)
    return {
        "number": raw.get("number"),
        "title": raw.get("title") or "",
        "body": raw.get("body") or "",
        "author": normalize_rest_author(raw.get("user"), raw.get("author_association")),
        "createdAt": raw.get("created_at"),
        "updatedAt": raw.get("updated_at"),
        "url": raw.get("html_url"),
        "state": str(raw.get("state") or "").upper(),
        "isDraft": bool(raw.get("draft", False)),
        "additions": additions,
        "deletions": deletions,
        "changedFiles": len(files),
        "labels": [normalize_label(label) for label in labels if isinstance(label, dict)],
        "reviews": reviews,
        "checks": [],
        "reviewDecision": infer_review_decision(reviews),
        "mergeable": raw.get("mergeable"),
        "mergeStateStatus": raw.get("mergeable_state"),
        "files": files,
    }


def normalize_author(author: Any) -> dict[str, Any]:
    if not isinstance(author, dict):
        return {"login": "unknown", "name": "", "association": None}
    return {
        "login": author.get("login") or "unknown",
        "name": author.get("name") or "",
        "association": author.get("association") or author.get("authorAssociation"),
    }


def normalize_rest_author(user: Any, association: Any) -> dict[str, Any]:
    if not isinstance(user, dict):
        return {"login": "unknown", "name": "", "association": association}
    return {
        "login": user.get("login") or "unknown",
        "name": "",
        "association": association,
    }


def normalize_label(label: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": label.get("name") or "",
        "color": label.get("color") or "",
    }


def normalize_review(review: dict[str, Any]) -> dict[str, Any]:
    return {
        "author": login_from_author(review.get("author")),
        "state": review.get("state"),
        "submittedAt": review.get("submittedAt"),
    }


def normalize_rest_review(review: dict[str, Any]) -> dict[str, Any]:
    return {
        "author": login_from_rest_user(review.get("user")),
        "state": review.get("state"),
        "submittedAt": review.get("submitted_at"),
    }


def infer_review_decision(reviews: list[dict[str, Any]]) -> str | None:
    states = {str(review.get("state") or "").upper() for review in reviews}
    if "CHANGES_REQUESTED" in states:
        return "CHANGES_REQUESTED"
    if "APPROVED" in states:
        return "APPROVED"
    if reviews:
        return "REVIEWED"
    return None


def normalize_check(check: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": check.get("name") or check.get("workflowName") or "",
        "status": check.get("status"),
        "conclusion": check.get("conclusion"),
        "startedAt": check.get("startedAt"),
        "completedAt": check.get("completedAt"),
    }


def normalize_file(file: dict[str, Any]) -> dict[str, Any]:
    return {
        "filename": file.get("filename") or "",
        "status": file.get("status") or "",
        "additions": int_or_zero(file.get("additions")),
        "deletions": int_or_zero(file.get("deletions")),
        "changes": int_or_zero(file.get("changes")),
        "patch": file.get("patch") or "",
        "rawUrl": file.get("raw_url") or file.get("rawUrl"),
        "blobUrl": file.get("blob_url") or file.get("blobUrl"),
        "previousFilename": file.get("previous_filename") or file.get("previousFilename"),
    }


def empty_contributor_history(login: str) -> dict[str, Any]:
    return {
        "login": login,
        "priorMergedPrs": 0,
        "priorClosedPrs": 0,
        "priorClosedUnmergedPrs": 0,
        "currentOpenPrs": 0,
        "accountAssociation": None,
        "recentPrUrls": [],
    }


def attach_deterministic_signals(data: dict[str, Any]) -> None:
    prs = data.get("prs") or []
    for pr in prs:
        if isinstance(pr, dict):
            pr["signals"] = compute_pr_signals(pr)
            pr["flags"] = compute_pr_flags(pr)
            pr["changelets"] = extract_changelets(pr)
            trust = compute_contributor_trust(pr)
            pr["contributorTrust"] = trust
            if isinstance(pr.get("contributor"), dict):
                pr["contributor"]["trustScore"] = trust["score"]
                pr["contributor"]["trustBucket"] = trust["bucket"]
    data["signalSummary"] = compute_signal_summary(prs)


def compute_pr_signals(pr: dict[str, Any]) -> dict[str, Any]:
    files = [file for file in pr.get("files", []) if isinstance(file, dict)]
    buckets = {bucket: 0 for bucket in ["code", "tests", "docs", "config", "lockfile", "generated", "other"]}
    touched_modules: set[str] = set()
    file_names: list[str] = []
    changed_lines: list[str] = []
    added_lines: list[str] = []
    removed_lines: list[str] = []

    for file in files:
        filename = file.get("filename") or ""
        file_names.append(filename)
        buckets[classify_file_bucket(filename)] += 1
        module = top_level_module(filename)
        if module:
            touched_modules.add(module)
        patch_lines = parse_patch_changed_lines(file.get("patch") or "")
        changed_lines.extend(patch_lines["changed"])
        added_lines.extend(patch_lines["added"])
        removed_lines.extend(patch_lines["removed"])

    total_changes = int_or_zero(pr.get("additions")) + int_or_zero(pr.get("deletions"))
    text = f"{pr.get('title', '')}\n{pr.get('body', '')}"
    checks = [check for check in pr.get("checks", []) if isinstance(check, dict)]
    reviews = [review for review in pr.get("reviews", []) if isinstance(review, dict)]
    contributor = pr.get("contributor") if isinstance(pr.get("contributor"), dict) else {}
    return {
        "fileBuckets": buckets,
        "touchedModules": sorted(touched_modules),
        "fileNames": file_names,
        "keywords": extract_keywords(text),
        "hasTests": buckets["tests"] > 0,
        "hasCode": buckets["code"] > 0,
        "docsOnly": buckets["docs"] > 0 and sum(v for k, v in buckets.items() if k != "docs") == 0,
        "readmeOnly": is_readme_only(file_names),
        "lockfileOnly": buckets["lockfile"] > 0 and sum(v for k, v in buckets.items() if k != "lockfile") == 0,
        "configOnly": buckets["config"] > 0 and sum(v for k, v in buckets.items() if k != "config") == 0,
        "dependencyFilesChanged": [name for name in file_names if is_dependency_file(name)],
        "generatedFilesChanged": buckets["generated"],
        "coreFilesChanged": [name for name in file_names if is_core_file(name)],
        "addedLines": len(added_lines),
        "removedLines": len(removed_lines),
        "totalChanges": total_changes,
        "addDeleteRatio": round(int_or_zero(pr.get("additions")) / max(1, int_or_zero(pr.get("deletions"))), 2),
        "commentOnly": bool(changed_lines) and all(is_comment_or_blank(line) for line in changed_lines),
        "formattingChurn": looks_like_formatting_churn(added_lines, removed_lines),
        "descriptionLength": len((pr.get("body") or "").strip()),
        "titleLength": len((pr.get("title") or "").strip()),
        "genericDescription": is_generic_description(pr.get("title") or "", pr.get("body") or ""),
        "ciState": classify_ci_state(checks),
        "reviewState": classify_review_state(pr, reviews),
        "authorPriorMergedPrs": int_or_zero(contributor.get("priorMergedPrs")),
        "authorCurrentOpenPrs": int_or_zero(contributor.get("currentOpenPrs")),
        "authorOpenPrsInScan": int_or_zero(contributor.get("currentOpenPrsInScan")),
        "authorAssociation": contributor.get("accountAssociation"),
        "isNewContributor": is_new_contributor(contributor),
        "largeDiff": total_changes >= 500 or int_or_zero(pr.get("changedFiles")) >= 20,
        "smallDiff": total_changes <= 30 and int_or_zero(pr.get("changedFiles")) <= 3,
    }


def compute_pr_flags(pr: dict[str, Any]) -> list[str]:
    signals = pr.get("signals") or {}
    flags: list[str] = []

    if signals.get("readmeOnly"):
        flags.append("readme_only_noise")
    if signals.get("docsOnly") and signals.get("genericDescription"):
        flags.append("docs_rewrite_noise")
    if signals.get("dependencyFilesChanged") and not signals.get("hasCode"):
        flags.append("dependency_without_usage")
    if signals.get("lockfileOnly"):
        flags.append("lockfile_only")
    if signals.get("formattingChurn"):
        flags.append("formatting_churn")
    if signals.get("coreFilesChanged") and not signals.get("hasTests"):
        flags.append("core_change_without_tests")
    if signals.get("largeDiff") and len(signals.get("touchedModules") or []) >= 4:
        flags.append("large_unrelated_refactor")
    if signals.get("hasTests") and not signals.get("hasCode") and signals.get("genericDescription"):
        flags.append("test_only_mock_inflation")
    if signals.get("genericDescription"):
        flags.append("description_too_generic")
    if signals.get("ciState") == "failing":
        flags.append("ci_failing")
    if signals.get("reviewState") == "none":
        flags.append("no_human_review")
    if signals.get("isNewContributor") and (signals.get("largeDiff") or signals.get("coreFilesChanged")):
        flags.append("new_contributor_high_risk")
    if (
        signals.get("isNewContributor")
        and signals.get("smallDiff")
        and (signals.get("docsOnly") or signals.get("genericDescription"))
    ):
        flags.append("possible_ai_flood_member")

    return flags


def extract_changelets(pr: dict[str, Any], limit: int = 8) -> list[str]:
    signals = pr.get("signals") or {}
    files = [file for file in pr.get("files", []) if isinstance(file, dict)]
    title = pr.get("title") or ""
    changelets: list[str] = []

    if signals.get("readmeOnly"):
        changelets.append("edit README only")
    elif signals.get("docsOnly"):
        changelets.append("update documentation")
    if signals.get("hasTests"):
        changelets.append("add or update tests")
    if signals.get("dependencyFilesChanged"):
        changelets.append("modify dependency metadata")
    if signals.get("configOnly") or any(classify_file_bucket(name) == "config" for name in signals.get("fileNames", [])):
        changelets.append("modify project configuration")
    if signals.get("coreFilesChanged"):
        changelets.append("touch core runtime")
    if signals.get("generatedFilesChanged"):
        changelets.append("modify generated files")
    if signals.get("commentOnly"):
        changelets.append("edit comments only")

    title_changelet = infer_title_changelet(title)
    if title_changelet:
        changelets.append(title_changelet)

    file_text = "\n".join(file.get("filename") or "" for file in files).lower()
    patch_text = "\n".join(file.get("patch") or "" for file in files).lower()
    subject_text = f"{title}\n{file_text}\n{patch_text}".lower()
    added_lines: list[str] = []
    removed_lines: list[str] = []
    for file in files:
        parsed = parse_patch_changed_lines(file.get("patch") or "")
        added_lines.extend(parsed["added"])
        removed_lines.extend(parsed["removed"])

    added_text = "\n".join(added_lines).lower()
    if re.search(r"\bif\b.{0,80}\b(not|none|null|missing|required|invalid)\b", added_text) or re.search(
        r"\b(raise|return)\b.{0,80}\b(error|none|null|false)\b", added_text
    ):
        changelets.append("add guard or validation")
    if re.search(r"\btry\b|\bexcept\b|\bcatch\b|retry|timeout|fallback", patch_text):
        changelets.append("improve error handling")
    if re.search(r"\basync\b|\bawait\b|stream|yield|generator", patch_text):
        changelets.append("change async or streaming flow")
    if re.search(r"\b(openai|anthropic|mistral|cerebras|sampling|temperature|token|models?/)\b", subject_text):
        changelets.append("update model/provider behavior")
    if re.search(r"\b(db|database|schema|migration|postgres|sqlite|session|storage|persistence)\b", subject_text):
        changelets.append("change database or persistence behavior")
    if re.search(r"\b(toolkit|tools?/|mcp|browser|playwright|slack)\b", subject_text):
        changelets.append("add or modify tool integration")
    if any(is_example_or_cookbook_file(file.get("filename") or "") for file in files):
        changelets.append("update examples or cookbook")

    for module in signals.get("touchedModules") or []:
        if module and len(changelets) < limit:
            changelets.append(f"touch {module}")

    deduped = unique_strings(changelets)
    if not deduped:
        deduped.append("modify project files")
    return deduped[:limit]


def infer_title_changelet(title: str) -> str:
    raw = title.strip().lower()
    match = re.match(r"^\[?([a-z]+)(?:\([^)]+\))?[\]:)]", raw)
    first_word = match.group(1) if match else ""
    normalized = re.sub(r"^\[?[a-z]+(?:\([^)]+\))?[\]:)]\s*", "", raw)
    if not normalized:
        return ""
    first_word = first_word or normalized.split()[0]
    if first_word in {"fix", "fixes", "bugfix"}:
        return "fix bug"
    if first_word in {"feat", "feature", "add", "adds"}:
        return "add feature"
    if first_word in {"docs", "doc", "document"}:
        return "update documentation"
    if first_word in {"refactor", "rework"}:
        return "refactor implementation"
    if first_word in {"test", "tests"}:
        return "update tests"
    if first_word in {"chore", "cleanup"}:
        return "perform maintenance cleanup"
    return ""


def is_example_or_cookbook_file(filename: str) -> bool:
    normalized = normalize_path(filename)
    return normalized.startswith("examples/") or "cookbook/" in normalized or normalized.startswith("cookbook/")


def unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = re.sub(r"\s+", " ", value.strip())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def build_duplicate_clusters(
    repo: str,
    prs: list[Any],
    *,
    threshold: float,
    model_name: str,
    refresh_embeddings: bool = False,
) -> list[dict[str, Any]]:
    real_prs = [pr for pr in prs if isinstance(pr, dict)]
    if len(real_prs) < 2:
        return []

    embeddings = get_pr_embeddings(repo, real_prs, model_name, refresh=refresh_embeddings)
    edges: dict[int, list[tuple[int, float, dict[str, float]]]] = {index: [] for index in range(len(real_prs))}
    for left in range(len(real_prs)):
        for right in range(left + 1, len(real_prs)):
            score, components = hybrid_similarity(real_prs[left], real_prs[right], embeddings[left], embeddings[right])
            if score >= threshold and pair_has_specific_overlap(real_prs[left], real_prs[right], components):
                edges[left].append((right, score, components))
                edges[right].append((left, score, components))

    clusters: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index in range(len(real_prs)):
        if index in seen or not edges[index]:
            continue
        component = collect_component(index, edges, seen)
        if len(component) < 2:
            continue
        component_prs = [real_prs[i] for i in component]
        pair_scores = [
            score
            for i in component
            for neighbor, score, _ in edges[i]
            if i < neighbor and neighbor in component
        ]
        best = max(component_prs, key=canonical_score)
        best_index = real_prs.index(best)
        clusters.append(
            {
                "id": f"cluster_{len(clusters) + 1:03}",
                "label": label_cluster(component_prs),
                "prs": [pr.get("number") for pr in component_prs],
                "size": len(component_prs),
                "averageSimilarity": round(sum(pair_scores) / len(pair_scores), 3) if pair_scores else 0,
                "bestPr": best.get("number"),
                "bestTitle": best.get("title"),
                "bestScore": canonical_score(best),
                "members": sorted(
                    [
                        {
                            "number": pr.get("number"),
                            "title": pr.get("title"),
                            "canonicalScore": canonical_score(pr),
                            "trustScore": (pr.get("contributorTrust") or {}).get("score"),
                            "flags": pr.get("flags") or [],
                            "changelets": pr.get("changelets") or [],
                            "similarityToBest": round(
                                hybrid_similarity(pr, best, embeddings[i], embeddings[best_index])[0],
                                3,
                            ),
                        }
                        for i, pr in ((i, real_prs[i]) for i in component)
                    ],
                    key=lambda member: (-member["canonicalScore"], member["number"] or 0),
                ),
            }
        )
    return sorted(clusters, key=lambda cluster: (-cluster["size"], -cluster["averageSimilarity"], cluster["id"]))


def build_ai_flood_waves(
    repo: str,
    prs: list[Any],
    *,
    since: str | None,
    window_hours: int,
    min_size: int,
    threshold: float,
    cluster_threshold: float,
    model_name: str,
    refresh_embeddings: bool = False,
) -> list[dict[str, Any]]:
    real_prs = [
        pr
        for pr in prs
        if isinstance(pr, dict) and parse_pr_datetime(pr.get("createdAt")) is not None
    ]
    if since:
        real_prs = [pr for pr in real_prs if iso_date_at_or_after(pr.get("createdAt"), since)]
    if len(real_prs) < min_size:
        return []

    clusters = build_duplicate_clusters(
        repo,
        real_prs,
        threshold=cluster_threshold,
        model_name=model_name,
        refresh_embeddings=refresh_embeddings,
    )

    candidates: dict[tuple[int, ...], tuple[str, str, list[dict[str, Any]]]] = {}

    def add_candidate(label: str, source: str, group: list[dict[str, Any]]) -> None:
        numbers = tuple(sorted(int_or_zero(pr.get("number")) for pr in group if pr.get("number") is not None))
        if len(numbers) < min_size or numbers in candidates:
            return
        candidates[numbers] = (label, source, group)

    pr_by_number = {pr.get("number"): pr for pr in real_prs}
    for cluster in clusters:
        cluster_prs = [pr_by_number.get(number) for number in cluster.get("prs") or []]
        cluster_prs = [pr for pr in cluster_prs if isinstance(pr, dict)]
        for window in time_window_groups(cluster_prs, window_hours=window_hours, min_size=min_size):
            add_candidate(str(cluster.get("label") or "semantic duplicate wave"), "semantic_cluster", window)

    anchor_groups: dict[str, list[dict[str, Any]]] = {}
    for pr in real_prs:
        for anchor in flood_anchors_for_pr(pr):
            anchor_groups.setdefault(anchor, []).append(pr)

    for anchor, group in anchor_groups.items():
        if len(group) < min_size:
            continue
        for window in time_window_groups(group, window_hours=window_hours, min_size=min_size):
            add_candidate(anchor_label(anchor), "repeated_signal", window)

    waves: list[dict[str, Any]] = []
    for label, source, group in candidates.values():
        if not flood_group_has_repeated_intent(group, source):
            continue
        wave = score_flood_wave(label, source, group)
        if wave["score"] >= threshold:
            waves.append(wave)

    return dedupe_flood_waves(sorted(waves, key=lambda wave: (-wave["score"], -len(wave["prs"]), wave["id"])))


def time_window_groups(
    prs: list[dict[str, Any]],
    *,
    window_hours: int,
    min_size: int,
) -> list[list[dict[str, Any]]]:
    dated = sorted(
        [(parse_pr_datetime(pr.get("createdAt")), pr) for pr in prs],
        key=lambda item: item[0] or datetime.max.replace(tzinfo=timezone.utc),
    )
    dated = [(date, pr) for date, pr in dated if date is not None]
    groups: list[list[dict[str, Any]]] = []
    seen: set[tuple[int, ...]] = set()
    for start_index, (start, _) in enumerate(dated):
        group = [
            pr
            for date, pr in dated[start_index:]
            if start and date and hours_between(start, date) <= window_hours
        ]
        if len(group) < min_size:
            continue
        numbers = tuple(sorted(int_or_zero(pr.get("number")) for pr in group))
        if numbers in seen:
            continue
        seen.add(numbers)
        groups.append(group)
    return groups


def flood_anchors_for_pr(pr: dict[str, Any]) -> list[str]:
    signals = pr.get("signals") or {}
    anchors: list[str] = []
    for changelet in pr.get("changelets") or []:
        if changelet.startswith("touch "):
            continue
        if changelet in {"edit README only", "update documentation"}:
            anchors.append(f"changelet:{changelet}")
        elif is_specific_flood_changelet(changelet):
            anchors.append(f"changelet:{changelet}")

    for filename in signals.get("fileNames") or []:
        normalized = normalize_path(filename)
        if signals.get("docsOnly") and normalized in {"readme.md", "history.md", "changelog.md"}:
            anchors.append(f"file:{normalized}")

    signature = title_signature(pr.get("title") or "")
    if signature:
        anchors.append(f"title:{signature}")
    return unique_strings(anchors)


def title_signature(title: str) -> str:
    words = [
        word
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", title.lower())
        if word not in STOP_WORDS and word not in {"fix", "feat", "docs", "chore", "pr"}
    ]
    if len(words) < 2:
        return ""
    return " ".join(words[:4])


def anchor_label(anchor: str) -> str:
    kind, _, value = anchor.partition(":")
    if kind == "file":
        return f"Repeated edits to {value}"
    if kind == "title":
        return f"Repeated title intent: {value}"
    return value


def score_flood_wave(label: str, source: str, prs: list[dict[str, Any]]) -> dict[str, Any]:
    dates = [parse_pr_datetime(pr.get("createdAt")) for pr in prs]
    dates = [date for date in dates if date is not None]
    duration = hours_between(min(dates), max(dates)) if dates else 0.0
    count = len(prs)
    first_time = sum(1 for pr in prs if (pr.get("signals") or {}).get("isNewContributor"))
    low_context = sum(1 for pr in prs if is_low_context_pr(pr))
    docs_only = sum(1 for pr in prs if (pr.get("signals") or {}).get("docsOnly"))
    small_diff = sum(1 for pr in prs if (pr.get("signals") or {}).get("smallDiff"))
    no_review = sum(1 for pr in prs if (pr.get("signals") or {}).get("reviewState") == "none")
    low_trust = sum(1 for pr in prs if int_or_zero((pr.get("contributorTrust") or {}).get("score")) < 55)
    repeated_files = top_repeated_count(
        filename
        for pr in prs
        for filename in (pr.get("signals") or {}).get("fileNames") or []
    )
    repeated_changelets = top_repeated_count(
        changelet
        for pr in prs
        for changelet in pr.get("changelets") or []
        if is_specific_flood_changelet(changelet) or changelet in {"edit README only", "update documentation"}
    )
    repeated_titles = top_repeated_count(title_signature(pr.get("title") or "") for pr in prs)

    score = 0.0
    score += min(0.25, 0.05 * count)
    if duration <= 36:
        score += 0.18
    elif duration <= 72:
        score += 0.12
    elif duration <= 168:
        score += 0.05
    score += 0.18 * ratio(low_context, count)
    score += 0.15 * ratio(first_time, count)
    score += 0.12 * ratio(max(repeated_files, repeated_changelets, repeated_titles), count)
    score += 0.10 * ratio(docs_only, count)
    score += 0.08 * ratio(small_diff, count)
    score += 0.06 * ratio(no_review, count)
    score += 0.08 * ratio(low_trust, count)
    if source == "semantic_cluster":
        score += 0.10
    score = round(min(score, 1.0), 3)

    reasons = flood_reasons(
        count=count,
        duration=duration,
        first_time=first_time,
        low_context=low_context,
        docs_only=docs_only,
        small_diff=small_diff,
        no_review=no_review,
        low_trust=low_trust,
        repeated_files=repeated_files,
        repeated_changelets=repeated_changelets,
        repeated_titles=repeated_titles,
        source=source,
    )
    best = max(prs, key=canonical_score)
    return {
        "id": flood_id(label, prs),
        "label": label,
        "prs": [pr.get("number") for pr in sorted(prs, key=lambda pr: parse_pr_datetime(pr.get("createdAt")) or datetime.max.replace(tzinfo=timezone.utc))],
        "score": score,
        "window": format_hours(duration),
        "source": source,
        "bestPr": best.get("number"),
        "bestTitle": best.get("title"),
        "reasons": reasons,
        "recommendedAction": flood_recommendation(score, source),
        "metrics": {
            "firstTimeContributors": first_time,
            "lowContextPrs": low_context,
            "docsOnlyPrs": docs_only,
            "smallDiffPrs": small_diff,
            "noReviewPrs": no_review,
            "lowTrustPrs": low_trust,
        },
    }


def dedupe_flood_waves(waves: list[dict[str, Any]], max_overlap: float = 0.55) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for wave in waves:
        if all(flood_wave_overlap(wave, existing) <= max_overlap for existing in selected):
            selected.append(wave)
    return selected


def flood_wave_overlap(left: dict[str, Any], right: dict[str, Any]) -> float:
    left_numbers = {number for number in left.get("prs") or [] if number is not None}
    right_numbers = {number for number in right.get("prs") or [] if number is not None}
    if not left_numbers or not right_numbers:
        return 0.0
    return len(left_numbers & right_numbers) / min(len(left_numbers), len(right_numbers))


def flood_reasons(**values: Any) -> list[str]:
    count = int_or_zero(values.get("count"))
    reasons = [f"{count} PRs over {format_hours(float(values.get('duration') or 0))}"]
    if values.get("source") == "semantic_cluster":
        reasons.append("semantic duplicate cluster overlap")
    for key, label in [
        ("first_time", "mostly new or unknown contributors"),
        ("low_context", "low-context or low-value PR signals"),
        ("docs_only", "docs-only edits"),
        ("small_diff", "small shallow diffs"),
        ("no_review", "no human review"),
        ("low_trust", "low contributor trust scores"),
    ]:
        amount = int_or_zero(values.get(key))
        if amount >= max(2, count // 2):
            reasons.append(f"{amount} {label}")
    if int_or_zero(values.get("repeated_files")) >= max(2, count // 2):
        reasons.append("repeated touched files")
    if int_or_zero(values.get("repeated_changelets")) >= max(2, count // 2):
        reasons.append("repeated semantic changelets")
    if int_or_zero(values.get("repeated_titles")) >= max(2, count // 2):
        reasons.append("near-duplicate title intent")
    return reasons[:8]


def flood_group_has_repeated_intent(group: list[dict[str, Any]], source: str) -> bool:
    if source == "semantic_cluster":
        return True
    count = len(group)
    majority = max(2, count // 2)
    repeated_titles = top_repeated_count(title_signature(pr.get("title") or "") for pr in group)
    repeated_changelets = top_repeated_count(
        changelet
        for pr in group
        for changelet in pr.get("changelets") or []
        if is_specific_flood_changelet(changelet) or changelet in {"edit README only", "update documentation"}
    )
    if repeated_titles >= majority or repeated_changelets >= majority:
        return True
    docs_only = [pr for pr in group if (pr.get("signals") or {}).get("docsOnly")]
    if len(docs_only) >= majority:
        doc_files = [
            normalize_path(filename)
            for pr in docs_only
            for filename in (pr.get("signals") or {}).get("fileNames") or []
            if normalize_path(filename) in {"readme.md", "history.md", "changelog.md"}
        ]
        return top_repeated_count(doc_files) >= majority
    return False


def is_low_context_pr(pr: dict[str, Any]) -> bool:
    flags = set(pr.get("flags") or [])
    signals = pr.get("signals") or {}
    return bool(
        flags & LOW_VALUE_FLAGS
        or "possible_ai_flood_member" in flags
        or signals.get("genericDescription")
        or signals.get("descriptionLength", 0) < 80
    )


def top_repeated_count(values: Any) -> int:
    counts: dict[str, int] = {}
    for value in values:
        if not value:
            continue
        normalized = str(value).lower()
        counts[normalized] = counts.get(normalized, 0) + 1
    return max(counts.values(), default=0)


def ratio(part: int, whole: int) -> float:
    return part / whole if whole else 0.0


def flood_id(label: str, prs: list[dict[str, Any]]) -> str:
    numbers = "_".join(str(pr.get("number")) for pr in sorted(prs, key=lambda pr: int_or_zero(pr.get("number"))))
    base = safe_segment(re.sub(r"\s+", "_", label.lower()))[:36].strip("_") or "wave"
    digest = sha256_text(numbers)[:8]
    return f"flood_{base}_{digest}"


def flood_recommendation(score: float, source: str) -> str:
    if source == "semantic_cluster" and score >= 0.7:
        return "Review the best canonical PR first; bulk-label the rest duplicate or needs-info if intent matches."
    if score >= 0.7:
        return "Sample the wave, identify a canonical PR, then apply a consistent maintainer action."
    return "Review as a possible burst; ask for clearer issue/context before taking bulk action."


def parse_pr_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def hours_between(start: datetime, end: datetime) -> float:
    return max(0.0, (end - start).total_seconds() / 3600)


def format_hours(hours: float) -> str:
    if hours < 1:
        return "<1 hour"
    if hours < 48:
        return f"{round(hours)} hours"
    return f"{round(hours / 24, 1)} days"


def get_pr_embeddings(
    repo: str,
    prs: list[dict[str, Any]],
    model_name: str,
    *,
    refresh: bool,
) -> list[list[float]]:
    cache_path = embedding_cache_path(repo, model_name)
    cache = {"model": model_name, "items": {}} if refresh else read_embedding_cache(cache_path, model_name)
    items = cache.setdefault("items", {})
    texts = [embedding_text_for_pr(pr) for pr in prs]
    keys = [embedding_cache_key(pr, text) for pr, text in zip(prs, texts)]
    missing_indices = [index for index, key in enumerate(keys) if key not in items]

    if missing_indices:
        vectors = encode_texts_with_model([texts[index] for index in missing_indices], model_name)
        for index, vector in zip(missing_indices, vectors):
            items[keys[index]] = {
                "pr": prs[index].get("number"),
                "textHash": sha256_text(texts[index]),
                "embedding": [round(float(value), 8) for value in vector],
            }
        write_embedding_cache(cache_path, cache)

    return [items[key]["embedding"] for key in keys]


def embedding_text_for_pr(pr: dict[str, Any]) -> str:
    pieces = [
        f"Title: {pr.get('title') or ''}",
        f"Body: {truncate_text(pr.get('body') or '', 2500)}",
        "Changelets: " + "; ".join(pr.get("changelets") or []),
        "Files: " + "; ".join((pr.get("signals") or {}).get("fileNames") or []),
        "Keywords: " + "; ".join((pr.get("signals") or {}).get("keywords") or []),
    ]
    return "\n".join(piece for piece in pieces if piece.strip())


def encode_texts_with_model(texts: list[str], model_name: str) -> list[list[float]]:
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise TriageError(
            "sentence-transformers is required for clustering; run `python -m pip install -r requirements.txt`"
        ) from error

    model = SentenceTransformer(model_name)
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return [list(vector) for vector in embeddings]


def embedding_cache_path(repo: str, model_name: str) -> Path:
    repo_dir = cache_path_for_repo(repo).parent
    return repo_dir / f"embeddings_{safe_segment(model_name.replace('/', '_'))}.json"


def read_embedding_cache(path: Path, model_name: str) -> dict[str, Any]:
    if not path.exists():
        return {"model": model_name, "items": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"model": model_name, "items": {}}
    if data.get("model") != model_name or not isinstance(data.get("items"), dict):
        return {"model": model_name, "items": {}}
    return data


def write_embedding_cache(path: Path, cache: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def embedding_cache_key(pr: dict[str, Any], text: str) -> str:
    return f"{pr.get('number')}:{sha256_text(text)}"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def truncate_text(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "\n[truncated]"


def hybrid_similarity(
    left: dict[str, Any],
    right: dict[str, Any],
    left_embedding: list[float],
    right_embedding: list[float],
) -> tuple[float, dict[str, float]]:
    embedding = cosine_similarity(left_embedding, right_embedding)
    changelet = jaccard(left.get("changelets") or [], right.get("changelets") or [])
    files = jaccard((left.get("signals") or {}).get("fileNames") or [], (right.get("signals") or {}).get("fileNames") or [])
    keywords = jaccard((left.get("signals") or {}).get("keywords") or [], (right.get("signals") or {}).get("keywords") or [])
    issues = jaccard(extract_issue_refs(left), extract_issue_refs(right))
    score = 0.65 * embedding + 0.15 * changelet + 0.12 * files + 0.05 * keywords + 0.03 * issues
    components = {
        "embedding": round(embedding, 3),
        "changelet": round(changelet, 3),
        "files": round(files, 3),
        "keywords": round(keywords, 3),
        "issues": round(issues, 3),
    }
    return round(score, 3), components


GENERIC_CLUSTER_CHANGELETS = {
    "add or update tests",
    "touch core runtime",
    "fix bug",
    "add feature",
    "modify project configuration",
    "modify dependency metadata",
    "improve error handling",
    "change async or streaming flow",
    "change database or persistence behavior",
    "update examples or cookbook",
    "touch examples",
    "touch lib/application.js",
    "touch lib/response.js",
}

GENERIC_FLOOD_CHANGELETS = {
    *GENERIC_CLUSTER_CHANGELETS,
    "add guard or validation",
    "add or modify tool integration",
    "update model/provider behavior",
    "modify dependency metadata",
    "modify project configuration",
}

BROAD_CLUSTER_FILES = {
    "history.md",
    "package.json",
    "lib/application.js",
    "lib/response.js",
}


def pair_has_specific_overlap(left: dict[str, Any], right: dict[str, Any], components: dict[str, float]) -> bool:
    strong_text = components.get("embedding", 0) >= 0.72
    title_match = title_signature(left.get("title") or "") == title_signature(right.get("title") or "") != ""
    if components.get("issues", 0) > 0 and (strong_text or title_match):
        return True
    if shared_specific_changelets(left, right) and (strong_text or title_match or components.get("keywords", 0) >= 0.25):
        return True
    if shared_specific_files(left, right) and strong_text and (
        components.get("changelet", 0) >= 0.35 or components.get("keywords", 0) >= 0.25 or title_match
    ):
        return True
    return False


def shared_specific_changelets(left: dict[str, Any], right: dict[str, Any]) -> set[str]:
    left_changelets = {changelet for changelet in left.get("changelets") or [] if changelet not in GENERIC_CLUSTER_CHANGELETS}
    right_changelets = {changelet for changelet in right.get("changelets") or [] if changelet not in GENERIC_CLUSTER_CHANGELETS}
    return left_changelets & right_changelets


def shared_specific_files(left: dict[str, Any], right: dict[str, Any]) -> set[str]:
    left_files = {file for file in (left.get("signals") or {}).get("fileNames") or [] if is_specific_cluster_file(file)}
    right_files = {file for file in (right.get("signals") or {}).get("fileNames") or [] if is_specific_cluster_file(file)}
    return left_files & right_files


def is_specific_cluster_file(filename: str) -> bool:
    normalized = normalize_path(filename)
    if not normalized:
        return False
    name = Path(normalized).name
    if name in DEPENDENCY_FILES or name in LOCKFILE_NAMES:
        return False
    if normalized in {"package.json", "readme.md", "history.md", "changelog.md"}:
        return False
    if normalized in BROAD_CLUSTER_FILES:
        return False
    if normalized.startswith(".github/"):
        return False
    if normalized.startswith("examples/"):
        return False
    return True


def is_specific_flood_changelet(changelet: str) -> bool:
    normalized = re.sub(r"\s+", " ", str(changelet).strip().lower())
    if not normalized or normalized.startswith("touch "):
        return False
    if normalized in GENERIC_FLOOD_CHANGELETS:
        return False
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", normalized)
    return len(words) >= 3


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (left_norm * right_norm)))


def jaccard(left: list[Any], right: list[Any]) -> float:
    left_set = {str(value).lower() for value in left if value}
    right_set = {str(value).lower() for value in right if value}
    if not left_set and not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def extract_issue_refs(pr: dict[str, Any]) -> list[str]:
    text = f"{pr.get('title') or ''}\n{pr.get('body') or ''}"
    return re.findall(r"#\d+", text)


def collect_component(
    start: int,
    edges: dict[int, list[tuple[int, float, dict[str, float]]]],
    seen: set[int],
) -> list[int]:
    stack = [start]
    component: list[int] = []
    while stack:
        index = stack.pop()
        if index in seen:
            continue
        seen.add(index)
        component.append(index)
        stack.extend(neighbor for neighbor, _, _ in edges[index] if neighbor not in seen)
    return sorted(component)


def label_cluster(prs: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for pr in prs:
        for changelet in pr.get("changelets") or []:
            if changelet in GENERIC_CLUSTER_CHANGELETS:
                continue
            counts[changelet] = counts.get(changelet, 0) + 1
    if counts:
        return max(counts.items(), key=lambda item: (item[1], item[0]))[0]
    title_keywords: dict[str, int] = {}
    for pr in prs:
        for keyword in extract_keywords(pr.get("title") or "", limit=5):
            title_keywords[keyword] = title_keywords.get(keyword, 0) + 1
    if title_keywords:
        return " / ".join(keyword for keyword, _ in sorted(title_keywords.items(), key=lambda item: (-item[1], item[0]))[:3])
    return "similar PRs"


def canonical_score(pr: dict[str, Any]) -> int:
    signals = pr.get("signals") or {}
    flags = pr.get("flags") or []
    trust = pr.get("contributorTrust") or {}
    score = int_or_zero(trust.get("score"))
    if signals.get("hasTests"):
        score += 12
    if signals.get("ciState") == "passing":
        score += 12
    if signals.get("smallDiff"):
        score += 8
    if signals.get("reviewState") in {"approved", "reviewed"}:
        score += 8
    score -= 5 * len([flag for flag in flags if flag in LOW_VALUE_FLAGS])
    if "core_change_without_tests" in flags:
        score -= 10
    if "large_unrelated_refactor" in flags:
        score -= 10
    return clamp_score(score)


def compute_signal_summary(prs: list[Any]) -> dict[str, Any]:
    flag_counts: dict[str, int] = {}
    bucket_counts: dict[str, int] = {}
    changelet_counts: dict[str, int] = {}
    risky_new_contributors = 0
    low_value = 0
    trust_scores: list[int] = []
    low_trust = 0

    for pr in prs:
        if not isinstance(pr, dict):
            continue
        flags = pr.get("flags") or []
        for flag in flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1
        buckets = ((pr.get("signals") or {}).get("fileBuckets") or {})
        for bucket, count in buckets.items():
            bucket_counts[bucket] = bucket_counts.get(bucket, 0) + int_or_zero(count)
        for changelet in pr.get("changelets") or []:
            changelet_counts[changelet] = changelet_counts.get(changelet, 0) + 1
        if "new_contributor_high_risk" in flags:
            risky_new_contributors += 1
        if any(flag in flags for flag in LOW_VALUE_FLAGS):
            low_value += 1
        trust = pr.get("contributorTrust") or {}
        if isinstance(trust.get("score"), int):
            trust_scores.append(trust["score"])
            if trust["score"] < 40:
                low_trust += 1

    return {
        "flagCounts": dict(sorted(flag_counts.items())),
        "fileBucketCounts": dict(sorted(bucket_counts.items())),
        "changeletCounts": dict(sorted(changelet_counts.items(), key=lambda item: (-item[1], item[0]))),
        "lowValuePrs": low_value,
        "riskyNewContributorPrs": risky_new_contributors,
        "lowTrustPrs": low_trust,
        "averageContributorTrust": round(sum(trust_scores) / len(trust_scores), 1) if trust_scores else None,
    }


LOW_VALUE_FLAGS = {
    "readme_only_noise",
    "docs_rewrite_noise",
    "dependency_without_usage",
    "lockfile_only",
    "formatting_churn",
    "description_too_generic",
}


def classify_file_bucket(filename: str) -> str:
    normalized = normalize_path(filename)
    name = Path(normalized).name.lower()
    stem = Path(name).stem.lower()
    suffix = Path(name).suffix.lower()

    if any(normalized.startswith(marker) or f"/{marker}" in normalized for marker in GENERATED_MARKERS):
        return "generated"
    if name in LOCKFILE_NAMES:
        return "lockfile"
    if is_test_file(normalized):
        return "tests"
    if stem in DOC_NAMES or suffix in {".md", ".mdx", ".rst", ".txt", ".adoc"}:
        return "docs"
    if name in CONFIG_NAMES or normalized.startswith(".github/") or suffix in {".yml", ".yaml", ".toml", ".ini", ".json"}:
        return "config"
    if suffix in {".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".go", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".rb"}:
        return "code"
    return "other"


def normalize_path(filename: str) -> str:
    return filename.replace("\\", "/").strip().lower()


def top_level_module(filename: str) -> str:
    normalized = normalize_path(filename)
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return ""
    if parts[0] in {".github", "docs", "test", "tests", "src", "lib", "packages", "crates"} and len(parts) > 1:
        return "/".join(parts[:2])
    return parts[0]


def is_test_file(filename: str) -> bool:
    parts = normalize_path(filename).split("/")
    name = parts[-1] if parts else ""
    return any(part in TEST_MARKERS for part in parts) or bool(re.search(r"(\.test|\.spec|_test)\.", name))


def is_readme_only(file_names: list[str]) -> bool:
    return bool(file_names) and all(Path(normalize_path(name)).stem == "readme" for name in file_names)


def is_dependency_file(filename: str) -> bool:
    name = Path(normalize_path(filename)).name
    return name in DEPENDENCY_FILES or name in LOCKFILE_NAMES


def is_core_file(filename: str) -> bool:
    parts = normalize_path(filename).split("/")
    return any(part in CORE_MARKERS for part in parts) and not is_test_file(filename)


def parse_patch_changed_lines(patch: str) -> dict[str, list[str]]:
    added: list[str] = []
    removed: list[str] = []
    for line in patch.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            added.append(line[1:])
        elif line.startswith("-"):
            removed.append(line[1:])
    return {"added": added, "removed": removed, "changed": [*added, *removed]}


def is_comment_or_blank(line: str) -> bool:
    stripped = line.strip()
    return not stripped or stripped.startswith(("#", "//", "/*", "*", "--")) or stripped.endswith("*/")


def looks_like_formatting_churn(added_lines: list[str], removed_lines: list[str]) -> bool:
    if not added_lines or not removed_lines:
        return False
    added_tokens = sorted(normalize_code_line(line) for line in added_lines if normalize_code_line(line))
    removed_tokens = sorted(normalize_code_line(line) for line in removed_lines if normalize_code_line(line))
    return bool(added_tokens) and added_tokens == removed_tokens


def normalize_code_line(line: str) -> str:
    return re.sub(r"\s+", "", line.strip())


def extract_keywords(text: str, limit: int = 12) -> list[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower())
    counts: dict[str, int] = {}
    for word in words:
        if word in STOP_WORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def is_generic_description(title: str, body: str) -> bool:
    combined = f"{title}\n{body}".strip().lower()
    body_length = len(body.strip())
    generic_phrases = [
        "fix typo",
        "minor changes",
        "update readme",
        "improve documentation",
        "small fix",
        "cleanup",
        "refactor code",
        "fix bug",
    ]
    return body_length < 40 or any(phrase in combined for phrase in generic_phrases)


def classify_ci_state(checks: list[dict[str, Any]]) -> str:
    if not checks:
        return "none"
    conclusions = {str(check.get("conclusion") or "").lower() for check in checks}
    statuses = {str(check.get("status") or "").lower() for check in checks}
    if {"failure", "timed_out", "cancelled", "action_required"} & conclusions:
        return "failing"
    if "pending" in statuses or "in_progress" in statuses or not all(conclusions):
        return "pending"
    if conclusions <= {"success", "skipped", "neutral"}:
        return "passing"
    return "unknown"


def classify_review_state(pr: dict[str, Any], reviews: list[dict[str, Any]]) -> str:
    decision = str(pr.get("reviewDecision") or "").lower()
    if decision:
        return decision
    states = {str(review.get("state") or "").lower() for review in reviews}
    if "changes_requested" in states:
        return "changes_requested"
    if "approved" in states:
        return "approved"
    if reviews:
        return "reviewed"
    return "none"


def is_new_contributor(contributor: dict[str, Any]) -> bool:
    association = str(contributor.get("accountAssociation") or "").upper()
    if association in {"MEMBER", "OWNER", "COLLABORATOR"}:
        return False
    return int_or_zero(contributor.get("priorMergedPrs")) == 0


def compute_contributor_trust(pr: dict[str, Any]) -> dict[str, Any]:
    contributor = pr.get("contributor") if isinstance(pr.get("contributor"), dict) else {}
    signals = pr.get("signals") or {}
    flags = pr.get("flags") or []
    score = 50
    positives: list[str] = []
    risks: list[str] = []

    association = str(contributor.get("accountAssociation") or "").upper()
    prior_merged = int_or_zero(contributor.get("priorMergedPrs"))
    prior_closed_unmerged = int_or_zero(contributor.get("priorClosedUnmergedPrs"))
    current_open = int_or_zero(contributor.get("currentOpenPrs"))
    open_in_scan = int_or_zero(contributor.get("currentOpenPrsInScan"))
    repo_commit_contributions = int_or_zero(contributor.get("repoCommitContributions"))
    history_source = contributor.get("historySource")

    if association in {"OWNER", "MEMBER", "COLLABORATOR"}:
        score += 25
        positives.append(f"{association.lower()} of the repository")
    elif association in {"CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR"}:
        score += 8
        positives.append(f"GitHub association: {association.lower()}")
    elif association == "FIRST_TIMER":
        score -= 8
        risks.append("first-time GitHub contributor to this repo")

    if prior_merged >= 10:
        score += 20
        positives.append(f"{prior_merged} prior merged PRs")
    elif prior_merged >= 3:
        score += 14
        positives.append(f"{prior_merged} prior merged PRs")
    elif prior_merged >= 1:
        score += 8
        positives.append(f"{prior_merged} prior merged PR")
    else:
        if repo_commit_contributions >= 100:
            score += 12
            positives.append(f"{repo_commit_contributions} repo commit contributions")
        elif repo_commit_contributions >= 10:
            score += 6
            positives.append(f"{repo_commit_contributions} repo commit contributions")
        elif history_source == "rest_contributors":
            risks.append("prior merged PR history unknown in REST scan")
        else:
            score -= 10
            risks.append("no prior merged PRs found in repo")

    if prior_closed_unmerged >= 5:
        score -= 12
        risks.append(f"{prior_closed_unmerged} prior closed-unmerged PRs")
    elif prior_closed_unmerged >= 2:
        score -= 6
        risks.append(f"{prior_closed_unmerged} prior closed-unmerged PRs")

    if signals.get("ciState") == "passing":
        score += 8
        positives.append("current CI passing")
    elif signals.get("ciState") == "failing":
        score -= 14
        risks.append("current CI failing")

    if signals.get("reviewState") in {"approved", "reviewed"}:
        score += 8
        positives.append(f"current review state: {signals['reviewState']}")
    elif signals.get("reviewState") == "changes_requested":
        score -= 8
        risks.append("changes requested on current PR")

    low_value_flags = sorted(flag for flag in flags if flag in LOW_VALUE_FLAGS)
    if low_value_flags:
        score -= min(18, 6 * len(low_value_flags))
        risks.append(f"low-value flags: {', '.join(low_value_flags)}")

    if "new_contributor_high_risk" in flags:
        score -= 12
        risks.append("new contributor changing core or large surface area")
    if "possible_ai_flood_member" in flags:
        score -= 8
        risks.append("matches small low-context PR flood pattern")
    if "core_change_without_tests" in flags:
        score -= 8
        risks.append("core change without tests")

    if current_open >= 8:
        score -= 12
        risks.append(f"{current_open} currently open PRs in repo")
    elif current_open >= 4:
        score -= 6
        risks.append(f"{current_open} currently open PRs in repo")
    if open_in_scan >= 4:
        score -= 6
        risks.append(f"{open_in_scan} PRs by this contributor in current scan")

    score = clamp_score(score)
    return {
        "score": score,
        "bucket": trust_bucket(score),
        "positives": positives[:5],
        "risks": risks[:5],
        "explanation": build_trust_explanation(score, positives, risks),
    }


def trust_bucket(score: int) -> str:
    if score >= 75:
        return "high"
    if score >= 55:
        return "medium"
    if score >= 40:
        return "low"
    return "very_low"


def build_trust_explanation(score: int, positives: list[str], risks: list[str]) -> str:
    if positives and risks:
        return f"{score}/100: {positives[0]}; watch {risks[0]}."
    if positives:
        return f"{score}/100: {positives[0]}."
    if risks:
        return f"{score}/100: {risks[0]}."
    return f"{score}/100: limited contributor signal available."


def run_patch_text_alignment(pr: dict[str, Any], *, model: str) -> dict[str, Any]:
    prompt = {
        "task": "Judge whether the pull request text matches the actual patch.",
        "pull_request": pr_context(pr),
        "output_rules": [
            "Be strict about title/body claims that are not supported by changed files or patch summary.",
            "Do not judge author intent or morality.",
            "Return JSON only matching the schema.",
        ],
    }
    return run_responses_json(
        model=model,
        schema=PATCH_TEXT_ALIGNMENT_SCHEMA,
        input_text=json.dumps(prompt, indent=2, sort_keys=True),
    )


def run_codex_explain(repo: str, pr: dict[str, Any], *, model: str) -> dict[str, Any]:
    prompt = {
        "task": "Explain this pull request for an open-source maintainer and recommend the next action.",
        "repo": repo,
        "pull_request": pr_context(pr),
        "fingerprinting_guidance": FINGERPRINTING_GUIDANCE,
        "output_rules": [
            "Use repository-maintainer triage framing.",
            "Focus on patch-text alignment, behavior delta, tests, risk, and maintainer action.",
            "Return JSON only matching the schema.",
        ],
    }
    return run_codex_json(
        prompt=json.dumps(prompt, indent=2, sort_keys=True),
        schema=CODEX_EXPLAIN_SCHEMA,
        model=model,
    )


def run_codex_compare(repo: str, left: dict[str, Any], right: dict[str, Any], *, model: str) -> dict[str, Any]:
    prompt = {
        "task": "Compare two pull requests and identify the better maintainer review target.",
        "repo": repo,
        "pull_requests": [pr_context(left), pr_context(right)],
        "fingerprinting_guidance": FINGERPRINTING_GUIDANCE,
        "output_rules": [
            "Prefer the PR that captures the useful shared transformation with less unrelated change mass.",
            "If they are not duplicates, say so clearly.",
            "Return JSON only matching the schema.",
        ],
    }
    return run_codex_json(
        prompt=json.dumps(prompt, indent=2, sort_keys=True),
        schema=CODEX_COMPARE_SCHEMA,
        model=model,
    )


def run_codex_recommend(repo: str, prs: list[dict[str, Any]], *, model: str) -> dict[str, Any]:
    prompt = {
        "task": "Recommend maintainer actions for these risky or attention-worthy pull requests.",
        "repo": repo,
        "pull_requests": [pr_context(pr) for pr in prs],
        "fingerprinting_guidance": FINGERPRINTING_GUIDANCE,
        "allowed_actions": [
            "review_first",
            "needs_info",
            "duplicate",
            "probably_junk",
            "risky_but_maybe_valuable",
            "safe_to_ignore_for_now",
        ],
        "output_rules": [
            "Use contributor trust only as prioritization context, never as an automatic rejection reason.",
            "Be conservative: recommend human review for risky valuable code changes.",
            "Return JSON only matching the schema.",
        ],
    }
    return run_codex_json(
        prompt=json.dumps(prompt, indent=2, sort_keys=True),
        schema=CODEX_RECOMMEND_SCHEMA,
        model=model,
    )


def run_responses_json(*, model: str, schema: dict[str, Any], input_text: str) -> dict[str, Any]:
    env = load_dotenv()
    api_key = env.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise TriageError("OPENAI_API_KEY is required in .env or environment for Responses API analysis")
    body = {
        "model": model,
        "reasoning": {"effort": "low"},
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": input_text}],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema["name"],
                "schema": schema["schema"],
                "strict": True,
            }
        },
    }
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise TriageError(f"Responses API failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise TriageError(f"Responses API request failed: {error.reason}") from error
    text = extract_response_text(raw)
    return parse_json_object(text, "Responses API")


def run_codex_json(*, prompt: str, schema: dict[str, Any], model: str) -> dict[str, Any]:
    errors: list[str] = []
    try:
        return run_codex_sdk_json(prompt=prompt, schema=schema, model=model)
    except Exception as error:  # noqa: BLE001 - surface SDK failure and try CLI.
        errors.append(f"SDK: {error}")
    try:
        return run_codex_cli_json(prompt=prompt, schema=schema, model=model)
    except Exception as error:  # noqa: BLE001 - both Codex paths should be reported.
        errors.append(f"CLI: {error}")
    raise TriageError("Codex analysis failed; " + " | ".join(errors))


def run_codex_sdk_json(*, prompt: str, schema: dict[str, Any], model: str) -> dict[str, Any]:
    env = load_dotenv()
    if env.get("OPENAI_API_KEY"):
        os.environ.setdefault("OPENAI_API_KEY", env["OPENAI_API_KEY"])
        os.environ.setdefault("CODEX_API_KEY", env["OPENAI_API_KEY"])
    codex_env = os.environ.copy()
    codex_env["CODEX_HOME"] = str(local_codex_home())
    if env.get("OPENAI_API_KEY"):
        codex_env.setdefault("OPENAI_API_KEY", env["OPENAI_API_KEY"])
        codex_env.setdefault("CODEX_API_KEY", env["OPENAI_API_KEY"])
    try:
        from openai_codex import Codex, CodexConfig, Sandbox  # type: ignore
    except ImportError as error:
        raise TriageError("openai-codex SDK is not installed") from error
    with Codex(CodexConfig(cwd=str(Path.cwd()), env=codex_env)) as codex:
        if env.get("OPENAI_API_KEY"):
            codex.login_api_key(env["OPENAI_API_KEY"])
        thread = codex.thread_start(model=model, sandbox=Sandbox.read_only)
        result = thread.run(codex_prompt_with_schema(prompt, schema))
    final = getattr(result, "final_response", None) or str(result)
    parsed = parse_json_object(final, "Codex SDK")
    parsed["_provider"] = "codex_sdk"
    return parsed


def run_codex_cli_json(*, prompt: str, schema: dict[str, Any], model: str) -> dict[str, Any]:
    if shutil.which("codex") is None:
        raise TriageError("codex CLI is not on PATH")
    env = os.environ.copy()
    dotenv = load_dotenv()
    env["CODEX_HOME"] = str(local_codex_home())
    if dotenv.get("OPENAI_API_KEY"):
        env.setdefault("OPENAI_API_KEY", dotenv["OPENAI_API_KEY"])
        env.setdefault("CODEX_API_KEY", dotenv["OPENAI_API_KEY"])
    with tempfile.TemporaryDirectory() as directory:
        schema_path = Path(directory) / "schema.json"
        output_path = Path(directory) / "codex-output.json"
        schema_path.write_text(json.dumps(schema["schema"], indent=2), encoding="utf-8")
        command = [
            "codex",
            "exec",
            "--sandbox",
            "read-only",
            "--model",
            model,
            "--output-schema",
            str(schema_path),
            "-o",
            str(output_path),
            codex_prompt_with_schema(prompt, schema),
        ]
        result = subprocess.run(command, text=True, capture_output=True, encoding="utf-8", errors="replace", env=env)
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or "unknown codex CLI error"
            raise TriageError(message)
        text = output_path.read_text(encoding="utf-8") if output_path.exists() else result.stdout
    parsed = parse_json_object(text, "Codex CLI")
    parsed["_provider"] = "codex_cli"
    return parsed


def codex_prompt_with_schema(prompt: str, schema: dict[str, Any]) -> str:
    return (
        "You are Codex acting as a maintainer triage agent. "
        "Return only valid JSON matching this JSON Schema.\n\n"
        f"JSON Schema:\n{json.dumps(schema['schema'], indent=2, sort_keys=True)}\n\n"
        f"Input:\n{prompt}"
    )


def local_codex_home() -> Path:
    path = CACHE_ROOT / "codex-home"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def extract_response_text(raw: dict[str, Any]) -> str:
    if isinstance(raw.get("output_text"), str):
        return raw["output_text"]
    chunks: list[str] = []
    for item in raw.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and isinstance(content.get("text"), str):
                chunks.append(content["text"])
    if chunks:
        return "\n".join(chunks)
    raise TriageError("Responses API returned no text output")


def parse_json_object(text: str, source: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise TriageError(f"{source} returned invalid JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise TriageError(f"{source} returned JSON that is not an object")
    return parsed


def cached_ai_result(
    repo: str,
    kind: str,
    key: str,
    *,
    refresh: bool,
    compute: Any,
) -> dict[str, Any]:
    path = ai_cache_path(repo, kind, key)
    if path.exists() and not refresh:
        return read_cache(path)
    result = compute()
    result.setdefault("_cachedAt", datetime.now(timezone.utc).isoformat())
    write_cache(path, result)
    return result


def ai_cache_path(repo: str, kind: str, key: str) -> Path:
    return cache_path_for_repo(repo).parent / "ai" / kind / f"{safe_segment(key)}.json"


def alignment_cache_key(pr: dict[str, Any], model: str) -> str:
    return f"{model}_pr_{pr.get('number')}_{sha256_text(pr_fingerprint_text(pr))[:12]}"


def codex_cache_key(kind: str, prs: list[dict[str, Any]], model: str) -> str:
    numbers = "_".join(str(pr.get("number")) for pr in prs)
    text = "\n".join(pr_fingerprint_text(pr) for pr in prs)
    return f"{model}_{kind}_{numbers}_{sha256_text(text)[:12]}"


def load_dotenv(path: Path = Path(".env")) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def find_pr(data: dict[str, Any], number: int) -> dict[str, Any]:
    for pr in data.get("prs") or []:
        if isinstance(pr, dict) and int_or_zero(pr.get("number")) == number:
            return pr
    raise TriageError(f"PR #{number} was not found in cached scan for {data.get('repo', 'unknown')}")


def select_recommendation_candidates(data: dict[str, Any], *, limit: int) -> list[dict[str, Any]]:
    prs = [pr for pr in data.get("prs") or [] if isinstance(pr, dict)]
    return sorted(prs, key=recommendation_priority, reverse=True)[:limit]


def recommendation_priority(pr: dict[str, Any]) -> int:
    signals = pr.get("signals") or {}
    trust = pr.get("contributorTrust") or {}
    flags = pr.get("flags") or []
    score = len(flags) * 12
    score += max(0, 70 - int_or_zero(trust.get("score")))
    if signals.get("reviewState") == "none":
        score += 8
    if signals.get("coreFilesChanged"):
        score += 12
    if signals.get("largeDiff"):
        score += 8
    if signals.get("docsOnly"):
        score += 5
    return score


def pr_context(pr: dict[str, Any]) -> dict[str, Any]:
    signals = pr.get("signals") or {}
    trust = pr.get("contributorTrust") or {}
    contributor = pr.get("contributor") or {}
    return {
        "number": pr.get("number"),
        "title": pr.get("title"),
        "body": truncate_text(pr.get("body") or "", 1200),
        "author": (pr.get("author") or {}).get("login"),
        "url": pr.get("url"),
        "createdAt": pr.get("createdAt"),
        "additions": pr.get("additions"),
        "deletions": pr.get("deletions"),
        "changedFiles": pr.get("changedFiles"),
        "files": [
            {
                "filename": file.get("filename"),
                "status": file.get("status"),
                "additions": file.get("additions"),
                "deletions": file.get("deletions"),
                "patch": truncate_text(file.get("patch") or "", 1800),
            }
            for file in (pr.get("files") or [])[:8]
            if isinstance(file, dict)
        ],
        "changelets": pr.get("changelets") or [],
        "flags": pr.get("flags") or [],
        "signals": {
            "fileNames": signals.get("fileNames") or [],
            "fileBuckets": signals.get("fileBuckets") or {},
            "docsOnly": signals.get("docsOnly"),
            "hasTests": signals.get("hasTests"),
            "ciState": signals.get("ciState"),
            "reviewState": signals.get("reviewState"),
            "genericDescription": signals.get("genericDescription"),
            "coreFilesChanged": signals.get("coreFilesChanged") or [],
            "dependencyFilesChanged": signals.get("dependencyFilesChanged") or [],
            "totalChanges": signals.get("totalChanges"),
        },
        "contributorTrust": trust,
        "contributor": {
            "accountAssociation": contributor.get("accountAssociation"),
            "priorMergedPrs": contributor.get("priorMergedPrs"),
            "currentOpenPrsInScan": contributor.get("currentOpenPrsInScan"),
            "repoCommitContributions": contributor.get("repoCommitContributions"),
        },
    }


def pr_fingerprint_text(pr: dict[str, Any]) -> str:
    context = pr_context(pr)
    context["files"] = [
        {key: value for key, value in file.items() if key != "patch"}
        for file in context.get("files", [])
    ]
    return json.dumps(context, sort_keys=True)


def print_json_result(title: str, result: dict[str, Any]) -> None:
    print(title)
    print("-" * len(title))
    print(json.dumps(result, indent=2, sort_keys=True))


def clamp_score(score: int) -> int:
    return max(0, min(100, score))


def run_gh_json(command: list[str]) -> Any:
    result = subprocess.run(command, text=True, capture_output=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        command_text = " ".join(command)
        message = result.stderr.strip() or result.stdout.strip() or "unknown gh error"
        raise TriageError(f"`{command_text}` failed: {message}")
    if not result.stdout.strip():
        command_text = " ".join(command)
        raise TriageError(f"`{command_text}` returned empty output")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise TriageError(f"gh returned invalid JSON: {error}") from error


def write_cache(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise TriageError(f"cache not found at {path}; run scan without --offline first")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TriageError(f"cache is invalid JSON at {path}: {error}") from error


def print_scan_summary(data: dict[str, Any], *, offline: bool) -> None:
    prs = data.get("prs") or []
    contributors = {((pr.get("author") or {}).get("login")) for pr in prs if isinstance(pr, dict)}
    files = sum(len(pr.get("files") or []) for pr in prs if isinstance(pr, dict))
    summary = data.get("signalSummary") or {}
    mode = "offline cache" if offline else "GitHub"
    print(f"Scanned {len(prs)} PRs from {data.get('repo', 'unknown')} via {mode}.")
    print(f"Contributors: {len([c for c in contributors if c])}")
    print(f"Files with patches: {files}")
    if summary:
        print(f"Low-value PRs flagged: {summary.get('lowValuePrs', 0)}")
        print(f"Risky new-contributor PRs: {summary.get('riskyNewContributorPrs', 0)}")
        if summary.get("averageContributorTrust") is not None:
            print(f"Average contributor trust: {summary['averageContributorTrust']}/100")
    if data.get("since"):
        print(f"Since: {data['since']}")
    if data.get("scannedAt"):
        print(f"Scanned at: {data['scannedAt']}")


def print_signal_report(data: dict[str, Any]) -> None:
    prs = [pr for pr in data.get("prs", []) if isinstance(pr, dict)]
    summary = data.get("signalSummary") or {}
    print("Deterministic Signal Report")
    print("---------------------------")
    print(f"Repo: {data.get('repo', 'unknown')}")
    print(f"PRs: {len(prs)}")
    print(f"Low-value PRs flagged: {summary.get('lowValuePrs', 0)}")
    print(f"Risky new-contributor PRs: {summary.get('riskyNewContributorPrs', 0)}")
    if summary.get("averageContributorTrust") is not None:
        print(f"Average contributor trust: {summary['averageContributorTrust']}/100")
    print(f"Low-trust PRs: {summary.get('lowTrustPrs', 0)}")
    print()

    flag_counts = summary.get("flagCounts") or {}
    if flag_counts:
        print("Flags:")
        for flag, count in sorted(flag_counts.items(), key=lambda item: (-item[1], item[0])):
            print(f"- {flag}: {count}")
        print()

    bucket_counts = summary.get("fileBucketCounts") or {}
    if bucket_counts:
        print("File buckets:")
        for bucket, count in sorted(bucket_counts.items()):
            print(f"- {bucket}: {count}")
        print()

    changelet_counts = summary.get("changeletCounts") or {}
    if changelet_counts:
        print("Top changelets:")
        for changelet, count in list(changelet_counts.items())[:10]:
            print(f"- {changelet}: {count}")
        print()

    flagged = [pr for pr in prs if pr.get("flags")]
    if flagged:
        print("Flagged PRs:")
        for pr in flagged[:20]:
            flags = ", ".join(pr.get("flags") or [])
            print(f"- #{pr.get('number')} {pr.get('title')}: {flags}")
        print()

    trust_sorted = sorted(
        prs,
        key=lambda pr: ((pr.get("contributorTrust") or {}).get("score", 50), pr.get("number") or 0),
    )
    if trust_sorted:
        print("Contributor trust:")
        for pr in trust_sorted[:10]:
            trust = pr.get("contributorTrust") or {}
            print(
                f"- #{pr.get('number')} {trust.get('score', 'n/a')}/100 "
                f"({trust.get('bucket', 'unknown')}): {trust.get('explanation', '')}"
            )


def print_changelets(data: dict[str, Any], *, limit: int) -> None:
    prs = [pr for pr in data.get("prs", []) if isinstance(pr, dict)]
    print("Semantic Changelets")
    print("-------------------")
    print(f"Repo: {data.get('repo', 'unknown')}")
    print(f"PRs: {len(prs)}")
    print()
    for pr in prs[:limit]:
        print(f"#{pr.get('number')} {pr.get('title')}")
        for changelet in pr.get("changelets") or []:
            print(f"- {changelet}")
        print()


def print_clusters(data: dict[str, Any], *, limit: int) -> None:
    clusters = [cluster for cluster in data.get("clusters", []) if isinstance(cluster, dict)]
    print("Semantic PR Clusters")
    print("--------------------")
    print(f"Repo: {data.get('repo', 'unknown')}")
    print(f"Clusters: {len(clusters)}")
    print()
    if not clusters:
        print("No clusters above the selected threshold.")
        return
    for cluster in clusters[:limit]:
        print(
            f"{cluster.get('id')} · {cluster.get('label')} "
            f"({cluster.get('size')} PRs, avg similarity {cluster.get('averageSimilarity')})"
        )
        print(f"Best candidate: #{cluster.get('bestPr')} {cluster.get('bestTitle')} [{cluster.get('bestScore')}/100]")
        for member in cluster.get("members") or []:
            flags = ", ".join(member.get("flags") or [])
            suffix = f" flags: {flags}" if flags else ""
            print(
                f"- #{member.get('number')} {member.get('canonicalScore')}/100 "
                f"sim {member.get('similarityToBest')}: {member.get('title')}{suffix}"
            )
        print()


def print_flood_waves(data: dict[str, Any], waves: list[dict[str, Any]], *, limit: int) -> None:
    print("AI Flood Waves")
    print("---------------")
    print(f"Repo: {data.get('repo', 'unknown')}")
    print(f"Waves: {len(waves)}")
    print()
    if not waves:
        print("No AI-flood waves above the selected threshold.")
        return

    for wave in waves[:limit]:
        print(
            f"{wave.get('id')} - {wave.get('label')} "
            f"({len(wave.get('prs') or [])} PRs, score {wave.get('score')}, {wave.get('window')})"
        )
        print(f"Best candidate: #{wave.get('bestPr')} {wave.get('bestTitle')}")
        print(f"PRs: {', '.join('#' + str(number) for number in wave.get('prs') or [])}")
        reasons = wave.get("reasons") or []
        if reasons:
            print("Reasons:")
            for reason in reasons:
                print(f"- {reason}")
        print(f"Recommended action: {wave.get('recommendedAction')}")
        print()


def validate_repo(repo: str) -> None:
    parts = repo.split("/")
    if len(parts) != 2 or not all(parts):
        raise TriageError("repo must be formatted as owner/repo")


def cache_path_for_repo(repo: str) -> Path:
    validate_repo(repo)
    owner, name = repo.split("/")
    safe = f"{safe_segment(owner)}_{safe_segment(name)}"
    return CACHE_ROOT / safe / "prs.json"


def safe_segment(value: str) -> str:
    return "".join(char if char.isalnum() or char in ("-", "_", ".") else "_" for char in value)


def require_gh() -> None:
    if shutil.which("gh") is None:
        raise TriageError("GitHub CLI `gh` is not installed or not on PATH")


def login_from_author(author: Any) -> str:
    if isinstance(author, dict):
        return author.get("login") or author.get("name") or ""
    return ""


def login_from_rest_user(user: Any) -> str:
    if isinstance(user, dict):
        return user.get("login") or ""
    return ""


def int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def first_nonempty(values: Any) -> Any:
    for value in values:
        if value:
            return value
    return None


def unique_urls(items: list[dict[str, Any]], limit: int) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for item in items:
        url = item.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
        if len(urls) >= limit:
            break
    return urls


def iso_date_at_or_after(value: Any, lower_bound: str) -> bool:
    if not value:
        return False
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
        lower = datetime.fromisoformat(lower_bound).date()
    except ValueError:
        return True
    return date >= lower


if __name__ == "__main__":
    raise SystemExit(main())
