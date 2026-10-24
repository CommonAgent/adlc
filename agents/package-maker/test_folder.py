#!/usr/bin/env python3
"""The builder reads an agent's own files and writes the names Common Agent
0.30.0-draft gave them.

What is worth pinning: a folder convert.py wrote from a spec builds the same
package the spec builds, byte for byte; the package carries
agent-descriptor.json and agent-runtime-requirements.json, the manifest
points at the second under runtime_requirements, and its format is
agent-runtime-requirements-v1; a folder under the old names builds the same
package with a warning, and where both names are present the new one is read;
a folder that says anything the build would not have written is refused,
naming the member, with no package left behind; a spec still builds, with a
warning; and the gate's comparison allows the renames and nothing else.

Run: AGENTMESH_ENV=example python3 -m unittest test_folder
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build.py")
CONVERT = os.path.join(HERE, "convert.py")
_spec = importlib.util.spec_from_file_location("compare_packages", os.path.join(HERE, "compare-packages.py"))
compare = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(compare)


def spec():
    """A spec that reaches every part of both authored files: an offering over
    a step, a script two skills run, a lockfile, a command, a spending service
    with its ceiling, a price, a delivery check, a run config and a trial."""
    return {
        "name": "folder-check", "version": "1.2.0", "license": "Apache-2.0",
        "description": "Reads a note and says what it is about.",
        "jobs": [
            {"slug": "read-a-note", "title": "Read a note", "offered": True, "steps": ["summarize"],
             "when": "when somebody needs a note read", "good": "one sentence", "empty": "say so",
             "does": "Reads the note.", "inputs": [{"name": "note", "kind": "text", "required": True}],
             "outputs": [{"name": "summary", "kind": "text", "when": "per_task"}],
             "how": {"control": "script", "intelligence": "called", "cost": "metered", "contract": "full"},
             "run": {"command": ["node", "{package}/skills/read-a-note/scripts/read.mjs", "{job_dir}"]},
             "instructions": "Read it.\n\nThen say it.",
             "scripts": ["scripts/read.mjs", "scripts/shared.mjs", "scripts/package-lock.json"],
             "lockfile": "scripts/package-lock.json",
             "trial": {"who": "signed_in", "limits": {"per_requester_per_day": 2}},
             "revisions": {"included": {"count": 1, "window_days": 7},
                           "steps": [{"id": "summarize", "price": {"amount_micro": 100000, "currency": "USD"}}]}},
            {"slug": "summarize", "title": "Summarize", "offered": False,
             "does": "Writes the sentence.", "scripts": ["scripts/shared.mjs"],
             "references": ["notes/style.md"],
             "how": {"control": "model", "intelligence": "open", "cost": "metered", "contract": "ends"}},
        ],
        "systems": [{"name": "text-model", "access": "trigger", "needs": "to write the sentence",
                     "kind": "service", "credential": "model-key", "env": "MODEL_KEY",
                     "spends": {"unit": "tokens"}, "leaves": True}],
        "ceilings": [{"system": "text-model", "per": "task", "suggested": 5000}],
        "refuses": ["Reading anything but text", "Guessing"],
        "escalates": ["A note that names a person"],
        "records": ["the summary", {"name": "the spend", "when": "standing", "file": "*/spend.json"}],
        "runtimes": [{"name": "node", "version": ">=22"}],
        "price": {"model": "flat", "amount_micro": 200000, "currency": "USD", "covers": ["read-a-note"]},
        "trial_ceiling": {"amount_micro": 1000000, "currency": "USD", "per": "day"},
        "verify": {"job": "read-a-note", "script": "scripts/read.mjs"},
        "run_config": {"settings": [{"name": "model", "kind": "rule", "default": "m1", "allowed": ["m1", "m2"], "job_may_set": False}],
                       "named": [{"name": "Plain", "settings": {"model": "m1"}}]},
        "job_seconds": 600, "wants_replies": True, "answer": "summary",
    }


def tree(root):
    return {os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/"): open(os.path.join(d, n), "rb").read()
            for d, _, ns in os.walk(root) for n in ns}


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="folder-test-")
        self.src = os.path.join(self.tmp, "agent")
        os.makedirs(os.path.join(self.src, "scripts"))
        os.makedirs(os.path.join(self.src, "notes"))
        for rel, text in (("scripts/read.mjs", "// reads\n"), ("scripts/shared.mjs", "// shared\n"),
                          ("scripts/package-lock.json", "{}\n"), ("notes/style.md", "# Style\n")):
            with open(os.path.join(self.src, rel), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
        with open(os.path.join(self.src, "spec.json"), "w", encoding="utf-8") as f:
            json.dump(spec(), f, indent=2)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_py(self, *args):
        p = subprocess.run([sys.executable, *args], capture_output=True, text=True, encoding="utf-8")
        return json.loads(p.stdout.strip().splitlines()[-1]), p.stderr

    def build(self, src, out):
        return self.run_py(BUILD, src, os.path.join(self.tmp, out))

    def convert(self):
        res, _ = self.run_py(CONVERT, os.path.join(self.src, "spec.json"))
        self.assertTrue(res["ok"], res)
        os.remove(os.path.join(self.src, "spec.json"))
        return res

    def json_at(self, *p):
        with open(os.path.join(*p), encoding="utf-8") as f:
            return json.load(f)

    def edit(self, name, fn):
        path = os.path.join(self.src, name)
        doc = self.json_at(path)
        fn(doc)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(doc, indent=2) + "\n")

    def refused(self, phrase):
        res, _ = self.build(self.src, "out")
        self.assertFalse(res["ok"], res)
        self.assertIn(phrase, res["error"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "folder-check")), "a package was written for a refused folder")


class AFolderBuildsWhatItsSpecBuilt(Harness):
    def test_the_converted_folder_builds_the_spec_s_package_byte_for_byte(self):
        from_spec, err = self.build(os.path.join(self.src, "spec.json"), "a")
        self.assertTrue(from_spec["ok"], from_spec)
        self.assertIn("deprecated", err)
        self.assertIn("deprecated", " ".join(from_spec["warnings"]))
        self.convert()
        from_folder, _ = self.build(self.src, "b")
        self.assertTrue(from_folder["ok"], from_folder)
        self.assertEqual(tree(from_spec["path"]), tree(from_folder["path"]))
        self.assertEqual(from_folder["input"], "folder")
        self.assertNotIn("warnings", from_folder)

    def test_the_package_carries_the_new_names_pointer_and_format(self):
        self.convert()
        res, _ = self.build(self.src, "out")
        files = set(tree(res["path"]))
        self.assertIn("agent-descriptor.json", files)
        self.assertIn("agent-runtime-requirements.json", files)
        self.assertNotIn("descriptor.json", files)
        self.assertNotIn("install.json", files)
        own = self.json_at(res["path"], "plugin.json")["extensions"]["net.agentdoc.package"]
        self.assertEqual(own["runtime_requirements"]["path"], "agent-runtime-requirements.json")
        self.assertEqual(own["descriptor"]["path"], "agent-descriptor.json")
        self.assertNotIn("install", own)
        self.assertNotIn("build", own, "the builder's own entry never reaches a package")
        self.assertEqual(self.json_at(res["path"], "agent-runtime-requirements.json")["format"], "agent-runtime-requirements-v1")
        self.assertEqual(res["runtime_requirements_sha256"], res["install_sha256"])
        self.assertEqual(res["runtime_requirements_sha256"], own["runtime_requirements"]["sha256"])

    def test_a_script_two_skills_run_is_kept_once_and_copied_into_both(self):
        self.convert()
        build = self.json_at(self.src, "plugin.json")["extensions"]["net.agentdoc.package"]["build"]
        self.assertEqual(list(build["skills"]), ["read-a-note", "summarize"])
        self.assertIn("scripts/shared.mjs", build["skills"]["summarize"]["scripts"])
        res, _ = self.build(self.src, "out")
        files = tree(res["path"])
        self.assertIn("skills/read-a-note/scripts/shared.mjs", files)
        self.assertIn("skills/summarize/scripts/shared.mjs", files)
        self.assertIn("Read it.\n\nThen say it.", files["skills/read-a-note/SKILL.md"].decode())

    def test_convert_will_not_write_over_an_agent_s_files(self):
        self.convert()
        with open(os.path.join(self.src, "spec.json"), "w", encoding="utf-8") as f:
            json.dump(spec(), f)
        res, _ = self.run_py(CONVERT, os.path.join(self.src, "spec.json"))
        self.assertFalse(res["ok"])
        self.assertIn("--force", res["error"])


class TheOldNamesAreStillRead(Harness):
    def to_old_names(self):
        os.rename(os.path.join(self.src, "agent-descriptor.json"), os.path.join(self.src, "descriptor.json"))
        os.rename(os.path.join(self.src, "agent-runtime-requirements.json"), os.path.join(self.src, "install.json"))
        self.edit("install.json", lambda d: d.update(format="agent-install-v1"))

    def test_a_folder_under_the_old_names_builds_the_same_package_with_warnings(self):
        self.convert()
        now, _ = self.build(self.src, "a")
        self.to_old_names()
        old, err = self.build(self.src, "b")
        self.assertTrue(old["ok"], old)
        self.assertEqual(tree(now["path"]), tree(old["path"]))
        said = " ".join(old["warnings"])
        self.assertIn("descriptor.json is read as agent-descriptor.json", said)
        self.assertIn("install.json is read as agent-runtime-requirements.json", said)
        self.assertIn("agent-install-v1", said)
        self.assertIn("warning", err)

    def test_where_both_names_are_present_the_new_one_is_read(self):
        self.convert()
        shutil.copy(os.path.join(self.src, "agent-descriptor.json"), os.path.join(self.src, "descriptor.json"))
        self.edit("descriptor.json", lambda d: d.update(does="Something else entirely."))
        res, _ = self.build(self.src, "out")
        self.assertTrue(res["ok"], res)
        self.assertIn("Reads a note", self.json_at(res["path"], "agent-descriptor.json")["does"])
        self.assertTrue(any("both agent-descriptor.json and descriptor.json" in w for w in res["warnings"]))


class AFolderThatSaysWhatTheBuildWouldNotIsRefused(Harness):
    def setUp(self):
        super().setUp()
        self.convert()

    def test_a_member_the_builder_does_not_write(self):
        self.edit("agent-descriptor.json", lambda d: d["offerings"][0].update(colour="blue"))
        self.refused("offerings[0].colour")

    def test_an_enforcing_side_the_system_does_not_imply(self):
        self.edit("agent-runtime-requirements.json", lambda d: d["ceilings"][0].update(enforced_by="platform"))
        self.refused("ceilings[0].enforced_by")

    def test_a_lockfile_digest_that_is_not_the_file_s(self):
        self.edit("agent-runtime-requirements.json", lambda d: d["dependencies"][0].update(sha256="0" * 64))
        self.refused("dependencies[0].sha256")

    def test_a_description_the_descriptor_does_not_share(self):
        self.edit("plugin.json", lambda d: d.update(description="Something else."))
        self.refused("does")

    def test_an_offering_with_no_skill(self):
        shutil.rmtree(os.path.join(self.src, "skills", "summarize"))
        self.refused("has no skills/summarize/SKILL.md")

    def test_a_skill_with_no_offering(self):
        os.makedirs(os.path.join(self.src, "skills", "stray"))
        self.refused("skills/stray stands for no offering or step")

    def test_a_skill_whose_frontmatter_is_not_its_own(self):
        p = os.path.join(self.src, "skills", "summarize", "SKILL.md")
        text = open(p, encoding="utf-8").read().replace("name: summarize", "name: other")
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        self.refused("skills/summarize/SKILL.md needs frontmatter")

    def test_a_build_member_the_builder_does_not_read(self):
        self.edit("plugin.json", lambda d: d["extensions"]["net.agentdoc.package"]["build"].update(colour="blue"))
        self.refused("build.colour is not something the builder reads")

    def test_an_unknown_runtime_requirements_format(self):
        self.edit("agent-runtime-requirements.json", lambda d: d.update(format="agent-install-v2"))
        self.refused("agent-install-v2")

    def test_the_scripts_a_skill_names_are_still_required(self):
        os.remove(os.path.join(self.src, "notes", "style.md"))
        self.refused("does not exist: notes/style.md")


class TheGateAllowsTheRenamesAndNothingElse(Harness):
    def old_package(self):
        """A package as the builder before 0.30.0-draft wrote it: the new
        package with the old names, pointer and format put back."""
        self.convert()
        res, _ = self.build(self.src, "new")
        files = tree(res["path"])
        old = dict(files)
        desc = old.pop("agent-descriptor.json")
        inst = old.pop("agent-runtime-requirements.json").decode().replace(compare.NEW_FORMAT_LINE, compare.OLD_FORMAT_LINE).encode()
        old["descriptor.json"], old["install.json"] = desc, inst
        m = json.loads(old["plugin.json"])
        own = m["extensions"]["net.agentdoc.package"]
        m["extensions"]["net.agentdoc.package"] = {
            ("install" if k == "runtime_requirements" else k):
                ({"path": "install.json", "sha256": compare.sha(inst)} if k == "runtime_requirements"
                 else {**v, "path": "descriptor.json"} if k == "descriptor" else v)
            for k, v in own.items()}
        old["plugin.json"] = compare.dumps(m).encode()
        return old, files

    def test_the_renames_normalize_away(self):
        old, new = self.old_package()
        problems = []
        self.assertEqual(compare.compare_trees(compare.normalize_before(old, problems), new, "x"), [])
        self.assertEqual(problems, [])

    def test_any_other_difference_is_reported(self):
        old, new = self.old_package()
        new = dict(new)
        new["skills/summarize/SKILL.md"] += b"\nmore\n"
        diffs = compare.compare_trees(compare.normalize_before(old, []), new, "x")
        self.assertEqual(diffs, ["x: skills/summarize/SKILL.md differs"])


if __name__ == "__main__":
    unittest.main()
