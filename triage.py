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
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CACHE_ROOT = Path(".triage") / "cache"
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
        print_scan_summary(data, offline=True)
        return

    if path.exists() and not scan_args.refresh:
        data = read_cache(path)
        print(f"Using cached scan at {path}. Pass --refresh to call GitHub.")
        print_scan_summary(data, offline=True)
        return

    require_gh()
    data = scan_github(scan_args)
    write_cache(path, data)
    print_scan_summary(data, offline=False)
    print(f"Cache: {path}")


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

    return {
        "schemaVersion": 1,
        "tool": "triage",
        "repo": args.repo,
        "state": args.state,
        "limit": args.limit,
        "since": args.since,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "source": "gh",
        "prs": normalized_prs,
    }


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
    mode = "offline cache" if offline else "GitHub"
    print(f"Scanned {len(prs)} PRs from {data.get('repo', 'unknown')} via {mode}.")
    print(f"Contributors: {len([c for c in contributors if c])}")
    print(f"Files with patches: {files}")
    if data.get("since"):
        print(f"Since: {data['since']}")
    if data.get("scannedAt"):
        print(f"Scanned at: {data['scannedAt']}")


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
