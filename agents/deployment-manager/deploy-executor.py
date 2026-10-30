#!/usr/bin/env python3
"""The deploy-request executor: approved requests in, running agents out.

Runs on the fleet host as root (pm2, beside pafd). Every POLL_SECONDS it
asks the control plane for approved deploy requests; for each one it places
the minted boot token in the fleet secret store, writes the argfile under
the deployment manager's own tmp, runs the deployment manager's fixed
procedure (deploymgr-steps.py), signs the deployment record with the
deployment manager's identity (deploymgr-record.py), and posts the outcome
back. The approver's click IS the owner instruction the deploymgr doctrine
requires; this loop only carries it out, and a step the procedure refuses
is a step this loop does not take another way.

Nothing here is a standing deploy policy: with no approved requests the
loop does nothing, and an unset bearer token means it cannot even ask.

Each request runs once. Its outcome is kept on disk (OUTCOMES) before it is
posted, and a request the queue hands back because its result never landed
is answered with the kept outcome rather than run again.

Between polls it also tells the control plane what this host has: the
credential NAMES in the deployment manager's store, the non-secret settings
recorded beside each (<name>.settings.json), and which programs and
runtimes are present. Never a value. The approver's page uses it to say
"set up" and to fill in settings before the click, instead of the installer
refusing after it.

After a deploy or an update that worked, it starts the Conformance Checker on
the agent it put in place (conform, below), and `backfill` gives an agent that
already runs its deployment record and verdict without redeploying it.

Requests are served oldest approval first (decided_at). By default each one
runs whole before the next starts; DM_INSTALL_WORKERS and DM_LAND_BATCH let
installs run side by side and land on the platform node in batches (see
"installs side by side" below).

Env: MESH_CONTROL_URL (default the environment's urls.app + /v1, env/prod.json),
MESH_DEPLOY_EXECUTOR_TOKEN_FILE (one line, the bearer), POLL_SECONDS (60),
DM_CONFORMANCE (on/off; default on everywhere but prod), DM_INSTALL_WORKERS (1),
DM_LAND_BATCH (off), DM_LAND_BATCH_SECONDS (60), DM_LAND_BATCH_MOST (5).
"""
import calendar
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

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
    name, path, v = _am_env_file()
    for part in key.split("."):
        v = v.get(part) if isinstance(v, dict) else None
        if v is None:
            raise RuntimeError(f'{key} is not set for environment "{name}" in {path}')
    return v + suffix


def _am_env_section(key):
    """A value an environment may leave out (audit_gate): None when the file
    has no such path, or when no environment file can be found."""
    try:
        _name, _path, v = _am_env_file()
    except RuntimeError:
        return None
    for part in key.split("."):
        v = v.get(part) if isinstance(v, dict) else None
    return v


def _am_env_file():
    name = (os.environ.get("AGENTMESH_ENV") or "prod").strip()
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = [os.environ.get("AGENTMESH_ENV_DIR"), os.path.join(here, "env"),
            os.path.join(here, os.pardir, "env"), "/opt/fleet/env", "/opt/agentmesh/env"]
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
    return name, path, v


CONTROL = (os.environ.get("MESH_CONTROL_URL") or _am_env("urls.app", suffix="/v1")).rstrip("/")
POLL = max(30, int(os.environ.get("POLL_SECONDS") or 60))
TOKEN_FILE = os.environ.get("MESH_DEPLOY_EXECUTOR_TOKEN_FILE") or "/opt/fleet/secrets/deploy-executor.token"
FLEET = "/opt/fleet"
STEPS = f"{FLEET}/deploymgr-steps.py"
# Longer than the procedure it waits on can possibly take. A deploy now builds
# a container image before it returns, and the procedure waits DM_BUILD_MINUTES
# for that build; read from the same variable so the two cannot drift apart.
# The spare quarter hour is the host install, the job creation and the smoke
# check on either side of the build. A timeout shorter than the procedure is
# the worst kind: the executor reports a failure while the deploy carries on
# and finishes, and the two records then disagree about what happened.
# Plus the longest a deploy may wait for the host's node lock before it starts
# (deploymgr-steps.py NODE_LOCK_SECONDS, read from the same variable with the
# same default; keep the two in step), so a deploy that waited its full turn
# still has the build and the 900 seconds of smoke and watch after it.
DEPLOY_TIMEOUT = (int(os.environ.get("DM_BUILD_MINUTES", "40")) * 60 + 900
                  + int(os.environ.get("DM_NODE_LOCK_SECONDS", "600")))

# ── installs side by side, and landings in batches ────────────────────────
#
# Until these are set, each approved request runs whole, one after another,
# exactly as before (serial_mode). Set, the parts of a host package install
# that do not touch the platform node run side by side, and the node step is
# done for several agents behind one restart of their node (Installs, below).
#
#   DM_INSTALL_WORKERS     how many requests may be working at once on the
#                          parts that do not touch the node: checking and
#                          fetching the package, building the image, placing
#                          the Cloud Run job. Default 1.
#   DM_LAND_BATCH          on: installs that are ready to land wait for others
#                          and land together. Default off.
#   DM_LAND_BATCH_SECONDS  how long the first ready install waits for others
#                          while more are still being prepared. Default 60.
#   DM_LAND_BATCH_MOST     the most agents in one landing. Default 5.
#
# DM_INSTALL_WORKERS=1 with DM_LAND_BATCH off is today's behaviour, and the
# default.
INSTALL_WORKERS = max(1, int(os.environ.get("DM_INSTALL_WORKERS") or 1))
LAND_BATCH = (os.environ.get("DM_LAND_BATCH") or "off").strip().lower() in ("on", "1", "true", "yes")
LAND_BATCH_SECONDS = max(0, int(os.environ.get("DM_LAND_BATCH_SECONDS") or 60))
LAND_BATCH_MOST = max(1, int(os.environ.get("DM_LAND_BATCH_MOST") or 5))
# The longest a landing of n agents may take: the wait for the node lock, then
# for each agent its placement (deploymgr-steps.py PLACE_SECONDS, 900) and its
# smoke check and probe, then the full watch and a recovery. Generous, because
# a landing killed half way leaves agents placed and unwatched.
LAND_PER_AGENT_SECONDS = 900 + 600


def land_timeout(n):
    return int(os.environ.get("DM_NODE_LOCK_SECONDS", "600")) + n * LAND_PER_AGENT_SECONDS + 1200


def serial_mode():
    return INSTALL_WORKERS <= 1 and not LAND_BATCH


RECORD = f"{FLEET}/deploymgr-record.py"
# The acts of the host procedure that end in a signed deployment record when
# they succeed. A refusal is recorded too, whatever act it stopped.
RECORDED_ACTS = ("deploy", "update")
DM_HOME = "/home/deploymgr"
DM_TOKENS = f"{DM_HOME}/secrets/boot-tokens"
DM_IDENTITY = f"{DM_HOME}/.agentmesh/adapter/identity.json"
DM_RECORDS = f"{DM_HOME}/records"
DM_CREDENTIALS = f"{DM_HOME}/secrets/credentials"
# Programs a package may name in its install file. Reported when present.
BINARIES = ("chromium", "chromium-browser", "google-chrome", "node", "python3", "ffmpeg", "ffprobe", "yt-dlp", "git", "pandoc", "agentmesh", "mesh-adapter")
# pm2 runs this script with a node IPC channel in its environment
# (NODE_CHANNEL_FD). A node spawned by anything below inherits it, finds no
# such channel and aborts after doing its work, which is how every record and
# descriptor signed through this executor came out unsigned (signer exit -6).
# The channel is pm2's business with this process alone; children never get it.
for _k in ("NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"):
    os.environ.pop(_k, None)

REPORT_EVERY = 600

# 2026-09-25: what each request this executor ran came to, by request id. A
# request stays approved until its result lands, so when the result post was
# refused (a 429 from the platform's rate limiter, on the day this was written)
# the next poll handed the same request back and it ran a second time, as an
# update of the name the first run had bound, which could only refuse. With the
# outcome kept here, a request the queue hands back is answered with what it
# already came to and is never run again. The platform approves a request id
# once and only from waiting, so a kept outcome is always the answer for its id.
OUTCOMES = f"{DM_HOME}/executor-outcomes.json"
OUTCOME_KEEP = 24 * 3600
# The answers that mean "not now". Anything else, including a dropped
# connection, is left to the next poll, which can see whether the post landed:
# a request that is no longer in the queue did.
RESULT_RETRY_CODES = (429, 502, 503)
RESULT_TRIES = 3
RESULT_BACKOFF = (5, 15)
RESULT_WAIT_CAP = 60


def bearer():
    try:
        return open(TOKEN_FILE).read().strip()
    except OSError:
        return ""


PLACEMENT_FILE = f"{FLEET}/deploymgr-placement.json"
# The four host facts a placed deploy needs: where images are published, which
# bucket a job mounts, and the project and region the job lives in. They are
# host configuration, not an owner's instruction, so they live in a file on
# this host rather than in the approved request. Only these four are read: a
# placement file is not a way to smuggle anything else into an argfile.
PLACEMENT_KEYS = ("registry", "bucket", "project", "region")


