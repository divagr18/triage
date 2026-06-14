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

    def test_deterministic_signals_flag_readme_noise(self):
        pr = {
            "title": "Update README",
            "body": "small update",
            "author": {"login": "newdev"},
            "additions": 3,
            "deletions": 1,
            "changedFiles": 1,
            "checks": [],
            "reviews": [],
            "files": [
                {
                    "filename": "README.md",
                    "status": "modified",
                    "additions": 3,
                    "deletions": 1,
                    "changes": 4,
                    "patch": "@@\n-old docs\n+new docs",
                }
            ],
            "contributor": {"priorMergedPrs": 0, "currentOpenPrs": 1, "currentOpenPrsInScan": 1},
        }

        signals = triage.compute_pr_signals(pr)
        pr["signals"] = signals
        flags = triage.compute_pr_flags(pr)

        self.assertTrue(signals["docsOnly"])
        self.assertTrue(signals["readmeOnly"])
        self.assertIn("readme_only_noise", flags)
        self.assertIn("description_too_generic", flags)

    def test_deterministic_signals_flag_core_without_tests(self):
        pr = {
            "title": "Change parser behavior",
            "body": "Updates parser handling for malformed input.",
            "additions": 80,
            "deletions": 10,
            "changedFiles": 1,
            "checks": [{"name": "ci", "conclusion": "FAILURE"}],
            "reviews": [],
            "files": [
                {
                    "filename": "src/parser.js",
                    "status": "modified",
                    "additions": 80,
                    "deletions": 10,
                    "changes": 90,
                    "patch": "@@\n-if (x) return old\n+if (x) return newer",
                }
            ],
            "contributor": {"priorMergedPrs": 0, "currentOpenPrs": 1, "currentOpenPrsInScan": 1},
        }

        signals = triage.compute_pr_signals(pr)
        pr["signals"] = signals
        flags = triage.compute_pr_flags(pr)

        self.assertTrue(signals["hasCode"])
        self.assertFalse(signals["hasTests"])
        self.assertEqual(signals["ciState"], "failing")
        self.assertIn("core_change_without_tests", flags)
        self.assertIn("ci_failing", flags)
        self.assertIn("new_contributor_high_risk", flags)

    def test_attach_deterministic_signals_adds_summary(self):
        data = {
            "repo": "owner/repo",
            "prs": [
                {
                    "title": "Update README",
                    "body": "",
                    "additions": 1,
                    "deletions": 0,
                    "changedFiles": 1,
                    "files": [{"filename": "README.md", "patch": "@@\n+hello"}],
                    "contributor": {},
                }
            ],
        }

        triage.attach_deterministic_signals(data)

        self.assertIn("signals", data["prs"][0])
        self.assertIn("readme_only_noise", data["prs"][0]["flags"])
        self.assertEqual(data["signalSummary"]["lowValuePrs"], 1)
        self.assertIn("trustScore", data["prs"][0]["contributor"])

    def test_contributor_trust_rewards_known_passing_contributor(self):
        pr = {
            "title": "Fix parser edge case",
            "body": "Handles malformed input while preserving the old behavior.",
            "additions": 20,
            "deletions": 4,
            "changedFiles": 2,
            "checks": [{"name": "ci", "conclusion": "SUCCESS"}],
            "reviews": [{"state": "APPROVED"}],
            "reviewDecision": "APPROVED",
            "files": [
                {"filename": "src/parser.js", "patch": "@@\n-return old\n+return fixed"},
                {"filename": "tests/parser.test.js", "patch": "@@\n+assert.equal(result, expected)"},
            ],
            "contributor": {
                "accountAssociation": "CONTRIBUTOR",
                "priorMergedPrs": 6,
                "priorClosedUnmergedPrs": 0,
                "currentOpenPrs": 1,
                "currentOpenPrsInScan": 1,
            },
        }
        pr["signals"] = triage.compute_pr_signals(pr)
        pr["flags"] = triage.compute_pr_flags(pr)

        trust = triage.compute_contributor_trust(pr)

        self.assertGreaterEqual(trust["score"], 75)
        self.assertEqual(trust["bucket"], "high")
        self.assertTrue(trust["positives"])

    def test_contributor_trust_penalizes_risky_low_context_change(self):
        pr = {
            "title": "Update README",
            "body": "",
            "additions": 4,
            "deletions": 0,
            "changedFiles": 1,
            "checks": [{"name": "ci", "conclusion": "FAILURE"}],
            "reviews": [],
            "files": [{"filename": "README.md", "patch": "@@\n+tiny cleanup"}],
            "contributor": {
                "accountAssociation": "FIRST_TIMER",
                "priorMergedPrs": 0,
                "priorClosedUnmergedPrs": 3,
                "currentOpenPrs": 5,
                "currentOpenPrsInScan": 5,
            },
        }
        pr["signals"] = triage.compute_pr_signals(pr)
        pr["flags"] = triage.compute_pr_flags(pr)

        trust = triage.compute_contributor_trust(pr)

        self.assertLess(trust["score"], 40)
        self.assertEqual(trust["bucket"], "very_low")
        self.assertTrue(trust["risks"])


if __name__ == "__main__":
    unittest.main()
