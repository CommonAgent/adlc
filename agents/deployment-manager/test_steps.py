#!/usr/bin/env python3
"""Where a packaged agent's work runs, and which processes this host starts.

What is worth pinning: a deploy that is told nothing puts the work in Cloud Run
and leaves the inbox here; a placement the instruction does not name is refused
before the unix user exists, and so is a Cloud Run placement on a host with no
supervisor to carry a message to the job; the placed deploy runs both container
procedures itself and hands the second the image the first reported BY DIGEST,
and counts one deploy against the ceiling and not two; the row it writes carries
exactly the four members the supervisor's roster dispatches on; an update of an
agent whose work is in a job composes the image and the job the way deploy does
and puts the host half back when the container half fails; and the
attendant is started only where no fleet supervisor is running, while the
generated pm2 config goes on declaring it, because that entry is what the
roster is built from; and the price a package declares is placed where the
agent's own node reads it, with the provider and the approval address added by
this side, while a package that declares none places no file and stays free.

Nothing here starts a process, creates a user or calls a cloud. The procedures
that do are called through their seams: pm2 is answered with a fake process
list, and the two container halves are answered with fake records.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
"""
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import record  # noqa: E402

# steps.py reads where the fleet keeps its state once, at import, so this has to
# be set before the import and not after it. Every file these tests cause to be
# written lands here and goes with the module.
TMP = tempfile.mkdtemp(prefix="dm-steps-test-")
os.environ["DM_FLEET"] = TMP
os.environ["DM_HOME"] = TMP
import steps  # noqa: E402

DIGEST = "sha256:" + "cd" * 32
IMAGE_REF = "gcr.io/langbench/deploymgr/explainer-maker:0.4.1"
PINNED = f"gcr.io/langbench/deploymgr/explainer-maker@{DIGEST}"

# A deploy instruction with every address the placed half needs in it, so these
# tests never depend on what this machine's environment happens to hold.
PLACED_ARGS = {
    "name": "watcher", "harness": "opencode", "interaction": "service",
    "package_url": "https://agentcatalog.com/x/package.tar.gz",
    "boot_token": "watcher-boot", "admit": [],
    "registry": "gcr.io/langbench/deploymgr", "bucket": "example-agent-state",
    "region": "us-central1", "project": "langbench-1528148150979",
}


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def pm2_answering(rows, record=None):
    """subprocess.run, with pm2 answering `jlist` with these processes and every
    other command succeeding silently. `record` collects the argv of each call,
    which is how a test asks what pm2 was actually told to start."""
    def fake(cmd, *a, **k):
        if record is not None:
            record.append(list(cmd))
        if list(cmd[:2]) == ["pm2", "jlist"]:
            return subprocess.CompletedProcess(cmd, 0, json.dumps(rows), "")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return fake


def pm2_unreachable(record=None):
    def fake(cmd, *a, **k):
        if record is not None:
            record.append(list(cmd))
        if list(cmd[:2]) == ["pm2", "jlist"]:
            raise FileNotFoundError("pm2")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return fake


SUPERVISOR_ONLINE = [{"name": "fleet-supervisor", "pm2_env": {"status": "online"}},
                     {"name": "hermes-adapter", "pm2_env": {"status": "online"}}]
NO_SUPERVISOR = [{"name": "hermes-adapter", "pm2_env": {"status": "online"}},
                 {"name": "hermes-attendant", "pm2_env": {"status": "online"}}]
SUPERVISOR_STOPPED = [{"name": "fleet-supervisor", "pm2_env": {"status": "stopped"}}]


def emitted(case, fn, *args, **kwargs):
    """The one JSON object a procedure prints before it exits, which is the
    whole of what the brain reads. Every procedure ends this way, a refusal
    through fail() and a finished act through out(), so a test reads the same
    object either way."""
    buf = io.StringIO()
    # Both halves of what this act is in the middle of. One process runs one
    # act, so steps.py never clears these itself; a test file runs many, and a
    # grant left over from the last one would be a call made in a customer's
    # project by a test that never mentioned one.
    steps.CURRENT["entry"] = None
    steps.CURRENT["cloud"] = None
    with contextlib.redirect_stdout(buf), case.assertRaises(SystemExit):
        fn(*args, **kwargs)
    return json.loads(buf.getvalue())


class Refusal:
    """A procedure's refusal, caught."""

    def __init__(self, case, fn, *args, **kwargs):
        self.doc = emitted(case, fn, *args, **kwargs)
        case.assertFalse(self.doc["ok"])


class WhereTheWorkRunsIsTheDeploysOwnDecision(unittest.TestCase):
    """An owner who says nothing gets the default, and the default is the
    container. The instruction can still say otherwise and is read when it
    does."""

    def test_an_instruction_that_says_nothing_places_the_work_in_cloud_run(self):
        self.assertEqual(steps.placement_of({"name": "watcher"}), "cloud-run")

    def test_an_owner_who_asks_for_this_host_and_says_why_gets_this_host(self):
        self.assertEqual(
            steps.placement_of({"placement": "host", "host_because": "iterating on the command"}), "host")

    # THE BUG THIS EXISTS FOR. cloud-run was already the default and it was not
    # enough: every placement refusal ended by offering `placement "host"`, so
    # the easiest answer to a container that would not build was to put the work
    # on the VM. explainer-maker and process-runner went there to chase a bug,
    # no record said why, and they were still there a day and a half later
    # running code the inventory did not know about (2026-09-12).
    def test_a_host_placement_with_no_reason_is_refused(self):
        r = Refusal(self, steps.placement_of, {"placement": "host"})
        self.assertFalse(r.doc["ok"])
        self.assertEqual(r.doc["step"], "placement")
        self.assertIn("host_because", r.doc["error"])
        self.assertEqual(r.doc["state"], "nothing created")

    def test_a_reason_that_is_only_whitespace_is_not_a_reason(self):
        r = Refusal(self, steps.placement_of, {"placement": "host", "host_because": "   "})
        self.assertEqual(r.doc["step"], "placement")

    def test_a_placement_this_host_cannot_do_is_refused_and_names_the_two(self):
        r = Refusal(self, steps.placement_of, {"placement": "kubernetes"})
        self.assertFalse(r.doc["ok"])
        self.assertEqual(r.doc["step"], "validate")
        self.assertIn("cloud-run", r.doc["error"])
        self.assertIn("host", r.doc["error"])
        # Nothing was created, and the refusal says so rather than leaving the
        # operator to guess whether a half-made agent is somewhere.
        self.assertEqual(r.doc["state"], "nothing created")


class APersonsOwnPackageIsNeverPlacedInOurProject(unittest.TestCase):
    """Prompt to prod phase 3 files a person's own agent with the tenant the
    platform set. Until packages can be placed in the tenant project, the
    procedure refuses it before anything is fetched."""

    def test_a_package_naming_a_tenant_is_refused_and_nothing_is_made(self):
        r = Refusal(self, steps.refuse_tenant_package, {"name": "pricing-diff", "tenant": "t-0123456789ab"})
        self.assertEqual(r.doc["step"], "validate")
        self.assertIn("tenant project", r.doc["error"])
        self.assertEqual(r.doc["state"], "nothing created")

    def test_a_package_naming_no_tenant_goes_on_as_before(self):
        self.assertIsNone(steps.refuse_tenant_package({"name": "quiz-maker"}))


class ThePlacementIsCheckedBeforeTheUnixUserExists(unittest.TestCase):
    """The container half's own refusals, made at step 2's place in the order.
    A deploy that discovered a missing bucket after useradd would have made a
    user for an agent it then refused."""

    def test_cloud_run_is_refused_on_a_host_with_no_supervisor(self):
        # The refusal that matters most: a job has no address and does not exist
        # between executions, so with nothing on the host to carry a message to
        # it, the agent would be built and then do no work at all.
        with mock.patch("steps.subprocess.run", pm2_answering(NO_SUPERVISOR)):
            r = Refusal(self, steps.check_placement_before_touching, dict(PLACED_ARGS))
        self.assertEqual(r.doc["step"], "placement")
        self.assertIn("fleet-supervisor", r.doc["error"])
        # It names the thing to fix and does NOT offer the VM as the way past
        # it: that offer is how the work ended up on the VM in the first place.
        self.assertNotIn('placement "host"', r.doc["error"])
        self.assertEqual(r.doc["state"], "nothing created")

    def test_a_supervisor_that_is_in_pm2_but_stopped_is_not_a_supervisor(self):
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_STOPPED)):
            r = Refusal(self, steps.check_placement_before_touching, dict(PLACED_ARGS))
        self.assertEqual(r.doc["step"], "placement")
        self.assertIn("stopped", r.doc["error"])

    def test_the_addresses_are_named_one_at_a_time(self):
        for missing, word in (("registry", "registry"), ("bucket", "bucket")):
            args = {k: v for k, v in PLACED_ARGS.items() if k != missing}
            with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)), \
                 mock.patch.object(steps, "REGISTRY", ""), mock.patch.object(steps, "BUCKET", ""):
                r = Refusal(self, steps.check_placement_before_touching, args)
            self.assertEqual(r.doc["step"], "placement")
            self.assertIn(word, r.doc["error"])

    def test_an_instruction_with_the_addresses_and_a_supervisor_passes(self):
        # It returns nothing and refuses nothing; a SystemExit here would be a
        # deploy refused on a host that can do it.
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
            self.assertIsNone(steps.check_placement_before_touching(dict(PLACED_ARGS)))


class ThePlacedDeployRunsBothHalvesItself(unittest.TestCase):
    """One owner instruction, one act. The deploy composes the two container
    procedures rather than asking anyone to remember to call them."""

    def setUp(self):
        self.seen = {}

        def fake_image(args):
            self.seen["image"] = dict(args)
            return {"ok": True, "act": "build", "image": IMAGE_REF, "image_digest": DIGEST,
                    "pinned": PINNED}

        def fake_container(args, count_against_ceiling=True):
            self.seen["container"] = (dict(args), count_against_ceiling)
            return {"ok": True, "act": "deploy", "job": "watcher-worker", "image": PINNED,
                    "image_digest": DIGEST, "bucket": args["bucket"],
                    "directories": {"records": "gs://example-agent-state/state/watcher/records"},
                    "runtime": {"recorded": True, "published": True},
                    "smoke": {"passed": True},
                    "state": "the job exists and one message went through it"}

        self.patches = [mock.patch.object(steps, "image_step", fake_image),
                        mock.patch.object(steps, "container_step", fake_container)]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def test_the_job_is_created_from_the_image_the_build_reported_by_digest(self):
        steps.place_in_cloud_run(dict(PLACED_ARGS))
        self.assertEqual(self.seen["image"]["package_url"], PLACED_ARGS["package_url"])
        # BY DIGEST. The tag the image was pushed under can point somewhere else
        # an hour later, and the record names what was started.
        self.assertEqual(self.seen["container"][0]["image"], PINNED)

    def test_one_instruction_costs_one_deploy_against_the_daily_ceiling(self):
        steps.place_in_cloud_run(dict(PLACED_ARGS))
        self.assertIs(self.seen["container"][1], False)

    def test_the_deploy_reports_the_build_and_the_job_it_made(self):
        work = steps.place_in_cloud_run(dict(PLACED_ARGS))
        self.assertEqual(work["where"], "cloud-run")
        self.assertEqual(work["job"], "watcher-worker")
        self.assertEqual(work["image_digest"], DIGEST)
        # The runtime record is the container half's, not a second one about the
        # host: an owner's page must name one place the work runs.
        self.assertTrue(work["runtime"]["recorded"])
        self.assertIn("build", work)


class AFailedPlacementLeavesSomethingToActOn(unittest.TestCase):
    """The image and the job steps run after the agent is installed, so their
    refusals are the first ones that can stop a deploy with an agent already on
    the host. Whatever else the step says, the agent has to be in the sentence
    the operator acts on."""

    def setUp(self):
        steps.save_json_list(steps.LIST, [])
        self.addCleanup(steps.save_json_list, steps.LIST, [])
        self.addCleanup(steps.CURRENT.update, {"entry": None})

    def test_the_installed_agent_is_named_even_when_the_step_named_its_own_state(self):
        buf = io.StringIO()
        steps.CURRENT["entry"] = {"name": "watcher", "state": "running"}
        with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit):
            steps.fail("image", "build 42 is still RUNNING after 40 minutes",
                       state="build 42 is still running")
        doc = json.loads(buf.getvalue())
        self.assertEqual(doc["step"], "image")
        self.assertIn("build 42 is still running", doc["state"])
        self.assertIn("remove watcher", doc["state"])

    def test_the_inventory_row_says_which_step_it_stopped_at(self):
        buf = io.StringIO()
        steps.CURRENT["entry"] = {"name": "watcher", "state": "running"}
        with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit):
            steps.fail("job", "the region refused the job")
        row = next(a for a in steps.load_list() if a["name"] == "watcher")
        self.assertEqual(row["state"], "failed at job")


class TheRowIsHowAnAgentIsSwitched(unittest.TestCase):
    """runtime/fleet/roster.mjs containerFromDeploy reads these members off the
    container row and gives up on a row missing one, silently, leaving the work
    on this host while a job sits unused."""

    def test_the_row_carries_the_four_members_the_roster_dispatches_on(self):
        where = steps.where_the_work_runs("watcher-worker", "us-central1", "langbench-1528148150979")
        self.assertEqual(where, {"runs_on": "cloud-run", "job": "watcher-worker",
                                 "region": "us-central1", "project": "langbench-1528148150979"})

    def test_runs_on_is_the_exact_words_the_roster_matches(self):
        # containerFromDeploy tests `entry.runs_on !== "cloud-run"` and returns
        # null on anything else, so this string is an interface and not a label.
        self.assertEqual(steps.where_the_work_runs("j", "r", None)["runs_on"], "cloud-run")


class TheCeilingCountsAgentsNotRows(unittest.TestCase):
    """A placed agent has a row in each inventory: the host one for the adapter
    that holds its mailbox, the container one for the work. It is one agent."""

    def placed(self, n):
        hosts = [{"name": f"a{i}", "state": "running"} for i in range(n)]
        containers = [{"name": f"a{i}", "runs_on": "cloud-run"} for i in range(n)]
        return hosts + containers

    def test_six_placed_agents_are_six_agents_and_not_twelve(self):
        with mock.patch.object(steps, "MAX_AGENTS", 10):
            steps.spend_check_and_record(self.placed(6))  # refusing here would be the bug

    def test_the_ceiling_still_refuses_when_the_agents_really_are_that_many(self):
        with mock.patch.object(steps, "MAX_AGENTS", 10):
            r = Refusal(self, steps.spend_check_and_record,
                        [{"name": f"a{i}"} for i in range(10)])
        self.assertEqual(r.doc["step"], "spend")
        self.assertIn("ceiling of 10", r.doc["error"])


class AnUpdateOfAPlacedAgentComposesBothHalves(unittest.TestCase):
    """An update used to refuse an agent whose work is in a job and name the two
    commands to run by hand, which left the descriptor, the inventory and the
    AgentDoc on the old version while the job ran the new one. Now it composes
    the image and the job the way deploy does, and a container half that fails
    puts the host half back to the version the job still runs."""

    ROW = {"name": "watcher", "runs_on": "cloud-run", "job": "watcher-worker", "region": "us-central1",
           "project": "langbench-1528148150979", "bucket": "example-agent-state",
           "image": "gcr.io/langbench/deploymgr/watcher@" + DIGEST, "interaction": "service",
           "environment": "production", "state": "running"}

    def test_a_placed_agent_is_no_longer_refused_for_being_placed(self):
        os.makedirs(os.path.join(TMP, "tmp"), exist_ok=True)
        steps.save_json_list(steps.LIST, [{"name": "watcher", "package": "explainer-maker",
                                           "version": "0.4.0", "state": "running"}])
        steps.save_json_list(steps.CONTAINERS, [self.ROW])
        argfile = f"{steps.DM_HOME}/tmp/update-watcher.json"
        steps.write_text(argfile, json.dumps({"name": "watcher",
                                              "package_url": "https://agentcatalog.com/x/package.tar.gz"}))
        try:
            r = Refusal(self, steps.update, argfile)
        finally:
            steps.save_json_list(steps.CONTAINERS, [])
            steps.save_json_list(steps.LIST, [])
        # It gets past the container check and stops at the next real one, that
        # this test host has no such unix user. What it must not say is that
        # the two halves are the operator's to run by hand.
        self.assertEqual(r.doc["step"], "validate")
        self.assertNotIn("`image`", r.doc["error"])
        self.assertNotIn("`container`", r.doc["error"])
        self.assertIn("does not exist", r.doc["error"])

    def test_the_container_half_reads_what_the_instruction_left_out_off_the_row(self):
        # A hand-written argfile that names only the package is enough: the
        # registry comes off the pinned image, the rest off the row and the
        # inventory, and what the instruction did say is never overridden.
        args = {"name": "watcher", "package_url": "https://agentcatalog.com/x/package.tar.gz",
                "settings": {"text-reasoning": {"TEXT_MODEL": "x"}}, "region": "europe-west1"}
        entry = {"name": "watcher", "interaction": "personal"}
        with mock.patch("steps.placement_from_host", lambda: {"registry": "gcr.io/other", "bucket": "other"}):
            filled = steps.container_args_for_update(args, self.ROW, entry, "opencode", "google/gemini-2.5-flash")
            # A row with no image gives no registry, and the placement file fills it.
            bare = steps.container_args_for_update({"name": "watcher"}, {**self.ROW, "image": ""}, entry, "opencode", "m")
        self.assertEqual(filled["registry"], "gcr.io/langbench/deploymgr", "read off the pinned image, not the placement file")
        self.assertEqual(filled["bucket"], "example-agent-state", "the row's bucket outranks the placement file's")
        self.assertEqual(filled["region"], "europe-west1", "what the instruction said stands")
        self.assertEqual(filled["project"], "langbench-1528148150979")
        self.assertEqual(filled["interaction"], "service", "the row's, because that is what the job runs as")
        self.assertEqual(filled["environment"], "production")
        self.assertEqual(filled["harness"], "opencode")
        self.assertEqual(filled["model"], "google/gemini-2.5-flash")
        self.assertEqual(filled["settings"], {"text-reasoning": {"TEXT_MODEL": "x"}}, "the owner's answers travel as given")
        self.assertEqual(bare["registry"], "gcr.io/other")

    def test_a_failed_container_half_puts_the_host_half_back_and_says_so_first(self):
        # The hook is taken once: the refusal that follows carries its sentence
        # at the front of the state, and a later act cannot inherit it.
        seen = []
        steps.CURRENT["on_fail"] = lambda step: (seen.append(step) or f"the host half was put back to 0.4.0 after {step}")
        try:
            doc = emitted(self, steps.fail, "image", "the build ended FAILURE")
        finally:
            steps.CURRENT["on_fail"] = None
        self.assertFalse(doc["ok"])
        self.assertEqual(seen, ["image"])
        self.assertTrue(doc["state"].startswith("the host half was put back to 0.4.0 after image"), doc["state"])
        self.assertIsNone(steps.CURRENT.get("on_fail"), "disarmed once taken")
        # A hook that throws does not hide the refusal it was attached to.
        steps.CURRENT["on_fail"] = lambda step: (_ for _ in ()).throw(RuntimeError("disk gone"))
        try:
            doc = emitted(self, steps.fail, "container", "the job would not update")
        finally:
            steps.CURRENT["on_fail"] = None
        self.assertIn("putting the old version back failed too: disk gone", doc["state"])
        self.assertEqual(doc["error"], "the job would not update")