def placement_settings():
    """This host's placement facts, file first and environment second. An
    absent or unreadable file is not an error here: the deploy procedure
    refuses with its own sentence naming exactly which one is missing, and
    that sentence is more use to an operator than anything this could say."""
    out = {}
    try:
        with open(PLACEMENT_FILE, encoding="utf-8") as f:
            doc = json.load(f)
        if isinstance(doc, dict):
            out = {k: doc[k] for k in PLACEMENT_KEYS
                   if isinstance(doc.get(k), str) and doc[k]}
    except (OSError, ValueError):
        pass
    for k in PLACEMENT_KEYS:
        v = os.environ.get(f"DM_{k.upper()}")
        if k not in out and v:
            out[k] = v
    return out


def call(path, method="GET", body=None, timeout=30):
    req = urllib.request.Request(
        f"{CONTROL}{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"content-type": "application/json", "authorization": f"Bearer {bearer()}"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def host_report():
    """What this host has, by name. Credentials are the <name>.secret files
    in the store, named only; a <name>.settings.json beside one carries the
    non-secret settings the credential was placed with (a bucket, a prefix,
    an address), which the approver's page fills in for the owner."""
    creds, settings = [], {}
    try:
        for fn in sorted(os.listdir(DM_CREDENTIALS)):
            if fn.endswith(".secret"):
                creds.append(fn[:-7])
            elif fn.endswith(".settings.json"):
                try:
                    doc = json.load(open(os.path.join(DM_CREDENTIALS, fn), encoding="utf-8"))
                    if isinstance(doc, dict):
                        settings[fn[:-14]] = {k: str(v) for k, v in doc.items() if isinstance(k, str) and isinstance(v, (str, int, float))}
                except (OSError, ValueError):
                    pass
    except OSError:
        pass
    binaries = {b: path for b in BINARIES if (path := shutil.which(b))}
    runtimes = {}
    for name, argv in (("node", ["node", "--version"]), ("python3", ["python3", "--version"])):
        try:
            out = subprocess.run(argv, capture_output=True, text=True, timeout=10).stdout.strip()
            if out:
                runtimes[name] = out.split()[-1].lstrip("v")
        except (OSError, subprocess.SubprocessError):
            pass
    report = {"host": socket.gethostname(), "credentials": creds, "settings": settings, "binaries": binaries, "runtimes": runtimes}
    # How full each node and the host are, by the install guard's own survey
    # (deploymgr/guard.mjs), so will-it-install can ask the question deploymgr
    # asks again before it places anything. Sizes and counts only: the survey
    # measures each node's credential and never carries it.
    try:
        p = subprocess.run(["node", GUARD, "survey"], capture_output=True, text=True, timeout=90)
        survey = json.loads((p.stdout or "").strip().splitlines()[-1])
        if isinstance(survey, dict) and isinstance(survey.get("nodes"), list):
            report["capacity"] = survey
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        pass
    return report


GUARD = f"{FLEET}/deploymgr-guard.mjs"


SERVICE = f"{FLEET}/deploymgr-service.mjs"


def run_container(r):
    """A container agent from a repository (docs/container-agents-plan.md):
    no package, no unix user, no host install. The deployment manager's
    container path builds the folder's own Dockerfile in Cloud Build at the
    pinned commit, makes the agent's key into its own secret, runs it as a
    Cloud Run service that sleeps until the platform wakes it (always on only
    when the owner said so) and binds its name. It signs
    its own build and deployment records, which come back in its answer."""
    rid = r["id"]
    args = r.get("args") or {}
    c = r.get("container") or {}
    token = r.get("boot_token") or ""
    token_name = r.get("boot_token_name") or f"dr-{rid[3:15].lower()}"
    if not (args.get("name") and c.get("source") and c.get("handle")):
        return {"ok": False, "error": "request is missing its container shape"}
    token_path = None
    if token:
        os.makedirs(DM_TOKENS, exist_ok=True)
        token_path = f"{DM_TOKENS}/{token_name}.token"
        with open(token_path, "w") as f:
            f.write(token)
        os.chmod(token_path, 0o600)
    os.makedirs(f"{DM_HOME}/tmp", exist_ok=True)
    argfile = f"{DM_HOME}/tmp/{token_name}.json"
    arg = {
        "name": args["name"], "handle": c["handle"], "request_id": rid,
        "source": c["source"], "kind": c.get("kind"),
        "settings": c.get("settings") or {}, "secrets": c.get("secrets") or {},
        "claims": c.get("claims") or [],
        "instructed_by": r.get("decided_by") or "the owner",
    }
    # tenant: set by the platform when a user's agent is filed. The deployment
    # manager then places it in the tenant project from its own settings and
    # ignores the placement below (docs/tenant-isolation-plan.md).
    # always_on: the owner's exception to wake on message; wake_idle_seconds:
    # how long a woken agent stays up (docs/container-agents-plan.md, "Wake on
    # message").
    for k in ("cpu", "memory", "replaces", "ready_line", "port", "tenant", "always_on", "wake_idle_seconds"):
        if c.get(k) is not None:
            arg[k] = c[k]
    if token:
        arg["boot_token"] = token_name
    for k, v in placement_settings().items():
        if k in ("project", "region", "registry"):
            arg.setdefault(k, v)
    with open(argfile, "w") as f:
        json.dump(arg, f)
    print(f"[deploy-executor] {rid}: container {'update' if args.get('update') else 'install'} of {args['name']} ({c['handle']})", flush=True)
    try:
        p = subprocess.run(["node", SERVICE, "install", argfile], capture_output=True, text=True, timeout=DEPLOY_TIMEOUT)
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()]
        result = json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[-400:]}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)[:400]}
    finally:
        if token_path:
            try:
                os.remove(token_path)
            except OSError:
                pass
    record = result.pop("record", None)
    return {"ok": bool(result.get("ok")), "result": result, **({"record": record} if record else {})}


def run_tenant_package(r):
    """A person's own package (Prompt to prod phase 3, technical debt 95): it
    runs only in the tenant project, so it goes to the container path's
    install-package and never to the host procedure, which places packages in
    the platform's project and refuses one that names a tenant. The tenant is
    the one the platform set at filing; the handle is the agent's name under
    the account it is installed for."""
    rid = r["id"]
    args = r.get("args") or {}
    token = r.get("boot_token") or ""
    token_name = r.get("boot_token_name") or f"dr-{rid[3:15].lower()}"
    owner = r.get("owner") or {}
    email = owner.get("name") if owner.get("kind") == "account" else r.get("requested_by")
    if not (token and args.get("name") and r.get("package_url") and r.get("tenant") and email):
        return {"ok": False, "error": "request is missing its deploy shape, its tenant or its boot token"}
    os.makedirs(DM_TOKENS, exist_ok=True)
    token_path = f"{DM_TOKENS}/{token_name}.token"
    with open(token_path, "w") as f:
        f.write(token)
    os.chmod(token_path, 0o600)
    os.makedirs(f"{DM_HOME}/tmp", exist_ok=True)
    argfile = f"{DM_HOME}/tmp/{token_name}.json"
    arg = {
        "name": args["name"], "handle": f"{args['name']}.{str(email).strip().lower()}", "request_id": rid,
        "package_url": r["package_url"], "sha256": (r.get("package") or {}).get("sha256") or "",
        "boot_token": token_name, "interaction": args.get("interaction", "service"),
        "admit": args.get("admit", []), "tenant": r["tenant"],
        "instructed_by": r.get("decided_by") or "the owner",
    }
    with open(argfile, "w") as f:
        json.dump(arg, f)
    print(f"[deploy-executor] {rid}: a person's own package {args['name']} into the tenant project ({r['tenant']})", flush=True)
    try:
        p = subprocess.run(["node", SERVICE, "install-package", argfile], capture_output=True, text=True, timeout=DEPLOY_TIMEOUT)
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()]
        result = json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[-400:]}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)[:400]}
    finally:
        try:
            os.remove(token_path)
        except OSError:
            pass
    record = result.pop("record", None)
    return {"ok": bool(result.get("ok")), "result": result, **({"record": record} if record else {})}


