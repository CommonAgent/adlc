#!/usr/bin/env python3
"""The derive-test offering: show the test without running it.

Given a package (the .tar.gz handed to the job), this derives the cases the
conformance check would run against an agent installed from it, with
eval-gen.py, and hands them back as the derived test. Nothing is sent to any
agent and nothing is signed: it is the test, shown.

Without a package, a handle named in the request (name.owner@domain) is read
instead: the Descriptor the registry serves for that agent stands in for the
package's, and its offerings' steps for the package's skills. The reply says
which was read.

Usage: derive-test.py [--job <job folder>] [--prompt <the request's words>]
  The job folder's files are searched for the package; its out/ receives
  derived-test.json, listed in pieces.json, so the reply carries it as a file.
  Prints the reply's words (Markdown).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
EVAL_GEN = next((p for p in ("/opt/fleet/agenteval-gen.py", os.path.join(HERE, "eval-gen.py")) if os.path.exists(p)),
                os.path.join(HERE, "eval-gen.py"))
HANDLE = re.compile(r"\b[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}\b", re.I)
MEDIA = "application/vnd.agentmesh.conformance-test+json"


def api_base():
    v = os.environ.get("MESH_API_BASE")
    if v:
        return v.rstrip("/")
    name = (os.environ.get("AGENTMESH_ENV") or "prod").strip()
    for d in (os.environ.get("AGENTMESH_ENV_DIR"), "/opt/fleet/env", os.path.join(HERE, "..", "..", "env")):
        p = os.path.join(d or "", f"{name}.json")
        if d and os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                return str(json.load(f)["urls"]["api"]).rstrip("/")
    raise RuntimeError(f'no API address for environment "{name}"')


def find_package(job):
    """The first .tar.gz or .tgz among the job's files, or None."""
    if not job or not os.path.isdir(job):
        return None
    for root, _dirs, files in os.walk(job):
        if os.path.relpath(root, job).split(os.sep)[0] == "out":
            continue
        for f in sorted(files):
            if f.endswith((".tar.gz", ".tgz")):
                return os.path.join(root, f)
    return None


def unpack(archive, into):
    """The package folder (the one holding plugin.json) inside the archive."""
    with tarfile.open(archive, "r:gz") as t:
        try:
            t.extractall(into, filter="data")
        except TypeError:  # Python before 3.12: refuse anything but plain files and folders
            for m in t.getmembers():
                if not (m.isfile() or m.isdir()) or m.name.startswith("/") or ".." in m.name.split("/"):
                    raise ValueError(f"the package holds {m.name!r}, which is not a plain file")
            t.extractall(into)
    for root, _dirs, files in os.walk(into):
        if "plugin.json" in files:
            return root
    raise ValueError("the archive holds no plugin.json, so it is not an Agent Package")


def from_registry(handle, into, base=None, fetch=None):
    """A stand-in package folder from the Descriptor the registry serves."""
    fetch = fetch or (lambda url: json.load(urllib.request.urlopen(url, timeout=20)))
    base = base or api_base()
    card = fetch(f"{base}/a/{urllib.parse.quote(handle)}")
    key = card.get("agent_id")
    if not key:
        raise ValueError(f"{handle} is not registered on {base}")
    desc = fetch(f"{base}/v1/agents/{key}/descriptor")
    desc.pop("signatures", None)
    folder = os.path.join(into, "pkg")
    os.makedirs(os.path.join(folder, "skills"))
    with open(os.path.join(folder, "plugin.json"), "w", encoding="utf-8") as f:
        json.dump({"name": handle.split(".")[0]}, f)
    with open(os.path.join(folder, "agent-descriptor.json"), "w", encoding="utf-8") as f:
        json.dump(desc, f)
    for o in desc.get("offerings") or []:
        for s in [o, *(o.get("steps") or [])]:
            sid = str(s.get("id") or "").strip()
            if re.fullmatch(r"[A-Za-z0-9._-]{1,80}", sid):
                os.makedirs(os.path.join(folder, "skills", sid), exist_ok=True)
    return folder, desc.get("agent_version")


def derive(job=None, prompt="", run=subprocess.run, registry=from_registry):
    tmp = tempfile.mkdtemp(prefix="derive-test-")
    try:
        archive = find_package(job)
        if archive:
            folder = unpack(archive, os.path.join(tmp, "unpacked"))
            source = f"the package {os.path.basename(archive)}"
        else:
            m = HANDLE.search(prompt or "")
            if not m:
                return None, ("I derive the test from a package. Attach the agent's package (.tar.gz), "
                              "or name an agent (name.owner@domain) and I will derive it from the Descriptor "
                              "the registry serves for it.")
            folder, version = registry(m.group(0), tmp)
            source = f"the Descriptor the registry serves for {m.group(0)}" + (f" (version {version})" if version else "")
        p = run(["python3", EVAL_GEN, folder], capture_output=True, text=True, timeout=120)
        spec = json.loads(p.stdout)
        if "cases" not in spec:
            raise ValueError(spec.get("error") or "the cases could not be derived")
        spec["derived_from"] = source
        return spec, None
    except Exception as e:  # noqa: BLE001
        return None, f"I could not derive the test: {str(e)[:300]}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def words(spec):
    kinds = {}
    for c in spec["cases"]:
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
    out = [f"## The test for {spec['agent']}", "",
           f"Derived from {spec['derived_from']}. Nothing was sent to the agent; this is the test, shown.", "",
           f"{len(spec['cases'])} cases: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) + ".", ""]
    for c in spec["cases"]:
        out.append(f"- **{c['id']}** ({c['kind']}): {c['source']}. Expect: {c['expect']}.")
    if spec.get("records_required"):
        out += ["", "Records checked after the run:"] + [f"- {r}" for r in spec["records_required"]]
    if spec.get("trials"):
        out += ["", f"Trial cases are added for: {', '.join(spec['trials'])}."]
    return "\n".join(out)


def file_piece(job, spec):
    out_dir = os.path.join(job, "out")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "derived-test.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2)
    with open(os.path.join(job, "pieces.json"), "w", encoding="utf-8") as f:
        json.dump([{"name": "the derived test", "step": "derive-test", "path": "out/derived-test.json",
                    "media_type": MEDIA, "produced_from": ["the package"],
                    "about": "The cases the conformance check would run, each with the declaration it came from. "
                             "Nothing was sent to the agent."}], f, indent=2)


def main(argv):
    job = prompt = None
    i = 0
    while i < len(argv):
        if argv[i] == "--job" and i + 1 < len(argv):
            job = argv[i + 1]
            i += 2
        elif argv[i] == "--prompt" and i + 1 < len(argv):
            prompt = argv[i + 1]
            i += 2
        else:
            i += 1
    if not job and prompt:
        m = re.search(r"^job folder:\s*(\S+)", prompt, re.M)
        job = m.group(1) if m else None
    spec, why = derive(job, prompt or "")
    if not spec:
        print(why)
        return 1
    if job and os.path.isdir(job):
        file_piece(job, spec)
    print(words(spec))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