class RemovingAPlacedAgentTakesDownBothHalves(unittest.TestCase):
    """An owner who removed an agent and was left with a Cloud Run job still
    costing them money did not remove the agent, whatever the record said."""

    def setUp(self):
        steps.save_json_list(steps.LIST, [{"name": "watcher", "package": "explainer-maker",
                                           "agent_key": "U" + "A" * 55, "state": "running",
                                           "placement": "cloud-run"}])
        steps.save_json_list(steps.CONTAINERS, [{"name": "watcher", "runs_on": "cloud-run",
                                                 "job": "watcher-worker", "region": "us-central1",
                                                 "binding": "gs://example-agent-state/bindings/watcher",
                                                 "state": "running"}])
        self.addCleanup(steps.save_json_list, steps.CONTAINERS, [])
        self.addCleanup(steps.save_json_list, steps.LIST, [])

    def test_the_job_goes_and_the_row_goes_with_it(self):
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE, seen)):
            doc = emitted(self, steps.remove, "watcher")
        self.assertTrue(doc["ok"])
        deleted = [c for c in seen if c[1:4] == ["run", "jobs", "delete"]]
        self.assertEqual(len(deleted), 1)
        self.assertIn("watcher-worker", deleted[0])
        self.assertEqual(steps.load_json_list(steps.CONTAINERS), [])
        # And the record says which job it took down, not only which home.
        self.assertEqual(doc["work_was"]["job"], "watcher-worker")

    def test_an_attendant_this_host_never_started_is_not_reported_as_left_behind(self):
        # pm2 answers nonzero for a process it does not hold. On a supervisor
        # host that is the arrangement working, and listing it under `remaining`
        # would call a clean removal an unclean one.
        def fake(cmd, *a, **k):
            if list(cmd[:2]) == ["pm2", "jlist"]:
                return subprocess.CompletedProcess(cmd, 0, json.dumps(SUPERVISOR_ONLINE), "")
            if list(cmd[:2]) == ["pm2", "delete"] and cmd[2].endswith("-attendant"):
                return subprocess.CompletedProcess(cmd, 1, "", "Process not found")
            return subprocess.CompletedProcess(cmd, 0, "", "")
        with mock.patch("steps.subprocess.run", fake):
            doc = emitted(self, steps.remove, "watcher")
        self.assertEqual([r for r in doc["remaining"] if "watcher-attendant" in r], [])


class TheAttendantIsNotStartedWhereTheSupervisorRuns(unittest.TestCase):
    """One process replaced the per-agent attendant loops. Starting one beside
    it is a second reader of the same inbox: on 2026-09-11 five of them took
    this host's load from 0.41 to 4.9 and a message went to one poller that the
    other never saw."""

    def test_the_supervisor_is_learned_from_pm2_and_not_assumed(self):
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
            held, why = steps.supervisor_here()
        self.assertTrue(held)
        self.assertIn("fleet-supervisor", why)
        with mock.patch("steps.subprocess.run", pm2_answering(NO_SUPERVISOR)):
            held, why = steps.supervisor_here()
        self.assertFalse(held)
        self.assertIn("no fleet-supervisor", why)

    def test_a_pm2_that_cannot_be_asked_counts_as_held_and_says_so(self):
        # The two ways to be wrong are not equal. A wrong "no supervisor" starts
        # the second poller silently; a wrong "supervisor" starts no attendant,
        # and that is in this result and in every status afterwards.
        with mock.patch("steps.subprocess.run", pm2_unreachable()):
            held, why = steps.supervisor_here()
        self.assertTrue(held)
        self.assertIn("could not be ruled out", why)

    def test_a_deploy_on_a_supervisor_host_starts_the_adapter_alone(self):
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE, seen)):
            report = steps.start_processes("watcher")
        started = [c for c in seen if c[:2] == ["pm2", "start"]]
        self.assertEqual(len(started), 1)
        self.assertIn("--only", started[0])
        self.assertEqual(started[0][started[0].index("--only") + 1], "watcher-adapter")
        self.assertEqual(report["started"], ["watcher-adapter"])
        self.assertTrue(report["attendant"].startswith("not started: "))

    def test_a_host_with_no_supervisor_still_gets_both(self):
        # The supervisor is optional and must stay optional. A host running one
        # agent and no supervisor has to keep working exactly as it did.
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering(NO_SUPERVISOR, seen)):
            report = steps.start_processes("watcher")
        started = [c for c in seen if c[:2] == ["pm2", "start"]][0]
        self.assertEqual(started[started.index("--only") + 1], "watcher-adapter,watcher-attendant")
        self.assertEqual(report["started"], ["watcher-adapter", "watcher-attendant"])
        self.assertTrue(report["attendant"].startswith("started: "))

    def test_the_adapter_is_started_whatever_the_answer_is(self):
        # It holds the mailbox and the agent's address, and a Cloud Run job has
        # neither and does not exist between executions.
        for rows in (SUPERVISOR_ONLINE, NO_SUPERVISOR, SUPERVISOR_STOPPED):
            with mock.patch("steps.subprocess.run", pm2_answering(rows)):
                procs, _, _ = steps.agent_procs("watcher")
            self.assertEqual(procs[0], "watcher-adapter")

    def test_a_model_change_restarts_only_what_this_host_started(self):
        # pm2 refuses to restart a name it does not hold, and `model` restarts
        # through run(), which fails the whole procedure on a nonzero exit. A
        # model change that named the attendant would fail at its last step
        # having already done everything.
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
            procs, _, _ = steps.agent_procs("watcher")
        self.assertNotIn("watcher-attendant", procs)


class TheConfigStillDeclaresTheAttendant(unittest.TestCase):
    """Not starting it is not the same as not declaring it, and the difference
    is the whole fleet going deaf."""

    def test_the_generated_pm2_config_writes_an_attendant_entry_per_agent(self):
        # runtime/fleet/roster.mjs builds the supervisor's roster out of the
        # attendant entries in this file and out of nothing else, reading
        # AGENT_NAME, BRAIN, WORK_TIMEOUT, WANTS_REPLIES and RUN_SPEC off each
        # one. An agent with no entry is an agent the supervisor never watches.
        self.assertIn("${a.name}-attendant", steps.PM2_CONF)
        self.assertIn("AGENT_NAME: a.name", steps.PM2_CONF)
        self.assertIn("${a.name}-adapter", steps.PM2_CONF)


class AnOwnerCanHoldAnAgentToFewerJobsAtOnce(unittest.TestCase):
    """process-runner's jobs rewrite one run's state.json on the shared mount,
    and the supervisor ran up to ten of them at once: "stale file handle", or a
    turn's events quietly lost (2026-09-24). The supervisor already honoured
    JOBS_AT_ONCE on the attendant entry; nothing a deploy wrote could put it
    there, so the only way to set it was a hand edit that the next inventory
    change wiped out. Now it is a fact on the inventory row, from the
    instruction or from `jobs-at-once`, and the generated entry carries it."""

    def tearDown(self):
        steps.save_json_list(steps.LIST, [])

    def test_the_word_is_a_whole_number_from_one_to_ten_or_nothing(self):
        self.assertIsNone(steps.jobs_at_once_of({}))
        self.assertIsNone(steps.jobs_at_once_of({"jobs_at_once": None}))
        self.assertEqual(steps.jobs_at_once_of({"jobs_at_once": 1}), 1)
        self.assertEqual(steps.jobs_at_once_of({"jobs_at_once": 10}), 10)
        # A typo must not become a ceiling: nought stops the agent dead, a word
        # or a flag would read as the default, and more than the default is a
        # different decision from this one.
        for bad in (0, -1, 11, "1", True, 1.5):
            r = Refusal(self, steps.jobs_at_once_of, {"jobs_at_once": bad})
            self.assertEqual(r.doc["step"], "validate")
            self.assertIn("jobs_at_once", r.doc["error"])
            self.assertEqual(r.doc["state"], "nothing created")

    def test_a_deploy_with_a_bad_number_is_refused_before_the_unix_user_exists(self):
        os.makedirs(os.path.join(TMP, "tmp"), exist_ok=True)
        argfile = f"{steps.DM_HOME}/tmp/deploy-watcher-jobs.json"
        steps.write_text(argfile, json.dumps({
            "name": "watcher", "harness": "opencode", "interaction": "service", "admit": [],
            "boot_token": "watcher-boot", "package_url": "https://agentcatalog.com/x/package.tar.gz",
            "jobs_at_once": 0}))
        with mock.patch.object(steps, "user_exists", lambda name: False):
            r = Refusal(self, steps.deploy, argfile)
        self.assertEqual(r.doc["step"], "validate")
        self.assertIn("jobs_at_once", r.doc["error"])
        self.assertEqual(r.doc["state"], "nothing created")
        self.assertEqual(steps.load_list(), [], "no row was written for an agent that was refused")

    def test_an_update_that_does_not_mention_it_keeps_what_the_row_has(self):
        entry = {"name": "process-runner", "jobs_at_once": 1}
        self.assertEqual(steps.apply_jobs_at_once(entry, {"package_url": "x"}), 1)
        self.assertEqual(entry["jobs_at_once"], 1, "a new version is not a reason to forget the owner's number")
        steps.apply_jobs_at_once(entry, {"jobs_at_once": 3})
        self.assertEqual(entry["jobs_at_once"], 3, "an instruction that says a number is taken")
        steps.apply_jobs_at_once(entry, {"jobs_at_once": None})
        self.assertNotIn("jobs_at_once", entry, "null takes it off, back to the supervisor's default")

    def test_the_verb_sets_and_clears_the_row_and_rewrites_the_config(self):
        steps.save_json_list(steps.LIST, [{"name": "alpha", "package": "alpha"},
                                          {"name": "process-runner", "package": "process-runner"}])
        doc = emitted(self, steps.set_jobs_at_once, "process-runner", "1")
        self.assertTrue(doc["ok"], doc)
        self.assertEqual((doc["was"], doc["now"]), (None, 1))
        rows = steps.load_list()
        self.assertEqual([r["name"] for r in rows], ["alpha", "process-runner"], "the other rows keep their order")
        self.assertEqual(rows[1]["jobs_at_once"], 1)
        self.assertNotIn("jobs_at_once", rows[0], "one agent's number is nobody else's")
        with open(steps.CONF, encoding="utf-8") as f:
            written = f.read()
        self.assertEqual(written, steps.PM2_CONF.replace("__CATALOG_URL__", steps._am_env("urls.catalog")),
                         "the config is rewritten from the template that carries it")
        self.assertNotIn("__CATALOG_URL__", written, "the catalog's address comes from the environment")
        self.assertIn('CATALOG_URL: "https://', written)
        # Run twice, the same answer and the same row.
        again = emitted(self, steps.set_jobs_at_once, "process-runner", "1")
        self.assertEqual((again["was"], again["now"]), (1, 1))
        back = emitted(self, steps.set_jobs_at_once, "process-runner", "default")
        self.assertEqual((back["was"], back["now"]), (1, None))
        self.assertNotIn("jobs_at_once", steps.load_list()[1])

    def test_the_verb_refuses_a_bad_number_and_an_agent_it_does_not_hold(self):
        steps.save_json_list(steps.LIST, [{"name": "process-runner"}])
        for word in ("0", "11", "ten", ""):
            r = Refusal(self, steps.set_jobs_at_once, "process-runner", word)
            self.assertEqual(r.doc["step"], "validate", word)
        r = Refusal(self, steps.set_jobs_at_once, "nobody-here", "1")
        self.assertIn("not in the deployment inventory", r.doc["error"])
        self.assertEqual(steps.load_list(), [{"name": "process-runner"}], "a refusal changes nothing")

    @unittest.skipUnless(shutil.which("node"), "needs node to load the generated config the way pm2 and the roster do")
    def test_the_generated_config_hands_the_number_to_the_attendant_entry(self):
        # The template itself, loaded by node the way pm2 and runtime/fleet/
        # roster.mjs load it, against an inventory written here.
        d = tempfile.mkdtemp(prefix="dm-conf-")
        self.addCleanup(shutil.rmtree, d, True)
        inventory = os.path.join(d, "deploymgr-agents.json")
        with open(inventory, "w", encoding="utf-8") as f:
            json.dump([{"name": "alpha"},
                       {"name": "process-runner", "jobs_at_once": 1},
                       {"name": "typo", "jobs_at_once": "3"}], f)
        config = os.path.join(d, "deploymgr-agents.config.cjs")
        with open(config, "w", encoding="utf-8") as f:
            f.write(steps.PM2_CONF.replace('require("/opt/fleet/deploymgr-agents.json")',
                                           f"require({json.dumps(inventory)})"))
        p = subprocess.run(["node", "-e", "process.stdout.write(JSON.stringify(require(process.env.CONF).apps))"],
                           capture_output=True, text=True, env={**os.environ, "CONF": config}, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        env = {a["name"]: a.get("env", {}) for a in json.loads(p.stdout)}
        self.assertEqual(env["process-runner-attendant"].get("JOBS_AT_ONCE"), "1")
        self.assertNotIn("JOBS_AT_ONCE", env["alpha-attendant"], "no number on the row, no number on the entry")
        self.assertNotIn("JOBS_AT_ONCE", env["typo-attendant"], "a string on the row is not a number the entry believes")
        self.assertNotIn("JOBS_AT_ONCE", env["process-runner-adapter"], "the adapter is not what the roster reads it from")


class WhatTheStackBoundTravelsWithTheInstruction(unittest.TestCase):
    """The account binds its products in the app; the deployment record has to
    be able to say afterwards what this agent was bound to and who chose it.

    The one thing that must never happen is a VALUE arriving here. The record is
    published and the rule is absolute, so an instruction carrying one is
    refused outright rather than cleaned up, because a caller that tried it is
    a caller to fix."""

    def test_an_instruction_with_no_bindings_is_a_deploy_like_any_other(self):
        self.assertEqual(steps.read_stack_bindings({}), [])

    def test_the_names_and_the_precedence_step_come_through(self):
        out = steps.read_stack_bindings({"stack_bindings": [
            {"system": "database", "product": "supabase", "environment": "production",
             "precedence": "organisation", "provided_by": "customer",
             "credential": "supabase-database-production", "address": "https://acme.supabase.co",
             "checked": "not yet", "key_store": {"kind": "google-secret-manager", "project": "acme-prod-1528148150979"}},
        ]})
        self.assertEqual(out[0]["system"], "database")
        self.assertEqual(out[0]["precedence"], "organisation")
        self.assertEqual(out[0]["credential"], "supabase-database-production")

    def test_the_record_says_which_store_the_name_is_looked_up_in(self):
        out = steps.read_stack_bindings({"stack_bindings": [
            {"system": "database", "product": "supabase", "checked": "worked",
             "key_store": {"kind": "google-secret-manager", "project": "acme-prod", "by": "jeff@example.com"}},
        ]})
        self.assertEqual(out[0]["checked"], "worked")
        # Only the three plain members travel; who set it is the platform's record.
        self.assertEqual(out[0]["key_store"], {"kind": "google-secret-manager", "project": "acme-prod"})

    def test_a_word_from_the_deleted_design_is_dropped(self):
        out = steps.read_stack_bindings({"stack_bindings": [{"system": "database", "proven": True}]})
        self.assertNotIn("proven", out[0])

    def test_a_value_dressed_as_a_credential_name_is_refused(self):
        r = Refusal(self, steps.read_stack_bindings,
                    {"stack_bindings": [{"system": "database", "credential": "sb_secret_9aF2KdLpQ1xZ"}]})
        self.assertIn("must be a NAME", r.doc["error"])

    def test_a_binding_carrying_a_value_is_refused(self):
        r = Refusal(self, steps.read_stack_bindings,
                    {"stack_bindings": [{"system": "database", "value": "sk-live-something"}]})
        self.assertEqual(r.doc["step"], "validate")
        self.assertIn("value belongs in no record", r.doc["error"])

    def test_something_that_is_not_a_list_of_bindings_is_refused(self):
        r = Refusal(self, steps.read_stack_bindings, {"stack_bindings": "database"})
        self.assertIn("list of bindings", r.doc["error"])

    def test_a_binding_with_no_system_is_refused(self):
        r = Refusal(self, steps.read_stack_bindings, {"stack_bindings": [{"product": "supabase"}]})
        self.assertIn("names a system", r.doc["error"])

    def test_the_record_carries_them_and_leaves_them_out_when_there_are_none(self):
        import record
        with_bindings = record.placed_part({"credentials_placed": ["k"], "bindings": [{"system": "database"}]})
        without = record.placed_part({"credentials_placed": ["k"]})
        self.assertEqual(with_bindings["bindings"][0]["system"], "database")
        self.assertNotIn("bindings", without)


if __name__ == "__main__":
    unittest.main()


class TheMachineOneMessageGets(unittest.TestCase):
    """Cloud Run's own default is 512Mi and one core, which passes a probe and
    dies on real work. The deploy has to choose, and the owner's own numbers
    still win."""

    def test_a_package_that_wakes_a_model_gets_room(self):
        mem, cpu = steps.machine_for({"install": {"harness": {"name": "opencode"}}})
        self.assertEqual((mem, cpu), ("4Gi", "2"))

    def test_a_package_that_names_a_command_needs_little(self):
        pkg = {"install": {"run": {"do-a-thing": {"command": ["node", "x.mjs"]}}}}
        mem, cpu = steps.machine_for(pkg)
        self.assertEqual((mem, cpu), ("1Gi", "1"))

    def test_a_command_that_drives_a_browser_gets_room(self):
        # The animation renderer, killed for memory at 1Gi on 2026-09-23.
        pkg = {"install": {"run": {"render-video": {"command": ["node", "r.mjs"]}},
                           "binaries": [{"name": "chromium"}, {"name": "ffmpeg"}]}}
        self.assertEqual(steps.machine_for(pkg), ("4Gi", "2"))

    def test_an_unreadable_install_errs_toward_room(self):
        # Guessing small is the failure that kills a job with exit 137 and no
        # sentence anybody can act on; guessing large only costs money.
        self.assertEqual(steps.machine_for(None), ("4Gi", "2"))


class WhatTheAgentCharges(unittest.TestCase):
    """The price a package declares is placed where the agent's own node reads
    it, with the provider this deployment bills through added.

    The file it writes was placed by hand on the host until now, which is the
    thing a package exists to stop: nothing said what an agent charged except
    the machine it was charging from, a rebuild lost it, and the inventory
    could not tell a free agent from one whose price somebody forgot to put
    back. What is worth pinning: the provider and its address come from this
    side and never from a package; a package that declares no price places no
    file at all, because free is the default; a package that says free out
    loud does get one, because those are different statements; a version that
    drops its price takes the old file away; and a malformed price is refused
    rather than placed, since the node checks it again at start and would not
    come up.
    """

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dm-price-")
        os.makedirs(f"{self.home}/.agentmesh/adapter")
        self.path = f"{self.home}/.agentmesh/adapter/price.json"
        # chown is the only thing write_text shells out for, and these tests
        # own no unix user to chown to.
        patch = mock.patch.object(steps, "run", lambda *a, **k: "")
        patch.start()
        self.addCleanup(patch.stop)

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def pkg(self, price=None):
        install = {"format": "agent-install-v1"}
        if price is not None:
            install["price"] = price
        return {"manifest": {"name": "brief-writer", "version": "0.4.2"}, "install": install}

    def placed(self):
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    FLAT = {"sku": "default", "covers": {"agent": True},
            "price": {"model": "flat", "amount_micro": 2000000, "currency": "USD"}}

    def test_the_declared_price_is_placed_with_the_provider_this_side_adds(self):
        report = steps.write_price("brief-writer", self.home, self.pkg(self.FLAT))
        self.assertEqual(self.placed(), {
            **self.FLAT,
            "provider": {"id": "internal", "checkout_url": steps.CHECKOUT_URL}})
        self.assertEqual(report["model"], "flat")
        self.assertEqual(report["amount_micro"], 2000000)
        self.assertEqual(report["covers"], "the whole agent")

    def test_the_approval_address_is_load_bearing_and_never_comes_from_the_package(self):
        # Without provider.checkout_url the SDK's agreement gate admits the
        # work anyway rather than refusing a buyer with nowhere to go, so a
        # price placed without one is advertised and never enforced.
        steps.write_price("brief-writer", self.home, self.pkg(self.FLAT))
        self.assertTrue(self.placed()["provider"]["checkout_url"])
        # And a package cannot smuggle one in: the provider it names is not read.
        steps.write_price("brief-writer", self.home,
                          self.pkg({**self.FLAT, "provider": {"id": "somebody-else"}}))
        self.assertEqual(self.placed()["provider"]["id"], "internal")

    def test_a_package_with_no_price_places_nothing(self):
        self.assertIsNone(steps.write_price("brief-writer", self.home, self.pkg()))
        self.assertFalse(os.path.exists(self.path))

    def test_free_said_out_loud_is_placed_and_free_by_silence_is_not(self):
        free = {"sku": "default", "covers": {"agent": True}, "price": {"model": "free"}}
        report = steps.write_price("process-runner", self.home, self.pkg(free))
        self.assertEqual(self.placed()["price"], {"model": "free"})
        self.assertEqual(report["model"], "free")
        self.assertNotIn("amount_micro", report)

    def test_a_version_that_drops_its_price_takes_the_old_file_away(self):
        steps.write_price("brief-writer", self.home, self.pkg(self.FLAT))
        self.assertTrue(os.path.exists(self.path))
        self.assertIsNone(steps.write_price("brief-writer", self.home, self.pkg()))
        self.assertFalse(os.path.exists(self.path))

    def test_a_price_covering_named_offerings_is_placed_and_reported_by_name(self):
        sku = {"sku": "default", "covers": {"offerings": ["make-an-explainer"]},
               "price": {"model": "flat", "amount_micro": 5000000, "currency": "USD"}}
        report = steps.write_price("explainer-maker", self.home, self.pkg(sku))
        self.assertEqual(self.placed()["covers"], {"offerings": ["make-an-explainer"]})
        self.assertEqual(report["covers"], "make-an-explainer")

    def test_a_malformed_price_is_refused_and_nothing_is_placed(self):
        for sku, phrase in (
            ({**self.FLAT, "price": {"model": "flat", "amount_micro": 2.5, "currency": "USD"}},
             "whole number of micro-units"),
            ({**self.FLAT, "price": {"model": "flat", "amount_micro": 200, "currency": "dollars"}},
             "three-letter code"),
            ({**self.FLAT, "price": {"model": "hourly", "amount_micro": 200, "currency": "USD"}},
             "is not one of free, flat"),
            ({**self.FLAT, "price": {"model": "free", "amount_micro": 200}},
             "not a field of that shape"),
            ({**self.FLAT, "covers": {}}, "one or the other"),
            ({**self.FLAT, "covers": {"agent": True, "offerings": ["x"]}}, "one or the other"),
            ({**self.FLAT, "covers": {"offerings": []}}, "is empty"),
            ({**self.FLAT, "sku": "Default"}, "not lowercase letters"),
            ({"covers": {"agent": True}, "price": {"model": "free"}}, "not lowercase letters"),
            ("$2.00", "not an object"),
        ):
            doc = emitted(self, steps.write_price, "brief-writer", self.home, self.pkg(sku))
            self.assertFalse(doc["ok"], sku)
            self.assertEqual(doc["step"], "price")
            self.assertIn(phrase, doc["error"])
            self.assertFalse(os.path.exists(self.path), sku)

    def test_a_metered_price_the_node_would_refuse_is_refused_here(self):
        # The deeper shapes matter because the agent's node validates them at
        # start: a price that gets past this side does not fail quietly, it
        # stops the adapter coming up.
        for price, phrase in (
            ({"model": "per_unit", "amount_micro": 1500, "currency": "USD"}, "name the meter it rates"),
            ({"model": "per_unit", "amount_micro": 1500, "currency": "USD", "meter": "tokens_out",
              "included": {"quantity": 5}}, "a period of day or month"),
            ({"model": "package", "amount_micro": 1500, "currency": "USD", "meter": "tokens_out",
              "period": "month"}, "whole size above zero"),
            ({"model": "tiered", "currency": "USD", "meter": "tokens_out", "period": "month",
              "tiers": [{"up_to": 10, "amount_micro": 5}, {"up_to": 20, "amount_micro": 4}]},
             "last tier is unbounded"),
        ):
            doc = emitted(self, steps.write_price, "brief-writer", self.home,
                          self.pkg({**self.FLAT, "price": price}))
            self.assertFalse(doc["ok"], price)
            self.assertIn(phrase, doc["error"])

    def test_a_failed_update_takes_away_a_price_the_old_version_never_had(self):
        # restore() puts back what the snapshot holds, and a snapshot of a
        # version with no price holds no price.json to copy over the new one.
        # A restored agent still charging the failed version's price is the
        # worst shape this can take.
        steps.write_price("brief-writer", self.home, self.pkg(self.FLAT))
        root = tempfile.mkdtemp(prefix="dm-price-prev-")
        self.addCleanup(shutil.rmtree, root, True)
        with mock.patch("steps.subprocess.run", pm2_answering([])):
            steps.restore("brief-writer", self.home, {"files": [], "outside": []}, root, "brief-writer")
        self.assertFalse(os.path.exists(self.path))

    def test_a_placed_price_reaches_the_deploy_record(self):
        # The record names the ceilings the deploy set; a price the deploy
        # placed belongs beside them, or the owner's own signed account of
        # the deploy does not say what the agent charges.
        #
        # Imported here rather than at the top of the file because a helper
        # above already takes an argument called `record`, and a module of
        # that name at file scope is a trap waiting for whoever edits it next.
        import record
        report = steps.write_price("brief-writer", self.home, self.pkg(self.FLAT))
        placed = record.placed_part({"ceilings": [], "price": report})
        self.assertEqual(placed["price"], report)
        # And absent where nothing was placed: free is the default, and a
        # record stating a price of nothing would be a record stating terms.
        self.assertNotIn("price", record.placed_part({"ceilings": []}))

    def test_a_malformed_price_refuses_before_the_unix_user_exists(self):
        # The same refusal, made at step 2's place in the order. A deploy that
        # discovered a bad price at the step that places it would already have
        # made a user, a home and an identity for an agent it then refused.
        args = {"name": "watcher", "harness": "opencode", "interaction": "service"}
        bad = self.pkg({**self.FLAT, "price": {"model": "flat", "amount_micro": 2.5, "currency": "USD"}})
        doc = emitted(self, steps.check_before_touching, args, bad)
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["step"], "price")
        self.assertIn("whole number of micro-units", doc["error"])
        self.assertEqual(doc["state"], "nothing created")
        # And a sound one passes the same gate without refusing anything.
        self.assertIsNone(steps.check_before_touching(args, self.pkg(self.FLAT)))
        self.assertIsNone(steps.check_before_touching(args, self.pkg()))