def run_version_act(r):
    """A version kept alongside the current one, or one taken out (run configs
    phase 3, docs/run-config-plan.md). Neither mints a subject, so neither
    places a boot token. `alongside` runs the procedure of that name with the
    instruction the platform approved for THAT version (credentials and
    settings by name, as an update's); `retire` runs retire-version with the
    agent's name and the version. The queue hands these only to an executor
    that says it accepts `versions`, so an older executor never reads one as
    an update."""
    rid = r["id"]
    args = r.get("args") or {}
    name = args.get("name") or ""
    if not name:
        return {"ok": False, "error": "request names no agent"}
    os.makedirs(f"{DM_HOME}/tmp", exist_ok=True)
    argfile = f"{DM_HOME}/tmp/{'retire' if r.get('retire') else 'alongside'}-{rid[3:15].lower()}.json"
    if r.get("retire"):
        verb = "retire-version"
        arg = {"name": name, "version": str((r.get("retire") or {}).get("version") or (r.get("package") or {}).get("version") or "")}
    else:
        verb = "alongside"
        arg = {"name": name, "package_url": r.get("package_url") or ""}
        sha = (r.get("package") or {}).get("sha256")
        if isinstance(sha, str) and sha:
            arg["sha256"] = sha
        if args.get("model"):
            arg["model"] = args["model"]
        if args.get("environment"):
            arg["environment"] = args["environment"]
        for k in ("credentials", "settings", "addresses", "ceilings"):
            if isinstance(args.get(k), dict):
                arg[k] = args[k]
        for k, v in placement_settings().items():
            arg.setdefault(k, v)
    with open(argfile, "w") as f:
        json.dump(arg, f)
    print(f"[deploy-executor] {rid}: {verb} of {name} {arg.get('version') or (r.get('package') or {}).get('version')}", flush=True)
    try:
        p = subprocess.run(["python3", STEPS, verb, argfile], capture_output=True, text=True, timeout=DEPLOY_TIMEOUT)
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()]
        result = json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[:400]}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)[:400]}
    finally:
        try:
            os.remove(argfile)
        except OSError:
            pass
    record = None
    if result.get("act") in ("alongside", "retire-version") or (not result.get("ok") and result.get("step")):
        for attempt in (1, 2):
            try:
                rp = subprocess.run(["python3", RECORD, DM_IDENTITY],
                                    input=json.dumps(result), capture_output=True, text=True, timeout=180)
                if rp.returncode == 0 and rp.stdout.strip():
                    record = json.loads(rp.stdout)
                    if record.get("signatures"):
                        break
            except Exception as e:  # noqa: BLE001
                print(f"[deploy-executor] record step failed (attempt {attempt}): {e}", flush=True)
            time.sleep(5)
        if record is not None:
            os.makedirs(DM_RECORDS, exist_ok=True)
            with open(f"{DM_RECORDS}/{name}-{record.get('act', verb)}-{rid[3:15].lower()}.json", "w") as f:
                json.dump(record, f, indent=2)
    return {"ok": bool(result.get("ok")), "result": result, **({"record": record} if record else {})}


# ── the audit gate (lifecycle plan item 4c) ──────────────────────────────
#
# The deployment manager installs a package only with a current audit pass for
# that exact package digest, where this environment requires one: env/<name>
# .json audit_gate.required (prod), its switch variable (AUDIT_GATE) set to on,
# or the control plane's word on the request (`audit_gate.required`), which it
# gives when its own gate is on. The control plane checked the pass before it
# queued the request; this checks it again, itself, from the signed report's
# own bytes, because this is the one agent that changes the live world.
#
# The audit is the platform's (item 4b, GATE-READ.md): GET /v1/audits/<digest>
# names the newest report, GET /v1/audit-reports/<report digest> serves its
# exact bytes. Those bytes must hash to the report digest, be for this package
# digest, be signed (ed25519, the tag below, the report without its
# signature: line) by an auditor key this environment pins, say pass or
# pass_with_findings, and not have expired. Container agents from a repository
# have no package digest and are not covered; retiring a version installs
# nothing and is not asked.

AUDIT_REPORT_TAG = "agent-audit-report-v1\n"
PASSING_VERDICTS = ("pass", "pass_with_findings")
VERIFY_JS = f"{FLEET}/deploymgr-sign.mjs"
ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules"
_KEY_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")


def _is_user_key(k):
    return isinstance(k, str) and len(k) == 56 and k[0] == "U" and set(k[1:]) <= _KEY_CHARS


def audit_gate_for(r):
    """(required, why, auditor keys) for this request. Only turns the gate on:
    nothing on a request turns off what the environment requires."""
    s = _am_env_section("audit_gate")
    s = s if isinstance(s, dict) else {}
    stamp = r.get("audit_gate") if isinstance(r.get("audit_gate"), dict) else {}
    switch = s.get("switch") if isinstance(s.get("switch"), str) and s.get("switch") else "AUDIT_GATE"
    if s.get("required") is True:
        required, why = True, "this environment requires a current audit pass"
    elif str(os.environ.get(switch, "")).strip().lower() in ("on", "1", "true"):
        required, why = True, f"{switch} is on here"
    elif stamp.get("required") is True:
        required, why = True, "the control plane's gate is on for this request"
    else:
        required, why = False, "no audit pass is required here"
    keys = [k for k in (s.get("auditor_keys") or []) if _is_user_key(k)]
    if not keys:
        # The environment file on a fleet host is placed by hand and may not
        # name the auditor yet; the keys the control plane pins then stand.
        keys = [k for k in (stamp.get("auditor_keys") or []) if _is_user_key(k)]
    return required, why, keys


def normal_digest(d):
    s = str(d or "").strip().lower()
    h = s[7:] if s.startswith("sha256:") else s
    return f"sha256:{h}" if len(h) == 64 and all(c in "0123456789abcdef" for c in h) else None


def front_matter(text):
    """The report's YAML header as {key: value}, or None when it has none."""
    lines = text.split("\n")
    if not lines or lines[0].rstrip("\r") != "---":
        return None
    out = {}
    for line in lines[1:]:
        line = line.rstrip("\r")
        if line == "---":
            return out
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        if k and k.replace("_", "").isalpha() and k.islower():
            out[k] = v
    return None


def signed_text(text):
    """The report without its signature: line, as the auditor signed it."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.startswith("signature:"):
            return "\n".join(lines[:i] + lines[i + 1:])
    return text


def signature_verifies(key, message, sig):
    """Ed25519 under an nkey, through the deployment manager's own signer
    (sign.mjs --verify) and the adapter's nkeys.js, as record.py signs."""
    try:
        env = {k: v for k, v in os.environ.items() if not k.startswith("NODE_CHANNEL")}
        env["NODE_PATH"] = ADAPTER_MODULES
        p = subprocess.run(["node", VERIFY_JS, "--verify", key, sig], input=message,
                           capture_output=True, text=True, timeout=60, env=env)
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def fetch_text(path, timeout=30):
    req = urllib.request.Request(f"{CONTROL}{path}", headers={"accept": "text/markdown"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def _epoch(iso):
    """Seconds since the epoch for an ISO-8601 UTC time, or None."""
    try:
        return calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return None


def judge_report_text(text, digest, keys, now):
    """None when the report's own bytes are a current pass for the digest;
    otherwise what is missing."""
    h = front_matter(text)
    if h is None:
        return "the audit report has no readable header"
    if h.get("audit_report") != "v1":
        return "the audit report is not audit_report: v1"
    if normal_digest(h.get("package_digest")) != digest:
        return f"the audit report is for {h.get('package_digest')}, not this digest"
    if not keys:
        return "this environment pins no auditor key, so no audit can be accepted"
    if h.get("signed_by") not in keys:
        return f"the audit is signed_by {h.get('signed_by')}, which is not the auditor key this environment pins"
    if h.get("verdict") not in PASSING_VERDICTS:
        return f"the newest audit is {h.get('verdict')}"
    expires = _epoch(h.get("expires_at", ""))
    if expires is None:
        return f"the audit report's expires_at \"{h.get('expires_at')}\" is not a time"
    if expires <= now:
        return f"the audit pass expired at {h.get('expires_at')}"
    if not signature_verifies(h["signed_by"], AUDIT_REPORT_TAG + signed_text(text), h.get("signature", "")):
        return "the audit report's signature does not verify under its signed_by key"
    return None


def audit_refusal(r, now=None):
    """None when this request may be installed; otherwise the refusal, naming
    the digest, what is missing and the report, or that none exists."""
    required, _why, keys = audit_gate_for(r)
    if not required:
        return None
    now = time.time() if now is None else now
    pkg = r.get("package") or {}
    who = " ".join(x for x in (pkg.get("name"), str(pkg.get("version") or "")) if x) or "this package"
    digest = normal_digest(pkg.get("sha256"))
    if not digest:
        return f"{who} cannot be deployed here: it carries no package digest, so no audit pass can be for it."
    head = f"{who} cannot be deployed here: no current audit pass for {digest}"
    try:
        answer = call(f"/audits/{digest}")
    except Exception as e:  # noqa: BLE001
        return f"{head}: the audit could not be read ({str(e)[:120]})."
    cur = answer.get("current") if isinstance(answer, dict) else None
    if not isinstance(cur, dict):
        return f"{head}: no audit report exists for this package digest."
    url = cur.get("report_url")
    tail = f". The audit report: {url}" if url else "."
    if answer.get("current_pass") is not True:
        return f"{head}: {answer.get('why') or 'the newest audit is not a current pass'}{tail}"
    rd = normal_digest(cur.get("report_digest"))
    if not rd:
        return f"{head}: the audit names no report to read{tail}"
    try:
        text = fetch_text(f"/audit-reports/{rd}")
    except Exception as e:  # noqa: BLE001
        return f"{head}: the audit report could not be read ({str(e)[:120]}){tail}"
    if "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest() != rd:
        return f"{head}: the audit report served is not the one the audit names{tail}"
    missing = judge_report_text(text, digest, keys, now)
    return f"{head}: {missing}{tail}" if missing else None


def refuse_by_audit_gate(r, why):
    """The refusal, recorded and signed like any other (a refusal is an act,
    section 11.3), and nothing placed: no token, no argfile, no procedure."""
    args = r.get("args") or {}
    pkg = r.get("package") or {}
    result = {"ok": False, "act": "deploy", "step": "audit-gate", "error": why,
              "package": pkg.get("name") or args.get("name"), "version": pkg.get("version"),
              "instructed_by": r.get("decided_by") or "the owner"}
    print(f"[deploy-executor] {r.get('id')}: refused at the audit gate: {why}", flush=True)
    record = None
    try:
        rp = subprocess.run(["python3", RECORD, DM_IDENTITY], input=json.dumps(result),
                            capture_output=True, text=True, timeout=180)
        if rp.returncode == 0 and rp.stdout.strip():
            record = json.loads(rp.stdout)
            os.makedirs(DM_RECORDS, exist_ok=True)
            label = args.get("name") or pkg.get("name") or "package"
            with open(f"{DM_RECORDS}/{label}-refuse-{str(r.get('id', ''))[3:15].lower()}.json", "w") as f:
                json.dump(record, f, indent=2)
    except Exception as e:  # noqa: BLE001
        print(f"[deploy-executor] refusal record failed: {e}", flush=True)
    return {"ok": False, "result": result, **({"record": record} if record else {})}


def signed_record(result):
    """The procedure's answer, signed by the deployment manager's own identity
    (deploymgr-record.py), or None when the recorder gave nothing back.

    Twice if needed: the first real deploys produced unsigned records because
    node's cold start under deploy load blew the signer's timeout, and a record
    signed on the second try beats an unsigned one filed fast."""
    record = None
    for attempt in (1, 2):
        try:
            rp = subprocess.run(["python3", RECORD, DM_IDENTITY],
                                input=json.dumps(result), capture_output=True, text=True, timeout=180)
            if rp.returncode == 0 and rp.stdout.strip():
                record = json.loads(rp.stdout)
                if record.get("signatures"):
                    return record
                print(f"[deploy-executor] record unsigned (attempt {attempt}): {record.get('_unsigned')}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[deploy-executor] record step failed (attempt {attempt}): {e}", flush=True)
        time.sleep(5)
    return record


def run_one(r):
    if r.get("container"):
        return run_container(r)
    # Every package install asks the audit gate first: a new install, an
    # update, a person's own package and a version kept alongside.
    if not r.get("retire"):
        refused = audit_refusal(r)
        if refused:
            return refuse_by_audit_gate(r, refused)
    if r.get("alongside") or r.get("retire"):
        return run_version_act(r)
    # A package that names a tenant is a person's own agent: the tenant
    # project, through install-package, and never the host procedure below.
    if r.get("tenant"):
        return run_tenant_package(r)
    job = host_package_job(r)
    if "outcome" in job:
        return job["outcome"]
    rid, args, verb, token_path = job["rid"], job["args"], job["verb"], job["token_path"]

    # 3. The fixed procedure, and nothing else. Its one-line JSON answer is
    # the outcome, success or refusal alike.
    print(f"[deploy-executor] {rid}: {verb} of {args['name']}", flush=True)
    try:
        p = subprocess.run(["python3", STEPS, verb, job["argfile"]],
                           capture_output=True, text=True, timeout=DEPLOY_TIMEOUT)
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()]
        result = json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[:400]}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)[:400]}
    finally:
        try:
            os.remove(token_path)
        except OSError:
            pass
    return host_outcome(job, result)


