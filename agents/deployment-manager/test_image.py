#!/usr/bin/env python3
"""The install splits when the installer never reaches the machine, and each
side records only the half it performed.

What is worth pinning: the owner's numbers and addresses reach a container as
three mounted files and never as a layer; a ceiling carries the side that
applies it from the install file all the way into the record; the job is
created with the image, the mount and the variables the entrypoint documents,
and refuses a tag where a digest is owed; an image that was built and started
nothing produces a BUILD record and no deployment record; the deployment
record names the digest of the image it started and leaves out every member
its producer did not observe, which for a container is the subject's key
custody and the file ledger, and for a host deploy is the image digest.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import image  # noqa: E402
import install  # noqa: E402
import record  # noqa: E402

BUILD = os.path.join(HERE, "..", "package-maker", "build.py")
# The tests that build real packages read them from a folder laid out as
# <family>/<name>/spec.json, such as the AgentMesh repository's packages/.
# Set ADLC_PACKAGES to that folder; without it those tests are skipped.
PACKAGES = os.environ.get("ADLC_PACKAGES") or os.path.join(HERE, "..", "..", "packages")
TMP = tempfile.mkdtemp(prefix="dm-image-test-")
PKGS = {}


def package_dir(slug):
    """A package's folder, found by its name under its family (packages/<family>/<name>)."""
    if not os.path.isdir(PACKAGES):
        raise unittest.SkipTest("set ADLC_PACKAGES to a folder of packages to run this test")
    for family in sorted(os.listdir(PACKAGES)):
        if os.path.isfile(os.path.join(PACKAGES, family, slug, "spec.json")):
            return os.path.join(PACKAGES, family, slug)
    raise FileNotFoundError(f"no package named {slug} under packages/<family>/")