# -- running an agent inside a CUSTOMER's own cloud project ----------------

THEIRS = "acme-analytics-42"
THEIR_ACCOUNT = f"agentmesh-deploy@{THEIRS}.iam.gserviceaccount.com"
GRANT = {"provider": "gcp", "project": THEIRS, "impersonate": THEIR_ACCOUNT}
CUSTOMER_ARGS = {**PLACED_ARGS, "project": THEIRS, "cloud": GRANT}
# The account a customer grants to: ours, holding no role in our own project,
# and the middle of the chain. This host's machine identity becomes it and it
# becomes theirs. OURS FIRST AND THEIRS LAST is the order gcloud reads, and the
# last account in the list is the identity acted as.
OURS = "agentmesh-deployer@langbench-1528148150979.iam.gserviceaccount.com"
IMPERSONATION = f"--impersonate-service-account={OURS},{THEIR_ACCOUNT}"


def gcloud_answering(record_to, returncode=0, stderr="", stdout="", only=None):
    """subprocess.run with gcloud answering every call this way. `only` is the
    leading words of the one command that answers differently, so a test can
    make a single call fail the way a revocation or an outage fails."""
    def fake(cmd, *a, **k):
        record_to.append({"cmd": list(cmd), "input": k.get("input")})
        if list(cmd[:2]) == ["pm2", "jlist"]:
            return subprocess.CompletedProcess(cmd, 0, json.dumps(SUPERVISOR_ONLINE), "")
        plain = [c for c in cmd if not c.startswith("-")]
        if only is None or plain[1:1 + len(only)] == list(only):
            return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)
        return subprocess.CompletedProcess(cmd, 0, stdout, "")
    return fake


def gcloud_calls(rows):
    """Just the gcloud argument vectors out of a recording, in order."""
    return [r["cmd"] for r in rows if r["cmd"][0] == steps.GCLOUD]


def on_a_host_set_up_for_customers(test):
    """Clear whatever the last act was in the middle of, and give this host the
    deployer service account a real one has.

    One process runs one act, so steps.py never clears the context itself; a
    test file runs many, and a grant left over from the last one would be a call
    made in a customer's project by a test that never mentioned one.

    DEPLOYER_SA is read from the environment at import, so it is empty here and
    on any developer machine. Set for these tests because the alternative to
    having it is a refusal, which is what AHostWithNoDeployerAccountCannotAct
    below is for.
    """
    steps.CURRENT["cloud"] = None
    test.addCleanup(steps.CURRENT.update, {"cloud": None})
    patch = mock.patch.object(steps, "DEPLOYER_SA", OURS)
    patch.start()
    test.addCleanup(patch.stop)


class WithNoGrantTheCallIsTheCallItAlwaysWas(unittest.TestCase):
    """The promise that makes the whole of this safe to ship. An instruction
    that names no customer has to produce, byte for byte, the calls this
    deployer made before any of it existed: our project, our credentials, and
    no impersonation flag anywhere."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    def test_no_cloud_block_means_no_flag_on_any_call(self):
        seen = []
        steps.enter_cloud(dict(PLACED_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
            steps.gcloud_quiet(["run", "jobs", "describe", "watcher-worker"], 10)
            steps.gcs_read("gs://example-agent-state/jobs/watcher/x/outcome.json")
            steps.job_exists({"job": "watcher-worker", "region": "us-central1"})
        self.assertEqual(len(gcloud_calls(seen)), 4)
        for cmd in gcloud_calls(seen):
            self.assertEqual(cmd[0], steps.GCLOUD)
            self.assertNotIn("impersonate", " ".join(cmd))
            # The first argument after the program is still the command group,
            # which is what every reader of this host's process list expects.
            self.assertFalse(cmd[1].startswith("-"), cmd)

    def test_the_removal_of_an_agent_of_ours_calls_what_it_always_called(self):
        seen = []
        entry = {"name": "watcher", "job": "watcher-worker", "region": "us-central1",
                 "binding": "gs://example-agent-state/bindings/watcher"}
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.take_down_container("watcher", entry)
        self.assertEqual(gcloud_calls(seen), [
            [steps.GCLOUD, "run", "jobs", "delete", "watcher-worker", "--region", "us-central1", "--quiet"],
            [steps.GCLOUD, "storage", "rm", "--recursive",
             "gs://example-agent-state/bindings/watcher", "--quiet"]])

    def test_an_act_of_ours_discloses_nothing_because_there_is_nobody_to_disclose_to(self):
        steps.enter_cloud(dict(PLACED_ARGS), "deploy")
        self.assertEqual(steps.cloud_report(), {})

    def test_the_project_is_read_the_way_it_always_was(self):
        self.assertEqual(steps.enter_cloud({"project": "langbench-1528148150979"}, "deploy"),
                         "langbench-1528148150979")
        with mock.patch.object(steps, "PROJECT", "langbench-1528148150979"):
            self.assertEqual(steps.enter_cloud({}, "deploy"), "langbench-1528148150979")


class EveryCallInTheirProjectIsUnderTheirAccount(unittest.TestCase):
    """A call that skipped the seam would run as US inside THEIR project, which
    is the exact failure this route exists to prevent. There is one seam with
    two doors and the flag goes on at the seam, so a call site cannot forget
    it."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    def test_every_door_of_the_seam_carries_the_impersonation(self):
        seen = []
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
            steps.gcloud_quiet(["run", "jobs", "describe", "watcher-worker"], 10)
            steps.gcs_read("gs://their-bucket/jobs/watcher/x/outcome.json")
            steps.job_exists({"job": "watcher-worker", "region": "us-central1", "project": THEIRS})
        calls = gcloud_calls(seen)
        self.assertEqual(len(calls), 4)
        for cmd in calls:
            # Immediately after the program name: gcloud reads it anywhere, and
            # every other position is somewhere among a subcommand's own
            # positional arguments.
            self.assertEqual(cmd[:2], [steps.GCLOUD, IMPERSONATION], cmd)

    def test_the_chain_is_ours_then_theirs_and_the_last_one_is_who_we_become(self):
        # Backwards, this either fails in a way that reads like a revocation or,
        # if both bindings happen to exist, works as the wrong identity. gcloud
        # takes the LAST account in the list as the one to act as and everything
        # before it as a hop: verified against its own source
        # (ParseImpersonationAccounts returns ids[-1] as the target) and against
        # a live read-only run, which answered "All API calls will be executed
        # as [<the last one>] ... via delegate chain: <ours>".
        seen = []
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
        flag = gcloud_calls(seen)[0][1]
        self.assertEqual(flag, f"--impersonate-service-account={OURS},{THEIR_ACCOUNT}")
        chain = flag.split("=", 1)[1].split(",")
        self.assertEqual(chain, [OURS, THEIR_ACCOUNT])
        # And one flag carrying both, never two flags: gcloud reads the last
        # occurrence of a flag, so a second one would silently drop the chain.
        self.assertEqual(len([a for a in gcloud_calls(seen)[0] if a.startswith("--impersonate")]), 1)

    def test_a_removal_in_their_project_is_under_their_account_too(self):
        # `remove` is given a name and nothing else, so the grant can only come
        # off the row the deploy wrote. Without it an agent could be deployed
        # into a customer's project and never taken back out of it.
        seen = []
        entry = {"name": "watcher", "job": "watcher-worker", "region": "us-central1",
                 "project": THEIRS, "cloud": GRANT,
                 "binding": "gs://their-bucket/bindings/watcher"}
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.take_down_container("watcher", entry)
        calls = gcloud_calls(seen)
        self.assertEqual(len(calls), 2)
        for cmd in calls:
            self.assertEqual(cmd[:2], [steps.GCLOUD, IMPERSONATION], cmd)

    def test_a_row_with_no_grant_removes_from_our_project(self):
        seen = []
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.take_down_container("watcher", {"name": "watcher", "job": "watcher-worker",
                                                  "region": "us-central1"})
        self.assertEqual(gcloud_calls(seen)[0][:2], [steps.GCLOUD, "run"])

    def test_the_job_in_their_project_runs_as_the_account_they_granted(self):
        # Not the default compute account, which is the account with Editor on
        # everything else in their project and the last thing an agent's
        # container should be. Ours keeps the default it always had.
        spec = {"job": "watcher-worker", "image": PINNED, "region": "us-central1",
                "project": THEIRS, "bucket": "their-bucket", "env_file": "/tmp/env.yaml",
                "service_account": THEIR_ACCOUNT}
        argv = steps.IMAGE.create_job_argv(spec)
        self.assertIn("--service-account", argv)
        self.assertEqual(argv[argv.index("--service-account") + 1], THEIR_ACCOUNT)
        self.assertNotIn("--service-account",
                         steps.IMAGE.create_job_argv({k: v for k, v in spec.items()
                                                      if k != "service_account"}))


class AMixedUpPairingIsRefusedBeforeAnythingIsCalled(unittest.TestCase):
    """One deployer service account holds grants from many customers, so a bug
    in any of this shows up as acting in one customer's project with another
    customer's account. The guard costs nothing and runs every time."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    def test_a_disagreeing_project_and_account_is_refused_with_nothing_called(self):
        seen = []
        bad = {**GRANT, "impersonate": "agentmesh-deploy@globex-media-77.iam.gserviceaccount.com"}
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            doc = emitted(self, steps.enter_cloud, {"name": "watcher", "cloud": bad}, "deploy")
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["step"], "cloud")
        self.assertIn(THEIRS, doc["error"])
        self.assertIn("globex-media-77", doc["error"])
        self.assertEqual(doc["state"], "nothing created")
        # BEFORE any call is made, because after the first call the wrong thing
        # has already happened in somebody's account and no refusal undoes it.
        self.assertEqual(seen, [])

    def test_the_refusal_happens_before_the_unix_user_exists(self):
        bad = {**GRANT, "project": "globex-media-77"}
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
            r = Refusal(self, steps.check_placement_before_touching, {**CUSTOMER_ARGS, "cloud": bad})
        self.assertEqual(r.doc["step"], "cloud")

    def test_a_grant_and_a_host_placement_are_two_instructions(self):
        # The customer would be told their agent runs in their cloud while it
        # ran on a VM of ours beside fifteen others.
        r = Refusal(self, steps.placement_of,
                    {**CUSTOMER_ARGS, "placement": "host", "host_because": "iterating"})
        self.assertEqual(r.doc["step"], "placement")
        self.assertIn(THEIRS, r.doc["error"])

    def test_a_good_pairing_passes_and_names_their_project(self):
        self.assertEqual(steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy"), THEIRS)
        # Read off the grant, so there is one answer to "which project" in the
        # same object as the account it pairs with.
        self.assertEqual(steps.cloud_now()["grant"], GRANT)


class ARevocationReadsDifferentlyFromAnOutage(unittest.TestCase):
    """Retrying a revocation forever is how a vendor becomes a nuisance, so
    what the deployer hands back has to say which of the two it just met."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    @staticmethod
    def act(args):
        steps.enter_cloud(args, "deploy")
        steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)

    def refused(self, stderr, returncode=1):
        with mock.patch("steps.subprocess.run", gcloud_answering([], returncode, stderr)):
            return emitted(self, self.act, dict(CUSTOMER_ARGS))

    def test_a_revocation_is_named_as_one_and_is_not_retryable(self):
        doc = self.refused(f"ERROR: Failed to impersonate [{THEIR_ACCOUNT}]. Make sure the account "
                           f"trying to impersonate it has the roles/iam.serviceAccountTokenCreator role.")
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["cloud"]["outcome"], "revoked")
        # The contract's own word, so the platform half can store it.
        self.assertEqual(doc["cloud"]["state"], "revoked")
        self.assertIs(doc["cloud"]["retryable"], False)
        # And it reads calmly, naming what happened and what would restore it.
        self.assertIn("roles/iam.serviceAccountTokenCreator", doc["error"])
        self.assertIn("nothing was retried", doc["error"])
        # gcloud's own words are still there, under ours.
        self.assertIn("gcloud said:", doc["error"])

    def test_an_outage_is_retryable_and_says_the_grant_is_still_there(self):
        doc = self.refused("ERROR: (gcloud.run.jobs.create) 503 Service Unavailable")
        self.assertEqual(doc["cloud"]["outcome"], "unreachable")
        self.assertEqual(doc["cloud"]["state"], "unreachable")
        self.assertIs(doc["cloud"]["retryable"], True)
        self.assertIn("outage", doc["error"])
        self.assertIn("sent again", doc["error"])

    def test_a_timeout_is_an_outage_and_still_says_what_timed_out(self):
        def slow(cmd, *a, **k):
            raise subprocess.TimeoutExpired(cmd, k.get("timeout", 10))
        with mock.patch("steps.subprocess.run", slow):
            doc = emitted(self, self.act, dict(CUSTOMER_ARGS))
        self.assertEqual(doc["cloud"]["outcome"], "unreachable")
        self.assertIs(doc["cloud"]["retryable"], True)
        self.assertIn("timed out after 10s", doc["error"])

    def test_their_project_refusing_us_a_role_is_neither_of_those(self):
        doc = self.refused("ERROR: PERMISSION_DENIED: The caller does not have permission")
        self.assertEqual(doc["cloud"]["outcome"], "denied")
        # The impersonation WORKED, so the grant is live and the record says so
        # rather than sending a customer to re-grant a binding already there.
        self.assertEqual(doc["cloud"]["state"], "verified")
        self.assertIs(doc["cloud"]["retryable"], False)
        self.assertIn("the grant is in place", doc["error"])

    def test_a_failure_that_says_nothing_about_the_grant_writes_nothing_over_it(self):
        doc = self.refused("ERROR: (gcloud.run.jobs.create) argument --image: expected one argument")
        self.assertEqual(doc["cloud"]["outcome"], "failed")
        self.assertNotIn("state", doc["cloud"])

    def test_a_timeout_on_our_own_project_refuses_exactly_as_it_always_did(self):
        def slow(cmd, *a, **k):
            raise subprocess.TimeoutExpired(cmd, k.get("timeout", 10))
        with mock.patch("steps.subprocess.run", slow):
            doc = emitted(self, self.act, dict(PLACED_ARGS))
        self.assertEqual(doc["error"], "timed out after 10s: gcloud run jobs create")
        self.assertNotIn("cloud", doc)

    def test_a_failure_on_our_own_project_is_what_gcloud_said_and_nothing_added(self):
        with mock.patch("steps.subprocess.run", gcloud_answering([], 1, "ERROR: quota exceeded")):
            doc = emitted(self, self.act, dict(PLACED_ARGS))
        self.assertEqual(doc["error"], "ERROR: quota exceeded")
        self.assertNotIn("cloud", doc)


