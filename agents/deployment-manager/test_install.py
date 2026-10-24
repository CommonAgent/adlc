#!/usr/bin/env python3
"""The installer refuses what it cannot verify, and ledgers what it places.

What is worth pinning: a package the builder emits reads clean; a package
whose pointed file changed, whose descriptor is already bound, whose roles
disagree, or which carries a hidden character is refused before a host is
touched; a host missing a runtime or a binary is named, never substituted
for; an instruction that omits a credential name, a setting, an address or
a ceiling is refused, and one that carries a credential value is refused
before the value is used; the environment the agent's scripts read holds
the placed names' values, the ceilings and where each declared binary is;
each harness's configuration names every mcp role; the ledger notices a
changed or missing file; the translation says where each system is bound;
and the record carries names, digests and ceilings, never a value.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
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
sys.path.insert(0, HERE)
import install  # noqa: E402
import record  # noqa: E402
import translate  # noqa: E402

BUILD = os.path.join(HERE, "..", "package-maker", "build.py")
TMP = tempfile.mkdtemp(prefix="dm-test-")
PKG = None


def frozen_explainer_spec(tmp):
    """explainer-maker 0.11.0's spec, frozen as a fixture and built from the
    example's own files. These tests use its draft-host system as the example
    of a service with a placed credential and settings; from 0.12.0 draft-host
    is brokered and carries neither, so the live spec no longer shows it."""
    doc = json.load(open(os.path.join(HERE, "test", "explainer-maker-0.11.0.spec.json"), encoding="utf-8"))
    packages = os.environ.get("ADLC_PACKAGES") or os.path.join(HERE, "..", "..", "packages")
    if not os.path.isdir(os.path.join(packages, "explainer", "explainer-maker")):
        raise unittest.SkipTest("set ADLC_PACKAGES to a folder of packages to run this test")
    doc["source"] = os.path.abspath(os.path.join(packages, "explainer", "explainer-maker"))
    path = os.path.join(tmp, "explainer-maker-0.11.0.spec.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return path


def setUpModule():
    global PKG  # noqa: PLW0603
    SPEC = frozen_explainer_spec(TMP)
    p = subprocess.run([sys.executable, BUILD, SPEC, os.path.join(TMP, "built")], capture_output=True, text=True)
    res = json.loads(p.stdout.strip().splitlines()[-1])
    assert res.get("ok"), res
    PKG = os.path.join(TMP, "built", "explainer-maker")


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def copy_pkg():
    d = tempfile.mkdtemp(prefix="pkg-", dir=TMP)
    dst = os.path.join(d, "explainer-maker")
    shutil.copytree(PKG, dst)
    return dst


def authored(pkg_dir, rel):
    """The file a package keeps under `rel`'s role: "descriptor.json" names the
    draft Descriptor and "install.json" the runtime requirements, under
    whichever name the builder wrote (agent-descriptor.json and
    agent-runtime-requirements.json since Common Agent 0.30.0-draft)."""
    names = {"descriptor.json": install.DESCRIPTOR_FILES, "install.json": install.INSTALL_FILES}.get(rel)
    if not names:
        return rel
    return next((n for n in names if os.path.exists(os.path.join(pkg_dir, n))), rel)


def pointer_key(manifest, rel):
    """The manifest pointer at that file, under whichever name it carries."""
    if rel == "descriptor.json":
        return "descriptor"
    ext = manifest["extensions"][install.EXT]
    return next((k for k in install.INSTALL_POINTERS if k in ext), "install")


def rewrite(pkg_dir, rel, mutate):
    """Change a pointed file and keep the manifest's pointer honest, so a
    test sees the semantic problem and not the digest one."""
    kind = rel
    rel = authored(pkg_dir, rel)
    path = os.path.join(pkg_dir, rel)
    doc = json.load(open(path, encoding="utf-8"))
    mutate(doc)
    data = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(data)
    mp = os.path.join(pkg_dir, "plugin.json")
    manifest = json.load(open(mp, encoding="utf-8"))
    key = pointer_key(manifest, kind)
    manifest["extensions"][install.EXT][key]["sha256"] = hashlib.sha256(data.encode("utf-8")).hexdigest()
    with open(mp, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


DRAFT_SETTINGS = {"DRAFT_HOST_BUCKET": "agentmesh-ai-site", "DRAFT_HOST_PREFIX": "draft/", "DRAFT_HOST_URL": "https://agentmesh.ai/draft/"}
FULL_ARGS = {
    "name": "explainer", "harness": "codex", "interaction": "service", "admit": [],
    "boot_token": "t1", "package_url": "https://agentcatalog.com/x/package.tar.gz",
    "credentials": {"text-to-speech": "fleet-gemini-api-key", "draft-host": "draft-host-writer",
                    "text-reasoning": "text-reasoning-key"},
    "settings": {"draft-host": dict(DRAFT_SETTINGS)},
    "ceilings": {"text-to-speech": 20000, "text-reasoning": 40},
}


class ReadingThePackage(unittest.TestCase):
    def test_the_builders_package_reads_clean(self):
        pkg = install.read_package(PKG)
        self.assertEqual(pkg["problems"], [])
        self.assertFalse(pkg["legacy"])
        kinds = {s["name"]: s["kind"] for s in pkg["systems"]}
        self.assertEqual(kinds, {"text-reasoning": "service", "text-to-speech": "service",
                                 "draft-host": "service", "brand-assets": "directory",
                                 "customer-brand": "service"})
        tts = next(s for s in pkg["systems"] if s["name"] == "text-to-speech")
        self.assertEqual(tts["credential"], "fleet-gemini-api-key")
        self.assertEqual(tts["env"], "TTS_API_KEY")
        self.assertEqual(tts["settings"], [])
        self.assertEqual(tts["spends"], {"unit": "characters"})
        draft = next(s for s in pkg["systems"] if s["name"] == "draft-host")
        self.assertEqual([st["env"] for st in draft["settings"]], sorted(DRAFT_SETTINGS))
        # The two browser skills carry the same lockfile, hashed.
        deps = pkg["install"]["dependencies"]
        self.assertEqual(sorted(d["skill"] for d in deps), ["check-the-fit", "stage-a-draft"])
        for d in deps:
            self.assertEqual(len(d["sha256"]), 64)
            self.assertTrue(os.path.exists(os.path.join(PKG, d["lockfile"])))

    def test_a_pointed_file_that_changed_is_refused(self):
        d = copy_pkg()
        with open(os.path.join(d, authored(d, "install.json")), "a", encoding="utf-8") as f:
            f.write("\n")
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("does not hash to the digest" in p for p in problems), problems)

    def test_a_lockfile_that_changed_is_refused(self):
        d = copy_pkg()
        with open(os.path.join(d, "skills", "check-the-fit", "scripts", "package-lock.json"), "a", encoding="utf-8") as f:
            f.write("\n")
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("lockfile skills/check-the-fit/scripts/package-lock.json does not hash" in p for p in problems), problems)

    def test_a_bound_descriptor_is_not_a_draft(self):
        d = copy_pkg()
        rewrite(d, "descriptor.json", lambda doc: doc.update({"subject": {"id": "UA"}}))
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("not a draft" in p for p in problems), problems)

    def test_the_two_system_name_sets_must_be_equal(self):
        d = copy_pkg()
        rewrite(d, "install.json", lambda doc: doc["systems"].pop())
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("must be equal" in p for p in problems), problems)

    def test_a_package_that_still_spells_the_member_role_reads_the_same(self):
        # Common Agent 0.16.0-draft renamed systems[].role to systems[].name
        # and keeps `role` as an alias for one revision, so a package built
        # before the rename installs without being rebuilt.
        d = copy_pkg()
        for rel in ("descriptor.json", "install.json"):
            rewrite(d, rel, lambda doc: [s.update({"role": s.pop("name")}) for s in doc["systems"]])
        pkg = install.read_package(d)
        self.assertEqual(pkg["problems"], [])
        self.assertEqual({s["name"] for s in pkg["systems"]},
                         {"text-reasoning", "text-to-speech", "draft-host", "brand-assets", "customer-brand"})

    def test_where_both_spellings_are_present_name_wins(self):
        d = copy_pkg()
        for rel in ("descriptor.json", "install.json"):
            rewrite(d, rel, lambda doc: [s.update({"role": "the-alias"}) for s in doc["systems"]])
        pkg = install.read_package(d)
        self.assertEqual(pkg["problems"], [])
        self.assertNotIn("the-alias", {s["name"] for s in pkg["systems"]})

    def test_a_spending_system_without_a_ceiling_is_refused(self):
        d = copy_pkg()
        rewrite(d, "install.json", lambda doc: doc.update({"ceilings": []}))
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("spends and the install file gives it no ceiling" in p for p in problems), problems)

    def test_a_hidden_character_is_refused(self):
        d = copy_pkg()
        p = os.path.join(d, "skills", "check-the-fit", "SKILL.md")
        with open(p, "a", encoding="utf-8") as f:
            f.write("\nplain​word\n")
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("hidden character U+200B" in p for p in problems), problems)

    def test_a_value_in_the_install_file_is_refused(self):
        d = copy_pkg()
        rewrite(d, "install.json", lambda doc: doc["systems"][0].update({"credential": "AKIA4F9A2C1E7B3D9F1A"}))
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("never a value" in p or "credential value" in p for p in problems), problems)

    def test_a_package_from_before_the_format_still_reads(self):
        d = copy_pkg()
        mp = os.path.join(d, "plugin.json")
        manifest = json.load(open(mp, encoding="utf-8"))
        manifest["extensions"] = {install.OLD_EXT: {"servers": [{"role": "the-ledger", "access": "read"}]}}
        with open(mp, "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        os.remove(os.path.join(d, authored(d, "install.json")))
        os.remove(os.path.join(d, authored(d, "descriptor.json")))
        pkg = install.read_package(d)
        self.assertTrue(pkg["legacy"])
        self.assertEqual(pkg["problems"], [])
        self.assertEqual([s["name"] for s in pkg["systems"]], ["the-ledger"])


def renamed(pkg_dir, current):
    """The package at `pkg_dir`, its two authored files, the pointer and the
    format rewritten under the current names (current=True) or the names
    before Common Agent 0.30.0-draft (current=False), digests kept honest."""
    desc_from, inst_from = authored(pkg_dir, "descriptor.json"), authored(pkg_dir, "install.json")
    i = 0 if current else 1
    desc_to, inst_to = install.DESCRIPTOR_FILES[i], install.INSTALL_FILES[i]
    if desc_from != desc_to:
        os.rename(os.path.join(pkg_dir, desc_from), os.path.join(pkg_dir, desc_to))
    inst = json.load(open(os.path.join(pkg_dir, inst_from), encoding="utf-8"))
    inst["format"] = install.INSTALL_FORMAT if current else install.LEGACY_INSTALL_FORMAT
    os.remove(os.path.join(pkg_dir, inst_from))
    data = json.dumps(inst, indent=2, ensure_ascii=False) + "\n"
    with open(os.path.join(pkg_dir, inst_to), "w", encoding="utf-8", newline="\n") as f:
        f.write(data)
    mp = os.path.join(pkg_dir, "plugin.json")
    manifest = json.load(open(mp, encoding="utf-8"))
    ext = manifest["extensions"][install.EXT]
    for k in install.INSTALL_POINTERS:
        ext.pop(k, None)
    ext["descriptor"]["path"] = desc_to
    ext[install.INSTALL_POINTERS[i]] = {"path": inst_to, "sha256": hashlib.sha256(data.encode("utf-8")).hexdigest()}
    with open(mp, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return pkg_dir


class TheNamesBefore030(unittest.TestCase):
    """Common Agent 0.30.0-draft renamed descriptor.json, install.json, the
    pointer install and the format agent-install-v1. A package under either
    set of names reads the same, and one carrying both reads the current."""

    def facts(self, d):
        pkg = install.read_package(d)
        self.assertEqual(pkg["problems"], [])
        return ({k: pkg[k] for k in ("descriptor", "systems")},
                {k: v for k, v in pkg["install"].items() if k != "format"})

    def test_the_current_names_and_the_former_names_read_the_same(self):
        new = renamed(copy_pkg(), current=True)
        old = renamed(copy_pkg(), current=False)
        self.assertTrue(os.path.exists(os.path.join(new, "agent-runtime-requirements.json")))
        self.assertTrue(os.path.exists(os.path.join(old, "install.json")))
        self.assertEqual(self.facts(new), self.facts(old))
        self.assertEqual(install.read_package(new)["install"]["format"], "agent-runtime-requirements-v1")
        self.assertEqual(install.read_package(old)["install"]["format"], "agent-install-v1")

    def test_with_no_pointer_the_files_are_found_by_either_name(self):
        for current in (True, False):
            d = renamed(copy_pkg(), current=current)
            mp = os.path.join(d, "plugin.json")
            manifest = json.load(open(mp, encoding="utf-8"))
            ext = manifest["extensions"][install.EXT]
            for k in ("descriptor", *install.INSTALL_POINTERS):
                ext.pop(k, None)
            with open(mp, "w", encoding="utf-8") as f:
                json.dump(manifest, f)
            pkg = install.read_package(d)
            self.assertIsNotNone(pkg["descriptor"], current)
            self.assertIsNotNone(pkg["install"], current)

    def test_where_both_names_are_present_the_current_one_is_read(self):
        d = renamed(copy_pkg(), current=True)
        with open(os.path.join(d, "install.json"), "w", encoding="utf-8") as f:
            json.dump({"format": "agent-install-v1", "systems": [], "ceilings": [], "job_seconds": 61}, f)
        pkg = install.read_package(d)
        self.assertEqual(pkg["problems"], [])
        self.assertNotEqual(pkg["install"].get("job_seconds"), 61)

    def test_the_translation_reads_either_name(self):
        new = translate.package_facts(renamed(copy_pkg(), current=True))
        old = translate.package_facts(renamed(copy_pkg(), current=False))
        self.assertIsNotNone(new[1])
        self.assertIsNotNone(new[2])
        self.assertEqual(new[1], old[1])
        self.assertEqual(new[3], old[3])
        self.assertEqual({k: v for k, v in new[2].items() if k != "format"},
                         {k: v for k, v in old[2].items() if k != "format"})

    def test_a_format_that_is_neither_is_refused(self):
        d = copy_pkg()
        rewrite(d, "install.json", lambda doc: doc.update({"format": "agent-install-v2"}))
        problems = install.read_package(d)["problems"]
        self.assertTrue(any("format is 'agent-install-v2'" in p for p in problems), problems)


class WhatLooksLikeAValue(unittest.TestCase):
    def test_names_digests_and_addresses_are_not_values(self):
        for s in ("fleet-gemini-api-key", "draft-host-writer", "a" * 64, hashlib.sha256(b"x").hexdigest(),
                  "agentmesh-ai-site", "draft/", "https://agentmesh.ai/draft/", "https://example.test/mcp",
                  "npx -y some-server /home/x"):
            self.assertFalse(install.looks_like_value(s), s)

    def test_keys_and_tokens_are_values(self):
        for s in ("AKIA4F9A2C1E7B3D9F1A", "ghp_" + "a1" * 12, "sk-proj-" + "Ab1" * 8,
                  "ya29." + "x9" * 12, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef0123",
                  "Ab1" * 12):
            self.assertTrue(install.looks_like_value(s), s)


class TheHost(unittest.TestCase):
    def test_a_missing_runtime_or_binary_is_named(self):
        inst = install.read_package(PKG)["install"]
        probe = lambda n: {"node": "v18.19.0"}.get(n)  # noqa: E731
        missing = install.check_host(inst, probe)
        self.assertEqual(len(missing), 4, missing)
        self.assertIn("runtime node >=22: found v18.19.0", missing[0])
        self.assertIn("binary chromium: not on this host (renders every step", missing[1])
        self.assertIn("binary ffmpeg: not on this host", missing[2])
        self.assertIn("binary ffprobe: not on this host", missing[3])

    def test_a_host_with_everything_passes(self):
        inst = install.read_package(PKG)["install"]
        probe = lambda n: {"node": "v22.4.1", "chromium": "Chromium 128", "ffmpeg": "ffmpeg 5.1", "ffprobe": "ffprobe 5.1"}.get(n)  # noqa: E731
        self.assertEqual(install.check_host(inst, probe), [])

    def test_where_each_binary_is_goes_to_the_agent(self):
        inst = install.read_package(PKG)["install"]
        which = lambda n: {"chromium-browser": "/usr/bin/chromium-browser"}.get(n)  # noqa: E731
        self.assertEqual(install.find_binaries(inst, which), {"chromium": "/usr/bin/chromium-browser"})
        self.assertEqual(install.find_binaries(inst, lambda n: None), {})
        self.assertEqual(install.binary_var("chromium"), "BINARY_CHROMIUM")

    def test_version_wording(self):
        self.assertTrue(install.version_satisfies("v22.4.0", ">=22"))
        self.assertFalse(install.version_satisfies("v18.19.0", ">=22"))
        self.assertTrue(install.version_satisfies("3.12.3", "^3.10"))
        self.assertFalse(install.version_satisfies("4.0.0", "^3.10"))
        self.assertTrue(install.version_tuple("0.2.0") > install.version_tuple("0.1.9"))


class TheInstruction(unittest.TestCase):
    def setUp(self):
        self.pkg = install.read_package(PKG)

    def test_a_complete_instruction_passes(self):
        self.assertEqual(install.check_instruction(FULL_ARGS, self.pkg, lambda n: True), [])

    def test_the_package_names_are_the_default_credential_names(self):
        args = {k: v for k, v in FULL_ARGS.items() if k != "credentials"}
        self.assertEqual(install.check_instruction(args, self.pkg, lambda n: True), [])

    def test_what_is_missing_is_named(self):
        refusals = install.check_instruction({"name": "x"}, self.pkg, lambda n: True)
        joined = "\n".join(refusals)
        self.assertIn("service draft-host: the instruction must supply DRAFT_HOST_BUCKET (the bucket the drafts are placed in)", joined)
        self.assertIn("service draft-host: the instruction must supply DRAFT_HOST_URL", joined)
        self.assertIn("text-to-speech spends characters and needs a ceiling per task; the instruction gives none", joined)

    def test_a_credential_missing_from_the_store_is_named(self):
        refusals = install.check_instruction(FULL_ARGS, self.pkg, lambda n: n != "fleet-gemini-api-key")
        self.assertEqual(refusals, ["service text-to-speech: no credential named fleet-gemini-api-key in the store; place it there and name it"])

    def test_a_value_is_refused_before_it_is_used(self):
        args = json.loads(json.dumps(FULL_ARGS))
        args["credentials"]["text-to-speech"] = "AKIA4F9A2C1E7B3D9F1A"
        refusals = install.check_instruction(args, self.pkg, lambda n: True)
        self.assertTrue(any("never a value" in r for r in refusals), refusals)
        self.assertTrue(any("carries what looks like a credential value" in r for r in refusals), refusals)

    def test_the_stack_bindings_are_not_swept_as_if_they_were_values(self):
        # A Google Cloud project id with digits in it is exactly what a value
        # looks like to the sweep. The list is checked member by member where the
        # procedure reads it, so the sweep leaves it alone.
        args = json.loads(json.dumps(FULL_ARGS))
        args["stack_bindings"] = [{"system": "draft-host", "product": "google-cloud-storage",
                                   "key_store": {"kind": "google-secret-manager",
                                                 "project": "acmeprod1528148150979abcdefghijklmnop"}}]
        self.assertEqual(install.check_instruction(args, self.pkg, lambda n: True), [])

    def test_the_owner_is_not_swept_as_if_it_were_a_value(self):
        # An account or organisation id is a long token, which is what a value
        # looks like to the sweep; it names who the agent becomes and picks the
        # node that holds that owner's agents, and is read only for that.
        args = json.loads(json.dumps(FULL_ARGS))
        args["owner"] = {"kind": "account", "id": "019f9c2c-392c-7000-b4b1-7668271a49be"}
        self.assertEqual(install.check_instruction(args, self.pkg, lambda n: True), [])

    def test_an_address_the_instruction_carries_is_not_mistaken_for_a_value(self):
        # The registry path of this project's own images is forty token
        # characters mixing letters and digits; it refused every update of a
        # container agent on 2026-09-14 until the addresses were left out of
        # the sweep.
        args = json.loads(json.dumps(FULL_ARGS))
        args["registry"] = "gcr.io/langbench-1528148150979/deploymgr"
        args["image"] = "gcr.io/langbench-1528148150979/deploymgr/watcher@sha256:" + "ab" * 32
        args["bucket"] = "example-agent-state"
        refusals = install.check_instruction(args, self.pkg, lambda n: True)
        self.assertFalse(any("carries what looks like a credential value" in r for r in refusals), refusals)

    def test_a_long_model_name_is_a_model_and_not_a_value(self):
        # A long model name mixes letters and digits, which the sweep read as
        # a value; the first update filed with a model in its instruction was
        # refused for it (spec-writer 0.2.6, 2026-09-29). A model is held to
        # its own shape instead.
        for model in ("google-vertex-anthropic/claude-haiku-4-5@20251001", "google/gemini-2.5-flash", "anthropic/claude-opus-5",
                      "google-vertex-anthropic/claude-sonnet-5-5@default"):
            args = json.loads(json.dumps(FULL_ARGS))
            args["model"] = model
            self.assertEqual(install.check_instruction(args, self.pkg, lambda n: True), [], model)

    def test_a_model_that_is_not_a_model_name_or_is_a_key_is_refused(self):
        for model in ("sk-or-v1-" + "ab12" * 8, "Claude Sonnet", "gemini", "AIza" + "A1b2" * 9):
            args = json.loads(json.dumps(FULL_ARGS))
            args["model"] = model
            refusals = install.check_instruction(args, self.pkg, lambda n: True)
            self.assertIn("the instruction's model is not a model name; a model is provider/model in lower case, such as google-vertex-anthropic/claude-sonnet-5-5", refusals, model)

    def test_a_setting_that_looks_like_a_credential_is_refused(self):
        args = json.loads(json.dumps(FULL_ARGS))
        args["settings"]["draft-host"]["DRAFT_HOST_PREFIX"] = "sk-proj-" + "Ab1" * 8
        refusals = install.check_instruction(args, self.pkg, lambda n: True)
        self.assertEqual(refusals, ["service draft-host: DRAFT_HOST_PREFIX looks like a credential value; credentials go in the store by name"])

    def test_a_model_named_in_a_setting_is_not_read_as_a_credential(self):
        # Claude on Vertex (2026-09-29) is a run long enough for the token
        # sweep, and a model-shaped setting is a model name, not a value.
        self.assertTrue(install.looks_like_value("google-vertex-anthropic/claude-sonnet-5-5"))
        self.assertTrue(install.model_named("google-vertex-anthropic/claude-sonnet-5-5"))
        self.assertFalse(install.model_named("Ab1Cd2Ef3/Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2"))
        self.assertFalse(install.model_named("sk-proj-" + "ab1" * 8))
        args = json.loads(json.dumps(FULL_ARGS))
        args["settings"]["draft-host"]["DRAFT_HOST_PREFIX"] = "google-vertex-anthropic/claude-sonnet-5-5"
        self.assertEqual(install.check_instruction(args, self.pkg, lambda n: True), [])

    def test_a_setting_the_package_does_not_declare_is_refused(self):
        args = json.loads(json.dumps(FULL_ARGS))
        args["settings"]["text-to-speech"] = {"TTS_PROJECT": "some-project"}
        refusals = install.check_instruction(args, self.pkg, lambda n: True)
        self.assertEqual(refusals, ["service text-to-speech: the instruction supplies TTS_PROJECT, which the package does not declare"])

    def test_a_system_the_package_does_not_have_is_refused(self):
        args = json.loads(json.dumps(FULL_ARGS))
        args["ceilings"]["the-ledger"] = 5
        refusals = install.check_instruction(args, self.pkg, lambda n: True)
        self.assertEqual(refusals, ["ceilings names 'the-ledger', which is not a system this package has"])

    def test_an_mcp_system_needs_an_address_without_a_value_in_it(self):
        pkg = json.loads(json.dumps(self.pkg))
        # By role, not by index: the package gained systems and index 2 became
        # draft-host, so this quietly deleted a service and the refusals that
        # came back were about the missing one rather than about mcp.
        at = next(i for i, s in enumerate(pkg["systems"]) if s["name"] == "brand-assets")
        pkg["systems"][at] = {"name": "brand-assets", "kind": "mcp", "access": "read", "credential": None,
                              "env": None, "settings": [], "spends": None}
        self.assertIn("mcp brand-assets: the instruction must supply an address (a URL or a command line)",
                      install.check_instruction(FULL_ARGS, pkg, lambda n: True))
        args = {**FULL_ARGS, "addresses": {"brand-assets": "https://assets.test/mcp?key=" + "Ab1" * 12}}
        self.assertIn("mcp brand-assets: the address carries what looks like a credential value; name a credential instead",
                      install.check_instruction(args, pkg, lambda n: True))
        args = {**FULL_ARGS, "addresses": {"brand-assets": "https://assets.test/mcp"}}
        self.assertEqual(install.check_instruction(args, pkg, lambda n: True), [])


class TheDependencies(unittest.TestCase):
    """Where a lockfile's tree goes, which is anywhere but the package.

    A node_modules inside the installed package is what the image builder
    refuses, so an agent installed that way could never be turned into an
    image afterwards, and nothing said so at the time."""

    def setUp(self):
        self.pkg = install.read_package(PKG)
        self.plan, self.problems = install.deps_plan("/home/explainer", self.pkg["install"])

    def test_every_tree_is_under_the_home_and_outside_the_package(self):
        self.assertEqual(self.problems, [])
        self.assertEqual([d["skill"] for d in self.plan], ["check-the-fit", "stage-a-draft"])
        for d in self.plan:
            self.assertTrue(d["dir"].startswith(install.deps_root("/home/explainer")))
            self.assertNotIn("explainer-maker", d["dir"])
            self.assertNotIn(os.path.dirname(d["lockfile"]), d["dir"])

    def test_two_skills_naming_the_same_lockfile_share_one_tree(self):
        # The explainer maker's two browser skills carry the same lockfile, so
        # the digest names one directory and the installer runs npm once.
        self.assertEqual(len({d["dir"] for d in self.plan}), 1)
        self.assertTrue(self.plan[0]["dir"].endswith(self.plan[0]["sha256"]))

    def test_two_different_lockfiles_get_two_trees(self):
        inst = {"dependencies": [{"skill": "a", "lockfile": "skills/a/scripts/package-lock.json", "sha256": "ab" * 32},
                                 {"skill": "b", "lockfile": "skills/b/scripts/package-lock.json", "sha256": "cd" * 32}]}
        plan, problems = install.deps_plan("/home/x", inst)
        self.assertEqual(problems, [])
        self.assertEqual(len({d["dir"] for d in plan}), 2)

    def test_a_dependency_with_no_digest_is_a_problem_rather_than_a_directory(self):
        inst = {"dependencies": [{"skill": "a", "lockfile": "skills/a/scripts/package-lock.json"}]}
        plan, problems = install.deps_plan("/home/x", inst)
        self.assertEqual(plan, [])
        self.assertIn("with no digest", problems[0])
        plan, problems = install.deps_plan("/home/x", {"dependencies": [{"lockfile": "../outside/package-lock.json",
                                                                        "sha256": "ab" * 32}]})
        self.assertEqual(plan, [])
        self.assertIn("not a path inside the package", problems[0])

    def test_the_environment_names_where_the_trees_are_and_only_when_there_are_some(self):
        bindings = install.plan_bindings(FULL_ARGS, self.pkg, "/home/explainer")
        values = {"fleet-gemini-api-key": "k", "draft-host-writer": "w", "text-reasoning-key": "r"}
        text = install.env_file(bindings, values, {}, deps=install.deps_root("/home/explainer"))
        self.assertIn("export AGENT_DEPS='/home/explainer/.deps'", text.replace("\\", "/"))
        self.assertNotIn("AGENT_DEPS", install.env_file(bindings, values, {}))


class TheBindings(unittest.TestCase):
    def setUp(self):
        self.pkg = install.read_package(PKG)
        self.bindings = install.plan_bindings(FULL_ARGS, self.pkg, "/home/explainer")

    def test_one_binding_per_system(self):
        by = {b["name"]: b for b in self.bindings}
        self.assertEqual(by["brand-assets"], {"name": "brand-assets", "kind": "directory", "access": "read",
                                              "path": "/home/explainer/work/brand-assets"})
        self.assertEqual(by["text-to-speech"]["credential"], "fleet-gemini-api-key")
        self.assertEqual(by["text-to-speech"]["settings"], {})
        # The enforcing side travels with the number, from the install file
        # (12.4 rule 4): a number alone does not say who can refuse a charge.
        self.assertEqual(by["text-to-speech"]["ceiling"],
                         {"per": "task", "limit": 20000, "env": "CEILING_TEXT_TO_SPEECH", "enforced_by": "runtime"})
        self.assertEqual(by["draft-host"]["settings"], DRAFT_SETTINGS)
        self.assertNotIn("ceiling", by["draft-host"])

    def test_the_environment_holds_values_ceilings_settings_and_binaries(self):
        text = install.env_file(self.bindings, {"fleet-gemini-api-key": "it's secret", "draft-host-writer": '{"k":1}', "text-reasoning-key": "r"},
                                {"chromium": "/usr/bin/chromium"})
        self.assertIn("export BINARY_CHROMIUM='/usr/bin/chromium'", text)
        self.assertIn("export TTS_API_KEY='it'\"'\"'s secret'", text)
        self.assertIn("export DRAFT_HOST_CREDENTIAL='{\"k\":1}'", text)
        self.assertIn("export DRAFT_HOST_BUCKET='agentmesh-ai-site'", text)
        self.assertIn("export DRAFT_HOST_URL='https://agentmesh.ai/draft/'", text)
        self.assertIn("export CEILING_TEXT_TO_SPEECH='20000'", text)
        self.assertIn("export CEILING_TEXT_TO_SPEECH_PER='task'", text)
        self.assertIn("export CEILING_TEXT_TO_SPEECH_UNIT='characters'", text)
        with self.assertRaises(KeyError):
            install.env_file(self.bindings, {"fleet-gemini-api-key": "x"})

    def test_what_the_record_may_say_is_names_only(self):
        names = install.placed_names(self.bindings)
        self.assertEqual(names["credentials"], ["draft-host-writer", "fleet-gemini-api-key", "text-reasoning-key"])
        self.assertEqual(names["settings"], sorted(DRAFT_SETTINGS))
        self.assertEqual(names["ceilings"], [{"system": "text-reasoning", "per": "task", "limit": 40,
                                              "unit": "calls", "enforced_by": "runtime"},
                                             {"system": "text-to-speech", "per": "task", "limit": 20000,
                                              "unit": "characters", "enforced_by": "runtime"}])
        envs = [c["env"] for c in install.ceilings_doc(self.bindings)["ceilings"]]
        self.assertIn("CEILING_TEXT_TO_SPEECH", envs)


class TheHarness(unittest.TestCase):
    MCP = [{"name": "the-ledger", "kind": "mcp", "access": "read", "address": "https://ledger.test/mcp",
            "credential": "ledger-key", "env": "LEDGER_TOKEN", "settings": {}},
           {"name": "the-files", "kind": "mcp", "access": "read", "address": "npx -y some-server /home/x/work"}]

    def test_codex_names_every_mcp_system(self):
        files = install.harness_files("codex", "x", "google/gemini-2.5-flash", self.MCP)
        toml = files[".codex/config.toml"]
        self.assertIn('[projects."/home/x"]', toml)
        self.assertIn('[mcp_servers.the-ledger]\nurl = "https://ledger.test/mcp"\nbearer_token_env_var = "LEDGER_TOKEN"', toml)
        self.assertIn('[mcp_servers.the-files]\ncommand = "npx"\nargs = ["-y", "some-server", "/home/x/work"]', toml)

    def test_opencode_and_claude_name_them_too(self):
        oc = json.loads(install.harness_files("opencode", "x", "m", self.MCP)[".config/opencode/opencode.json"])
        self.assertEqual(oc["mcp"]["the-ledger"], {"type": "remote", "url": "https://ledger.test/mcp", "enabled": True,
                                                   "headers": {"Authorization": "Bearer {env:LEDGER_TOKEN}"}})
        self.assertEqual(oc["mcp"]["the-files"]["command"], ["npx", "-y", "some-server", "/home/x/work"])
        cl = json.loads(install.harness_files("claude", "x", "m", self.MCP)[".claude.json"])
        self.assertEqual(cl["mcpServers"]["the-ledger"]["headers"], {"Authorization": "Bearer ${LEDGER_TOKEN}"})
        self.assertEqual(cl["mcpServers"]["the-files"], {"command": "npx", "args": ["-y", "some-server", "/home/x/work"]})

    def test_no_mcp_system_means_no_configuration_to_place(self):
        self.assertEqual(install.harness_files("opencode", "x", "m", []), {})
        self.assertIn(".codex/config.toml", install.harness_files("codex", "x", "m", []))

    def test_the_coverage_is_the_table(self):
        self.assertEqual(sorted(install.HARNESSES), ["claude", "codex", "opencode"])


class TheLedger(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="home-", dir=TMP)
        shutil.copytree(PKG, os.path.join(self.home, "explainer-maker"))
        with open(os.path.join(self.home, "AGENTS.md"), "w") as f:
            f.write("instructions\n")

    def test_skills_are_laid_out_where_the_harness_looks(self):
        made = install.lay_out_skills(self.home, "explainer-maker", ["check-the-fit", "stage-a-draft"], "codex", link=False)
        self.assertEqual(made, [".agents/skills/check-the-fit", ".agents/skills/stage-a-draft"])
        self.assertTrue(os.path.exists(os.path.join(self.home, ".agents", "skills", "check-the-fit", "SKILL.md")))
        made = install.lay_out_skills(self.home, "explainer-maker", ["check-the-fit"], "claude", link=False)
        self.assertEqual(made, [".claude/skills/check-the-fit"])

    def test_a_changed_or_missing_file_is_drift(self):
        entries = install.ledger(self.home, ["explainer-maker", "AGENTS.md", ".config/fleet/env"], withhold={".config/fleet/env"})
        self.assertTrue(any(e["path"] == "explainer-maker/plugin.json" for e in entries))
        self.assertEqual(install.drift(entries, self.home), [])
        with open(os.path.join(self.home, "AGENTS.md"), "a") as f:
            f.write("a hand edit\n")
        inst_name = authored(os.path.join(self.home, "explainer-maker"), "install.json")
        os.remove(os.path.join(self.home, "explainer-maker", inst_name))
        self.assertEqual(sorted(install.drift(entries, self.home), key=lambda d: d["path"]),
                         [{"path": "AGENTS.md", "state": "changed"}, {"path": f"explainer-maker/{inst_name}", "state": "missing"}])
        self.assertEqual(len(install.ledger_digest(entries)), 64)


class TheTranslation(unittest.TestCase):
    def test_the_instructions_say_where_each_system_is_bound(self):
        pkg = install.read_package(PKG)
        bindings = install.plan_bindings(FULL_ARGS, pkg, "/home/explainer")
        text = translate.render(PKG, "explainer", bindings)
        self.assertIn("| text-to-speech | a service; its credential is in $TTS_API_KEY (the secret named fleet-gemini-api-key); "
                      "ceiling $CEILING_TEXT_TO_SPEECH = 20000 characters per task | trigger |", text)
        self.assertIn("| draft-host | a service; its credential is in $DRAFT_HOST_CREDENTIAL (the secret named draft-host-writer); "
                      "its settings are in $DRAFT_HOST_BUCKET, $DRAFT_HOST_PREFIX, $DRAFT_HOST_URL | write |", text)
        self.assertIn("| brand-assets | ~/work/brand-assets | read |", text)
        self.assertIn("- text-to-speech: 20000 characters per task, in $CEILING_TEXT_TO_SPEECH.", text)
        self.assertIn("A ceiling is binding.", text)
        self.assertIn("under\n~/records/ as you work", text)
        self.assertIn("~/explainer-maker/net.agentdoc.package/NOT.md is binding.", text)
        self.assertNotIn("agentmesh-ai-site", text)


DEPLOY_RESULT = {
    "ok": True, "act": "deploy", "name": "explainer", "package": "explainer-maker", "version": "0.1.0",
    "sha256": "ab" * 32, "url": "https://agentcatalog.com/x/package.tar.gz", "harness": "codex",
    "interaction": "service", "agent_key": "UAKEY", "handle": "explainer@example.test", "admitted_at_start": [],
    "secret_placed": "fleet-anthropic-api-key", "credentials_placed": ["draft-host-writer", "fleet-gemini-api-key"],
    "settings_placed": ["DRAFT_HOST_BUCKET"], "ceilings": [{"system": "text-to-speech", "per": "task", "limit": 20000, "unit": "characters"}],
    "dependencies": [], "descriptor": {"digest": "cd" * 32, "signed": True, "added": ["interaction", "shape", "signatures", "subject"], "changed": []},
    "ledger": {"path": "/opt/fleet/deploymgr-ledgers/explainer.json", "files": 40, "sha256": "ef" * 32},
    "smoke": {"passed": True, "listening": True, "probe_reply": "I make explainers."},
}


class TheRecord(unittest.TestCase):
    def test_a_deploy_record_carries_digests_names_and_ceilings(self):
        doc = record.build(DEPLOY_RESULT, None, "UADM")
        self.assertEqual(doc["act"], "deploy")
        self.assertEqual(doc["package"]["sha256"], "ab" * 32)
        self.assertEqual(doc["descriptor"], {"sha256": "cd" * 32, "signed": True, "added": ["interaction", "shape", "signatures", "subject"]})
        self.assertEqual(doc["secrets_placed"], ["fleet-anthropic-api-key", "draft-host-writer", "fleet-gemini-api-key"])
        self.assertEqual(doc["credentials_placed"], ["draft-host-writer", "fleet-gemini-api-key"])
        self.assertEqual(doc["settings_placed"], ["DRAFT_HOST_BUCKET"])
        self.assertEqual(doc["ceilings"][0]["limit"], 20000)
        self.assertEqual(doc["ledger"]["files"], 40)
        self.assertEqual(doc["checks"][0]["kind"], "smoke")
        self.assertTrue(doc["checks"][0]["passed"])
        self.assertIn("_unsigned", doc)

    def test_an_update_record_names_both_versions_and_whether_it_restored(self):
        res = {**DEPLOY_RESULT, "act": "update", "version": "0.2.0", "sha256": "12" * 32, "restored": False,
               "previous": {"version": "0.1.0", "sha256": "ab" * 32, "descriptor": {"digest": "cd" * 32, "signed": True}},
               "drift_before": [{"path": "AGENTS.md", "state": "changed"}]}
        doc = record.build(res, None, "UADM")
        self.assertEqual(doc["previous_package"], {"name": "explainer-maker", "version": "0.1.0", "sha256": "ab" * 32})
        self.assertEqual(doc["previous_descriptor"]["sha256"], "cd" * 32)
        self.assertEqual(doc["drift_before"], [{"path": "AGENTS.md", "state": "changed"}])
        self.assertFalse(doc["restored"])
        failed = record.build({**res, "ok": False, "restored": True, "smoke": {"passed": False}}, None, "UADM")
        self.assertTrue(failed["restored"])
        self.assertIn("0.1.0 was restored", failed["outcome"])
        self.assertFalse(failed["checks"][0]["passed"])

    def test_a_removal_names_the_credentials_it_removed(self):
        doc = record.build({"ok": True, "act": "remove", "name": "explainer", "credentials_removed": ["fleet-gemini-api-key"],
                            "was": {"agent_key": "UAKEY", "handle": None, "harness": "codex"}, "remaining": []}, None, "UADM")
        self.assertEqual(doc["credentials_removed"], ["fleet-gemini-api-key"])
        self.assertIn("the placed environment file", doc["removed"])

    def test_an_old_inventory_entry_still_names_the_harness(self):
        # Agents deployed before 2026-09-05 have "framework" in the inventory.
        doc = record.build({"ok": True, "act": "remove", "name": "explainer", "credentials_removed": [],
                            "was": {"agent_key": "UAKEY", "handle": None, "framework": "codex"}, "remaining": []}, None, "UADM")
        self.assertEqual(doc["target"]["harness"], "codex")

    def test_a_refusal_is_recorded_with_its_step(self):
        doc = record.build({"ok": False, "step": "host", "error": "this host lacks what the package needs: binary chromium",
                            "state": "nothing created", "package": "explainer-maker"}, None, "UADM")
        self.assertEqual(doc["act"], "refuse")
        self.assertEqual(doc["refused"]["step"], "host")
        self.assertEqual(doc["package"], {"name": "explainer-maker"})
        self.assertNotIn("checks", doc)


if __name__ == "__main__":
    unittest.main()