def spec_for(slug):
    """The spec a slug is built from. explainer-maker is its 0.11.0 spec,
    frozen as a fixture and built from the example's own files: these tests
    use its draft-host system as the example of a placed credential with
    settings, and from 0.12.0 draft-host is brokered and carries neither."""
    if slug != "explainer-maker":
        return os.path.join(package_dir(slug), "spec.json")
    doc = json.load(open(os.path.join(HERE, "test", "explainer-maker-0.11.0.spec.json"), encoding="utf-8"))
    doc["source"] = os.path.abspath(package_dir(slug))
    path = os.path.join(TMP, "explainer-maker-0.11.0.spec.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return path


def setUpModule():
    for slug in ("explainer-maker", "process-runner"):
        p = subprocess.run([sys.executable, BUILD, spec_for(slug),
                            os.path.join(TMP, slug)], capture_output=True, text=True)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        assert res.get("ok"), res
        PKGS[slug] = install.read_package(os.path.join(TMP, slug, slug))
        assert PKGS[slug]["problems"] == [], PKGS[slug]["problems"]


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


DRAFT_SETTINGS = {"DRAFT_HOST_BUCKET": "agentmesh-ai-site", "DRAFT_HOST_PREFIX": "draft/",
                  "DRAFT_HOST_URL": "https://agentmesh.ai/draft/"}
EXPLAINER_ARGS = {
    "name": "explainer", "interaction": "service",
    "package_url": "https://agentcatalog.com/x/package.tar.gz",
    "credentials": {"text-to-speech": "tts-key", "draft-host": "draft-host-writer",
                    "text-reasoning": "text-reasoning-key"},
    "settings": {"draft-host": dict(DRAFT_SETTINGS), "customer-brand": {"EXPLAINER_CREDIT": "on"}},
    "ceilings": {"text-to-speech": 20000, "text-reasoning": 40},
}
DIGEST = "sha256:" + "ab" * 32
STARTED = f"gcr.io/p/explainer-maker@{DIGEST}"


def explainer_bindings():
    # The home INSIDE the image, which is what emit-image.mjs bakes, so a
    # directory role names the path the container will actually see.
    return install.plan_bindings(EXPLAINER_ARGS, PKGS["explainer-maker"], "/home/agent")


class TheEnforcingSideTravelsWithTheNumber(unittest.TestCase):
    """12.4 rule 4: the number alone does not say who can refuse a charge over
    it, and an unstated side is read as the weaker one by a careful reader and
    as the stronger one by a hopeful one."""

    def test_the_install_files_word_reaches_the_binding_and_the_record(self):
        b = next(b for b in explainer_bindings() if b["name"] == "text-to-speech")
        self.assertEqual(b["ceiling"]["enforced_by"], "runtime")
        # By system, not by position: the package gained a second spending
        # system and text-reasoning now sorts first.
        doc = next(c for c in install.ceilings_doc(explainer_bindings())["ceilings"]
                   if c["system"] == "text-to-speech")
        self.assertEqual(doc["enforced_by"], "runtime")
        names = next(c for c in install.placed_names(explainer_bindings())["ceilings"]
                     if c["system"] == "text-to-speech")
        self.assertEqual(names, {"system": "text-to-speech", "per": "task", "limit": 20000,
                                 "unit": "characters", "enforced_by": "runtime"})

    def test_a_package_that_states_no_side_leaves_it_absent(self):
        # Nothing here derives the word a second time. A package built before
        # the member existed says nothing, and an installer that filled it in
        # would be handing a reader the flattering answer it did not observe.
        pkg = json.loads(json.dumps(PKGS["explainer-maker"]))
        for c in pkg["install"]["ceilings"]:
            c.pop("enforced_by", None)
        b = next(b for b in install.plan_bindings(EXPLAINER_ARGS, pkg, "/home/agent") if b["name"] == "text-to-speech")
        self.assertNotIn("enforced_by", b["ceiling"])
        self.assertNotIn("enforced_by", install.placed_names([b])["ceilings"][0])

    def test_a_word_that_is_not_one_of_the_two_is_not_carried(self):
        pkg = json.loads(json.dumps(PKGS["explainer-maker"]))
        # The ceiling this reads back, not whichever one sorts first: the
        # package gained a second spending system and index 0 became
        # text-reasoning, so this was spoiling a ceiling it then never looked at.
        spoil = next(c for c in pkg["install"]["ceilings"] if c["system"] == "text-to-speech")
        spoil["enforced_by"] = "somebody"
        b = next(b for b in install.plan_bindings(EXPLAINER_ARGS, pkg, "/home/agent") if b["name"] == "text-to-speech")
        self.assertNotIn("enforced_by", b["ceiling"])


class TheThreeFilesAContainerIsGiven(unittest.TestCase):
    def setUp(self):
        self.bindings = explainer_bindings()
        self.docs = image.binding_documents("explainer", PKGS["explainer-maker"]["install"],
                                            install.ceilings_doc(self.bindings)["ceilings"],
                                            install.mcp_servers(self.bindings))

    def test_the_ceilings_file_carries_the_number_the_unit_and_the_side(self):
        c = next(x for x in json.loads(self.docs["ceilings.json"])["ceilings"]
                 if x["system"] == "text-to-speech")
        self.assertEqual(c, {"system": "text-to-speech", "per": "task", "limit": 20000,
                             "unit": "characters", "env": "CEILING_TEXT_TO_SPEECH",
                             "enforced_by": "runtime"})

    def test_an_mcp_system_is_named_by_name_with_the_address_the_instruction_gave(self):
        pkg = json.loads(json.dumps(PKGS["explainer-maker"]))
        at = next(i for i, s in enumerate(pkg["systems"]) if s["name"] == "brand-assets")
        pkg["systems"][at] = {"name": "brand-assets", "kind": "mcp", "access": "read",
                             "credential": None, "env": None, "settings": [], "spends": None}
        args = {**EXPLAINER_ARGS, "addresses": {"brand-assets": "https://assets.test/mcp"}}
        bindings = install.plan_bindings(args, pkg, "/home/agent")
        docs = image.binding_documents("explainer", pkg["install"],
                                       install.ceilings_doc(bindings)["ceilings"],
                                       install.mcp_servers(bindings))
        self.assertEqual(json.loads(docs["mcp.json"]),
                         {"servers": {"brand-assets": {"url": "https://assets.test/mcp"}}})

    def test_the_binaries_file_sets_no_variable_and_names_what_the_package_declares(self):
        # A BINARY_<NAME> line with an empty value would replace the image
        # build's own answer with nothing, and a script would go back to
        # guessing a path. So the names are comments and nothing is set.
        text = self.docs["binaries.env"]
        self.assertIn("BINARY_CHROMIUM", text)
        self.assertIn("renders every step", text)
        for line in text.splitlines():
            self.assertTrue(line.startswith("#") or not line.strip(), line)

    def test_a_package_with_no_systems_still_gets_all_three(self):
        bindings = install.plan_bindings({"name": "runner"}, PKGS["process-runner"], "/home/agent")
        docs = image.binding_documents("runner", PKGS["process-runner"]["install"],
                                       install.ceilings_doc(bindings)["ceilings"],
                                       install.mcp_servers(bindings))
        self.assertEqual(sorted(docs), ["binaries.env", "ceilings.json", "mcp.json"])
        self.assertEqual(json.loads(docs["ceilings.json"]), {"ceilings": []})
        self.assertEqual(json.loads(docs["mcp.json"]), {"servers": {}})
        self.assertIn("BINARY_AGENTMESH", docs["binaries.env"])


class WhatTheJobIsGiven(unittest.TestCase):
    def setUp(self):
        self.bindings = explainer_bindings()
        self.env = image.job_env("explainer", self.bindings,
                                 {"tts-key": "secret-one", "draft-host-writer": "secret-two",
                                  "text-reasoning-key": "secret-three"})

    def test_each_credential_and_setting_under_the_variable_the_package_names(self):
        self.assertEqual(self.env["TTS_API_KEY"], "secret-one")
        self.assertEqual(self.env["DRAFT_HOST_CREDENTIAL"], "secret-two")
        self.assertEqual(self.env["DRAFT_HOST_BUCKET"], "agentmesh-ai-site")
        self.assertEqual(self.env["AGENT_BINDING_DIR"], "/mesh/bindings/explainer")
        self.assertEqual(self.env["AGENT_NAME"], "explainer")

    def test_each_declared_directory_is_bound_on_the_mount_and_not_in_the_image(self):
        # 12.7.1: each directory role bound to storage that outlives a single
        # run. A container's filesystem outlives nothing, so a records path
        # baked into the image was an empty directory on every execution and
        # the process runner's second message found no run at all.
        env = image.job_env("runner", [], {}, install=PKGS["process-runner"]["install"])
        self.assertEqual(env["AGENT_DIRECTORY_RECORDS"], "/mesh/state/runner/records")
        self.assertEqual(env["AGENT_DIRECTORY_WORK"], "/mesh/state/runner/work")
        self.assertEqual(image.directory_uri("example-agent-state", "runner", "records"),
                         "gs://example-agent-state/state/runner/records")

    def test_one_agent_does_not_write_into_another_agents_directory(self):
        # One bucket serves the whole fleet, and two agents' records are not
        # one agent's. The name is in the path, so no two agents share.
        mine = image.job_env("runner", [], {}, install=PKGS["process-runner"]["install"])
        theirs = image.job_env("other-runner", [], {}, install=PKGS["process-runner"]["install"])
        self.assertNotEqual(mine["AGENT_DIRECTORY_RECORDS"], theirs["AGENT_DIRECTORY_RECORDS"])

    def test_the_directory_is_on_the_job_so_every_execution_sees_the_same_one(self):
        # The whole point of putting it on the job: an execution is given the
        # three per-message paths and nothing else, so two messages of one
        # conversation cannot be handed two different records directories.
        self.assertEqual(sorted(image.probe_env("explainer", "/mesh/jobs/explainer/m1")),
                         ["AGENT_NAME", "MESH_JOB_DIR", "MESH_MESSAGE_FILE", "MESH_REPLY_FILE"])
        argv = image.execute_job_argv({"job": "j", "region": "us-central1",
                                       "env": image.probe_env("explainer", "/mesh/jobs/explainer/m1")})
        self.assertFalse([a for a in argv if "AGENT_DIRECTORY" in a])

    def test_a_package_declaring_no_directory_is_given_none(self):
        self.assertEqual(image.directory_env("runner", {"directories": []}), {})
        self.assertEqual(image.directory_names(None), [])

    def test_no_per_message_variable_is_on_the_job(self):
        # A job carrying one would answer every message into the same folder.
        for key in ("MESH_JOB_DIR", "MESH_MESSAGE_FILE", "MESH_REPLY_FILE"):
            self.assertNotIn(key, self.env)
        self.assertEqual(sorted(image.probe_env("explainer", "/mesh/jobs/explainer/m1")),
                         ["AGENT_NAME", "MESH_JOB_DIR", "MESH_MESSAGE_FILE", "MESH_REPLY_FILE"])

    def test_a_credential_the_store_did_not_give_stops_the_job(self):
        with self.assertRaises(KeyError):
            image.job_env("explainer", self.bindings, {"tts-key": "secret-one"})

    def test_the_credentials_go_in_a_file_and_never_on_a_command_line(self):
        # A command line is in this host's own process list for as long as the
        # call runs, and these values are the owner's durable credentials.
        y = image.env_yaml({"TTS_API_KEY": "a: b #c", "AGENT_NAME": "explainer"})
        self.assertEqual(y, '"TTS_API_KEY": "a: b #c"\n"AGENT_NAME": "explainer"\n')
        argv = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300})
        self.assertIn("--env-vars-file=/tmp/env.yaml", argv)
        self.assertFalse([a for a in argv if "TTS_API_KEY" in a])

    def test_a_container_that_wakes_a_model_is_given_one_and_a_key_to_pay_for_it(self):
        # The half of step 7 a container still has. On a host the procedure
        # copies the provider's key into the agent's home and writes the model
        # into a brain script; here both are variables on the job, because an
        # image is built once and copied everywhere and neither belongs in a
        # layer (12.6 rule 3). The harness in the base reads exactly these two.
        env = image.job_env("critic", [], {}, install=PKGS["explainer-maker"]["install"],
                            harness={"model": "google/gemini-2.5-flash",
                                     "key_env": "GOOGLE_GENERATIVE_AI_API_KEY", "key": "secret-three"})
        self.assertEqual(env["AGENT_MODEL"], "google/gemini-2.5-flash")
        self.assertEqual(env["GOOGLE_GENERATIVE_AI_API_KEY"], "secret-three")

    def test_a_keyless_provider_gives_the_job_where_to_call_and_no_key(self):
        # Claude on Vertex AI: the job's service account pays, so the job
        # carries the model and the project and location, and no secret.
        h = {"model": "google-vertex-anthropic/claude-sonnet-5-5@default",
             "vars": {"GOOGLE_CLOUD_PROJECT": "p", "GOOGLE_CLOUD_LOCATION": "us"}}
        env = image.job_env("critic", [], {}, install=PKGS["explainer-maker"]["install"], harness=h)
        self.assertEqual(env["AGENT_MODEL"], h["model"])
        self.assertEqual(env["GOOGLE_CLOUD_LOCATION"], "us")
        self.assertFalse([k for k in env if k.endswith("_API_KEY")])
        self.assertEqual(image.job_secret_refs([], harness=h), {})

    def test_a_container_that_wakes_no_model_is_given_neither(self):
        # A key on a job that never wakes a model is a credential nobody uses,
        # sitting where anyone who can read the job can read it.
        never = json.loads(json.dumps(PKGS["process-runner"]["install"]))
        for spec in never["run"].values():
            spec.pop("escalate_when", None)
        self.assertFalse(image.wakes_a_model(never))
        env = image.job_env("runner", [], {}, install=never)
        self.assertNotIn("AGENT_MODEL", env)
        self.assertFalse([k for k in env if k.endswith("_API_KEY")])

    def test_a_script_that_calls_a_model_gets_the_key_but_no_harness(self):
        # The explainer writers run a command for every job and never
        # escalate, and their scripts call the model themselves. Read as
        # "wakes no model", they were deployed with no key and every job
        # refused (2026-09-23). calls_model says so, and gets the key only.
        scripted = json.loads(json.dumps(PKGS["process-runner"]["install"]))
        for spec in scripted["run"].values():
            spec.pop("escalate_when", None)
        self.assertFalse(image.needs_model_key(scripted))
        next(iter(scripted["run"].values()))["calls_model"] = True
        self.assertFalse(image.wakes_a_model(scripted))
        self.assertTrue(image.needs_model_key(scripted))
        self.assertTrue(image.needs_model_key({}))

    def test_the_question_is_asked_of_the_work_and_not_of_the_package(self):
        # Two ways a container wakes a model, and both have to count. A package
        # with no command has nothing else to run. A package WITH one can still
        # say the turn needs judgment, and the model has to be there for the
        # message that says it: process-runner is that package, and reading it
        # as "has a command, so no model" would deploy it with no key and turn
        # every escalation into an agent with nothing to say.
        #
        # process-runner WAS that package until 0.10.7, when its script began
        # deciding every block itself and the escalation went. So the package
        # that escalates is its install as 0.10.6 had it, with the one member
        # put back, and the package as it is now wakes nothing: a fixture that
        # followed the live package asserted the old behaviour of a new one.
        escalating = json.loads(json.dumps(PKGS["process-runner"]["install"]))
        for spec in escalating["run"].values():
            spec["escalate_when"] = "json:block"
        self.assertTrue(image.wakes_a_model(escalating))
        self.assertFalse(image.wakes_a_model(PKGS["process-runner"]["install"]))
        self.assertTrue(image.wakes_a_model({}))
        # And the other side of the same question. explainer-maker names a
        # command for its one job and cannot escalate, so nothing in it ever
        # wakes a model: it gets no key and no harness, and it resolves onto
        # the plainer chromium base rather than the chromium-harness one.
        self.assertFalse(image.wakes_a_model(PKGS["explainer-maker"]["install"]))

    def test_the_model_key_rides_in_the_file_and_never_on_a_command_line(self):
        env = image.job_env("critic", [], {}, install=PKGS["explainer-maker"]["install"],
                            harness={"model": "google/gemini-2.5-flash",
                                     "key_env": "GOOGLE_GENERATIVE_AI_API_KEY", "key": "secret-three"})
        argv = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300})
        self.assertFalse([a for a in argv if "secret-three" in a or "GOOGLE" in a])
        self.assertIn('"GOOGLE_GENERATIVE_AI_API_KEY": "secret-three"', image.env_yaml(env))

    def test_a_per_message_value_that_would_arrive_cut_in_half_is_refused(self):
        with self.assertRaises(ValueError):
            image.env_list({"A": "one,two"})
        with self.assertRaises(ValueError):
            image.env_list({"A": "one\ntwo"})
        self.assertEqual(image.env_list({"A": "1", "B": "2"}), "A=1,B=2")
        argv = image.execute_job_argv({"job": "j", "region": "us-central1",
                                       "env": image.probe_env("explainer", "/mesh/jobs/explainer/m1")})
        self.assertIn("--wait", argv)
        self.assertIn("--update-env-vars=MESH_JOB_DIR=/mesh/jobs/explainer/m1,"
                      "MESH_MESSAGE_FILE=/mesh/jobs/explainer/m1/message.json,"
                      "MESH_REPLY_FILE=/mesh/jobs/explainer/m1/reply.txt,AGENT_NAME=explainer", argv)

    def test_the_job_names_the_image_the_mount_and_the_cap(self):
        argv = image.create_job_argv({"job": "explainer-worker", "image": STARTED, "region": "us-central1",
                                      "project": "p", "bucket": "example-agent-state",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300})
        self.assertEqual(argv[:4], ["run", "jobs", "create", "explainer-worker"])
        self.assertIn("--add-volume=name=state,type=cloud-storage,bucket=example-agent-state", argv)
        self.assertIn("--add-volume-mount=volume=state,mount-path=/mesh", argv)
        self.assertIn(STARTED, argv)
        # A retried task is a message answered twice, and the sender cannot
        # tell two answers from one.
        self.assertEqual(argv[argv.index("--max-retries") + 1], "0")
        # The platform's clock trails the package's own cap rather than racing it.
        self.assertEqual(argv[argv.index("--task-timeout") + 1], "420s")
        self.assertIn("gen2", argv)
        again = image.create_job_argv({"job": "explainer-worker", "image": STARTED, "region": "us-central1",
                                       "bucket": "b", "env_file": "/tmp/env.yaml", "job_seconds": 300}, exists=True)
        self.assertEqual(again[2], "update")

    def test_how_much_machine_is_the_instructions_to_give_and_absent_otherwise(self):
        # Cloud Run's default is half a gigabyte and one cpu, which runs a
        # program and does not run a browser: chromium opening a page at two
        # window sizes is killed there, and a killed task reads back as a
        # container that answered nothing. Nothing in a package says how much
        # machine it wants, so the number comes from the instruction beside the
        # region and the bucket. Left off entirely when the instruction did not
        # say, so a redeploy that never mentioned it resizes nothing.
        plain = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                       "env_file": "/tmp/env.yaml", "job_seconds": 300})
        self.assertNotIn("--memory", plain)
        self.assertNotIn("--cpu", plain)
        sized = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                       "env_file": "/tmp/env.yaml", "job_seconds": 900,
                                       "memory": "4Gi", "cpu": "2"})
        self.assertEqual(sized[sized.index("--memory") + 1], "4Gi")
        self.assertEqual(sized[sized.index("--cpu") + 1], "2")
        for good in ("512Mi", "4Gi"):
            self.assertTrue(image.MEMORY_RE.match(good))
        for bad in ("4G", "4 Gi", "lots", "-1Gi"):
            self.assertIsNone(image.MEMORY_RE.match(bad))
        for good in ("1", "2", "500m"):
            self.assertTrue(image.CPU_RE.match(good))
        for bad in ("two", "0.5", "-1"):
            self.assertIsNone(image.CPU_RE.match(bad))

    def test_a_tag_is_refused_where_a_digest_is_owed(self):
        why = image.check_started_image("gcr.io/p/explainer-maker:0.1.0")
        self.assertIn("names a tag and not a digest", why)
        self.assertIsNone(image.check_started_image(STARTED))
        self.assertIsNotNone(image.check_started_image(""))
        self.assertEqual(image.pinned("gcr.io/p/explainer-maker:0.1.0", DIGEST), STARTED)


