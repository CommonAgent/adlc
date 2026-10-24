#!/usr/bin/env python3
"""Nothing is packed that no base image could carry, and a check that did not run says so.

invoice-reader, contract-reviewer and site-auditor were built, packed, signed
and handed on carrying no install file at all, and the first thing that looked
was the image emitter, a week later. So the pack asks the resolver which base
the package's declared runtimes and binaries resolve to, before the tar: a base
reaches the printed output and the build record, a package nothing can carry is
refused and no tarball is written, and a host with no resolver or no catalogue
writes down that nobody looked rather than passing quietly.

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
PACK = os.path.join(HERE, "pack.py")
BUILD = os.path.join(HERE, "build.py")
SCHEMA = os.path.join(HERE, "plugin-1.0.0.schema.json")
RESOLVER = os.path.join(HERE, os.pardir, "image", "emit-image.mjs")
CATALOGUE = os.path.join(HERE, os.pardir, "image", "bases", "catalogue.json")

SPEC = {
    "name": "packable", "version": "1.0.0", "description": "Does one thing.",
    "jobs": [{"slug": "do-it", "title": "Do it", "offered": True,
              "when": "when asked", "good": "done", "empty": "say so"}],
    "refuses": ["inventing a result"],
    "records": ["the draft as delivered"],
}
# A binary no base in the catalogue has, with the purpose the refusal is meant
# to carry back to whoever asked for the agent.
NOWHERE = [{"name": "postgres", "purpose": "reads the ledger straight out of the database"}]


def spec(**over):
    return dict(copy.deepcopy(SPEC), **over)


def catalogue_images():
    # The catalogue names its registry as {gcp.registry}, filled by the
    # resolver from the environment file; the images it answers are filled.
    env = os.path.join(os.environ.get("AGENTMESH_ENV_DIR") or os.path.join(HERE, os.pardir, os.pardir, "env"),
                       (os.environ.get("AGENTMESH_ENV") or "prod") + ".json")
    with open(env, encoding="utf-8") as f:
        registry = json.load(f)["gcp"]["registry"]
    with open(CATALOGUE, encoding="utf-8") as f:
        return [b["image"].replace("{gcp.registry}", registry) for b in json.load(f)["bases"]]


class Harness(unittest.TestCase):
    """Run the pack procedure against a home of its own.

    pack.py takes a spec from ~/tmp and writes into ~/built, ~/dist and
    ~/records, so the home is the whole of its world and a temporary one is how
    a test gets to have that world to itself.
    """

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="pack-test-")
        os.makedirs(os.path.join(self.home, "tmp"))

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def pack(self, doc, pack_py=PACK, extra=()):
        spec_path = os.path.join(self.home, "tmp", "spec.json")
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        # No identity file: the signer is unavailable and the record says so,
        # which is not what any of this is about.
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        p = subprocess.run([sys.executable, pack_py, spec_path,
                            os.path.join(self.home, "identity.json"), *extra],
                           capture_output=True, text=True, env=env)
        self.assertTrue(p.stdout.strip(), p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1])

    def flat(self, build_py=BUILD, resolver=True, catalogue=True):
        """A copy of the installed layout: everything flat in one directory the
        way /opt/fleet holds it, with the deployment side's two files there or
        deliberately not. Returns the path to run."""
        d = tempfile.mkdtemp(prefix="opt-fleet-", dir=self.home)
        shutil.copy(PACK, os.path.join(d, "agentbuilder-pack.py"))
        shutil.copy(build_py, os.path.join(d, "agentbuilder-build.py"))
        shutil.copy(SCHEMA, os.path.join(d, "agentbuilder-plugin.schema.json"))
        if resolver:
            shutil.copy(RESOLVER, os.path.join(d, "deploymgr-emit-image.mjs"))
        if catalogue:
            os.makedirs(os.path.join(d, "bases"), exist_ok=True)
            shutil.copy(CATALOGUE, os.path.join(d, "bases", "catalogue.json"))
        return os.path.join(d, "agentbuilder-pack.py")

    def record(self, res):
        with open(res["record"], encoding="utf-8") as f:
            return json.load(f)

    def check(self, res, kind):
        checks = self.record(res)["checks"]
        found = [c for c in checks if c["kind"] == kind]
        self.assertEqual(len(found), 1, checks)
        return found[0]

    def dist(self):
        d = os.path.join(self.home, "dist")
        return sorted(os.listdir(d)) if os.path.isdir(d) else []


class APackageABaseCanCarry(Harness):

    def test_the_base_reaches_the_printed_output_and_the_record(self):
        res = self.pack(spec())
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertIn(res["image"]["base"], catalogue_images())
        self.assertEqual(res["image"]["from"], "bases/catalogue.json")
        check = self.check(res, "image")
        self.assertEqual(check["base"], res["image"]["base"])
        self.assertEqual(check["catalogue"], "bases/catalogue.json")
        self.assertEqual(self.dist(), ["packable.tar.gz"])

    def test_the_unrun_grade_is_still_there_beside_it(self):
        res = self.pack(spec())
        self.assertIn("nobody has run the agent", self.check(res, "unrun")["what"])

    def test_the_same_answer_from_the_flat_installed_layout(self):
        """The layout on the fleet host, where the resolver is beside this file
        under another name. A pass here is what says the two absences further
        down are absences and not a path this file spells wrongly."""
        res = self.pack(spec(), pack_py=self.flat())
        self.assertTrue(res["ok"], res)
        self.assertIn(res["image"]["base"], catalogue_images())
        self.assertEqual(self.check(res, "image")["catalogue"], "bases/catalogue.json")


class APackageNoBaseCanCarry(Harness):

    def test_it_is_refused_and_nothing_is_packed(self):
        res = self.pack(spec(binaries=NOWHERE))
        # A refusal is an outcome and not a crash, so ok stays true and the
        # brain reads act, the same as a build refusal.
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "refuse")
        self.assertIsNone(res["record"])
        self.assertEqual(self.dist(), [], "a tarball was written for a package nothing can build")

    def test_the_refusal_names_what_is_missing_what_it_is_for_and_what_to_do(self):
        refused = self.pack(spec(binaries=NOWHERE))["refused"]
        self.assertIn("cannot be turned into a container image", refused)
        self.assertIn("postgres", refused)
        self.assertIn("reads the ledger straight out of the database", refused)
        self.assertIn("Build a base that has what is missing", refused)

    def test_a_package_with_no_install_file_is_refused_too(self):
        """The failure this check exists for, made on purpose: a build that
        emits a package and leaves the runtime requirements out of it. pack.py builds
        and checks in one run, so the only way to hand it one is to stand in
        for build.py with something that takes the file back out."""
        stub = os.path.join(self.home, "build-without-an-install-file.py")
        with open(stub, "w", encoding="utf-8") as f:
            f.write("import json, os, subprocess, sys\n"
                    f"real = {json.dumps(BUILD)}\n"
                    "p = subprocess.run([sys.executable, real] + sys.argv[1:], capture_output=True, text=True)\n"
                    "res = json.loads(p.stdout.strip().splitlines()[-1])\n"
                    "if res.get('ok'):\n"
                    "    os.remove(os.path.join(res['path'], 'agent-runtime-requirements.json'))\n"
                    "print(json.dumps(res))\n")
        res = self.pack(spec(), pack_py=self.flat(build_py=stub))
        self.assertEqual(res["act"], "refuse", res)
        self.assertIn("no runtime requirements", res["refused"])
        self.assertEqual(self.dist(), [])


class AnAgentsOwnFolder(Harness):
    """pack.py takes an agent's folder as well as a spec, and the record names
    the runtime requirements by the name Common Agent 0.30.0-draft gave them."""

    def folder(self):
        spec_path = os.path.join(self.home, "tmp", "packable", "spec.json")
        os.makedirs(os.path.dirname(spec_path))
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(spec(), f)
        p = subprocess.run([sys.executable, os.path.join(HERE, "convert.py"), spec_path], capture_output=True, text=True)
        self.assertTrue(json.loads(p.stdout.strip().splitlines()[-1])["ok"], p.stdout)
        os.remove(spec_path)
        return os.path.dirname(spec_path)

    def run_pack(self, src, *extra):
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        p = subprocess.run([sys.executable, PACK, src, os.path.join(self.home, "identity.json"), *extra],
                           capture_output=True, text=True, env=env)
        return json.loads(p.stdout.strip().splitlines()[-1])

    def test_a_folder_packs_and_the_record_names_the_runtime_requirements(self):
        res = self.run_pack(self.folder())
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertNotIn("warnings", res)
        pkg = self.record(res)["package"]
        self.assertIn("runtime_requirements_sha256", pkg)
        self.assertEqual(pkg["install_sha256"], pkg["runtime_requirements_sha256"], "the old name, for the readers of records from before")
        with open(os.path.join(res["package_dir"], "plugin.json"), encoding="utf-8") as f:
            own = json.load(f)["extensions"]["net.agentdoc.package"]
        self.assertEqual(pkg["runtime_requirements_sha256"], own["runtime_requirements"]["sha256"])

    def test_a_spec_still_packs_and_says_it_is_deprecated(self):
        res = self.pack(spec())
        self.assertTrue(res["ok"], res)
        self.assertTrue(any("deprecated" in w for w in res["warnings"]), res)

    def test_files_are_handed_over_with_a_spec_and_not_a_folder(self):
        folder = self.folder()
        stray = os.path.join(self.home, "tmp", "x.mjs")
        open(stray, "w").close()
        res = self.run_pack(folder, "--from", stray)
        self.assertFalse(res["ok"])
        self.assertIn("already holds the files", res["error"])


class AHostThatCannotLook(Harness):
    """The builder is not bricked by a host missing the deployment side's
    files, and the record never says a check passed when nothing ran it."""

    def test_no_resolver_is_recorded_as_unchecked_and_the_pack_goes_on(self):
        res = self.pack(spec(), pack_py=self.flat(resolver=False, catalogue=False))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertIsNone(res["image"]["base"])
        self.assertIn("resolver is not on this host", res["image"]["unchecked"])
        self.assertIn("Nothing checked whether it can be built into a container image", res["note"])
        self.assertIn("resolver is not on this host", self.check(res, "image-unchecked")["what"])
        self.assertEqual(self.dist(), ["packable.tar.gz"])

    def test_a_resolver_with_no_catalogue_beside_it_is_unchecked_too(self):
        res = self.pack(spec(), pack_py=self.flat(catalogue=False))
        self.assertTrue(res["ok"], res)
        self.assertIn("base catalogue is not on this host", res["image"]["unchecked"])
        self.assertIn("base catalogue is not on this host", self.check(res, "image-unchecked")["what"])

    def test_a_catalogue_the_resolver_will_not_read_is_unchecked_and_not_a_refusal(self):
        """An operator's file being wrong on this host is not a package being
        wrong, and refusing to pack for it would stop the builder over
        something nobody asking for an agent can fix."""
        pack_py = self.flat()
        with open(os.path.join(os.path.dirname(pack_py), "bases", "catalogue.json"), "w", encoding="utf-8") as f:
            json.dump({"format": "something-else", "bases": []}, f)
        res = self.pack(spec(), pack_py=pack_py)
        self.assertEqual(res["act"], "build", res)
        self.assertIn("not one the resolver reads", res["image"]["unchecked"])
        self.assertIn("not one the resolver reads", self.check(res, "image-unchecked")["what"])

    def test_an_unchecked_package_is_not_recorded_as_one_that_resolved(self):
        res = self.pack(spec(), pack_py=self.flat(resolver=False, catalogue=False))
        kinds = [c["kind"] for c in self.record(res)["checks"]]
        self.assertNotIn("image", kinds, "a pack that looked at nothing recorded a base")


if __name__ == "__main__":
    unittest.main()


class APackageBuiltFromWhatARunHandedOver(Harness):
    """In the lifecycle the package maker takes the spec and the files the
    code-writer delivered, as attachments with the adapter's inbound prefix on
    each name, and the reply carries the package as a piece."""

    def with_scripts(self):
        doc = spec()
        doc["jobs"][0]["scripts"] = ["scripts/do.mjs", "scripts/pieces.mjs"]
        doc["jobs"][0]["references"] = ["references/how.md"]
        return doc

    def attached(self, names):
        d = os.path.join(self.home, "in")
        os.makedirs(d, exist_ok=True)
        paths = []
        for n, name in enumerate(names):
            p = os.path.join(d, f"{n}-Ab12cdEF-{name}")
            with open(p, "w", encoding="utf-8") as f:
                f.write(f"// {name}\n")
            paths.append(p)
        return paths

    def pack_from(self, doc, files, job=None):
        spec_path = os.path.join(self.home, "in", "0-Zz98yxWV-spec.json")
        os.makedirs(os.path.dirname(spec_path), exist_ok=True)
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        argv = [sys.executable, PACK, spec_path, os.path.join(self.home, "identity.json"), "--from", *files]
        if job:
            argv += ["--job", job]
        p = subprocess.run(argv, capture_output=True, text=True, env=env)
        self.assertTrue(p.stdout.strip(), p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1])

    def test_the_files_are_laid_out_where_the_spec_names_them_and_the_package_carries_them(self):
        files = self.attached(["do.mjs", "pieces.mjs", "how.md", "job-manifest.json", "stray.txt"])
        res = self.pack_from(self.with_scripts(), files)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertEqual(res["laid_out"]["placed"], ["references/how.md", "scripts/do.mjs", "scripts/pieces.mjs"])
        self.assertEqual(res["laid_out"]["left_over"], ["stray.txt"])
        self.assertTrue(res["laid_out"]["manifest"].endswith("job-manifest.json"))
        self.assertTrue(os.path.exists(os.path.join(res["package_dir"], "skills", "do-it", "scripts", "do.mjs")))
        self.assertTrue(os.path.exists(os.path.join(res["package_dir"], "skills", "do-it", "references", "how.md")))

    def test_a_host_agents_download_prefix_with_no_counter_is_taken_off_too(self):
        # The adapter names a host agent's downloads <8 chars>-<name>, without
        # the counter a container's mount shows.
        d = os.path.join(self.home, "in")
        os.makedirs(d, exist_ok=True)
        paths = []
        for name in ["do.mjs", "pieces.mjs", "how.md", "job-manifest.json"]:
            p = os.path.join(d, f"fTdg6yEQ-{name}")
            with open(p, "w", encoding="utf-8") as f:
                f.write(f"// {name}\n")
            paths.append(p)
        res = self.pack_from(self.with_scripts(), paths)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertEqual(res["laid_out"]["placed"], ["references/how.md", "scripts/do.mjs", "scripts/pieces.mjs"])

    def test_the_whole_folder_of_handed_over_files_can_be_named_at_once(self):
        # The brain passes one path, the job folder's in/, rather than every
        # file; the spec sitting in the same folder is read as the spec and
        # not laid out as a file the spec names.
        self.attached(["do.mjs", "pieces.mjs", "how.md", "job-manifest.json"])
        spec_path = os.path.join(self.home, "in", "0-Zz98yxWV-spec.json")
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(self.with_scripts(), f)
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        argv = [sys.executable, PACK, spec_path, os.path.join(self.home, "identity.json"), "--from-dir", os.path.join(self.home, "in")]
        p = subprocess.run(argv, capture_output=True, text=True, env=env)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertEqual(res["laid_out"]["placed"], ["references/how.md", "scripts/do.mjs", "scripts/pieces.mjs"])
        self.assertEqual(res["laid_out"]["left_over"], [])

    def test_the_framed_prompt_of_a_runs_work_is_built_without_a_model(self):
        # The brain hands the prompt to --run first: the spec is found among
        # the attached files by content, the rest are handed over, the job
        # folder takes the pieces, and the reply is one plain sentence. A
        # prompt with no spec among its files exits 3 so the model can take it.
        files = self.attached(["do.mjs", "pieces.mjs", "how.md", "job-manifest.json"])
        spec_path = os.path.join(self.home, "in", "0-Zz98yxWV-spec.json")
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(self.with_scripts(), f)
        job = os.path.join(self.home, "job")
        os.makedirs(job, exist_ok=True)
        listed = "\n".join(f"           {p}  (application/octet-stream)" for p in [spec_path, *files])
        prompt = (f"run r-1 phase make-the-package: here is work\njob folder: {job}  (put every delivered piece under {job}/out/)\n"
                  f"attached:  {len(files) + 1} files, already downloaded to this machine:\n{listed}\n\nwanted: the package\n")
        prompt_path = os.path.join(self.home, "prompt.txt")
        with open(prompt_path, "w", encoding="utf-8") as f:
            f.write(prompt)
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        p = subprocess.run([sys.executable, PACK, "--run", prompt_path, os.path.join(self.home, "identity.json")], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Built packable 1.0.0: sha256 ", p.stdout)
        self.assertTrue(os.path.exists(os.path.join(job, "pieces.json")), "the pieces are filed under the job folder")
        # No spec among the files: not this procedure's turn.
        with open(prompt_path, "w", encoding="utf-8") as f:
            f.write(f"job folder: {job}\nattached:  1 file, already downloaded to this machine:\n           {files[0]}  (text/plain)\n\nBuild me an agent.\n")
        p = subprocess.run([sys.executable, PACK, "--run", prompt_path, os.path.join(self.home, "identity.json")], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 3)

    def test_a_file_passed_on_through_two_hops_still_matches_by_its_sent_name(self):
        # The process runner passes a phase's files to the next phase, and each
        # hop's adapter puts its own prefix on: <n>-<8 chars>-<n>-<8 chars>-name.
        d = os.path.join(self.home, "in")
        os.makedirs(d, exist_ok=True)
        files = []
        for n, name in enumerate(["do.mjs", "pieces.mjs", "how.md"]):
            p = os.path.join(d, f"{n}-Qq77wwEE-{n}-Ab12cdEF-{name}")
            with open(p, "w", encoding="utf-8") as f:
                f.write(f"// {name}\n")
            files.append(p)
        res = self.pack_from(self.with_scripts(), files)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertEqual(res["laid_out"]["placed"], ["references/how.md", "scripts/do.mjs", "scripts/pieces.mjs"])

    def test_a_script_the_run_did_not_hand_over_is_refused_by_name(self):
        files = self.attached(["do.mjs", "how.md"])
        res = self.pack_from(self.with_scripts(), files)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "refuse")
        self.assertIn("scripts/pieces.mjs", res["refused"])
        self.assertEqual(self.dist(), [], "nothing was packed")

    def test_the_package_and_its_record_are_filed_as_pieces_under_the_job_folder(self):
        job = os.path.join(self.home, "job")
        os.makedirs(job)
        files = self.attached(["do.mjs", "pieces.mjs", "how.md"])
        res = self.pack_from(self.with_scripts(), files, job=job)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["pieces"], ["out/packable-1.0.0.tar.gz", "out/packable-build.json"])
        with open(os.path.join(job, "pieces.json"), encoding="utf-8") as f:
            listed = json.load(f)
        self.assertEqual([e["name"] for e in listed], ["package", "build record"])
        for e in listed:
            self.assertTrue(os.path.exists(os.path.join(job, e["path"])), e["path"])
        self.assertIn(res["sha256"], listed[0]["about"])



class TheAgentsOwnFilesARunHandedOver(APackageBuiltFromWhatARunHandedOver):
    """Since spec writer 0.3.0 a run's work arrives as the agent's own files
    (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and a
    SKILL.md per skill) rather than a spec. They are found among the
    attachments by content, under whatever names the hops gave them, laid out
    as the agent's folder with the scripts beside them, and the folder is
    built, with no word about a spec."""

    def agent_files(self, doc):
        """The files convert.py writes from a spec, as attachments named the
        way the spec writer's pieces arrive: a prefix per hop, and each
        SKILL.md under its skill's name."""
        src = os.path.join(self.home, "conv", "spec.json")
        os.makedirs(os.path.dirname(src))
        with open(src, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        for j in doc["jobs"]:
            for kind in ("scripts", "references"):
                for rel in j.get(kind) or []:
                    os.makedirs(os.path.dirname(os.path.join(self.home, "conv", rel)), exist_ok=True)
                    open(os.path.join(self.home, "conv", rel), "w").close()
        folder = os.path.join(self.home, "conv", "agent")
        p = subprocess.run([sys.executable, os.path.join(HERE, "convert.py"), src, folder], capture_output=True, text=True)
        self.assertTrue(json.loads(p.stdout.strip().splitlines()[-1])["ok"], p.stdout)
        d = os.path.join(self.home, "in")
        os.makedirs(d, exist_ok=True)
        out = []
        names = [("agent-descriptor.json", "agent-descriptor.json"), ("agent-runtime-requirements.json", "agent-runtime-requirements.json"),
                 ("plugin.json", "plugin.json")] + [(f"skills/{j['slug']}/SKILL.md", f"{j['slug']}.SKILL.md") for j in doc["jobs"]]
        for n, (rel, sent) in enumerate(names):
            at = os.path.join(d, f"{n + 10}-Qq77wwEE-{n}-Ab12cdEF-{sent}")
            shutil.copy(os.path.join(folder, rel), at)
            out.append(at)
        return out

    def run_prompt(self, files, job):
        listed = "\n".join(f"           {p}  (application/octet-stream)" for p in files)
        prompt = (f"run r-1 phase make-the-package: here is work\njob folder: {job}  (put every delivered piece under {job}/out/)\n"
                  f"attached:  {len(files)} files, already downloaded to this machine:\n{listed}\n\nwanted: the package\n")
        prompt_path = os.path.join(self.home, "prompt.txt")
        with open(prompt_path, "w", encoding="utf-8") as f:
            f.write(prompt)
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        return subprocess.run([sys.executable, PACK, "--run", prompt_path, os.path.join(self.home, "identity.json")],
                              capture_output=True, text=True, env=env)

    def test_the_agents_files_and_scripts_are_laid_out_as_its_folder_and_built(self):
        files = self.agent_files(self.with_scripts()) + self.attached(["do.mjs", "pieces.mjs", "how.md", "job-manifest.json", "stray.txt"])
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        p = subprocess.run([sys.executable, PACK, files[0], os.path.join(self.home, "identity.json"), "--from", *files[1:]],
                           capture_output=True, text=True, env=env)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["act"], "build")
        self.assertEqual(res["laid_out"]["placed"], ["references/how.md", "scripts/do.mjs", "scripts/pieces.mjs"])
        self.assertEqual(res["laid_out"]["left_over"], ["stray.txt"])
        self.assertEqual(res["laid_out"]["skills"], ["do-it"])
        self.assertTrue(res["laid_out"]["manifest"].endswith("job-manifest.json"))
        self.assertFalse(any("spec" in w for w in res.get("warnings") or []), res.get("warnings"))
        self.assertTrue(os.path.exists(os.path.join(res["package_dir"], "skills", "do-it", "scripts", "do.mjs")))
        self.assertTrue(os.path.exists(os.path.join(res["package_dir"], "agent-runtime-requirements.json")))
        for root, _, names in os.walk(self.home):
            self.assertNotIn("spec.json", [n for n in names if root != os.path.join(self.home, "conv")], root)

    def test_the_framed_prompt_carrying_the_agents_files_is_built_without_a_model(self):
        job = os.path.join(self.home, "job")
        os.makedirs(job)
        files = self.agent_files(self.with_scripts()) + self.attached(["do.mjs", "pieces.mjs", "how.md"])
        p = self.run_prompt(files, job)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Built packable 1.0.0: sha256 ", p.stdout)
        self.assertTrue(os.path.exists(os.path.join(job, "pieces.json")))

    def test_the_agents_files_win_over_a_spec_that_came_with_them(self):
        job = os.path.join(self.home, "job")
        os.makedirs(job)
        old = spec(version="0.9.0")
        old["jobs"][0]["scripts"] = ["scripts/do.mjs", "scripts/pieces.mjs"]
        old["jobs"][0]["references"] = ["references/how.md"]
        spec_path = os.path.join(self.home, "in", "0-Zz98yxWV-spec.json")
        files = self.agent_files(self.with_scripts()) + self.attached(["do.mjs", "pieces.mjs", "how.md"])
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(old, f)
        p = self.run_prompt([spec_path, *files], job)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Built packable 1.0.0", p.stdout, "the spec was built instead of the agent's files")

    def test_a_script_the_agents_files_name_and_the_run_did_not_hand_over_is_refused_by_name(self):
        files = self.agent_files(self.with_scripts()) + self.attached(["do.mjs", "how.md"])
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        p = subprocess.run([sys.executable, PACK, files[0], os.path.join(self.home, "identity.json"), "--from", *files[1:]],
                           capture_output=True, text=True, env=env)
        res = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertEqual(res["act"], "refuse")
        self.assertIn("scripts/pieces.mjs", res["refused"])
        self.assertEqual(self.dist(), [])


