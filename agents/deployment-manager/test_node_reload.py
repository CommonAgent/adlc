#!/usr/bin/env python3
"""Reloading one agent on its node instead of restarting the node.

Technical debt 417: every install on a node restarted the node, and on the
dev fleet that took 57 agents off the mesh for about a minute each time. With
DM_NODE_RELOAD on, an agent on a running node is reloaded there
(`mesh-adapter agent reload <name> --json`) and nothing else on the node is
restarted. What is worth pinning:

- the default: with the setting off, every call is the call this procedure
  has always made, and nothing asks the node to reload;
- a deploy and an update reload the agent and start nothing; the smoke check
  reads the node's answer; the watch allows the node no restart at all;
- a node that cannot be told (too old, stopped) is started as before, and the
  answer says why;
- an agent whose new files do not serve: no restart, no model woken; an
  update's old files are put back and reloaded;
- a landing reloads each agent and starts nothing; an agent that fails its
  probe is paused through the node and the neighbours are watched before
  anyone thinks of restarting the node, which happens only if they fail.

Nothing here starts a process. pm2, su and the install guard are answered at
subprocess.run.

Run: python3 -m unittest discover -s agents/deployment-manager -p "test_*.py"
"""
import contextlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="dm-reload-test-")
os.environ.setdefault("DM_FLEET", TMP)
os.environ.setdefault("DM_HOME", TMP)
import steps  # noqa: E402

DIGEST = "sha256:" + "cd" * 32
GUARD = "/opt/fleet/deploymgr-guard.mjs"


# steps reads its fleet folder once, at the first import in this test run,
# and the module that imported it first may already have removed that folder.
MADE_FLEET = []


def setUpModule():
    if not os.path.isdir(steps.FLEET):
        os.makedirs(steps.FLEET)
        MADE_FLEET.append(steps.FLEET)


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)
    for d in MADE_FLEET:
        shutil.rmtree(d, ignore_errors=True)


def emitted(case, fn, *args):
    buf = io.StringIO()
    steps.CURRENT["entry"] = None
    steps.CURRENT["cloud"] = None
    with contextlib.redirect_stdout(buf), case.assertRaises(SystemExit):
        fn(*args)
    return json.loads(buf.getvalue())


class Host:
    """pm2, su and the guard as one fleet host answers them.

    `node_status` is what pm2 says of the node. `reload` maps an agent to the
    adapter's one-line answer, or to None for an adapter that has no reload
    (it prints its usage). `silent` agents fail their probe in the watch, and
    `neighbours_fail` fails the first recovery watch."""

    def __init__(self, root, node_status="online", reload=None, silent=(), neighbours_fail=False):
        self.root, self.node_status, self.reload = root, node_status, reload if reload is not None else {}
        self.silent, self.neighbours_fail = set(silent), neighbours_fail
        self.seen, self.marks, self.recovery_watches = [], 0, 0

    def run(self, cmd, *a, **k):
        cmd = list(cmd)
        self.seen.append(cmd)
        out = ""
        if cmd[:2] == ["pm2", "jlist"]:
            out = json.dumps([{"name": "mesh-node-platform", "pid": 4242,
                               "pm2_env": {"status": self.node_status, "restart_time": 9, "pm_uptime": 1}}])
        elif cmd[0] == "node" and cmd[2] == "mark":
            self.marks += 1
            out = json.dumps({"ok": True, "act": "mark", "restarts": 9, "log_offset": self.marks})
        elif cmd[0] == "node" and cmd[2] == "watch":
            agent = cmd[cmd.index("--agent") + 1]
            if agent == "-":
                self.recovery_watches += 1
                bad = self.neighbours_fail and self.recovery_watches == 1
                out = json.dumps({"ok": False, "reason": "two neighbours did not answer"} if bad else {"ok": True})
            else:
                out = json.dumps({"ok": False, "reason": f"{agent} did not answer a health probe"}
                                 if agent in self.silent else {"ok": True, "probes": {agent: "answered"}})
        elif cmd[0] == "su" and " agent reload " in cmd[-1]:
            name = cmd[-1].split(" agent reload ", 1)[1].split()[0]
            said = self.reload.get(name, {"ok": True, "reloaded": True, "agent_id": "U" + name.upper()})
            if said is None:
                return subprocess.CompletedProcess(cmd, 1, "usage: agentmesh agent add <name> ...\n", "")
            return subprocess.CompletedProcess(cmd, 0 if said.get("ok") else 3, json.dumps({"name": name, **said}) + "\n", "")
        elif cmd[0] == "su" and " agent pause " in cmd[-1]:
            name = cmd[-1].rsplit(" ", 1)[1]
            with open(os.path.join(self.root, "agents", name, "paused.json"), "w") as f:
                f.write('{"by": "mesh-node"}\n')
        elif cmd[0] == "su" and cmd[2] != "mesh-node":
            out = "I do my job."  # the brain answering the smoke probe
        return subprocess.CompletedProcess(cmd, 0, out + "\n" if out else "", "")

    def calls(self, *head):
        return [c for c in self.seen if c[:len(head)] == list(head)]

    def reloads(self):
        return [c[-1].split(" agent reload ", 1)[1].split()[0] for c in self.seen
                if c[0] == "su" and " agent reload " in c[-1]]

    def watch_flags(self):
        return [(c[c.index("--agent") + 1], c[c.index("--restarts-allowed") + 1] if "--restarts-allowed" in c else None)
                for c in self.seen if c[:3] == ["node", GUARD, "watch"]]