class TheCheck(unittest.TestCase):
    def test_an_execution_that_left_nothing_is_not_a_pass_and_says_why(self):
        s = image.smoke_from_outcome(None, "", True)
        self.assertFalse(s["passed"])
        self.assertIn("refused before any work ran", s["why"])

    def test_an_answer_is_a_pass_and_carries_what_came_back(self):
        s = image.smoke_from_outcome({"status": "answered", "by": "command", "exit_code": 0, "pieces": []},
                                     "I run process documents.\n", True)
        self.assertTrue(s["passed"])
        self.assertEqual(s["by"], "command")
        self.assertEqual(s["reply"], "I run process documents.")

    def test_a_container_that_stopped_at_the_cap_did_not_pass(self):
        self.assertFalse(image.smoke_from_outcome({"status": "stopped"}, "", True)["passed"])

    def test_the_probe_is_an_ordinary_message(self):
        # The entrypoint refuses a room turn and a worker-interface exchange,
        # and a check that sent one would be checking the refusal.
        m = image.probe_message("m1", "deployment-manager", "status")
        self.assertEqual(m["kind"], "message")
        self.assertEqual(m["files"], [])
        self.assertIsNone(m["in_reply_to"])


BUILD_RESULT = {
    "ok": True, "act": "build", "name": "runner", "package": "process-runner", "version": "0.6.0",
    "schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    "sha256": "ab" * 32, "url": "https://agentcatalog.com/x/package.tar.gz",
    "descriptor_sha256": "cd" * 32, "install_sha256": "ef" * 32,
    "image": "gcr.io/p/process-runner:0.6.0", "image_digest": DIGEST,
    "files_as_built": [{"path": "Dockerfile", "sha256": "12" * 32}],
    "shape": {"skills": 5, "systems": 0, "refuses": 15, "records": 10},
    "checks": [{"kind": "unrun", "what": "nothing in this image was run."}],
}

