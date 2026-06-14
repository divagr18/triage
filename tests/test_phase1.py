import json
import tempfile
import unittest
from pathlib import Path

import triage


class PhaseOneTests(unittest.TestCase):
    def test_cache_path_is_repo_scoped(self):
        self.assertEqual(
            triage.cache_path_for_repo("microsoft/coreutils"),
            Path(".triage/cache/microsoft_coreutils/prs.json"),
        )

    def test_invalid_repo_is_rejected(self):
        with self.assertRaises(triage.TriageError):
            triage.cache_path_for_repo("not-a-repo")

    def test_normalize_pr_keeps_phase_one_fields(self):
        raw = {
            "number": 42,
            "title": "Add Docker support",
            "body": "Adds Dockerfile and docs",
            "author": {"login": "alice", "name": "Alice", "association": "CONTRIBUTOR"},
            "createdAt": "2026-06-01T00:00:00Z",
            "updatedAt": "2026-06-02T00:00:00Z",
            "url": "https://github.com/o/r/pull/42",
            "additions": 10,
            "deletions": 2,
            "changedFiles": 1,
            "labels": [{"name": "enhancement", "color": "0e8a16"}],
            "reviews": [{"author": {"login": "maintainer"}, "state": "APPROVED"}],
            "statusCheckRollup": [{"name": "ci", "status": "COMPLETED", "conclusion": "SUCCESS"}],
        }
        files = [
            {
                "filename": "Dockerfile",
                "status": "added",
                "additions": 10,
                "deletions": 0,
                "changes": 10,
                "patch": "@@ +FROM python:3.13",
            }
        ]

        pr = triage.normalize_pr(raw, [triage.normalize_file(files[0])])

        self.assertEqual(pr["number"], 42)
        self.assertEqual(pr["author"]["login"], "alice")
        self.assertEqual(pr["labels"][0]["name"], "enhancement")
        self.assertEqual(pr["checks"][0]["conclusion"], "SUCCESS")
        self.assertEqual(pr["files"][0]["patch"], "@@ +FROM python:3.13")

    def test_cache_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prs.json"
            data = {"schemaVersion": 1, "repo": "owner/repo", "prs": []}

            triage.write_cache(path, data)

            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), data)
            self.assertEqual(triage.read_cache(path), data)

    def test_unique_urls_deduplicates_preserving_order(self):
        urls = triage.unique_urls(
            [
                {"url": "https://example.test/1"},
                {"url": "https://example.test/1"},
                {"url": "https://example.test/2"},
            ],
            limit=10,
        )

        self.assertEqual(urls, ["https://example.test/1", "https://example.test/2"])


if __name__ == "__main__":
    unittest.main()
