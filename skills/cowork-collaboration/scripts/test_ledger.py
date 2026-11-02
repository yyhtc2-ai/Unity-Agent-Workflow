"""Behavioral checks for the local handoff recorder."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("ledger.py")


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / "test.sqlite3"

    def call(self, *args, ok=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db), *args],
            capture_output=True, text=True, encoding="utf-8",
        )
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result.stderr

    def create(self, project=None):
        return self.call(
            "create", "--project", str(project or self.temp.name), "--session", "Codely CLI", "--objective", "完成任务",
            "--scope", "只读", "--acceptance", "结果正确", "--baseline", "无更改",
        )["id"]

    def move(self, task_id, old, new, *extra, ok=True):
        return self.call("transition", task_id, "--from", old, "--to", new,
                         "--note", "观察记录", *extra, ok=ok)

    def test_completion_requires_verification_and_persists_evidence(self):
        task = self.create()
        self.move(task, "prepared", "sending")
        self.move(task, "sending", "sent")
        self.call("note", task, "--text", "Codely CLI is working")
        self.move(task, "sent", "completed", "--evidence", "检查通过", ok=False)
        self.move(task, "sent", "awaiting_verification")
        self.move(task, "awaiting_verification", "completed", ok=False)
        done = self.move(task, "awaiting_verification", "completed", "--evidence", "独立检查通过")
        self.assertEqual(done["status"], "completed")
        self.assertIn("独立检查通过", self.call("show", task)["events"][-1]["detail"])
        self.assertEqual(self.call("list"), [])
        self.assertEqual(len(self.call("list", "--all")), 1)

    def test_uncertain_delivery_blocks_other_handoffs_until_resolved(self):
        first, second = self.create(), self.create()
        self.move(first, "prepared", "sending")
        self.move(first, "sending", "delivery_unknown")
        self.move(second, "prepared", "sending", ok=False)
        self.assertEqual(self.call("show", second)["status"], "prepared")
        self.move(first, "delivery_unknown", "sent")
        self.move(second, "prepared", "sending", ok=False)
        self.move(first, "sent", "awaiting_verification")
        self.move(second, "prepared", "sending", ok=False)
        self.move(first, "awaiting_verification", "completed", "--evidence", "核对通过")
        self.assertEqual(self.move(second, "prepared", "sending")["status"], "sending")

    def test_stale_transition_does_not_overwrite_new_state(self):
        task = self.create()
        self.move(task, "prepared", "sending")
        self.move(task, "prepared", "cancelled", ok=False)
        self.assertEqual(self.call("show", task)["status"], "sending")
        self.move(task, "sending", "delivery_unknown")
        self.move(task, "delivery_unknown", "prepared")
        self.assertEqual(self.call("show", task)["status"], "prepared")

    def test_project_is_required_and_separates_execution_lanes(self):
        self.call("create", "--session", "Codely CLI", "--objective", "x",
                  "--scope", "x", "--acceptance", "x", "--baseline", "x", ok=False)
        second_project = Path(self.temp.name) / "other-project"
        second_project.mkdir()
        first, second = self.create(), self.create(second_project)
        self.move(first, "prepared", "sending")
        self.assertEqual(self.move(second, "prepared", "sending")["status"], "sending")
        self.assertEqual([x["id"] for x in self.call("list", "--project", str(second_project))], [second])

    def test_rejects_relative_and_nonexistent_project_paths(self):
        for path in ("relative", str(Path(self.temp.name) / "missing")):
            self.call("create", "--project", path, "--session", "Codely CLI", "--objective", "x",
                      "--scope", "x", "--acceptance", "x", "--baseline", "x", ok=False)


if __name__ == "__main__":
    unittest.main()