class NoCallBypassesTheSeam(unittest.TestCase):
    """Six call sites used to start gcloud directly: the mount read, the build
    submit and its follow, the probe execution, the job existence check and
    both halves of a removal. Each of them would have run as US inside THEIR
    project. The guarantee is not that they were all found once; it is that a
    new one cannot be added without this failing."""

    def test_the_program_is_named_in_exactly_two_places(self):
        src = open(os.path.join(HERE, "steps.py"), encoding="utf-8").read()
        uses = [ln.strip() for ln in src.splitlines()
                if "GCLOUD" in ln and not ln.strip().startswith("#")]
        self.assertEqual(len(uses), 2, "a new use of GCLOUD outside the seam:\n" + "\n".join(uses))
        self.assertTrue(uses[0].startswith("GCLOUD = os.environ.get("), uses[0])
        # The one line that builds an argument vector, and it puts the
        # impersonation on. Route a new call through gcloud() or gcloud_quiet()
        # rather than adding a third.
        self.assertIn("CLOUD.flag(", uses[1])

    def test_nobody_spells_the_program_as_a_literal_either(self):
        src = open(os.path.join(HERE, "steps.py"), encoding="utf-8").read()
        self.assertIsNone(re.search(r"subprocess\.run\(\s*\[\s*[\"']gcloud", src))

    def test_the_seam_has_the_two_doors_the_contract_promises(self):
        # docs/customer-cloud-grant-contract.md names one seam and promises the
        # platform half that every call this deployer makes goes through it.
        self.assertTrue(callable(steps.gcloud))
        self.assertTrue(callable(steps.gcloud_quiet))


class TheCustomerIsOwedTheList(unittest.TestCase):
    """Their Cloud Audit Logs already show every call we made. The point of
    ours is that it agrees with theirs and is offered rather than requested."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)
        if os.path.exists(steps.CLOUD_LOG):
            os.remove(steps.CLOUD_LOG)
        self.addCleanup(lambda: os.path.exists(steps.CLOUD_LOG) and os.remove(steps.CLOUD_LOG))

    def test_every_call_in_their_project_is_one_line_in_the_log(self):
        seen = []
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
            steps.gcloud_quiet(["storage", "cp", "/tmp/x", "gs://their-bucket/y", "--quiet"], 10)
        rows = [json.loads(ln) for ln in open(steps.CLOUD_LOG, encoding="utf-8").read().splitlines()]
        self.assertEqual([r["command"] for r in rows], ["run jobs create watcher-worker", "storage cp"])
        for r in rows:
            self.assertEqual(r["project"], THEIRS)
            self.assertEqual(r["service_account"], THEIR_ACCOUNT)
            self.assertEqual(r["outcome"], "ok")
            self.assertEqual(r["act"], "deploy")
            self.assertEqual(r["agent"], "watcher")
            self.assertIn("at", r)
        # And the same list rides in what the act returns, so the platform half
        # stores it beside the deployment record rather than scraping a file.
        self.assertEqual(len(steps.cloud_report()["cloud"]["actions"]), 2)

    def test_a_local_path_or_a_bucket_uri_never_reaches_the_log(self):
        seen = []
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.gcloud(["storage", "cp", "/tmp/dm-watcher-binding/ceilings.json",
                          "gs://their-bucket/bindings/watcher/ceilings.json", "--quiet"], "bind", 10)
        text = open(steps.CLOUD_LOG, encoding="utf-8").read()
        self.assertNotIn("/tmp/", text)
        self.assertNotIn("gs://", text)

    def test_nothing_is_logged_for_a_call_on_our_own_machines(self):
        steps.enter_cloud(dict(PLACED_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering([])):
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
        self.assertFalse(os.path.exists(steps.CLOUD_LOG))

    def test_one_instruction_through_two_procedures_keeps_one_list(self):
        # A placed deploy builds an image and then creates a job. The list the
        # customer is owed is of everything that instruction did in their
        # project, not of whatever the last procedure did.
        steps.enter_cloud(dict(CUSTOMER_ARGS), "build")
        with mock.patch("steps.subprocess.run", gcloud_answering([])):
            steps.gcloud(["builds", "submit", "/tmp/ctx", "--tag", "x"], "image", 10)
            steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
            steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
        self.assertEqual([a["command"] for a in steps.cloud_report()["cloud"]["actions"]],
                         ["builds submit", "run jobs create watcher-worker"])

    def test_the_signed_record_carries_the_same_list(self):
        res = {"ok": True, "act": "deploy", "package": "explainer-maker", "version": "0.4.1",
               "url": "https://agentcatalog.com/x/package.tar.gz", "sha256": "ab" * 32,
               "cloud": {"provider": "gcp", "project": THEIRS, "service_account": THEIR_ACCOUNT,
                         "outcome": "ok", "state": "verified", "retryable": False,
                         "actions": [{"command": "run jobs create watcher-worker", "outcome": "ok"}]}}
        doc = record.build(res, None, "UDM")
        self.assertEqual(doc["cloud"]["project"], THEIRS)
        self.assertEqual(len(doc["cloud"]["actions"]), 1)
        # And absent on an act of ours, the same as every other member that
        # states an observation nobody made.
        self.assertNotIn("cloud", record.build({k: v for k, v in res.items() if k != "cloud"},
                                               None, "UDM"))

    def test_a_refusal_in_their_project_is_recorded_with_the_list_too(self):
        res = {"ok": False, "step": "job", "error": "impersonation refused",
               "cloud": {"provider": "gcp", "project": THEIRS, "service_account": THEIR_ACCOUNT,
                         "outcome": "revoked", "state": "revoked", "retryable": False, "actions": []}}
        doc = record.build(res, None, "UDM")
        self.assertEqual(doc["act"], "refuse")
        self.assertEqual(doc["cloud"]["state"], "revoked")


class TheirSecretsStayTheirs(unittest.TestCase):
    """The agent's model key goes into the CUSTOMER's Secret Manager, created
    under the account they granted, and the job reads it there the same way our
    own jobs read ours. It goes IN and is never read back."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)
        if os.path.exists(steps.CLOUD_LOG):
            os.remove(steps.CLOUD_LOG)
        self.addCleanup(lambda: os.path.exists(steps.CLOUD_LOG) and os.remove(steps.CLOUD_LOG))
        self.patches = [mock.patch.object(steps, "store_has", lambda n: n == "fleet-gemini-api-key"),
                        mock.patch.object(steps, "store_read", lambda n: "AIza-the-actual-key")]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def place(self, seen, describe_returncode=1):
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        with mock.patch("steps.subprocess.run",
                        gcloud_answering(seen, describe_returncode,
                                         "NOT_FOUND: Secret not found", only=("secrets", "describe"))):
            return steps.place_secrets_in_their_project(["fleet-gemini-api-key"], THEIRS)

    def test_a_secret_their_project_does_not_have_is_created_and_given_a_version(self):
        seen = []
        self.assertEqual(self.place(seen), ["fleet-gemini-api-key"])
        commands = [[c for c in cmd if not c.startswith("-")][1:4] for cmd in gcloud_calls(seen)]
        self.assertEqual(commands, [["secrets", "describe", "fleet-gemini-api-key"],
                                    ["secrets", "create", "fleet-gemini-api-key"],
                                    ["secrets", "versions", "add"],
                                    ["secrets", "add-iam-policy-binding", "fleet-gemini-api-key"]])
        for cmd in gcloud_calls(seen):
            self.assertEqual(cmd[:2], [steps.GCLOUD, IMPERSONATION], cmd)
            self.assertIn("--project", cmd)
            self.assertEqual(cmd[cmd.index("--project") + 1], THEIRS)

    def test_a_secret_already_there_gets_a_version_and_is_not_recreated(self):
        # A rotation is a version, and a deploy that deleted and recreated the
        # secret would break every other job in their project pointing at it.
        seen = []
        self.place(seen, describe_returncode=0)
        commands = [[c for c in cmd if not c.startswith("-")][1:3] for cmd in gcloud_calls(seen)]
        self.assertEqual(commands, [["secrets", "describe"], ["secrets", "versions"],
                                    ["secrets", "add-iam-policy-binding"]])

    def test_the_container_is_let_read_that_secret_and_no_other(self):
        # The whole reason the published page may say we cannot reach a secret
        # we did not create. The cheap way to make the key readable is
        # roles/secretmanager.secretAccessor on the PROJECT, which reaches every
        # secret the customer has; this is the same role on the one secret we
        # just placed.
        seen = []
        self.place(seen)
        binding = [cmd for cmd in gcloud_calls(seen) if "add-iam-policy-binding" in cmd]
        self.assertEqual(len(binding), 1)
        cmd = binding[0]
        # Named on the secret, not on the project: the secret's id is the
        # positional argument, and --project only says where to find it.
        self.assertEqual([c for c in cmd if not c.startswith("-")][1:4],
                         ["secrets", "add-iam-policy-binding", "fleet-gemini-api-key"])
        self.assertEqual(cmd[cmd.index("--role") + 1], "roles/secretmanager.secretAccessor")
        self.assertEqual(cmd[cmd.index("--member") + 1], f"serviceAccount:{THEIR_ACCOUNT}")
        self.assertEqual(cmd[cmd.index("--project") + 1], THEIRS)
        self.assertEqual(cmd[:2], [steps.GCLOUD, IMPERSONATION])
        # And it is written after the value is there, so the account is never
        # let at an empty secret and then told to start.
        commands = [[c for c in cmd if not c.startswith("-")][1:3] for cmd in gcloud_calls(seen)]
        self.assertEqual(commands[-2:], [["secrets", "versions"], ["secrets", "add-iam-policy-binding"]])

    def test_the_binding_names_the_second_account_where_the_customer_split_them(self):
        # The page offers a reviewer who will not accept a deployer that can
        # read the secrets it placed a split: the deploy account holds
        # everything except the power to read a value, and a second account
        # holds only that and is what the container runs as. The binding has to
        # follow the container.
        runner = f"agentmesh-runtime@{THEIRS}.iam.gserviceaccount.com"
        seen = []
        steps.enter_cloud({**CUSTOMER_ARGS, "cloud": {**GRANT, "runs_as": runner}}, "deploy")
        with mock.patch("steps.subprocess.run",
                        gcloud_answering(seen, 1, "NOT_FOUND: Secret not found",
                                         only=("secrets", "describe"))):
            steps.place_secrets_in_their_project(["fleet-gemini-api-key"], THEIRS)
        cmd = [c for c in gcloud_calls(seen) if "add-iam-policy-binding" in c][0]
        self.assertEqual(cmd[cmd.index("--member") + 1], f"serviceAccount:{runner}")

    def test_nothing_on_our_own_machines_places_or_binds_anything(self):
        # Our own secrets were placed by hand long ago and our own jobs already
        # read them. An act with no grant touches none of this.
        seen = []
        steps.enter_cloud(dict(PLACED_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            self.assertEqual(steps.place_secrets_in_their_project(["fleet-gemini-api-key"],
                                                                  "langbench-1528148150979"), [])
        self.assertEqual(gcloud_calls(seen), [])

    def test_the_value_goes_down_a_pipe_and_never_onto_a_command_line(self):
        seen = []
        self.place(seen)
        for row in seen:
            self.assertNotIn("AIza-the-actual-key", " ".join(row["cmd"]))
        fed = [row["input"] for row in seen if row["input"] is not None]
        self.assertEqual(fed, ["AIza-the-actual-key"])

    def test_the_value_never_reaches_the_list_we_hand_the_customer(self):
        seen = []
        self.place(seen)
        self.assertNotIn("AIza-the-actual-key", json.dumps(steps.cloud_report()))
        self.assertNotIn("AIza-the-actual-key", open(steps.CLOUD_LOG, encoding="utf-8").read())

    def test_nothing_is_ever_read_back_out_of_their_secret_manager(self):
        seen = []
        self.place(seen)
        self.assertEqual([cmd for cmd in gcloud_calls(seen) if "access" in cmd], [])

    def test_a_credential_the_store_does_not_hold_is_refused_by_name(self):
        seen = []

        def ask():
            steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
            steps.place_secrets_in_their_project(["not-in-the-store-key"], THEIRS)

        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            doc = emitted(self, ask)
        self.assertEqual(doc["step"], "secret")
        self.assertIn("not-in-the-store-key", doc["error"])
        self.assertEqual(gcloud_calls(seen), [])

    def test_on_our_own_project_no_secret_is_created_at_all(self):
        # Ours were placed by hand long ago, and a deploy creating them would be
        # this procedure taking over a job the operator has always done.
        seen = []
        steps.enter_cloud(dict(PLACED_ARGS), "deploy")
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            self.assertEqual(steps.place_secrets_in_their_project(["fleet-gemini-api-key"],
                                                                 "langbench-1528148150979"), [])
        self.assertEqual(gcloud_calls(seen), [])


class AHostThatCannotGuardCannotAct(unittest.TestCase):
    """The guard lives in a file beside this one, and a host install copies
    each file by hand. A host missing that file must refuse rather than act in
    a customer's project with nothing checking the pairing."""

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    def test_an_instruction_for_a_customer_project_is_refused_with_no_guard_beside_it(self):
        seen = []
        with mock.patch.object(steps, "CLOUD", None), \
             mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            doc = emitted(self, steps.enter_cloud, dict(CUSTOMER_ARGS), "deploy")
        self.assertEqual(doc["step"], "cloud")
        self.assertIn("deploymgr-cloud.py", doc["error"])
        self.assertEqual(seen, [])

    def test_a_deploy_of_ours_is_untouched_by_a_missing_guard(self):
        # Every act this deployer has ever done is one of these, and none of
        # them reads that file.
        with mock.patch.object(steps, "CLOUD", None):
            self.assertEqual(steps.enter_cloud(dict(PLACED_ARGS), "deploy"),
                             "langbench-1528148150979")

    def test_a_refusal_never_reports_the_project_of_the_act_before_it(self):
        # One process runs one act, so on a host there is never a prior. The
        # place there is one is a test file, which is exactly where a customer's
        # project would get into a refusal about someone else's.
        steps.enter_cloud(dict(CUSTOMER_ARGS), "deploy")
        bad = {**GRANT, "project": "globex-media-77"}
        doc = emitted(self, steps.enter_cloud, {"name": "watcher", "cloud": bad}, "deploy")
        self.assertNotIn("cloud", doc)


class AHostWithNoDeployerAccountCannotAct(unittest.TestCase):
    """The other half of the same rule, about OUR side.

    Without the chain the flag names only the customer's account, so the
    impersonation is attempted by this machine's own identity: the project's
    default compute service account, shared by everything else on the box. No
    customer has granted that, so every call would fail, and it would fail
    looking exactly like a revocation, for every customer at once, with the fix
    being here. So a host that does not know its own deployer account refuses
    before it calls anything.
    """

    def setUp(self):
        steps.CURRENT["cloud"] = None
        self.addCleanup(steps.CURRENT.update, {"cloud": None})

    def test_an_instruction_for_a_customer_project_is_refused_with_nothing_called(self):
        seen = []
        with mock.patch.object(steps, "DEPLOYER_SA", ""), \
             mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            doc = emitted(self, steps.enter_cloud, dict(CUSTOMER_ARGS), "deploy")
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["step"], "cloud")
        # Named, because the operator reading this refusal is the person who
        # can fix it in one line.
        self.assertIn("MESH_CLOUD_DEPLOYER_SA", doc["error"])
        self.assertIn("Nothing was called", doc["error"])
        self.assertEqual(seen, [])

    def test_a_deploy_of_ours_is_untouched_by_it(self):
        # Every act this deployer has ever done is one of these, and none of
        # them needs a deployer account: no grant, no chain, no flag.
        seen = []
        with mock.patch.object(steps, "DEPLOYER_SA", ""):
            self.assertEqual(steps.enter_cloud(dict(PLACED_ARGS), "deploy"),
                             "langbench-1528148150979")
            with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
                steps.gcloud(["run", "jobs", "create", "watcher-worker"], "job", 10)
        self.assertEqual(gcloud_calls(seen)[0][:2], [steps.GCLOUD, "run"])

    def test_the_machines_own_identity_is_never_the_impersonator(self):
        # The failure this guards against, spelled out: a flag built without
        # the chain would have this host's default compute account impersonate
        # the customer directly. There is no path to it, and the one function
        # that could build it stops rather than returning it.
        with self.assertRaises(ValueError):
            steps.CLOUD.flag(GRANT)
        self.assertEqual(steps.CLOUD.flag(None), [])

    def test_a_deployer_account_that_is_not_one_is_the_same_refusal(self):
        # Including the exact shape this whole arrangement exists to avoid: our
        # own default compute account, which is what the metadata server hands
        # a VM and what a careless fix would paste in here.
        for bad in ("", None, "123456789012-compute@developer.gserviceaccount.com",
                    "deploys@agentmesh.ai", "agentmesh-deployer"):
            why = steps.CLOUD.deployer_refusal(bad)
            self.assertIsNotNone(why, bad)
            self.assertIn("MESH_CLOUD_DEPLOYER_SA", why)
        self.assertIsNone(steps.CLOUD.deployer_refusal(OURS))


class TheContainerMayRunAsASecondAccount(unittest.TestCase):
    """docs/customer-cloud-permissions.md offers a reviewer who will not accept
    a deployer that can read the secrets it placed a split: the deploy account
    holds everything except the power to read a secret value, and a second
    account holds only that and is what the container runs as. Optional, and
    absent it changes nothing."""

    RUNNER = f"agentmesh-runtime@{THEIRS}.iam.gserviceaccount.com"

    def test_with_no_second_account_the_container_runs_as_the_granted_one(self):
        self.assertEqual(steps.CLOUD.runs_as(GRANT), THEIR_ACCOUNT)

    def test_a_second_account_in_their_project_is_read(self):
        grant = {**GRANT, "runs_as": self.RUNNER}
        self.assertIsNone(steps.CLOUD.refusal(grant))
        self.assertEqual(steps.CLOUD.runs_as(grant), self.RUNNER)
        # And the impersonation is still the account they granted: the split is
        # about what the CONTAINER runs as, never about who we act as.
        self.assertEqual(steps.CLOUD.flag(grant, OURS),
                         [f"--impersonate-service-account={OURS},{THEIR_ACCOUNT}"])

    def test_a_second_account_in_another_project_is_the_same_disagreement(self):
        why = steps.CLOUD.refusal(
            {**GRANT, "runs_as": "agentmesh-runtime@globex-media-77.iam.gserviceaccount.com"})
        self.assertIn("globex-media-77", why)
        self.assertIn(THEIRS, why)
        self.assertIn("Nothing was called", why)


class AModelChangeReachesTheJob(unittest.TestCase):
    """`model` used to change the host half only, so an agent whose work ran
    in a job kept thinking with the old model while its descriptor named the
    new one. The container half changes the two things the job carries, the
    model variable and the provider's secret reference, takes the old
    provider's reference off when the provider changed, rewrites the row, and
    sends one message through the job."""

    ROW = {"name": "watcher", "job": "watcher-worker", "region": "us-central1",
           "project": "langbench-1528148150979", "bucket": "example-agent-state",
           "model": "google/gemini-2.5-flash", "secret_placed": "fleet-gemini-api-key", "job_seconds": 240}

    def setUp(self):
        os.makedirs(steps.CREDENTIALS, exist_ok=True)
        for s in ("fleet-gemini-api-key", "fleet-anthropic-api-key"):
            steps.write_text(f"{steps.CREDENTIALS}/{s}.secret", "not-a-key", 0o600)
        steps.save_json_list(steps.CONTAINERS, [self.ROW])

    def tearDown(self):
        steps.save_json_list(steps.CONTAINERS, [])
        os.remove(f"{steps.CREDENTIALS}/fleet-anthropic-api-key.secret")

    def test_the_job_is_given_the_model_and_the_key_and_loses_the_old_providers(self):
        seen = []
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            r = steps.set_container_model("watcher", "anthropic/claude-opus-5", self.ROW)
        calls = gcloud_calls(seen)
        upd = next(c for c in calls if c[1:4] == ["run", "jobs", "update"])
        self.assertEqual(upd[4:8], ["watcher-worker", "--region", "us-central1", "--project"])
        self.assertIn("--update-env-vars=AGENT_MODEL=anthropic/claude-opus-5", upd)
        self.assertIn("--update-secrets=ANTHROPIC_API_KEY=fleet-anthropic-api-key:latest", upd)
        self.assertIn("--remove-secrets=GOOGLE_GENERATIVE_AI_API_KEY", upd, "no job carries a key nobody uses")
        self.assertTrue(any(c[1:4] == ["run", "jobs", "execute"] for c in calls), "one message goes through the job")
        row = steps.load_json_list(steps.CONTAINERS)[0]
        self.assertEqual(row["model"], "anthropic/claude-opus-5")
        self.assertEqual(row["secret_placed"], "fleet-anthropic-api-key")
        self.assertIn("model_set_at", row)
        self.assertEqual(r["was"], "google/gemini-2.5-flash")
        self.assertEqual(r["removed"], "GOOGLE_GENERATIVE_AI_API_KEY")
        self.assertIn("check", r)

    def test_the_same_provider_removes_nothing(self):
        seen = []
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            r = steps.set_container_model("watcher", "google/gemini-2.5-pro", self.ROW)
        upd = next(c for c in gcloud_calls(seen) if c[1:4] == ["run", "jobs", "update"])
        self.assertFalse(any(a.startswith("--remove-secrets") for a in upd))
        self.assertNotIn("removed", r)

    def test_a_provider_this_host_has_no_key_for_is_refused_before_the_job_is_touched(self):
        os.remove(f"{steps.CREDENTIALS}/fleet-anthropic-api-key.secret")
        seen = []
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            r = Refusal(self, steps.set_container_model, "watcher", "anthropic/claude-opus-5", self.ROW)
            bad = Refusal(self, steps.set_container_model, "watcher", "nobody/model", self.ROW)
        self.assertEqual(r.doc["step"], "bind")
        self.assertIn("fleet-anthropic-api-key", r.doc["error"])
        self.assertIn("names no provider", bad.doc["error"])
        self.assertEqual(gcloud_calls(seen), [], "nothing was called")
        self.assertEqual(steps.load_json_list(steps.CONTAINERS)[0]["model"], "google/gemini-2.5-flash")
        steps.write_text(f"{steps.CREDENTIALS}/fleet-anthropic-api-key.secret", "not-a-key", 0o600)

    def test_claude_on_vertex_needs_no_key_and_the_job_is_told_where_to_call(self):
        # 2026-09-29: the writers moved to Claude on Vertex AI, which the
        # job's service account pays for. No
        # credential is placed; the old provider's key reference comes off.
        seen = []
        m = "google-vertex-anthropic/claude-sonnet-5-5@default"
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            r = steps.set_container_model("watcher", m, {**self.ROW, "job_vars_placed": ["AGENT_MODEL", "GOOGLE_GENERATIVE_AI_API_KEY"]})
        upd = next(c for c in gcloud_calls(seen) if c[1:4] == ["run", "jobs", "update"])
        env = next(a for a in upd if a.startswith("--update-env-vars="))
        self.assertIn(f"AGENT_MODEL={m}", env)
        self.assertIn(f"GOOGLE_CLOUD_PROJECT={steps.VERTEX_PROJECT}", env)
        self.assertIn("GOOGLE_CLOUD_LOCATION=us", env)
        self.assertFalse(any(a.startswith("--update-secrets") for a in upd), "no key for a keyless provider")
        self.assertIn("--remove-secrets=GOOGLE_GENERATIVE_AI_API_KEY", upd)
        row = steps.load_json_list(steps.CONTAINERS)[0]
        self.assertIsNone(row["secret_placed"])
        self.assertEqual(row["job_vars_placed"], ["AGENT_MODEL", "GOOGLE_CLOUD_LOCATION", "GOOGLE_CLOUD_PROJECT"])
        self.assertEqual(r["now"], m)

    def test_leaving_vertex_takes_its_location_off_the_job(self):
        seen = []
        row = {**self.ROW, "model": "google-vertex-anthropic/claude-sonnet-5-5@default", "secret_placed": None}
        with mock.patch("steps.subprocess.run", gcloud_answering(seen)):
            steps.set_container_model("watcher", "google/gemini-2.5-pro", row)
        upd = next(c for c in gcloud_calls(seen) if c[1:4] == ["run", "jobs", "update"])
        self.assertIn("--update-secrets=GOOGLE_GENERATIVE_AI_API_KEY=fleet-gemini-api-key:latest", upd)
        self.assertIn("--remove-env-vars=GOOGLE_CLOUD_LOCATION,GOOGLE_CLOUD_PROJECT", upd)
        self.assertFalse(any(a.startswith("--remove-secrets") for a in upd))

    def test_a_host_brain_on_vertex_exports_where_to_call_and_reads_no_key_file(self):
        brain = steps.brain_text("opencode", "google-vertex-anthropic/claude-sonnet-5-5@default")
        self.assertIn(f"export GOOGLE_CLOUD_PROJECT={steps.VERTEX_PROJECT}", brain)
        self.assertIn("export GOOGLE_CLOUD_LOCATION=us", brain)
        self.assertIn("--model google-vertex-anthropic/claude-sonnet-5-5@default", brain)
        self.assertNotIn(".key", brain)
        self.assertEqual(steps.provider_var_names() & {"GOOGLE_CLOUD_PROJECT", "GOOGLE_GENERATIVE_AI_API_KEY"},
                         {"GOOGLE_CLOUD_PROJECT", "GOOGLE_GENERATIVE_AI_API_KEY"})
        self.assertNotIn(None, steps.provider_var_names())

    def test_a_vertex_model_with_its_version_is_a_model_name(self):
        self.assertTrue(steps.MODEL_RE.match("google-vertex-anthropic/claude-sonnet-5-5@default"))
        self.assertTrue(steps.MODEL_RE.match("google-vertex-anthropic/claude-haiku-4-5@20251001"))
        self.assertFalse(steps.MODEL_RE.match("a@b@c"))
        self.assertFalse(steps.MODEL_RE.match("x; rm -rf /"))


class TheAdapterNodeHoldsThisHostsAgents(unittest.TestCase):
    """docs/adapter-node-spec.md section 3: on a node host an agent is a folder
    under the node root, added with `mesh-adapter agent add`, with no adapter
    process of its own, and pm2 holds one node entry for all of them."""

    def test_a_node_host_is_learned_from_the_root_or_said_in_the_environment(self):
        root = tempfile.mkdtemp()
        try:
            with mock.patch.dict(os.environ, {"DEPLOYMGR_NODE": ""}), mock.patch.object(steps, "NODE_ROOT", root):
                holds, why = steps.node_here()
                self.assertFalse(holds)
                self.assertIn(root, why)
                os.makedirs(os.path.join(root, "agents"))
                holds, why = steps.node_here()
                self.assertTrue(holds, "an agents/ directory under the root is a node an operator made")
            with mock.patch.dict(os.environ, {"DEPLOYMGR_NODE": "1"}), mock.patch.object(steps, "NODE_ROOT", "/nowhere/node"):
                holds, why = steps.node_here()
                self.assertTrue(holds, "and DEPLOYMGR_NODE=1 says so before the first agent is moved")
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_on_a_node_host_an_agent_has_no_adapter_process_of_its_own(self):
        with mock.patch.object(steps, "node_here", lambda: (True, "the node holds this host's agents")):
            with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
                procs, _, _ = steps.agent_procs("watcher")
            self.assertEqual(procs, ["mesh-node"], "the node is the process, started once for every agent")
            with mock.patch("steps.subprocess.run", pm2_answering(NO_SUPERVISOR)):
                procs, _, _ = steps.agent_procs("watcher")
            self.assertEqual(procs, ["mesh-node", "watcher-attendant"])
        with mock.patch.object(steps, "node_here", lambda: (False, "no node root")):
            with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE)):
                procs, _, _ = steps.agent_procs("watcher")
            self.assertEqual(procs, ["watcher-adapter"], "without a node, the per-agent adapter as before")

    def test_the_generated_pm2_config_writes_one_node_entry_and_no_adapter_entry_for_a_node_agent(self):
        # One entry per node root, before the agents; an agent with node_root
        # gets no adapter entry; its attendant entry carries NODE_ROOT for
        # runtime/fleet/roster.mjs, which is how the supervisor learns to read
        # that agent through the node.
        self.assertIn('name: node.node_proc || "mesh-node"', steps.PM2_CONF)
        self.assertIn("MESH_ADAPTER_STATE: root", steps.PM2_CONF)
        self.assertIn("if (!a.node_root) apps.push({", steps.PM2_CONF)
        self.assertIn("...(a.node_root ? { NODE_ROOT: a.node_root } : {})", steps.PM2_CONF)
        self.assertIn("${a.name}-attendant", steps.PM2_CONF)


