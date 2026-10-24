#!/usr/bin/env python3
"""The builder passes a price and a revision policy through, and refuses one it could not apply.

What is worth pinning about the price: what a package declares reaches the
install file as the SKU the deployer places, missing only the provider, which
the deployment decides and a package may not carry; free is declarable out
loud and a package that says nothing is free by default; the offerings a price
covers must be offerings and not steps; and money is whole micro-units of a
three-letter currency in one of five closed shapes, so a price the agent's own
node would refuse at start is refused at build time instead.

What is worth pinning about revisions: an offered job's revisions member reaches the
descriptor's offering unchanged; the example package's make-an-explainer
offering carries one, priced per step, and its check-the-fit offering
carries none; and a policy with a count or window that is not a whole
number in range, a step the job does not run, a step priced twice, a price
with no currency or a fractional amount, both steps and flat or neither, a
member the policy does not have, or a revisions member on a job that is not
offered is refused with a plain message and no package is written.

Run: python3 -m unittest discover -s fleet-manager/agentbuilder -p "test_*.py"
"""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build.py")

# The builder is normally run as a program and answered in JSON, which is what
# every test below does. Its pure helpers are also imported, under a name, so a
# rule like "which system names an account can bind" can be tested as a
# decision rather than through a whole build.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("agentbuilder_build", BUILD)
build = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(build)
# The tests that build real packages read them from a folder laid out as
# <family>/<name>/spec.json, such as the AgentMesh repository's packages/.
# Set ADLC_PACKAGES to that folder; without it those tests are skipped.
PACKAGES = os.environ.get("ADLC_PACKAGES") or os.path.join(HERE, "..", "..", "packages")


def package_dir(name):
    """A package's folder, found by its name under its family (packages/<family>/<name>)."""
    if not os.path.isdir(PACKAGES):
        raise unittest.SkipTest("set ADLC_PACKAGES to a folder of packages to run this test")
    for family in sorted(os.listdir(PACKAGES)):
        if os.path.isfile(os.path.join(PACKAGES, family, name, "spec.json")):
            return os.path.join(PACKAGES, family, name)
    raise FileNotFoundError(f"no package named {name} under packages/<family>/")


EXAMPLE = os.path.join(package_dir("explainer-maker"), "spec.json")

PRICE = {"model": "flat", "amount_micro": 500000, "currency": "USD"}
POLICY = {
    "included": {"count": 1, "window_days": 14},
    "steps": [{"id": "draft", "price": dict(PRICE)}, {"id": "polish", "price": {"model": "flat", "amount_micro": 100000, "currency": "USD"}}],
}


def spec(revisions=POLICY, offered=True):
    """A small spec with one offered job over two steps; nothing to copy."""
    jobs = [
        {"slug": "do-it", "title": "Do it", "offered": True, "steps": ["draft", "polish"],
         "when": "when asked", "good": "done", "empty": "say so"},
        {"slug": "draft", "title": "Draft", "offered": False},
        {"slug": "polish", "title": "Polish", "offered": False},
    ]
    if revisions is not None:
        jobs[0 if offered else 1]["revisions"] = copy.deepcopy(revisions)
    return {"name": "revisable", "version": "1.0.0", "description": "Does one thing.",
            "jobs": jobs, "refuses": ["inventing a result"], "records": ["the draft as delivered"]}


class Harness(unittest.TestCase):
    """Build a spec and read what came out; no tests of its own, so a class
    that extends it does not re-run another class's."""


    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="build-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, doc, path=None):
        path = path or os.path.join(self.tmp, "spec.json")
        if doc is not None:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f)
        out = os.path.join(self.tmp, "out")
        p = subprocess.run([sys.executable, BUILD, path, out], capture_output=True, text=True)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        return res, out

    def descriptor(self, res):
        with open(os.path.join(res["path"], "descriptor.json"), encoding="utf-8") as f:
            return json.load(f)

    def refused(self, doc, phrase):
        res, out = self.build(doc)
        self.assertFalse(res["ok"], res)
        self.assertIn(phrase, res["error"])
        self.assertFalse(os.path.exists(os.path.join(out, "revisable")), "a package was written for a refused spec")