CONTAINER_RESULT = {
    "ok": True, "act": "deploy", "name": "runner", "package": "process-runner", "version": "0.6.0",
    "sha256": "ab" * 32, "url": "https://agentcatalog.com/x/package.tar.gz",
    "image_digest": DIGEST, "host": "cloud-run/us-central1", "job": "runner-worker",
    "interaction": "service", "admitted_at_start": [], "credentials_placed": [], "settings_placed": [],
    "ceilings": [], "dependencies": [],
    "smoke": {"passed": True, "started": True, "status": "answered", "by": "command",
              "exit_code": 0, "pieces": [], "reply": "I run process documents."},
}


class TheTwoRecords(unittest.TestCase):
    """12.7.1: building an image deploys nothing, so the builder's account is a
    build record; the side that starts the agent produces the one deployment
    record."""

    def test_an_image_that_started_nothing_produces_a_build_record(self):
        doc = record.build(BUILD_RESULT, None, "UADM")
        self.assertEqual((doc["role"], doc["act"]), ("agent-builder", "build"))
        self.assertEqual(doc["image_digest"], DIGEST)
        self.assertEqual(doc["package"]["sha256"], "ab" * 32)
        self.assertEqual(doc["package"]["descriptor_sha256"], "cd" * 32)
        self.assertEqual(doc["files_as_built"][0]["path"], "Dockerfile")
        self.assertTrue(doc["draft"])
        self.assertEqual(doc["checks"][0]["kind"], "unrun")
        # It deployed nothing, so it says nothing about a deploy.
        for member in ("target", "secrets_placed", "declarations", "key_custody", "ledger"):
            self.assertNotIn(member, doc)

    def test_the_build_record_is_signed_under_its_own_tag(self):
        # A build record signed under the deployment tag would verify against
        # the wrong document family and read as a deploy nobody performed.
        doc = record.build({**BUILD_RESULT}, None, "UADM")
        self.assertIn("_unsigned", doc)          # no identity in a test
        self.assertEqual(record.BUILD_TAG, "agent-build-record-v1")

    def test_the_deployment_record_names_the_digest_it_started(self):
        doc = record.build(CONTAINER_RESULT, None, "UADM")
        self.assertEqual((doc["role"], doc["act"]), ("deployment-manager", "deploy"))
        self.assertEqual(doc["image_digest"], DIGEST)
        self.assertEqual(doc["target"], {"host": "cloud-run/us-central1"})
        self.assertTrue(doc["checks"][0]["passed"])
        self.assertIn("by command", doc["checks"][0]["what"])

    def test_what_a_container_deploy_did_not_observe_is_absent(self):
        doc = record.build(CONTAINER_RESULT, None, "UADM")
        # It minted no subject and the image holds no key, so it cannot say how
        # the key came to exist or who holds it.
        self.assertNotIn("key_custody", doc)
        self.assertNotIn("agent", doc)
        # In an image the files are layers: the image digest is the answer to
        # "what is deployed", and an empty file ledger would be a lie about it.
        self.assertNotIn("ledger", doc)
        # Nothing was bound: the bound Descriptor's signature is made with the
        # subject's own key, and there is no subject here.
        self.assertNotIn("descriptor", doc)
        # The door belongs to whatever holds the key and answers at the address,
        # and this producer touched none, so it states no stance either way.
        self.assertNotIn("exposed_a2a", doc)
        # It placed no credentials AND knows it, which is a different fact from
        # not knowing, so the member is present and empty.
        self.assertEqual(doc["secrets_placed"], [])
        # And no harness, because this container runs the command the package
        # named and wakes no model. Naming one would be a claim about a program
        # that was never in the path.
        self.assertNotIn("harness", doc["target"])

    def test_a_container_that_thinks_names_its_harness_and_its_model_key(self):
        # The other kind of container, and the one explainer-critic is. It
        # wakes a model, so the deploy placed a model key by name, and the
        # record says which harness was started in the same member a host
        # deploy uses. The key itself is never in a record; the NAME it is
        # stored under is (11.3).
        doc = record.build({**CONTAINER_RESULT, "package": "explainer-critic", "harness": "opencode",
                            "model": "google/gemini-2.5-flash", "secret_placed": "fleet-gemini-api-key",
                            "smoke": {**CONTAINER_RESULT["smoke"], "by": "harness"}}, None, "UADM")
        self.assertEqual(doc["target"], {"host": "cloud-run/us-central1", "harness": "opencode"})
        self.assertEqual(doc["secrets_placed"], ["fleet-gemini-api-key"])
        self.assertNotIn("google/gemini-2.5-flash", json.dumps(doc["secrets_placed"]))

    def test_a_host_deploy_states_the_custody_and_names_no_image(self):
        doc = record.build({"ok": True, "act": "deploy", "package": "explainer-maker", "version": "0.1.0",
                            "url": "https://agentcatalog.com/x/package.tar.gz", "sha256": "ab" * 32,
                            "host": "fleet-host", "harness": "codex", "interaction": "service",
                            "admitted_at_start": [], "agent_key": "UAKEY",
                            "key_custody": {"minted": "generated", "held_by": ["UAKEY", "root@fleet-host"]},
                            "ceilings": [{"system": "text-to-speech", "per": "task", "limit": 20000,
                                          "unit": "characters", "enforced_by": "runtime"}],
                            "ledger": {"files": 40}, "smoke": {"passed": True}}, None, "UADM")
        self.assertEqual(doc["key_custody"]["minted"], "generated")
        self.assertEqual(len(doc["key_custody"]["held_by"]), 2)
        self.assertNotIn("image_digest", doc)
        self.assertEqual(doc["target"], {"host": "fleet-host", "harness": "codex"})
        self.assertEqual(doc["ceilings"][0]["enforced_by"], "runtime")

    def test_the_shape_is_spelled_the_way_the_builders_record_spells_it(self):
        # Same members and the same counts as the agent builder's own build
        # record, so the two records over one package can be compared rather
        # than translated. A step has a skill too, so `skills` is every skill
        # folder and not only the offered ones.
        shape = image.build_shape(PKGS["process-runner"], os.path.join(TMP, "process-runner", "process-runner"))
        self.assertEqual(sorted(shape), ["records", "refuses", "skills", "systems"])
        # The counts follow the example package. It gained the run-record
        # system, a skill, a record and seven refusals on 2026-09-17, when the
        # runner learned to drive a solution's run. 0.10.2 (2026-09-23) left the
        # run-record system out again until the platform binds it. 0.12.0
        # (2026-10-03) records every conversion of a handoff: one more record.
        self.assertEqual(shape, {"skills": 6, "systems": 0, "refuses": 24, "records": 12})


