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

Env: MESH_CONTROL_URL (default the environment's urls.app + /v1, env/prod.json),
MESH_DEPLOY_EXECUTOR_TOKEN_FILE (one line, the bearer), POLL_SECONDS (60).
"""
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

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
    for part in key.split("."):
        v = v.get(part) if isinstance(v, dict) else None
        if v is None:
            raise RuntimeError(f'{key} is not set for environment "{name}" in {path}')
    return v + suffix


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
DEPLOY_TIMEOUT = int(os.environ.get("DM_BUILD_MINUTES", "40")) * 60 + 900
RECORD = f"{FLEET}/deploymgr-record.py"
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


def run_one(r):
    if r.get("container"):
        return run_container(r)
    if r.get("alongside") or r.get("retire"):
        return run_version_act(r)
    # A package that names a tenant is a person's own agent: the tenant
    # project, through install-package, and never the host procedure below.
    if r.get("tenant"):
        return run_tenant_package(r)
    rid = r["id"]
    args = r.get("args") or {}
    token = r.get("boot_token") or ""
    token_name = r.get("boot_token_name") or f"dr-{rid[3:15]}"
    harness = args.get("harness") or args.get("framework") or ""
    if not (token and args.get("name") and harness and r.get("package_url")):
        return {"ok": False, "error": "request is missing its deploy shape or boot token"}

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

    # 3. The fixed procedure, and nothing else. Its one-line JSON answer is
    # the outcome, success or refusal alike.
    # A name already in the inventory is a new version of an installed agent:
    # the update procedure (same subject, same home, restore on failure), not a
    # second deploy, which the procedure rightly refuses (the user exists).
    try:
        with open(f"{FLEET}/deploymgr-agents.json", encoding="utf-8") as f:
            installed = {e.get("name") for e in json.load(f) if isinstance(e, dict)}
    except (OSError, ValueError):
        installed = set()
    verb = "update" if args["name"] in installed else "deploy"
    print(f"[deploy-executor] {rid}: {verb} of {args['name']}", flush=True)
    try:
        p = subprocess.run(["python3", STEPS, verb, argfile],
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

    # 4. The signed deployment record, only for a deploy that ran far enough
    # to record. Kept under the deploymgr's own records like its manual ones.
    record = None
    # A deploy that ran is recorded; so is a refusal, since §11.3 says every
    # act leaves a record and a refusal is an act. A crash with no JSON at
    # all (no `step`) is not a procedure's answer and gets no record.
    if result.get("act") == "deploy" or (not result.get("ok") and result.get("step")):
        # Twice if needed: the first real deploys produced unsigned records
        # because node's cold start under deploy load blew the signer's
        # timeout, and a record signed on the second try beats an unsigned
        # one filed fast.
        for attempt in (1, 2):
            try:
                rp = subprocess.run(["python3", RECORD, DM_IDENTITY],
                                    input=json.dumps(result), capture_output=True, text=True, timeout=180)
                if rp.returncode == 0 and rp.stdout.strip():
                    record = json.loads(rp.stdout)
                    if record.get("signatures"):
                        break
                    print(f"[deploy-executor] record unsigned (attempt {attempt}): {record.get('_unsigned')}", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"[deploy-executor] record step failed (attempt {attempt}): {e}", flush=True)
            time.sleep(5)
        if record is not None:
            os.makedirs(DM_RECORDS, exist_ok=True)
            with open(f"{DM_RECORDS}/{args['name']}-{record.get('act', 'deploy')}.json", "w") as f:
                json.dump(record, f, indent=2)

    return {"ok": bool(result.get("ok")), "result": result, **({"record": record} if record else {})}


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
    return posted


def one_round(state):
    """One pass of the loop: the host report, one queue read, and each request
    on it. Returns how long to sleep before the next pass."""
    erred = False
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
    kept = load_outcomes()
    if queue is not None:
        pruned = prune_outcomes(kept, {r.get("id") for r in queue})
        if len(pruned) != len(kept):
            kept = pruned
            save_outcomes(kept)
    for r in queue or []:
        if not serve_request(r, kept):
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
        main()
    except KeyboardInterrupt:
        sys.exit(0)