class Built(Harness):

    def test_an_offered_jobs_revisions_reach_the_offering_unchanged(self):
        res, _ = self.build(spec())
        self.assertTrue(res["ok"], res)
        offerings = self.descriptor(res)["offerings"]
        self.assertEqual([o["id"] for o in offerings], ["do-it"])
        self.assertEqual(offerings[0]["revisions"], POLICY)
        self.assertEqual([s["id"] for s in offerings[0]["steps"]], ["draft", "polish"])

    def test_job_seconds_reaches_the_install_file_and_a_bad_value_is_refused(self):
        bad = spec()
        bad["job_seconds"] = 5
        self.refused(bad, "job_seconds")
        doc = spec()
        doc["job_seconds"] = 1500
        res, _ = self.build(doc)
        self.assertTrue(res["ok"], res)
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["job_seconds"], 1500)
        plain, _ = self.build(spec())
        with open(os.path.join(plain["path"], "install.json"), encoding="utf-8") as f:
            self.assertNotIn("job_seconds", json.load(f))

    def test_wants_replies_reaches_the_install_file_only_when_true(self):
        bad = spec()
        bad["wants_replies"] = "yes"
        self.refused(bad, "wants_replies")
        doc = spec()
        doc["wants_replies"] = True
        res, _ = self.build(doc)
        self.assertTrue(res["ok"], res)
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            self.assertIs(json.load(f)["wants_replies"], True)
        for quiet in (spec(), {**spec(), "wants_replies": False}):
            res, _ = self.build(quiet)
            with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
                self.assertNotIn("wants_replies", json.load(f))

    def test_one_at_a_time_reaches_the_install_file_as_written_and_a_bad_one_is_refused(self):
        for bad in ({"named_in_text": "no group here"}, {"named_in_text": "(unclosed"}, {"by": "run"}, "run"):
            self.refused({**spec(), "one_at_a_time": bad}, "one_at_a_time")
        doc = {**spec(), "one_at_a_time": {"named_in_text": r"\brun (r-\d{8}-[a-z0-9]{4,12})\b"}}
        res, _ = self.build(doc)
        self.assertTrue(res["ok"], res)
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["one_at_a_time"], {"named_in_text": r"\brun (r-\d{8}-[a-z0-9]{4,12})\b"})
        res, _ = self.build(spec())
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            self.assertNotIn("one_at_a_time", json.load(f))

    def test_a_flat_price_passes_through_too(self):
        flat = {"included": {"count": 0, "window_days": 30}, "flat": dict(PRICE)}
        res, _ = self.build(spec(flat))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["offerings"][0]["revisions"], flat)

    def test_an_offering_without_revisions_carries_none(self):
        res, _ = self.build(spec(None))
        self.assertTrue(res["ok"], res)
        self.assertNotIn("revisions", self.descriptor(res)["offerings"][0])

    def test_the_example_package_prices_each_step_of_the_explainer(self):
        res, _ = self.build(None, EXAMPLE)
        self.assertTrue(res["ok"], res)
        with open(EXAMPLE, encoding="utf-8") as f:
            declared = next(j for j in json.load(f)["jobs"] if j["slug"] == "make-an-explainer")["revisions"]
        by_id = {o["id"]: o for o in self.descriptor(res)["offerings"]}
        self.assertEqual(by_id["make-an-explainer"]["revisions"], declared)
        self.assertEqual([s["id"] for s in declared["steps"]],
                         ["write-the-story", "read-the-brand", "lay-out-the-scenes", "record-the-narration",
                          "check-the-fit", "stage-a-draft"])
        self.assertNotIn("revisions", by_id["check-the-fit"])

    def test_a_step_may_not_carry_revisions(self):
        self.refused(spec(offered=False), "revisions belong to an offered job")

    def test_the_included_count_and_window_are_whole_numbers_in_range(self):
        for inc in ({"count": -1, "window_days": 14}, {"count": 1, "window_days": 0}, {"count": 1.5, "window_days": 14},
                    {"count": True, "window_days": 14}, {"count": "1", "window_days": 14}, {"count": 1}, {}):
            self.refused(spec({**POLICY, "included": inc}), "revisions.included needs an integer count")

    def test_a_priced_step_must_be_a_step_of_the_job(self):
        self.refused(spec({**POLICY, "steps": [{"id": "ship", "price": dict(PRICE)}]}), "revisions step 'ship' is not a step of this job")
        self.refused(spec({**POLICY, "steps": [{"id": "draft", "price": dict(PRICE)}, {"id": "draft", "price": dict(PRICE)}]}),
                     "revisions step 'draft' is priced twice")
        self.refused(spec({**POLICY, "steps": []}), "revisions.steps must be a non-empty list")

    def test_a_price_is_an_integer_amount_and_a_currency(self):
        for price in ({"amount_micro": 5.5, "currency": "USD"}, {"amount_micro": -1, "currency": "USD"},
                      {"amount_micro": 100}, {"amount_micro": 100, "currency": ""}, {"amount_micro": "100", "currency": "USD"},
                      {"amount_micro": 100, "currency": "USD", "model": 3}, None):
            self.refused(spec({**POLICY, "steps": [{"id": "draft", "price": price}]}), "revisions step 'draft' needs a price")
        self.refused(spec({"included": {"count": 1, "window_days": 14}, "flat": {"currency": "USD"}}), "revisions.flat is a price")

    def test_steps_or_flat_and_not_both(self):
        self.refused(spec({**POLICY, "flat": dict(PRICE)}), "not both and not neither")
        self.refused(spec({"included": {"count": 1, "window_days": 14}}), "not both and not neither")

    def test_a_member_the_policy_does_not_have_is_refused(self):
        self.refused(spec({**POLICY, "discount": 10}), "revisions carries 'discount'")
        self.refused(spec("free"), "revisions must be an object")



class TheRecordSaysWhetherAnAccountCanBindWhatItDeclares(unittest.TestCase):
    """A package declaring `database` can be installed by any account that has
    bound one. A package declaring a name nobody reserved has to have that name
    bound by hand at every deploy, forever, and install time is too late to
    learn it. So the build record says which of the two this is."""

    def test_a_package_that_reaches_nothing_says_so(self):
        note = build.systems_note([])
        self.assertEqual(note["kind"], "systems")
        self.assertIn("nothing outside its own folder", note["what"])

    def test_reserved_names_are_named_as_bindable(self):
        note = build.systems_note([{"name": "database"}, {"name": "files"}])
        self.assertEqual(note["kind"], "systems")
        self.assertIn("database", note["what"])
        self.assertIn("an account can bind", note["what"])

    def test_a_name_nobody_reserved_says_what_it_will_cost(self):
        note = build.systems_note([{"name": "our-crm"}])
        self.assertEqual(note["kind"], "systems-unbindable")
        self.assertIn("our-crm", note["what"])
        self.assertIn("by hand", note["what"])

    def test_a_reserved_name_with_no_settled_shape_is_called_out(self):
        note = build.systems_note([{"name": "payments"}])
        self.assertEqual(note["kind"], "systems-unbindable")
        self.assertIn("no settled shape", note["what"])

    def test_the_old_spelling_is_still_read(self):
        note = build.systems_note([{"role": "database"}])
        self.assertIn("database", note["what"])

if __name__ == "__main__":
    unittest.main()