if __name__ == "__main__":
    unittest.main()


class ACredentialIsAReferenceAndNotAValue(unittest.TestCase):
    """THE EXPOSURE THIS CLOSES. Every credential used to be written onto the
    Cloud Run job as a plain environment variable. --env-vars-file kept it off
    the command line, which was the point at the time, but the job's own spec is
    readable: anyone holding run.jobs.get could read the model key, the speech
    key and the draft host's service-account private key out of it, with nothing
    expiring and no record of the read. Five jobs carried six credentials that
    way (2026-09-12)."""

    def setUp(self):
        self.bindings = explainer_bindings()
        self.harness = {"model": "google/gemini-2.5-pro", "key_env": "GOOGLE_GENERATIVE_AI_API_KEY",
                        "key": "the-real-model-key", "key_secret": "fleet-gemini-api-key"}
        self.values = {"tts-key": "secret-one", "draft-host-writer": "secret-two",
                       "text-reasoning-key": "secret-three"}

    def test_the_job_carries_the_names_and_none_of_the_values(self):
        env = image.job_env("explainer", self.bindings, self.values,
                            install=PKGS["explainer-maker"]["install"], harness=self.harness, secrets=True)
        written = image.env_yaml(env)
        for value in [*self.values.values(), self.harness["key"]]:
            self.assertNotIn(value, written, f"{value} is on the job where anyone with run.jobs.get can read it")
        # What is NOT a credential still rides as a plain variable: the agent's
        # name, its binding, its directories and which model it wakes are
        # addresses and numbers, and a reader of the job should see them.
        self.assertEqual(env["AGENT_NAME"], "explainer")
        self.assertEqual(env["AGENT_MODEL"], "google/gemini-2.5-pro")
        self.assertEqual(env["DRAFT_HOST_BUCKET"], "agentmesh-ai-site")

    def test_every_credential_the_package_names_becomes_a_reference(self):
        refs = image.job_secret_refs(self.bindings, self.harness)
        # The variable the package names, mapped to the name the owner's store
        # uses. One name for a credential, not two to keep in step.
        self.assertEqual(refs["TTS_API_KEY"], "tts-key")
        self.assertEqual(refs["DRAFT_HOST_CREDENTIAL"], "draft-host-writer")
        self.assertEqual(refs["TEXT_API_KEY"], "text-reasoning-key")
        self.assertEqual(refs["GOOGLE_GENERATIVE_AI_API_KEY"], "fleet-gemini-api-key")

    def test_the_flag_asks_for_the_newest_version(self):
        flag = image.secrets_flag({"TTS_API_KEY": "tts-key", "TEXT_API_KEY": "text-reasoning-key"})
        # :latest so a rotation reaches the fleet by adding a version rather
        # than by redeploying five agents.
        self.assertEqual(flag, "TEXT_API_KEY=text-reasoning-key:latest,TTS_API_KEY=tts-key:latest")

    def test_a_package_with_no_credentials_gets_no_flag(self):
        argv = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300, "secrets": {}})
        self.assertFalse([a for a in argv if a.startswith("--set-secrets")],
                         "an agent that names no credential is not handed an empty flag")
        self.assertNotIn("--clear-secrets", argv, "a job being created has nothing to clear")

    def test_an_update_that_leaves_no_credential_clears_the_old_references(self):
        # publisher 0.2.0 stopped declaring draft-host-writer, and without this
        # its job kept the reference, because gcloud keeps what a flag omits.
        argv = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-east1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300, "secrets": {}}, exists=True)
        self.assertIn("--clear-secrets", argv)
        self.assertFalse([a for a in argv if a.startswith("--set-secrets")])
        kept = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-east1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300,
                                      "secrets": {"TEXT_API_KEY": "text-reasoning-key"}}, exists=True)
        self.assertNotIn("--clear-secrets", kept, "an update that sets references replaces them and clears nothing")

    def test_the_job_is_created_with_the_references(self):
        refs = image.job_secret_refs(self.bindings, self.harness)
        argv = image.create_job_argv({"job": "j", "image": STARTED, "region": "us-central1", "bucket": "b",
                                      "env_file": "/tmp/env.yaml", "job_seconds": 300, "secrets": refs})
        flag = next(a for a in argv if a.startswith("--set-secrets="))
        self.assertIn("TTS_API_KEY=tts-key:latest", flag)
        self.assertIn("DRAFT_HOST_CREDENTIAL=draft-host-writer:latest", flag)
        for value in [*self.values.values(), self.harness["key"]]:
            self.assertFalse([a for a in argv if value in a], f"{value} reached the command line")