class OneNodePerAccount(unittest.TestCase):
    """docs/adapter-node-migration.md section 8: a node credential covers one
    account, so a host with agents of two accounts runs two nodes, and a deploy
    lands on the node that holds the owner's agents, named in node-roots.json."""

    def test_an_owner_in_the_map_lands_on_its_own_node_and_others_on_the_default(self):
        d = tempfile.mkdtemp()
        try:
            table = os.path.join(d, "node-roots.json")
            with open(table, "w") as f:
                json.dump({"01a07422-326b-7000-948a-ac20b30f04b8": {"root": "/opt/fleet/node-ops", "proc": "mesh-node-ops"}}, f)
            with mock.patch.object(steps, "NODE_ROOTS", table):
                ops = steps.node_for_owner({"kind": "account", "id": "01a07422-326b-7000-948a-ac20b30f04b8"})
                self.assertEqual(ops, {"root": "/opt/fleet/node-ops", "user": "mesh-node", "proc": "mesh-node-ops"},
                                 "the user falls back to the host's node user when the row names none")
                mine = steps.node_for_owner({"kind": "account", "id": "019f9c2c-392c-7000-b4b1-7668271a49be"})
                self.assertEqual(mine, {"root": steps.NODE_ROOT, "user": steps.NODE_USER, "proc": steps.NODE_PROC})
                self.assertEqual(steps.node_for_owner(None)["root"], steps.NODE_ROOT, "no owner: the default node")
                self.assertEqual(steps.node_for_owner("01a07422-326b-7000-948a-ac20b30f04b8")["proc"], "mesh-node-ops", "a bare id reads the same")
            with mock.patch.object(steps, "NODE_ROOTS", os.path.join(d, "missing.json")):
                self.assertEqual(steps.node_for_owner({"id": "01a07422-326b-7000-948a-ac20b30f04b8"})["root"], steps.NODE_ROOT,
                                 "no map on the host: every owner lands on the default node, as before")
        finally:
            shutil.rmtree(d, ignore_errors=True)


# -- an update keeps what an operator set on the job by hand ---------------

def job_described(env):
    """`gcloud run jobs describe --format=json` for a job carrying `env`, in
    the shape Cloud Run returns it: a plain value, or a secret reference."""
    return json.dumps({"spec": {"template": {"spec": {"template": {"spec": {"containers": [
        {"image": PINNED, "env": env}]}}}}}})


def job_answering(record_to, described):
    """gcloud for a job that exists: the full describe answers with the job's
    variables, the image read answers with a digest, and the rest succeed."""
    def fake(cmd, *a, **k):
        record_to.append({"cmd": list(cmd), "input": k.get("input")})
        if list(cmd[:2]) == ["pm2", "jlist"]:
            return subprocess.CompletedProcess(cmd, 0, json.dumps(SUPERVISOR_ONLINE), "")
        if "describe" in cmd and "--format=json" in cmd:
            return subprocess.CompletedProcess(cmd, 0, described, "")
        if "describe" in cmd:
            return subprocess.CompletedProcess(cmd, 0, PINNED + "\n", "")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return fake


# What the process runner's job carried on 2026-09-23 before the update to
# 0.10.2: four variables an operator set by hand so the runner can publish its
# runs, beside what the deploy manager itself placed.
BY_HAND = [
    {"name": "MESH_API_TOKEN", "valueFrom": {"secretKeyRef": {"name": "process-runner-publish-token",
                                                               "key": "latest"}}},
    {"name": "MESH_ACCOUNT", "value": "01a07422-326b-7000-948a-ac20b30f04b8"},
    {"name": "MESH_API_BASE", "value": "https://agentmesh.ai/api"},
    {"name": "AGENT_HANDLE", "value": "process-runner"},
]


class AnUpdateKeepsWhatAnOperatorSetOnTheJob(unittest.TestCase):
    """--env-vars-file and --set-secrets each replace every variable of their
    kind on a job, so an update that sent only the package's list wiped what an
    operator had set by hand. On 2026-09-23 that was the process runner's
    publish token, account, api base and handle, wiped twice, and run pages
    went blank. An update now reads the job first, keeps every name the package
    does not set and this side did not place, replaces the package's own, and
    drops a name this side placed that the new package no longer declares."""

    WHERE = {"job": "process-runner-worker", "region": "us-central1", "project": "langbench-1528148150979"}
    ROW = {"name": "process-runner", "job": "process-runner-worker", "region": "us-central1",
           "job_vars_placed": ["AGENT_NAME", "AGENT_MODEL", "RUN_RECORD_URL"]}

    def setUp(self):
        on_a_host_set_up_for_customers(self)

    def kept(self, env, refs, row, on_job):
        seen = []
        with mock.patch("steps.subprocess.run", job_answering(seen, job_described(on_job))):
            out = steps.keep_what_the_job_carries(self.WHERE, env, refs, row)
        read = gcloud_calls(seen)
        self.assertEqual(len(read), 1)
        self.assertEqual(read[0][1:5], ["run", "jobs", "describe", "process-runner-worker"])
        self.assertIn("--format=json", read[0])
        return out

    def test_the_operators_token_reference_and_account_survive_the_update(self):
        on_job = BY_HAND + [{"name": "AGENT_NAME", "value": "process-runner"},
                            {"name": "AGENT_MODEL", "value": "google/gemini-2.5-flash"}]
        env, refs, dropped = self.kept({"AGENT_NAME": "process-runner", "AGENT_MODEL": "anthropic/claude-opus-5"},
                                       {}, self.ROW, on_job)
        self.assertEqual(refs["MESH_API_TOKEN"], "process-runner-publish-token:latest")
        self.assertEqual(env["MESH_ACCOUNT"], "01a07422-326b-7000-948a-ac20b30f04b8")
        self.assertEqual(env["MESH_API_BASE"], "https://agentmesh.ai/api")
        self.assertEqual(env["AGENT_HANDLE"], "process-runner")
        self.assertEqual(env["AGENT_MODEL"], "anthropic/claude-opus-5", "the package's own variable is replaced")
        self.assertEqual(dropped, [])
        # And what gcloud is handed carries them: the reference on --set-secrets
        # and the plain values in the file, since both flags replace every one.
        argv = steps.IMAGE.create_job_argv({**self.WHERE, "image": PINNED, "bucket": "example-agent-state",
                                            "env_file": "/tmp/env.yaml", "secrets": refs}, exists=True)
        flag = next(a for a in argv if a.startswith("--set-secrets="))
        self.assertIn("MESH_API_TOKEN=process-runner-publish-token:latest", flag)
        self.assertIn('"MESH_ACCOUNT": "01a07422-326b-7000-948a-ac20b30f04b8"', steps.IMAGE.env_yaml(env))

    def test_a_variable_this_side_placed_and_the_package_dropped_goes(self):
        on_job = BY_HAND + [{"name": "RUN_RECORD_URL", "value": "https://old.example/runs"}]
        env, refs, dropped = self.kept({"AGENT_NAME": "process-runner"}, {}, self.ROW, on_job)
        self.assertNotIn("RUN_RECORD_URL", env)
        self.assertEqual(dropped, ["RUN_RECORD_URL"])
        self.assertIn("MESH_ACCOUNT", env, "a name nobody here placed is still kept")

    def test_a_row_from_before_the_record_still_tells_ours_from_theirs(self):
        # No job_vars_placed: the row predates it. Ours is recognised by what
        # this side has always placed, and the hand-set four are still kept.
        legacy = {"name": "process-runner", "job": "process-runner-worker", "region": "us-central1",
                  "settings_placed": ["OLD_SETTING"], "credentials_placed": ["old-tool-key"]}
        on_job = BY_HAND + [{"name": "OLD_SETTING", "value": "x"},
                            {"name": "AGENT_DIRECTORY_SCRATCH", "value": "/mesh/state/process-runner/scratch"},
                            {"name": "OLD_TOOL_KEY", "valueFrom": {"secretKeyRef": {"name": "old-tool-key",
                                                                                     "key": "latest"}}}]
        env, refs, dropped = self.kept({"AGENT_NAME": "process-runner"}, {}, legacy, on_job)
        self.assertEqual(dropped, ["AGENT_DIRECTORY_SCRATCH", "OLD_SETTING", "OLD_TOOL_KEY"])
        self.assertEqual(refs, {"MESH_API_TOKEN": "process-runner-publish-token:latest"})
        self.assertEqual(sorted(env), ["AGENT_HANDLE", "AGENT_NAME", "MESH_ACCOUNT", "MESH_API_BASE"])

    def test_a_reference_to_a_store_credential_the_package_dropped_goes_whatever_the_row_says(self):
        # publisher, 2026-09-28: 0.2.0 stopped declaring draft-host-writer, the
        # reference stayed on the job, the row listed nothing, and 0.2.1 kept it.
        on_job = BY_HAND + [{"name": "DRAFT_HOST_CREDENTIAL",
                             "valueFrom": {"secretKeyRef": {"name": "draft-host-writer", "key": "latest"}}}]
        with mock.patch("steps.store_credential_names", return_value={"draft-host-writer", "tts-key"}):
            env, refs, dropped = self.kept({"AGENT_NAME": "process-runner"}, {}, self.ROW, on_job)
        self.assertEqual(dropped, ["DRAFT_HOST_CREDENTIAL"])
        self.assertNotIn("DRAFT_HOST_CREDENTIAL", refs)
        self.assertEqual(refs["MESH_API_TOKEN"], "process-runner-publish-token:latest",
                         "a hand-set reference to a secret outside the store is still kept")

    def test_a_job_that_cannot_be_read_is_not_written(self):
        seen = []
        with mock.patch("steps.subprocess.run", job_answering(seen, "not json")):
            with self.assertRaises(ValueError):
                steps.keep_what_the_job_carries(self.WHERE, {"AGENT_NAME": "process-runner"}, {}, self.ROW)


