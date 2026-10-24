#!/usr/bin/env python3
"""The runtime record: where an agent's WORK runs, as the deploy observed it.

WHY THIS EXISTS AND WHY AN ADDRESS IS NOT THE ANSWER. The control plane's
only notion of an agent's location is the address its adapter last checked in
from. That address answers a question nobody asked once the work moved: the
adapter is the long-lived side, it holds the identity and drains the mailbox,
and it stays on this host whether the work runs here or in a fresh container
per message. An ephemeral worker checks in from nowhere, holds no inbox
subscription and is matched by nothing, so an owner asking where their agent
runs was shown either silence or this host, and this host is not where the
work happened.

The facts were never missing. The container procedure computes the job, the
region, the project, the image and its digest, the mount, the directories and
the cap on one job, and writes them to deploymgr-containers.json, where they
stay. This module is that same act's statement, in the shape the owner's page
can read, so that nothing here is a second source of truth: the entry the
procedure already saved is the input, and this only says it.

TWO SIDES, NAMED SEPARATELY, BECAUSE THEY ARE TWO MACHINES. Every record
carries `adapter` and `work`. `adapter.host` is the machine holding the key
and the inbox. `work.runs` is `host` when the work runs on that same machine
and `container` when each message gets a container somewhere else. Collapsing
them into one "where it runs" is the confusion this record exists to end, and
a reader that takes `adapter.host` for the place the work happened has been
misled by the shape rather than by the words.

AN ABSENT MEMBER IS A STATEMENT (Common Agent Specification 8.3), the same
reading record.py makes: it means this producer did not observe the thing. So
a host runtime record carries no `image_digest` and no job cap it was never
given, rather than nulls or zeroes that a reader would take for observations.

Signed by the deployment manager's own identity, with the same signer and the
same convention every other record here uses: the ASCII tag, one newline, the
canonical JSON of the document with `signatures` removed. A signature failure
yields a faithful unsigned record rather than no record, which is the choice
record.py already made and for the same reason.
"""
import json
import os
import urllib.error
import urllib.request

TAG = "agent-runtime-record-v1"

# Where the control plane is, and how long to wait. The deploy is the caller,
# so the wait is short: a record that fails to post is on disk and the next
# deploy or an explicit republish sends it, and a slow control plane must never
# be able to hold a deploy open.
POST_TIMEOUT = 20


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


