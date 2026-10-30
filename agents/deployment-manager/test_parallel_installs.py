#!/usr/bin/env python3
"""The executor serves the oldest approval first, and can install side by side.

What is worth pinning (technical debt 593 and the parallel installer): the
queue is served by decided_at, oldest first, whatever order it arrives in; with
the settings at their defaults each request still runs whole, one after the
other, through the same procedure call as before; with them set, no more than
DM_INSTALL_WORKERS requests work at once on the parts that do not touch the
node, there is never more than one landing at a time, two requests for one
agent never overlap and the later one starts only after the earlier one's
outcome is posted; a batch lands behind one landing act, and when one agent in
it fails, the others still finish and every request posts its own outcome.

Nothing here reaches a network, a node or a cloud. The procedure
(deploymgr-steps.py) is stood in for at subprocess.run, answering prepare,
land, finish and the signer the way the real ones answer, and the control
plane is answered through its seam.

Run: python3 -m unittest discover -s agents/deployment-manager -p "test_*.py"
"""
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))


def load_executor():
    spec = importlib.util.spec_from_file_location("deploy_executor_parallel", os.path.join(HERE, "deploy-executor.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ex = load_executor()


def request(rid, name, decided_at):
    return {"id": rid, "decided_at": decided_at, "decided_by": "platform@agentmesh.ai",
            "args": {"name": name, "harness": "opencode", "interaction": "service", "admit": []},
            "boot_token": "am_single_use", "boot_token_name": f"dr-{rid[3:].lower()}",
            "package_url": f"https://app.agentmesh.ai/v1/deploy-requests/{rid}/package.tar.gz",
            "package": {"name": name, "version": "1.0.0", "sha256": "a" * 64}}


class Plane:
    """The control plane: a queue, and result posts that are all accepted."""

    def __init__(self, queue=()):
        self.queue = list(queue)
        self.posted = []
        self.lock = threading.Lock()

    def call(self, path, method="GET", body=None, timeout=30):
        if path == "/deploy-requests/host":
            return {"ok": True}
        if path.startswith("/deploy-requests/queue"):
            return {"requests": [dict(r) for r in self.queue]}
        if path.endswith("/result"):
            rid = path.split("/")[2]
            with self.lock:
                self.posted.append((rid, body, time.monotonic()))
                # A request whose result landed leaves the queue.
                self.queue = [r for r in self.queue if r["id"] != rid]
            return {"ok": True}
        raise AssertionError(f"unexpected call {method} {path}")

    def outcome_of(self, rid):
        return next(b for r, b, _ in self.posted if r == rid)

    def posted_at(self, rid):
        return next(t for r, _, t in self.posted if r == rid)


class Procedure:
    """deploymgr-steps.py and deploymgr-record.py, stood in. Each act takes a
    little time, so overlaps can be seen; every call is written down with when
    it started and ended."""

    def __init__(self, seconds=0.05, land_seconds=0.05, fail_finish=(), fail_prepare=()):
        self.seconds, self.land_seconds = seconds, land_seconds
        self.fail_finish, self.fail_prepare = set(fail_finish), set(fail_prepare)
        self.lock = threading.Lock()
        self.calls = []          # (verb, names, start, end)
        self.active = {"work": 0, "land": 0}
        self.most = {"work": 0, "land": 0}

    @staticmethod
    def name_of(path):
        with open(path) as f:
            return json.load(f)["name"]

    def run(self, argv, **kw):
        if argv[1] == ex.RECORD:
            res = json.loads(kw["input"])
            act = res.get("act") if res.get("ok") else "refuse"
            return mock.Mock(stdout=json.dumps({"act": act, "signatures": [{"sig": "x"}]}), stderr="", returncode=0)
        assert argv[1] == ex.STEPS, argv
        verb = argv[2]
        kind = "land" if verb == "land" else "work"
        if verb == "prepare":
            names = [self.name_of(argv[4])]
        elif verb in ("land", "finish"):
            names = [os.path.basename(s)[:-len(".state.json")] for s in argv[3:]]
        else:
            names = [self.name_of(argv[3])]
        with self.lock:
            self.active[kind] += 1
            self.most[kind] = max(self.most[kind], self.active[kind])
        start = time.monotonic()
        time.sleep(self.land_seconds if kind == "land" else self.seconds)
        with self.lock:
            self.active[kind] -= 1
            self.calls.append((verb, names, start, time.monotonic()))
        name = names[0]
        if verb == "prepare":
            if name in self.fail_prepare:
                answer = {"ok": False, "step": "fetch", "error": "could not fetch the package", "state": "nothing created"}
            else:
                answer = {"ok": True, "act": "prepare", "phase": "prepared", "name": name,
                          "state": f"/opt/fleet/deploymgr-states/{name}.state.json"}
        elif verb == "land":
            answer = {"ok": True, "act": "land", "agents": {n: "landed" for n in names}}
        elif verb == "finish" and name in self.fail_finish:
            answer = {"ok": False, "step": "watch", "rolled_back": True, "error": f"{name} did not answer a health probe",
                      "state": f"rolled back: {name} was paused", "act": "deploy", "name": name}
        else:
            answer = {"ok": True, "act": "deploy", "name": name, "handle": f"{name}.platform@agentmesh.ai"}
        return mock.Mock(stdout=json.dumps(answer) + "\n", stderr="", returncode=0)

    def started(self, verb):
        return [(names, start) for v, names, start, _ in sorted(self.calls, key=lambda c: c[2]) if v == verb]


class Harness(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-parallel-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for p in (mock.patch.object(ex, "OUTCOMES", os.path.join(self.dir, "executor-outcomes.json")),
                  mock.patch.object(ex, "DM_HOME", self.dir),
                  mock.patch.object(ex, "DM_TOKENS", os.path.join(self.dir, "secrets", "boot-tokens")),
                  mock.patch.object(ex, "DM_RECORDS", os.path.join(self.dir, "records")),
                  mock.patch.object(ex, "FLEET", self.dir),
                  mock.patch.object(ex, "placement_settings", return_value={}),
                  mock.patch.object(ex, "audit_refusal", return_value=None),
                  mock.patch.object(ex, "host_report", return_value={"host": "t"}),
                  mock.patch.object(ex, "conformance_wanted", return_value=False),
                  mock.patch("builtins.print")):
            p.start()
            self.addCleanup(p.stop)

    def run_all(self, procedure, plane, requests, **settings):
        """Submit the requests in queue order and wait for every outcome."""
        installs = ex.Installs(**settings)
        with mock.patch.object(ex.subprocess, "run", side_effect=procedure.run), mock.patch.object(ex, "call", plane.call):
            for r in ex.oldest_first(requests):
                installs.submit(r)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                with installs.cv:
                    if not installs.running:
                        break
                time.sleep(0.01)
        self.assertFalse(installs.running, "every request came to an outcome")
        return installs


class TheOldestApprovalIsServedFirst(Harness):

    def test_the_queue_is_sorted_by_decided_at_whatever_order_it_came_in(self):
        q = [request("dr_C", "c", "2026-10-29T10:00:03.000Z"), request("dr_A", "a", "2026-10-29T10:00:01.000Z"),
             request("dr_X", "x", None), request("dr_B", "b", "2026-10-29T10:00:02Z")]
        self.assertEqual([r["id"] for r in ex.oldest_first(q)], ["dr_A", "dr_B", "dr_C", "dr_X"],
                         "oldest first; one with no decided_at goes last")

    def test_a_round_runs_them_oldest_first(self):
        plane = Plane([request("dr_new", "n", "2026-10-29T12:00:00Z"), request("dr_old", "o", "2026-10-29T09:00:00Z")])
        ran = []
        with mock.patch.object(ex, "call", plane.call), \
                mock.patch.object(ex, "run_one", lambda r: ran.append(r["id"]) or {"ok": True, "result": {"ok": True}}):
            ex.one_round({"last_report": None, "reported_at": 0.0})
        self.assertEqual(ran, ["dr_old", "dr_new"])

    def test_side_by_side_they_also_start_oldest_first(self):
        proc, plane = Procedure(), Plane()
        reqs = [request(f"dr_{i}", f"agent-{i}", f"2026-10-29T10:00:0{9 - i}Z") for i in range(5)]
        self.run_all(proc, plane, reqs, workers=1, batch=False)
        self.assertEqual([n[0] for n, _ in proc.started("prepare")], [f"agent-{i}" for i in (4, 3, 2, 1, 0)])


class TheDefaultIsTodaysSerialRun(Harness):

    def test_with_nothing_set_it_is_serial(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("DM_INSTALL_WORKERS", "DM_LAND_BATCH", "DM_LAND_BATCH_SECONDS", "DM_LAND_BATCH_MOST"):
                os.environ.pop(k, None)
            fresh = load_executor()
        self.assertEqual(fresh.INSTALL_WORKERS, 1)
        self.assertFalse(fresh.LAND_BATCH)
        self.assertTrue(fresh.serial_mode())

    def test_a_serial_round_runs_the_whole_procedure_once_per_request_and_nothing_else(self):
        proc = Procedure(seconds=0)
        plane = Plane([request("dr_B", "b", "2026-10-29T10:00:02Z"), request("dr_A", "a", "2026-10-29T10:00:01Z")])
        seen = []

        def run(argv, **kw):
            seen.append(list(argv))
            return proc.run(argv, **kw)
        state = {"last_report": None, "reported_at": 0.0}
        with mock.patch.object(ex.subprocess, "run", side_effect=run), mock.patch.object(ex, "call", plane.call):
            self.assertEqual(ex.one_round(state), 1)
        steps_calls = [a for a in seen if a[1] == ex.STEPS]
        # Exactly the call the executor has always made: `deploy <argfile>`,
        # whole, one request after the other. No prepare, land or finish.
        self.assertEqual([a[:3] for a in steps_calls], [["python3", ex.STEPS, "deploy"]] * 2)
        self.assertEqual([os.path.basename(a[3]) for a in steps_calls], ["dr-a.json", "dr-b.json"])
        self.assertNotIn("installs", state, "no side-by-side machinery is made")
        self.assertEqual([r for r, _, _ in plane.posted], ["dr_A", "dr_B"])
        self.assertTrue(all(b["record"]["signatures"] for _, b, _ in plane.posted), "each outcome carries its signed record")
        self.assertFalse(os.listdir(ex.DM_TOKENS), "each boot token is removed after its run")


class NoMoreThanTheWorkersAtOnceAndOneLandingAtATime(Harness):

    def test_eight_requests_on_three_workers(self):
        proc, plane = Procedure(seconds=0.08, land_seconds=0.05), Plane()
        reqs = [request(f"dr_{i}", f"agent-{i}", f"2026-10-29T10:00:{i:02d}Z") for i in range(8)]
        self.run_all(proc, plane, reqs, workers=3, batch=True, batch_seconds=0.2, batch_most=3)
        self.assertEqual(proc.most["work"], 3, "the parts that do not touch the node run three at a time, no more")
        self.assertEqual(proc.most["land"], 1, "landings never overlap")
        self.assertEqual(len(plane.posted), 8)
        self.assertTrue(all(b["ok"] for _, b, _ in plane.posted))
        landed = [n for n, _ in proc.started("land")]
        self.assertTrue(all(len(n) <= 3 for n in landed), "no landing is bigger than DM_LAND_BATCH_MOST")
        self.assertEqual(sorted(sum(landed, [])), sorted(f"agent-{i}" for i in range(8)), "each agent lands once")


class OneRequestPerAgentAtATime(Harness):

    def test_a_later_request_for_an_agent_waits_for_the_earlier_ones_outcome(self):
        proc, plane = Procedure(seconds=0.05), Plane()
        reqs = [request("dr_A1", "reader", "2026-10-29T10:00:01Z"), request("dr_B", "writer", "2026-10-29T10:00:02Z"),
                request("dr_A2", "reader", "2026-10-29T10:00:03Z")]
        self.run_all(proc, plane, reqs, workers=3, batch=False)
        prepares = proc.started("prepare")
        reader_second = [t for n, t in prepares if n == ["reader"]][1]
        self.assertGreaterEqual(reader_second, plane.posted_at("dr_A1"),
                                "the second reader request starts only after the first one's outcome is posted")
        writer = [t for n, t in prepares if n == ["writer"]][0]
        self.assertLess(writer, plane.posted_at("dr_A1"), "another agent's request does not wait")
        # The two reader requests are never in one landing.
        self.assertFalse(any(n.count("reader") > 1 for n, _ in proc.started("land")))
        self.assertEqual([r for r, _, _ in plane.posted if r.startswith("dr_A")], ["dr_A1", "dr_A2"])


class ABatchWithOneFailure(Harness):

    def test_three_land_behind_one_landing_and_each_posts_its_own_outcome(self):
        proc, plane = Procedure(seconds=0.02, fail_finish={"agent-1"}), Plane()
        reqs = [request(f"dr_{i}", f"agent-{i}", f"2026-10-29T10:00:0{i}Z") for i in range(3)]
        self.run_all(proc, plane, reqs, workers=3, batch=True, batch_seconds=5, batch_most=3)
        self.assertEqual([sorted(n) for n, _ in proc.started("land")], [["agent-0", "agent-1", "agent-2"]],
                         "the three ready installs land together, once")
        self.assertEqual(sorted(n[0] for n, _ in proc.started("finish")), ["agent-0", "agent-1", "agent-2"])
        failed = plane.outcome_of("dr_1")
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["result"]["step"], "watch")
        self.assertTrue(failed["result"]["rolled_back"])
        self.assertEqual(failed["record"]["act"], "refuse", "the refusal is signed like any other")
        for rid in ("dr_0", "dr_2"):
            self.assertTrue(plane.outcome_of(rid)["ok"], f"{rid} lands although agent-1 failed")
            self.assertEqual(plane.outcome_of(rid)["record"]["act"], "deploy")
        with open(ex.OUTCOMES) as f:
            self.assertEqual(json.load(f)["dr_1"]["outcome"], failed, "kept before it was posted")

    def test_a_refusal_before_landing_is_that_requests_answer_and_the_rest_land(self):
        proc, plane = Procedure(seconds=0.02, fail_prepare={"agent-1"}), Plane()
        reqs = [request(f"dr_{i}", f"agent-{i}", f"2026-10-29T10:00:0{i}Z") for i in range(3)]
        self.run_all(proc, plane, reqs, workers=3, batch=True, batch_seconds=5, batch_most=3)
        self.assertEqual([sorted(n) for n, _ in proc.started("land")], [["agent-0", "agent-2"]],
                         "the batch does not wait out its time for a request that was refused")
        self.assertEqual(plane.outcome_of("dr_1")["result"]["step"], "fetch")
        self.assertTrue(plane.outcome_of("dr_0")["ok"] and plane.outcome_of("dr_2")["ok"])

    def test_a_landing_refused_whole_is_every_requests_answer(self):
        proc, plane = Procedure(seconds=0.01), Plane()
        refusal = {"ok": False, "step": "lock", "error": "another act held the node lock", "state": "nothing created"}
        original = proc.run

        def run(argv, **kw):
            if argv[1] == ex.STEPS and argv[2] == "land":
                return mock.Mock(stdout=json.dumps(refusal) + "\n", stderr="", returncode=1)
            return original(argv, **kw)
        proc.run = run
        reqs = [request(f"dr_{i}", f"agent-{i}", f"2026-10-29T10:00:0{i}Z") for i in range(2)]
        self.run_all(proc, plane, reqs, workers=2, batch=True, batch_seconds=5, batch_most=2)
        for rid in ("dr_0", "dr_1"):
            self.assertEqual(plane.outcome_of(rid)["result"]["step"], "lock")
        self.assertEqual(proc.started("finish"), [], "nothing was placed, so nothing is finished")


class ARoundSideBySide(Harness):

    def test_a_request_being_installed_is_not_taken_again_and_a_kept_one_is_posted_not_run(self):
        proc = Procedure(seconds=0.3)
        ex.save_outcomes({"dr_K": {"at": time.time(), "outcome": {"ok": True, "result": {"ok": True, "act": "deploy"}}}})
        plane = Plane([request("dr_A", "a", "2026-10-29T10:00:01Z"), request("dr_K", "k", "2026-10-29T10:00:00Z")])
        state = {"last_report": None, "reported_at": 0.0}
        with mock.patch.object(ex.subprocess, "run", side_effect=proc.run), mock.patch.object(ex, "call", plane.call), \
                mock.patch.object(ex, "INSTALL_WORKERS", 2), mock.patch.object(ex, "PROGRESS_WAIT", 0.05):
            ex.one_round(state)
            ex.one_round(state)  # dr_A is still being installed and stays queued
            deadline = time.monotonic() + 10
            while state["installs"].running and time.monotonic() < deadline:
                time.sleep(0.01)
        self.assertEqual([n for n, _ in proc.started("prepare")], [["a"]], "dr_A ran once")
        self.assertNotIn(["k"], [n for n, _ in proc.started("prepare")], "the kept outcome is never run again")
        self.assertEqual(sorted(r for r, _, _ in plane.posted), ["dr_A", "dr_K"])


if __name__ == "__main__":
    unittest.main()
