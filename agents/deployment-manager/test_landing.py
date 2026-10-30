#!/usr/bin/env python3
"""A batched landing: several agents behind one start of their node.

What is worth pinning: the node is started once for every agent in a landing,
not once each; the first agent gets the full watch and every other one a short
probe, all counted from the mark taken before that one start; an agent whose
probe fails is taken back out the way it would be alone (paused on its node,
the node recovered) while the others land; an update whose smoke check fails
gets its old version back before anything is watched; a placement refused for
one agent leaves the others to land, and each is told how many new agents were
placed on its node before it; and every agent's finish prints the one answer
its act always printed, with the same members, success or refusal.

Nothing here starts a process, creates a user or calls a cloud. pm2 and the
install guard are answered at subprocess.run, the smoke check and the Cloud
Run half are stood in, and a node is a folder.

Run: python3 -m unittest discover -s agents/deployment-manager -p "test_*.py"
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="dm-landing-test-")
os.environ.setdefault("DM_FLEET", TMP)
os.environ.setdefault("DM_HOME", TMP)
import steps  # noqa: E402

DIGEST = "sha256:" + "cd" * 32


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def emitted(case, fn, *args):
    """The one JSON object an act prints before it exits."""
    buf = io.StringIO()
    steps.CURRENT["entry"] = None
    steps.CURRENT["cloud"] = None
    with contextlib.redirect_stdout(buf), case.assertRaises(SystemExit):
        fn(*args)
    return json.loads(buf.getvalue())


class Node:
    """pm2 and the install guard as one node answers them. `silent` names the
    agents that do not answer their probe."""

    def __init__(self, root, silent=()):
        self.root, self.silent, self.seen = root, set(silent), []
        self.marks = 0

    def run(self, cmd, *a, **k):
        cmd = list(cmd)
        self.seen.append(cmd)
        answer = ""
        if cmd[0] == "node" and cmd[2] == "mark":
            self.marks += 1
            answer = json.dumps({"ok": True, "act": "mark", "restarts": 4 + self.marks, "log_offset": self.marks})
        elif cmd[0] == "node" and cmd[2] == "watch":
            agent = cmd[cmd.index("--agent") + 1]
            answer = json.dumps({"ok": False, "act": "watch", "reason": f"{agent} did not answer a health probe"}
                                if agent in self.silent else {"ok": True, "act": "watch", "probes": {agent: "answered"}})
        elif cmd[0] == "su" and "agent pause" in cmd[-1]:
            name = cmd[-1].rsplit(" ", 1)[1]
            with open(os.path.join(self.root, "agents", name, "paused.json"), "w") as f:
                f.write('{"by": "mesh-node"}\n')
        return subprocess.CompletedProcess(cmd, 0, answer + "\n" if answer else "", "")

    def calls(self, *head):
        return [c for c in self.seen if c[:len(head)] == list(head)]

    def watches(self):
        return [(c[c.index("--agent") + 1], c[c.index("--seconds") + 1], c[c.index("--log-from") + 1])
                for c in self.seen if c[:3] == ["node", steps.GUARD, "watch"]]


class Landing(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-land-", dir=TMP)
        self.root = os.path.join(self.dir, "node-platform")
        self.holder = {"proc": "mesh-node-platform", "log": f"{steps.LOGS}/mesh-node-platform.log",
                       "root": self.root, "user": "mesh-node"}
        list_before = steps.load_list()
        self.addCleanup(steps.save_list, list_before)
        self.patches = [mock.patch.object(steps, "STATES", os.path.join(self.dir, "states")),
                        mock.patch.object(steps, "GUARD", "/opt/fleet/deploymgr-guard.mjs"),
                        mock.patch.object(steps, "agent_procs",
                                          lambda n: (["mesh-node-platform"], True, "fleet-supervisor is online")),
                        mock.patch.object(steps, "start_and_smoke", self.smoke),
                        mock.patch.object(steps, "place_in_cloud_run", self.cloud),
                        mock.patch.object(steps, "publish_runtime_for", lambda n: {"recorded": True}),
                        mock.patch.object(steps, "write_ledger", lambda *a, **k: {"files": []}),
                        mock.patch.object(steps, "restore", self.restore)]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        self.smoke_fails, self.restored, self.clouds = set(), [], []

    def smoke(self, name, ask_model=True):
        ok = name not in self.smoke_fails
        return {"passed": ok, "listening": ok, "probe_reply": "I write" if ok else ""}

    def cloud(self, args):
        self.clouds.append(args["name"])
        return {"where": "cloud-run", "job": f"{args['name']}-worker", "image_digest": DIGEST,
                "runtime": {"recorded": True}, "model_placed": {"model": "m", "variable": "AGENT_MODEL"},
                "state": "the job exists and one message went through it"}

    def restore(self, name, home, doc, root, pkg_name):
        self.restored.append(name)

    def placed(self, name, act="deploy"):
        """A state as a placement leaves it."""
        os.makedirs(os.path.join(self.root, "agents", name), exist_ok=True)
        staging = os.path.join(self.dir, f"dm-{name}-pkg")
        os.makedirs(staging, exist_ok=True)
        names = {"credentials": [], "settings": [], "ceilings": {}}
        entry = {"name": name, "package": name, "version": "0.9.0" if act == "update" else "1.0.0",
                 "sha256": "ef" * 32, "harness": "opencode", "interaction": "service", "state": "running",
                 "node_root": self.root, "node_proc": "mesh-node-platform", "node_user": "mesh-node"}
        ctx = {"act": act, "phase": "placed", "name": name, "args": {"name": name}, "harness": "opencode",
               "url": "https://agentcatalog.com/x/package.tar.gz", "model": "google/gemini-3.8-flash",
               "stack_bindings": [], "staging": staging, "pkg_dir": staging, "sha256": "ab" * 32,
               "pkg_name": name, "pkg_version": "1.0.0", "holder": self.holder, "capacity": {"checks": []},
               "names": names, "entry": entry, "dependencies": [], "agent_key": "U" + "K" * 55,
               "descriptor": {}, "price": None, "trial_allowance": None}
        if act == "deploy":
            ctx.update(interaction="service", admit=[], environment="", a2a=False, placement="cloud-run",
                       jobs_at_once=None, token_file="", handle=f"{name}.platform@agentmesh.ai",
                       key_custody={"minted": "generated", "held_by": ["UK", "root@agent-fleet"]},
                       secret=None, ledger={"files": []})
        else:
            ctx.update(home=os.path.join(self.dir, "home", name), old_ledger={"files": [], "outside": []},
                       prev=os.path.join(self.dir, "prev", name), reinstall=False, in_container=None,
                       old_desc={}, drift_before=[], placed=[], env_files=[], links=[])
        steps.replace_row(entry)
        path = os.path.join(steps.STATES, f"dr-{name}.json")
        steps.write_state(path, ctx)
        return path, ctx

    def land(self, node, *specs):
        group = [self.placed(*s) if isinstance(s, tuple) else self.placed(s) for s in specs]
        with mock.patch("steps.subprocess.run", node.run):
            steps.land_on_node(group)
        return [p for p, _ in group]


class OneStartOfTheNodeForTheWholeLanding(Landing):

    def test_three_agents_one_start_the_full_watch_once_and_a_probe_for_each_other(self):
        node = Node(self.root)
        paths = self.land(node, "alpha", "bravo", "charlie")
        self.assertEqual(node.calls("pm2", "start"), [["pm2", "start", steps.CONF, "--only", "mesh-node-platform"]],
                         "one start of the node for the three, not one each")
        self.assertEqual(node.calls("pm2", "restart"), [], "nothing was taken back out")
        # Every watch counts from the one mark taken before the start.
        self.assertEqual(node.watches(), [("alpha", str(steps.WATCH_SECONDS), "1"),
                                          ("bravo", str(steps.LAND_PROBE_SECONDS), "1"),
                                          ("charlie", str(steps.LAND_PROBE_SECONDS), "1")])
        for p, name in zip(paths, ("alpha", "bravo", "charlie")):
            doc = emitted(self, steps.finish, p)
            self.assertTrue(doc["ok"], doc)
            self.assertEqual((doc["act"], doc["name"], doc["placement"]), ("deploy", name, "cloud-run"))
            self.assertEqual(doc["processes"]["started"], ["mesh-node-platform"])
            self.assertTrue(doc["watch"]["ok"] and doc["smoke"]["passed"])
            self.assertEqual(doc["image_digest"], DIGEST)
            self.assertFalse(os.path.exists(p), "the state goes with the finish")
        self.assertEqual(self.clouds, ["alpha", "bravo", "charlie"], "each agent's work is placed after it landed")


class OneFailureInABatch(Landing):

    def test_an_agent_that_does_not_answer_is_taken_out_and_the_others_land(self):
        node = Node(self.root, silent={"bravo"})
        paths = self.land(node, "alpha", "bravo", "charlie")
        pause = [c for c in node.seen if c[0] == "su" and "agent pause" in c[-1]]
        self.assertEqual(len(pause), 1)
        self.assertTrue(pause[0][-1].endswith("agent pause bravo"), "only bravo is paused")
        self.assertTrue(os.path.exists(os.path.join(self.root, "agents", "bravo", "paused.json")))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "agents", "bravo")), "paused in place, never moved")
        self.assertEqual(node.calls("pm2", "restart"), [["pm2", "restart", "mesh-node-platform"]],
                         "one recovery start without bravo")
        # charlie's probe counts from a fresh mark, taken after the recovery.
        self.assertEqual(node.watches()[-1][0], "charlie")
        self.assertNotEqual(node.watches()[-1][2], "1")

        ok_a, refused, ok_c = (emitted(self, steps.finish, p) for p in paths)
        self.assertTrue(ok_a["ok"] and ok_c["ok"])
        self.assertFalse(refused["ok"])
        self.assertEqual((refused["step"], refused["act"], refused["name"]), ("watch", "deploy", "bravo"))
        self.assertTrue(refused["rolled_back"])
        self.assertIn("bravo did not answer a health probe", refused["error"])
        self.assertIn("it landed in one start of the node with alpha, charlie", refused["error"])
        self.assertTrue(refused["state"].startswith("rolled back: bravo was paused on mesh-node-platform"), refused["state"])
        self.assertIn("the node recovered", refused["state"])
        self.assertIn("run remove bravo", refused["state"], "the row is named as it is when a deploy runs whole")
        row = next(a for a in steps.load_list() if a["name"] == "bravo")
        self.assertEqual(row["state"], "failed at watch")
        self.assertEqual(self.clouds, ["alpha", "charlie"], "no image is built for the agent taken out")

    def test_a_node_that_fails_the_first_watch_takes_the_whole_landing_back_out(self):
        node = Node(self.root, silent={"alpha"})
        paths = self.land(node, "alpha", "bravo")
        self.assertEqual(len([c for c in node.seen if c[0] == "su" and "agent pause" in c[-1]]), 2,
                         "nobody can say which agent made the node unwell, so both go back out")
        self.assertEqual(len(node.calls("pm2", "restart")), 1, "one recovery start for both")
        self.assertEqual([w[0] for w in node.watches() if w[0] != "-"], ["alpha"], "bravo is not probed after that")
        for p in paths:
            doc = emitted(self, steps.finish, p)
            self.assertEqual((doc["step"], doc["rolled_back"]), ("watch", True))

    def test_an_update_whose_smoke_check_fails_is_put_back_before_anything_is_watched(self):
        self.smoke_fails = {"old-hand"}
        node = Node(self.root)
        paths = self.land(node, ("old-hand", "update"), "newcomer")
        self.assertEqual(self.restored, ["old-hand"])
        self.assertEqual(node.calls("pm2", "restart"), [["pm2", "restart", "mesh-node-platform"]],
                         "the node is started once more, with the old version back")
        self.assertEqual([w[0] for w in node.watches()], ["newcomer"], "only the agent still landing is watched")
        self.assertEqual(node.watches()[0][2], "2", "and from the mark taken before that second start")
        put_back, landed = (emitted(self, steps.finish, p) for p in paths)
        self.assertEqual((put_back["step"], put_back["act"], put_back["restored"]), ("check", "update", True))
        self.assertEqual(put_back["error"], "the smoke check failed on 1.0.0; 0.9.0 was restored from the snapshot")
        self.assertEqual(put_back["previous"]["version"], "0.9.0")
        self.assertTrue(landed["ok"])

    def test_a_node_that_cannot_be_started_refuses_each_agent_at_pm2(self):
        node = Node(self.root)
        failing = node.run

        def run(cmd, *a, **k):
            if list(cmd[:2]) == ["pm2", "start"]:
                node.seen.append(list(cmd))
                return subprocess.CompletedProcess(cmd, 1, "", "[PM2][ERROR] Script not found")
            return failing(cmd, *a, **k)
        node.run = run
        paths = self.land(node, "alpha", "bravo")
        for p in paths:
            doc = emitted(self, steps.finish, p)
            self.assertEqual((doc["step"], doc["error"]), ("pm2", "[PM2][ERROR] Script not found"))
            self.assertIn("run remove", doc["state"])


class APlacementRefusedLeavesTheOthersToLand(Landing):

    def test_one_refusal_and_two_landings_each_told_what_was_placed_before_it(self):
        paths = []
        for name in ("alpha", "bravo", "charlie"):
            p, ctx = self.placed(name)
            ctx.pop("phase")
            steps.write_state(p, ctx)
            paths.append(p)
        told, landed = [], []

        def placement(path, ctx, fd, also):
            told.append((ctx["name"], also))
            if ctx["name"] == "bravo":
                return {"ok": False, "step": "capacity", "error": "the node would pass 80%", "state": "nothing created"}
            doc = steps.read_state(path)
            doc["phase"] = "placed"
            steps.write_state(path, doc)
            return {"ok": True, "act": "place", "phase": "placed", "name": ctx["name"]}

        def on_node(group):
            landed.append([c["name"] for _, c in group])
            for p, c in group:
                c["landing"] = {"processes": {"started": ["mesh-node-platform"]}, "smoke": {"passed": True},
                                "watched": {"ok": True}}
                steps.write_state(p, c)
        with mock.patch.object(steps, "run_placement", placement), mock.patch.object(steps, "land_on_node", on_node):
            said = emitted(self, steps.land, paths)
        self.assertEqual(said, {"ok": True, "act": "land",
                                "agents": {"alpha": "landed", "bravo": "refused at capacity", "charlie": "landed"}})
        self.assertEqual(told, [("alpha", 0), ("bravo", 1), ("charlie", 1)],
                         "the guard counts the new agents already placed on this node in this landing")
        self.assertEqual(landed, [["alpha", "charlie"]])
        refused = emitted(self, steps.finish, paths[1])
        self.assertEqual(refused, {"ok": False, "step": "capacity", "error": "the node would pass 80%",
                                   "state": "nothing created"}, "printed exactly as the placement printed it")

    def test_a_deploy_whose_landing_stopped_says_so_and_names_the_row(self):
        p, ctx = self.placed("alpha")
        doc = emitted(self, steps.finish, p)
        self.assertEqual(doc["step"], "land")
        self.assertIn("before it was started and watched", doc["error"])
        self.assertIn("run remove alpha", doc["state"])
        self.assertEqual(next(a for a in steps.load_list() if a["name"] == "alpha")["state"], "failed at land")

    def test_a_customer_project_instruction_never_runs_in_phases(self):
        os.makedirs(os.path.join(steps.DM_HOME, "tmp"), exist_ok=True)
        argfile = f"{steps.DM_HOME}/tmp/phased-grant.json"
        steps.write_text(argfile, json.dumps({"name": "alpha", "cloud": {"project": "theirs"}}))
        doc = emitted(self, steps.prepare, "deploy", argfile)
        self.assertEqual(doc["step"], "validate")
        self.assertIn("never in a batched landing", doc["error"])


@unittest.skipUnless(steps.fcntl is not None and hasattr(os, "fork"), "flock is a POSIX fact")
class APlacementHoldsOnlyTheLockItWasHanded(unittest.TestCase):

    def setUp(self):
        self.lock = os.path.join(TMP, "handed-node.lock")
        p = mock.patch.object(steps, "NODE_LOCK", self.lock)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(steps.release_node_lock, True)

    def test_the_landings_descriptor_is_believed_and_never_let_go_of(self):
        fd = os.open(self.lock, os.O_RDONLY | os.O_CREAT, 0o644)
        self.addCleanup(os.close, fd)
        steps.fcntl.flock(fd, steps.fcntl.LOCK_EX)
        with mock.patch.dict(os.environ, {steps.NODE_LOCK_FD_VAR: str(fd)}):
            steps.take_handed_node_lock()
        steps.acquire_node_lock("a nested hold")
        steps.release_node_lock(all_of_it=True)
        other = os.open(self.lock, os.O_RDONLY)
        self.addCleanup(os.close, other)
        with self.assertRaises(OSError, msg="the landing still holds it after the placement let go"):
            steps.fcntl.flock(other, steps.fcntl.LOCK_EX | steps.fcntl.LOCK_NB)

    def test_a_placement_in_its_own_process_holds_the_landings_lock(self):
        # What run_placement does, across a real process boundary: the lock
        # taken here is handed down by descriptor, the child holds it, and
        # this side still holds it when the child is gone.
        steps.acquire_node_lock("a landing")
        fd = steps._NODE_LOCK["fd"]
        child = ("import json, steps; steps.take_handed_node_lock(); "
                 "print(json.dumps({'ok': True, 'depth': steps._NODE_LOCK['depth']}))")
        env = {**os.environ, steps.NODE_LOCK_FD_VAR: str(fd), "DM_NODE_LOCK": self.lock, "PYTHONPATH": HERE}
        p = subprocess.run([sys.executable, "-c", child], capture_output=True, text=True, timeout=60, env=env,
                           pass_fds=(fd,), cwd=HERE)
        self.assertEqual(json.loads(p.stdout.strip().splitlines()[-1]), {"ok": True, "depth": 1}, p.stderr)
        other = os.open(self.lock, os.O_RDONLY)
        self.addCleanup(os.close, other)
        with self.assertRaises(OSError):
            steps.fcntl.flock(other, steps.fcntl.LOCK_EX | steps.fcntl.LOCK_NB)
        # And without the descriptor, a placement places nothing.
        env.pop(steps.NODE_LOCK_FD_VAR)
        p = subprocess.run([sys.executable, "-c", child], capture_output=True, text=True, timeout=60, env=env, cwd=HERE)
        self.assertEqual(json.loads(p.stdout.strip().splitlines()[-1])["step"], "lock")

    def test_a_descriptor_that_is_not_the_lock_is_refused(self):
        os.close(os.open(self.lock, os.O_RDONLY | os.O_CREAT, 0o644))
        fd = os.open(os.path.join(TMP, "something-else"), os.O_RDONLY | os.O_CREAT, 0o644)
        self.addCleanup(os.close, fd)
        with mock.patch.dict(os.environ, {steps.NODE_LOCK_FD_VAR: str(fd)}):
            doc = emitted(self, steps.take_handed_node_lock)
        self.assertEqual(doc["step"], "lock")
        self.assertIn("is not the node lock", doc["error"])

    def test_a_lock_held_by_another_open_file_is_refused(self):
        holder = os.open(self.lock, os.O_RDONLY | os.O_CREAT, 0o644)
        self.addCleanup(os.close, holder)
        steps.fcntl.flock(holder, steps.fcntl.LOCK_EX)
        mine = os.open(self.lock, os.O_RDONLY)
        self.addCleanup(os.close, mine)
        with mock.patch.dict(os.environ, {steps.NODE_LOCK_FD_VAR: str(mine)}):
            doc = emitted(self, steps.take_handed_node_lock)
        self.assertEqual(doc["step"], "lock")
        self.assertIn("does not hold the node lock", doc["error"])


if __name__ == "__main__":
    unittest.main()