class Base(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dm-reload-", dir=TMP)
        self.root = os.path.join(self.dir, "node-platform")
        self.holder = {"proc": "mesh-node-platform", "log": f"{steps.LOGS}/mesh-node-platform.log",
                       "root": self.root, "user": "mesh-node"}
        before = steps.load_list()
        self.addCleanup(steps.save_list, before)
        self.patches = [mock.patch.object(steps, "STATES", os.path.join(self.dir, "states")),
                        mock.patch.object(steps, "GUARD", GUARD),
                        mock.patch.object(steps, "agent_procs",
                                          lambda n: (["mesh-node-platform"], True, "fleet-supervisor is online")),
                        mock.patch.object(steps, "node_here", lambda: (True, "")),
                        mock.patch.object(steps, "place_in_cloud_run", self.cloud),
                        mock.patch.object(steps, "publish_runtime_for", lambda n: {"recorded": True}),
                        mock.patch.object(steps, "write_ledger", lambda *a, **k: {"files": []}),
                        mock.patch.object(steps, "restore", self.restore),
                        mock.patch("steps.time.sleep", lambda s: None)]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        self.restored, self.clouds = [], []

    def reload_on(self):
        p = mock.patch.dict(os.environ, {"DM_NODE_RELOAD": "on"})
        p.start()
        self.addCleanup(p.stop)

    def cloud(self, args):
        self.clouds.append(args["name"])
        return {"where": "cloud-run", "job": f"{args['name']}-worker", "image_digest": DIGEST,
                "runtime": {"recorded": True}, "model_placed": {"model": "m", "variable": "AGENT_MODEL"},
                "state": "the job exists and one message went through it"}

    def restore(self, name, home, doc, root, pkg_name):
        self.restored.append(name)

    def row(self, name, version="1.0.0"):
        os.makedirs(os.path.join(self.root, "agents", name), exist_ok=True)
        entry = {"name": name, "package": name, "version": version, "sha256": "ef" * 32, "harness": "opencode",
                 "interaction": "service", "state": "running", "node_root": self.root,
                 "node_proc": "mesh-node-platform", "node_user": "mesh-node"}
        steps.replace_row(entry)
        return entry

    def placed(self, name, act="deploy"):
        entry = self.row(name, "0.9.0" if act == "update" else "1.0.0")
        staging = os.path.join(self.dir, f"dm-{name}-pkg")
        os.makedirs(staging, exist_ok=True)
        ctx = {"act": act, "phase": "placed", "name": name, "args": {"name": name}, "harness": "opencode",
               "url": "https://agentcatalog.com/x/package.tar.gz", "model": "google/gemini-3.8-flash",
               "stack_bindings": [], "staging": staging, "pkg_dir": staging, "sha256": "ab" * 32,
               "pkg_name": name, "pkg_version": "1.0.0", "holder": self.holder, "capacity": {"checks": []},
               "names": {"credentials": [], "settings": [], "ceilings": {}}, "entry": entry, "dependencies": [],
               "agent_key": "U" + "K" * 55, "descriptor": {}, "price": None, "trial_allowance": None}
        if act == "deploy":
            ctx.update(interaction="service", admit=[], environment="", a2a=False, placement="cloud-run",
                       jobs_at_once=None, token_file="", handle=f"{name}.platform@agentmesh.ai",
                       key_custody={"minted": "generated", "held_by": ["UK", "root@agent-fleet"]},
                       secret=None, ledger={"files": []})
        else:
            ctx.update(home=os.path.join(self.dir, "home", name), old_ledger={"files": [], "outside": []},
                       prev=os.path.join(self.dir, "prev", name), reinstall=False, in_container=None,
                       old_desc={}, drift_before=[], placed=[], env_files=[], links=[])
        path = os.path.join(steps.STATES, f"dr-{name}.json")
        steps.write_state(path, ctx)
        return path, ctx

    def land(self, host, *specs):
        group = [self.placed(*s) if isinstance(s, tuple) else self.placed(s) for s in specs]
        with mock.patch("steps.subprocess.run", host.run):
            steps.land_on_node(group)
        return [p for p, _ in group]


class TheDefaultIsTheCallItAlwaysWas(Base):

    def test_with_the_setting_off_a_node_agent_is_started_and_nothing_is_asked_of_the_node(self):
        self.row("alpha")
        host = Host(self.root)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DM_NODE_RELOAD", None)
            with mock.patch("steps.subprocess.run", host.run):
                got = steps.start_processes("alpha")
                again = steps.serve_again("alpha", got)
        self.assertEqual(host.seen, [["pm2", "start", steps.CONF, "--only", "mesh-node-platform"],
                                     ["pm2", "restart", "mesh-node-platform"]],
                         "the start and the restart this procedure always made, and nothing else: no reload, no pm2 jlist")
        self.assertEqual(got, {"started": ["mesh-node-platform"], "attendant": "not started: fleet-supervisor is online"})
        self.assertEqual(again, "processes restarted")
        self.assertIsNone(steps.restarts_allowed_of(got), "the watch keeps the guard's own default")

    def test_any_other_word_than_on_is_off(self):
        for v in ("", "off", "1", "true", "yes"):
            with mock.patch.dict(os.environ, {"DM_NODE_RELOAD": v}):
                self.assertFalse(steps.node_reload_on(), v)
        with mock.patch.dict(os.environ, {"DM_NODE_RELOAD": " ON "}):
            self.assertTrue(steps.node_reload_on())

    def test_a_landing_with_the_setting_off_starts_the_node_once_and_reloads_nobody(self):
        host = Host(self.root)
        os.environ.pop("DM_NODE_RELOAD", None)
        self.land(host, "alpha", "bravo")
        self.assertEqual(host.calls("pm2", "start"), [["pm2", "start", steps.CONF, "--only", "mesh-node-platform"]])
        self.assertEqual(host.reloads(), [])
        self.assertTrue(all(flag is None for _, flag in host.watch_flags()), "no --restarts-allowed is passed")


class ADeployOrUpdateReloadsTheAgent(Base):

    def setUp(self):
        super().setUp()
        self.reload_on()

    def test_start_processes_reloads_on_the_running_node_and_starts_nothing(self):
        self.row("alpha")
        host = Host(self.root)
        with mock.patch("steps.subprocess.run", host.run):
            got = steps.start_processes("alpha")
            smoke = steps.check_served("alpha", got)
        self.assertEqual(host.calls("pm2", "start"), [], "the node is not started")
        su = [c for c in host.seen if c[0] == "su" and " agent reload " in c[-1]]
        self.assertEqual(len(su), 1)
        self.assertEqual(su[0][:3], ["su", "-", "mesh-node"], "as the node's user")
        self.assertEqual(su[0][-1], f"env MESH_ADAPTER_STATE={shlex.quote(self.root)} /usr/bin/mesh-adapter agent reload alpha --json")
        self.assertEqual(got["started"], [])
        self.assertEqual(got["reloaded"], {"node": "mesh-node-platform", "name": "alpha", "ok": True, "reloaded": True,
                                           "agent_id": "UALPHA"})
        self.assertTrue(smoke["passed"] and smoke["listening"], smoke)
        self.assertEqual(smoke["probe_reply"], "I do my job.", "the brain is still asked")
        self.assertEqual(steps.restarts_allowed_of(got), 0)

    def test_a_whole_deploy_reloads_and_its_watch_allows_no_restart(self):
        entry = self.row("alpha")
        ctx = {"name": "alpha", "holder": self.holder, "pkg_name": "alpha", "pkg_version": "1.0.0",
               "agent_key": "UK", "handle": "alpha.platform@agentmesh.ai", "capacity": {}}
        finished = []
        host = Host(self.root)
        with mock.patch.object(steps, "deploy_prepare", lambda a: ctx), \
                mock.patch.object(steps, "deploy_place", lambda c: c), \
                mock.patch.object(steps, "deploy_finish", lambda c: finished.append(c)), \
                mock.patch("steps.subprocess.run", host.run):
            steps.deploy("/x")
        self.assertEqual(host.calls("pm2"), [["pm2", "jlist"]], "pm2 was asked only whether the node is online")
        self.assertEqual(host.watch_flags(), [("alpha", "0")])
        self.assertEqual(finished[0]["processes"]["reloaded"]["ok"], True)
        self.assertTrue(finished[0]["smoke"]["passed"])
        self.assertEqual(entry["name"], "alpha")

    def test_an_update_whose_new_files_do_not_serve_is_put_back_by_reload_with_no_restart_and_no_model(self):
        self.row("alpha", "0.9.0")
        answers = iter([{"ok": False, "code": "NOT_RELOADED", "error": "alpha could not be reloaded: price.json is not a price"},
                        {"ok": True, "reloaded": False, "agent_id": "UALPHA"}])

        class Answers(dict):
            def get(self, name, default=None):
                return next(answers)
        host = Host(self.root, reload=Answers())
        ctx = {"name": "alpha", "holder": self.holder, "entry": {"version": "0.9.0", "handle": "h"}, "home": "/home/alpha",
               "pkg_name": "alpha", "pkg_version": "1.0.0", "reinstall": False, "staging": self.dir,
               "old_ledger": {}, "prev": "/prev", "agent_key": "UK", "url": "u", "sha256": "ab" * 32,
               "harness": "opencode", "names": {"credentials": [], "settings": [], "ceilings": {}}, "price": None,
               "trial_allowance": None, "stack_bindings": [], "descriptor": {}, "dependencies": [], "drift_before": [],
               "capacity": {}, "old_desc": {}}
        with mock.patch.object(steps, "update_prepare", lambda a: ctx), \
                mock.patch.object(steps, "update_place", lambda c: c), \
                mock.patch("steps.subprocess.run", host.run):
            doc = emitted(self, steps.update, "/x")
        self.assertEqual((doc["step"], doc["restored"]), ("check", True))
        self.assertEqual(doc["error"], "the smoke check failed on 1.0.0; 0.9.0 was restored from the snapshot")
        self.assertEqual(doc["state"], "restored to 0.9.0; reloaded on mesh-node-platform")
        self.assertEqual(self.restored, ["alpha"])
        self.assertEqual(host.reloads(), ["alpha", "alpha"], "reloaded on the new files, then on the old")
        self.assertEqual(host.calls("pm2", "start") + host.calls("pm2", "restart"), [], "the node was never restarted")
        self.assertFalse([c for c in host.seen if c[0] == "su" and c[2] == "alpha"], "no model was woken")
        self.assertEqual(doc["smoke"]["probe"], "not run: the node did not serve the agent after the reload")

    def test_a_node_too_old_to_reload_is_started_as_before_and_the_answer_says_why(self):
        self.row("alpha")
        host = Host(self.root, reload={"alpha": None})
        with mock.patch("steps.subprocess.run", host.run):
            got = steps.start_processes("alpha")
        self.assertEqual(host.calls("pm2", "start"), [["pm2", "start", steps.CONF, "--only", "mesh-node-platform"]])
        self.assertEqual(got["started"], ["mesh-node-platform"])
        self.assertNotIn("reloaded", got)
        self.assertTrue(got["reload"].startswith("not used: mesh-node-platform could not be told to reload alpha (NO_ANSWER"), got)
        self.assertIsNone(steps.restarts_allowed_of(got), "a start keeps the one restart it causes")

    def test_a_stopped_node_is_started_and_nothing_is_reloaded(self):
        self.row("alpha")
        host = Host(self.root, node_status="stopped")
        with mock.patch("steps.subprocess.run", host.run):
            got = steps.start_processes("alpha")
        self.assertEqual(host.reloads(), [])
        self.assertEqual(got["reload"], "not used: mesh-node-platform is stopped, so starting it serves alpha")

    def test_an_agent_with_an_attendant_or_its_own_adapter_is_started(self):
        steps.replace_row({"name": "solo", "state": "running"})
        with mock.patch("steps.subprocess.run", Host(self.root).run):
            node, why = steps.reload_target("solo", ["solo-adapter"])
            self.assertIsNone(node)
            self.assertIn("runs no node of its own", why)
            self.row("alpha")
            node, why = steps.reload_target("alpha", ["mesh-node-platform", "alpha-attendant"])
            self.assertIsNone(node)
            self.assertIn("not its node alone", why)

    def test_a_model_change_reloads_the_agent(self):
        self.row("alpha")
        host = Host(self.root)
        with mock.patch.object(steps, "place_model_key", lambda *a: "k"), \
                mock.patch.object(steps, "write_brain", lambda *a: None), \
                mock.patch.object(steps, "reledger_brain", lambda n: {}), \
                mock.patch("steps.os.path.isdir", lambda p: True), \
                mock.patch("steps.subprocess.run", host.run):
            doc = emitted(self, steps.set_model, "alpha", "google/gemini-3.8-flash", "opencode")
        self.assertTrue(doc["ok"], doc)
        self.assertEqual(host.reloads(), ["alpha"])
        self.assertEqual(host.calls("pm2", "restart"), [])
        self.assertTrue(doc["check"]["passed"])


class ALandingReloadsEachAgent(Base):

    def setUp(self):
        super().setUp()
        self.reload_on()

    def test_three_agents_three_reloads_no_start_and_no_restart_allowed(self):
        host = Host(self.root)
        paths = self.land(host, "alpha", "bravo", ("charlie", "update"))
        self.assertEqual(host.reloads(), ["alpha", "bravo", "charlie"])
        self.assertEqual(host.calls("pm2", "start") + host.calls("pm2", "restart"), [], "the node is never restarted")
        self.assertEqual(host.watch_flags(), [("alpha", "0"), ("bravo", "0"), ("charlie", "0")])
        for p in paths:
            doc = emitted(self, steps.finish, p)
            self.assertTrue(doc["ok"], doc)
            self.assertEqual(doc["processes"]["started"], [])
            self.assertTrue(doc["processes"]["reloaded"]["ok"])

    def test_an_agent_that_fails_its_probe_is_paused_and_the_node_is_not_restarted_when_its_neighbours_are_well(self):
        host = Host(self.root, silent={"bravo"})
        paths = self.land(host, "alpha", "bravo", "charlie")
        self.assertEqual(len([c for c in host.seen if c[0] == "su" and " agent pause bravo" in c[-1]]), 1)
        self.assertEqual(host.calls("pm2", "restart"), [], "the neighbours stayed well, so nobody was restarted")
        self.assertIn(("-", "0"), host.watch_flags(), "the neighbours were watched, allowed no restart")
        ok_a, refused, ok_c = (emitted(self, steps.finish, p) for p in paths)
        self.assertTrue(ok_a["ok"] and ok_c["ok"])
        self.assertEqual((refused["step"], refused["rolled_back"]), ("watch", True))
        self.assertIn("the node recovered", refused["state"])
        self.assertFalse(refused["recovery"]["restarted"])

    def test_neighbours_that_do_not_stay_well_get_the_restart_as_before(self):
        host = Host(self.root, silent={"bravo"}, neighbours_fail=True)
        self.land(host, "alpha", "bravo")
        self.assertEqual(host.calls("pm2", "restart"), [["pm2", "restart", "mesh-node-platform"]])
        self.assertEqual(host.recovery_watches, 2, "watched without a restart, then after it")

    def test_an_update_whose_smoke_fails_in_a_landing_is_put_back_by_reload(self):
        host = Host(self.root, reload={"old-hand": {"ok": False, "code": "NOT_RELOADED", "error": "does not serve"}})
        orig = host.run
        reloads = {"n": 0}

        def run(cmd, *a, **k):
            if cmd[0] == "su" and " agent reload old-hand" in cmd[-1]:
                reloads["n"] += 1
                if reloads["n"] == 2:  # the old files serve
                    host.seen.append(list(cmd))
                    return subprocess.CompletedProcess(cmd, 0, json.dumps({"ok": True, "reloaded": False}) + "\n", "")
            return orig(cmd, *a, **k)
        host.run = run
        paths = self.land(host, ("old-hand", "update"), "newcomer")
        self.assertEqual(self.restored, ["old-hand"])
        self.assertEqual(host.calls("pm2", "start") + host.calls("pm2", "restart"), [])
        self.assertEqual(host.watch_flags(), [("newcomer", "0")])
        put_back, landed = (emitted(self, steps.finish, p) for p in paths)
        self.assertEqual((put_back["step"], put_back["restored"]), ("check", True))
        self.assertTrue(landed["ok"])

    def test_one_node_that_cannot_be_told_starts_only_its_agents_and_the_watch_allows_that_restart(self):
        host = Host(self.root, reload={"bravo": None})
        self.land(host, "alpha", "bravo")
        self.assertEqual(host.calls("pm2", "start"), [["pm2", "start", steps.CONF, "--only", "mesh-node-platform"]])
        self.assertEqual(host.reloads(), ["alpha", "bravo"])
        self.assertTrue(all(flag is None for _, flag in host.watch_flags()), "a start happened, so its restart is allowed")


if __name__ == "__main__":
    unittest.main()
