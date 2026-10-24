#!/usr/bin/env python3
"""The deploy executor runs each approved request once.

What is worth pinning (2026-09-25): a request whose result post was refused
stays approved, and the next poll used to run it again as an update of the
name the first run had bound, which could only refuse. Now the outcome is kept
before the post; a request the queue hands back is answered with that outcome
and never run twice; a "not now" (429, 502, 503) on the post is waited out and
asked again, anything else is left to the next poll; a 429 on the queue read
waits the slow POLL like any other error; kept outcomes go after a day unless
the queue still asks for them; a run's gate is answered once; and a kept file
this process does not own is not believed.

Nothing here reaches a network or runs the procedure: the control plane and
run_one are answered through their seams.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
"""
import email.message
import importlib.util
import io
import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("deploy_executor", os.path.join(HERE, "deploy-executor.py"))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

REQ = {"id": "dr_H-B8test", "args": {"name": "story-editor", "harness": "opencode"},
       "boot_token": "am_x", "package_url": "https://app.agentmesh.ai/v1/deploy-requests/dr_H-B8test/package.tar.gz"}
FAILED_AT_FETCH = {"ok": False, "result": {"ok": False, "step": "fetch", "error": "could not fetch the package: HTTP Error 429"}}
DEPLOYED = {"ok": True, "result": {"ok": True, "act": "deploy", "handle": "story-editor.platform@agentmesh.ai"}}


def http_error(code, retry_after_ms=None):
    body = json.dumps({"error": "Too many requests", **({"retry_after_ms": retry_after_ms} if retry_after_ms is not None else {})})
    return urllib.error.HTTPError("https://app.agentmesh.ai/v1/x", code, "refused", email.message.Message(), io.BytesIO(body.encode()))


class Plane:
    """The control plane as the executor sees it: the queue answers with
    `queue` (or raises it), and each result post takes the next of `results`
    (None means accepted)."""

    def __init__(self, queue, results=()):
        self.queue = queue
        self.results = list(results)
        self.posted = []

    def call(self, path, method="GET", body=None, timeout=30):
        if path == "/deploy-requests/host":
            return {"ok": True}
        if path.startswith("/deploy-requests/queue"):
            if isinstance(self.queue, Exception):
                raise self.queue
            return {"requests": [dict(r) for r in self.queue]}
        if path.endswith("/result"):
            nxt = self.results.pop(0) if self.results else None
            if isinstance(nxt, Exception):
                raise nxt
            self.posted.append((path, body))
            return {"ok": True}
        raise AssertionError(f"unexpected call {method} {path}")


