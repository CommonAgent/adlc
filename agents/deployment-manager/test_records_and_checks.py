#!/usr/bin/env python3
"""Every act that puts a version in place, or changes how it runs, ends in a
signed deployment record naming the running package; each deploy is followed
by a conformance check bound to that package; and an agent already running
gets both without being redeployed (fix pass, 2026-10-28).

Before this, the executor signed a record only for a `deploy`, so every agent
updated through the queue ran a version no record named (56 of 62 dev agents),
and nothing ran the Conformance Checker after a deploy (all 62 had no verdict).

Nothing here reaches a network, runs the procedure or signs anything: the
procedure, the recorder and the checker are answered through their seams.

Run: python3 -m unittest test_records_and_checks
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="dm-fixpass-test-")
os.environ.setdefault("DM_FLEET", TMP)
os.environ.setdefault("DM_HOME", TMP)
import record  # noqa: E402
import steps  # noqa: E402

_spec = importlib.util.spec_from_file_location("deploy_executor_fp", os.path.join(HERE, "deploy-executor.py"))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

SHA = "ab" * 32
KEY = "U" + "A" * 55


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def emitted(case, fn, *args):
    buf = io.StringIO()
    steps.CURRENT["entry"] = None
    steps.CURRENT["cloud"] = None
    with contextlib.redirect_stdout(buf), case.assertRaises(SystemExit):
        fn(*args)
    return json.loads(buf.getvalue())


UPDATED = {"ok": True, "act": "update", "name": "brand-reader", "package": "brand-reader", "version": "0.3.3",
           "sha256": SHA, "url": "https://app.example/v1/deploy-requests/dr_x/package.tar.gz",
           "agent_key": KEY, "handle": "brand-reader.platform@example.com", "harness": "opencode",
           "previous": {"version": "0.3.2", "sha256": "cd" * 32}, "descriptor": {"digest": "ef" * 32, "signed": True,
                                                                               "added": ["acts_for", "subject"]},
           "smoke": {"passed": True}}


class AnUpdateIsRecordedLikeADeploy(unittest.TestCase):

    def run_update(self, result):
        req = {"id": "dr_upd1", "args": {"name": "brand-reader", "harness": "opencode"},
               "boot_token": "am_x", "package_url": "https://app.example/p.tar.gz"}
        signed = []

        def fake_run(cmd, **kw):
            if cmd[:2] == ["python3", ex.STEPS]:
                return mock.Mock(stdout=json.dumps(result), stderr="", returncode=0 if result.get("ok") else 1)
            if cmd[:2] == ["python3", ex.RECORD]:
                signed.append(json.loads(kw["input"]))
                return mock.Mock(stdout=json.dumps({"act": json.loads(kw["input"])["act"], "signatures": [{"sig": "s"}]}),
                                 stderr="", returncode=0)
            raise AssertionError(cmd)
        with mock.patch.object(ex, "DM_TOKENS", os.path.join(TMP, "tokens")), \
                mock.patch.object(ex, "DM_HOME", TMP), mock.patch.object(ex, "DM_RECORDS", os.path.join(TMP, "records")), \
                mock.patch.object(ex, "FLEET", TMP), mock.patch.object(ex.subprocess, "run", fake_run), \
                mock.patch.object(ex.time, "sleep"), mock.patch("builtins.print"), \
                mock.patch.object(ex, "audit_refusal", return_value=None):
            os.makedirs(os.path.join(TMP, "tokens"), exist_ok=True)
            with open(os.path.join(TMP, "deploymgr-agents.json"), "w") as f:
                json.dump([{"name": "brand-reader"}], f)
            return ex.run_one(req), signed

    def test_an_update_that_worked_carries_its_signed_record(self):
        outcome, signed = self.run_update(UPDATED)
        self.assertTrue(outcome["ok"])
        self.assertEqual(outcome["record"]["act"], "update")
        self.assertEqual(len(signed), 1)

    def test_an_update_the_check_restored_is_recorded_too(self):
        outcome, signed = self.run_update({**UPDATED, "ok": False, "step": "check", "restored": True})
        self.assertFalse(outcome["ok"])
        self.assertEqual(outcome["record"]["act"], "update")

    def test_the_update_record_names_the_package_it_put_in_place(self):
        doc = record.build(UPDATED, None, "UDM")
        self.assertEqual(doc["act"], "update")
        self.assertEqual(doc["package"]["sha256"], SHA)
        self.assertEqual(doc["agent"]["key"], KEY)
        self.assertEqual(doc["descriptor"]["sha256"], "ef" * 32)


class AReconfigureAndAnAttestAreRecorded(unittest.TestCase):

    def test_a_model_change_is_a_reconfigure_naming_the_running_package(self):
        doc = record.build({"ok": True, "act": "model", "name": "x", "was": "a", "now": "b",
                            "package": "x", "version": "1.0.0", "sha256": SHA, "agent_key": KEY, "handle": "x.p@e.com",
                            "descriptor": {"digest": "ef" * 32, "signed": True}, "check": {"passed": True}}, None, "UDM")
        self.assertEqual((doc["act"], doc["change"]), ("reconfigure", "model"))
        self.assertEqual(doc["package"]["sha256"], SHA)
        self.assertEqual((doc["was"], doc["now"]), ("a", "b"))

    def test_jobs_at_once_and_rebind_are_reconfigures_too(self):
        for act in ("jobs-at-once", "rebind"):
            doc = record.build({"ok": True, "act": act, "name": "x", "package": "x", "version": "1", "sha256": SHA,
                                "agent_key": KEY}, None, "UDM")
            self.assertEqual((doc["act"], doc["change"]), ("reconfigure", act))

    def test_an_attest_says_it_is_one_and_names_the_package_and_image(self):
        doc = record.build({"ok": True, "act": "attest", "name": "x", "package": "x", "version": "1.0.0", "sha256": SHA,
                            "agent_key": KEY, "handle": "x.p@e.com", "image_digest": "sha256:" + "11" * 32,
                            "ledger": {"sha256": "22" * 32, "files": 4, "drift": [{"path": ".agentmesh/adapter/descriptor.json", "state": "changed"}]}},
                           None, "UDM")
        self.assertEqual(doc["act"], "attest")
        self.assertEqual(doc["package"]["sha256"], SHA)
        self.assertEqual(doc["image_digest"], "sha256:" + "11" * 32)
        self.assertIn("1 other placed file", doc["checks"][0]["what"])
        self.assertTrue(doc["_unsigned"])  # no identity here, and it says so


class AttestChangesNothingAndRefusesDrift(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-attest-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.home = os.path.join(self.dir, "home")
        os.makedirs(os.path.join(self.home, "pkg", "skills"))
        os.makedirs(os.path.join(self.home, ".agentmesh", "adapter"))
        with open(os.path.join(self.home, "pkg", "plugin.json"), "w") as f:
            f.write("{}")
        with open(os.path.join(self.home, ".agentmesh", "adapter", "descriptor.json"), "w") as f:
            f.write("{}")
        with open(os.path.join(self.home, ".agentmesh", "adapter", "identity.json"), "w") as f:
            json.dump({"public_key": KEY}, f)
        self.list = os.path.join(self.dir, "agents.json")
        with open(self.list, "w") as f:
            json.dump([{"name": "pkg-agent", "package": "pkg", "version": "1.2.0", "sha256": SHA, "state": "running",
                        "handle": "pkg-agent.p@e.com"}], f)
        self.ledgers = os.path.join(self.dir, "ledgers")
        os.makedirs(self.ledgers)
        files = steps.INSTALL.ledger(self.home, ["pkg", ".agentmesh/adapter/descriptor.json"])
        with open(os.path.join(self.ledgers, "pkg-agent.json"), "w") as f:
            json.dump({"agent": "pkg-agent", "root": self.home, "files": files, "outside": [],
                       "sha256": "33" * 32}, f)
        for p in (mock.patch.object(steps, "LIST", self.list), mock.patch.object(steps, "LEDGERS", self.ledgers),
                  mock.patch.object(steps, "CONTAINERS", os.path.join(self.dir, "containers.json")),
                  mock.patch.object(steps, "running_package", self.running)):
            p.start()
            self.addCleanup(p.stop)

    def running(self, entry, home=None):
        return {"package": entry["package"], "version": entry["version"], "sha256": entry["sha256"],
                "agent_key": KEY, "handle": entry["handle"]}

    def test_a_running_agent_is_attested_with_its_package_digest(self):
        doc = emitted(self, steps.attest, "pkg-agent")
        self.assertTrue(doc["ok"])
        self.assertEqual((doc["act"], doc["sha256"], doc["agent_key"]), ("attest", SHA, KEY))
        self.assertEqual(doc["ledger"]["drift"], [])

    def test_a_rewritten_descriptor_is_reported_and_does_not_stop_it(self):
        with open(os.path.join(self.home, ".agentmesh", "adapter", "descriptor.json"), "w") as f:
            f.write('{"adopted": true}')
        doc = emitted(self, steps.attest, "pkg-agent")
        self.assertTrue(doc["ok"])
        self.assertEqual(doc["ledger"]["drift"], [{"path": ".agentmesh/adapter/descriptor.json", "state": "changed"}])

    def test_a_changed_package_file_is_refused(self):
        with open(os.path.join(self.home, "pkg", "plugin.json"), "w") as f:
            f.write('{"edited": true}')
        doc = emitted(self, steps.attest, "pkg-agent")
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["step"], "ledger")


class EachDeployIsFollowedByAConformanceCheck(unittest.TestCase):

    REQ = {"id": "dr_conf1", "args": {"name": "brand-reader"}}
    OUT = {"ok": True, "result": UPDATED}

    def test_the_subject_is_the_package_the_deploy_put_in_place(self):
        s = ex.conformance_subject(self.REQ, self.OUT)
        self.assertEqual((s["request"], s["sha256"], s["handle"], s["package"]),
                         ("dr_conf1", SHA, "brand-reader.platform@example.com", "brand-reader"))

    def test_nothing_is_checked_after_a_failure_a_container_a_tenant_or_a_version_alongside(self):
        self.assertIsNone(ex.conformance_subject(self.REQ, {"ok": False, "result": {**UPDATED, "ok": False}}))
        for extra in ({"container": {"source": "repo"}}, {"tenant": "t"}, {"alongside": {"agent": KEY}}):
            self.assertIsNone(ex.conformance_subject({**self.REQ, **extra}, self.OUT))

    def test_it_is_wanted_everywhere_but_prod_unless_the_switch_says(self):
        with mock.patch.dict(os.environ, {"DM_CONFORMANCE": ""}), \
                mock.patch.object(ex, "_am_env_file", return_value=("dev", "x", {})):
            self.assertTrue(ex.conformance_wanted())
        with mock.patch.dict(os.environ, {"DM_CONFORMANCE": ""}), \
                mock.patch.object(ex, "_am_env_file", return_value=("prod", "x", {})):
            self.assertFalse(ex.conformance_wanted())
        with mock.patch.dict(os.environ, {"DM_CONFORMANCE": "off"}), \
                mock.patch.object(ex, "_am_env_file", return_value=("dev", "x", {})):
            self.assertFalse(ex.conformance_wanted())

    def test_a_served_request_starts_the_check_once_and_a_kept_outcome_does_not(self):
        with mock.patch.object(ex, "OUTCOMES", os.path.join(TMP, "outcomes.json")), \
                mock.patch.object(ex, "run_one", return_value=self.OUT), \
                mock.patch.object(ex, "post_result", return_value=(True, "")), \
                mock.patch.object(ex, "conformance_wanted", return_value=True), \
                mock.patch.object(ex, "start_conformance") as started, mock.patch("builtins.print"):
            kept = {}
            ex.serve_request(self.REQ, kept)
            ex.serve_request(self.REQ, kept)
        self.assertEqual(started.call_count, 1)
        self.assertEqual(started.call_args[0][0]["sha256"], SHA)

    def test_the_check_derives_from_the_installed_package_and_names_its_digest(self):
        home = tempfile.mkdtemp(prefix="dm-conform-")
        self.addCleanup(shutil.rmtree, home, True)
        calls = []
        verdict = {"ok": True, "conforms": True, "summary": {"pass": 1},
                   "record": {"verdict": "conforms", "signatures": [{"sig": "s"}], "package": {"sha256": SHA}}}

        def fake_run(cmd, **kw):
            calls.append(cmd)
            if ex.EVAL_GEN in cmd:
                return mock.Mock(stdout=json.dumps({"eval": "v1", "agent": "brand-reader", "cases": []}), stderr="")
            return mock.Mock(stdout=json.dumps(verdict), stderr="submitted eval record to the registry\n")
        s = ex.conformance_subject(self.REQ, self.OUT)
        os.makedirs(os.path.join(home, "tmp"))
        real_isdir = os.path.isdir
        with mock.patch.object(ex, "EVAL_HOME", home), mock.patch.object(ex, "DM_RECORDS", os.path.join(home, "rec")), \
                mock.patch.object(ex, "checker_seat", return_value=("own", "/home/agentevaluator/.config/fleet/mesh.creds")), \
                mock.patch.object(ex.os.path, "isdir", lambda p: True if p.startswith("/home/") else real_isdir(p)), \
                mock.patch("builtins.print"):
            out = ex.conform_now(s, run=fake_run)
        self.assertTrue(out["ok"] and out["filed"])
        self.assertEqual(out["verdict"], "conforms")
        spec = json.load(open(os.path.join(home, "tmp", "brand-reader-conf1-eval.json")))
        self.assertEqual((spec["package_sha256"], spec["subject_key"]), (SHA, KEY))
        run_cmd = calls[1]
        self.assertEqual(run_cmd[:3], ["sudo", "-u", "agentevaluator"])
        self.assertIn(f"AGENTMESH_ENV={os.environ.get('AGENTMESH_ENV') or 'prod'}", run_cmd, "sudo drops the environment; the mesh is named")
        self.assertIn("brand-reader.platform@example.com", run_cmd)

    def test_with_only_the_nodes_credential_it_runs_as_root_over_a_private_copy_of_the_checkers_state(self):
        d = tempfile.mkdtemp(prefix="dm-seat-")
        self.addCleanup(shutil.rmtree, d, True)
        os.makedirs(os.path.join(d, "adapter"))
        for fn in ("identity.json", "named.json"):
            with open(os.path.join(d, "adapter", fn), "w") as f:
                f.write("{}")
        with mock.patch.object(ex, "EVAL_IDENTITY", os.path.join(d, "adapter", "identity.json")):
            cmd, work = ex.checker_command("node", "/opt/fleet/node-platform/mesh.creds", "/x/spec.json", "a.p@e.com", "/home/a/work")
        self.addCleanup(shutil.rmtree, work, True)
        self.assertNotIn("sudo", cmd)
        self.assertIn("EVAL_CREDS=/opt/fleet/node-platform/mesh.creds", cmd)
        state = os.path.join(work, "adapter")
        self.assertIn(f"MESH_ADAPTER_STATE={state}", cmd)
        self.assertEqual(cmd[-1], os.path.join(state, "identity.json"))
        self.assertTrue(os.path.exists(os.path.join(state, "identity.json")))
        self.assertTrue(os.path.exists(os.path.join(d, "adapter", "identity.json")), "the checker's own state is untouched")

    def test_the_seat_is_the_checkers_own_credential_first_then_the_nodes(self):
        d = tempfile.mkdtemp(prefix="dm-seat2-")
        self.addCleanup(shutil.rmtree, d, True)
        own, node = os.path.join(d, "own.creds"), os.path.join(d, "node.creds")
        with mock.patch.dict(os.environ, {"DM_EVAL_CREDS": own}), mock.patch.object(ex, "NODE_CREDS", node):
            self.assertIsNone(ex.checker_seat()[0])
            open(node, "w").close()
            self.assertEqual(ex.checker_seat(), ("node", node))
            open(own, "w").close()
            self.assertEqual(ex.checker_seat(), ("own", own))

    def test_a_check_that_cannot_derive_cases_says_why_and_fails_nothing(self):
        s = ex.conformance_subject(self.REQ, self.OUT)
        with mock.patch("builtins.print"):
            out = ex.conform_now(s, run=lambda *a, **k: (_ for _ in ()).throw(AssertionError("not reached")))
        self.assertFalse(out["ok"])
        self.assertIn("not at", out["why"])


class TheBackfillRedeploysNothing(unittest.TestCase):

    def test_each_running_agent_gets_an_attest_filed_and_a_check(self):
        d = tempfile.mkdtemp(prefix="dm-backfill-")
        self.addCleanup(shutil.rmtree, d, True)
        inv = os.path.join(d, "agents.json")
        with open(inv, "w") as f:
            json.dump([{"name": "a1", "state": "running"}, {"name": "a2", "state": "running"},
                       {"name": "gone", "state": "removed"}], f)
        ran = []

        def fake_run(cmd, **kw):
            ran.append(cmd)
            name = cmd[-1]
            if name == "a2":
                return mock.Mock(stdout=json.dumps({"ok": False, "step": "ledger", "error": "drift"}), stderr="")
            return mock.Mock(stdout=json.dumps({"ok": True, "act": "attest", "name": name, "package": name,
                                                "version": "1", "sha256": SHA, "agent_key": KEY,
                                                "handle": f"{name}.p@e.com"}), stderr="")
        with mock.patch.object(ex, "signed_record", return_value={"act": "attest", "signatures": [{"sig": "s"}]}), \
                mock.patch.object(ex, "file_record", return_value={"ok": True, "request": "dr_found", "kept_as": "deploy_record"}) as filed, \
                mock.patch.object(ex, "conform", return_value={"ok": True}) as checked, \
                mock.patch.object(ex, "DM_RECORDS", os.path.join(d, "rec")), mock.patch("builtins.print"):
            rows = ex.backfill(run=fake_run, inventory=inv)
        self.assertEqual([r["name"] for r in rows], ["a1", "a2"])
        self.assertTrue(all(c[2] == "attest" for c in ran), "only attest is run: nothing is deployed")
        self.assertEqual(filed.call_count, 1)
        self.assertEqual(checked.call_args[0][0]["request"], "dr_found")
        self.assertIn("refused at ledger", rows[1]["attest"])


if __name__ == "__main__":
    unittest.main()