class AnUpdateReadsTheJobBeforeItWrites(unittest.TestCase):
    """--env-vars-file and --set-secrets each replace every variable of their
    kind, so an update has to know what the job carries before it writes. On
    2026-09-23 the process runner's hand-set publish token, account, api base
    and handle were wiped by the update to 0.10.2, twice."""

    DESCRIBED = json.dumps({"spec": {"template": {"spec": {"template": {"spec": {"containers": [{"env": [
        {"name": "MESH_API_TOKEN", "valueFrom": {"secretKeyRef": {"name": "process-runner-publish-token",
                                                                   "key": "3"}}},
        {"name": "MESH_ACCOUNT", "value": "acct"},
        {"name": "AGENT_MODEL", "value": "google/gemini-2.5-flash"},
        {"name": "OLD_SETTING", "value": "x"},
    ]}]}}}}}})

    def test_the_job_is_read_as_plain_values_and_references(self):
        now = image.job_variables(self.DESCRIBED)
        self.assertEqual(now["secrets"], {"MESH_API_TOKEN": "process-runner-publish-token:3"})
        self.assertEqual(now["env"]["MESH_ACCOUNT"], "acct")

    def test_a_job_that_cannot_be_read_is_a_refusal_and_not_an_empty_job(self):
        for bad in ("not json", "{}", json.dumps({"spec": {}})):
            with self.assertRaises(ValueError):
                image.job_variables(bad)

    def test_what_the_package_does_not_set_is_kept_unless_this_side_placed_it(self):
        env, refs, dropped = image.carry_forward({"AGENT_MODEL": "anthropic/claude-opus-5"}, {},
                                                 image.job_variables(self.DESCRIBED), ["AGENT_MODEL", "OLD_SETTING"])
        self.assertEqual(env, {"AGENT_MODEL": "anthropic/claude-opus-5", "MESH_ACCOUNT": "acct"})
        self.assertEqual(refs, {"MESH_API_TOKEN": "process-runner-publish-token:3"})
        self.assertEqual(dropped, ["OLD_SETTING"])

    def test_the_package_wins_a_name_it_sets_in_either_kind(self):
        # A name the package now places as a reference is not also sent as the
        # plain value the job carried, which gcloud would refuse as a clash.
        env, refs, _ = image.carry_forward({}, {"MESH_ACCOUNT": "account-secret"},
                                           image.job_variables(self.DESCRIBED), [])
        self.assertNotIn("MESH_ACCOUNT", env)
        self.assertEqual(refs["MESH_ACCOUNT"], "account-secret")

    def test_a_carried_reference_keeps_the_version_the_operator_chose(self):
        flag = image.secrets_flag({"MESH_API_TOKEN": "process-runner-publish-token:3", "TTS_API_KEY": "tts-key"})
        self.assertEqual(flag, "MESH_API_TOKEN=process-runner-publish-token:3,TTS_API_KEY=tts-key:latest")

    def test_the_read_asks_for_the_whole_job(self):
        argv = image.describe_job_variables_argv({"job": "j", "region": "us-central1", "project": "p-12345"})
        self.assertEqual(argv[:4], ["run", "jobs", "describe", "j"])
        self.assertIn("--format=json", argv)