class Harness(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-executor-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.sleeps = []
        self.runs = []
        for p in (mock.patch.object(ex, "OUTCOMES", os.path.join(self.dir, "executor-outcomes.json")),
                  mock.patch.object(ex, "host_report", return_value={"host": "t"}),
                  mock.patch.object(ex.time, "sleep", side_effect=lambda s: self.sleeps.append(s))):
            p.start()
            self.addCleanup(p.stop)
        self.state = {"last_report": None, "reported_at": 0.0}

    def round(self, plane, outcome=DEPLOYED):
        def run_one(r):
            self.runs.append(r["id"])
            return outcome
        with mock.patch.object(ex, "call", plane.call), mock.patch.object(ex, "run_one", run_one), \
                mock.patch("builtins.print"):
            return ex.one_round(self.state)


class AResultThatDidNotLandIsPostedNotRunAgain(Harness):

    def test_the_second_poll_posts_the_kept_outcome_and_runs_nothing(self):
        refused = Plane([REQ], [http_error(429), http_error(429), http_error(429)])
        slept = self.round(refused, FAILED_AT_FETCH)
        self.assertEqual(self.runs, ["dr_H-B8test"])
        self.assertEqual(refused.posted, [])
        self.assertEqual(slept, ex.POLL, "a refused post waits the slow POLL before the queue is asked again")
        self.assertEqual(ex.load_outcomes()["dr_H-B8test"]["outcome"], FAILED_AT_FETCH)

        accepted = Plane([REQ])
        slept = self.round(accepted)
        self.assertEqual(self.runs, ["dr_H-B8test"], "run once, never as an update of its own half-made agent")
        self.assertEqual(accepted.posted, [("/deploy-requests/dr_H-B8test/result", FAILED_AT_FETCH)])
        self.assertEqual(slept, 1)

    def test_a_run_gate_is_answered_by_the_round_that_ran_it_and_not_again(self):
        gated = {**REQ, "run_gate": {"run": "r-1", "phase": "deploy", "runner": "runner.platform@agentmesh.ai"}}
        with mock.patch.object(ex, "answer_the_run") as answered:
            self.round(Plane([gated], [http_error(503), http_error(503), http_error(503)]))
            self.round(Plane([gated]))
        self.assertEqual(answered.call_count, 1)


class ANotNowIsAskedAgainAndNothingElseIs(Harness):

    def test_a_429_is_waited_out_for_as_long_as_the_limiter_said(self):
        plane = Plane([REQ], [http_error(429, retry_after_ms=2000)])
        self.assertEqual(self.round(plane), 1)
        self.assertEqual(len(plane.posted), 1)
        self.assertEqual(self.sleeps, [2.0])

    def test_no_wait_is_longer_than_a_minute(self):
        plane = Plane([REQ], [http_error(429, retry_after_ms=600_000), http_error(502)])
        self.round(plane)
        self.assertEqual(self.sleeps, [60, 15])

    def test_a_refusal_or_a_dropped_connection_is_left_to_the_next_poll(self):
        for err in (http_error(404), urllib.error.URLError("connection reset")):
            self.sleeps.clear()
            plane = Plane([REQ], [err, None])
            self.assertEqual(self.round(plane), ex.POLL)
            self.assertEqual(plane.posted, [], "asked once: the post may have landed, and the queue will say")
            self.assertEqual(self.sleeps, [])


class AQueueReadThatIsRefusedWaitsTheSlowPoll(Harness):

    def test_a_429_on_the_queue_is_an_error_like_any_other(self):
        self.assertEqual(self.round(Plane(http_error(429))), ex.POLL)
        self.assertEqual(self.runs, [])


class KeptOutcomesGoAfterADay(Harness):

    def test_old_ones_go_unless_the_queue_still_asks(self):
        now = time.time()
        kept = {"old": {"at": now - 2 * 86400, "outcome": DEPLOYED},
                "old-still-asked": {"at": now - 2 * 86400, "outcome": DEPLOYED},
                "new": {"at": now - 60, "outcome": DEPLOYED}}
        self.assertEqual(set(ex.prune_outcomes(kept, {"old-still-asked"}, now)), {"old-still-asked", "new"})

    def test_a_round_prunes_the_file(self):
        ex.save_outcomes({"old": {"at": time.time() - 2 * 86400, "outcome": DEPLOYED}})
        self.round(Plane([]))
        self.assertEqual(ex.load_outcomes(), {})


@unittest.skipUnless(hasattr(os, "geteuid") and hasattr(os, "symlink"), "ownership and links are POSIX facts")
class AFileThisProcessDoesNotWriteIsNotBelieved(Harness):

    def test_a_link_is_not_followed(self):
        real = os.path.join(self.dir, "elsewhere.json")
        with open(real, "w") as f:
            json.dump({"dr_x": {"at": time.time(), "outcome": DEPLOYED}}, f)
        os.symlink(real, ex.OUTCOMES)
        self.assertEqual(ex.load_outcomes(), {})

    def test_a_file_others_may_write_is_not_read(self):
        ex.save_outcomes({"dr_x": {"at": time.time(), "outcome": DEPLOYED}})
        os.chmod(ex.OUTCOMES, 0o666)
        self.assertEqual(ex.load_outcomes(), {})

    def test_a_link_at_the_temporary_name_is_replaced_not_written_through(self):
        target = os.path.join(self.dir, "target")
        with open(target, "w") as f:
            f.write("untouched")
        os.symlink(target, f"{ex.OUTCOMES}.tmp")
        self.assertTrue(ex.save_outcomes({}))
        with open(target) as f:
            self.assertEqual(f.read(), "untouched")


if __name__ == "__main__":
    unittest.main()


CONTAINER_REQ = {
    "id": "dr_Ctest1234abcd", "status": "approved", "decided_by": "platform@agentmesh.ai",
    "args": {"name": "crewai-demo", "harness": "container", "handle": "crewai.demo@agentmesh.ai", "placement": "service"},
    "boot_token": "am_the_single_use_value", "boot_token_name": "dr-ctest1234abc",
    "container": {"kind": "third-party-framework", "handle": "crewai.demo@agentmesh.ai",
                  "source": {"repository": "https://github.com/AgentMesh-Community/reference-agents", "path": "frameworks/crewai",
                             "commit": "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6", "dockerfile": "Dockerfile"},
                  "settings": {"RING_HANDLE": "crewai.demo@agentmesh.ai"}, "secrets": {}, "claims": ["ring-member"],
                  "cpu": "1", "memory": "1Gi", "replaces": "UDSMFIHUD4MZPNYKJ5AEYNQ4WKZ3WCFDPDKIGBNFEGFXC7BVA7QEZVTN",
                  "placement": "service", "holds_own_key": True},
}


class AContainerRequestGoesToTheServicePath(unittest.TestCase):
    """A container agent (docs/container-agents-plan.md): the executor asks the
    queue for them, writes an argfile naming the agent key by NAME, places the
    key for the one run and removes it after, and runs the deployment manager's
    container path rather than the package install."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-executor-ctr-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for p in (mock.patch.object(ex, "DM_HOME", self.dir),
                  mock.patch.object(ex, "DM_TOKENS", os.path.join(self.dir, "secrets", "boot-tokens")),
                  mock.patch.object(ex, "placement_settings", return_value={"project": "langbench-1528148150979", "region": "us-east1", "registry": "gcr.io/langbench-1528148150979/deploymgr", "bucket": "b"})):
            p.start()
            self.addCleanup(p.stop)
        self.seen = {}

    def fake_run(self, argv, **kw):
        self.seen["argv"] = argv
        self.seen["args"] = json.load(open(argv[-1]))
        tok = os.path.join(self.dir, "secrets", "boot-tokens", "dr-ctest1234abc.token")
        self.seen["token_there"] = os.path.exists(tok) and open(tok).read()
        out = {"ok": True, "act": "deploy", "handle": "crewai.demo@agentmesh.ai", "agent_key": "UNEW", "record": {"act": "deploy", "signatures": []}}
        return mock.Mock(stdout=json.dumps(out) + "\n", stderr="", returncode=0)

    def test_it_runs_the_container_path_with_the_key_by_name(self):
        with mock.patch.object(ex.subprocess, "run", side_effect=self.fake_run), mock.patch("builtins.print"):
            outcome = ex.run_one(dict(CONTAINER_REQ))
        self.assertTrue(outcome["ok"])
        self.assertEqual(self.seen["argv"][:3], ["node", ex.SERVICE, "install"])
        a = self.seen["args"]
        self.assertEqual(a["boot_token"], "dr-ctest1234abc")
        self.assertNotIn("am_the_single_use_value", json.dumps(a))
        self.assertEqual(a["source"]["commit"], "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6")
        self.assertEqual(a["request_id"], "dr_Ctest1234abcd")
        self.assertEqual(a["project"], "langbench-1528148150979")
        self.assertNotIn("bucket", a)
        self.assertEqual(self.seen["token_there"], "am_the_single_use_value")
        self.assertFalse(os.path.exists(os.path.join(self.dir, "secrets", "boot-tokens", "dr-ctest1234abc.token")))
        self.assertEqual(outcome["record"]["act"], "deploy")
        self.assertNotIn("record", outcome["result"])

    def test_the_queue_is_asked_for_containers(self):
        asked = []
        def call(path, method="GET", body=None, timeout=30):
            asked.append(path)
            return {"requests": []} if path.startswith("/deploy-requests/queue") else {"ok": True}
        with mock.patch.object(ex, "call", call), mock.patch.object(ex, "host_report", return_value={"host": "t"}), \
                mock.patch.object(ex, "OUTCOMES", os.path.join(self.dir, "o.json")), mock.patch("builtins.print"):
            ex.one_round({"last_report": None, "reported_at": 0.0})
        self.assertTrue(any("accepts=container" in p for p in asked))


TENANT_PKG_REQ = {"id": "dr_Ttest1234abcd", "args": {"name": "helper", "harness": "opencode", "interaction": "service", "admit": []},
                  "boot_token": "am_the_single_use_value", "boot_token_name": "dr-ttest1234abc",
                  "package_url": "https://api.agentmesh.ai/v1/deploy-requests/dr_Ttest1234abcd/package.tar.gz",
                  "package": {"name": "helper", "version": "0.1.0", "sha256": "e" * 64},
                  "owner": {"kind": "account", "id": "acc_1", "name": "Person@Example.com"},
                  "requested_by": "person@example.com", "tenant": "t-0a1b2c3d4e5f", "decided_by": "person@example.com"}


class APersonsPackageGoesToTheTenantProject(AContainerRequestGoesToTheServicePath):
    """A person's own package (technical debt 95): the executor asks the queue
    for tenant packages, and sends one only to install-package, never to the
    host procedure, with the tenant the platform set and the handle under the
    account it is installed for."""

    def fake_run(self, argv, **kw):
        self.seen["argv"] = argv
        self.seen["args"] = json.load(open(argv[-1]))
        tok = os.path.join(self.dir, "secrets", "boot-tokens", "dr-ttest1234abc.token")
        self.seen["token_there"] = os.path.exists(tok) and open(tok).read()
        out = {"ok": True, "act": "deploy", "handle": "helper.person@example.com", "agent_key": "UNEW", "record": {"act": "deploy", "signatures": []}}
        return mock.Mock(stdout=json.dumps(out) + "\n", stderr="", returncode=0)

    def test_it_runs_the_container_path_with_the_key_by_name(self):
        with mock.patch.object(ex.subprocess, "run", side_effect=self.fake_run), mock.patch("builtins.print"):
            outcome = ex.run_one(dict(TENANT_PKG_REQ))
        self.assertTrue(outcome["ok"])
        self.assertEqual(self.seen["argv"][:3], ["node", ex.SERVICE, "install-package"])
        a = self.seen["args"]
        self.assertEqual(a["tenant"], "t-0a1b2c3d4e5f")
        self.assertEqual(a["handle"], "helper.person@example.com")
        self.assertEqual(a["sha256"], "e" * 64)
        self.assertEqual(a["boot_token"], "dr-ttest1234abc")
        self.assertNotIn("am_the_single_use_value", json.dumps(a))
        self.assertNotIn("project", a)
        self.assertEqual(self.seen["token_there"], "am_the_single_use_value")
        self.assertFalse(os.path.exists(os.path.join(self.dir, "secrets", "boot-tokens", "dr-ttest1234abc.token")))

    def test_the_queue_is_asked_for_containers(self):
        asked = []
        def call(path, method="GET", body=None, timeout=30):
            asked.append(path)
            return {"requests": []} if path.startswith("/deploy-requests/queue") else {"ok": True}
        with mock.patch.object(ex, "call", call), mock.patch.object(ex, "host_report", return_value={"host": "t"}), \
                mock.patch.object(ex, "OUTCOMES", os.path.join(self.dir, "o.json")), mock.patch("builtins.print"):
            ex.one_round({"last_report": None, "reported_at": 0.0})
        self.assertTrue(any("accepts=container,tenant-package" in p for p in asked))

    def test_it_never_reaches_the_host_procedure(self):
        with mock.patch.object(ex.subprocess, "run", side_effect=self.fake_run), mock.patch("builtins.print"):
            ex.run_one(dict(TENANT_PKG_REQ))
        self.assertNotIn(ex.STEPS, self.seen["argv"])


ALONGSIDE_REQ = {"id": "dr_Atest1234abcd", "alongside": {"current": "0.4.0"},
                 "args": {"name": "presentation-reader", "harness": "opencode", "interaction": "service", "admit": [],
                          "credentials": {"image-reading": "vertex-location"},
                          "settings": {"image-reading": {"DECK_MODEL": "gemini-3.8-flash"}}},
                 "package_url": "https://api.dev.agentmesh.ai/v1/deploy-requests/dr_Atest1234abcd/package.tar.gz",
                 "package": {"name": "presentation-reader", "version": "0.3.2", "sha256": "f" * 64}}
RETIRE_REQ = {"id": "dr_Rtest1234abcd", "retire": {"version": "0.3.2"},
              "args": {"name": "presentation-reader"},
              "package": {"name": "presentation-reader", "version": "0.3.2", "sha256": "f" * 64}}


class AVersionActNeedsNoKey(unittest.TestCase):
    """A version kept alongside, or one retired (run configs phase 3): the
    executor runs the procedure of that name with the instruction approved for
    that version, places no boot token because nothing is minted, records the
    act, and asks the queue for such requests by saying it accepts versions."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-executor-ver-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for p in (mock.patch.object(ex, "DM_HOME", self.dir), mock.patch.object(ex, "DM_RECORDS", os.path.join(self.dir, "records")),
                  mock.patch.object(ex, "placement_settings", return_value={"project": "agentmesh-dev", "region": "us-south1", "registry": "gcr.io/agentmesh-dev/deploymgr", "bucket": "b"}),
                  mock.patch.object(ex.time, "sleep", lambda s: None)):
            p.start()
            self.addCleanup(p.stop)
        self.calls = []

    def fake_run(self, argv, **kw):
        if argv[1] == ex.RECORD:
            res = json.loads(kw["input"])
            return mock.Mock(stdout=json.dumps({"act": res["act"], "signatures": [{"sig": "x"}]}), stderr="", returncode=0)
        self.calls.append((list(argv), json.load(open(argv[-1]))))
        act = argv[2]
        return mock.Mock(stdout=json.dumps({"ok": True, "act": act, "version": "0.3.2"}) + "\n", stderr="", returncode=0)

    def test_alongside_runs_its_own_procedure_with_the_versions_instruction(self):
        with mock.patch.object(ex.subprocess, "run", side_effect=self.fake_run), mock.patch("builtins.print"):
            outcome = ex.run_one(dict(ALONGSIDE_REQ))
        self.assertTrue(outcome["ok"])
        argv, args = self.calls[0]
        self.assertEqual(argv[1:3], [ex.STEPS, "alongside"])
        self.assertEqual(args["sha256"], "f" * 64)
        self.assertEqual(args["settings"], {"image-reading": {"DECK_MODEL": "gemini-3.8-flash"}})
        self.assertEqual(args["region"], "us-south1")
        self.assertNotIn("boot_token", args)
        self.assertEqual(outcome["record"]["act"], "alongside")
        self.assertFalse(os.path.exists(argv[-1]), "the argfile goes when the act is done")

    def test_retire_runs_retire_version_with_the_name_and_the_version(self):
        with mock.patch.object(ex.subprocess, "run", side_effect=self.fake_run), mock.patch("builtins.print"):
            outcome = ex.run_one(dict(RETIRE_REQ))
        argv, args = self.calls[0]
        self.assertEqual(argv[1:3], [ex.STEPS, "retire-version"])
        self.assertEqual(args, {"name": "presentation-reader", "version": "0.3.2"})
        self.assertEqual(outcome["record"]["act"], "retire-version")

    def test_the_queue_is_asked_for_version_acts(self):
        asked = []
        def call(path, method="GET", body=None, timeout=30):
            asked.append(path)
            return {"requests": []} if path.startswith("/deploy-requests/queue") else {"ok": True}
        with mock.patch.object(ex, "call", call), mock.patch.object(ex, "host_report", return_value={"host": "t"}), \
                mock.patch.object(ex, "OUTCOMES", os.path.join(self.dir, "o.json")), mock.patch("builtins.print"):
            ex.one_round({"last_report": None, "reported_at": 0.0})
        self.assertTrue(any("versions" in p.split("accepts=")[-1].split(",") for p in asked if "accepts=" in p))