class TheAgentsFilesThatGoTogether(unittest.TestCase):
    """Of two rounds of the spec writer's pieces in one message, or with a
    prototype that is itself a package, the files that go together are taken
    and the rest stay ordinary attachments: the same choice as
    agent-folder.mjs's agentFilesAmongTexts."""

    def test_the_manifest_is_chosen_first_and_only_the_skills_it_names(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("pack_under_test", PACK)
        pack = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pack)
        d = tempfile.mkdtemp(prefix="pack-among-")
        try:
            def put(name, obj):
                path = os.path.join(d, name)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(obj if isinstance(obj, str) else json.dumps(obj))
                return path
            man = lambda v, skills: {"version": v, "extensions": {"net.agentdoc.package": {"build": {"skills": skills}}}}  # noqa: E731
            desc = lambda v: {"format": "agent-descriptor-v1", "agent_version": v, "offerings": [{"id": "ab"}]}  # noqa: E731
            files = [put("0-r1-desc.json", desc("0.1.0")), put("1-r1-man.json", man("0.1.0", {"ab": {}, "old": {}})),
                     put("2-r1-old.md", "---\nname: old\ndescription: x\n---\n"),
                     put("3-r2-desc.json", desc("0.2.0")), put("4-r2-rt.json", {"format": "agent-runtime-requirements-v1"}),
                     put("5-r2-man.json", man("0.2.0", {"ab": {}})), put("6-r2-ab.md", "---\nname: ab\ndescription: x\n---\n"),
                     put("7-proto-plugin.json", {"name": "theirs", "extensions": {"net.agentdoc.package": {"descriptor": {}}}}),
                     put("8-two-names.md", "---\nname: ab\nname: cd\ndescription: x\n---\n")]
            got = pack.agent_files_among(files)
            self.assertTrue(got["manifest"].endswith("5-r2-man.json"))
            self.assertTrue(got["descriptor"].endswith("3-r2-desc.json"))
            self.assertEqual({k: os.path.basename(v) for k, v in got["skills"].items()}, {"ab": "6-r2-ab.md"})
            self.assertNotIn(files[7], got["used"])
            self.assertIsNone(pack.skill_slug_of("---\nname: ab\nname: cd\n---\n"), "two names is no skill, as in agent-folder.mjs")
            self.assertIsNone(pack.skill_slug_of("---\n  name: ab\n---\n"), "an indented name is not the skill's")
            self.assertEqual(pack.skill_slug_of("---\ndescription: x\nname: ab\n---\n"), "ab")
        finally:
            shutil.rmtree(d, ignore_errors=True)