class HowTheWorkIsDone(Harness):
    """`how` on a job travels to the offering and to each step, and the two
    combinations the specification refuses are refused with a plain message.

    The first multi-agent run failed three times in exactly one way, a step
    with a written procedure left to a model to improvise, and nothing in any
    package said which steps those were. These are the checks that stop the
    next one being written.
    """

    SCRIPT = {"control": "script", "intelligence": "called", "cost": "metered", "contract": "full"}
    MODEL = {"control": "model", "intelligence": "open", "cost": "unbounded", "contract": "ends"}

    def with_how(self, offering=None, step=None):
        doc = spec(revisions=None)
        if offering:
            doc["jobs"][0]["how"] = copy.deepcopy(offering)
        if step:
            doc["jobs"][1]["how"] = copy.deepcopy(step)
        return doc

    def test_how_reaches_the_offering_and_its_steps(self):
        res, _ = self.build(self.with_how(offering=self.MODEL, step=self.SCRIPT))
        self.assertTrue(res["ok"], res)
        o = self.descriptor(res)["offerings"][0]
        self.assertEqual(o["how"], self.MODEL)
        self.assertEqual(o["steps"][0]["how"], self.SCRIPT)
        self.assertNotIn("how", o["steps"][1], "a job that declares none says nothing")

    def test_a_method_written_in_full_and_handed_to_a_model_is_refused(self):
        bad = dict(self.MODEL, contract="full")
        self.refused(self.with_how(offering=bad), "handed to a model to improvise")

    def test_a_program_that_hands_the_work_to_a_model_is_refused(self):
        bad = dict(self.SCRIPT, intelligence="open")
        self.refused(self.with_how(offering=bad), "a model with a launcher")

    def test_a_word_outside_its_set_is_refused(self):
        self.refused(self.with_how(offering=dict(self.SCRIPT, cost="cheap")), "how.cost is 'cheap'")

    def test_a_missing_member_is_refused(self):
        short = {k: v for k, v in self.SCRIPT.items() if k != "contract"}
        self.refused(self.with_how(offering=short), "how names no contract")

    def test_a_member_that_does_not_exist_is_refused(self):
        self.refused(self.with_how(offering=dict(self.SCRIPT, speed="fast")), "how has no member 'speed'")


class TheCommandAJobRuns(Harness):
    """`run` reaches the install file, and is refused where it does not belong.

    A host that has a command for a job runs it and never wakes a model to
    decide whether to. The process runner spent a model call per message
    deciding to run the one command its own skill named.
    """

    SCRIPT = {"control": "script", "intelligence": "none", "cost": "none", "contract": "full"}
    RUN = {
        "command": ["node", "{home}/{package}/scripts/turn.mjs", "--job", "{job_dir}",
                    "--message", "{message_id}", "--from", "{sender}",
                    "--in-reply-to", "{in_reply_to}", "--text-file", "{job_dir}/message.txt"],
        "per_file": ["--file", "{file_path}::{file_media_type}"],
        "message_file": "{job_dir}/message.txt",
        "reply": "json:reply",
    }

    def with_run(self, run=None, how=None):
        doc = spec(revisions=None)
        doc["jobs"][0]["how"] = copy.deepcopy(how or self.SCRIPT)
        doc["jobs"][0]["run"] = copy.deepcopy(self.RUN if run is None else run)
        return doc

    def install(self, res):
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_the_command_reaches_the_install_file_under_its_job(self):
        res, _ = self.build(self.with_run())
        self.assertTrue(res["ok"], res)
        run = self.install(res)["run"]["do-it"]
        self.assertEqual(run["command"][0], "node")
        self.assertEqual(run["reply"], "json:reply")
        self.assertEqual(run["message_file"], "{job_dir}/message.txt")

    def test_a_job_with_no_command_carries_no_run(self):
        res, _ = self.build(spec(revisions=None))
        self.assertTrue(res["ok"], res)
        self.assertNotIn("run", self.install(res))

    def test_a_command_on_a_job_a_model_controls_is_refused(self):
        how = {"control": "model", "intelligence": "open", "cost": "none", "contract": "ends"}
        self.refused(self.with_run(how=how), "how says control: script")

    def test_a_command_where_a_model_finds_its_own_way_is_refused(self):
        how = dict(self.SCRIPT, intelligence="open")
        self.refused(self.with_run(how=how), "find its own way")

    def test_a_placeholder_the_host_does_not_know_is_refused(self):
        bad = copy.deepcopy(self.RUN)
        bad["command"][3] = "{jobdir}"
        self.refused(self.with_run(run=bad), "carries {jobdir}, which the host does not substitute")

    def test_a_file_placeholder_outside_per_file_is_refused(self):
        bad = copy.deepcopy(self.RUN)
        bad["command"].append("{file_path}")
        self.refused(self.with_run(run=bad), "carries {file_path}, which the host does not substitute")

    def test_an_empty_command_is_refused(self):
        self.refused(self.with_run(run=dict(self.RUN, command=[])), "non-empty list of strings")

    def test_a_reply_that_is_neither_stdout_nor_a_json_member_is_refused(self):
        self.refused(self.with_run(run=dict(self.RUN, reply="the answer")), "run.reply is 'stdout'")


class WhatItCanBeTold(Harness):
    """`can_use` reaches the descriptor unchanged, and the two claims it
    exists to make impossible are refused.

    The first is a schema that is not an absolute https URI: an address
    nobody else can resolve, or one that can be edited under every
    declaration pointing at it, which is why the version belongs in the URI.
    The second is an entry with no field list. "Reads brand profiles" is the
    same sentence from an agent that honors one color and one that honors
    all of them, so an entry naming a shape and no fields has told a buyer
    nothing they can act on.
    """

    SHAPE = {"schema": "https://schemas.agentmesh.ai/brand/v1",
             "reads": ["palette.ink", "type.heading.family"],
             "required": False,
             "does": "colors the page and sets the heading face"}

    def told(self, can_use):
        doc = spec(revisions=None)
        doc["can_use"] = copy.deepcopy(can_use)
        return doc

    def test_can_use_reaches_the_descriptor_unchanged(self):
        res, _ = self.build(self.told([self.SHAPE]))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["can_use"], [self.SHAPE])

    def test_a_spec_that_says_nothing_carries_no_member(self):
        res, _ = self.build(spec(revisions=None))
        self.assertTrue(res["ok"], res)
        self.assertNotIn("can_use", self.descriptor(res))

    def test_a_schema_that_is_not_an_absolute_https_uri_is_refused(self):
        for bad in ("http://schemas.example/brand/v1", "brand/v1", "schemas.example/brand/v1", ""):
            self.refused(self.told([dict(self.SHAPE, schema=bad)]), "must be an absolute https URI")

    def test_a_shape_with_no_fields_is_refused(self):
        self.refused(self.told([{"schema": self.SHAPE["schema"], "reads": []}]),
                     "reads is a non-empty list of field paths")
        self.refused(self.told([{"schema": self.SHAPE["schema"]}]),
                     "reads is a non-empty list of field paths")

    def test_an_empty_list_is_refused_rather_than_read_as_silence(self):
        self.refused(self.told([]), "leave it out")

    def test_a_shape_named_twice_and_a_field_listed_twice_are_refused(self):
        self.refused(self.told([self.SHAPE, dict(self.SHAPE, reads=["palette.accent"])]),
                     "twice; one entry per shape")
        self.refused(self.told([dict(self.SHAPE, reads=["palette.ink", "palette.ink"])]),
                     "a field is listed twice")

    def test_a_member_that_does_not_exist_is_refused(self):
        self.refused(self.told([dict(self.SHAPE, writes=["palette.ink"])]),
                     "can_use entry has no member 'writes'")


