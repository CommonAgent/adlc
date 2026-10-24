#!/usr/bin/env python3
"""File a built package as a deploy request with the mesh control plane.

The hand-off half of the create-to-deploy loop: after `agentbuilder pack`,
this uploads the tarball, its sha256, and the signed build record to the
platform's deploy-request queue, where the operator's one click deploys it.
Filing is also what makes the package downloadable: the answer names an id,
and the bytes serve at <control>/deploy-requests/<id>/package.tar.gz, which
is the same URL a requester uses to take the package home and run it on
their own machine.

The filing is signed with the builder's own identity, the same key its
build records carry, over `deploy-request-v1:<key>:<ts>:<sha256>`.

An update may propose its own instruction: the harness model, a credential
NAME per system and non-secret settings, as a JSON file named by DEPLOY_ARGS
({"model": ..., "credentials": {...}, "settings": {...}}). It travels as the
filing's `args`, the platform refuses anything in it that is not a name or a
plain value, and the platform's own approval lays it over the installed
instruction. Without it an approved update keeps the instruction the
installed version had, which is how a model switch once went unrecorded.

Usage: [DEPLOY_ARGS=<args.json>] request.py <name> <identity.json> [requested_by] [note]
Reads ~/dist/<name>.tar.gz and ~/records/<name>-build.json.
Prints one JSON object: {ok, id, package_url} or {ok: false, error}.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
SIGN = next((p for p in (os.path.join(HERE, "agentbuilder-sign.mjs"),
                         os.path.join(HERE, "sign.mjs")) if os.path.exists(p)),
            os.path.join(HERE, "agentbuilder-sign.mjs"))
ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules"
# The AgentMesh environment (env/<AGENTMESH_ENV>.json, default prod): the same
# file and rules as env/load.cjs, read with the standard library because this
# file is copied flat onto the host. Looked for as AGENTMESH_ENV_FILE, in
# AGENTMESH_ENV_DIR, beside this file, in the repository, in /opt/fleet/env or
# /opt/agentmesh/env, then in an env/ above the working directory. `override`
# names the variable that, when set, wins exactly as it did before. A missing
# or null value is an error, never a guess.
def _am_env(key, override=None, suffix=""):
    if override and override in os.environ:
        return os.environ[override]
    name = (os.environ.get("AGENTMESH_ENV") or "prod").strip()
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = [os.environ.get("AGENTMESH_ENV_DIR"), os.path.join(here, "env"),
            os.path.join(here, os.pardir, os.pardir, "env"), "/opt/fleet/env", "/opt/agentmesh/env"]
    d = os.getcwd()
    while True:
        dirs.append(os.path.join(d, "env"))
        if os.path.dirname(d) == d:
            break
        d = os.path.dirname(d)
    files = ([os.environ["AGENTMESH_ENV_FILE"]] if os.environ.get("AGENTMESH_ENV_FILE")
             else [os.path.join(p, name + ".json") for p in dirs if p])
    path = next((f for f in files if os.path.isfile(f)), None)
    if not path:
        raise RuntimeError(f'AgentMesh environment "{name}" not found; looked in {", ".join(files)}')
    with open(path, encoding="utf-8") as f:
        v = json.load(f)
    if not os.environ.get("AGENTMESH_ENV_FILE") and v.get("name") != name:
        raise RuntimeError(f'{path} says it is environment "{v.get("name")}", not "{name}"')
    for part in key.split("."):
        v = v.get(part) if isinstance(v, dict) else None
        if v is None:
            raise RuntimeError(f'{key} is not set for environment "{name}" in {path}')
    return v + suffix


CONTROL = (os.environ.get("MESH_CONTROL_URL") or _am_env("urls.app", suffix="/v1")).rstrip("/")


def out(obj):
    print(json.dumps(obj))
    sys.exit(0 if obj.get("ok") else 1)


PROPOSAL_KEYS = ("model", "credentials", "settings")


def read_proposal(path):
    """The proposed instruction from DEPLOY_ARGS, or None when none is named.

    Only the three members travel, and a credential must be a name: the
    platform checks the rest, and refusing a pasted key here keeps it off the
    wire as well as out of the queue."""
    if not path:
        return None
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if not isinstance(doc, dict):
        raise ValueError("DEPLOY_ARGS must hold one JSON object")
    extra = sorted(k for k in doc if k not in PROPOSAL_KEYS)
    if extra:
        raise ValueError(f"DEPLOY_ARGS may carry model, credentials and settings, not {', '.join(extra)}")
    for role, name in (doc.get("credentials") or {}).items():
        if not isinstance(name, str) or not name or " " in name or len(name) > 64:
            raise ValueError(f"DEPLOY_ARGS credentials.{role} must be a credential name, never a value")
    proposal = {k: doc[k] for k in PROPOSAL_KEYS if doc.get(k)}
    return proposal or None


def main():
    try:
        proposal = read_proposal(os.environ.get("DEPLOY_ARGS", ""))
    except (OSError, ValueError) as e:
        out({"ok": False, "error": str(e)[:300]})
    if len(sys.argv) < 3:
        out({"ok": False, "error": "usage: request.py <name> <identity.json> [requested_by] [note]"})
    name, identity_path = sys.argv[1], sys.argv[2]
    requested_by = sys.argv[3] if len(sys.argv) > 3 else ""
    note = sys.argv[4] if len(sys.argv) > 4 else ""

    tgz = os.path.join(HOME, "dist", f"{name}.tar.gz")
    rec_path = os.path.join(HOME, "records", f"{name}-build.json")
    if not os.path.exists(tgz):
        out({"ok": False, "error": f"no tarball at {tgz} — run `agentbuilder pack` first"})
    record = None
    version = "0.0.0"
    sha256 = None
    if os.path.exists(rec_path):
        record = json.load(open(rec_path))
        version = record.get("package", {}).get("version", version)
        sha256 = record.get("package", {}).get("sha256")
    data = open(tgz, "rb").read()
    import hashlib
    actual = hashlib.sha256(data).hexdigest()
    # The record's hash is the claim the filing makes; bytes that drifted
    # since the pack are refused HERE, not discovered at the server.
    if sha256 and sha256 != actual:
        out({"ok": False, "error": "tarball changed since its build record was signed; re-run pack"})
    sha256 = actual

    identity = json.load(open(identity_path))
    agent = identity.get("public_key", "")
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    message = f"deploy-request-v1:{agent}:{ts}:{sha256}"
    env = dict(os.environ, NODE_PATH=ADAPTER_MODULES)
    p = subprocess.run(["node", SIGN, identity_path], input=message,
                       capture_output=True, text=True, timeout=30, env=env)
    sig = p.stdout.strip()
    if p.returncode != 0 or not sig:
        out({"ok": False, "error": "could not sign the filing with the builder identity"})

    body = {
        "agent": agent, "ts": ts, "sig": sig,
        "package": {"name": name, "version": version, "sha256": sha256},
        "tarball_b64": base64.b64encode(data).decode("ascii"),
    }
    if record is not None:
        body["build_record"] = record
    if requested_by:
        body["requested_by"] = requested_by
    if note:
        body["note"] = note
    if proposal:
        body["args"] = proposal

    req = urllib.request.Request(
        f"{CONTROL}/deploy-requests",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            answer = json.load(r)
    except urllib.error.HTTPError as e:  # noqa: PERF203
        try:
            answer = json.load(e)
        except Exception:  # noqa: BLE001
            answer = {"error": f"HTTP {e.code}"}
        out({"ok": False, "error": answer.get("error", f"HTTP {e.code}")})
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": str(e)[:300]})

    rid = answer.get("id")
    out({"ok": True, "id": rid, **({"proposed": proposal} if proposal else {}),
         "package_url": f"{CONTROL}/deploy-requests/{rid}/package.tar.gz",
         "note": "Filed. The operator decides; the package URL above is also the take-home download."})


if __name__ == "__main__":
    main()