def is_host_package(r):
    """A package this host's procedure installs or updates (run_one's last
    branch): not a container agent, not a version act, not a person's own."""
    return not (r.get("container") or r.get("alongside") or r.get("retire") or r.get("tenant"))


def host_package_job(r):
    """Steps 1 and 2 of a host package request: the boot token placed by name
    and the argfile written, and which procedure it is (deploy or update).
    Returns {"outcome": ...} for a request that is missing its shape, which
    places nothing."""
    rid = r["id"]
    args = r.get("args") or {}
    token = r.get("boot_token") or ""
    token_name = r.get("boot_token_name") or f"dr-{rid[3:15]}"
    harness = args.get("harness") or args.get("framework") or ""
    if not (token and args.get("name") and harness and r.get("package_url")):
        return {"outcome": {"ok": False, "error": "request is missing its deploy shape or boot token"}}

    # 1. The boot token, by NAME into the store the procedure reads. Removed
    # after the run either way: it was single-use the moment it was minted.
    os.makedirs(DM_TOKENS, exist_ok=True)
    token_path = f"{DM_TOKENS}/{token_name}.token"
    with open(token_path, "w") as f:
        f.write(token)
    os.chmod(token_path, 0o600)

    # 2. The argfile, under the deploymgr's own tmp, as its procedure demands.
    os.makedirs(f"{DM_HOME}/tmp", exist_ok=True)
    argfile = f"{DM_HOME}/tmp/{token_name}.json"
    arg = {
        "name": args["name"], "harness": harness,
        "package_url": r["package_url"],
        "interaction": args.get("interaction", "service"),
        "admit": args.get("admit", []),
        "boot_token": token_name,
    }
    if args.get("model"):
        arg["model"] = args["model"]
    if args.get("environment"):
        arg["environment"] = args["environment"]
    # Whose agent this becomes, so the deploy manager can place it on the
    # node that holds that owner's agents (one node per account).
    if isinstance(r.get("owner"), dict) and r["owner"].get("id"):
        arg["owner"] = {"kind": r["owner"].get("kind"), "id": r["owner"]["id"]}
    # What the package's install file needs from the owner: credential NAMES
    # by role, non-secret settings, mcp addresses, ceilings. Carried through
    # as approved; the procedure refuses a value or a missing name itself.
    for k in ("credentials", "settings", "addresses", "ceilings"):
        if isinstance(args.get(k), dict):
            arg[k] = args[k]
    # What the account's stack bound, per system, with the precedence step that
    # supplied each one. The procedure puts it in the signed deployment record
    # so a reader can tell afterwards which product this agent was bound to and
    # whether a person typed it in by hand. Names only; the procedure refuses
    # the whole instruction if an entry carries anything value-shaped.
    if isinstance(r.get("bindings"), list) and r["bindings"]:
        arg["stack_bindings"] = r["bindings"]
    # Reachable from outside the mesh over A2A, when the approver said so.
    if isinstance(args.get("a2a"), bool):
        arg["a2a"] = args["a2a"]
    # The digest the queue verified at filing, so the procedure refuses bytes
    # that moved between approval and fetch.
    sha = (r.get("package") or {}).get("sha256")
    if isinstance(sha, str) and sha:
        arg["sha256"] = sha
    # Where this host publishes images and which storage a job mounts. The
    # procedure reads these from its environment when the argfile is silent,
    # and sudo resets an environment, so the values are carried here instead
    # of being left to whatever shell happened to start something. A host with
    # no placement file says nothing and the procedure's own refusal names
    # what is missing, which is better than this guessing.
    for k, v in placement_settings().items():
        arg.setdefault(k, v)
    # A request with a tenant never reaches this line (run_tenant_package above
    # takes it). Should one ever arrive, the tenant is carried so the host
    # procedure refuses it (refuse_tenant_package) rather than installing a
    # person's agent in the platform's project.
    if isinstance(r.get("tenant"), str) and r["tenant"]:
        arg["tenant"] = r["tenant"]
    with open(argfile, "w") as f:
        json.dump(arg, f)

    # A name already in the inventory is a new version of an installed agent:
    # the update procedure (same subject, same home, restore on failure), not a
    # second deploy, which the procedure rightly refuses (the user exists).
    try:
        with open(f"{FLEET}/deploymgr-agents.json", encoding="utf-8") as f:
            installed = {e.get("name") for e in json.load(f) if isinstance(e, dict)}
    except (OSError, ValueError):
        installed = set()
    verb = "update" if args["name"] in installed else "deploy"
    return {"rid": rid, "args": args, "verb": verb, "argfile": argfile, "token_path": token_path}


def host_outcome(job, result):
    """What a host package request came to, from the procedure's answer: the
    answer itself and, for an act that ran far enough, its signed record."""
    args = job["args"]
    # 4. The signed deployment record, only for a deploy that ran far enough
    # to record. Kept under the deploymgr's own records like its manual ones.
    record = None
    # A deploy that ran is recorded; so is a refusal, since §11.3 says every
    # act leaves a record and a refusal is an act. A crash with no JSON at
    # all (no `step`) is not a procedure's answer and gets no record.
    #
    # An update is an act like a deploy, and its record names the package it
    # put in place. Until 2026-10-28 only `deploy` was recorded here, so every
    # agent updated through the queue ran a version no deployment record named
    # (56 of 62 dev agents at the fleet audit, lifecycle plan item 5).
    if result.get("act") in RECORDED_ACTS or (not result.get("ok") and result.get("step")):
        record = signed_record(result)
        if record is not None:
            os.makedirs(DM_RECORDS, exist_ok=True)
            with open(f"{DM_RECORDS}/{args['name']}-{record.get('act', 'deploy')}.json", "w") as f:
                json.dump(record, f, indent=2)

    return {"ok": bool(result.get("ok")), "result": result, **({"record": record} if record else {})}


# ── the conformance verdict after each deploy (fix pass, 2026-10-28) ──────
#
# A deploy or an update that worked is followed, where the environment wants
# it, by the Conformance Checker (agentevaluator, on this same host) run
# against the agent it put in place: the cases derived from the installed
# package's own declarations (agenteval-gen.py), sent to the agent, judged and
# signed by the checker's own key (agenteval-run.py), and filed with the
# registry, where the auditor reads the newest verdict. The verdict names the
# package digest the deploy verified, so the auditor binds it to this version.
#
# It runs after the result is posted, in a process of its own, one at a time
# on this host (a lock), so a long check never holds the queue or the next
# deploy. It is wanted everywhere but prod unless DM_CONFORMANCE says
# otherwise; a check that cannot run says why in its log and fails nothing.