class WhereTheSourceWasRead(Harness):
    """The build record's `source` (Common Agent 8.2, 0.17.0-draft): the
    repository and commit the builder read, when it read a clean checkout.

    It is what joins a published package back to the repository it came from,
    and the three ways it is absent are each a fact rather than an oversight: a
    source that is no checkout, a checkout with uncommitted work under it, and
    a checkout with no remote. An absent member says the builder did not
    observe where its source came from.
    """

    def git(self, d, *args):
        return subprocess.run(["git", "-C", d, *args], capture_output=True, text=True,
                              env=dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull))

    def checkout(self, remote="https://github.com/example/agents"):
        """A repository with one committed file, and the spec inside it."""
        d = tempfile.mkdtemp(prefix="pack-src-", dir=self.home)
        self.git(d, "init", "-q", "-b", "main")
        self.git(d, "config", "user.email", "test@example.test")
        self.git(d, "config", "user.name", "Test")
        with open(os.path.join(d, "notes.md"), "w", encoding="utf-8") as f:
            f.write("source\n")
        self.git(d, "add", "-A")
        self.git(d, "commit", "-q", "-m", "first")
        if remote:
            self.git(d, "remote", "add", "origin", remote)
        return d

    def source_of(self, src):
        """Pack a spec whose source folder is `src`, and read back what the
        record says about where the builder read it."""
        res = self.pack(spec(source=src))
        self.assertTrue(res["ok"], res)
        return self.record(res).get("source")

    def test_a_clean_checkout_is_named_by_repository_and_commit(self):
        src = self.checkout()
        head = self.git(src, "rev-parse", "HEAD").stdout.strip()
        source = self.source_of(src)
        self.assertEqual(source["repository"], "https://github.com/example/agents")
        self.assertEqual(source["commit"], head)

    def test_a_token_in_the_remote_address_is_not_written_into_the_record(self):
        src = self.checkout(remote="https://someone:ghp_secrettoken@github.com/example/agents")
        source = self.source_of(src)
        self.assertEqual(source["repository"], "https://github.com/example/agents")
        self.assertNotIn("ghp_secrettoken", json.dumps(source))

    def test_uncommitted_work_under_the_path_means_no_source_at_all(self):
        src = self.checkout()
        with open(os.path.join(src, "notes.md"), "a", encoding="utf-8") as f:
            f.write("changed after the commit\n")
        self.assertIsNone(self.source_of(src))

    def test_a_folder_that_is_no_checkout_is_not_named(self):
        d = tempfile.mkdtemp(prefix="pack-plain-", dir=self.home)
        self.assertIsNone(self.source_of(d))

    def test_a_checkout_with_no_remote_is_not_named(self):
        self.assertIsNone(self.source_of(self.checkout(remote=None)))


