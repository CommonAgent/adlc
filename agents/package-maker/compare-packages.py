#!/usr/bin/env python3
"""The gate for moving an agent from spec.json to its own files: every agent
must build a package identical to the one it built before, apart from what
Common Agent 0.30.0-draft renamed.

Usage:
  compare-packages.py --old-builder <dir> [--spec-ref <git ref>] <agent folder>...

For each agent folder it builds three packages and compares them:

  before       the old builder (build.py in --old-builder, with its pinned
               schema and system names beside it) from the agent's spec.json
  from-folder  this builder from the agent's folder (agent-descriptor.json,
               agent-runtime-requirements.json, plugin.json, skills/)
  from-spec    this builder from the same spec.json, the deprecated input

The spec is read from the folder, or, once it is deleted, from git at
--spec-ref (for example the commit before the deletion). It is built from a
scratch copy whose `source` is the agent's folder, so the builder reads the
same files and writes nothing beside them.

What is normalized in `before`, and nothing else:
  - descriptor.json is named agent-descriptor.json; its bytes are unchanged;
  - install.json is named agent-runtime-requirements.json, and its one line
    "format": "agent-install-v1" reads "format": "agent-runtime-requirements-v1";
  - plugin.json's pointer `install` is named `runtime_requirements`, in the
    same place, its path is the new file name and its sha256 is the new
    file's; the descriptor pointer's path is the new file name.
Then every file in the three packages is compared byte for byte, and the
builders' printed results are compared with the paths and the members only
the new builder prints set aside.

Prints one line per agent and a summary, and exits 1 when any agent differs.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
NEW_BUILD = os.path.join(HERE, "build.py")
EXT = "net.agentdoc.package"
OLD_FORMAT_LINE = '"format": "agent-install-v1"'
NEW_FORMAT_LINE = '"format": "agent-runtime-requirements-v1"'
# What only the new builder prints, or prints differently because of the names.
NEW_ONLY = ("path", "input", "warnings", "runtime_requirements_sha256", "install_sha256", "descriptor")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def tree(root):
    files = {}
    for d, _, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            files[os.path.relpath(p, root).replace(os.sep, "/")] = open(p, "rb").read()
    return files


def run_build(builder, src, out_dir):
    env = {k: v for k, v in os.environ.items() if k not in ("DEFAULT_LICENSE", "REQUIRED_CODER", "OFFICIAL_CODER", "PROVENANCE")}
    # The old builder opens a spec in the platform's default encoding, which
    # is UTF-8 on the Linux hosts and CI that build packages and a code page
    # on Windows. UTF-8 mode makes every builder read what those hosts read.
    env["PYTHONUTF8"] = "1"
    p = subprocess.run([sys.executable, builder, src, out_dir], capture_output=True, text=True,
                       encoding="utf-8", env=env, timeout=300)
    try:
        res = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        res = {"ok": False, "error": "no answer: " + (p.stderr or "").strip()[-300:]}
    return res


def normalize_before(files, problems):
    """The old package as the new names would spell it, and nothing else."""
    out = dict(files)
    desc = out.pop("descriptor.json", None)
    inst = out.pop("install.json", None)
    if desc is None or inst is None:
        problems.append("the old package has no descriptor.json or install.json")
        return out
    text = inst.decode("utf-8")
    if text.count(OLD_FORMAT_LINE) != 1:
        problems.append("the old install.json does not say format agent-install-v1 exactly once")
    new_inst = text.replace(OLD_FORMAT_LINE, NEW_FORMAT_LINE, 1).encode("utf-8")
    out["agent-descriptor.json"] = desc
    out["agent-runtime-requirements.json"] = new_inst
    m = json.loads(out["plugin.json"].decode("utf-8"))
    own = m["extensions"][EXT]
    if own.get("install", {}).get("sha256") != sha(inst) or own.get("descriptor", {}).get("sha256") != sha(desc):
        problems.append("the old manifest's digests are not its files' digests")
    renamed = {}
    for k, v in own.items():
        if k == "install":
            renamed["runtime_requirements"] = {"path": "agent-runtime-requirements.json", "sha256": sha(new_inst)}
        elif k == "descriptor":
            renamed["descriptor"] = {**v, "path": "agent-descriptor.json"}
        else:
            renamed[k] = v
    m["extensions"][EXT] = renamed
    out["plugin.json"] = dumps(m).encode("utf-8")
    return out


def compare_trees(a, b, label):
    diffs = []
    for p in sorted(set(a) | set(b)):
        if p not in b:
            diffs.append(f"{label}: {p} is missing")
        elif p not in a:
            diffs.append(f"{label}: {p} is extra")
        elif a[p] != b[p]:
            diffs.append(f"{label}: {p} differs")
    return diffs


def compare_results(before, after, label):
    a = {k: v for k, v in before.items() if k not in NEW_ONLY}
    b = {k: v for k, v in after.items() if k not in NEW_ONLY}
    return [f"{label}: the printed result's {k} differs" for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]


def spec_text(folder, ref):
    p = os.path.join(folder, "spec.json")
    if os.path.isfile(p):
        return open(p, encoding="utf-8").read()
    if not ref:
        return None
    top = subprocess.run(["git", "-C", folder, "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    rel = os.path.relpath(os.path.abspath(p), top).replace(os.sep, "/")
    r = subprocess.run(["git", "-C", top, "show", f"{ref}:{rel}"], capture_output=True, text=True, encoding="utf-8")
    return r.stdout if r.returncode == 0 else None


def gate_one(old_builder, folder, ref):
    text = spec_text(folder, ref)
    if text is None:
        return {"agent": folder, "verdict": "no spec", "diffs": ["no spec.json in the folder or at the ref"]}
    spec = json.loads(text)
    spec.setdefault("source", os.path.abspath(folder))
    work = tempfile.mkdtemp(prefix="gate-")
    try:
        sp = os.path.join(work, "spec.json")
        with open(sp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(spec, f, indent=2, ensure_ascii=False)
        outs = {k: os.path.join(work, k) for k in ("before", "folder", "spec")}
        r_before = run_build(os.path.join(old_builder, "build.py"), sp, outs["before"])
        r_folder = run_build(NEW_BUILD, os.path.abspath(folder), outs["folder"])
        r_spec = run_build(NEW_BUILD, sp, outs["spec"])
        name = spec.get("name")
        diffs, notes = [], []
        for label, r in (("before", r_before), ("from-folder", r_folder), ("from-spec", r_spec)):
            if not r.get("ok"):
                diffs.append(f"{label} did not build: {r.get('error')}")
        if diffs:
            return {"agent": folder, "name": name, "verdict": "differs", "diffs": diffs}
        before = normalize_before(tree(r_before["path"]), diffs)
        for label, r in (("from-folder", r_folder), ("from-spec", r_spec)):
            diffs += compare_trees(before, tree(r["path"]), label)
            diffs += compare_results(r_before, r, label)
            if r_before.get("install_sha256") and r.get("runtime_requirements_sha256") != sha(before["agent-runtime-requirements.json"]):
                diffs.append(f"{label}: the printed runtime requirements digest is not the file's")
        notes = [w for w in r_folder.get("warnings", [])]
        return {"agent": folder, "name": name, "verdict": "identical" if not diffs else "differs",
                "files": len(before), "diffs": diffs, "folder_warnings": notes}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    args = sys.argv[1:]
    old, ref, folders = None, None, []
    i = 0
    while i < len(args):
        if args[i] == "--old-builder":
            old = args[i + 1]
            i += 2
        elif args[i] == "--spec-ref":
            ref = args[i + 1]
            i += 2
        else:
            folders.append(args[i])
            i += 1
    if not old or not folders:
        print("usage: compare-packages.py --old-builder <dir> [--spec-ref <ref>] <agent folder>...", file=sys.stderr)
        sys.exit(2)
    results = [gate_one(old, f, ref) for f in folders]
    for r in results:
        line = f"{r['verdict']:<10} {r.get('name') or '?':<28} {r['agent']}"
        if r.get("files"):
            line += f"  ({r['files']} files)"
        print(line)
        for d in r["diffs"]:
            print(f"    {d}")
        for w in r.get("folder_warnings") or []:
            print(f"    note: {w}")
    same = sum(1 for r in results if r["verdict"] == "identical")
    print(f"{same} of {len(results)} agents build identical packages, apart from the renamed files, pointer and format id")
    sys.exit(0 if same == len(results) else 1)


if __name__ == "__main__":
    main()
