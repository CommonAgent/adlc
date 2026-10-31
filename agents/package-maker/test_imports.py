#!/usr/bin/env python3
"""What a package's scripts import goes into the package with them.

vowel-roll 0.1.0 (technical debt 655) was built from a spec that named one
script, scripts/count-vowels.mjs, which imports ./went-without.mjs. The code
writer delivered both, Build an agent sent both to the package maker, the
tests passed in the sandbox where the two sat side by side, and the package
carried only count-vowels.mjs: the lay-out left went-without.mjs over, the
build copied only what the spec named, and every job on the fleet stopped on
ERR_MODULE_NOT_FOUND after install.

What is worth pinning: a file a named script imports by a relative path is
packed at the path the import names, followed transitively, and the packed
script runs; a static import of a file that is not there refuses the package
in words naming the script and the file, with nothing left behind; an import
shown in a comment or a prompt's template literal is not an import; a dynamic
import of an absent file is not required; the lay-out places a delivered
file a named script imports, from a spec or from the agent's own files; and
every agent in this repository still builds.

Run: AGENTMESH_ENV=example python3 -m unittest test_imports
"""
import copy
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
AGENTS = os.path.dirname(HERE)


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build_mod = load("build_under_test", "build.py")

SPEC = {
    "name": "vowel-roll", "version": "0.1.0", "description": "Counts the vowels in a sentence.",
    "jobs": [{"slug": "count-vowels", "title": "Count vowels", "offered": True,
              "when": "when somebody sends a sentence", "good": "the counts", "empty": "say so",
              "scripts": ["scripts/count-vowels.mjs"],
              "how": {"control": "script", "intelligence": "none", "cost": "none", "contract": "full"},
              "run": {"command": ["node", "{package}/skills/count-vowels/scripts/count-vowels.mjs", "{job_dir}"]}}],
    "refuses": ["Altering the sentence"],
    "records": ["the counts"],
    "runtimes": [{"name": "node", "version": ">=22"}],
}

COUNT = """// Counts the vowels and notes what it went without.
import { readFileSync } from "node:fs";
import { note } from "./went-without.mjs";

export const count = (s) => (String(s).match(/[aeiou]/gi) || []).length;
console.log(JSON.stringify({ total: count("an apple"), went_without: note("nothing") }));
"""
WENT_WITHOUT = """// The shared went-without.mjs, as every package carries it.
export const note = (what) => `went without ${what}`;
"""


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path


def tree(root):
    return sorted(os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/")
                  for d, _, ns in os.walk(root) for n in ns)


class ReadingImports(unittest.TestCase):
    """What build.py reads as a script's relative imports."""

    def imports(self, text):
        return build_mod.relative_imports(text)

    def test_static_imports_exports_and_requires_are_required(self):
        text = ('import a from "./a.mjs";\nimport {\n  b,\n  c,\n} from "./b.mjs";\nexport { d } from \'./d.mjs\';\n'
                'import "./side.mjs";\nconst e = require("../lib/e.js");\n')
        self.assertEqual(self.imports(text), [("./a.mjs", True), ("./b.mjs", True), ("./d.mjs", True),
                                              ("./side.mjs", True), ("../lib/e.js", True)])

    def test_packages_and_builtins_are_not_files_in_the_package(self):
        self.assertEqual(self.imports('import fs from "node:fs";\nimport yaml from "yaml";\nconst x = require("path");\n'), [])

    def test_a_dynamic_import_is_followed_and_not_required(self):
        self.assertEqual(self.imports('const archive = await import("./archive.mjs").catch(() => null);\n'),
                         [("./archive.mjs", False)])

    def test_an_import_in_a_comment_is_not_an_import(self):
        text = '// import old from "./old.mjs";\n/*\nimport older from "./older.mjs";\n*/\n *  Reads `import { a } from "../scripts/x.mjs"`\n'
        self.assertEqual(self.imports(text), [])

    def test_an_import_shown_in_a_prompt_s_template_literal_is_words(self):
        # The test writer's prompt shows two such lines (write-suite.mjs).
        text = ('const PROMPT = `Write the suite.\nimport { checkDelivered } from "./delivered-formats.test.mjs"\n'
                'and assert ${"it"} passes.`;\nimport { real } from "./real.mjs";\n')
        self.assertEqual(self.imports(text), [("./real.mjs", True)])

    def test_a_regular_expression_with_quotes_does_not_hide_what_follows(self):
        text = 'const q = /["\'`]/g;\nconst half = total / 2;\nimport { next } from "./next.mjs";\n'
        self.assertEqual(self.imports(text), [("./next.mjs", True)])


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="imports-test-")
        self.src = os.path.join(self.tmp, "src")
        os.makedirs(self.src)
        self.out = os.path.join(self.tmp, "out")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def spec(self, **job):
        s = copy.deepcopy(SPEC)
        s["jobs"][0].update(job)
        write(self.src, "spec.json", json.dumps(s, indent=2))
        return s

    def build(self, src=None, env=None):
        p = subprocess.run([sys.executable, BUILD, src or os.path.join(self.src, "spec.json"), self.out],
                           capture_output=True, text=True, encoding="utf-8",
                           env={**os.environ, **(env or {})})
        return json.loads(p.stdout.strip().splitlines()[-1])

    def skill(self, *rel):
        return os.path.join(self.out, "vowel-roll", "skills", "count-vowels", *rel)


