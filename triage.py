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
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CACHE_ROOT = Path(".triage") / "cache"
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


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "scan":
            scan_command(args)
        elif args.command == "report":
            report_command(args)
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
        "--history-limit",
        type=positive_int,
        default=50,
        help="max prior PRs to inspect per contributor",
    )

    report = subcommands.add_parser("report", help="show deterministic signal summary from cache")
    report.add_argument("repo", help="repository in owner/repo form")

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


def scan_github(args: ScanArgs) -> dict[str, Any]:
    raw_prs = fetch_pr_list(args)
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
        files = fetch_pr_files(args.repo, number)
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
        "schemaVersion": 2,
        "tool": "triage",
        "repo": args.repo,
        "state": args.state,
        "limit": args.limit,
        "since": args.since,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "source": "gh",
        "prs": normalized_prs,
    }
    attach_deterministic_signals(data)
    return data


def fetch_pr_list(args: ScanArgs) -> list[dict[str, Any]]:
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


def fetch_pr_files(repo: str, number: int) -> list[dict[str, Any]]:
    command = [
        "gh",
        "api",
        f"repos/{repo}/pulls/{number}/files",
        "--paginate",
    ]
    raw_files = run_gh_json(command)
    return [normalize_file(file) for file in raw_files if isinstance(file, dict)]


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


def normalize_author(author: Any) -> dict[str, Any]:
    if not isinstance(author, dict):
        return {"login": "unknown", "name": "", "association": None}
    return {
        "login": author.get("login") or "unknown",
        "name": author.get("name") or "",
        "association": author.get("association") or author.get("authorAssociation"),
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


def compute_signal_summary(prs: list[Any]) -> dict[str, Any]:
    flag_counts: dict[str, int] = {}
    bucket_counts: dict[str, int] = {}
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


def clamp_score(score: int) -> int:
    return max(0, min(100, score))


def run_gh_json(command: list[str]) -> Any:
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        command_text = " ".join(command)
        message = result.stderr.strip() or result.stdout.strip() or "unknown gh error"
        raise TriageError(f"`{command_text}` failed: {message}")
    try:
        return json.loads(result.stdout or "[]")
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


if __name__ == "__main__":
    raise SystemExit(main())