EVAL_GEN = f"{FLEET}/agenteval-gen.py"
EVAL_RUN = f"{FLEET}/agenteval-run.py"
EVAL_USER = "agentevaluator"
EVAL_HOME = f"/home/{EVAL_USER}"
EVAL_IDENTITY = f"{EVAL_HOME}/.agentmesh/adapter/identity.json"
EVAL_CREDS = f"{EVAL_HOME}/.config/fleet/mesh.creds"
# The connection credential of the fleet's node, for a host where the checker
# holds none of its own: the checker then connects with it and still signs as
# itself (its identity key is the envelope's sender, which is what the registry
# checks). Only root reads it, so the check runs as root over a private copy
# of the checker's state, and the credential is never copied to another user.
NODE_CREDS = os.environ.get("DM_EVAL_NODE_CREDS") or f"{FLEET}/node-platform/mesh.creds"
EVAL_LOCK = f"{EVAL_HOME}/tmp/.after-deploy.lock"
# How many checks run at once on this host. A check spends most of its time
# waiting for the agent's answers, so a backfill runs several.
EVAL_SLOTS = max(1, int(os.environ.get("DM_CONFORMANCE_SLOTS") or 4))
# How long a check waits for a slot before it gives up and says so.
EVAL_WAIT_SECONDS = int(os.environ.get("DM_CONFORMANCE_WAIT_SECONDS") or 3 * 3600)
EVAL_TIMEOUT = int(os.environ.get("DM_CONFORMANCE_SECONDS") or 3600)
CONFORM_LOG = f"{DM_RECORDS}/conformance.log"
_CHECKS = []
# Installs that run side by side start checks from their own threads.
_CHECKS_LOCK = threading.Lock()


def conformance_wanted():
    """DM_CONFORMANCE on or off, else on in every environment but prod."""
    v = (os.environ.get("DM_CONFORMANCE") or "").strip().lower()
    if v in ("on", "1", "true", "yes"):
        return True
    if v in ("off", "0", "false", "no"):
        return False
    try:
        name, _path, _v = _am_env_file()
    except RuntimeError:
        return False
    return name != "prod"


def conformance_subject(r, outcome):
    """The agent a request put in place, as the check needs it, or None when
    the request is not one the check follows: only a package this host's
    procedure installed, and only when it worked (a deploy or an update). A
    container agent from a repository has its role's check, a person's own
    package runs in the tenant project, and a version kept alongside is not
    the one served."""
    res = outcome.get("result") or {}
    if not outcome.get("ok") or res.get("act") not in RECORDED_ACTS:
        return None
    if r.get("container") or r.get("tenant") or r.get("alongside") or r.get("retire"):
        return None
    s = {"request": r.get("id"), "name": res.get("name") or (r.get("args") or {}).get("name"),
         "package": res.get("package"), "version": res.get("version"), "sha256": res.get("sha256"),
         "agent_key": res.get("agent_key"), "handle": res.get("handle")}
    return s if all(s.get(k) for k in ("request", "name", "package", "sha256", "handle")) else None


def reap_checks():
    """Collect the checks started earlier that have finished, so none lingers."""
    with _CHECKS_LOCK:
        _CHECKS[:] = [p for p in _CHECKS if p.poll() is None]


def start_conformance(subject):
    """Start the check in a process of its own and return at once."""
    try:
        os.makedirs(f"{DM_HOME}/tmp", exist_ok=True)
        os.makedirs(DM_RECORDS, exist_ok=True)
        argfile = f"{DM_HOME}/tmp/conform-{str(subject['request'])[3:15].lower()}.json"
        with open(argfile, "w") as f:
            json.dump(subject, f)
        with open(CONFORM_LOG, "a") as log:
            p = subprocess.Popen([sys.executable or "python3", os.path.abspath(__file__), "conform", argfile],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                 start_new_session=True, close_fds=True)
        with _CHECKS_LOCK:
            _CHECKS.append(p)
        print(f"[deploy-executor] {subject['request']}: conformance check of {subject['handle']} "
              f"{subject.get('version')} started (log {CONFORM_LOG})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[deploy-executor] {subject.get('request')}: the conformance check did not start: {e}", flush=True)


def conform(subject, run=subprocess.run, pool="deploy", wait_seconds=None, now=time.time, sleep=time.sleep):
    """One check, in one of the host's EVAL_SLOTS for its pool. Returns what it
    came to, and always says so in one line, even when it never ran.

    The checks after a deploy and the backfill's have slots of their own
    (pool "deploy" and "backfill"), so a backfill holding every slot for hours
    never leaves a deploy's check waiting unseen (2026-10-28: ten checks
    started after deploys waited behind a backfill and logged nothing). A
    check that waits says so once, and one that cannot get a slot within
    EVAL_WAIT_SECONDS gives up and says that."""
    import fcntl
    os.makedirs(f"{EVAL_HOME}/tmp", exist_ok=True)
    wait_seconds = EVAL_WAIT_SECONDS if wait_seconds is None else wait_seconds
    started, said_waiting = now(), False
    while True:
        for i in range(EVAL_SLOTS):
            with open(f"{EVAL_LOCK}.{pool}.{i}", "a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    continue
                return conform_now(subject, run=run)
        if not said_waiting:
            said_waiting = True
            print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "request": subject.get("request"),
                              "handle": subject.get("handle"), "version": subject.get("version"),
                              "waiting": f"all {EVAL_SLOTS} {pool} slots are taken; this check starts when one frees"}), flush=True)
        if now() - started > wait_seconds:
            out = {"ok": False, "why": f"no {pool} slot came free within {wait_seconds} seconds; the check did not run"}
            print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "request": subject.get("request"),
                              "handle": subject.get("handle"), "version": subject.get("version"), **out}), flush=True)
            return out
        sleep(5)


def checker_seat():
    """How the check reaches the agent: ("own", creds) when the checker holds
    a connection credential of its own, ("node", creds) when only the fleet's
    node does, else (None, why)."""
    own = os.environ.get("DM_EVAL_CREDS") or EVAL_CREDS
    if os.path.isfile(own):
        return "own", own
    if os.path.isfile(NODE_CREDS):
        return "node", NODE_CREDS
    return None, f"the checker holds no connection credential ({own}) and this host has no node credential ({NODE_CREDS})"


def checker_command(seat, creds, spec_path, handle, records_root):
    """The command that runs agenteval-run.py, and a private state folder to
    remove afterwards. Always as root over a copy of the checker's adapter
    state (and of its credential) in a folder only root reads: the checker
    still signs and sends as itself, nothing of the checker's own is
    rewritten, a node's credential stays root's, and the agent's records,
    which only the node's user and root may read, can be audited where they
    are."""
    # sudo starts from a clean environment, and the checker's scripts read
    # which mesh they are on from AGENTMESH_ENV: without it they file with the
    # default (prod) broker, and a dev verdict was never stored.
    am_env = f"AGENTMESH_ENV={(os.environ.get('AGENTMESH_ENV') or 'prod').strip()}"
    import tempfile
    work = tempfile.mkdtemp(prefix="conform-")
    os.chmod(work, 0o700)
    state = os.path.join(work, "adapter")
    os.makedirs(state, mode=0o700)
    src = os.path.dirname(EVAL_IDENTITY)
    for fn in ("identity.json", "named.json", "pins.json"):
        if os.path.exists(os.path.join(src, fn)):
            shutil.copyfile(os.path.join(src, fn), os.path.join(state, fn))
    if seat == "own":
        # A copy, so a renewal the adapter writes never leaves the checker's
        # own file owned by root.
        shutil.copyfile(creds, os.path.join(work, "mesh.creds"))
        os.chmod(os.path.join(work, "mesh.creds"), 0o600)
        creds = os.path.join(work, "mesh.creds")
    return (["env", f"HOME={work}", am_env, f"MESH_ADAPTER_STATE={state}", f"EVAL_CREDS={creds}",
             "python3", EVAL_RUN, spec_path, handle, records_root, os.path.join(state, "identity.json")], work)


def records_root_of(name):
    """Where an installed agent keeps its records: the jobs folder of its
    adapter state (on the node, through the home's link), else ~/work."""
    jobs = f"/home/{name}/.agentmesh/adapter/jobs"
    return jobs if os.path.isdir(jobs) else f"/home/{name}/work"


def _owned_by_checker(path):
    try:
        import pwd
        u = pwd.getpwnam(EVAL_USER)
        os.chown(path, u.pw_uid, u.pw_gid)
    except (ImportError, KeyError, OSError):
        pass