class Building(Harness):
    def test_a_helper_a_named_script_imports_is_packed_beside_it_and_runs(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", COUNT)
        write(self.src, "scripts/went-without.mjs", WENT_WITHOUT)
        res = self.build()
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["count-vowels.mjs", "went-without.mjs"])
        with open(self.skill("scripts", "went-without.mjs"), encoding="utf-8") as f:
            self.assertEqual(f.read(), WENT_WITHOUT)
        with open(self.skill("SKILL.md"), encoding="utf-8") as f:
            self.assertIn("- scripts/went-without.mjs", f.read())
        # The packed script runs from the package, where it stopped on
        # ERR_MODULE_NOT_FOUND before.
        run = subprocess.run(["node", self.skill("scripts", "count-vowels.mjs")], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), {"total": 3, "went_without": "went without nothing"})

    def test_imports_are_followed_transitively(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", 'import { a } from "./a.mjs";\nconsole.log(a);\n')
        write(self.src, "scripts/a.mjs", 'import { b } from "./lib/b.mjs";\nexport const a = b;\n')
        write(self.src, "scripts/lib/b.mjs", 'import { c } from "../c.mjs";\nexport const b = c;\n')
        write(self.src, "scripts/c.mjs", 'export const c = "c";\n')
        res = self.build()
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["a.mjs", "c.mjs", "count-vowels.mjs", "lib/b.mjs"])
        run = subprocess.run(["node", self.skill("scripts", "count-vowels.mjs")], capture_output=True, text=True)
        self.assertEqual((run.returncode, run.stdout.strip()), (0, "c"), run.stderr)

    def test_an_import_that_is_not_there_refuses_the_package_naming_it(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", COUNT)
        res = self.build()
        self.assertFalse(res["ok"], res)
        self.assertIn("job count-vowels: scripts/count-vowels.mjs imports ./went-without.mjs, which is not among "
                      "the files the package is built from", res["error"])
        self.assertIn("Deliver the file with the scripts, or name it under the job's scripts", res["error"])
        self.assertFalse(os.path.exists(os.path.join(self.out, "vowel-roll")))

    def test_a_missing_import_two_steps_down_is_named_where_it_is_imported(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", 'import { a } from "./a.mjs";\n')
        write(self.src, "scripts/a.mjs", 'export { b } from "./b.mjs";\n')
        res = self.build()
        self.assertFalse(res["ok"], res)
        self.assertIn("scripts/a.mjs imports ./b.mjs", res["error"])

    def test_an_import_that_would_climb_out_of_the_skill_is_refused(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", 'import { x } from "../../shared/x.mjs";\n')
        write(self.src, "../shared/x.mjs", "export const x = 1;\n")
        res = self.build()
        self.assertFalse(res["ok"], res)
        self.assertIn("scripts/count-vowels.mjs imports ../../shared/x.mjs, which would sit outside the skill's folder", res["error"])

    def test_a_dynamic_import_is_packed_when_there_and_not_required_when_not(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs",
              'const a = await import("./archive.mjs").catch(() => null);\nconst t = await import("./tar.mjs").catch(() => null);\n')
        write(self.src, "scripts/tar.mjs", "export const tar = 1;\n")
        res = self.build()
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["count-vowels.mjs", "tar.mjs"])

    def test_an_import_already_named_is_copied_once(self):
        self.spec(scripts=["scripts/count-vowels.mjs", "scripts/went-without.mjs"])
        write(self.src, "scripts/count-vowels.mjs", COUNT)
        write(self.src, "scripts/went-without.mjs", WENT_WITHOUT)
        res = self.build()
        self.assertTrue(res["ok"], res)
        with open(self.skill("SKILL.md"), encoding="utf-8") as f:
            self.assertEqual(f.read().count("- scripts/went-without.mjs"), 1)

    def test_a_script_named_from_a_subfolder_imports_from_where_it_sits_in_the_package(self):
        self.spec(scripts=["scripts/lib/count-vowels.mjs"],
                  run={"command": ["node", "{package}/skills/count-vowels/scripts/count-vowels.mjs", "{job_dir}"]})
        write(self.src, "scripts/lib/count-vowels.mjs", COUNT)
        write(self.src, "scripts/lib/went-without.mjs", WENT_WITHOUT)
        res = self.build()
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["count-vowels.mjs", "went-without.mjs"])

    def test_the_agent_s_own_folder_packs_its_imports_too(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", COUNT)
        write(self.src, "scripts/went-without.mjs", WENT_WITHOUT)
        p = subprocess.run([sys.executable, CONVERT, os.path.join(self.src, "spec.json")], capture_output=True, text=True)
        self.assertTrue(json.loads(p.stdout.strip().splitlines()[-1])["ok"], p.stdout)
        os.remove(os.path.join(self.src, "spec.json"))
        res = self.build(self.src)
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["count-vowels.mjs", "went-without.mjs"])


class LayingOut(Harness):
    """pack.py lays out the files a run handed over before it builds."""

    def setUp(self):
        super().setUp()
        self.pack = load("pack_under_test", "pack.py")
        self.pack.HOME = os.path.join(self.tmp, "home")
        self.sent = os.path.join(self.tmp, "sent")
        os.makedirs(self.sent)

    def send(self, name, text):
        # The adapter's inbound prefix, once per hop.
        return write(self.sent, f"1-ab12cd34-2-ef56gh78-{name}", text)

    def test_a_delivered_file_a_named_script_imports_is_laid_out_beside_it(self):
        spec_path = write(self.src, "spec.json", json.dumps(SPEC))
        files = [self.send("count-vowels.mjs", 'import { a } from "./a.mjs";\nimport { note } from "./went-without.mjs";\n'),
                 self.send("went-without.mjs", WENT_WITHOUT),
                 self.send("a.mjs", 'export { b as a } from "./b.mjs";\n'),
                 self.send("b.mjs", "export const b = 1;\n"),
                 self.send("notes.txt", "not imported\n")]
        new_spec, laid = self.pack.lay_out(spec_path, files)
        root = os.path.dirname(new_spec)
        self.assertEqual(laid["placed"], ["scripts/count-vowels.mjs"])
        self.assertEqual(laid["imported"], ["scripts/a.mjs", "scripts/b.mjs", "scripts/went-without.mjs"])
        self.assertEqual(laid["left_over"], ["notes.txt"])
        self.assertEqual(laid["missing"], [])
        res = self.build(new_spec)
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["a.mjs", "b.mjs", "count-vowels.mjs", "went-without.mjs"])
        self.assertTrue(os.path.isfile(os.path.join(root, "scripts", "went-without.mjs")))

    def test_the_agent_s_own_files_lay_out_the_imports_too(self):
        self.spec()
        write(self.src, "scripts/count-vowels.mjs", COUNT)
        write(self.src, "scripts/went-without.mjs", WENT_WITHOUT)
        p = subprocess.run([sys.executable, CONVERT, os.path.join(self.src, "spec.json")], capture_output=True, text=True)
        self.assertTrue(json.loads(p.stdout.strip().splitlines()[-1])["ok"], p.stdout)
        files = []
        for rel in ("plugin.json", "agent-descriptor.json", "agent-runtime-requirements.json",
                    "skills/count-vowels/SKILL.md", "scripts/count-vowels.mjs"):
            with open(os.path.join(self.src, *rel.split("/")), encoding="utf-8") as f:
                files.append(self.send(os.path.basename(rel), f.read()))
        files.append(self.send("went-without.mjs", WENT_WITHOUT))
        found = self.pack.agent_files_among(files)
        self.assertIsNotNone(found)
        root, laid = self.pack.lay_out_folder(found, files)
        self.assertEqual(laid["imported"], ["scripts/went-without.mjs"])
        self.assertNotIn("went-without.mjs", laid["left_over"])
        res = self.build(root)
        self.assertTrue(res["ok"], res)
        self.assertEqual(tree(self.skill("scripts")), ["count-vowels.mjs", "went-without.mjs"])


class EveryAgentHere(unittest.TestCase):
    def test_every_agent_in_this_repository_builds_with_what_its_scripts_import(self):
        out = tempfile.mkdtemp(prefix="imports-agents-")
        try:
            for name in sorted(os.listdir(AGENTS)):
                folder = os.path.join(AGENTS, name)
                if name == "package-maker" or not os.path.isfile(os.path.join(folder, "plugin.json")):
                    continue
                with self.subTest(agent=name):
                    p = subprocess.run([sys.executable, BUILD, folder, out], capture_output=True, text=True, encoding="utf-8")
                    res = json.loads(p.stdout.strip().splitlines()[-1])
                    self.assertTrue(res["ok"], res.get("error"))
        finally:
            shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