def canonical(obj):
    """RFC 8785 subset, identical to record.py's: sorted keys, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _clean(mapping):
    """A mapping with its empty members dropped. Used on every sub-object, so
    an absent fact leaves the member out rather than emitting an empty string
    that reads as an observation of nothing."""
    return {k: v for k, v in mapping.items() if v not in (None, "", {}, [])}


def container_work(entry):
    """What a container entry says about where the work runs.

    Everything comes off the entry the container procedure saved. `image` is
    reported beside `image_digest` rather than instead of it: the tag says
    which image a person would go and look at, and the digest says what was
    actually started, and a tag can be moved afterwards while a digest cannot.
    """
    storage = _clean({
        "bucket": entry.get("bucket"),
        # The container's side of the mount only. Where THIS host mounts a
        # bucket is a fact about this machine and not about the deploy.
        "mount": entry.get("mount"),
        "directories": entry.get("directories") or {},
    })
    # What the platform will actually give one execution, read back off the
    # job rather than taken from what the deploy asked for: a deploy refused a
    # cpu quota would otherwise report the machine it wanted. The row carries
    # these only once something has read the job back (report-jobs.mjs), so an
    # older row simply has none and the record says nothing.
    limits = _clean({
        "cpu": entry.get("cpu"),
        "memory": entry.get("memory"),
        # The platform's own kill, which is NOT job_seconds: that is the cap
        # the agent's attendant enforces, and the hard kill trails it.
        "timeout_seconds": entry.get("timeout_seconds"),
        # Zero is a setting and must survive _clean, which drops empties.
        "max_retries": entry.get("max_retries"),
    })
    if entry.get("max_retries") == 0:
        limits["max_retries"] = 0
    return _clean({
        "runs": "container",
        "limits": limits,
        # The platform running the container, in its own name. Not a guess
        # from the region or the job: the entry says cloud-run because that is
        # the procedure that created it.
        "platform": entry.get("runs_on"),
        "job": entry.get("job"),
        "region": entry.get("region"),
        "project": entry.get("project"),
        "image": entry.get("image"),
        "image_digest": entry.get("image_digest"),
        "storage": storage,
    })


def host_work(entry, host):
    """What a host entry says about where the work runs: on the adapter's own
    machine, in the harness the install placed there. There is no image and no
    job, so the record carries neither."""
    return _clean({"runs": "host", "host": host})


def build(entry, *, agent, adapter_host, produced_at, by, kind=None):
    """The unsigned runtime record for one agent.

    `entry` is the inventory row the deploy already saved, a container row or
    a host row; `kind` forces which, and is otherwise read off the row the way
    the roster reads it, by `runs_on`. `agent` carries the key, the handle and
    the install name: the key is what the control plane files this under, and
    a record without one cannot be filed at all, because there is no subject
    to attach it to.
    """
    key = (agent or {}).get("key") or ""
    if not key:
        raise ValueError("a runtime record needs the agent's key; there is nothing to file it under")
    kind = kind or ("container" if entry.get("runs_on") else "host")
    work = container_work(entry) if kind == "container" else host_work(entry, adapter_host)
    doc = {
        "record": "v1",
        "role": "deployment-manager",
        "act": "runtime",
        "agent": _clean({"key": key, "handle": (agent or {}).get("handle"),
                         "name": (agent or {}).get("name") or entry.get("name")}),
        # The machine that holds the key and drains the inbox. Always stated,
        # on both kinds, because the whole point of the record is that a reader
        # can tell this apart from where the work ran.
        "adapter": _clean({"host": adapter_host}),
        "work": work,
        "produced_at": produced_at,
        "by": by,
        "signatures": [],
    }
    # The cap on one job, in seconds, where the deploy set one. A host install
    # records it only when the package asked for one; a container deploy always
    # has a number, because a job is created with one either way.
    seconds = entry.get("job_seconds")
    if isinstance(seconds, int) and not isinstance(seconds, bool) and seconds > 0:
        doc["job_seconds"] = seconds
    package = _clean({"name": entry.get("package"), "version": entry.get("version"),
                      "sha256": entry.get("sha256")})
    if package:
        doc["package"] = package
    # The harness and the model where there is one to name. A package that
    # names a command for every job wakes no model, so both are absent and the
    # owner's page says the work runs a program rather than that it thinks.
    for member in ("harness", "model", "environment", "interaction", "deployed_at"):
        if entry.get(member):
            doc[member] = entry[member]
    # The model the job was read to carry (steps.placed_model, technical debt
    # 456) is the one it runs with, so it is what the record names: a script
    # package that reads a model from its own variable has no harness model,
    # and a job can keep a model nobody asked for in this deploy.
    placed = entry.get("model_placed")
    if isinstance(placed, dict) and isinstance(placed.get("model"), str) and placed["model"]:
        doc["model"] = placed["model"]
    # Whether this deploy is the one still standing. The container procedure
    # writes "running" and leaves a removed or failed deploy in the file with
    # its own word, and a reader that ignored it would report a dead job as the
    # place the work happens.
    if entry.get("state"):
        doc["state"] = entry["state"]
    return doc


def which_entry(name, containers, hosts):
    """Which inventory is the authority for where this agent's work runs.

    A container deploy wins while it stands. The host install of the same name
    still exists and is still the agent: it holds the key, the handle and the
    inbox. But the work happens in the job, and reading the host row would put
    the wrong machine on the owner's page for precisely the agents this record
    was built for.

    A container entry that is not running loses. The container procedure leaves
    a removed or failed deploy in its file with its own state, and treating one
    of those as the place the work happens would send somebody to a job that no
    longer exists. When it loses and a host install remains, the answer is the
    host: an agent whose container was torn down runs on this machine again.

    Returns (kind, entry), or (None, None) where neither inventory has it.
    """
    for e in containers or []:
        if e.get("name") == name and (e.get("state") or "running") == "running":
            return "container", e
    for a in hosts or []:
        if a.get("name") == name:
            return "host", a
    return None, None


def message(doc):
    """The exact bytes the deployment manager signs: the tag, one newline, the
    canonical document without its signatures."""
    return TAG + "\n" + canonical({k: v for k, v in doc.items() if k != "signatures"})


def signed(doc, sig, by):
    """The document with the signature attached, or with a plain note saying
    why it has none. An unsigned record is faithful and says so; a missing
    record says nothing at all, which is worse."""
    out = dict(doc)
    if sig:
        out["signatures"] = [{"tag": TAG, "by": by, "sig": sig, "alg": "ed25519"}]
    else:
        out["signatures"] = []
        out["_unsigned"] = "record is faithful but unsigned"
    return out


def post(body, control, bearer, timeout=POST_TIMEOUT):
    """Send one body to the control plane's runtime door.

    Returns (ok, why). Never raises: the caller is a deploy procedure, and a
    control plane that is slow, down or unconfigured must not be able to turn
    a finished deploy into a refusal. The record is on disk before this is
    called, so a failure here costs the freshness of a page and nothing else.
    """
    if not bearer:
        return False, "no control-plane bearer on this host, so nothing was posted"
    url = (control or _am_env("urls.app", suffix="/v1")).rstrip("/") + "/agent-runtime"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json", "authorization": f"Bearer {bearer}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300, ""
    except urllib.error.HTTPError as e:
        return False, f"the control plane answered {e.code}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:200]


def publish(doc, control, bearer, timeout=POST_TIMEOUT):
    """File one runtime record."""
    return post({"record": doc}, control, bearer, timeout)


def retract(agent_key, control, bearer, timeout=POST_TIMEOUT, removed=False):
    """Withdraw the record for an agent that was removed. The agent may still
    exist elsewhere, so this says only that this deployment manager no longer
    runs its work, which is the one thing it observed. `removed` says the
    install itself was taken off this host (its home and its job records went
    with it), so the platform can refuse a change to its old jobs in words."""
    body = {"agent": agent_key, "retracted": True}
    if removed:
        body["removed"] = True
    return post(body, control, bearer, timeout)