def conform_now(s, run=subprocess.run):
    """Derive the cases from the installed package, run them as the checker,
    and keep the signed verdict beside the deployment records. The verdict is
    filed with the registry by agenteval-run.py itself."""
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def said(d):
        print(json.dumps({"at": stamp, "request": s.get("request"), "handle": s.get("handle"),
                          "version": s.get("version"), **d}), flush=True)
        return d

    pkg_dir = f"/home/{s['name']}/{s['package']}"
    if not os.path.isdir(pkg_dir):
        return said({"ok": False, "why": f"the installed package is not at {pkg_dir}"})
    try:
        g = run(["python3", EVAL_GEN, pkg_dir], capture_output=True, text=True, timeout=120)
        spec = json.loads(g.stdout)
        if not isinstance(spec, dict) or "cases" not in spec:
            raise ValueError(spec.get("error") if isinstance(spec, dict) else "no spec")
    except Exception as e:  # noqa: BLE001
        return said({"ok": False, "why": f"the cases could not be derived from the package: {str(e)[:300]}"})
    # Which package was checked, by the digest the deploy verified: the record
    # the checker signs names it, which is what binds the verdict to a version.
    spec.update({"package_sha256": s["sha256"], "package_version": s.get("version"),
                 "requested_by": f"the deployment manager, after deploy request {s['request']}"})
    if s.get("agent_key"):
        spec["subject_key"] = s["agent_key"]
    spec_path = f"{EVAL_HOME}/tmp/{s['name']}-{str(s['request'])[3:15].lower()}-eval.json"
    with open(spec_path, "w") as f:
        json.dump(spec, f, indent=2)
    _owned_by_checker(spec_path)
    seat, creds = checker_seat()
    if not seat:
        return said({"ok": False, "why": creds})
    stderr = ""
    work = None
    try:
        cmd, work = checker_command(seat, creds, spec_path, s["handle"], records_root_of(s["name"]))
        p = run(cmd, capture_output=True, text=True, timeout=EVAL_TIMEOUT)
        stderr = p.stderr or ""
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip().startswith("{")]
        answer = json.loads(lines[-1]) if lines else {"ok": False, "error": stderr[-300:] or "no output"}
    except Exception as e:  # noqa: BLE001
        answer = {"ok": False, "error": str(e)[:300]}
    finally:
        if work:
            shutil.rmtree(work, ignore_errors=True)
    record = answer.get("record") if isinstance(answer.get("record"), dict) else None
    if record:
        try:
            os.makedirs(DM_RECORDS, exist_ok=True)
            with open(f"{DM_RECORDS}/{s['name']}-conformance-{s['sha256'][:12]}.json", "w") as f:
                json.dump(record, f, indent=2)
        except OSError:
            pass
    signed = bool(record and record.get("signatures"))
    return said({"ok": signed, "seat": seat, "conforms": answer.get("conforms"), "verdict": (record or {}).get("verdict"),
                 "summary": answer.get("summary"), "signed": signed,
                 "filed": signed and "submitted eval record to the registry" in stderr,
                 **({} if record else {"why": str(answer.get("error") or "the checker returned no record")[:300]})})


# ── the backfill: a record and a verdict for what already runs ───────────
#
# For an agent deployed before every deploy and update left a signed record,
# and before every deploy was followed by a conformance check. The record is
# an `attest` (deploymgr-steps.py attest re-hashes the running install against
# its ledger and installs nothing), signed like any other and filed on the
# deploy request that filed that package (POST /v1/deploy-requests/record);
# then the check runs as it does after a deploy. Nothing is redeployed.
#   python3 deploy-executor.py backfill [--records-only | --checks-only] [name ...]

def file_record(record):
    """POST /v1/deploy-requests/record: the platform finds the deployed request
    that filed this package and keeps the record on it. Returns its answer."""
    try:
        return call("/deploy-requests/record", "POST", {"record": record})
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            body = {}
        return {"ok": False, "status": e.code, "error": body.get("error") or str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300]}


def backfill(names=(), records=True, checks=True, run=subprocess.run, inventory=None, _request=None):
    """A signed attest record and a conformance verdict for each running agent
    in the inventory (or the ones named). One JSON line per agent."""
    path = inventory or f"{FLEET}/deploymgr-agents.json"
    try:
        with open(path, encoding="utf-8") as f:
            rows = [e for e in json.load(f) if isinstance(e, dict) and e.get("state", "running") == "running"]
    except (OSError, ValueError) as e:
        print(json.dumps({"ok": False, "why": f"no inventory: {e}"}), flush=True)
        return []
    if names:
        rows = [e for e in rows if e.get("name") in names]
    if checks and len(rows) > 1 and EVAL_SLOTS > 1:
        # The attests and records first, one at a time, then the checks in
        # EVAL_SLOTS at once: one check holds a slot, never the whole run.
        from concurrent.futures import ThreadPoolExecutor
        first = backfill([e["name"] for e in rows], records=records, checks=False, run=run, inventory=path) if records else []
        by_name = {r["name"]: r for r in first}

        def one(e):
            row = backfill([e["name"]], records=False, checks=True, run=run, inventory=path, _request=(by_name.get(e["name"]) or {}).get("record", {}).get("request"))
            return {**by_name.get(e["name"], {}), **(row[0] if row else {"name": e["name"]})}
        with ThreadPoolExecutor(max_workers=EVAL_SLOTS) as pool:
            return list(pool.map(one, rows))
    done = []
    for e in rows:
        name = e["name"]
        try:
            p = run(["python3", STEPS, "attest", name], capture_output=True, text=True, timeout=600)
            lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip().startswith("{")]
            res = json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[-300:]}
        except Exception as ex:  # noqa: BLE001
            res = {"ok": False, "error": str(ex)[:300]}
        row = {"name": name, "version": res.get("version") or e.get("version"),
               "sha256": res.get("sha256") or e.get("sha256")}
        if not res.get("ok"):
            row["attest"] = f"refused at {res.get('step', '?')}: {str(res.get('error'))[:300]}"
            print(json.dumps(row), flush=True)
            done.append(row)
            continue
        request = _request
        if records:
            record = signed_record(res)
            if record and record.get("signatures"):
                os.makedirs(DM_RECORDS, exist_ok=True)
                with open(f"{DM_RECORDS}/{name}-attest-{res['sha256'][:12]}.json", "w") as f:
                    json.dump(record, f, indent=2)
                answer = file_record(record)
                request = answer.get("request")
                row["record"] = {k: answer.get(k) for k in ("ok", "request", "kept_as", "already", "error", "status")
                                 if answer.get(k) is not None}
            else:
                row["record"] = {"ok": False, "error": (record or {}).get("_unsigned") or "the recorder gave nothing back"}
        if checks:
            subject = {"request": request or f"dr_backfill-{res['sha256'][:12]}", "name": name,
                       "package": res["package"], "version": res.get("version"), "sha256": res["sha256"],
                       "agent_key": res.get("agent_key"), "handle": res.get("handle")}
            row["check"] = (conform(subject, run=run, pool="backfill") if subject["handle"]
                            else {"ok": False, "why": "no handle in the inventory"})
        print(json.dumps(row), flush=True)
        done.append(row)
    return done

def answer_the_run(r, outcome):
    """A request a process run filed at its gate is answered back to the run:
    one message from the deployment manager's own seat to the runner's, naming
    the run and the phase so the runner reads it as the phase's delivery, with
    the signed deployment record attached. A refusal goes the same road, as a
    refusal, so the phase closes as refused and the owner is told rather than
    the run waiting on an answer that never comes."""
    gate = r.get("run_gate") or {}
    runner = gate.get("runner") or ""
    if not (gate.get("run") and gate.get("phase") and runner):
        return
    res = outcome.get("result") or {}
    args = r.get("args") or {}
    files = []
    if outcome.get("ok"):
        handle = res.get("handle") or ""
        version = res.get("version") or (r.get("package") or {}).get("version") or ""
        text = (f"run {gate['run']} phase {gate['phase']}: deployed. handle: {handle}; version {version}; "
                f"deploy request {r.get('id')}; the signed deployment record is attached.")
        rec = f"{DM_RECORDS}/{args.get('name')}-{(outcome.get('record') or {}).get('act', 'deploy')}.json"
        if outcome.get("record") and os.path.exists(rec):
            files = ["--files", rec]
    else:
        why = f"{res.get('step', '?')}: {str(res.get('error') or outcome.get('error') or '')[:300]}"
        if res.get("rolled_back"):
            text = (f"run {gate['run']} phase {gate['phase']}: rolled back. The install was placed, the node did not "
                    f"stay well after it, and it was taken back out ({why}). {str(res.get('state') or '')[:300]}")
        else:
            text = f"run {gate['run']} phase {gate['phase']}: refused. The deploy was not done ({why}); nothing was installed."
    try:
        p = subprocess.run(["sudo", "-u", "deploymgr", "env", "HOME=/home/deploymgr", "agentmesh", "messages", "send", runner, text, *files],
                           capture_output=True, text=True, timeout=120)
        print(f"[deploy-executor] {r.get('id')}: answered run {gate['run']} phase {gate['phase']} at {runner}"
              f"{'' if p.returncode == 0 else ' FAILED: ' + (p.stderr or p.stdout or '')[-200:]}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[deploy-executor] {r.get('id')}: could not answer run {gate['run']}: {e}", flush=True)