class WhatARunConfigMaySet(Harness):
    """`run_config` reaches the descriptor as declared (docs/run-config-plan.md
    2.2), because the platform resolves and refuses a run config from the
    registered descriptor alone; and a declaration the platform would refuse
    the first time anybody used it is refused here instead."""

    MODEL = {"name": "model", "kind": "rule", "default": "google/gemini-3.8-flash",
             "allowed": ["google/gemini-3.8-flash", "google/gemini-3.5-pro"], "job_may_set": False}
    SPEAKER = {"name": "speaker", "kind": "preference", "default": "the deck's author",
               "allowed": ["the deck's author", "a narrator"], "job_may_set": True}
    BLOCK = {"settings": [MODEL, SPEAKER], "tested_models": ["google/gemini-3.8-flash"],
             "named": [{"name": "Deck explainer, Oct 6", "settings": {"speaker": "the deck's author"}}]}

    def told(self, run_config):
        doc = spec(revisions=None)
        doc["run_config"] = copy.deepcopy(run_config)
        return doc

    @staticmethod
    def digest_of(entry):
        # JCS for words and objects of words: sorted keys, no spaces.
        import hashlib
        body = json.dumps({k: v for k, v in entry.items() if k != "digest"}, sort_keys=True,
                          separators=(",", ":"), ensure_ascii=False)
        return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()

    def test_run_config_reaches_the_descriptor_as_declared_with_each_named_digest(self):
        res, _ = self.build(self.told(self.BLOCK))
        self.assertTrue(res["ok"], res)
        want = copy.deepcopy(self.BLOCK)
        want["named"][0]["digest"] = self.digest_of(want["named"][0])
        self.assertEqual(self.descriptor(res)["run_config"], want)
        res, _ = self.build(self.told(want))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["run_config"], want)

    def test_a_named_digest_that_is_not_its_own_is_refused(self):
        bad = copy.deepcopy(self.BLOCK)
        bad["named"][0]["digest"] = "sha256:" + "0" * 64
        self.refused(self.told(bad), "is not the SHA-256 of its JCS form")

    def test_a_spec_that_says_nothing_carries_no_member_and_an_empty_one_carries_none_settable(self):
        res, _ = self.build(spec(revisions=None))
        self.assertTrue(res["ok"], res)
        self.assertNotIn("run_config", self.descriptor(res))
        res, _ = self.build(self.told({"settings": []}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["run_config"], {"settings": []})

    def test_a_setting_without_a_kind_default_or_job_may_set_is_refused(self):
        self.refused(self.told({"settings": [dict(self.MODEL, kind="wish")]}), "kind is preference")
        no_default = {k: v for k, v in self.MODEL.items() if k != "default"}
        self.refused(self.told({"settings": [no_default]}), "a default is required")
        self.refused(self.told({"settings": [dict(self.MODEL, job_may_set="no")]}), "job_may_set is true or false")

    def test_a_default_outside_its_own_allowed_list_is_refused(self):
        self.refused(self.told({"settings": [dict(self.MODEL, default="google/gemini-2.5-flash")]}),
                     "is not in its own allowed list")

    def test_a_named_run_config_that_sets_the_undeclared_or_the_disallowed_is_refused(self):
        self.refused(self.told(dict(self.BLOCK, named=[{"name": "x", "settings": {"voice": "Orus"}}])),
                     "which this agent does not declare")
        self.refused(self.told(dict(self.BLOCK, named=[{"name": "x", "settings": {"speaker": "a ghost"}}])),
                     "not in its allowed list")

    def test_a_member_that_does_not_exist_and_a_setting_named_twice_are_refused(self):
        self.refused(self.told(dict(self.BLOCK, locks=[])), "run_config has no member 'locks'")
        self.refused(self.told({"settings": [self.MODEL, self.MODEL]}), "declares the setting model twice")

    def test_replay_reaches_the_descriptor_when_true_and_a_word_is_refused(self):
        res, _ = self.build(self.told({"settings": [], "replay": True}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["run_config"], {"settings": [], "replay": True})
        res, _ = self.build(self.told({"settings": [], "replay": False}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["run_config"], {"settings": []})

    def test_replay_that_is_not_true_or_false_is_refused(self):
        self.refused(self.told({"settings": [], "replay": "yes"}), "run_config.replay is true")


class Ceilings(Harness):
    """Which side applies a ceiling is derived from how the package reaches
    the system, and a package that does not say how is refused rather than
    guessed at: a wrong word here reads to a buyer as somebody watching the
    spend."""

    def spending(self, **system):
        doc = spec(revisions=None)
        doc["systems"] = [dict({"role": "a-service", "kind": "service", "access": "trigger",
                                "needs": "the work", "spends": {"unit": "calls"}}, **system)]
        return doc

    def ceilings_of(self, res):
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            return json.load(f)["ceilings"]

    def test_a_system_the_scripts_call_themselves_is_enforced_by_the_runtime(self):
        res, _ = self.build(self.spending(credential="a-key", env="A_KEY"))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.ceilings_of(res), [{"system": "a-service", "per": "task", "enforced_by": "runtime"}])

    def test_a_ceiling_whose_side_cannot_be_told_is_refused(self):
        self.refused(self.spending(), "cannot tell which side applies its ceiling")

    def test_an_enforcing_side_written_into_the_spec_is_refused(self):
        doc = self.spending(credential="a-key", env="A_KEY")
        doc["ceilings"] = [{"system": "a-service", "per": "task", "enforced_by": "platform"}]
        self.refused(doc, "derived from how the package reaches the system")


class WhatTheAgentCharges(Harness):
    """The price a package declares reaches the install file as the SKU the
    deployer will place, and a price the agent's own node would refuse is
    refused here instead, where there is a person to tell.

    Two things this pins on purpose. A package that says nothing about money
    installs and is free, because free is the default and paid is the declared
    exception; and no provider and no address travel in a package, because the
    deployment decides who bills and a package that named a console would be
    tied to one mesh.
    """

    def install(self, res):
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            return json.load(f)

    def priced(self, price):
        doc = spec(revisions=None)
        doc["price"] = copy.deepcopy(price)
        return doc

    def test_a_price_reaches_the_install_file_as_a_sku_without_its_provider(self):
        res, _ = self.build(self.priced({"model": "flat", "amount_micro": 2000000, "currency": "USD"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"], {
            "sku": "default", "covers": {"agent": True},
            "price": {"model": "flat", "amount_micro": 2000000, "currency": "USD"}})

    def test_a_package_that_names_no_price_carries_none_and_still_builds(self):
        res, _ = self.build(spec(revisions=None))
        self.assertTrue(res["ok"], res)
        self.assertNotIn("price", self.install(res))

    def test_free_is_declarable_out_loud(self):
        res, _ = self.build(self.priced({"model": "free"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"]["price"], {"model": "free"})

    def test_the_offerings_a_price_covers_are_named_and_checked(self):
        # The refusals run first: refused() proves no package was written, and
        # a package left by an earlier successful build in the same test would
        # be read as one this refusal wrote.
        #
        # A step is not something a caller orders, so a price cannot cover one.
        self.refused(self.priced({"model": "flat", "amount_micro": 5, "currency": "USD", "covers": ["draft"]}),
                     "'draft', which is not an offered job")
        self.refused(self.priced({"model": "flat", "amount_micro": 5, "currency": "USD", "covers": []}),
                     "price.covers is a list of the offerings")
        self.refused(self.priced({"model": "flat", "amount_micro": 5, "currency": "USD", "covers": ["do-it", "do-it"]}),
                     "names the same offering twice")
        res, _ = self.build(self.priced({"model": "flat", "amount_micro": 500000,
                                         "currency": "USD", "covers": ["do-it"]}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"]["covers"], {"offerings": ["do-it"]})

    def test_a_sku_id_is_the_id_an_agreement_binds_to(self):
        self.refused(self.priced({"model": "flat", "amount_micro": 5, "currency": "USD", "sku": "The Brief"}),
                     "price.sku is the id an agreement binds to")
        res, _ = self.build(self.priced({"model": "flat", "amount_micro": 5, "currency": "USD", "sku": "the-brief"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"]["sku"], "the-brief")

    def test_money_is_whole_micro_units_of_a_named_currency(self):
        for bad, phrase in (
            ({"model": "flat", "amount_micro": 2.5, "currency": "USD"}, "whole number of micro-units"),
            ({"model": "flat", "amount_micro": -1, "currency": "USD"}, "whole number of micro-units"),
            ({"model": "flat", "amount_micro": "200", "currency": "USD"}, "whole number of micro-units"),
            ({"model": "flat", "amount_micro": True, "currency": "USD"}, "whole number of micro-units"),
            ({"model": "flat", "amount_micro": 200}, "three-letter code"),
            ({"model": "flat", "amount_micro": 200, "currency": "dollars"}, "three-letter code"),
        ):
            self.refused(self.priced(bad), phrase)

    def test_a_model_outside_the_five_and_a_field_a_model_does_not_name_are_refused(self):
        self.refused(self.priced({"model": "hourly", "amount_micro": 200, "currency": "USD"}),
                     "model is one of free, flat, per_unit, package, tiered")
        self.refused(self.priced({"amount_micro": 200, "currency": "USD"}),
                     "model is one of free, flat, per_unit, package, tiered")
        self.refused(self.priced({"model": "free", "amount_micro": 200, "currency": "USD"}),
                     "'amount_micro' is not a field of the free shape")
        self.refused(self.priced({"model": "flat", "amount_micro": 200, "currency": "USD", "meter": "tokens_out"}),
                     "'meter' is not a field of the flat shape")
        self.refused(self.priced("free"), "price is an object")

    def test_a_metered_price_names_its_meter_and_its_allowance_resets(self):
        good = {"model": "per_unit", "amount_micro": 1500, "currency": "USD",
                "meter": "tokens_out", "per": 1000, "included": {"quantity": 50000, "period": "month"}}
        self.refused(self.priced({k: v for k, v in good.items() if k != "meter"}), "names the meter it rates")
        self.refused(self.priced({**good, "per": 0}), "per is a whole number above zero")
        self.refused(self.priced({**good, "included": {"quantity": 50000}}),
                     "an allowance with no period never resets")
        res, _ = self.build(self.priced(good))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"]["price"], good)

    def test_a_tiered_price_ends_unbounded(self):
        good = {"model": "tiered", "currency": "USD", "meter": "tokens_out", "period": "month",
                "tiers": [{"up_to": 1000, "amount_micro": 2000}, {"amount_micro": 1000}]}
        self.refused(self.priced({**good, "tiers": [{"up_to": 1000, "amount_micro": 2000},
                                                    {"up_to": 2000, "amount_micro": 1000}]}),
                     "the last tier is unbounded")
        self.refused(self.priced({**good, "period": "week"}), "needs a period of day or month")
        res, _ = self.build(self.priced(good))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.install(res)["price"]["price"], good)

    def test_a_provider_or_an_address_in_a_package_is_refused(self):
        for bad in ({"model": "flat", "amount_micro": 5, "currency": "USD", "provider": {"id": "internal"}},
                    {"model": "flat", "amount_micro": 5, "currency": "USD", "checkout_url": "https://x.test/pay"},
                    {"model": "flat", "amount_micro": 5, "currency": "USD", "terms_url": "https://x.test/terms"}):
            self.refused(self.priced(bad), "price names no provider and no address")

    def test_the_chain_packages_carry_the_prices_they_declare(self):
        """The five packages of the explainer chain, built from their own
        specs. The runner is free out loud rather than free by omission: a
        storefront reader cannot tell an agent that decided to be free from
        one nobody has priced, and those are different offers."""
        want = {
            "process-runner": ({"model": "free"}, {"agent": True}),
            "video-watcher": ({"model": "flat", "amount_micro": 2500000, "currency": "USD"}, {"agent": True}),
            "brief-writer": ({"model": "flat", "amount_micro": 2000000, "currency": "USD"}, {"agent": True}),
            "explainer-maker": ({"model": "flat", "amount_micro": 5000000, "currency": "USD"},
                                {"offerings": ["make-an-explainer"]}),
            "explainer-critic": ({"model": "flat", "amount_micro": 1000000, "currency": "USD"}, {"agent": True}),
        }
        for name, (price, covers) in want.items():
            res, _ = self.build(None, os.path.join(package_dir(name), "spec.json"))
            self.assertTrue(res["ok"], f"{name}: {res}")
            declared = self.install(res)["price"]
            self.assertEqual(declared["price"], price, name)
            self.assertEqual(declared["covers"], covers, name)

    def test_a_priced_job_costs_at_least_what_redoing_all_of_it_costs(self):
        """The rule the chain's first prices were set by: a buyer who paid for
        the job and then had every step of it redone must not have paid less
        the first time. It is checked here and not in the builder because it
        is a judgment about these five packages, not a rule of the
        specification: a package is free to price a revision above a first run
        and say why."""
        for name in ("video-watcher", "brief-writer", "explainer-maker"):
            with open(os.path.join(package_dir(name), "spec.json"), encoding="utf-8") as f:
                doc = json.load(f)
            redo = sum(s["price"]["amount_micro"]
                       for j in doc["jobs"] for s in (j.get("revisions") or {}).get("steps", []))
            self.assertGreaterEqual(doc["price"]["amount_micro"], redo, name)


class ADeliveryCheckShipsWithThePackage(Harness):
    """A job where the model is in control can write any record it likes,
    including one that says it is done. A package may name a script the host
    runs over the job folder before the reply is accepted, and it has to be
    one the package ships."""

    def with_script(self, verify):
        doc = spec()
        os.makedirs(os.path.join(self.tmp, "scripts"), exist_ok=True)
        with open(os.path.join(self.tmp, "scripts", "verify.mjs"), "w", encoding="utf-8") as f:
            f.write("// checks a delivery\n")
        doc["jobs"][0]["scripts"] = ["scripts/verify.mjs"]
        if verify is not None:
            doc["verify"] = verify
        return doc

    def test_it_reaches_the_install_file_as_a_path_inside_the_package(self):
        res, _ = self.build(self.with_script({"job": "do-it", "script": "scripts/verify.mjs"}))
        self.assertTrue(res["ok"], res)
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["verify"], "skills/do-it/scripts/verify.mjs")
        self.assertTrue(os.path.exists(os.path.join(res["path"], "skills", "do-it", "scripts", "verify.mjs")))
        plain, _ = self.build(self.with_script(None))
        with open(os.path.join(plain["path"], "install.json"), encoding="utf-8") as f:
            self.assertNotIn("verify", json.load(f))

    def test_it_must_name_a_job_of_this_spec_and_a_script_that_job_ships(self):
        self.refused(self.with_script("scripts/verify.mjs"), "verify names a job and one of its scripts")
        self.refused(self.with_script({"job": "nope", "script": "scripts/verify.mjs"}), "not a job of this spec")
        self.refused(self.with_script({"job": "draft", "script": "scripts/verify.mjs"}), "does not ship under scripts")


class ASystemIsNamedAndRoleIsItsAlias(Harness):
    """Common Agent 0.16.0-draft renamed systems[].role to systems[].name,
    because `role` already means the standard job an agent holds. Both
    spellings are read for one revision, `name` wins where a spec carries
    both, and what the builder writes is always `name`."""

    def with_system(self, entry):
        doc = spec(revisions=None)
        doc["systems"] = [dict({"access": "read", "needs": "the work", "kind": "directory"}, **entry)]
        return doc

    def systems_of(self, res, file):
        with open(os.path.join(res["path"], file), encoding="utf-8") as f:
            return json.load(f)["systems"]

    def test_a_spec_that_says_name_builds(self):
        res, _ = self.build(self.with_system({"name": "the-ledger"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["systems"], ["the-ledger"])
        self.assertEqual(self.systems_of(res, "descriptor.json")[0]["name"], "the-ledger")
        self.assertEqual(self.systems_of(res, "install.json")[0]["name"], "the-ledger")

    def test_a_spec_that_still_says_role_builds_the_same(self):
        res, _ = self.build(self.with_system({"role": "the-ledger"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["systems"], ["the-ledger"])
        for file in ("descriptor.json", "install.json"):
            entry = self.systems_of(res, file)[0]
            self.assertEqual(entry["name"], "the-ledger")
            self.assertNotIn("role", entry, f"{file} carried the alias through")

    def test_where_both_are_present_name_wins(self):
        res, _ = self.build(self.with_system({"name": "the-ledger", "role": "the-alias"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["systems"], ["the-ledger"])
        self.assertEqual(self.systems_of(res, "descriptor.json")[0]["name"], "the-ledger")

    def test_a_system_that_names_itself_neither_way_is_refused(self):
        self.refused(self.with_system({}), "each system needs a name")

    def test_the_generated_view_names_the_system(self):
        res, _ = self.build(self.with_system({"role": "the-ledger"}))
        with open(os.path.join(res["path"], "net.agentdoc.package", "SYSTEMS.md"), encoding="utf-8") as f:
            text = f.read()
        self.assertIn("| the-ledger |", text)
        self.assertIn("| System | Kind | Access |", text)


class WhereAReaderGoes(Harness):
    """The three manifest members that carry an address, and the lineage that
    carries one more (Common Agent 0.17.0-draft, 12.6 rule 3 and 13.5).

    Until 0.17.0-draft a package could carry exactly one address, its own
    $schema, which forbade the homepage and repository members of the very
    format the manifest is written in. What each of the excepted members has
    in common is that it says where a READER goes and nothing fetches it at
    install or at run. An author page is not one of them, and neither is an
    address anywhere else in the manifest.
    """

    ANCESTOR = {"name": "quiz-maker", "version": "1.2.0",
                "repository": "https://github.com/example/quiz-maker",
                "commit": "9f2c1d4", "license": "Apache-2.0"}

    def manifest(self, res):
        with open(os.path.join(res["path"], "plugin.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_the_license_the_page_and_the_repository_reach_the_manifest(self):
        res, _ = self.build(dict(spec(), license="Apache-2.0",
                                 homepage="https://example.test/quiz-maker",
                                 repository="https://github.com/example/quiz-maker"))
        self.assertTrue(res["ok"], res)
        m = self.manifest(res)
        self.assertEqual(m["license"], "Apache-2.0")
        self.assertEqual(m["homepage"], "https://example.test/quiz-maker")
        self.assertEqual(m["repository"], "https://github.com/example/quiz-maker")

    def test_a_package_that_says_none_of_them_carries_none_of_them(self):
        res, _ = self.build(spec())
        m = self.manifest(res)
        for k in ("license", "homepage", "repository"):
            self.assertNotIn(k, m)

    def test_an_author_page_is_still_refused(self):
        self.refused(dict(spec(), author={"name": "Someone", "url": "https://example.test/me"}),
                     "an author page is an address")

    def test_an_address_in_the_description_is_still_refused(self):
        self.refused(dict(spec(), description="Does one thing. See https://example.test/docs."),
                     "description carries an address")

    def test_a_homepage_that_is_not_an_address_is_refused(self):
        self.refused(dict(spec(), homepage="example.test"), "homepage is the https address")

    def test_what_it_was_copied_from_reaches_the_namespace(self):
        res, _ = self.build(dict(spec(), **{"from": [self.ANCESTOR]}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.manifest(res)["extensions"]["net.agentdoc.package"]["from"], [self.ANCESTOR])

    def test_an_ancestor_missing_the_commit_it_was_taken_at_is_refused(self):
        bad = {k: v for k, v in self.ANCESTOR.items() if k != "commit"}
        self.refused(dict(spec(), **{"from": [bad]}), "is missing commit")

    def test_an_ancestor_whose_repository_is_not_an_address_is_refused(self):
        bad = dict(self.ANCESTOR, repository="example/quiz-maker")
        self.refused(dict(spec(), **{"from": [bad]}), "repository is the https address")

    def test_an_ancestor_carrying_anything_else_is_refused(self):
        bad = dict(self.ANCESTOR, endpoint="https://quiz.example.test/inbox")
        self.refused(dict(spec(), **{"from": [bad]}), "which a lineage entry does not have")

    def test_a_package_copied_from_nothing_carries_no_lineage(self):
        res, _ = self.build(spec())
        self.assertNotIn("from", self.manifest(res)["extensions"]["net.agentdoc.package"])


COMMIT = "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"


def container_spec(**over):
    """A container agent's spec (docs/container-agents-plan.md): the usual
    declarations, no scripts, and a container block saying where the code is."""
    doc = dict(spec(), kind="third-party-framework", claims=["ring-member"], container={
        "repository": "https://github.com/AgentMesh-Community/reference-agents", "path": "frameworks/crewai",
        "commit": COMMIT, "dockerfile": "Dockerfile", "placement": "service", "holds_own_key": True,
        "settings": [{"env": "RING_HANDLE", "purpose": "the member's own handle", "required": True}],
        "secrets": [], "cpu": "1", "memory": "1Gi", "ready_line": "ring member ready"})
    doc.update(over)
    return doc


class AContainerAgentIsCheckedAndNotPacked(Harness):
    """A third-party-framework or mesh-coded agent's code lives in its own
    repository folder with its own Dockerfile. The builder checks its spec in
    words and makes no package: nothing is written, and the answer says why."""

    def test_a_container_spec_is_checked_and_nothing_is_written(self):
        for k in ("third-party-framework", "mesh-coded"):
            res, _ = self.build(container_spec(kind=k))
            self.assertTrue(res["ok"], res)
            self.assertEqual(res["act"], "checked")
            self.assertFalse(res["packed"])
            self.assertIn("builds that folder's own Dockerfile", res["why"])
            self.assertEqual(res["container"]["commit"], COMMIT)
            self.assertEqual(res["container"]["settings"], ["RING_HANDLE"])
            self.assertEqual(res["claims"], ["ring-member"])
            self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "revisable")))

    def test_what_a_container_spec_may_not_say(self):
        base = container_spec()["container"]
        self.refused(dict(spec(), kind="mesh-coded"), "carries a container block")
        self.refused(container_spec(container=dict(base, commit="main")), "40-character commit")
        self.refused(container_spec(container=dict(base, placement="job")), "always-on service")
        self.refused(container_spec(container=dict(base, holds_own_key=False)), "holds its own key")
        self.refused(container_spec(container=dict(base, secrets=[{"env": "API_KEY", "purpose": "the model", "value": "sk-1"}])), "carries a value")
        jobs = copy.deepcopy(container_spec()["jobs"])
        jobs[0]["scripts"] = ["scripts/run.mjs"]
        self.refused(container_spec(jobs=jobs), "names no scripts")
        self.refused(container_spec(claims=["Ring Member"]), "role ids")


class WhatTheInsideIsMadeOf(Harness):
    """`kind`: what an agent's inside is made of. The builder still reads it
    (it routes a container agent) and refuses a value outside the four, but
    never writes it into the draft: Common Agent 0.28.0-draft removed `shape`
    from the Descriptor (6.12), and a writer MUST NOT emit it.
    """

    def test_the_spec_s_kind_never_reaches_the_descriptor(self):
        for k in ("bare-harness", "plugin-on-harness"):
            res, _ = self.build(dict(spec(), kind=k))
            self.assertTrue(res["ok"], res)
            self.assertNotIn("shape", self.descriptor(res))

    def test_a_spec_that_says_nothing_declares_nothing(self):
        res, _ = self.build(spec())
        self.assertTrue(res["ok"], res)
        self.assertNotIn("shape", self.descriptor(res))

    def test_a_kind_outside_the_four_is_refused(self):
        self.refused(dict(spec(), kind="langchain"), "one of bare-harness, plugin-on-harness, mesh-coded, third-party-framework")


def scopes_spec(scopes, on="do-it"):
    doc = spec(None)
    next(j for j in doc["jobs"] if j["slug"] == on)["scopes"] = copy.deepcopy(scopes)
    return doc


class Scopes(Harness):
    """PACT Delegated in the builder (BRIDGE-A2A.md 14.8): an offered job's
    scopes reach its offering in the descriptor, which is where the A2A
    gateway reads a Brand's scopes from; malformed ones are refused."""

    def test_scopes_reach_the_offering_as_declared(self):
        res, _ = self.build(scopes_spec([{"id": "orders:read", "description": " See your orders. "}, {"id": "orders:cancel", "description": "Cancel an order."}]))
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.descriptor(res)["offerings"][0]["scopes"],
                         [{"id": "orders:read", "description": "See your orders."}, {"id": "orders:cancel", "description": "Cancel an order."}])

    def test_no_scopes_leave_the_offering_as_it_was(self):
        res, _ = self.build(spec(None))
        self.assertNotIn("scopes", self.descriptor(res)["offerings"][0])

    def test_malformed_scopes_are_refused(self):
        self.refused(scopes_spec([]), "scopes is a non-empty list")
        self.refused(scopes_spec([{"id": "has space", "description": "x"}]), "is 1 to 64 letters")
        self.refused(scopes_spec([{"id": "a", "description": " "}]), "description is the sentence")
        self.refused(scopes_spec([{"id": "a", "description": "x"}, {"id": "a", "description": "y"}]), "listed twice")
        self.refused(scopes_spec([{"id": "a", "description": "x", "price": 1}]), "nothing else")

    def test_scopes_on_a_step_are_refused(self):
        self.refused(scopes_spec([{"id": "a", "description": "x"}], on="draft"), "scopes belong to an offered job")


FIXTURE = os.path.join(HERE, os.pardir, "conformance-checker", "test", "fixtures", "trial.json")
TRIAL = {"who": "signed_in", "shape": {"inputs": [{"name": "brief", "limit": {"max_chars": 40}}]},
         "limits": {"per_requester_per_day": 2}}
CEILING = {"amount_micro": 5000000, "currency": "USD", "per": "day"}


def trial_spec(trial=TRIAL, on="do-it", ceiling=CEILING, samples=None):
    doc = spec(None)
    doc["jobs"][0]["inputs"] = [{"name": "brief", "kind": "text", "required": True}]
    if trial is not None:
        next(j for j in doc["jobs"] if j["slug"] == on)["trial"] = copy.deepcopy(trial)
    if ceiling is not None:
        doc["trial_ceiling"] = copy.deepcopy(ceiling)
    if samples is not None:
        doc["samples_ref"] = samples
    return doc


class Trials(Harness):
    """Common Agent 7.7 in the builder: the trial travels on the offering, its
    money and the samples flag travel to the host side, and the declarations
    the conformance fixture calls invalid are refused with validateTrial's
    words."""

    def install(self, res):
        with open(os.path.join(res["path"], "install.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_the_fixture_declarations_are_judged_as_the_sdk_judges_them(self):
        with open(FIXTURE, encoding="utf-8") as f:
            fx = json.load(f)
        job = fx["offering"]
        for case in fx["declarations"]["valid"]:
            self.assertIsNone(build.trial_problem(case["trial"], job), case["case"])
        for case in fx["declarations"]["invalid"]:
            self.assertIsNotNone(build.trial_problem(case["trial"], job), case["case"])

    def test_a_trial_reaches_the_offering_and_its_money_reaches_only_the_install_file(self):
        res, _ = self.build(trial_spec(samples=True))
        self.assertTrue(res["ok"], res)
        desc = self.descriptor(res)
        self.assertEqual(desc["offerings"][0]["trial"], TRIAL)
        self.assertNotIn("trial_ceiling", json.dumps(desc))
        self.assertNotIn("samples_ref", desc, "the address is the deploy's to fill, never the draft's")
        inst = self.install(res)
        self.assertEqual(inst["trial_ceiling"], CEILING)
        self.assertIs(inst["samples_ref"], True)

    def test_no_samples_flag_and_no_trial_leave_the_install_file_as_it_was(self):
        self.refused({**spec(), "samples_ref": "yes"}, "samples_ref is true or false")
        res, _ = self.build(spec())
        inst = self.install(res)
        self.assertNotIn("samples_ref", inst)
        self.assertNotIn("trial_ceiling", inst)

    def test_a_trial_with_no_count_is_refused(self):
        self.refused(trial_spec({"who": "anyone", "limits": {}}), "a trial with no count is not bounded")
        self.refused(trial_spec({"who": "anyone"}), "trial.limits is required")

    def test_a_trial_on_a_step_is_refused(self):
        self.refused(trial_spec(on="draft"), "a trial belongs to an offered job")

    def test_a_shape_naming_an_input_the_job_does_not_take_is_refused(self):
        bad = {**TRIAL, "shape": {"inputs": [{"name": "focus", "limit": {"max_chars": 5}}]}}
        self.refused(trial_spec(bad), 'names "focus", which the offering does not declare')

    def test_a_trial_without_a_suggested_ceiling_is_refused_with_why(self):
        self.refused(trial_spec(ceiling=None), "suggests no trial_ceiling")

    def test_a_ceiling_is_whole_money_per_day_and_needs_a_trial(self):
        for bad in ({**CEILING, "amount_micro": 0}, {**CEILING, "amount_micro": 2.5}, {**CEILING, "per": "task"},
                    {**CEILING, "currency": "usd"}, {**CEILING, "per_1k_tokens_micro": -1}, {**CEILING, "usd": 5}):
            res, _ = self.build(trial_spec(ceiling=bad))
            self.assertFalse(res["ok"], bad)
            self.assertIn("trial_ceiling", res["error"])
        self.refused(trial_spec(trial=None), "no job offers a trial")