class CompositeEditionJob(unittest.TestCase):
    """A single-container edition's job carries each member's own variables
    under that member's prefix, so each member reads its own folders, binding
    and keys and nobody else's, and one time limit covers the whole run."""

    def test_each_members_variables_go_under_its_own_prefix(self):
        got = image.composite_job_variables({
            "fact-writer": {"env": {"AGENT_DIRECTORY_RECORDS": "/mesh/state/fact-writer/records", "AGENT_MODEL": "a/b"},
                            "secrets": {"SPEECH_KEY": "speech-key:latest"},
                            "handle": "fact-writer.me@example.test", "agent_id": "UKEY"},
            "site-reader": {"env": {"AGENT_MODEL": "c/d"}, "secrets": {}},
        })
        self.assertEqual(got["env"]["MEMBER__FACT_WRITER__AGENT_DIRECTORY_RECORDS"], "/mesh/state/fact-writer/records")
        self.assertEqual(got["env"]["MEMBER__FACT_WRITER__AGENT_MODEL"], "a/b")
        self.assertEqual(got["env"]["MEMBER__SITE_READER__AGENT_MODEL"], "c/d")
        self.assertEqual(got["env"]["MEMBER__FACT_WRITER__MESH_SELF_HANDLE"], "fact-writer.me@example.test")
        self.assertEqual(got["env"]["MEMBER__FACT_WRITER__AGENT_ID"], "UKEY")
        self.assertEqual(got["secrets"], {"MEMBER__FACT_WRITER__SPEECH_KEY": "speech-key:latest"})
        self.assertNotIn("AGENT_MODEL", got["env"], "nothing of a member lands where the runner reads it")

    def test_one_time_limit_for_the_whole_run(self):
        self.assertEqual(image.composite_job_seconds(900, [240, 600]), 1740)
        self.assertEqual(image.composite_job_seconds(900, [240], requested=1200), 1200)
        self.assertEqual(image.composite_job_seconds(900, [10 ** 6]), image.COMPOSITE_MAX_SECONDS)
        with self.assertRaises(ValueError):
            image.composite_job_seconds(900, [], requested=-1)