def load_outcomes():
    """The kept outcomes, {request id: {"at": epoch seconds, "outcome": {...}}}.

    The file sits in the deployment manager's home, which that user owns, and
    this process runs as root; so only a plain file this process's own user
    owns, writable by nobody else, is believed. Anything else reads as nothing
    kept, which is the behaviour from before the file existed and grants
    nothing: a planted outcome would otherwise be posted as a deploy that never
    happened."""
    try:
        st = os.lstat(OUTCOMES)
        if not stat.S_ISREG(st.st_mode):
            return {}
        if hasattr(os, "geteuid") and (st.st_uid != os.geteuid() or st.st_mode & 0o022):
            return {}
        fd = os.open(OUTCOMES, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(doc, dict):
        return {}
    return {rid: v for rid, v in doc.items()
            if isinstance(v, dict) and isinstance(v.get("outcome"), dict) and isinstance(v.get("at"), (int, float))}


def save_outcomes(kept):
    """Write the kept outcomes whole, through a fresh file renamed into place.
    The temporary name is removed and then created exclusively, so a link left
    at that name by anyone else is never followed by a root write."""
    tmp = f"{OUTCOMES}.tmp"
    try:
        os.makedirs(os.path.dirname(OUTCOMES), exist_ok=True)
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(kept, f)
        os.replace(tmp, OUTCOMES)
        return True
    except OSError as e:
        print(f"[deploy-executor] could not keep outcomes at {OUTCOMES}: {e}", flush=True)
        return False


def prune_outcomes(kept, asked, now=None):
    """Drop outcomes older than a day, except one the queue is still asking
    for: its result never landed, and posting it is still the only right
    answer however long that takes."""
    now = time.time() if now is None else now
    return {rid: v for rid, v in kept.items() if now - v["at"] < OUTCOME_KEEP or rid in asked}


def wait_asked_for(err, attempt):
    """Seconds to wait after a "not now": the Retry-After header, else the
    retry_after_ms the platform's limiter puts in its body, else the backoff.
    Never more than RESULT_WAIT_CAP."""
    asked = None
    header = (getattr(err, "headers", None) or {}).get("Retry-After")
    if header and str(header).strip().isdigit():
        asked = int(str(header).strip())
    if asked is None:
        try:
            ms = json.loads(err.read().decode("utf-8", "replace")).get("retry_after_ms")
            if isinstance(ms, (int, float)) and ms >= 0:
                asked = ms / 1000.0
        except Exception:  # noqa: BLE001
            asked = None
    if asked is None:
        asked = RESULT_BACKOFF[min(attempt, len(RESULT_BACKOFF)) - 1]
    return max(0.0, min(float(asked), RESULT_WAIT_CAP))


def post_result(rid, outcome):
    """Post one outcome, asking again after a 429, 502 or 503. Returns
    (posted, why). Any other failure is not asked again here: the post may
    have landed, and the next poll tells, because a request whose result
    landed is no longer in the queue."""
    last = ""
    for attempt in range(1, RESULT_TRIES + 1):
        try:
            call(f"/deploy-requests/{rid}/result", "POST", outcome)
            return True, ""
        except urllib.error.HTTPError as e:
            last = str(e)
            if e.code not in RESULT_RETRY_CODES or attempt == RESULT_TRIES:
                return False, last
            time.sleep(wait_asked_for(e, attempt))
        except Exception as e:  # noqa: BLE001
            return False, str(e)
    return False, last


def serve_request(r, kept):
    """Run one approved request, or, when it ran before and its result never
    landed, post the outcome kept from that run instead. Returns False when
    the result could not be posted, so the loop waits the slow POLL before it
    asks the queue again."""
    rid = r.get("id", "?")
    held = kept.get(rid)
    if held:
        outcome = held["outcome"]
        print(f"[deploy-executor] {rid}: ran already at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(held['at']))};"
              f" posting that outcome instead of running it again", flush=True)
    else:
        print(f"[deploy-executor] deploying {rid}: {r.get('args', {}).get('name')}", flush=True)
        outcome = run_one(r)
        # Kept BEFORE the post, so a post that fails cannot lead to a second run.
        kept[rid] = {"at": time.time(), "outcome": outcome}
        save_outcomes(kept)
    return deliver(r, outcome, held)


def deliver(r, outcome, held=None):
    """Post one request's outcome and do what follows it, exactly once per
    run: the log line, the answer to a run's gate and the conformance check.
    `held` is the kept outcome being posted again, which does neither of the
    last two. Returns whether the post landed."""
    rid = r.get("id", "?")
    posted, why_not = post_result(rid, outcome)
    if posted:
        # Name the failing step and its words here too: the store has the full
        # result, but the log is where an operator looks first, and "failed"
        # alone cost a diagnosis round.
        why = ""
        if not outcome["ok"]:
            res = outcome.get("result") or {}
            why = f" ({res.get('step', '?')}: {str(res.get('error') or outcome.get('error') or '')[:200]})"
        # A deploy the watch took back out is neither deployed nor a plain
        # failure: the install happened, hurt the node, and was removed.
        word = "deployed" if outcome["ok"] else (
            "rolled back" if (outcome.get("result") or {}).get("rolled_back") else "failed")
        print(f"[deploy-executor] {rid}: {word}{'' if outcome['ok'] else why}", flush=True)
    else:
        # Not acked: the request stays approved, and the next poll posts the
        # kept outcome rather than running it again.
        print(f"[deploy-executor] {rid}: result post failed: {why_not}; kept for the next poll", flush=True)
    # A request a run filed is answered back to the run, whatever the outcome,
    # and once: only by the round that ran it, never by a re-post.
    if r.get("run_gate") and not held:
        answer_the_run(r, outcome)
    # The conformance verdict for what this request put in place, once, by the
    # round that ran it.
    if not held and conformance_wanted():
        subject = conformance_subject(r, outcome)
        if subject:
            start_conformance(subject)
    return posted


# ── oldest approval first (technical debt 593) ───────────────────────────

def _decided_key(r):
    """Sort key for a queued request: when it was approved, oldest first. A
    request with no readable decided_at goes after those that have one, in the
    order the queue gave."""
    v = r.get("decided_at")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return (0, float(v))
    if isinstance(v, str) and v.strip():
        try:
            t = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            return (0, t.timestamp())
        except ValueError:
            pass
    return (1, 0.0)


def oldest_first(queue):
    """The queue served the newest approval first; it is served oldest first."""
    return sorted(queue, key=_decided_key)


# ── installs side by side (DM_INSTALL_WORKERS, DM_LAND_BATCH) ────────────
#
# WHAT RUNS SIDE BY SIDE AND WHAT DOES NOT. A host package install has three
# parts (deploymgr-steps.py prepare, land, finish). Preparing (the checks and
# the fetch) and finishing (building the image, placing the Cloud Run job and
# probing it) touch no node, and run in up to DM_INSTALL_WORKERS threads. The
# landing (the unix user, the files, the agent added to its node, the node
# restart, the smoke check and the watch) holds the host's node lock, so there
# is one landing at a time, and with DM_LAND_BATCH on it takes several agents
# behind one restart. The other kinds of request (a container agent, a
# person's own package, a version kept alongside or retired) run whole, one at
# a time, inside a worker: their own inventories are not written for two at
# once.
#
# ONE REQUEST PER AGENT AT A TIME. A second request for an agent waits until
# the first has finished all three parts and posted its outcome, so a later
# version never lands before an earlier one, and the two never share the
# staging folders that are named after the agent.
#
# EVERYTHING ELSE IS WHAT A REQUEST RUN WHOLE DOES: the outcome is kept before
# it is posted, the record is signed the same way (host_outcome), and the post,
# the run's gate and the conformance check follow it (deliver).

_KEPT_LOCK = threading.Lock()
# How long one pass of the loop waits for an install to finish before it asks
# the queue again. The queue answers at once while any request is approved,
# and requests being installed stay approved until their outcome is posted.
PROGRESS_WAIT = 30


def keep_outcome(rid, outcome):
    """Keep one outcome on disk before it is posted, as serve_request does."""
    with _KEPT_LOCK:
        kept = load_outcomes()
        kept[rid] = {"at": time.time(), "outcome": outcome}
        save_outcomes(kept)


def agent_of(r):
    """The agent a request is for, so two requests for it never run at once."""
    return (r.get("args") or {}).get("name") or r.get("id")


def last_answer(p):
    """The procedure's one-line JSON answer, as run_one reads it."""
    lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip()]
    return json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output")[:400]}


