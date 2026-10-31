#!/usr/bin/env python3
"""A new agent's work is placed while its node is watched.

What is worth pinning: the work's placement (the image, the job and its first
message) starts in a process of its own once the smoke check has passed, and
only for a new agent whose work goes to Cloud Run on our own project, with the
switch on; the act then waits for that placement's answer and never places the
work a second time; a placement that refuses is the act's refusal, at the step
it stopped and with the agent's row named, as when it ran after the watch; an
agent the watch takes back out has the work it was given taken down again and
its runtime record withdrawn; and the wait is told when the placement has ended
(a lock it holds for its whole life) rather than asking again and again, and
stops a placement that outlives its limit.

Nothing here builds an image or calls a cloud: the placement is stood in, and
the one real process started is a few lines of Python holding a lock.

Run: python3 -m unittest discover -s agents/deployment-manager -p "test_*.py"
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="dm-work-test-")
os.environ.setdefault("DM_FLEET", TMP)
os.environ.setdefault("DM_HOME", TMP)
import steps  # noqa: E402
from test_landing import Landing, Node, emitted, DIGEST  # noqa: E402


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


ON = {"DM_WORK_DURING_WATCH": "on"}
WORK = {"where": "cloud-run", "job": "alpha-worker", "image_digest": DIGEST, "runtime": {"recorded": True},
        "model_placed": {"model": "m", "variable": "AGENT_MODEL"},
        "state": "the job exists and one message went through it"}


class InStates(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-work-", dir=TMP)
        p = mock.patch.object(steps, "STATES", os.path.join(self.dir, "states"))
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(steps.CURRENT.update, {"entry": None, "on_fail": None})


class WhenTheWorkStartsDuringTheWatch(InStates):

    def ctx(self, **kw):
        return {"act": "deploy", "name": "alpha", "placement": "cloud-run", "args": {"name": "alpha"}, **kw}

    def test_only_a_new_agent_in_cloud_run_on_our_project_whose_smoke_check_passed(self):
        started = []
        with mock.patch.object(steps, "start_work", lambda n, a: started.append(n) or {"stem": "s"}):
            with mock.patch.dict(os.environ, ON):
                self.assertEqual(steps.start_work_if_wanted(self.ctx(), {"passed": True}, arm=False), {"stem": "s"})
                self.assertIsNone(steps.start_work_if_wanted(self.ctx(), {"passed": False}),
                                  "nothing is placed early for an agent that did not answer")
                self.assertIsNone(steps.start_work_if_wanted(self.ctx(placement="host"), {"passed": True}))
                self.assertIsNone(steps.start_work_if_wanted(self.ctx(act="update"), {"passed": True}))
                self.assertIsNone(steps.start_work_if_wanted(self.ctx(args={"name": "alpha", "cloud": {"grant": 1}}),
                                                             {"passed": True}),
                                  "a customer's project lists its calls from this process; it runs after the watch")
            with mock.patch.dict(os.environ, {"DM_WORK_DURING_WATCH": "off"}):
                self.assertIsNone(steps.start_work_if_wanted(self.ctx(), {"passed": True}))
        self.assertEqual(started, ["alpha"])

    def test_on_is_the_default_and_any_other_word_than_on_is_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DM_WORK_DURING_WATCH", None)
            self.assertTrue(steps.work_during_watch_on())
        for v in ("off", "0", "no", "false"):
            with mock.patch.dict(os.environ, {"DM_WORK_DURING_WATCH": v}):
                self.assertFalse(steps.work_during_watch_on(), v)

    def test_a_whole_deploy_arms_the_take_down_and_a_landing_leaves_it_to_each_finish(self):
        with mock.patch.object(steps, "start_work", lambda n, a: {"stem": "s"}), mock.patch.dict(os.environ, ON):
            steps.start_work_if_wanted(self.ctx(), {"passed": True})
            self.assertIsNotNone(steps.CURRENT.get("on_fail"))
            steps.CURRENT["on_fail"] = None
            steps.start_work_if_wanted(self.ctx(), {"passed": True}, arm=False)
            self.assertIsNone(steps.CURRENT.get("on_fail"))

    def test_the_process_is_this_procedure_s_work_verb_holding_the_lock_and_never_the_node_s(self):
        seen = {}

        class Popen:
            def __init__(self, argv, **kw):
                seen.update(argv=argv, **kw)
                self.pid = 4242
        with mock.patch("steps.subprocess.Popen", Popen):
            handle = steps.start_work("alpha", {"name": "alpha", "package_url": "u"})
        stem = handle["stem"]
        self.assertTrue(stem.startswith(steps.works_dir() + os.sep))
        self.assertEqual(seen["argv"][1:], [os.path.abspath(steps.__file__), "work", f"{stem}.args.json"])
        self.assertTrue(seen["start_new_session"] and seen["close_fds"])
        self.assertEqual(len(seen["pass_fds"]), 1, "only the placement's own lock goes down, never the node lock")
        with open(f"{stem}.args.json") as f:
            self.assertEqual(json.load(f), {"name": "alpha", "package_url": "u"})
        self.assertEqual(os.stat(f"{stem}.args.json").st_mode & 0o777, 0o600)
        self.assertEqual(handle["pid"], 4242)


class TheWorkVerb(InStates):

    def test_it_places_the_work_and_prints_what_it_placed(self):
        os.makedirs(steps.works_dir(), exist_ok=True)
        path = os.path.join(steps.works_dir(), "alpha-1-2.args.json")
        steps.write_text(path, json.dumps({"name": "alpha"}), 0o600)
        asked = []
        with mock.patch.object(steps, "place_in_cloud_run", lambda a: asked.append(a) or WORK):
            doc = emitted(self, steps.work, path)
        self.assertEqual(doc, {"ok": True, "act": "work", "work": WORK})
        self.assertEqual(asked, [{"name": "alpha"}])
        self.assertFalse(os.path.exists(path))

    def test_it_refuses_a_file_it_did_not_write(self):
        doc = emitted(self, steps.work, os.path.join(self.dir, "elsewhere.args.json"))
        self.assertEqual((doc["ok"], doc["step"]), (False, "validate"))


class TheWaitIsTold(InStates):
    """The placement holds its lock until it ends; the wait takes the lock."""

    def child(self, seconds, answer):
        os.makedirs(steps.works_dir(), exist_ok=True)
        stem = os.path.join(steps.works_dir(), f"alpha-{os.getpid()}-{time.time_ns()}")
        fd = os.open(f"{stem}.lock", os.O_RDWR | os.O_CREAT, 0o600)
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX)
        code = f"import time,sys; time.sleep({seconds})"
        if answer is not None:
            code += f"; sys.stdout.write({json.dumps(json.dumps(answer))} + '\\n')"
        with open(f"{stem}.out", "w") as o, open(f"{stem}.err", "w") as e:
            p = subprocess.Popen([sys.executable, "-c", code], stdout=o, stderr=e, start_new_session=True,
                                 pass_fds=(fd,))
        os.close(fd)
        self.addCleanup(lambda: p.poll() is None and p.kill())
        return {"stem": stem, "pid": p.pid}, p

    def test_the_answer_comes_when_the_placement_ends(self):
        handle, p = self.child(0.5, {"ok": True, "act": "work", "work": WORK})
        t0 = time.time()
        got = steps.wait_work(handle, seconds=30)
        self.assertEqual(got, {"ok": True, "act": "work", "work": WORK})
        self.assertLess(time.time() - t0, 10)
        self.assertFalse(any(os.path.exists(handle["stem"] + x) for x in (".out", ".err", ".lock")),
                         "the placement's files go")

    def test_a_placement_past_its_limit_is_stopped_and_refused(self):
        handle, p = self.child(60, {"ok": True})
        got = steps.wait_work(handle, seconds=1)
        self.assertEqual((got["ok"], got["step"]), (False, "work"))
        self.assertIn("did not finish within 1 seconds", got["error"])
        p.wait(timeout=10)
        self.assertIsNotNone(p.returncode, "the placement was stopped")

    def test_a_placement_that_said_nothing_is_a_refusal(self):
        handle, _ = self.child(0, None)
        got = steps.wait_work(handle, seconds=30)
        self.assertEqual((got["ok"], got["step"]), (False, "work"))

    def test_a_handle_outside_the_work_folder_is_not_waited_on(self):
        got = steps.wait_work({"stem": "/etc/passwd"}, seconds=1)
        self.assertFalse(got["ok"])


class ARolledBackAgentHasNoWork(InStates):

    def test_what_the_placement_made_is_taken_down_and_the_runtime_record_withdrawn(self):
        steps.save_json_list(steps.CONTAINERS, [{"name": "alpha", "job": "alpha-worker", "binding": "gs://b/alpha"}])
        downs, forgot = [], []

        def take_down(name, row):
            downs.append((name, row["job"]))
            return ["job folders of messages already answered remain on the mount; they are the record of work",
                    "the records directory at gs://b/x was not removed; it is what this agent wrote"]
        with mock.patch.object(steps, "wait_work", lambda h: {"ok": True, "act": "work", "work": WORK}), \
                mock.patch.object(steps, "take_down_container", take_down), \
                mock.patch.object(steps, "agent_identity", lambda n: {"key": "UK"}), \
                mock.patch.object(steps, "forget_runtime", lambda k: forgot.append(k)):
            said = steps.take_down_work("alpha", {"stem": "s"})
        self.assertEqual(downs, [("alpha", "alpha-worker")])
        self.assertEqual(forgot, ["UK"])
        self.assertEqual(said, "the job alpha-worker, placed while the node was watched, was taken down again")

    def test_what_could_not_be_taken_down_is_named(self):
        steps.save_json_list(steps.CONTAINERS, [{"name": "alpha", "job": "alpha-worker"}])
        with mock.patch.object(steps, "wait_work", lambda h: {"ok": True, "work": WORK}), \
                mock.patch.object(steps, "take_down_container", lambda n, r: ["cloud run job alpha-worker not deleted: 403"]), \
                mock.patch.object(steps, "agent_identity", lambda n: {"key": "UK"}), \
                mock.patch.object(steps, "forget_runtime", lambda k: None):
            said = steps.take_down_work("alpha", {"stem": "s"})
        self.assertTrue(said.endswith("except: cloud run job alpha-worker not deleted: 403"), said)

    def test_a_placement_that_stopped_takes_nothing_down_and_says_where_it_stopped(self):
        with mock.patch.object(steps, "wait_work", lambda h: {"ok": False, "step": "image", "error": "build b ended FAILURE"}), \
                mock.patch.object(steps, "take_down_container", lambda n, r: self.fail("nothing to take down")):
            said = steps.take_down_work("alpha", {"stem": "s"})
        self.assertIn("stopped at image: build b ended FAILURE", said)


class ALandingPlacesTheWorkDuringTheWatch(Landing):
    """test_landing's landing, with the work begun during the watch."""

    def setUp(self):
        super().setUp()
        p = mock.patch.dict(os.environ, ON)
        p.start()
        self.addCleanup(p.stop)
        self.started, self.downs = [], []
        self.answers = {}
        for q in (mock.patch.object(steps, "start_work", self.start_work),
                  mock.patch.object(steps, "wait_work", self.wait_work),
                  mock.patch.object(steps, "take_down_work", self.take_down_work)):
            q.start()
            self.addCleanup(q.stop)
        self.addCleanup(steps.CURRENT.update, {"on_fail": None})

    def start_work(self, name, args):
        self.started.append(name)
        return {"stem": os.path.join(steps.works_dir(), name), "pid": 1}

    def wait_work(self, handle, seconds=None):
        name = os.path.basename(handle["stem"])
        return self.answers.get(name) or {"ok": True, "act": "work", "work": {**WORK, "job": f"{name}-worker"}}

    def take_down_work(self, name, handle):
        self.downs.append(name)
        return f"the job {name}-worker, placed while the node was watched, was taken down again"

    def test_each_agent_s_work_begins_before_the_watch_and_its_finish_does_not_place_it_again(self):
        node = Node(self.root)
        seen_at_watch = []
        run = node.run

        def watching(cmd, *a, **k):
            if list(cmd[:3]) == ["node", steps.GUARD, "watch"]:
                seen_at_watch.append(list(self.started))
            return run(cmd, *a, **k)
        node.run = watching
        paths = self.land(node, "alpha", "bravo")
        self.assertEqual(seen_at_watch[0], ["alpha", "bravo"], "both placements were under way when the watch began")
        for p, name in zip(paths, ("alpha", "bravo")):
            doc = emitted(self, steps.finish, p)
            self.assertTrue(doc["ok"], doc)
            self.assertEqual(doc["work"]["job"], f"{name}-worker")
            self.assertTrue(doc["watch"]["ok"])
        self.assertEqual(self.clouds, [], "the work was placed once, during the watch")

    def test_an_agent_the_watch_takes_back_out_has_its_work_taken_down(self):
        node = Node(self.root, silent={"bravo"})
        paths = self.land(node, "alpha", "bravo")
        ok, refused = (emitted(self, steps.finish, p) for p in paths)
        self.assertTrue(ok["ok"])
        self.assertEqual((refused["step"], refused["rolled_back"]), ("watch", True))
        self.assertTrue(refused["state"].startswith("the job bravo-worker, placed while the node was watched, "
                                                    "was taken down again; rolled back: bravo was paused"),
                        refused["state"])
        self.assertIn("run remove bravo", refused["state"])
        self.assertEqual(self.downs, ["bravo"])

    def test_a_placement_that_refused_is_the_act_s_refusal_with_the_row_named(self):
        self.answers["alpha"] = {"ok": False, "step": "image", "error": "build b ended FAILURE",
                                 "state": "nothing created"}
        node = Node(self.root)
        (path,) = self.land(node, "alpha")
        doc = emitted(self, steps.finish, path)
        self.assertEqual((doc["ok"], doc["step"], doc["error"]), (False, "image", "build b ended FAILURE"))
        self.assertNotIn("nothing created", doc["state"])
        self.assertIn("run remove alpha", doc["state"])
        row = next(a for a in steps.load_list() if a["name"] == "alpha")
        self.assertEqual(row["state"], "failed at image")
        self.assertEqual(self.downs, [], "a refusal from the placement itself is not taken down twice")

    def test_an_agent_whose_smoke_check_failed_gets_its_work_after_the_watch(self):
        self.smoke_fails = {"alpha"}
        node = Node(self.root)
        (path,) = self.land(node, "alpha")
        self.assertEqual(self.started, [])
        emitted(self, steps.finish, path)
        self.assertEqual(self.clouds, ["alpha"])