class TheUpdateItselfCarriesThemToTheJob(unittest.TestCase):
    """The same promise through the whole container half: an update of the
    process runner reads the job, writes the hand-set variables back beside
    the package's own, drops one this side placed and no longer places, and
    the row it saves names what this side placed and nothing else."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dm-carry-test-")
        build = os.path.join(HERE, "..", "agentbuilder", "build.py")
        example = os.path.join(HERE, "..", "..", "packages", "runner", "process-runner")
        # The runner as it was when it woke a model (0.10.6 and before: its
        # command could escalate a turn), because this test is about the model
        # variable the update places. From 0.10.7 the live package never wakes
        # one, gets no AGENT_MODEL, and a fixture that followed it would test
        # nothing about the variables this side places (2026-09-29).
        with open(os.path.join(example, "spec.json"), encoding="utf-8") as f:
            doc = json.load(f)
        doc["source"] = os.path.abspath(example)
        for job in doc["jobs"]:
            if job.get("run"):
                job["run"]["escalate_when"] = "json:block"
        spec = os.path.join(cls.tmp, "process-runner-escalating.spec.json")
        with open(spec, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        p = subprocess.run([sys.executable, build, spec, os.path.join(cls.tmp, "process-runner")],
                           capture_output=True, text=True)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        assert res.get("ok"), res
        cls.pkg_dir = os.path.join(cls.tmp, "process-runner", "process-runner")
        cls.pkg = steps.INSTALL.read_package(cls.pkg_dir)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        on_a_host_set_up_for_customers(self)
        os.makedirs(steps.CREDENTIALS, exist_ok=True)
        steps.write_text(f"{steps.CREDENTIALS}/fleet-gemini-api-key.secret", "not-a-key", 0o600)
        steps.save_json_list(steps.CONTAINERS, [{
            "name": "process-runner", "job": "process-runner-worker", "region": "us-central1",
            "job_vars_placed": ["AGENT_NAME", "AGENT_MODEL", "RUN_RECORD_URL"]}])
        self.addCleanup(steps.save_json_list, steps.CONTAINERS, [])

    def test_an_update_writes_the_hand_set_four_back_and_drops_what_it_no_longer_places(self):
        on_job = BY_HAND + [{"name": "AGENT_NAME", "value": "process-runner"},
                            {"name": "RUN_RECORD_URL", "value": "https://old.example/runs"}]
        seen, files = [], {}
        real_write = steps.write_text

        def write_text(path, text, mode=0o644):
            files[os.path.basename(path)] = text
            return real_write(path, text, mode)
        args = {**PLACED_ARGS, "name": "process-runner", "image": PINNED, "model": "google/gemini-2.5-flash"}
        fetched = (os.path.join(self.tmp, "staging"), self.pkg_dir, "ab" * 32, self.pkg)
        with mock.patch("steps.subprocess.run", job_answering(seen, job_described(on_job))), \
                mock.patch.object(steps, "fetch_and_verify", return_value=fetched), \
                mock.patch.object(steps, "write_text", write_text), \
                mock.patch.object(steps, "record_runtime", return_value={"recorded": False}):
            r = steps.container_step(args, count_against_ceiling=False)
        upd = next(c for c in gcloud_calls(seen) if c[1:4] == ["run", "jobs", "update"])
        self.assertIn("MESH_API_TOKEN=process-runner-publish-token:latest",
                      next(a for a in upd if a.startswith("--set-secrets=")))
        env_file = files["dm-process-runner-env.yaml"]
        for line in ('"MESH_ACCOUNT": "01a07422-326b-7000-948a-ac20b30f04b8"',
                     '"MESH_API_BASE": "https://agentmesh.ai/api"', '"AGENT_HANDLE": "process-runner"',
                     '"AGENT_MODEL": "google/gemini-2.5-flash"'):
            self.assertIn(line, env_file)
        self.assertNotIn("RUN_RECORD_URL", env_file)
        self.assertEqual(r["job_vars_kept"], ["AGENT_HANDLE", "MESH_ACCOUNT", "MESH_API_BASE", "MESH_API_TOKEN"])
        self.assertEqual(r["job_vars_dropped"], ["RUN_RECORD_URL"])
        row = steps.load_json_list(steps.CONTAINERS)[0]
        self.assertIn("AGENT_MODEL", row["job_vars_placed"])
        self.assertFalse({"MESH_API_TOKEN", "MESH_ACCOUNT", "RUN_RECORD_URL"} & set(row["job_vars_placed"]),
                         "the row names only what this side placed, so the hand-set four are never dropped")

    def test_a_job_with_no_platform_address_is_given_this_environments(self):
        # Env split runbook 1.6: a package reads its hosts from the job's
        # MESH_API_BASE, so a job nobody gave one gets urls.app of the
        # environment this deploy manager runs in. A hand-set one (above) wins.
        on_job = [v for v in BY_HAND if v.get("name") != "MESH_API_BASE"]
        seen, files = [], {}
        real_write = steps.write_text

        def write_text(path, text, mode=0o644):
            files[os.path.basename(path)] = text
            return real_write(path, text, mode)
        args = {**PLACED_ARGS, "name": "process-runner", "image": PINNED, "model": "google/gemini-2.5-flash"}
        fetched = (os.path.join(self.tmp, "staging"), self.pkg_dir, "ab" * 32, self.pkg)
        with mock.patch("steps.subprocess.run", job_answering(seen, job_described(on_job))), \
                mock.patch.object(steps, "fetch_and_verify", return_value=fetched), \
                mock.patch.object(steps, "write_text", write_text), \
                mock.patch.object(steps, "record_runtime", return_value={"recorded": False}):
            steps.container_step(args, count_against_ceiling=False)
        self.assertIn(f'"MESH_API_BASE": "{steps.API_BASE}"', files["dm-process-runner-env.yaml"])
        self.assertNotIn("MESH_API_BASE", steps.load_json_list(steps.CONTAINERS)[0]["job_vars_placed"])

    def test_the_job_runs_as_the_account_the_environment_names(self):
        # gcp.jobs_sa (dev's workers account). Unset, as in prod, no account
        # is passed and the job runs on the default compute account.
        seen = []
        args = {**PLACED_ARGS, "name": "process-runner", "image": PINNED, "model": "google/gemini-2.5-flash"}
        fetched = (os.path.join(self.tmp, "staging"), self.pkg_dir, "ab" * 32, self.pkg)
        for sa, want in (("mesh-workers@example.iam.gserviceaccount.com", True), ("", False)):
            seen.clear()
            with mock.patch("steps.subprocess.run", job_answering(seen, job_described(BY_HAND))), \
                    mock.patch.object(steps, "JOBS_SA", sa), \
                    mock.patch.object(steps, "fetch_and_verify", return_value=fetched), \
                    mock.patch.object(steps, "record_runtime", return_value={"recorded": False}):
                steps.container_step(args, count_against_ceiling=False)
            upd = next(c for c in gcloud_calls(seen) if c[1:4] == ["run", "jobs", "update"])
            self.assertEqual("--service-account" in upd, want, upd)
            if want:
                self.assertEqual(upd[upd.index("--service-account") + 1], sa)


def http_error(url, code, retry_after=None, body=b"{}"):
    import email.message
    import urllib.error
    hdrs = email.message.Message()
    if retry_after is not None:
        hdrs["Retry-After"] = str(retry_after)
    return urllib.error.HTTPError(url, code, {429: "Too Many Requests", 404: "Not Found",
                                              502: "Bad Gateway", 503: "Service Unavailable"}.get(code, "x"),
                                  hdrs, io.BytesIO(body))


def urlopen_answering(answers, seen):
    """urllib's urlopen, answering each call with the next of `answers`: bytes
    are the package, an HTTPError is raised. `seen` collects each Request."""
    def fake(req, *a, **k):
        seen.append(req)
        nxt = answers.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return io.BytesIO(nxt)
    return fake


class ANotNowIsAskedAgainAndARefusalIsNot(unittest.TestCase):
    """2026-09-25: the platform's rate limiter answered 429 to a package fetch
    after the name was bound, and the half-made agent then refused every later
    try. A 429, 502 or 503 is asked again, waiting what the server asked for
    and never more than a minute; a 404 or a digest that does not match still
    stops the step at once, and the step is still called fetch."""

    URL = "https://agentcatalog.com/x/package.tar.gz"

    def setUp(self):
        self.dest = os.path.join(TMP, "dm-fetch-test.tar.gz")

    def fetch(self, answers, fn=None, *args):
        seen, sleeps = [], []
        with mock.patch.object(steps.urllib.request, "urlopen", urlopen_answering(answers, seen)), \
                mock.patch.object(steps, "STAGING", TMP), \
                mock.patch.object(steps.time, "sleep", side_effect=lambda s: sleeps.append(s)):
            if fn is None:
                steps.fetch_package(self.URL, self.dest)
                return seen, sleeps, None
            return seen, sleeps, Refusal(self, fn, *args).doc

    def test_a_429_then_a_503_are_waited_out_and_the_fetch_goes_on(self):
        seen, sleeps, _ = self.fetch([http_error(self.URL, 429, retry_after=7), http_error(self.URL, 503), b"the package"])
        self.assertEqual(len(seen), 3)
        self.assertEqual(sleeps, [7, 15], "the header's seven seconds, then the second backoff")
        with open(self.dest, "rb") as f:
            self.assertEqual(f.read(), b"the package")

    def test_our_own_limiters_wait_is_read_and_no_wait_is_longer_than_a_minute(self):
        seen, sleeps, _ = self.fetch([http_error(self.URL, 429, body=b'{"error":"Too many requests","retry_after_ms":42000}'),
                                      http_error(self.URL, 429, retry_after=600), b"pkg"])
        self.assertEqual(sleeps, [42.0, 60])

    def test_three_not_nows_stop_the_step_at_fetch(self):
        answers = [http_error(self.URL, 429) for _ in range(3)]
        seen, sleeps, doc = self.fetch(answers, steps.fetch_package, self.URL, self.dest)
        self.assertEqual(doc["step"], "fetch")
        self.assertIn("429", doc["error"])
        self.assertIn("asked 3 times", doc["error"])
        self.assertEqual(len(seen), 3)
        self.assertEqual(len(sleeps), 2, "no wait after the last try")

    def test_a_404_stops_at_once(self):
        seen, sleeps, doc = self.fetch([http_error(self.URL, 404), b"never reached"], steps.fetch_package, self.URL, self.dest)
        self.assertEqual(doc["step"], "fetch")
        self.assertIn("404", doc["error"])
        self.assertEqual((len(seen), sleeps), (1, []))

    def test_bytes_that_do_not_match_the_digest_stop_at_once(self):
        seen, sleeps, doc = self.fetch([b"not the bytes that were filed", b"never reached"],
                                       steps.fetch_and_verify, "fetchtest", self.URL, "00" * 32)
        self.assertEqual(doc["step"], "fetch")
        self.assertIn("hash to", doc["error"])
        self.assertEqual((len(seen), sleeps), (1, []))

    def test_the_bearer_goes_to_this_meshs_queue_and_nowhere_else(self):
        queue_url = f"{steps.CONTROL_URL.rstrip('/')}/deploy-requests/dr_abc/package.tar.gz"
        seen = []
        with mock.patch.object(steps, "control_bearer", return_value="the-executor-bearer"), \
                mock.patch.object(steps.urllib.request, "urlopen", urlopen_answering([b"a", b"b"], seen)):
            steps.fetch_package(queue_url, self.dest)
            steps.fetch_package(self.URL, self.dest)
        to_queue, to_catalog = seen
        self.assertEqual(to_queue.unredirected_hdrs.get("Authorization"), "Bearer the-executor-bearer",
                         "carried unredirected, so a redirect elsewhere never takes it along")
        self.assertNotIn("Authorization", to_queue.headers)
        self.assertIsNone(to_catalog.get_header("Authorization"))


class AMeshProvidedAgentsDoorIsOpenToNamedAgents(unittest.TestCase):
    """Nobody attends a Mesh Provided Agent's door, so it lets in any
    registered sender by default whatever its interaction (the owner,
    2026-09-28); a service agent always did; a person's attended agent and the
    system, test and demo anchors keep the adapter's default."""

    def test_the_door_rule(self):
        self.assertTrue(steps.opens_to_registered("service", None))
        self.assertTrue(steps.opens_to_registered("service", "menu-reader.person@example.com"))
        self.assertTrue(steps.opens_to_registered("interactive", "fact-writer.platform@agentmesh.ai"))
        self.assertTrue(steps.opens_to_registered("interactive", "MC.Platform@AgentMesh.ai"))
        for handle in (None, "", "letta1.person@example.com", "codex.test@agentmesh.ai",
                       "mesh-guard.system@agentmesh.ai", "adk.demo@agentmesh.ai", "x.platform@agentmesh.ai.evil.test"):
            self.assertFalse(steps.opens_to_registered("interactive", handle), handle)


class ARebindFollowsTheAgentsNameAfterAMove(unittest.TestCase):
    """An agent moved to another account is named again under it (services
    agent-moves.ts); `rebind` gives the inventory row the name the naming
    service answers for the agent's key, so the supervisor hands the agent its
    new name. No answer, or a row for another key, changes nothing."""

    def setUp(self):
        self.saved = steps.load_list()
        steps.save_list([{"name": "menu-reader", "agent_key": "UKEY", "handle": "menu-reader.owner@example.com"},
                         {"name": "other", "agent_key": "UOTHER", "handle": "other.platform@agentmesh.ai"}])

    def tearDown(self):
        steps.save_list(self.saved)

    def test_the_row_takes_the_new_name(self):
        with mock.patch.object(steps, "naming_handle", return_value="menu-reader.platform@agentmesh.ai"):
            change = steps.follow_handle("menu-reader", "UKEY")
        self.assertEqual(change, {"from": "menu-reader.owner@example.com", "to": "menu-reader.platform@agentmesh.ai"})
        row = next(a for a in steps.load_list() if a["name"] == "menu-reader")
        self.assertEqual(row["handle"], "menu-reader.platform@agentmesh.ai")
        self.assertIn("handle_changed_at", row)
        other = next(a for a in steps.load_list() if a["name"] == "other")
        self.assertEqual(other["handle"], "other.platform@agentmesh.ai")

    def test_no_answer_or_the_same_name_or_another_key_changes_nothing(self):
        for answer, key in ((None, "UKEY"), ("menu-reader.owner@example.com", "UKEY"), ("x.platform@agentmesh.ai", "UWRONG")):
            with mock.patch.object(steps, "naming_handle", return_value=answer):
                self.assertIsNone(steps.follow_handle("menu-reader", key))
        row = next(a for a in steps.load_list() if a["name"] == "menu-reader")
        self.assertEqual(row["handle"], "menu-reader.owner@example.com")
        self.assertNotIn("handle_changed_at", row)


class TheInstallGuardMeasuresFirstAndWatchesAfter(unittest.TestCase):
    """docs/technical-debt.md item 93: the thirtieth agent on a node pushed its
    NATS CONNECT past the broker's limit and took the node's 29 other agents
    down for eighteen minutes while this procedure said "deployed". The
    measuring and the watching are guard.mjs's (test/guard.test.mjs); what is
    pinned here is what this side does with the answers: a refusal before
    anything exists, and a failed watch that takes the install back out, says
    whether the node recovered, and is reported as rolled back."""

    NODE = {"proc": "mesh-node-platform", "log": f"{steps.LOGS}/mesh-node-platform.log",
            "root": os.path.join(TMP, "node-platform")}

    def guard_says(self, *answers, seen=None):
        """subprocess.run with guard.mjs answering in turn; pm2 succeeds."""
        queue = list(answers)

        def fake(cmd, *a, **k):
            if seen is not None:
                seen.append(list(cmd))
            if cmd[0] == "node":
                return subprocess.CompletedProcess(cmd, 0, json.dumps(queue.pop(0)) + "\n", "")
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return fake

    def setUp(self):
        self.patches = [mock.patch.object(steps, "GUARD", "/opt/fleet/deploymgr-guard.mjs")]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        os.makedirs(os.path.join(self.NODE["root"], "agents", "ride-maker"), exist_ok=True)
        self.addCleanup(shutil.rmtree, self.NODE["root"], True)

    def test_a_node_past_80_percent_is_refused_before_anything_exists_in_the_guards_words(self):
        said = ("Refused before anything was placed: mesh-node-platform's NATS CONNECT would be 67,882 bytes with "
                "ride-maker on it, 103.6% of the broker's max_control_line of 65,536. An install may take a node or "
                "the host to 80% of a limit and no further.")
        seen = []
        with mock.patch("steps.subprocess.run", self.guard_says({"ok": False, "refusal": said}, seen=seen)):
            r = Refusal(self, steps.capacity_check, "ride-maker", HERE, self.NODE)
        self.assertEqual(r.doc["step"], "capacity")
        self.assertEqual(r.doc["error"], said)
        self.assertEqual(r.doc["state"], "nothing created")
        argv = seen[0]
        self.assertEqual(argv[:3], ["node", "/opt/fleet/deploymgr-guard.mjs", "precheck"])
        self.assertIn("--node-root", argv)
        self.assertGreater(int(argv[argv.index("--package-bytes") + 1]), 0)

    def test_room_to_spare_passes_and_the_numbers_travel_with_the_result(self):
        checks = [{"what": "connect", "now": 67882, "after": 70060, "limit": 262144}]
        with mock.patch("steps.subprocess.run", self.guard_says({"ok": True, "adding": True, "checks": checks})):
            got = steps.capacity_check("ride-maker", HERE, self.NODE)
        self.assertEqual(got["checks"], checks)

    def test_a_missing_guard_refuses_rather_than_calling_the_install_safe(self):
        with mock.patch.object(steps, "GUARD", None):
            r = Refusal(self, steps.capacity_check, "ride-maker", HERE, self.NODE)
        self.assertEqual(r.doc["step"], "capacity")
        self.assertIn("could not be measured", r.doc["error"])

    def test_a_quiet_node_passes_the_watch_and_nothing_is_moved(self):
        ok = {"ok": True, "act": "watch", "probes": {"ride-maker": "answered"}}
        with mock.patch("steps.subprocess.run", self.guard_says(ok)):
            got = steps.watch_new_install("ride-maker", self.NODE, {"restarts": 4, "log_offset": 10}, act="deploy")
        self.assertEqual(got, ok)
        self.assertTrue(os.path.isdir(os.path.join(self.NODE["root"], "agents", "ride-maker")))

    def node_pauses(self, *answers, seen=None, writes=True):
        """guard.mjs answering in turn, and `mesh-adapter agent pause` writing
        paused.json the way the adapter does (or failing to, with writes=False)."""
        guard = self.guard_says(*answers, seen=seen)

        def fake(cmd, *a, **k):
            if cmd[0] == "su" and "agent pause" in cmd[-1]:
                if seen is not None:
                    seen.append(list(cmd))
                if not writes:
                    return subprocess.CompletedProcess(cmd, 1, "", "mesh-adapter: unknown command")
                with open(os.path.join(self.NODE["root"], "agents", "ride-maker", "paused.json"), "w") as f:
                    f.write('{"at": "now", "by": "mesh-node"}\n')
                return subprocess.CompletedProcess(cmd, 0, "ride-maker paused", "")
            return guard(cmd, *a, **k)
        return fake

    def test_the_ride_maker_failure_pauses_the_new_agent_through_the_node_and_moves_no_folder(self):
        # Technical debt 100: moving the folder out of a running node made the
        # node re-create it and mint a key nobody issued. The rollback pauses.
        bad = {"ok": False, "act": "watch", "reason": "mesh-node-platform restarted 3 times during the watch (pm2 count 4 to 7)"}
        mark = {"ok": True, "act": "mark", "restarts": 7, "log_offset": 99}
        well = {"ok": True, "act": "watch", "probes": {"a": "answered", "b": "answered", "c": "answered"}}
        folder = os.path.join(self.NODE["root"], "agents", "ride-maker")
        with open(os.path.join(folder, "identity.json"), "w") as f:
            f.write('{"public_key": "UKEPT"}\n')
        seen = []
        with mock.patch("steps.subprocess.run", self.node_pauses(bad, mark, well, seen=seen)):
            r = Refusal(self, steps.watch_new_install, "ride-maker", self.NODE, {"restarts": 4, "log_offset": 10},
                        act="deploy", package="ride-maker", version="0.1.0")
        d = r.doc
        self.assertEqual(d["step"], "watch")
        self.assertTrue(d["rolled_back"])
        self.assertEqual(d["act"], "deploy")
        self.assertIn("restarted 3 times", d["error"])
        self.assertTrue(d["state"].startswith(
            "rolled back: ride-maker was paused on mesh-node-platform through the node (mesh-adapter agent pause)"), d["state"])
        self.assertIn("awaits removal", d["state"])
        self.assertIn("the node recovered", d["state"])
        # The folder and its key stay exactly where they were.
        self.assertTrue(os.path.isdir(folder), "paused in place, not moved")
        with open(os.path.join(folder, "identity.json")) as f:
            self.assertIn("UKEPT", f.read())
        self.assertTrue(os.path.exists(os.path.join(folder, "paused.json")))
        pause = [c for c in seen if c[0] == "su"]
        self.assertEqual(len(pause), 1)
        self.assertEqual(pause[0][:3], ["su", "-", "mesh-node"])
        self.assertIn(f"MESH_ADAPTER_STATE={self.NODE['root']} /usr/bin/mesh-adapter agent pause ride-maker", pause[0][-1])
        self.assertFalse(any("agent remove" in " ".join(c) for c in seen), "remove deletes the folder; not yet")
        # The pause comes before the node is restarted without the agent.
        self.assertLess(seen.index(pause[0]), seen.index(["pm2", "restart", "mesh-node-platform"]))
        # The recovery watch asks the neighbours, not the agent it just paused.
        recovery = [c for c in seen if c[:3] == ["node", "/opt/fleet/deploymgr-guard.mjs", "watch"]][-1]
        self.assertEqual(recovery[recovery.index("--agent") + 1], "-")
        # And the record the executor signs says so in words.
        doc = record.build(d, "/nonexistent", "UDM")
        self.assertEqual(doc["act"], "refuse")
        self.assertTrue(doc["outcome"].startswith("rolled back: the node did not stay well after ride-maker was placed"))
        self.assertIn("paused on mesh-node-platform", doc["outcome"])

    def test_a_node_whose_pause_command_fails_still_gets_the_paused_file_and_no_folder_moves(self):
        bad = {"ok": False, "reason": "mesh-node-platform's log says its connection failed"}
        mark = {"ok": True, "restarts": 9, "log_offset": 5}
        well = {"ok": True}
        folder = os.path.join(self.NODE["root"], "agents", "ride-maker")
        with mock.patch("steps.subprocess.run", self.node_pauses(bad, mark, well, writes=False)):
            r = Refusal(self, steps.watch_new_install, "ride-maker", self.NODE, {}, act="deploy")
        self.assertIn("by writing its paused.json, because the node's agent pause did not: mesh-adapter: unknown command",
                      r.doc["state"])
        self.assertTrue(os.path.isdir(folder))
        with open(os.path.join(folder, "paused.json")) as f:
            self.assertEqual(json.load(f)["by"], "deploymgr rollback")

    def test_the_holder_names_the_nodes_user_for_the_pause(self):
        h = steps.holder_of("ride-maker", {"root": "/opt/fleet/node-x", "proc": "mesh-node-x", "user": "mesh-node-x"})
        self.assertEqual(h["user"], "mesh-node-x")
        self.assertEqual(steps.holder_of("ride-maker", {"root": "/r", "proc": "p"})["user"], steps.NODE_USER)

    def test_a_node_that_does_not_recover_is_said_to_have_not_recovered(self):
        bad = {"ok": False, "reason": "mesh-node-platform's log says its connection failed"}
        mark = {"ok": True, "restarts": 9, "log_offset": 5}
        still = {"ok": False, "reason": "mesh-node-platform is errored in pm2"}
        with mock.patch("steps.subprocess.run", self.node_pauses(bad, mark, still)):
            r = Refusal(self, steps.watch_new_install, "ride-maker", self.NODE, {}, act="deploy")
        self.assertIn("the node has NOT recovered: mesh-node-platform is errored in pm2", r.doc["state"])

    def test_a_failed_update_watch_puts_the_old_version_back_and_the_record_says_rolled_back(self):
        bad = {"ok": False, "reason": "site-reader did not answer a health probe"}
        mark = {"ok": True, "restarts": 5, "log_offset": 5}
        well = {"ok": True}
        put = []
        common = {"name": "site-reader", "package": "site-reader", "version": "0.3.0", "url": "u", "sha256": "ab" * 32,
                  "agent_key": "UKEY", "handle": "site-reader.platform@agentmesh.ai",
                  "previous": {"version": "0.2.0", "sha256": "cd" * 32}, "descriptor": None}
        seen = []

        def put_old_back():
            put.append(1)
            return "0.2.0 was restored from the snapshot and restarted"
        with mock.patch("steps.subprocess.run", self.guard_says(bad, mark, well, seen=seen)):
            r = Refusal(self, steps.watch_update, "site-reader", self.NODE, {"restarts": 5}, put_old_back, "0.3.0", common)
        self.assertEqual(put, [1])
        d = r.doc
        self.assertTrue(d["rolled_back"] and d["restored"])
        self.assertEqual(d["step"], "watch")
        self.assertTrue(d["state"].startswith("rolled back: 0.2.0 was restored from the snapshot and restarted; the node recovered"))
        self.assertNotIn(["pm2", "restart", "mesh-node-platform"], seen, "the restore already restarted it")
        doc = record.build(d, "/nonexistent", "UDM")
        self.assertTrue(doc["restored"])
        self.assertTrue(doc["outcome"].startswith("rolled back: "))

    def test_the_same_bytes_at_the_same_version_are_a_reinstall_and_other_bytes_are_not(self):
        steps.save_list([{"name": "site-reader", "package": "site-reader", "version": "0.3.0", "sha256": "ab" * 32,
                          "harness": "opencode", "state": "running", "node_root": self.NODE["root"],
                          "node_proc": "mesh-node-platform", "interaction": "service"}])
        self.addCleanup(steps.save_list, [])
        os.makedirs(os.path.join(TMP, "tmp"), exist_ok=True)
        argfile = f"{steps.DM_HOME}/tmp/reinstall-site-reader.json"
        steps.write_text(argfile, json.dumps({"name": "site-reader", "package_url": "https://x/package.tar.gz"}))
        pkg = {"manifest": {"name": "site-reader", "version": "0.3.0"}}

        def attempt(sha):
            with mock.patch.object(steps, "user_exists", lambda n: True), \
                    mock.patch.object(steps, "read_ledger", lambda n: {"files": [], "outside": []}), \
                    mock.patch.object(steps, "fetch_and_verify", return_value=(TMP, HERE, sha, pkg)), \
                    mock.patch.object(steps, "check_before_touching", lambda a, p: None), \
                    mock.patch.object(steps, "capacity_check",
                                      lambda *a, **k: steps.fail("capacity", "reached the guard")):
                return Refusal(self, steps.update, argfile).doc
        same = attempt("ab" * 32)
        self.assertEqual((same["step"], same["error"]), ("capacity", "reached the guard"),
                         "the same bytes pass the version gate and reach the guard")
        other = attempt("ef" * 32)
        self.assertEqual(other["step"], "version")

    def test_a_reinstall_smoke_wakes_no_model(self):
        on_node = [{"name": "site-reader", "node_proc": "mesh-node-platform"}]
        os.makedirs(steps.LOGS, exist_ok=True)
        steps.write_text(os.path.join(steps.LOGS, "mesh-node-platform.log"), "+ site-reader served by this node (UKEY)\n")
        calls = []

        def no_brain(*a, **k):
            calls.append(a)
            return subprocess.CompletedProcess(a, 0, "x", "")
        with mock.patch.object(steps, "node_here", lambda: (True, "")), \
                mock.patch.object(steps, "load_list", lambda: on_node), \
                mock.patch("steps.time.sleep", lambda s: None), \
                mock.patch("steps.subprocess.run", no_brain):
            s = steps.start_and_smoke("site-reader", ask_model=False)
        self.assertTrue(s["passed"])
        self.assertEqual(calls, [], "no brain was run")
        self.assertIn("not run", s["probe"])