class Installs:
    """Approved requests, run side by side within the bounds above."""

    def __init__(self, workers=None, batch=None, batch_seconds=None, batch_most=None, now=time.time):
        self.workers = INSTALL_WORKERS if workers is None else workers
        self.batch = LAND_BATCH if batch is None else batch
        self.batch_seconds = LAND_BATCH_SECONDS if batch_seconds is None else batch_seconds
        self.batch_most = (LAND_BATCH_MOST if batch_most is None else batch_most) if self.batch else 1
        self.now = now
        self.pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="install")
        self.cv = threading.Condition()
        self.running = set()   # request ids being installed or waiting their turn
        self.busy = set()      # agents with a request in progress
        self.later = {}        # agent -> requests waiting behind an earlier one
        self.coming = 0        # host package requests started and not yet ready to land
        self.ready = []        # (job, since): prepared, waiting to land, oldest first
        self.finished = 0
        self.erred = False
        self.others = threading.Lock()
        threading.Thread(target=self._land_loop, name="land", daemon=True).start()

    # -- the loop's side ---------------------------------------------------

    def has(self, rid):
        with self.cv:
            return rid in self.running

    def submit(self, r):
        """Take one approved request. Its agent's earlier request, if any, goes
        first."""
        key = agent_of(r)
        with self.cv:
            self.running.add(r.get("id"))
            if key in self.busy:
                self.later.setdefault(key, []).append(r)
                return
            self.busy.add(key)
            self._start(r)

    def wait(self, timeout=PROGRESS_WAIT):
        """Until an install finishes, or `timeout`. At once when none runs."""
        with self.cv:
            seen = self.finished
            if self.running:
                self.cv.wait_for(lambda: self.finished != seen, timeout=timeout)
            erred, self.erred = self.erred, False
            return erred

    # -- the workers' side -------------------------------------------------

    def _start(self, r):
        # Called with self.cv held.
        if is_host_package(r):
            self.coming += 1
        self.pool.submit(self._begin, r)

    def _begin(self, r):
        rid = r.get("id", "?")
        print(f"[deploy-executor] deploying {rid}: {r.get('args', {}).get('name')}", flush=True)
        try:
            if is_host_package(r):
                job, outcome = self._prepare(r)
                if job is not None:
                    with self.cv:
                        self.coming -= 1
                        self.ready.append((job, self.now()))
                        self.cv.notify_all()
                    return
                with self.cv:
                    self.coming -= 1
                    self.cv.notify_all()
            else:
                with self.others:
                    outcome = run_one(r)
        except Exception as e:  # noqa: BLE001 - every request gets an outcome
            outcome = {"ok": False, "error": f"the executor stopped on this request: {str(e)[:300]}"}
        self._done(r, outcome)

    def _prepare(self, r):
        """The audit gate, the token and argfile, then deploymgr-steps.py
        prepare. Returns (job, None) when it is ready to land, else (None,
        outcome)."""
        refused = audit_refusal(r)
        if refused:
            return None, refuse_by_audit_gate(r, refused)
        job = host_package_job(r)
        if "outcome" in job:
            return None, job["outcome"]
        job["r"] = r
        print(f"[deploy-executor] {job['rid']}: {job['verb']} of {job['args']['name']}, prepared side by side", flush=True)
        try:
            result = last_answer(subprocess.run(["python3", STEPS, "prepare", job["verb"], job["argfile"]],
                                                capture_output=True, text=True, timeout=DEPLOY_TIMEOUT))
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": str(e)[:400]}
        if result.get("ok") and result.get("phase") == "prepared" and result.get("state"):
            job["state"] = result["state"]
            return job, None
        self._drop_token(job)
        return None, host_outcome(job, result)

    def _land_loop(self):
        while True:
            with self.cv:
                self.cv.wait_for(lambda: self.ready)
                if self.batch:
                    # Wait for others while more are on their way, up to the
                    # batch's time or size, whichever comes first.
                    deadline = self.ready[0][1] + self.batch_seconds
                    while (len(self.ready) < self.batch_most and self.coming > 0
                           and self.now() < deadline):
                        self.cv.wait(timeout=max(0.05, deadline - self.now()))
                take = [j for j, _ in self.ready[:self.batch_most]]
                del self.ready[:len(take)]
            try:
                self._land(take)
            except Exception as e:  # noqa: BLE001
                for job in take:
                    self.pool.submit(self._finish, job, {"ok": False, "error": f"the landing could not run: {str(e)[:300]}"})

    def _land(self, jobs):
        names = ", ".join(j["args"]["name"] for j in jobs)
        print(f"[deploy-executor] landing {names} behind one node start", flush=True)
        try:
            result = last_answer(subprocess.run(["python3", STEPS, "land", *[j["state"] for j in jobs]],
                                                capture_output=True, text=True, timeout=land_timeout(len(jobs))))
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": str(e)[:400]}
        # A landing refused as a whole (the node lock, say) placed nothing, and
        # that refusal is each request's answer. Otherwise each finish says
        # what its own agent came to.
        refusal = result if (not result.get("ok") and result.get("step")) else None
        for job in jobs:
            self.pool.submit(self._finish, job, refusal)

    def _finish(self, job, refusal=None):
        try:
            if refusal is not None:
                result = dict(refusal)
                try:
                    os.remove(job["state"])
                except (OSError, KeyError):
                    pass
            else:
                # A failed container half of an update puts the host half back
                # and restarts it under the node lock; a landing may hold that
                # lock for a while, so the put-back may wait for one.
                env = {**os.environ, "DM_NODE_LOCK_SOFT_SECONDS": str(land_timeout(self.batch_most))}
                try:
                    result = last_answer(subprocess.run(["python3", STEPS, "finish", job["state"]], capture_output=True,
                                                        text=True, timeout=DEPLOY_TIMEOUT + land_timeout(self.batch_most),
                                                        env=env))
                except Exception as e:  # noqa: BLE001
                    result = {"ok": False, "error": str(e)[:400]}
        finally:
            self._drop_token(job)
        try:
            outcome = host_outcome(job, result)
        except Exception as e:  # noqa: BLE001
            outcome = {"ok": False, "result": result, "error": f"the record could not be made: {str(e)[:300]}"}
        self._done(job["r"], outcome)

    @staticmethod
    def _drop_token(job):
        try:
            os.remove(job["token_path"])
        except OSError:
            pass

    def _done(self, r, outcome):
        """Keep, post and follow up one outcome, then let the agent's next
        request start."""
        rid = r.get("id", "?")
        posted = False
        try:
            keep_outcome(rid, outcome)
            posted = deliver(r, outcome)
        except Exception as e:  # noqa: BLE001
            print(f"[deploy-executor] {rid}: the outcome could not be delivered: {e}", flush=True)
        key = agent_of(r)
        with self.cv:
            self.erred = self.erred or not posted
            self.running.discard(rid)
            waiting = self.later.get(key) or []
            if waiting:
                self._start(waiting.pop(0))
                if not waiting:
                    self.later.pop(key, None)
            else:
                self.busy.discard(key)
            self.finished += 1
            self.cv.notify_all()


def one_round(state):
    """One pass of the loop: the host report, one queue read, and each request
    on it. Returns how long to sleep before the next pass."""
    erred = False
    reap_checks()
    # The host's report, when it changed or ten minutes passed. A failed
    # post is logged and retried next round; it never blocks a deploy.
    try:
        report = host_report()
        if report != state.get("last_report") or time.time() - state.get("reported_at", 0.0) > REPORT_EVERY:
            call("/deploy-requests/host", "POST", report)
            state["last_report"], state["reported_at"] = report, time.time()
    except Exception as e:  # noqa: BLE001
        print(f"[deploy-executor] host report failed: {e}", flush=True)
    queue = None
    try:
        # The long poll: the approve click wakes this read server-side,
        # so a deploy starts within seconds of the click. POLL below only
        # paces retries after an ERROR — the fallback heartbeat, never
        # the latency. A 429 is an error like any other here.
        # `accepts=container`: this executor carries container agents too
        # (run_container), so the queue hands it those requests as well.
        # `tenant-package`: it places a person's own package in the tenant
        # project (run_tenant_package), so the queue hands it those too.
        # `versions`: a version kept alongside the current one, or one retired
        # (run_version_act), which an older executor would read as an update.
        queue = call("/deploy-requests/queue?wait_ms=240000&accepts=container,tenant-package,versions", timeout=250).get("requests", [])
    except Exception as e:  # noqa: BLE001
        print(f"[deploy-executor] queue read failed: {e}", flush=True)
        erred = True
    with _KEPT_LOCK:
        kept = load_outcomes()
        if queue is not None:
            pruned = prune_outcomes(kept, {r.get("id") for r in queue})
            if len(pruned) != len(kept):
                kept = pruned
                save_outcomes(kept)
    if serial_mode():
        for r in oldest_first(queue or []):
            if not serve_request(r, kept):
                erred = True
    else:
        installs = state.get("installs")
        if installs is None:
            installs = state["installs"] = Installs()
        for r in oldest_first(queue or []):
            rid = r.get("id")
            if installs.has(rid):
                continue
            # Read again here, not at the top of the round: an install that
            # finished a moment ago kept its outcome before it let go of its
            # request id, so a request not running now has its outcome on disk
            # if it ran at all.
            with _KEPT_LOCK:
                held = load_outcomes().get(rid)
            if held:
                # Ran before and its post never landed: posted, never run again.
                if not serve_request(r, {rid: held}):
                    erred = True
                continue
            installs.submit(r)
        if installs.wait():
            erred = True
    # A beat between long polls, not the latency: the long poll above is
    # what answers promptly. The slow sleep applies only after an error,
    # so a down or refusing server is re-asked gently rather than hammered.
    return POLL if erred else 1


def main():
    if not bearer():
        print(f"[deploy-executor] no bearer at {TOKEN_FILE}; nothing to do", flush=True)
    state = {"last_report": None, "reported_at": 0.0}
    while True:
        time.sleep(one_round(state))


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "conform":
            with open(sys.argv[2], encoding="utf-8") as f:
                _subject = json.load(f)
            try:
                os.remove(sys.argv[2])
            except OSError:
                pass
            try:
                _out = conform(_subject)
            except Exception as _e:  # noqa: BLE001 - a started check always ends with a line
                _out = {"ok": False, "why": f"the check stopped: {str(_e)[:300]}"}
                print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "request": _subject.get("request"),
                                  "handle": _subject.get("handle"), "version": _subject.get("version"), **_out}), flush=True)
            sys.exit(0 if _out.get("ok") else 1)
        if len(sys.argv) >= 2 and sys.argv[1] == "backfill":
            _rest = sys.argv[2:]
            backfill([a for a in _rest if not a.startswith("--")],
                     records="--checks-only" not in _rest, checks="--records-only" not in _rest)
            sys.exit(0)
        main()
    except KeyboardInterrupt:
        sys.exit(0)
