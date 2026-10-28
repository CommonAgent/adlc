#!/usr/bin/env python3
"""The standing-asset rules (the audit checklist's can-use-known-schema,
can-use-without and person-facing-declares-library).

What is worth pinning: a can_use entry naming a schema off the list in
standards/standing-asset-schemas.json, or one without `without`, refuses a
new agent and warns for an existing one, the format rules' cut-over; an entry
that says both builds, and the descriptor carries `without`; a new agent that
hands a person Markdown, a page, a picture, a film or a sound and declares no
can_use is warned and still built, unless its architecture record says why
none apply; an existing one is not warned; the result carries standing_rules;
and the list is read only at the version build.py pins.

Run: AGENTMESH_ENV=example python3 -m unittest test_standing
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build.py")
STANDARDS = os.path.join(HERE, "..", "..", "standards", "standing-asset-schemas.json")
sys.path.insert(0, HERE)
from test_folder import spec as folder_spec  # noqa: E402

BRAND = "https://schemas.agentmesh.ai/brand/v1"
STYLE = "https://schemas.agentmesh.ai/style-guide/v1"


def announcement_spec(can_use=None, kind="text/markdown", name="announcement-writer"):
    s = folder_spec()
    s["name"] = name
    s["jobs"][0]["outputs"] = [{"name": "announcement", "kind": kind, "when": "per_task"}]
    if can_use is not None:
        s["can_use"] = can_use
    return s


GOOD = [
    {"schema": BRAND, "reads": ["name", "words.never_say"], "required": False,
     "does": "writes the organization's name as the brand writes it", "without": "writes the name as the person gave it, and says so"},
    {"schema": STYLE, "reads": ["voice", "words.avoid"], "required": False,
     "does": "writes in the organization's voice", "without": "writes in a plain, neutral voice, and says so"},
]


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="standing-test-")
        self.src = os.path.join(self.tmp, "agent")
        os.makedirs(os.path.join(self.src, "scripts"))
        os.makedirs(os.path.join(self.src, "notes"))
        for rel, text in (("scripts/read.mjs", "// reads\n"), ("scripts/shared.mjs", "// shared\n"),
                          ("scripts/package-lock.json", "{}\n"), ("notes/style.md", "# Style\n")):
            with open(os.path.join(self.src, rel), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, s, env=None, out="out"):
        path = os.path.join(self.src, "spec.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=2)
        e = {**os.environ, "AGENTMESH_ENV": "example", **(env or {})}
        e.pop("FORMAT_EXISTING", None) if "FORMAT_EXISTING" not in (env or {}) else None
        p = subprocess.run([sys.executable, BUILD, path, os.path.join(self.tmp, out)], capture_output=True, text=True,
                           encoding="utf-8", env=e)
        return json.loads(p.stdout.strip().splitlines()[-1]), p.stderr


class TheStandingAssetRules(Harness):
    def test_entries_of_known_kinds_that_say_without_build_and_the_descriptor_carries_without(self):
        res, _ = self.build(announcement_spec(GOOD))
        self.assertTrue(res["ok"], res)
        rules = res["standing_rules"]
        self.assertEqual(rules["findings"], [])
        self.assertEqual(rules["warnings"], [])
        self.assertEqual(rules["mode"], "refuse")
        self.assertFalse(rules["existing"])
        self.assertEqual(rules["since"], "2026-10-28")
        self.assertTrue(rules["schemas_digest"].startswith("sha256:"))
        with open(os.path.join(res["path"], "agent-descriptor.json"), encoding="utf-8") as f:
            desc = json.load(f)
        self.assertEqual([e["without"] for e in desc["can_use"]], [g["without"] for g in GOOD])

    def test_a_new_agent_with_an_entry_that_does_not_say_without_is_refused(self):
        bad = [dict(GOOD[0]), GOOD[1]]
        del bad[0]["without"]
        res, _ = self.build(announcement_spec(bad))
        self.assertFalse(res["ok"], res)
        self.assertIn("refused on its standing assets", res["error"])
        self.assertIn(f"can_use {BRAND} does not say without", res["error"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "announcement-writer")))

    def test_a_new_agent_with_a_schema_off_the_list_is_refused(self):
        bad = [GOOD[0], {**GOOD[1], "schema": "https://schemas.example/house-voice/v1"}]
        res, _ = self.build(announcement_spec(bad))
        self.assertFalse(res["ok"], res)
        self.assertIn("https://schemas.example/house-voice/v1, which is not a known kind of standing asset", res["error"])

    def test_an_existing_agent_is_warned_and_built(self):
        bad = [{k: v for k, v in GOOD[0].items() if k != "without"}, {**GOOD[1], "schema": "https://schemas.example/house-voice/v1"}]
        res, err = self.build(announcement_spec(bad), env={"FORMAT_EXISTING": "1"})
        self.assertTrue(res["ok"], res)
        rules = res["standing_rules"]
        self.assertTrue(rules["existing"])
        self.assertEqual(rules["mode"], "warn")
        self.assertEqual(len(rules["findings"]), 2)
        self.assertIn("standing assets:", err)
        self.assertTrue(any("does not say without" in w for w in res["warnings"]))

    def test_a_listed_existing_name_is_warned_too(self):
        bad = [{k: v for k, v in GOOD[0].items() if k != "without"}]
        res, _ = self.build(announcement_spec(bad, name="quiz-maker"))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["standing_rules"]["mode"], "warn")


class APersonFacingOutputWithNoLibrary(Harness):
    def test_a_new_agent_handing_a_person_markdown_with_no_can_use_is_warned_and_built(self):
        res, err = self.build(announcement_spec())
        self.assertTrue(res["ok"], res)
        w = res["standing_rules"]["warnings"]
        self.assertEqual(len(w), 1)
        self.assertIn("hands a person 'announcement' (text/markdown) and declares no can_use", w[0])
        self.assertIn("declares no can_use", err)

    def test_each_person_facing_kind_is_warned(self):
        for kind in ("text/html", "image/png", "video/mp4", "audio/mpeg"):
            res, _ = self.build(announcement_spec(kind=kind), out=kind.replace("/", "-"))
            self.assertTrue(res["ok"], res)
            self.assertEqual(len(res["standing_rules"]["warnings"]), 1, kind)

    def test_output_that_only_code_reads_is_not_warned(self):
        res, _ = self.build(announcement_spec(kind="application/vnd.agentmesh.points+json"))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["standing_rules"]["warnings"], [])

    def test_an_existing_agent_is_not_warned(self):
        res, _ = self.build(announcement_spec(), env={"FORMAT_EXISTING": "1"})
        self.assertEqual(res["standing_rules"]["warnings"], [])

    def test_an_architecture_record_that_says_why_none_apply_answers_the_warning(self):
        record = os.path.join(self.tmp, "architecture-record.md")
        with open(record, "w", encoding="utf-8", newline="\n") as f:
            f.write("---\nrecord: architecture-record-v1\nstanding_assets: none\n---\n\n# Architecture record: x\n\n"
                    "## Standing assets\n\n- **announcement** (`text/markdown`): none.\n"
                    "- None, because the person said none apply, because it is an internal note.\n\n## Settings\n\nNone.\n")
        res, _ = self.build(announcement_spec(), env={"ARCHITECTURE_RECORD": record})
        self.assertEqual(res["standing_rules"]["warnings"], [])
        self.assertEqual(res["standing_rules"]["none_because"], "the person said none apply, because it is an internal note")

    def test_a_record_that_decides_assets_does_not_excuse_a_draft_that_declares_none(self):
        record = os.path.join(self.tmp, "architecture-record.md")
        with open(record, "w", encoding="utf-8", newline="\n") as f:
            f.write(f"---\nrecord: architecture-record-v1\nstanding_assets: [{BRAND}, {STYLE}]\n---\n\n## Standing assets\n\n- x\n")
        res, _ = self.build(announcement_spec(), env={"ARCHITECTURE_RECORD": record})
        self.assertEqual(len(res["standing_rules"]["warnings"]), 1)


class TheListIsPinned(unittest.TestCase):
    def test_the_pin_is_the_list_in_standards(self):
        import importlib.util
        sp = importlib.util.spec_from_file_location("build_mod", BUILD)
        mod = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(mod)
        with open(STANDARDS, "rb") as f:
            have = "sha256:" + hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(mod.STANDING_SCHEMAS_PIN, have,
                         "standards/standing-asset-schemas.json changed: re-pin STANDING_SCHEMAS_PIN in build.py, run the tests, and release")

    def test_a_list_that_is_not_the_pinned_version_is_refused(self):
        tmp = tempfile.mkdtemp(prefix="standing-pin-")
        try:
            shutil.copy(BUILD, os.path.join(tmp, "build.py"))
            for f in ("system-names.json", "plugin-1.0.0.schema.json"):
                if os.path.exists(os.path.join(HERE, f)):
                    shutil.copy(os.path.join(HERE, f), os.path.join(tmp, f))
            with open(STANDARDS, encoding="utf-8") as f:
                doc = json.load(f)
            doc["schemas"].append({"schema": "https://schemas.example/x/v1", "kind": "x", "for": "x", "published": None})
            with open(os.path.join(tmp, "agentbuilder-standing-asset-schemas.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f)
            src = os.path.join(tmp, "spec.json")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(announcement_spec(GOOD), f)
            p = subprocess.run([sys.executable, os.path.join(tmp, "build.py"), src, os.path.join(tmp, "out")],
                               capture_output=True, text=True, encoding="utf-8", env={**os.environ, "AGENTMESH_ENV": "example"})
            res = json.loads(p.stdout.strip().splitlines()[-1])
            self.assertFalse(res["ok"], res)
            self.assertIn("not the version this builder pins", res["error"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