AGENT_KEY = "UAGENTKEYFORTRIALTESTS"
# setUp patches the check away; the test of the check itself uses the real one.
REAL_ADAPTER_CHECK = steps.adapter_knows_trial_scope
# Standard base64 with every character the conversion has to change.
STD_SIG = "ab+cd/ef=="


class TrialsAtInstall(unittest.TestCase):
    """Common Agent 7.7 at the deploy: the bound descriptor names the
    platform's samples address when the package asks, before the signature,
    on the API origin of the deploy's own environment; and the allowance gets
    the trial ceiling the package suggests, signed the way `agentmesh
    allowance set` signs (tag, newline, canonical bytes, base64url), without
    taking away any ceiling, keeping a trial ceiling the owner set, and never
    re-signing a document that does not verify or writing a scope an adapter
    that does not know it would read as a broken document."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dm-trial-")
        self.adapter = f"{self.home}/.agentmesh/adapter"
        os.makedirs(self.adapter)
        os.makedirs(f"{self.home}/pkg")
        with open(f"{self.adapter}/identity.json", "w") as f:
            json.dump({"public_key": AGENT_KEY, "seed": "not-a-real-seed"}, f)
        self.path = f"{self.adapter}/allowance.json"
        self.signed = []

        def sign(identity, message):
            self.signed.append(message)
            return STD_SIG
        for target, value in (("run", lambda *a, **k: ""), ("sign_with_identity", sign),
                               ("adapter_knows_trial_scope", lambda *a, **k: True),
                               ("verify_with_key", lambda *a, **k: True)):
            p = mock.patch.object(steps, target, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(steps.os, "chown", lambda *a, **k: None, create=True)
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def pkg(self, ceiling):
        return {"install": {"format": "agent-install-v1", **({"trial_ceiling": ceiling} if ceiling else {})}}

    def allowance(self):
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    CEILING = {"amount_micro": 5000000, "currency": "USD", "per": "day", "per_1k_tokens_micro": 15000}

    # samples_ref

    def write_package(self, install):
        with open(f"{self.home}/pkg/install.json", "w") as f:
            json.dump(install, f)
        with open(f"{self.home}/pkg/descriptor.json", "w") as f:
            json.dump({"format": "agent-descriptor-v1", "agent_version": "1.0.0", "does": "x", "offerings": []}, f)

    def bind(self, handle="maker.platform@agentmesh.ai"):
        with mock.patch.dict(os.environ, {"DM_API_ORIGIN": "https://api.dev.agentmesh.ai"}):
            report = steps.bind_descriptor(self.home, "pkg", "maker", AGENT_KEY, handle, "1.0.0", "service", "codex", None)
        with open(f"{self.adapter}/descriptor.json", encoding="utf-8") as f:
            return report, json.load(f)

    def test_the_bound_descriptor_names_the_samples_address_and_the_signature_covers_it(self):
        self.write_package({"format": "agent-install-v1", "samples_ref": True})
        report, desc = self.bind()
        self.assertEqual(desc["samples_ref"], "https://api.dev.agentmesh.ai/v1/agents/maker.platform@agentmesh.ai/samples")
        self.assertIn("samples_ref", report["added"])
        self.assertIn('"samples_ref":"https://api.dev.agentmesh.ai/v1/agents/maker.platform@agentmesh.ai/samples"', self.signed[-1])
        self.assertTrue(self.signed[-1].startswith(steps.DESCRIPTOR_TAG + "\n"))

    def test_no_flag_no_address_and_no_handle_no_address(self):
        self.write_package({"format": "agent-install-v1"})
        report, desc = self.bind()
        self.assertNotIn("samples_ref", desc)
        self.assertNotIn("samples_ref", report)
        self.write_package({"format": "agent-install-v1", "samples_ref": True})
        report, desc = self.bind(handle=None)
        self.assertNotIn("samples_ref", desc)
        self.assertIn("handle", report["samples_ref"]["none"])

    # the allowance's trial scope

    def test_a_package_with_no_trial_touches_no_allowance(self):
        self.assertIsNone(steps.write_trial_allowance("maker", self.home, self.pkg(None)))
        self.assertFalse(os.path.exists(self.path))

    def test_a_new_agent_gets_an_allowance_with_the_suggested_trial_ceiling_signed_as_set_signs(self):
        report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertTrue(report["written"], report)
        doc = self.allowance()
        self.assertEqual(doc["ceilings"], [{"scope": "trial", "amount_micro": 5000000}])
        self.assertEqual(doc["cost_model"], {"per_1k_tokens_micro": 15000, "currency": "USD"})
        self.assertEqual((doc["v"], doc["agent"], doc["owner_key"], doc["on_exhausted"]), (1, AGENT_KEY, AGENT_KEY, "refuse"))
        self.assertEqual(doc["sig"], "ab-cd_ef", "EXT-8 pins base64url, unpadded")
        body = {k: v for k, v in doc.items() if k != "sig"}
        self.assertEqual(self.signed[-1], "agentmesh-allowance-v1\n" + steps.canonical(body))

    def test_the_owners_ceilings_are_carried_and_the_trial_ceiling_is_added(self):
        owner = {"v": 1, "agent": AGENT_KEY, "owner_key": AGENT_KEY,
                 "cost_model": {"per_1k_tokens_micro": 9000, "currency": "USD"},
                 "ceilings": [{"scope": "day", "amount_micro": 10000000}, {"scope": "task", "amount_micro": 500000, "task_id": "t1"}],
                 "on_exhausted": "ask_owner", "updated_at": "2026-10-01T00:00:00Z", "sig": "x"}
        with open(self.path, "w") as f:
            json.dump(owner, f)
        report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertTrue(report["written"], report)
        doc = self.allowance()
        self.assertEqual(doc["ceilings"], owner["ceilings"] + [{"scope": "trial", "amount_micro": 5000000}])
        self.assertEqual(doc["cost_model"], owner["cost_model"], "the owner's cost model, never the suggestion")
        self.assertEqual(doc["on_exhausted"], "ask_owner")

    def test_a_trial_ceiling_the_owner_set_is_kept(self):
        owner = {"v": 1, "agent": AGENT_KEY, "owner_key": AGENT_KEY,
                 "cost_model": {"per_1k_tokens_micro": 9000, "currency": "USD"},
                 "ceilings": [{"scope": "trial", "amount_micro": 2000000}],
                 "on_exhausted": "refuse", "updated_at": "2026-10-01T00:00:00Z", "sig": "x"}
        with open(self.path, "w") as f:
            json.dump(owner, f)
        report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertFalse(report["written"])
        self.assertTrue(report["kept"])
        self.assertEqual(self.allowance(), owner)

    def test_a_document_that_does_not_verify_is_left_alone(self):
        owner = {"v": 1, "agent": AGENT_KEY, "owner_key": AGENT_KEY,
                 "cost_model": {"per_1k_tokens_micro": 9000, "currency": "USD"},
                 "ceilings": [{"scope": "day", "amount_micro": 99000000}],
                 "on_exhausted": "refuse", "updated_at": "2026-10-01T00:00:00Z", "sig": "forged"}
        with open(self.path, "w") as f:
            json.dump(owner, f)
        with mock.patch.object(steps, "verify_with_key", lambda *a, **k: False):
            report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertFalse(report["written"])
        self.assertIn("does not verify", report["why"])
        self.assertEqual(self.allowance(), owner)
        self.assertEqual(self.signed, [])

    def test_an_adapter_that_does_not_know_the_scope_gets_nothing(self):
        with mock.patch.object(steps, "adapter_knows_trial_scope", lambda *a, **k: False):
            report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertFalse(report["written"])
        self.assertIn("does not know the allowance's trial scope", report["why"])
        self.assertFalse(os.path.exists(self.path))

    def test_no_allowance_and_no_suggested_cost_model_writes_nothing_and_says_why(self):
        ceiling = {k: v for k, v in self.CEILING.items() if k != "per_1k_tokens_micro"}
        report = steps.write_trial_allowance("maker", self.home, self.pkg(ceiling))
        self.assertFalse(report["written"])
        self.assertIn("cost model", report["why"])
        self.assertFalse(os.path.exists(self.path))

    def test_a_suggestion_in_another_currency_is_left_to_the_owner(self):
        owner = {"v": 1, "agent": AGENT_KEY, "owner_key": AGENT_KEY,
                 "cost_model": {"per_1k_tokens_micro": 9000, "currency": "EUR"},
                 "ceilings": [{"scope": "day", "amount_micro": 1}], "on_exhausted": "refuse",
                 "updated_at": "2026-10-01T00:00:00Z", "sig": "x"}
        with open(self.path, "w") as f:
            json.dump(owner, f)
        report = steps.write_trial_allowance("maker", self.home, self.pkg(self.CEILING))
        self.assertFalse(report["written"])
        self.assertIn("one currency", report["why"])

    def test_the_adapter_check_reads_the_shape_function(self):
        old = 'function allowanceShapeValid(doc) {\n  if (c.scope !== "task" && c.scope !== "context" && c.scope !== "day") return false;\n}\n'
        new = 'function allowanceShapeValid(doc) {\n  if (!["task", "context", "day", "trial"].includes(c.scope)) return false;\n}\n'
        listed = 'const ALLOWANCE_SCOPES = ["task", "context", "day", "trial"];\nfunction allowanceShapeValid(doc) {\n  return ALLOWANCE_SCOPES.includes(x);\n}\n'
        for src, knows in ((old, False), (new, True), (listed, True)):
            p = os.path.join(self.home, "adapter.mjs")
            with open(p, "w") as f:
                f.write(src)
            self.assertIs(REAL_ADAPTER_CHECK(p), knows, src)


# ── versions kept alongside the current one (run configs phase 3) ──────────

ALONG_ROW = {"name": "reader", "package": "presentation-reader", "version": "0.4.0", "runs_on": "cloud-run",
             "job": "reader-worker", "region": "us-south1", "project": "agentmesh-dev",
             "bucket": "example-agent-state", "binding": "gs://example-agent-state/bindings/reader",
             "image": "gcr.io/agentmesh-dev/deploymgr/presentation-reader@" + DIGEST, "interaction": "service",
             "state": "running"}


def pkg_of(name, version):
    return {"manifest": {"name": name, "version": version}, "install": {}}


class AVersionKeptAlongsideIsTheSameAgent(unittest.TestCase):
    """A version kept alongside is a second job of the same agent: no key, no
    handle, no unix user and no Descriptor of its own. Its job and binding
    folder carry its version in their names; everything else is refused
    before anything is built."""

    def setUp(self):
        os.makedirs(os.path.join(TMP, "tmp"), exist_ok=True)
        steps.save_json_list(steps.LIST, [{"name": "reader", "package": "presentation-reader", "version": "0.4.0",
                                           "agent_key": "U" + "B" * 55, "handle": "reader.platform@agentmesh.ai",
                                           "harness": "opencode", "state": "running"}])
        steps.save_json_list(steps.CONTAINERS, [dict(ALONG_ROW)])
        self.argfile = f"{steps.DM_HOME}/tmp/alongside-reader.json"
        steps.write_text(self.argfile, json.dumps({"name": "reader", "package_url": "https://agentcatalog.com/x/package.tar.gz"}))
        self.addCleanup(steps.save_json_list, steps.CONTAINERS, [])
        self.addCleanup(steps.save_json_list, steps.LIST, [])

    def fetched(self, name, version):
        staging = tempfile.mkdtemp(prefix="dm-along-")
        return mock.patch("steps.fetch_and_verify", lambda *a, **k: (staging, staging, "ab" * 32, pkg_of(name, version)))

    def test_the_job_and_the_binding_carry_the_version(self):
        self.assertEqual(steps.IMAGE.job_name("presentation-reader"), "presentation-reader-worker")
        self.assertEqual(steps.IMAGE.job_name("presentation-reader", "0.3.2"), "presentation-reader-v0-3-2-worker")
        self.assertEqual(steps.IMAGE.alongside_binding_name("presentation-reader", "0.3.2"), "presentation-reader--v0-3-2")
        self.assertEqual(steps.IMAGE.job_name("a", "1.2.3-beta.1"), "a-v1-2-3-beta-1-worker")
        with self.assertRaises(ValueError):
            steps.IMAGE.job_name("a", "0.3.2; rm -rf /")
        self.assertIsNone(steps.IMAGE.JOB_NAME_RE.match(steps.IMAGE.job_name("x" * 50, "10.20.30")))

    def test_the_current_version_is_refused(self):
        with self.fetched("presentation-reader", "0.4.0"):
            r = Refusal(self, steps.alongside, self.argfile)
        self.assertEqual(r.doc["step"], "version")
        self.assertIn("current version", r.doc["error"])

    def test_a_version_already_kept_is_refused(self):
        steps.save_json_list(steps.CONTAINERS, [{**ALONG_ROW, "alongside": [{"version": "0.3.2", "job": "reader-v0-3-2-worker", "state": "running"}]}])
        with self.fetched("presentation-reader", "0.3.2"):
            r = Refusal(self, steps.alongside, self.argfile)
        self.assertIn("already kept alongside", r.doc["error"])

    def test_another_package_is_refused(self):
        with self.fetched("fact-writer", "0.3.2"):
            r = Refusal(self, steps.alongside, self.argfile)
        self.assertEqual(r.doc["step"], "verify")

    def test_an_agent_whose_work_runs_on_this_host_is_refused(self):
        steps.save_json_list(steps.CONTAINERS, [])
        r = Refusal(self, steps.alongside, self.argfile)
        self.assertIn("one home and one brain", r.doc["error"])

    def test_an_agent_not_installed_here_is_refused(self):
        steps.save_json_list(steps.LIST, [])
        r = Refusal(self, steps.alongside, self.argfile)
        self.assertIn("not installed on this host", r.doc["error"])

    def test_the_build_and_the_job_are_composed_with_the_version_and_the_current_row(self):
        seen = {}

        def fake_image(args, alongside=False):
            seen["image"] = (dict(args), alongside)
            return {"image": "gcr.io/agentmesh-dev/deploymgr/presentation-reader:0.3.2", "image_digest": DIGEST,
                    "pinned": "gcr.io/agentmesh-dev/deploymgr/presentation-reader@" + DIGEST}

        def fake_container(args, count_against_ceiling=True, alongside=None):
            seen["container"] = (dict(args), count_against_ceiling, alongside)
            return {"ok": True, "act": "alongside", "version": "0.3.2"}

        spent = []
        with self.fetched("presentation-reader", "0.3.2"), \
                mock.patch("steps.image_step", fake_image), mock.patch("steps.container_step", fake_container), \
                mock.patch("steps.spend_check_and_record", lambda agents: spent.append(list(agents))), \
                mock.patch("steps.placement_from_host", lambda: {}):
            doc = emitted(self, steps.alongside, self.argfile)
        self.assertTrue(doc["ok"])
        self.assertTrue(seen["image"][1], "the images list keeps the current version's entry")
        args, counted, along = seen["container"]
        self.assertEqual(args["image"], "gcr.io/agentmesh-dev/deploymgr/presentation-reader@" + DIGEST, "by digest")
        self.assertFalse(counted, "one instruction is one deploy")
        self.assertEqual(along["version"], "0.3.2")
        self.assertEqual(along["row"]["job"], "reader-worker")
        self.assertEqual(args["region"], "us-south1", "read off the current row, as an update reads it")
        self.assertEqual(spent, [[]], "the day's ceiling only: the agent's name is already counted")
        self.assertEqual(doc["build"]["image_digest"], DIGEST)


class APlacedVersionJoinsTheRowAndTheAdaptersRecord(unittest.TestCase):

    def setUp(self):
        steps.save_json_list(steps.LIST, [{"name": "reader", "package": "presentation-reader", "version": "0.4.0",
                                           "agent_key": "U" + "B" * 55, "handle": "reader.platform@agentmesh.ai"}])
        steps.save_json_list(steps.CONTAINERS, [dict(ALONG_ROW)])
        self.addCleanup(steps.save_json_list, steps.CONTAINERS, [])
        self.addCleanup(steps.save_json_list, steps.LIST, [])
        self.home = tempfile.mkdtemp(prefix="dm-home-")
        os.makedirs(os.path.join(self.home, ".agentmesh", "adapter"))
        self.addCleanup(shutil.rmtree, self.home, True)
        self.spec = {"job": "reader-v0-3-2-worker", "region": "us-south1", "project": "agentmesh-dev", "job_seconds": 600}
        self.f = {"package": "presentation-reader", "version": "0.3.2", "sha256": "ef" * 32, "url": "u",
                  "image": "img:0.3.2", "image_digest": DIGEST, "started": "img@" + DIGEST, "harness": None,
                  "model": "google/gemini-3.8-flash", "secret": None,
                  "names": {"credentials": ["vertex-location"], "settings": ["DECK_MODEL"], "ceilings": []},
                  "job_vars_placed": ["AGENT_NAME", "DECK_MODEL"], "carried_over": ["MESH_API_TOKEN"], "dropped": [],
                  "directories": {}, "docs": {"ceilings.json": ""}, "staging": tempfile.mkdtemp(), "interaction": "service",
                  "environment": "", "region": "us-south1"}

    def test_a_passed_check_adds_the_version_to_the_row_and_names_how_it_is_reached(self):
        written = []
        with mock.patch("steps.agent_identity", lambda n: {"key": "U" + "B" * 55, "handle": "reader.platform@agentmesh.ai"}), \
                mock.patch("steps.write_alongside_record", lambda name, versions, package=None: written.append([v["version"] for v in versions]) or {}):
            doc = steps.alongside_placed("reader", "0.3.2", ALONG_ROW, self.spec, "example-agent-state",
                                         "reader--v0-3-2", {"passed": True}, self.f)
        self.assertEqual(doc["act"], "alongside")
        self.assertEqual(doc["current_version"], "0.4.0")
        self.assertEqual(doc["job"], "reader-v0-3-2-worker")
        self.assertEqual(doc["agent_key"], "U" + "B" * 55, "the same subject; nothing was minted")
        self.assertNotIn("descriptor", doc, "nothing was bound: the Descriptor stays the current version's")
        self.assertIn("naming 0.3.2", doc["state"])
        self.assertEqual(doc["job_vars_kept"], ["MESH_API_TOKEN"])
        self.assertEqual(written, [["0.3.2"]])
        row = steps.load_json_list(steps.CONTAINERS)[0]
        self.assertEqual(row["version"], "0.4.0", "the current version is untouched")
        self.assertEqual([a["version"] for a in row["alongside"]], ["0.3.2"])
        self.assertEqual(row["alongside"][0]["binding"], "gs://example-agent-state/bindings/reader--v0-3-2")
        self.assertEqual(row["alongside"][0]["job_vars_placed"], ["AGENT_NAME", "DECK_MODEL"])

    def test_a_failed_check_takes_the_job_down_and_refuses(self):
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering([], seen)):
            doc = emitted(self, steps.alongside_placed, "reader", "0.3.2", ALONG_ROW, self.spec,
                          "example-agent-state", "reader--v0-3-2", {"passed": False, "observed": "no reply"}, self.f)
        self.assertFalse(doc["ok"])
        self.assertEqual(doc["step"], "check")
        self.assertTrue(any(c[1:4] == ["run", "jobs", "delete"] and "reader-v0-3-2-worker" in c for c in seen))
        self.assertTrue(any(c[1:3] == ["storage", "rm"] for c in seen))
        self.assertNotIn("alongside", steps.load_json_list(steps.CONTAINERS)[0])

    def test_the_adapters_record_lists_each_version_and_goes_when_none_is_kept(self):
        got = steps.write_alongside_record("reader", [{"version": "0.3.2", "sha256": "ef" * 32}], "presentation-reader", home=self.home)
        path = os.path.join(self.home, ".agentmesh", "adapter", "alongside.json")
        with open(path) as fh:
            doc = json.load(fh)
        self.assertEqual(got["versions"], ["0.3.2"])
        self.assertEqual(doc["format"], "alongside-record-v1")
        self.assertEqual(doc["versions"], [{"version": "0.3.2", "sha256": "ef" * 32}])
        steps.write_alongside_record("reader", [], home=self.home)
        self.assertFalse(os.path.exists(path))


class RetiringAVersionNeverTouchesTheCurrentOne(unittest.TestCase):

    def setUp(self):
        os.makedirs(os.path.join(TMP, "tmp"), exist_ok=True)
        self.held = {"version": "0.3.2", "job": "reader-v0-3-2-worker", "region": "us-south1", "sha256": "ef" * 32,
                     "binding": "gs://example-agent-state/bindings/reader--v0-3-2", "image": "img:0.3.2",
                     "image_digest": DIGEST, "state": "running"}
        steps.save_json_list(steps.LIST, [{"name": "reader", "agent_key": "U" + "B" * 55}])
        steps.save_json_list(steps.CONTAINERS, [{**ALONG_ROW, "alongside": [dict(self.held)]}])
        self.addCleanup(steps.save_json_list, steps.CONTAINERS, [])
        self.addCleanup(steps.save_json_list, steps.LIST, [])

    def argfile(self, version):
        p = f"{steps.DM_HOME}/tmp/retire-reader.json"
        steps.write_text(p, json.dumps({"name": "reader", "version": version}))
        return p

    def test_the_current_version_is_refused(self):
        r = Refusal(self, steps.retire_version, self.argfile("0.4.0"))
        self.assertIn("current version", r.doc["error"])

    def test_a_version_not_kept_is_refused(self):
        r = Refusal(self, steps.retire_version, self.argfile("0.2.0"))
        self.assertIn("keeps no version 0.2.0", r.doc["error"])

    def test_the_job_and_the_binding_go_and_the_image_is_named_as_kept(self):
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering([], seen)), \
                mock.patch("steps.write_alongside_record", lambda *a, **k: {"versions": []}):
            doc = emitted(self, steps.retire_version, self.argfile("0.3.2"))
        self.assertTrue(doc["ok"], doc)
        self.assertEqual(doc["act"], "retire-version")
        deleted = [c for c in seen if c[1:4] == ["run", "jobs", "delete"]]
        self.assertEqual(len(deleted), 1)
        self.assertIn("reader-v0-3-2-worker", deleted[0])
        self.assertNotIn("reader-worker", deleted[0], "never the current job")
        self.assertTrue(any("image" in x and "kept" in x for x in doc["remaining"]))
        self.assertTrue(any(x.startswith("the image img:0.3.2@" + DIGEST + " is kept") for x in doc["remaining"]))
        steps.save_json_list(steps.CONTAINERS, [{**ALONG_ROW, "alongside": [dict(self.held, image="img@" + DIGEST)]}])
        with mock.patch("steps.subprocess.run", pm2_answering([], [])), \
                mock.patch("steps.write_alongside_record", lambda *a, **k: {"versions": []}):
            again = emitted(self, steps.retire_version, self.argfile("0.3.2"))
        self.assertTrue(any(x.startswith("the image img@" + DIGEST + " is kept") for x in again["remaining"]), "a pinned image is named once")
        row = steps.load_json_list(steps.CONTAINERS)[0]
        self.assertNotIn("alongside", row)
        self.assertEqual(row["job"], "reader-worker")

    def test_removing_the_agent_takes_every_version_down(self):
        steps.save_json_list(steps.LIST, [{"name": "reader", "package": "presentation-reader",
                                           "agent_key": "U" + "B" * 55, "state": "running", "placement": "cloud-run"}])
        seen = []
        with mock.patch("steps.subprocess.run", pm2_answering(SUPERVISOR_ONLINE, seen)):
            doc = emitted(self, steps.remove, "reader")
        self.assertTrue(doc["ok"])
        jobs = [c for c in seen if c[1:4] == ["run", "jobs", "delete"]]
        self.assertEqual(len(jobs), 2)
        self.assertTrue(any("reader-v0-3-2-worker" in c for c in jobs))


class TheRecordOfEachVersionAct(unittest.TestCase):

    def test_alongside_and_retire_version_are_recorded_acts(self):
        base = {"ok": True, "package": "presentation-reader", "version": "0.3.2", "current_version": "0.4.0",
                "url": "u", "sha256": "ef" * 32, "image_digest": DIGEST, "agent_key": "U" + "B" * 55,
                "handle": "reader.platform@agentmesh.ai", "job": "reader-v0-3-2-worker",
                "smoke": {"passed": True, "grade": "smoke"}, "host": "cloud-run/us-south1"}
        with mock.patch("record.sign", lambda *a: None):
            doc = record.build({**base, "act": "alongside"}, "/nonexistent", "U" + "C" * 55)
            gone = record.build({"ok": True, "act": "retire-version", "package": "presentation-reader", "version": "0.3.2",
                                 "current_version": "0.4.0", "agent_key": "U" + "B" * 55, "removed": ["the job"],
                                 "remaining": ["the image is kept"], "was": {"sha256": "ef" * 32}},
                                "/nonexistent", "U" + "C" * 55)
        self.assertEqual(doc["act"], "alongside")
        self.assertEqual(doc["current_package"]["version"], "0.4.0")
        self.assertEqual(doc["image_digest"], DIGEST)
        self.assertNotIn("descriptor", doc)
        self.assertIn("0.3.2", doc["reached_by"])
        self.assertEqual(gone["act"], "retire-version")
        self.assertEqual(gone["removed"], ["the job"])
        self.assertEqual(gone["package"]["sha256"], "ef" * 32)


class TheModelPlaced(unittest.TestCase):
    """Technical debt 456: the record says the model the agent runs with, read
    off what was placed, and not the model the instruction asked for."""

    def test_the_job_variable_is_the_model(self):
        self.assertEqual(steps.placed_model({"AGENT_MODEL": "google/gemini-3.8-flash", "AGENT_NAME": "w"}),
                         {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"})

    def test_a_script_package_reads_its_own_model_setting(self):
        self.assertEqual(steps.placed_model({"DECK_MODEL": "google/gemini-3.8-flash", "AGENT_NAME": "r"}),
                         {"model": "google/gemini-3.8-flash", "variable": "DECK_MODEL"})
        # As presentation-reader's job carries it on dev: a bare name, beside a price that is not a model.
        self.assertEqual(steps.placed_model({"DECK_MODEL": "gemini-3.8-flash", "DECK_MODEL_PRICE": "0.75/3.75"}),
                         {"model": "gemini-3.8-flash", "variable": "DECK_MODEL"})

    def test_no_model_or_two_candidates_say_none_rather_than_guess(self):
        self.assertIsNone(steps.placed_model({"AGENT_NAME": "w"}))
        self.assertIsNone(steps.placed_model({"A_MODEL": "x/y", "B_MODEL": "x/z"}))
        self.assertIsNone(steps.placed_model({"AGENT_MODEL": "not a model!"}))
        self.assertIsNone(steps.placed_model(None))

    def test_a_host_deploy_names_the_job_model_when_the_work_runs_in_one(self):
        work = {"model_placed": {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"}}
        self.assertEqual(steps.model_placed_of(work, "google-vertex-anthropic/claude-sonnet-5-5"), work)
        self.assertEqual(steps.model_placed_of({"model_placed": None}, "a/b"), {"model_placed": None})

    def test_a_host_deploy_without_a_job_names_the_brain_model(self):
        self.assertEqual(steps.model_placed_of(None, "google/gemini-3.8-flash"),
                         {"model_placed": {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"}})

    def test_an_untouched_container_says_what_its_row_recorded_or_nothing(self):
        row = {"name": "w", "model_placed": {"model": "a/b", "variable": "AGENT_MODEL"}}
        self.assertEqual(steps.model_placed_of(None, "c/d", row), {"model_placed": row["model_placed"]})
        self.assertEqual(steps.model_placed_of(None, "c/d", {"name": "w"}), {})

    def test_the_signed_record_carries_it(self):
        base = {"ok": True, "act": "deploy", "name": "w", "package": "watcher", "version": "1.0.0", "url": "u",
                "sha256": "ef" * 32, "host": "fleet-host", "agent_key": "U" + "B" * 55,
                "model_placed": {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"}}
        with mock.patch("record.sign", lambda *a: None):
            doc = record.build(base, "/nonexistent", "U" + "C" * 55)
            bare = record.build({k: v for k, v in base.items() if k != "model_placed"}, "/nonexistent", "U" + "C" * 55)
        self.assertEqual(doc["model_placed"], base["model_placed"])
        self.assertNotIn("model_placed", bare)


class BoundDescriptorFloor(unittest.TestCase):
    """Common Agent 0.28.0-draft at the deploy (4.9, 6.2, 6.6, 6.12): the
    bound descriptor is always signed by its subject, says whom the agent acts
    for, and never carries shape, a draft's own included. What shape used to
    say about the deploy (memory starts clean, the model) goes to the adapter
    in descriptor-binding.json, keyed by the digest of the bytes written."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dm-floor-")
        self.adapter = f"{self.home}/.agentmesh/adapter"
        os.makedirs(self.adapter)
        os.makedirs(f"{self.home}/pkg")
        with open(f"{self.adapter}/identity.json", "w") as f:
            json.dump({"public_key": AGENT_KEY, "seed": "not-a-real-seed"}, f)
        self.signed = []
        self.sig = STD_SIG

        def sign(identity, message):
            self.signed.append(message)
            return self.sig
        for target, value in (("run", lambda *a, **k: ""), ("sign_with_identity", sign)):
            p = mock.patch.object(steps, target, value)
            p.start()
            self.addCleanup(p.stop)
        # os.chown does not exist everywhere these tests run; ownership is
        # the host's business and not what is checked here.
        p = mock.patch.object(steps.os, "chown", lambda *a, **k: None, create=True)
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def draft(self, **extra):
        doc = {"format": "agent-descriptor-v1", "agent_version": "1.0.0", "does": "x",
               "offerings": [{"id": "chat", "name": "Chat", "inputs": [], "outputs": []}], **extra}
        with open(f"{self.home}/pkg/descriptor.json", "w") as f:
            json.dump(doc, f)

    def bind(self, model="example/model-a"):
        report = steps.bind_descriptor(self.home, "pkg", "maker", AGENT_KEY, "maker.platform@agentmesh.ai",
                                       "1.0.0", "service", "codex", model)
        with open(f"{self.adapter}/descriptor.json", "rb") as f:
            raw = f.read()
        return report, json.loads(raw), raw

    def test_no_shape_even_when_the_draft_carries_one(self):
        self.draft(shape={"kind": "plugin-on-harness", "memory": "keeps", "harness": "codex"})
        report, desc, _ = self.bind()
        self.assertNotIn("shape", desc)
        self.assertNotIn('"shape"', self.signed[-1])
        self.assertFalse(desc["fleet"])

    def test_acts_for_is_organization_by_default(self):
        self.draft()
        report, desc, _ = self.bind()
        self.assertEqual(desc["acts_for"], "organization")
        self.assertNotIn("organization_name", desc)
        self.assertEqual(report["acts_for"], "organization")
        self.assertIn("acts_for", report["added"])

    def test_acts_for_follows_the_agents_own_acts_for_json(self):
        self.draft()
        with open(f"{self.adapter}/acts-for.json", "w") as f:
            json.dump({"acts_for": "organization", "organization_name": "Example Co"}, f)
        _, desc, _ = self.bind()
        self.assertEqual((desc["acts_for"], desc["organization_name"]), ("organization", "Example Co"))
        with open(f"{self.adapter}/acts-for.json", "w") as f:
            json.dump({"acts_for": "anyone"}, f)
        _, desc, _ = self.bind()
        self.assertEqual(desc["acts_for"], "anyone")
        self.assertNotIn("organization_name", desc)
        # Unreadable statements are not read: a name beside person, an
        # address for a name, an unknown value.
        for bad in ({"acts_for": "person", "organization_name": "X"},
                    {"acts_for": "organization", "organization_name": "ops@example.com"},
                    {"acts_for": "team"}):
            with open(f"{self.adapter}/acts-for.json", "w") as f:
                json.dump(bad, f)
            _, desc, _ = self.bind()
            self.assertEqual(desc["acts_for"], "organization", bad)
            self.assertNotIn("organization_name", desc)

    def test_the_signature_is_the_subjects_over_the_canonical_document_without_signatures(self):
        self.draft(shape={"memory": "keeps"})
        report, desc, _ = self.bind()
        self.assertTrue(report["signed"])
        self.assertEqual(desc["signatures"], [{"tag": steps.DESCRIPTOR_TAG, "by": AGENT_KEY, "sig": STD_SIG, "alg": "ed25519"}])
        body = {k: v for k, v in desc.items() if k != "signatures"}
        self.assertEqual(self.signed[-1], steps.DESCRIPTOR_TAG + "\n" + steps.canonical(body))
        self.assertEqual(desc["subject"], {"id": AGENT_KEY, "handle": "maker.platform@agentmesh.ai"})

    def test_a_signer_that_fails_installs_nothing_unsigned_and_ends_the_act(self):
        self.draft()
        with open(f"{self.adapter}/descriptor.json", "w") as f:
            f.write("{\"old\": true}\n")
        self.sig = None
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as ended:
            steps.bind_descriptor(self.home, "pkg", "maker", AGENT_KEY, None, "1.0.0", "service", "codex", None)
        self.assertNotEqual(ended.exception.code, 0)
        said = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual((said["ok"], said["step"]), (False, "descriptor"))
        self.assertIn("never installed", said["error"])
        with open(f"{self.adapter}/descriptor.json", encoding="utf-8") as f:
            self.assertEqual(f.read(), "{\"old\": true}\n")
        self.assertFalse(os.path.exists(f"{self.adapter}/descriptor-binding.json"))

    def test_the_binding_record_carries_memory_and_the_model_at_the_written_digest(self):
        import hashlib
        self.draft()
        report, _, raw = self.bind()
        with open(f"{self.adapter}/descriptor-binding.json", encoding="utf-8") as f:
            rec = json.load(f)
        self.assertEqual(rec["format"], "descriptor-binding-v1")
        self.assertEqual(rec["by"], "deployment-manager")
        self.assertEqual(rec["digest"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(rec["digest"], report["digest"])
        self.assertEqual(rec["changed"], [])
        self.assertEqual(rec["carried"], {"memory": "starts-clean-each-job", "processors": [{"service": "example/model-a"}]})
        _, _, raw = self.bind(model=None)
        with open(f"{self.adapter}/descriptor-binding.json", encoding="utf-8") as f:
            rec = json.load(f)
        self.assertEqual(rec["carried"], {"memory": "starts-clean-each-job"})
        self.assertEqual(rec["digest"], hashlib.sha256(raw).hexdigest())
