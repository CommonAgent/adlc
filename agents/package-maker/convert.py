#!/usr/bin/env python3
"""Turn a spec.json into the agent's own files, the layout Common Agent 13.2
says a package is authored in.

Usage: convert.py <spec.json> [<folder>] [--force]

Writes into <folder> (default: the folder the spec sits in):

  agent-descriptor.json            the draft Descriptor, as the builder writes it
  agent-runtime-requirements.json  the runtime requirements, as the builder writes them
  plugin.json                      the manifest's authored members, and the
                                   builder's own entry (see below)
  skills/<slug>/SKILL.md           each job's skill, as the builder writes it

and prints one JSON line saying what it wrote. The spec itself is left where
it is: deleting it is a separate, reviewed step.

HOW IT CONVERTS. It does not restate the builder's rules. It runs build.py
on the spec, into a scratch folder, with nothing from the environment that
would add a fact the spec did not state (DEFAULT_LICENSE) or refuse a build
for a reason that is not the spec's (REQUIRED_CODER, OFFICIAL_CODER), and
takes the two authored files and each SKILL.md from what it built. So the
folder says exactly what the package said, and building the folder makes the
same package.

WHAT plugin.json CARRIES. The members the builder wrote into the manifest
(name, version, description, license, homepage, repository, author,
keywords, and `from` in the package's own entry), and one member that is the
builder's and never the package's, `build` in the package's own entry:

  "build": {
    "source": "<folder>",        # ? where the files below are, relative to this folder
    "kind": "...",               # ? what the inside is made of (routes a container agent)
    "container": {...},          # ? a container agent's block
    "claims": [...],             # ? the roles a container agent claims
    "skills": {                  # each skill, in the spec's job order, and the files the
      "<slug>": { "scripts": [...], "references": [...], "assets": [...] }   # build copies into it
    }
  }

The files stay where the spec named them, so a script several skills run is
kept once and copied into each skill at build. A job's instructions are now
the "How to do it" section of its SKILL.md; an instructions file the spec
pointed at is left in place, and the SKILL.md holds its text as of now.

A container agent's spec (kind mesh-coded or third-party-framework) makes no
package, so there is nothing to write and it is refused.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build.py")
EXT = "net.agentdoc.package"
DESCRIPTOR_FILE = "agent-descriptor.json"
RUNTIME_FILE = "agent-runtime-requirements.json"
WRITES = ("plugin.json", DESCRIPTOR_FILE, RUNTIME_FILE)


def out(obj):
    print(json.dumps(obj))
    sys.exit(0 if obj.get("ok") else 1)


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def convert(spec_path, folder, force=False):
    try:
        with open(spec_path, encoding="utf-8") as f:
            spec = json.load(f)
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"cannot read spec: {e}"})
    if not isinstance(spec, dict):
        out({"ok": False, "error": "the spec is not a JSON object"})
    if spec.get("kind") in ("mesh-coded", "third-party-framework"):
        out({"ok": False, "error": f"a {spec['kind']} agent's spec is checked and makes no package, so it has no package files to convert"})
    present = [n for n in WRITES if os.path.exists(os.path.join(folder, n))]
    if present and not force:
        out({"ok": False, "error": f"{', '.join(present)} already in {folder}; pass --force to write over them"})

    env = {k: v for k, v in os.environ.items() if k not in ("DEFAULT_LICENSE", "REQUIRED_CODER", "OFFICIAL_CODER", "PROVENANCE")}
    scratch = tempfile.mkdtemp(prefix="convert-")
    try:
        p = subprocess.run([sys.executable, BUILD, os.path.abspath(spec_path), scratch],
                           capture_output=True, text=True, encoding="utf-8", env=env, timeout=300)
        try:
            res = json.loads((p.stdout or "").strip().splitlines()[-1])
        except Exception:  # noqa: BLE001
            out({"ok": False, "error": "the builder gave no answer: " + (p.stderr or "").strip()[-400:]})
        if not res.get("ok"):
            out({"ok": False, "error": f"the spec does not build, so there is nothing to convert: {res.get('error')}"})
        pkg = res["path"]
        jobs = [j for j in spec.get("jobs") or [] if isinstance(j, dict)]
        slugs = [j.get("slug") for j in jobs]
        built_skills = sorted(os.listdir(os.path.join(pkg, "skills")))
        if sorted(slugs) != built_skills:
            out({"ok": False, "error": "the built skills are not the spec's jobs"})
        with open(os.path.join(pkg, DESCRIPTOR_FILE), encoding="utf-8") as f:
            desc = json.load(f)
        carried = set()
        for o in desc.get("offerings") or []:
            carried.add(o.get("id"))
            carried.update(s.get("id") for s in o.get("steps") or [])
        # A job that is neither offered nor a step makes a skill no offering
        # stands for. The builder carries it as it always has, from the
        # build entry, and says so; the warning here says it first.
        stray = [s for s in slugs if s not in carried]

        with open(os.path.join(pkg, "plugin.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        own = manifest["extensions"][EXT]
        for k in ("descriptor", "runtime_requirements", "install", "built", "draft"):
            own.pop(k, None)
        build = {}
        if spec.get("source"):
            build["source"] = os.path.relpath(os.path.abspath(spec["source"]), os.path.abspath(folder)).replace(os.sep, "/")
        for k in ("kind", "container", "claims"):
            if k in spec:
                build[k] = spec[k]
        build["skills"] = {j["slug"]: {k: list(j[k]) for k in ("scripts", "references", "assets") if j.get(k)} for j in jobs}
        own["build"] = build

        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "plugin.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write(dumps(manifest))
        for n in (DESCRIPTOR_FILE, RUNTIME_FILE):
            shutil.copyfile(os.path.join(pkg, n), os.path.join(folder, n))
        written = list(WRITES)
        for slug in slugs:
            d = os.path.join(folder, "skills", slug)
            target = os.path.join(d, "SKILL.md")
            if os.path.exists(target) and not force:
                out({"ok": False, "error": f"skills/{slug}/SKILL.md already in {folder}; pass --force to write over it"})
            os.makedirs(d, exist_ok=True)
            shutil.copyfile(os.path.join(pkg, "skills", slug, "SKILL.md"), target)
            written.append(f"skills/{slug}/SKILL.md")
        out({"ok": True, "name": res["name"], "version": res["version"], "folder": folder, "wrote": written,
             **({"warnings": [f"skills/{s} stands for no offering or step; Common Agent 12.5 says every skill stands for one" for s in stray]} if stray else {})})
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def main():
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]
    if len(args) not in (1, 2):
        out({"ok": False, "error": "usage: convert.py <spec.json> [<folder>] [--force]"})
    spec_path = args[0]
    folder = args[1] if len(args) == 2 else os.path.dirname(os.path.abspath(spec_path))
    convert(spec_path, folder, force)


if __name__ == "__main__":
    main()