class TheAgentsRepository(Harness):
    """A run that is given a remote puts its work in the agent's repository.

    Item 17 of the run-your-own-copy plan says every agent the lifecycle builds
    gets a repository; item 21 says the build reads a commit, so that the build
    record can name what it read. They are one flow, and this is it end to end:
    a bare repository stands in for the workspace's hosted remote, the pack runs
    against it, and afterwards the record names a commit and a clone of that
    remote is an agent repository by the spec's own checker.
    """

    def git(self, d, *args):
        return subprocess.run(["git", "-C", d, *args], capture_output=True, text=True,
                              env=dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull))

    def remote(self):
        d = os.path.join(self.home, "remote.git")
        subprocess.run(["git", "init", "--bare", "-q", "-b", "main", d],
                       capture_output=True, text=True, check=True)
        return d

    def clone(self):
        d = tempfile.mkdtemp(prefix="pack-clone-", dir=self.home)
        shutil.rmtree(d)
        r = subprocess.run(["git", "clone", "-q", os.path.join(self.home, "remote.git"), d],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return d

    def test_the_record_names_the_commit_the_build_read(self):
        res = self.pack(spec(), extra=["--repo-remote", self.remote()])
        self.assertTrue(res["ok"], res)
        source = self.record(res).get("source")
        self.assertIsNotNone(source, "the build record carries no source; item 21 is the point of this")
        self.assertEqual(source["commit"], res["repository"]["source_commit"])
        self.assertEqual(source["path"], "source")
        self.assertTrue(source["repository"])

    def test_the_two_commits_are_in_order_and_both_are_pushed(self):
        res = self.pack(spec(), extra=["--repo-remote", self.remote()])
        repo = res["repository"]
        self.assertNotEqual(repo["commit"], repo["source_commit"])
        clone = self.clone()
        log = self.git(clone, "log", "--format=%H").stdout.split()
        self.assertEqual(log[0], repo["commit"])
        self.assertEqual(log[1], repo["source_commit"])

    def test_a_clone_of_the_remote_is_an_agent_repository(self):
        self.pack(spec(), extra=["--repo-remote", self.remote()])
        clone = self.clone()
        for f in ("agent-repo.json", "agentdoc.json", os.path.join("package", "plugin.json"),
                  os.path.join("source", "spec.json")):
            self.assertTrue(os.path.exists(os.path.join(clone, f)), f)
        manifest = json.load(open(os.path.join(clone, "agent-repo.json"), encoding="utf-8"))
        self.assertEqual(manifest["format"], "agent-repository-v1")
        self.assertEqual(manifest["source"], "source")

        tool = os.environ.get("AGENT_REPO_TOOL") or os.path.join(HERE, os.pardir, os.pardir, "tools", "agent-repo.mjs")
        checked = subprocess.run(["node", tool, "check", clone], capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stderr + checked.stdout)

    def test_a_second_run_lands_on_top_of_the_first(self):
        remote = self.remote()
        first = self.pack(spec(), extra=["--repo-remote", remote])
        second = self.pack(spec(version="1.1.0"), extra=["--repo-remote", remote])
        self.assertTrue(second["ok"], second)
        self.assertNotEqual(second["repository"]["commit"], first["repository"]["commit"])
        clone = self.clone()
        manifest = json.load(open(os.path.join(clone, "package", "plugin.json"), encoding="utf-8"))
        self.assertEqual(manifest["version"], "1.1.0")

    def test_a_run_with_no_remote_makes_no_repository_and_is_otherwise_unchanged(self):
        res = self.pack(spec())
        self.assertTrue(res["ok"], res)
        self.assertNotIn("repository", res)
        self.assertIsNone(self.record(res).get("source"))

    def test_a_remote_with_no_tool_beside_the_builder_refuses_rather_than_building_quietly(self):
        flat = self.flat()
        res = self.pack(spec(), pack_py=flat, extra=["--repo-remote", self.remote()])
        self.assertFalse(res["ok"], res)
        self.assertEqual(res["step"], "repository")


class TheLicenceAWorkspacePublishesUnder(Harness):
    """A spec that names no license takes the workspace's.

    Item 1 of the run-your-own-copy plan put Apache-2.0 on AgentMesh's own
    packages, and item 22 refuses to publish a package that states none. A
    license is the owner's statement about the whole of what they publish, so
    the workspace says it once rather than twelve specs repeating it, and
    nobody hand-edits a spec to put it there.
    """

    def manifest(self, res):
        with open(os.path.join(res["package_dir"], "plugin.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_a_spec_that_names_none_takes_the_workspace_licence(self):
        res = self.pack(spec(), extra=["--license", "Apache-2.0"])
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.manifest(res)["license"], "Apache-2.0")

    def test_a_spec_that_names_its_own_keeps_it(self):
        res = self.pack(spec(license="MIT"), extra=["--license", "Apache-2.0"])
        self.assertEqual(self.manifest(res)["license"], "MIT")

    def test_naming_none_on_either_side_stays_none(self):
        res = self.pack(spec())
        self.assertTrue(res["ok"], res)
        self.assertNotIn("license", self.manifest(res))

    def test_the_licence_reaches_the_repository_the_run_commits(self):
        remote = os.path.join(self.home, "remote.git")
        subprocess.run(["git", "init", "--bare", "-q", "-b", "main", remote],
                       capture_output=True, text=True, check=True)
        res = self.pack(spec(), extra=["--repo-remote", remote, "--license", "Apache-2.0"])
        self.assertTrue(res["ok"], res)
        # The layout tool notes a named license with no LICENSE file beside it,
        # which is the note that tells us the license actually landed.
        self.assertIn("Apache-2.0", " ".join(res["repository"].get("notes", [])))