class AWholeDeployPlacesTheWorkDuringTheWatch(InStates):

    def setUp(self):
        super().setUp()
        self.root = os.path.join(self.dir, "node-platform")
        os.makedirs(os.path.join(self.root, "agents", "alpha"), exist_ok=True)
        self.holder = {"proc": "mesh-node-platform", "log": f"{steps.LOGS}/mesh-node-platform.log",
                       "root": self.root, "user": "mesh-node"}
        self.ctx = {"act": "deploy", "name": "alpha", "holder": self.holder, "pkg_name": "alpha",
                    "pkg_version": "1.0.0", "agent_key": "UK", "handle": "alpha.platform@agentmesh.ai",
                    "capacity": {}, "placement": "cloud-run", "args": {"name": "alpha"}}
        self.order, self.finished = [], []
        for q in (mock.patch.dict(os.environ, ON),
                  mock.patch.object(steps, "GUARD", "/opt/fleet/deploymgr-guard.mjs"),
                  mock.patch.object(steps, "deploy_prepare", lambda a: self.ctx),
                  mock.patch.object(steps, "deploy_place", lambda c: c),
                  mock.patch.object(steps, "start_processes", lambda n: {"started": ["mesh-node-platform"]}),
                  mock.patch.object(steps, "check_served", lambda n, p: {"passed": True}),
                  mock.patch.object(steps, "start_work", lambda n, a: self.order.append("work") or {"stem": "s"}),
                  mock.patch.object(steps, "deploy_finish", lambda c: self.finished.append(dict(c)))):
            q.start()
            self.addCleanup(q.stop)

    def test_the_work_begins_before_the_watch_and_the_finish_is_handed_it(self):
        node = Node(self.root)
        run = node.run

        def watching(cmd, *a, **k):
            if list(cmd[:3]) == ["node", steps.GUARD, "watch"]:
                self.order.append("watch")
            return run(cmd, *a, **k)
        with mock.patch("steps.subprocess.run", watching):
            steps.deploy("/x")
        self.assertEqual(self.order, ["work", "watch"])
        self.assertEqual(self.finished[0]["work"], {"stem": "s"})

    def test_a_failed_watch_takes_the_work_down_before_it_refuses(self):
        node = Node(self.root, silent={"alpha"})
        downs = []
        with mock.patch("steps.subprocess.run", node.run), \
                mock.patch.object(steps, "recovered", lambda h, restart=True: {"ok": True}), \
                mock.patch.object(steps, "take_down_work", lambda n, h: downs.append((n, h)) or "the job alpha-worker was taken down again"):
            doc = emitted(self, steps.deploy, "/x")
        self.assertEqual((doc["ok"], doc["step"], doc["rolled_back"]), (False, "watch", True))
        self.assertEqual(downs, [("alpha", {"stem": "s"})])
        self.assertTrue(doc["state"].startswith("the job alpha-worker was taken down again; rolled back:"), doc["state"])
        self.assertEqual(self.finished, [])


if __name__ == "__main__":
    unittest.main()
