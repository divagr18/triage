import json
import tempfile
import unittest
from subprocess import CompletedProcess
from pathlib import Path
from unittest.mock import patch

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

    def test_rest_normalization_uses_files_and_reviews(self):
        raw = {
            "number": 99,
            "title": "fix: rest ingestion",
            "body": "Uses REST API",
            "user": {"login": "octo"},
            "author_association": "CONTRIBUTOR",
            "created_at": "2026-06-01T00:00:00Z",
            "updated_at": "2026-06-02T00:00:00Z",
            "html_url": "https://github.com/o/r/pull/99",
            "state": "open",
            "draft": False,
            "labels": [{"name": "bug", "color": "d73a4a"}],
        }
        files = [
            triage.normalize_file(
                {
                    "filename": "src/app.py",
                    "status": "modified",
                    "additions": 12,
                    "deletions": 3,
                    "changes": 15,
                    "patch": "@@\n-old\n+new",
                }
            )
        ]
        reviews = [{"author": "maintainer", "state": "APPROVED", "submittedAt": "2026-06-02T00:00:00Z"}]

        pr = triage.normalize_rest_pr(raw, files, reviews)

        self.assertEqual(pr["author"]["login"], "octo")
        self.assertEqual(pr["author"]["association"], "CONTRIBUTOR")
        self.assertEqual(pr["additions"], 12)
        self.assertEqual(pr["deletions"], 3)
        self.assertEqual(pr["reviewDecision"], "APPROVED")

    def test_contributor_trust_uses_rest_commit_contributions(self):
        pr = {
            "title": "Improve docs",
            "body": "Adds detailed setup guidance for local development and validation workflows.",
            "additions": 20,
            "deletions": 2,
            "changedFiles": 1,
            "checks": [],
            "reviews": [],
            "files": [{"filename": "docs/setup.md", "patch": "@@\n+more detail"}],
            "contributor": {
                "accountAssociation": "NONE",
                "priorMergedPrs": 0,
                "priorClosedUnmergedPrs": 0,
                "repoCommitContributions": 120,
                "currentOpenPrs": 1,
                "currentOpenPrsInScan": 1,
            },
        }
        pr["signals"] = triage.compute_pr_signals(pr)
        pr["flags"] = triage.compute_pr_flags(pr)

        trust = triage.compute_contributor_trust(pr)

        self.assertGreaterEqual(trust["score"], 50)
        self.assertTrue(any("repo commit contributions" in reason for reason in trust["positives"]))

    def test_iso_date_filter(self):
        self.assertTrue(triage.iso_date_at_or_after("2026-06-14T05:19:09Z", "2026-06-01"))
        self.assertFalse(triage.iso_date_at_or_after("2026-05-14T05:19:09Z", "2026-06-01"))

    def test_run_gh_json_rejects_empty_success(self):
        completed = CompletedProcess(args=["gh"], returncode=0, stdout="", stderr="")
        with patch("triage.subprocess.run", return_value=completed):
            with self.assertRaises(triage.TriageError):
                triage.run_gh_json(["gh", "api", "repos/o/r/pulls"])

    def test_changelets_capture_readme_only(self):
        pr = {
            "title": "Update README",
            "body": "",
            "additions": 2,
            "deletions": 0,
            "changedFiles": 1,
            "files": [{"filename": "README.md", "patch": "@@\n+Install instructions"}],
            "contributor": {},
        }
        pr["signals"] = triage.compute_pr_signals(pr)

        self.assertIn("edit README only", triage.extract_changelets(pr))

    def test_changelets_capture_model_provider_fix(self):
        pr = {
            "title": "fix(mistral): forward supported sampling params",
            "body": "Adds tests for Mistral request params.",
            "additions": 40,
            "deletions": 2,
            "changedFiles": 2,
            "files": [
                {
                    "filename": "libs/agno/models/mistral.py",
                    "patch": "@@\n+frequency_penalty = self.frequency_penalty\n+stop = self.stop",
                },
                {
                    "filename": "tests/unit/models/test_mistral_request_params.py",
                    "patch": "@@\n+assert request_params['stop'] == stop",
                },
            ],
            "contributor": {},
        }
        pr["signals"] = triage.compute_pr_signals(pr)

        changelets = triage.extract_changelets(pr)

        self.assertIn("fix bug", changelets)
        self.assertIn("add or update tests", changelets)
        self.assertIn("update model/provider behavior", changelets)

    def test_changelets_capture_guard_and_persistence(self):
        pr = {
            "title": "fix: scope entity memory ids by user",
            "body": "Prevents cross-user persistence collisions.",
            "additions": 60,
            "deletions": 4,
            "changedFiles": 1,
            "files": [
                {
                    "filename": "libs/agno/agno/learn/stores/entity_memory.py",
                    "patch": "@@\n+if namespace == 'user' and not user_id:\n+    return None\n+db.upsert_learning(id=scoped_id)",
                }
            ],
            "contributor": {},
        }
        pr["signals"] = triage.compute_pr_signals(pr)

        changelets = triage.extract_changelets(pr)

        self.assertIn("fix bug", changelets)
        self.assertIn("add guard or validation", changelets)
        self.assertIn("change database or persistence behavior", changelets)

    def test_hybrid_similarity_uses_embeddings_and_overlap(self):
        left = {
            "title": "fix: mistral params",
            "body": "",
            "changelets": ["fix bug", "update model/provider behavior"],
            "signals": {"fileNames": ["libs/agno/models/mistral.py"], "keywords": ["mistral", "params"]},
        }
        right = {
            "title": "fix: cerebras params",
            "body": "",
            "changelets": ["fix bug", "update model/provider behavior"],
            "signals": {"fileNames": ["libs/agno/models/cerebras.py"], "keywords": ["cerebras", "params"]},
        }

        score, components = triage.hybrid_similarity(left, right, [1.0, 0.0], [0.9, 0.1])

        self.assertGreater(score, 0.7)
        self.assertGreater(components["embedding"], 0.9)
        self.assertEqual(components["changelet"], 1.0)

    def test_build_duplicate_clusters_selects_canonical_candidate(self):
        prs = [
            {
                "number": 1,
                "title": "fix: forward Mistral params",
                "changelets": ["fix bug", "update model/provider behavior", "forward sampling params"],
                "signals": {
                    "fileNames": ["libs/agno/models/mistral.py"],
                    "keywords": ["mistral", "params"],
                    "hasTests": True,
                    "ciState": "passing",
                    "smallDiff": True,
                    "reviewState": "none",
                },
                "flags": [],
                "contributorTrust": {"score": 70},
            },
            {
                "number": 2,
                "title": "fix: forward Cerebras params",
                "changelets": ["fix bug", "update model/provider behavior", "forward sampling params"],
                "signals": {
                    "fileNames": ["libs/agno/models/cerebras.py"],
                    "keywords": ["cerebras", "params"],
                    "hasTests": False,
                    "ciState": "none",
                    "smallDiff": True,
                    "reviewState": "none",
                },
                "flags": ["description_too_generic"],
                "contributorTrust": {"score": 45},
            },
            {
                "number": 3,
                "title": "docs: update cookbook",
                "changelets": ["update documentation"],
                "signals": {
                    "fileNames": ["cookbook/readme.md"],
                    "keywords": ["docs"],
                    "hasTests": False,
                    "ciState": "none",
                    "smallDiff": True,
                    "reviewState": "none",
                },
                "flags": [],
                "contributorTrust": {"score": 50},
            },
        ]

        with patch("triage.get_pr_embeddings", return_value=[[1, 0], [0.95, 0.05], [0, 1]]):
            clusters = triage.build_duplicate_clusters(
                "owner/repo",
                prs,
                threshold=0.6,
                model_name="test-model",
            )

        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["bestPr"], 1)
        self.assertEqual(clusters[0]["prs"], [1, 2])

    def test_build_duplicate_clusters_rejects_generic_core_overlap(self):
        prs = [
            {
                "number": 1,
                "title": "fix: cookie encryption",
                "changelets": ["fix bug", "touch core runtime"],
                "signals": {"fileNames": ["lib/response.js"], "keywords": ["cookie"], "smallDiff": True},
                "flags": [],
                "contributorTrust": {"score": 50},
            },
            {
                "number": 2,
                "title": "update eslint 9",
                "changelets": ["modify project configuration", "touch core runtime"],
                "signals": {"fileNames": ["eslint.config.mjs"], "keywords": ["eslint"], "smallDiff": False},
                "flags": ["large_unrelated_refactor"],
                "contributorTrust": {"score": 50},
            },
        ]

        with patch("triage.get_pr_embeddings", return_value=[[1, 0], [0.9, 0.1]]):
            clusters = triage.build_duplicate_clusters(
                "owner/repo",
                prs,
                threshold=0.6,
                model_name="test-model",
            )

        self.assertEqual(clusters, [])

    def test_pair_specific_overlap_rejects_examples_and_broad_runtime_files(self):
        left = {
            "changelets": ["fix bug", "update examples or cookbook", "touch lib/response.js"],
            "signals": {"fileNames": ["examples/auth/index.js", "lib/response.js"], "keywords": ["fix"]},
        }
        right = {
            "changelets": ["modify project configuration", "update examples or cookbook", "touch lib/response.js"],
            "signals": {"fileNames": ["examples/auth/index.js", "lib/response.js"], "keywords": ["fix"]},
        }

        self.assertFalse(
            triage.pair_has_specific_overlap(
                left,
                right,
                {"embedding": 0.9, "changelet": 0.5, "files": 0.5, "keywords": 1.0, "issues": 0.0},
            )
        )

    def test_rest_unknown_history_does_not_penalize_as_zero_history(self):
        pr = {
            "title": "Improve docs",
            "body": "Adds detailed setup guidance for local development and validation workflows.",
            "additions": 20,
            "deletions": 2,
            "changedFiles": 1,
            "checks": [],
            "reviews": [],
            "files": [{"filename": "docs/setup.md", "patch": "@@\n+more detail"}],
            "contributor": {
                "accountAssociation": "NONE",
                "priorMergedPrs": 0,
                "priorClosedUnmergedPrs": 0,
                "repoCommitContributions": 0,
                "historySource": "rest_contributors",
                "currentOpenPrs": 1,
                "currentOpenPrsInScan": 1,
            },
        }
        pr["signals"] = triage.compute_pr_signals(pr)
        pr["flags"] = triage.compute_pr_flags(pr)

        trust = triage.compute_contributor_trust(pr)

        self.assertGreaterEqual(trust["score"], 40)
        self.assertIn("prior merged PR history unknown in REST scan", trust["risks"])

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

    def test_ai_flood_detects_low_context_burst(self):
        prs = []
        for number, hour in [(10, "00"), (11, "08"), (12, "16")]:
            pr = {
                "number": number,
                "title": "Update README docs",
                "body": "",
                "createdAt": f"2026-06-01T{hour}:00:00Z",
                "additions": 4,
                "deletions": 0,
                "changedFiles": 1,
                "checks": [],
                "reviews": [],
                "files": [{"filename": "README.md", "patch": "@@\n+small cleanup"}],
                "contributor": {
                    "accountAssociation": "FIRST_TIMER",
                    "priorMergedPrs": 0,
                    "currentOpenPrs": 1,
                    "currentOpenPrsInScan": 1,
                },
            }
            pr["signals"] = triage.compute_pr_signals(pr)
            pr["flags"] = triage.compute_pr_flags(pr)
            pr["changelets"] = triage.extract_changelets(pr)
            pr["contributorTrust"] = triage.compute_contributor_trust(pr)
            prs.append(pr)

        with patch("triage.build_duplicate_clusters", return_value=[]):
            waves = triage.build_ai_flood_waves(
                "owner/repo",
                prs,
                since=None,
                window_hours=24,
                min_size=3,
                threshold=0.55,
                cluster_threshold=0.62,
                model_name="test-model",
            )

        self.assertEqual(len(waves), 1)
        self.assertEqual(waves[0]["prs"], [10, 11, 12])
        self.assertGreaterEqual(waves[0]["score"], 0.55)
        self.assertTrue(waves[0]["recommendedAction"])

    def test_ai_flood_rejects_old_spread_out_repetition(self):
        prs = []
        for number, day in [(10, "01"), (11, "12"), (12, "24")]:
            pr = {
                "number": number,
                "title": "Update README docs",
                "body": "",
                "createdAt": f"2026-06-{day}T00:00:00Z",
                "additions": 4,
                "deletions": 0,
                "changedFiles": 1,
                "checks": [],
                "reviews": [],
                "files": [{"filename": "README.md", "patch": "@@\n+small cleanup"}],
                "contributor": {
                    "accountAssociation": "FIRST_TIMER",
                    "priorMergedPrs": 0,
                    "currentOpenPrs": 1,
                    "currentOpenPrsInScan": 1,
                },
            }
            pr["signals"] = triage.compute_pr_signals(pr)
            pr["flags"] = triage.compute_pr_flags(pr)
            pr["changelets"] = triage.extract_changelets(pr)
            pr["contributorTrust"] = triage.compute_contributor_trust(pr)
            prs.append(pr)

        with patch("triage.build_duplicate_clusters", return_value=[]):
            waves = triage.build_ai_flood_waves(
                "owner/repo",
                prs,
                since=None,
                window_hours=72,
                min_size=3,
                threshold=0.55,
                cluster_threshold=0.62,
                model_name="test-model",
            )

        self.assertEqual(waves, [])

    def test_ai_flood_rejects_same_file_without_repeated_intent(self):
        prs = []
        cases = [
            (20, "00", "fix: handle timeout in provider", "timeout"),
            (21, "06", "feat: expose provider telemetry", "telemetry"),
            (22, "12", "refactor: simplify provider config", "config"),
        ]
        for number, hour, title, keyword in cases:
            pr = {
                "number": number,
                "title": title,
                "body": "Implements a focused code change for a different maintainer concern.",
                "createdAt": f"2026-06-01T{hour}:00:00Z",
                "additions": 12,
                "deletions": 3,
                "changedFiles": 1,
                "checks": [],
                "reviews": [],
                "files": [{"filename": "libs/agno/provider.py", "patch": f"@@\n+{keyword} change"}],
                "contributor": {
                    "accountAssociation": "FIRST_TIMER",
                    "priorMergedPrs": 0,
                    "currentOpenPrs": 1,
                    "currentOpenPrsInScan": 1,
                },
            }
            pr["signals"] = triage.compute_pr_signals(pr)
            pr["flags"] = triage.compute_pr_flags(pr)
            pr["changelets"] = ["fix bug", "touch core runtime"]
            pr["contributorTrust"] = triage.compute_contributor_trust(pr)
            prs.append(pr)

        with patch("triage.build_duplicate_clusters", return_value=[]):
            waves = triage.build_ai_flood_waves(
                "owner/repo",
                prs,
                since=None,
                window_hours=24,
                min_size=3,
                threshold=0.55,
                cluster_threshold=0.62,
                model_name="test-model",
            )

        self.assertEqual(waves, [])


if __name__ == "__main__":
    unittest.main()
