#!/usr/bin/env python3
"""The Deployment Manager's fixed procedures. Runs as root via one sudoers line.

This file IS the "procedure, not improvisation" clause of the role
(agentroles.ai §11.2 rule 5): the agent can only invoke these procedures
whole, with validated parameters. A step that fails stops the run and
reports the step and the state the target was left in; nothing here works
around a failure.

The install follows the Common Agent Specification's chapter 12 (12.7), in
its order: fetch and verify; check the host; make the home and directories;
install dependencies from lockfiles, executing nothing from the package;
bind the systems, credentials by name from the owner's store; set the
ceilings; translate for the harness; mint the identity and bind the
descriptor; start and check, grade stated; record. The reading and checking
half lives in install.py (deployed beside this file), so it can be tested
without a host.

Commands (JSON out on stdout, always):
  deploy <argfile>   argfile is JSON written by the brain under the
                     deploymgr user's own tmp dir
  update <argfile>   a new version of the same package under the same subject
  model <name> <model> [harness]
                     the model an installed agent runs: the provider key, the
                     brain, the bound descriptor and the inventory. Installs
                     no files and changes nothing about what the agent does.
  remove <name>
  runtime <name>     re-state where one agent's work runs, and send it to the
                     owner's page. Deploys nothing; it is how an agent
                     installed before the runtime record existed gets one
  rebind <name>      bind an installed agent's descriptor again from its package
  status             the inventory, with every placed file rehashed
  prepare <deploy|update> <argfile>, land <state> ..., finish <state>
                     a deploy or update in three acts, so the executor can land
                     several agents behind one node restart (see land below).
                     Run only by the executor, as root; not in the sudoers line.

Deployed agents live in their own pm2 config (deploymgr-agents.config.js)
driven by an inventory list (deploymgr-agents.json), so the hand-managed
fleet ecosystem.config.js is never edited by a program.

Where the WORK runs is part of a deploy and defaults to Cloud Run: the agent's
adapter, and so its mailbox, its address and its key, stay on this host, and
the work of the package goes in a job. `placement: "host"` in the argfile, or
DM_PLACEMENT on this host, keeps both here. See place_in_cloud_run.

The per-agent attendant is started only where no fleet supervisor is running on
this host. The generated pm2 config declares it either way, because the
supervisor's roster is built out of those entries. See agent_procs.
"""
import contextlib
import hashlib
import importlib.util
import json
import os
try:
    import fcntl
except ImportError:  # not on Linux; the node lock below then holds nothing
    fcntl = None
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import pwd
except ImportError:
    # Not a POSIX host. The four procedures that make and unmake a unix user
    # refuse in main() rather than here, because the image half makes no user
    # and must still be runnable where this module cannot make one.
    pwd = None


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
    return v + suffix if suffix else v


# Where this procedure keeps its own state. /opt/fleet on a host, and read from
# the environment because the two image procedures need no root and have to be
# runnable outside it. sudo resets the environment, so the four procedures that
# do run as root get the default whatever the brain's shell holds.
FLEET = os.environ.get("DM_FLEET", "/opt/fleet")
LIST = f"{FLEET}/deploymgr-agents.json"
CONF = f"{FLEET}/deploymgr-agents.config.js"
SPEND = f"{FLEET}/deploymgr-spend.json"
LEDGERS = f"{FLEET}/deploymgr-ledgers"
PREV = f"{FLEET}/deploymgr-prev"
# What the image half keeps: which images were built from which packages, and
# which agents have a job somewhere else. Kept apart from the pm2 inventory on
# purpose, because that file drives the pm2 config and a container agent has no
# pm2 processes to write there.
IMAGES = f"{FLEET}/deploymgr-images.json"
CONTAINERS = f"{FLEET}/deploymgr-containers.json"
# The runtime records this host has produced, one per agent name: where each
# agent's WORK runs, as the deploy that arranged it observed. Kept on disk
# before it is sent anywhere, so a control plane that was down when a deploy
# finished costs the freshness of a page and not the fact itself.
RUNTIME_FILE = f"{FLEET}/deploymgr-runtime.json"
# Every call this deployer has made inside a customer's own cloud project, one
# line per call. It is the list we owe them (cloud.py action): their Cloud
# Audit Logs already show the same calls, and the point is that ours agrees.
CLOUD_LOG = f"{FLEET}/deploymgr-cloud-actions.jsonl"
# Where a fetched package and an emitted build context are unpacked. The root
# procedures have always used /tmp; the image procedures do not run as root, so
# the directory is the one the platform gives rather than a path assumed.
STAGING = os.environ.get("DM_STAGING") or tempfile.gettempdir()

# The spend ceiling. Each deployed agent is a running harness that spends model
# calls, so the cost is bounded by bounding how many exist and how fast new
# ones appear. Both fail closed: reaching a limit refuses the deploy with the
# limit named, it does not queue or override. Env-tunable for the operator.
#
# On a host whose agents live on the adapter node, MAX_AGENTS is agents per
# node, not processes per host: every agent costs the node a subscription and
# a folder rather than a process, and memory is what decides the number
# (docs/adapter-node-spec.md sections 7 and 8; the soak test measures it).
MAX_AGENTS = int(os.environ.get("DEPLOYMGR_MAX_AGENTS", "10"))
MAX_DEPLOYS_PER_DAY = int(os.environ.get("DEPLOYMGR_MAX_DEPLOYS_PER_DAY", "20"))
BRAINS = f"{FLEET}/brains"
LOGS = f"{FLEET}/logs"
# The deployment manager's own home, where its tmp and its secret store are.
# Read from the environment so the unprivileged procedures can be exercised
# outside it; sudo strips the environment, so the root procedures get the
# default whatever the brain's shell holds.
DM_HOME = os.environ.get("DM_HOME", "/home/deploymgr")
TOKENS = f"{DM_HOME}/secrets/boot-tokens"
# The owner's credential store: one file per NAME, placed by the owner,
# read here and never by the brain. A request names, this resolves.
CREDENTIALS = f"{DM_HOME}/secrets/credentials"
SIGN_JS = f"{FLEET}/deploymgr-sign.mjs"
ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules"
DESCRIPTOR_TAG = "descriptor-statement-v1"
# The deployment manager's own identity, which is who attests a runtime record:
# the same key its deployment records are signed with, in the same place.
DM_IDENTITY = f"{DM_HOME}/.agentmesh/adapter/identity.json"
# Where the owner's page reads its records, and the bearer this host talks to
# it with. The bearer is the one the deploy executor already holds on this
# machine: a runtime record is the same fleet telling the same control plane
# about the same deploy, and a second secret to provision would be a second
# thing to rotate for no added authority. Unset means this host posts nothing,
# which fails closed.
CONTROL_URL = _am_env("urls.app", "DM_CONTROL_URL", "/v1")
CONTROL_TOKEN_FILE = os.environ.get("DM_CONTROL_TOKEN_FILE", "/opt/fleet/secrets/deploy-executor.token")
# Where a buyer of a priced agent goes to accept its terms. It is an ADDRESS,
# which is why no package carries one (12.6 rule 3) and why this side supplies
# it: a package that named a console would be a package tied to one mesh. It
# is also load-bearing rather than decorative. The SDK's §19.5 gate reads
# `provider.checkout_url` and, finding none, admits the work anyway, because
# refusing a buyer with nowhere to go is worse than doing the job: a price
# placed without this would be advertised and never enforced.
CHECKOUT_URL = _am_env("urls.app", "DM_CHECKOUT_URL", "/agreements")
# The platform a container job answers to, given to a job as MESH_API_BASE
# when neither the package nor an operator set one. A package reads its hosts
# from there, so one image runs against dev or prod by the job it is placed in
# (env split runbook 1.6).
API_BASE = _am_env("urls.app", "DM_API_BASE")
# The account our own jobs run as, when the environment names one (gcp.jobs_sa;
# both environments name one since 2026-10-25). Unnamed, a job runs on the
# project's default compute account.
try:
    JOBS_SA = _am_env("gcp.jobs_sa", "DM_JOBS_SA")
except RuntimeError:
    JOBS_SA = ""
# The account OUR OWN image builds run as, when the environment names one.
# Left out, Cloud Build uses the project's default build account, which on a
# project made since 2024 is the default compute account, usually an Editor;
# and submitting a build as it means this host may act as it, which is the
# same as being it. With a build account named, this host acts as that
# account only, and that account may write images and logs and nothing else.
# A build in a customer's project is theirs and keeps the account they granted.
try:
    BUILD_SA = _am_env("gcp.build_sa", "DM_BUILD_SA")
except RuntimeError:
    BUILD_SA = ""


def build_account_argv(project):
    """The flags that make one of our own builds run as the build account:
    the account, and the two buckets a user-specified account needs named
    (where the source is staged, and where the log goes), both the project's
    own default build bucket. Nothing on a customer's project, or when no
    build account is named."""
    if not BUILD_SA or not project or cloud_now():
        return []
    # An account of the project the build runs in, by its own address: one
    # from another project would need an organization policy these projects
    # do not have, and a malformed one is not passed to gcloud at all.
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]@" + re.escape(project) + r"\.iam\.gserviceaccount\.com", BUILD_SA):
        return []
    return ["--service-account", f"projects/{project}/serviceAccounts/{BUILD_SA}",
            f"--gcs-source-staging-dir=gs://{project}_cloudbuild/source",
            f"--gcs-log-dir=gs://{project}_cloudbuild/logs"]


# The network our own worker jobs run in (egress step 3), when the environment
# names one: gcp.worker_network and gcp.worker_subnet (a subnet in
# gcp.worker_region). Named, every job this host creates or updates on our own
# project sends all its traffic through that VPC with the tags agent-worker
# and w-<name>, which the network's rules target. With gcp.worker_egress
# "observe" the host also makes the agent's own logged allow-all rule,
# egress-observe-<name>, at install and removes it at retire: the observe
# phase, whose logs become the agent's destination list. Unnamed, nothing
# changes. A job in a customer's project never gets these.
def _optional_env(key, override):
    try:
        return _am_env(key, override)
    except RuntimeError:
        return ""


WORKER_NETWORK = _optional_env("gcp.worker_network", "DM_WORKER_NETWORK")
WORKER_SUBNET = _optional_env("gcp.worker_subnet", "DM_WORKER_SUBNET")
WORKER_EGRESS = _optional_env("gcp.worker_egress", "DM_WORKER_EGRESS")
# "observe" makes each agent's logged allow-all rule; "enforce" means the
# agent's own deny-by-default rules are elsewhere (a firewall policy), so an
# observe rule left over from before is taken away at the next deploy, since
# an allow-all VPC rule would otherwise be evaluated before the policy.
if WORKER_EGRESS not in ("", "observe", "enforce"):
    raise RuntimeError(f"gcp.worker_egress is {WORKER_EGRESS!r}; it is observe, enforce, or not set")


def worker_vpc(name):
    """The VPC placement of one agent's worker job, or None."""
    if not WORKER_NETWORK or not WORKER_SUBNET or cloud_now():
        return None
    return {"network": WORKER_NETWORK, "subnet": WORKER_SUBNET, "tags": [IMAGE.WORKER_TAG, IMAGE.worker_tag(name)]}


def observe_rule_argv(name, project, network, delete=False):
    """The agent's own logged allow-all egress rule (the observe phase)."""
    rule = f"egress-observe-{name}"
    where = ["--project", project] if project else []
    if delete:
        return ["compute", "firewall-rules", "delete", rule, *where, "--quiet"]
    return ["compute", "firewall-rules", "create", rule, *where, "--network", network, "--direction", "EGRESS",
            "--priority", "1000", "--action", "ALLOW", "--rules", "all", "--destination-ranges", "0.0.0.0/0",
            "--target-tags", IMAGE.worker_tag(name), "--enable-logging", "--logging-metadata", "include-all",
            "--description", f"Observe phase (egress step 3): everything {name}'s worker reaches is allowed and logged.",
            "--quiet"]


def place_observe_rule(name, project):
    """In the observe phase, make the agent's observe rule (asked first, so a
    second deploy finds it and moves on). Once enforcing, take a leftover one
    away, so it cannot outrank the agent's own rules."""
    if not worker_vpc(name):
        return None
    where = ["--project", project] if project else []
    p, _ = gcloud_quiet(["compute", "firewall-rules", "describe", f"egress-observe-{name}", *where, "--format", "value(name)"], 120)
    if WORKER_EGRESS == "observe":
        if p.returncode != 0:
            gcloud(observe_rule_argv(name, project, WORKER_NETWORK), "job", 300)
        return f"egress-observe-{name}"
    if WORKER_EGRESS == "enforce" and p.returncode == 0:
        gcloud(observe_rule_argv(name, project, WORKER_NETWORK, delete=True), "job", 300)
        return "removed"
    return None


def remove_observe_rule(name, project):
    """Take the agent's observe rule away at retire. Returns None when it is
    gone (or was never there), else the line `remaining` should carry."""
    if not WORKER_NETWORK:
        return None
    p, _ = gcloud_quiet(observe_rule_argv(name, project, WORKER_NETWORK, delete=True), 300)
    err = (p.stderr or "").strip()
    if p.returncode == 0 or re.search(r"not found|was not found|notFound|does not exist", err, re.I):
        return None
    return f"the egress rule egress-observe-{name} was not removed: {err[-200:]}"


# The account the agents that read a caller's own data run as, and which
# installs those are (docs/caller-grants-plan.md, section 6). Only this account
# may act as a customer identity in the grants project, so it is kept off every
# other job: the shared jobs account runs model-driven code too. Both come from
# the environment file; absent, every job runs as before.
try:
    CALLER_GRANT_RUNTIME = _am_env("caller_grants.runtime_sa", "DM_CALLER_GRANT_RUNTIME")
except RuntimeError:
    CALLER_GRANT_RUNTIME = ""
try:
    CALLER_GRANT_INSTALLS = {n.strip() for n in _am_env("caller_grants.runtime_installs", "DM_CALLER_GRANT_INSTALLS").split(",") if n.strip()}
except RuntimeError:
    CALLER_GRANT_INSTALLS = set()


def jobs_account_for(name):
    """The account a job on our own project runs as: the caller-grant runtime
    for an install that reads a caller's own data, else the jobs account.

    The install's NAME alone is not enough, because an installer types it: the
    runtime goes only to an install of that name whose recorded handle is a
    Mesh Provided Agent's (`<name>.platform@agentmesh.ai`), so another owner's
    install that took the same name runs as the jobs account like any other."""
    if CALLER_GRANT_RUNTIME and name in CALLER_GRANT_INSTALLS:
        who = agent_identity(name) or {}
        handle = str(who.get("handle") or "").lower()
        if handle == f"{name}{PROVIDED_ANCHOR}":
            return CALLER_GRANT_RUNTIME
    return JOBS_SA

_here = os.path.dirname(os.path.abspath(__file__))


def _beside(*names):
    return next((os.path.join(_here, n) for n in names if os.path.exists(os.path.join(_here, n))), None)


def _load(name, *files):
    path = _beside(*files)
    if not path:
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


INSTALL = _load("deploymgr_install", "deploymgr-install.py", "install.py")
TRANSLATE = _load("deploymgr_translate", "deploymgr-translate.py", "translate.py")
IMAGE = _load("deploymgr_image", "deploymgr-image.py", "image.py")
RUNTIME = _load("deploymgr_runtime", "deploymgr-runtime.py", "runtime.py")
CLOUD = _load("deploymgr_cloud", "deploymgr-cloud.py", "cloud.py")

# The operator's answers for the container half. None of them is any package's
# to give: a registry, a region, a project and a bucket are addresses, and a
# package carries none (12.6 rule 3). They come from the argfile, and from here
# when the argfile leaves them out.
REGISTRY = os.environ.get("DM_REGISTRY", "")
PROJECT = os.environ.get("DM_PROJECT", "")
# us-south1 since 2026-09-30: from 22:40 UTC on 09-29 a job execution in
# us-east1 waited 3 to 6 minutes to be scheduled, in two separate projects at
# once, while the same job started in 3 to 5 s in us-south1 (technical debt
# 122). us-central1 did the same on 09-23, which is why the work left it then.
REGION = os.environ.get("DM_REGION", "us-south1")
BUCKET = os.environ.get("DM_BUCKET", "")
GCLOUD = os.environ.get("DM_GCLOUD", "gcloud")
# THE ACCOUNT CUSTOMERS GRANT TO, and the middle of the two-hop chain every call
# inside a customer's project runs through: this machine becomes it, and it
# becomes the account the customer made. Read from the environment, never from
# an argfile: an instruction that could name the impersonator would be an
# instruction that could point this deployer at an identity nobody published.
#
# NOT a DM_ name, which is the one place this file departs from its own
# convention and does so on purpose. The DM_ variables are this host's own
# answers -- its registry, its region, its bucket -- and may differ per host.
# This one is the same fact as the platform half's MESH_CLOUD_DEPLOYER_SA, which
# is what the doors answer as `grant_to` and what the customer writes into their
# IAM binding. Two names for it would let the two halves drift, and the drift
# would show up as the platform verifying a chain this deployer does not use.
# One fact, one spelling, on both hosts.
DEPLOYER_SA = os.environ.get("MESH_CLOUD_DEPLOYER_SA", "").strip().lower()
# The home inside the image, which emit-image.mjs bakes as AGENT_HOME. The
# bindings are planned against it so a directory system names the path the
# container will actually see.
IMAGE_HOME = os.environ.get("DM_IMAGE_HOME", "/home/agent")
# The host a deploy lands on, by the name the fleet knows it by. It goes in the
# record's target and in the custody of a key the deploy minted, because a seed
# in a home on this host is a seed this host's root can read.
HOST = os.environ.get("DM_HOST", "agent-fleet")

# EGRESS, AS IT IS (Common Agent 8.3 `egress`, 12.7). Nothing this file makes
# limits what an agent reaches on the network. An agent on this host runs as
# its own Unix user under the supervisor, and nothing on the host filters a
# user's outbound traffic; the work it places in a Cloud Run job, in our
# project or a customer's, runs with no VPC setting, so it leaves by Google's
# own path to the internet. So every record this file makes says `open`,
# enforced by `none`, which is the true record of a target that does not
# restrict. When something here starts to restrict, this is the line that has
# to change with it, and a record must never claim more than that thing does.
EGRESS_OPEN = {"policy": "open", "enforced_by": "none"}
# How long an image build may take before this stops following it. A build that
# outruns it is left running and named, never reported as finished.
BUILD_MINUTES = int(os.environ.get("DM_BUILD_MINUTES", "40"))
# How often a build being followed is asked about (gcloud builds describe).
# Cloud Build says nothing to a caller that is not streaming its log, so it is
# asked; each ask is a gcloud process on a two-core host, which is why this is
# not every second. Fifteen seconds until 2026-10-31.
BUILD_POLL_SECONDS = max(1, int(os.environ.get("DM_BUILD_POLL_SECONDS") or 10))

# WHERE A PACKAGED AGENT'S WORK RUNS, when the owner's instruction does not say.
#
# Cloud Run, because that is what this host is for. An agent installed here gets
# a unix user, a harness and a poller on a two-core box shared with fifteen
# others, and the work of one package is the thing least tied to this machine:
# it needs a filesystem for one message and then nothing. What is actually tied
# here is the mailbox, and it stays here. See place_in_cloud_run.
#
# "host" is the other answer and it is a real one: a host with no registry, no
# bucket and no Cloud Run behind it says so once, here, rather than in every
# argfile. It is an operator's statement about this machine, it is named in
# every deploy's result, and it is never reached by a failure.
PLACEMENTS = ("cloud-run", "host")
DEFAULT_PLACEMENT = os.environ.get("DM_PLACEMENT", "cloud-run")
# The one process that answers for every agent on a multi-agent host
# (runtime/fleet/supervisor.mjs), under the pm2 name this host starts it with.
# Named from the environment because that name belongs to the host, not to this
# procedure.
SUPERVISOR_PROC = os.environ.get("DM_SUPERVISOR_PROC", "fleet-supervisor")
# The adapter node (docs/adapter-node-spec.md): one mesh-adapter process holding
# every agent on this host, each as a folder under NODE_ROOT/agents/<name>,
# running as NODE_USER under the pm2 name NODE_PROC. A host has one node; the
# root, the user and the name belong to the host, so they come from the
# environment. Whether the node holds this host's agents is node_here().
NODE_ROOT = os.environ.get("DM_NODE_ROOT", "/opt/fleet/node")
NODE_USER = os.environ.get("DM_NODE_USER", "mesh-node")
NODE_PROC = os.environ.get("DM_NODE_PROC", "mesh-node")
# One node per account: a node credential covers one account, so a host that
# holds agents of two accounts runs two nodes (docs/adapter-node-migration.md
# section 8). This file maps an owner id (account or organisation) to the
# node that holds its agents; an owner not in it lands on the host's default
# node above. Written by the operator, read at every deploy.
NODE_ROOTS = os.environ.get("DM_NODE_ROOTS", f"{FLEET}/node-roots.json")


def node_for_owner(owner):
    """The node that holds this owner's agents: root, user and process name.
    `owner` is the deploy request's owner member ({kind, id}) or an id; the
    default node stands when nothing names another."""
    default = {"root": NODE_ROOT, "user": NODE_USER, "proc": NODE_PROC}
    oid = owner.get("id") if isinstance(owner, dict) else owner
    if not oid or not os.path.exists(NODE_ROOTS):
        return default
    try:
        table = json.load(open(NODE_ROOTS))
    except (OSError, ValueError):
        return default
    row = table.get(str(oid)) if isinstance(table, dict) else None
    if not isinstance(row, dict) or not row.get("root"):
        return default
    return {"root": row["root"], "user": row.get("user") or NODE_USER, "proc": row.get("proc") or NODE_PROC}

# Up to 32 chars (the useradd ceiling), no trailing hyphen — and the same
# rule the deploy-request approve door enforces, so a name the operator
# approved cannot die here ("contract-reviewer", 17 chars, did exactly that
# under the old {2,15}).
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}[a-z0-9]$")
HANDLE_RE = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$")
TOKEN_NAME_RE = re.compile(r"^[a-z0-9-]{1,32}$")
# "@" for a Vertex model's version, as opencode lists Claude on Vertex:
# google-vertex-anthropic/claude-sonnet-5-5@default (2026-09-29).
MODEL_RE = re.compile(r"^[a-z0-9/._-]{1,64}(@[a-z0-9._-]{1,32})?$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
# There is no default model in this file (technical debt 619). Which model a
# harness wakes is the owner's instruction, and where the instruction names
# none it is this host's model setting (harness_model): model.harness, else
# model.name, reached through the host's model gateway.

# The brain: how this host starts a harness, one cold boot per message. The
# placed environment is sourced first, so the skills' scripts read every
# credential, setting and ceiling from variables and nothing else.
SOURCE_ENV = '[ -f "$HOME/.config/fleet/env" ] && . "$HOME/.config/fleet/env"\n'

# The model the owner chose reaches the harness, and its provider's key is
# exported. Until 2026-09-10 this template exported one provider's key and
# passed no model at all, so the model on a deploy record was a claim about
# the agent that nothing on the host applied. The two braces are filled in
# by brain_text below.
OPENCODE_BRAIN = """#!/bin/bash
# Generated by the Deployment Manager. OpenCode cold, one boot per message.
export PATH="$HOME/.opencode/bin:$PATH"
{key_line}
""" + SOURCE_ENV + """cd "$HOME" || exit 1
opencode run{model_flag} "$1" </dev/null 2>/dev/null | sed 's/\\x1b\\[[0-9;]*m//g' | grep -v "^> build" | sed '/^\\s*$/d'
"""

CODEX_BRAIN = """#!/bin/bash
# Generated by the Deployment Manager. Codex cold, one boot per message.
# The model is Claude on Vertex AI through the host's responses-bridge, named
# in ~/.codex/config.toml; no key is read.
""" + SOURCE_ENV + """cd "$HOME" || exit 1
out=$(mktemp)
/usr/bin/codex exec --skip-git-repo-check --sandbox workspace-write \\
  --output-last-message "$out" "$1" >/dev/null 2>&1 </dev/null
cat "$out"
rm -f "$out"
"""

# Which provider a model string names, the variable that provider's client
# reads, where the key is placed in the agent's home, and the NAME the owner's
# credential store holds it under. A model naming a provider whose key is not
# in the store is refused, never quietly swapped for another provider.
# Since 2026-10-03 (owner) every Claude call goes through Vertex AI; a model
# naming a provider not listed here is refused.
PROVIDERS = {
    "google": ("GOOGLE_GENERATIVE_AI_API_KEY", ".config/fleet/gemini.key", "fleet-gemini-api-key"),
    "anthropic": ("ANTHROPIC_API_KEY", ".config/fleet/anthropic.key", "fleet-anthropic-api-key"),
    # Claude on Google Vertex AI (since 2026-09-29; the only way to Claude
    # since 2026-10-03). No key: opencode's google-vertex-anthropic provider takes a token
    # from the machine's service account (the metadata server on Cloud Run and
    # on this host), so what is placed is where to call, not a credential. The
    # provider name is opencode's own, so the model string passes to the
    # harness as it is, e.g. google-vertex-anthropic/claude-sonnet-5-5@default.
    "google-vertex-anthropic": (None, None, None),
    # The host's model gateway (technical debt 619): the model the host's
    # model setting names, at model.endpoint in model.protocol, with no key.
    # opencode is told of it in its own configuration (install.GATEWAY_PROVIDER,
    # gateway_provider below), and a job is told where it is (keyless_vars).
    "model-gateway": (None, None, None),
}
GATEWAY_PROVIDER = "model-gateway"
NO_MODEL = ("no model: the instruction names none, and this host's environment has neither model.harness nor "
            "model.name, so there is no model for the harness to wake and none is substituted")

# Where a keyless provider is called, as the variables its client reads. The
# project is the one Claude is enabled in, and "us" is the owner's choice of
# endpoint (the US multi-region, aiplatform.us.rep.googleapis.com).
VERTEX_PROJECT = _am_env("vertex.project", "DM_VERTEX_PROJECT")
VERTEX_LOCATION = os.environ.get("DM_VERTEX_LOCATION", "us")
KEYLESS_VARS = {"google-vertex-anthropic": {"GOOGLE_CLOUD_PROJECT": VERTEX_PROJECT,
                                            "GOOGLE_CLOUD_LOCATION": VERTEX_LOCATION}}
# Where a brain ON THIS HOST gets the token for a keyless provider. The host
# keeps every agent's own unix user off its real metadata server (the token
# there is the host's account), and runs a stand-in on loopback that answers
# the same paths with a token for an account that may call models and do
# nothing else. Google's client libraries read GCE_METADATA_HOST for exactly
# this. Only the host brain gets it: a Cloud Run job's own metadata server is
# its own account, and pointing a job at loopback would leave it with none.
# Empty turns it off, for a host without the stand-in. The value is written
# into a shell script, so anything but host:port is ignored for the default.
# (sudo strips the environment, so the root procedures always see the default.)
HOST_MODEL_METADATA_DEFAULT = "127.0.0.1:89"


def host_model_metadata(value):
    v = str(value if value is not None else HOST_MODEL_METADATA_DEFAULT).strip()
    return v if v == "" or re.fullmatch(r"[0-9A-Za-z.-]+:[0-9]{1,5}", v) else HOST_MODEL_METADATA_DEFAULT


HOST_MODEL_METADATA = host_model_metadata(os.environ.get("DM_HOST_MODEL_METADATA"))


def provider_of(model):
    """The provider a model string names, or None when it names none."""
    head = str(model or "").split("/", 1)[0]
    return head if head in PROVIDERS else None


def keyless_vars(prov):
    """The variables a keyless provider is called with; {} for a provider
    that is paid for with a key. The host's model gateway is told by where it
    is and what it speaks, from this host's model setting."""
    if prov == GATEWAY_PROVIDER:
        values, _ = host_model_defaults()
        return {"MODEL_ENDPOINT": values.get("MODEL_ENDPOINT", "").rstrip("/"),
                "MODEL_PROTOCOL": values.get("MODEL_PROTOCOL", "")}
    return dict(KEYLESS_VARS.get(prov) or {})


def host_harness_model():
    """This host's model for a harness the instruction gives none: the
    environment's model.harness, else its model.name; "" when it has neither.
    Each read by its exact name."""
    for key, override in (("model.harness", "DM_MODEL_HARNESS"), ("model.name", "DM_MODEL_NAME")):
        v = _optional_env(key, override)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def harness_model(*instructed, harness="opencode"):
    """The model a harness wakes (technical debt 619). The first model the
    instruction names, or the row that recorded an earlier one, wins as it is.
    With none, this host's model setting (host_harness_model): a value that
    names a provider passes as it is, and any other is reached through the
    host's model gateway, as model-gateway/<model> for opencode and by its
    bare name for codex, whose configuration already names the gateway.
    "" when nothing names a model: no model is ever substituted. A gateway
    model is checked against the host's gateway here (gateway_provider)."""
    model = next((m.strip() for m in instructed if isinstance(m, str) and m.strip()), "")
    if not model:
        host = host_harness_model()
        if not host or provider_of(host) or harness != "opencode":
            model = host
        else:
            model = f"{GATEWAY_PROVIDER}/{host}"
    if provider_of(model) == GATEWAY_PROVIDER:
        gateway_provider(model)
    return model


def gateway_provider(model):
    """{model, endpoint, protocol} for a model spelled model-gateway/<model>:
    the host's model gateway, from model.endpoint and model.protocol; None for
    any other model. A host whose model block leaves the endpoint or the
    protocol out, or names a key for it, is refused: the harness reaches the
    gateway on the agent's own host, which takes no key."""
    if provider_of(model) != GATEWAY_PROVIDER:
        return None
    values, cred = host_model_defaults()
    endpoint = values.get("MODEL_ENDPOINT", "").rstrip("/")
    protocol = values.get("MODEL_PROTOCOL", "")
    if not endpoint:
        fail("validate", f"the model {model} is the host's model gateway, and this host's environment has no "
                         "model.endpoint to reach it at")
    if protocol not in INSTALL.GATEWAY_CLIENTS:
        fail("validate", f"the model {model} is the host's model gateway, and this host's model.protocol "
                         f"{protocol!r} is not one of {', '.join(INSTALL.GATEWAY_CLIENTS)}")
    if cred:
        fail("validate", f"the model {model} is the host's model gateway, and this host's model.key names a "
                         "credential; a harness reaches the gateway on its own host, which takes none")
    return {"model": model.split("/", 1)[1], "endpoint": endpoint, "protocol": protocol}


def provider_var_names():
    """Every variable name a provider places, key or location: the names an
    update recognises as this side's own on a job."""
    return {v for v, _, _ in PROVIDERS.values() if v} | {n for d in KEYLESS_VARS.values() for n in d}


def brain_text(harness, model):
    """The brain script for this harness, carrying the owner's model."""
    if harness != "opencode":
        return BRAIN_TEMPLATES[harness]
    prov = provider_of(model) or "google"
    var, keyfile, _ = PROVIDERS[prov]
    # On a host the gateway is named in opencode's own configuration
    # (translate_for_harness), so the brain exports nothing for it.
    here = {} if prov == GATEWAY_PROVIDER else keyless_vars(prov)
    if not var and here and HOST_MODEL_METADATA:
        here.update({"GCE_METADATA_HOST": HOST_MODEL_METADATA, "GCE_METADATA_IP": HOST_MODEL_METADATA})
    key_line = (f'export {var}="$(cat "$HOME/{keyfile}")"' if var else
                "; ".join(f"export {k}={v}" for k, v in here.items()))
    return OPENCODE_BRAIN.format(
        key_line=key_line,
        model_flag=f" --model {model}" if provider_of(model) else "")


BRAIN_TEMPLATES = {"opencode": OPENCODE_BRAIN, "codex": CODEX_BRAIN}
# The harnesses this host can start: the ones with a brain template AND a
# row in the installer's table. The coverage claim is exactly this.
HARNESS_CHOICES = tuple(k for k in (INSTALL.HARNESSES if INSTALL else {}) if k in BRAIN_TEMPLATES)

PM2_CONF = """// Generated by the Deployment Manager on every inventory change; agents come
// from the JSON list. The hand-managed fleet lives in ecosystem.config.js and
// is never touched.
const agents = require("/opt/fleet/deploymgr-agents.json");
const apps = [];
// The adapter node (docs/adapter-node-spec.md): ONE process for every agent
// whose inventory row names a node_root. Written once per root, and an agent
// on the node gets no adapter entry of its own; its attendant entry stays as
// the roster's record and carries NODE_ROOT so the supervisor reads that
// agent through the node.
// Every agent installed here acts for the account that owns it, an
// organization, never for one person (Common Agent 6.2): --acts-for says so,
// so none of them takes a message written to a person.
for (const root of [...new Set(agents.map((a) => a.node_root).filter(Boolean))]) {
  const node = agents.find((a) => a.node_root === root);
  apps.push({
    name: node.node_proc || "mesh-node",
    script: "/usr/bin/mesh-adapter",
    args: "start --inbox --unattended --acts-for organization",
    interpreter: "none",
    uid: node.node_user || "mesh-node", gid: node.node_user || "mesh-node",
    env: { HOME: `/home/${node.node_user || "mesh-node"}`, MESH_ADAPTER_STATE: root,
           CATALOG_URL: "__CATALOG_URL__" },
    max_restarts: 20, restart_delay: 5000, autorestart: true,
    out_file: `/opt/fleet/logs/${node.node_proc || "mesh-node"}.log`,
    error_file: `/opt/fleet/logs/${node.node_proc || "mesh-node"}.err`,
    merge_logs: true, log_date_format: "YYYY-MM-DD HH:mm:ss",
  });
}
for (const a of agents) {
  // --kind publishes which program answers, so the agent's record says it
  // was installed on opencode (or codex) rather than leaving it undeclared.
  // The owner chose the harness when they approved the deploy, so this is
  // their statement, not ours. Older inventory rows say "framework".
  const harness = a.harness || a.framework || "";
  if (!a.node_root) apps.push({
    name: `${a.name}-adapter`,
    script: "/usr/bin/mesh-adapter",
    args: `start --inbox --name ${a.name}${a.interaction === "service" ? " --unattended" : ""}${harness ? ` --kind ${harness}` : ""} --acts-for organization`,
    interpreter: "none",
    uid: a.name, gid: a.name,
    env: { HOME: `/home/${a.name}`, MESH_CREDS_FILE: `/home/${a.name}/.config/fleet/mesh.creds`,
           CATALOG_URL: "__CATALOG_URL__", STREAM_BRAIN: `/opt/fleet/brains/${a.name}.sh "$PROMPT"` },
    max_restarts: 20, restart_delay: 5000, autorestart: true,
    out_file: `/opt/fleet/logs/${a.name}-adapter.log`,
    error_file: `/opt/fleet/logs/${a.name}-adapter.err`,
    merge_logs: true, log_date_format: "YYYY-MM-DD HH:mm:ss",
  });
  apps.push({
    name: `${a.name}-attendant`,
    script: "/opt/fleet/attendant-fast.sh",
    interpreter: "bash",
    uid: a.name, gid: a.name,
    // The package's own word on how long one job may take (the runtime
    // requirements' job_seconds) becomes the attendant's cap; the hard kill trails it.
    // Its word on reading replies (the runtime requirements' wants_replies, a runner)
    // lifts the attendant's loop guard for this one agent.
    env: { HOME: `/home/${a.name}`, AGENT_NAME: a.name, BRAIN: `/opt/fleet/brains/${a.name}.sh`, POLL_SECS: "0.25",
           // The node that holds this agent, for runtime/fleet/roster.mjs:
           // the supervisor then reads this agent's session API through the
           // node's one socket, under /agents/<name>.
           ...(a.node_root ? { NODE_ROOT: a.node_root } : {}),
           ...(Number.isInteger(a.job_seconds) && a.job_seconds > 0
               ? { WORK_TIMEOUT: String(a.job_seconds), WORK_HARD_KILL: String(a.job_seconds + 120) } : {}),
           ...(a.wants_replies === true ? { WANTS_REPLIES: "1" } : {}),
           // The owner's ceiling on this agent's jobs in flight (steps.py
           // JOBS_AT_ONCE_MOST says why). The attendant ignores it; the fleet
           // supervisor reads it off this entry through the roster.
           ...(Number.isInteger(a.jobs_at_once) && a.jobs_at_once > 0
               ? { JOBS_AT_ONCE: String(a.jobs_at_once) } : {}),
           // The command this package names for its job, placed outside the
           // agent's home. An attendant that has one runs it and never wakes
           // a model to decide whether to.
           ...(a.run_spec === true ? { RUN_SPEC: `/opt/fleet/runs/${a.name}.json` } : {}) },
    max_restarts: 20, restart_delay: 5000, autorestart: true,
    out_file: `/opt/fleet/logs/${a.name}-attendant.log`,
    error_file: `/opt/fleet/logs/${a.name}-attendant.err`,
    merge_logs: true, log_date_format: "YYYY-MM-DD HH:mm:ss",
  });
}
module.exports = { apps };
"""

# The inventory entry of the deploy in progress, so a failure after the
# home exists leaves an entry that names its state and `remove` can clean.
# What this act is in the middle of. `entry` is the half-made agent, so a
# refusal can name it; `cloud` is the customer's project this act is acting
# inside, so every gcloud call runs under their service account and every
# result says which project it touched. Both are set once and read from
# everywhere, because the alternative is passing them down through a dozen
# procedures and the failure that design has is the one call site that forgets.
CURRENT = {"entry": None, "cloud": None}


def out(obj):
    release_node_lock(all_of_it=True)
    print(json.dumps(obj))
    sys.exit(0 if obj.get("ok") else 1)


def fail(step, error, state=None, **extra):
    entry = CURRENT.get("entry")
    # Every refusal made during an act inside a customer's project says which
    # project, under which account, what the last call meant and what we did
    # there. Added HERE rather than at each fail() so no refusal can leave it
    # out, and empty on our own machines, where there is nothing to disclose
    # and no customer to disclose it to.
    extra = {**cloud_report(), **extra}
    # What to put back before this refusal is printed. An update that has
    # already placed the new version on this host and then cannot build its
    # image or re-create its job sets this to the restore, so the host half
    # goes back to the version the job is still running and the record says
    # so. Taken once, and never left armed for a later act.
    put_back = CURRENT.get("on_fail")
    if put_back is not None:
        CURRENT["on_fail"] = None
        try:
            said = put_back(step)
        except Exception as e:  # noqa: BLE001
            said = f"putting the old version back failed too: {str(e)[:200]}"
        if said:
            state = f"{said}; {state}" if state else said
    if entry is not None:
        entry["state"] = f"failed at {step}"
        replace_row(entry)
        # The half-made agent is named WHATEVER ELSE the step had to say. A step
        # that named its own state used to replace this line, which was harmless
        # while every step ran before the user existed and stopped being so when
        # a deploy began building an image after the install: a build that
        # overran its deadline reported the build and left the agent it had
        # already installed out of the only sentence an operator acts on.
        here = f"user and home exist; run remove {entry['name']} to clean"
        state = f"{state}; {here}" if state else here
    out({"ok": False, "step": step, "error": str(error)[:800], "state": state or "nothing created", **extra})


def run(cmd, step, timeout=120, input_text=None):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input_text)
    except subprocess.TimeoutExpired:
        fail(step, f"timed out after {timeout}s: {' '.join(cmd[:4])}")
    if p.returncode != 0:
        fail(step, (p.stderr or p.stdout or "nonzero exit").strip()[:400])
    return p.stdout


def as_user(name, shellcmd, step, timeout=120):
    return run(["su", "-", name, "-c", shellcmd], step, timeout)


def load_list():
    return json.load(open(LIST)) if os.path.exists(LIST) else []


# ── the inventory lock ────────────────────────────────────────────────────
#
# The inventories (deploymgr-agents.json, deploymgr-containers.json,
# deploymgr-images.json, the runtime records and the spend file) are read,
# changed and written whole. While the executor ran one request at a time
# nothing else wrote them during an act. With installs running side by side
# (deploy-executor.py, DM_INSTALL_WORKERS), one act's image half can write the
# container inventory while another act writes the agent inventory, so every
# read-change-write of these files holds this host-wide lock for the few
# milliseconds it takes. It is never held while anything slow runs, and an act
# re-enters it, so it cannot wait on itself.
INVENTORY_LOCK = os.environ.get("DM_INVENTORY_LOCK", f"{FLEET}/deploymgr-inventory.lock")
_INVENTORY_LOCK = {"fd": None, "depth": 0}


@contextlib.contextmanager
def inventory_lock():
    """Hold the inventory lock for a block. Re-entrant within one process."""
    if _INVENTORY_LOCK["depth"] or fcntl is None:
        _INVENTORY_LOCK["depth"] += 1
        try:
            yield
        finally:
            _INVENTORY_LOCK["depth"] -= 1
        return
    os.makedirs(os.path.dirname(INVENTORY_LOCK) or ".", exist_ok=True)
    fd = os.open(INVENTORY_LOCK, os.O_RDONLY | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        _INVENTORY_LOCK.update(fd=fd, depth=1)
        try:
            yield
        finally:
            _INVENTORY_LOCK.update(fd=None, depth=0)
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def save_list(agents):
    with inventory_lock():
        with open(LIST + ".tmp", "w") as f:
            json.dump(agents, f, indent=2)
        os.replace(LIST + ".tmp", LIST)
        # Rewritten every time: the file is generated from the template alone, so
        # a template change reaches the host on the next inventory change.
        with open(CONF + ".tmp", "w") as f:
            # The catalog the nodes read comes from the environment (debt 151).
            # The prod fleet host had https://agentcatalog.com patched in by hand
            # over the old VM's internal address, which no host reaches any more
            # (ported 2026-10-05).
            f.write(PM2_CONF.replace("__CATALOG_URL__", _am_env("urls.catalog")))
        os.replace(CONF + ".tmp", CONF)


def replace_row(entry):
    """Write one agent's row into the inventory, read fresh under the lock, so
    a row another act wrote a moment ago is kept."""
    with inventory_lock():
        save_list([a for a in load_list() if a["name"] != entry["name"]] + [entry])


def spend_check_and_record(agents):
    """The spend ceiling, checked before a deploy does any work.

    Two limits, both fail closed: a cap on how many agents can be deployed at
    once, and a cap on deploys per rolling 24h. A deploy that would breach
    either is refused with the limit named. The day window is a list of recent
    deploy timestamps, pruned to 24h on each check.

    It counts agent NAMES and not rows. A placed agent has a row in each
    inventory, the host one for the adapter that holds its mailbox and the
    container one for the work, and it is one agent. Counting rows would have
    turned a ceiling of ten agents into a ceiling of five on the day Cloud Run
    became the default placement.
    """
    names = {a.get("name") for a in agents if isinstance(a, dict) and a.get("name")}
    if len(names) >= MAX_AGENTS:
        fail("spend", f"deploy refused: at the ceiling of {MAX_AGENTS} deployed agents "
                      f"(remove one first, or raise DEPLOYMGR_MAX_AGENTS)")
    with inventory_lock():
        try:
            hist = json.load(open(SPEND)).get("deploys", []) if os.path.exists(SPEND) else []
        except Exception:  # noqa: BLE001
            hist = []
        now = time.time()
        hist = [t for t in hist if isinstance(t, (int, float)) and now - t < 86400]
        if len(hist) >= MAX_DEPLOYS_PER_DAY:
            fail("spend", f"deploy refused: {MAX_DEPLOYS_PER_DAY} deploys already in the last 24h "
                          f"(the daily ceiling; it resets as older deploys age out)")
        hist.append(now)
        with open(SPEND + ".tmp", "w") as f:
            json.dump({"deploys": hist}, f)
        os.replace(SPEND + ".tmp", SPEND)


def canonical(obj):
    """The record.py subset of RFC 8785, sufficient for these documents."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign_with_identity(identity_path, message):
    """Ed25519 over the message with the agent's identity seed, via the same
    signer the deployment record uses. None on any failure, never a raise:
    each caller decides what an unsigned document means. A bound descriptor
    is never installed unsigned (Common Agent 4.9), so bind_descriptor ends
    the act; other records say they are unsigned."""
    try:
        p = subprocess.run(["node", SIGN_JS, identity_path],
                           capture_output=True, text=True, timeout=30,
                           input=message,
                           env={**{k: v for k, v in os.environ.items() if not k.startswith("NODE_CHANNEL")}, "NODE_PATH": ADAPTER_MODULES})
        return p.stdout.strip() if p.returncode == 0 and p.stdout.strip() else None
    except Exception:  # noqa: BLE001
        return None


# ── the runtime record: where the WORK runs (runtime.py) ──────────────────
#
# Produced at the end of every act that decides where an agent's work happens,
# from the inventory row that act just saved. It is not a second inventory: the
# row is the input, and this only states it in the shape the owner's page reads.
#
# Nothing here can fail a deploy. Every step is wrapped and the outcome comes
# back as words for the result, because a page that is a few minutes stale is a
# far smaller harm than a finished install reported as a refusal.


def control_bearer():
    try:
        return open(CONTROL_TOKEN_FILE, encoding="utf-8").read().strip()
    except OSError:
        return ""


def dm_identity_key():
    """The deployment manager's own public key, which is what `by` names on a
    record it attests. Absent where this host has no identity file, and the
    record then says who it is from as plainly as it can."""
    try:
        return json.load(open(DM_IDENTITY, encoding="utf-8")).get("public_key") or "deployment-manager"
    except Exception:  # noqa: BLE001
        return "deployment-manager"


def agent_identity(name):
    """The key and handle of the installed agent of this name, from the host
    inventory. A container deploy arranges where an agent's WORK runs; the
    agent itself is the host install that holds the key and drains the inbox,
    and that install is where its identity is recorded."""
    entry = next((a for a in load_list() if a.get("name") == name), None)
    if not entry or not entry.get("agent_key"):
        return None
    return {"key": entry["agent_key"], "handle": entry.get("handle"), "name": name}


def record_runtime(entry, agent, kind=None):
    """Build, sign, save and send one runtime record. Returns what the deploy
    result should say about it, and never raises."""
    if RUNTIME is None:
        return {"recorded": False, "why": "no runtime module beside this procedure"}
    if not agent or not agent.get("key"):
        return {"recorded": False,
                "why": f"{entry.get('name')} is not in the host inventory, so there is no agent key to "
                       f"file a runtime record under"}
    try:
        doc = RUNTIME.build(entry, agent=agent, adapter_host=HOST, produced_at=now_iso(),
                            by=dm_identity_key(), kind=kind)
        doc = RUNTIME.signed(doc, sign_with_identity(DM_IDENTITY, RUNTIME.message(doc)), dm_identity_key())
        with inventory_lock():
            save_json_list(RUNTIME_FILE,
                           [r for r in load_json_list(RUNTIME_FILE)
                            if (r.get("agent") or {}).get("key") != agent["key"]] + [doc])
    except Exception as e:  # noqa: BLE001
        return {"recorded": False, "why": str(e)[:200]}
    ok, why = RUNTIME.publish(doc, CONTROL_URL, control_bearer())
    return {"recorded": True, "signed": bool(doc.get("signatures")), "published": ok,
            **({"why": why} if why else {})}


def publish_runtime_for(name):
    """Re-state where this agent's work runs, from whichever inventory is the
    authority right now.

    Which inventory is the authority is runtime.which_entry's decision, so it
    is settled in one testable place rather than here."""
    if RUNTIME is None:
        return {"recorded": False, "why": "no runtime module beside this procedure"}
    agent = agent_identity(name)
    kind, entry = RUNTIME.which_entry(name, load_json_list(CONTAINERS), load_list())
    if entry:
        return record_runtime(entry, agent, kind=kind)
    return forget_runtime((agent or {}).get("key"))


def forget_runtime(agent_key, removed=False):
    """Withdraw the runtime record for an agent this host no longer runs the
    work for. Silent where there was never one. `removed` is set only by
    remove(): the install is gone from this host, not just its work."""
    if RUNTIME is None or not agent_key:
        return {"retracted": False}
    try:
        with inventory_lock():
            save_json_list(RUNTIME_FILE, [r for r in load_json_list(RUNTIME_FILE)
                                          if (r.get("agent") or {}).get("key") != agent_key])
    except Exception:  # noqa: BLE001
        pass
    ok, why = RUNTIME.retract(agent_key, CONTROL_URL, control_bearer(), removed=removed)
    return {"retracted": ok, **({"why": why} if why else {})}


def user_exists(name):
    try:
        pwd.getpwnam(name)
        return True
    except KeyError:
        return False
    except AttributeError:  # no pwd: main() has already refused this command
        return False


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_text(path, text, mode=None, owner=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    if mode is not None:
        os.chmod(path, mode)
    if owner:
        run(["chown", f"{owner}:{owner}", path], "chown")


def allowed_hosts():
    # Where packages may come from: the catalog, plus the mesh's own
    # deploy-request queue (the builder's filed bytes, served at an
    # unguessable id). Extendable by env for a self-hosted control plane.
    return [h.strip() for h in (os.environ.get("DM_PACKAGE_HOSTS") or
                                f"{_am_env('urls.catalog')}/,{_am_env('urls.app')}/v1/deploy-requests/"
                                ).split(",") if h.strip()]


def read_stack_bindings(args):
    """What the account's stack bound for this deploy, from the instruction.

    The platform resolves a package's declared systems against the
    organisation's stack and writes the answer here (docs/account-stack.md
    section 7), so the deployment record can say afterwards what the agent was
    actually bound to and which precedence step supplied it. Names only.

    Refused rather than trimmed if an entry carries anything that looks like a
    value: rule 3 says a value appears in no record, and an instruction that
    tried to put one here is a bug worth stopping on rather than quietly
    cleaning up. Absent is fine and means this deploy was not filled from a
    stack, which is every deploy made before it existed.
    """
    raw = args.get("stack_bindings")
    if raw is None:
        return []
    if not isinstance(raw, list):
        fail("validate", "stack_bindings must be a list of bindings, names only")
    out = []
    for b in raw:
        if not isinstance(b, dict) or not isinstance(b.get("system"), str) or not b["system"]:
            fail("validate", "each stack binding names a system")
        for forbidden in ("value", "secret", "key_value", "credential_value"):
            if forbidden in b:
                fail("validate", f"a stack binding carries {forbidden}; a value belongs in no record")
        # A credential here is a NAME, checked by the same rule the instruction's
        # own credentials are. The instruction-wide value sweep no longer reads
        # this list (check_instruction), so this is where a value dressed as a
        # name is caught, member by member, before it reaches a signed record.
        cred = b.get("credential")
        if cred is not None and not (isinstance(cred, str) and INSTALL.CREDENTIAL_RE.match(cred)):
            fail("validate", f"stack binding {b['system']}: the credential must be a NAME in a store, never a value")
        kept = {k: b[k] for k in ("system", "product", "environment", "precedence",
                                  "provided_by", "credential", "address", "checked")
                if k in b and b[k] is not None}
        # Which store the name is looked up in, which is the fact the ruling of
        # 2026-09-15 made the record's to carry. Kept as its three plain members
        # and nothing else. `proven` was read here until the same day; it
        # belonged to the design that held keys, and nothing emits it any more.
        store = b.get("key_store")
        if isinstance(store, dict) and isinstance(store.get("kind"), str):
            kept["key_store"] = {k: store[k] for k in ("kind", "project", "region")
                                 if isinstance(store.get(k), str) and store[k]}
        out.append(kept)
    return out


def store_has(name):
    return os.path.exists(f"{CREDENTIALS}/{name}.secret")


def store_read(name):
    return open(f"{CREDENTIALS}/{name}.secret", encoding="utf-8").read().strip()


# ── the steps shared by deploy and update ─────────────────────────────────

# 2026-09-25: the answers that mean "not now" rather than "no". The platform's
# rate limiter answered 429 to a package fetch while several requests were
# filed close together, and a placed deploy fetches the same package three
# times (host install, image, job), the later two after the name is bound and
# the identity minted. One refused fetch then left a half-made agent behind.
# These three are asked again; a 404 or a digest that does not match is a real
# refusal and still stops the step at once.
FETCH_RETRY_CODES = (429, 502, 503)
FETCH_TRIES = 3
# Waits between tries when the server does not say how long: short, because a
# deploy is waiting on it. Whatever the server asks for is capped at a minute.
FETCH_BACKOFF = (5, 15)
FETCH_WAIT_CAP = 60


def retry_after_seconds(err, attempt):
    """How long to wait after a "not now": the Retry-After header when there is
    one, else the retry_after_ms our own limiter puts in its body, else the
    backoff for this attempt. Never more than FETCH_WAIT_CAP."""
    asked = None
    try:
        header = (err.headers or {}).get("Retry-After")
        if header and str(header).strip().isdigit():
            asked = int(str(header).strip())
    except Exception:  # noqa: BLE001
        asked = None
    if asked is None:
        try:
            ms = json.loads(err.read().decode("utf-8", "replace")).get("retry_after_ms")
            if isinstance(ms, (int, float)) and ms >= 0:
                asked = ms / 1000.0
        except Exception:  # noqa: BLE001
            asked = None
    if asked is None:
        asked = FETCH_BACKOFF[min(attempt, len(FETCH_BACKOFF)) - 1]
    return max(0.0, min(float(asked), FETCH_WAIT_CAP))


def fetch_package(url, dest):
    """Download a package to dest, asking again after a 429, 502 or 503.

    2026-09-25: the fetch from this mesh's own deploy-request queue carries the
    executor's bearer, the same one this host already posts its runtime records
    with, so the platform can tell the executor's fetch from anyone else's and
    leave it out of the per-address limit this host shares with every agent on
    it. Only to that queue: a package on the catalog is fetched as it always
    was, and the header is one urllib does not carry across a redirect."""
    req = urllib.request.Request(url)
    queue = f"{CONTROL_URL.rstrip('/')}/deploy-requests/"
    if url.startswith(queue):
        token = control_bearer()
        if token:
            req.add_unredirected_header("Authorization", f"Bearer {token}")
    for attempt in range(1, FETCH_TRIES + 1):
        try:
            with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return
        except urllib.error.HTTPError as e:
            if e.code not in FETCH_RETRY_CODES:
                fail("fetch", f"could not fetch the package: {e}")
            if attempt == FETCH_TRIES:
                fail("fetch", f"could not fetch the package: {e} (asked {FETCH_TRIES} times)")
            time.sleep(retry_after_seconds(e, attempt))
        except Exception as e:  # noqa: BLE001
            fail("fetch", f"could not fetch the package: {e}")


def fetch_and_verify(name, url, expected_sha):
    """Step 1. Fetch, hash FIRST, then extract (runbook lesson: hash before
    extract), then read the package and refuse one that does not hold
    together. Returns (staging dir, package dir, digest, package facts)."""
    if not (url.endswith("/package.tar.gz") and any(url.startswith(h) for h in allowed_hosts())):
        fail("validate", "package_url must be a package.tar.gz on an allowed host (the catalog or this mesh's deploy-request queue)")
    if expected_sha and not SHA256_RE.match(expected_sha):
        fail("validate", "sha256 must be the package's hex digest")
    tgz = os.path.join(STAGING, f"dm-{name}.tar.gz")
    staging = os.path.join(STAGING, f"dm-{name}-pkg")
    fetch_package(url, tgz)
    sha256 = hashlib.sha256(open(tgz, "rb").read()).hexdigest()
    if expected_sha and sha256 != expected_sha:
        fail("fetch", f"the bytes fetched hash to {sha256}, not the digest the instruction names; nothing extracted")
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging)
    with tarfile.open(tgz) as t:
        # No path escapes: every member must stay inside the staging dir.
        # (Older Pythons lack the extractall filter= argument, so check here.)
        base = os.path.realpath(staging)
        for m in t.getmembers():
            dest = os.path.realpath(os.path.join(staging, m.name))
            if not (dest == base or dest.startswith(base + os.sep)):
                fail("fetch", f"package member escapes staging: {m.name}")
            if m.issym() or m.islnk():
                fail("fetch", f"package member is a link, which a package may not carry: {m.name}")
        t.extractall(staging)
    tops = os.listdir(staging)
    if len(tops) != 1:
        fail("fetch", f"package should hold one top directory, found {tops}")
    pkg_dir = os.path.join(staging, tops[0])
    if INSTALL is None:
        fail("verify", "the installer module is missing beside steps.py; a package cannot be verified without it")
    pkg = INSTALL.read_package(pkg_dir)
    if pkg["problems"]:
        fail("verify", "the package does not hold together: " + "; ".join(pkg["problems"]))
    return staging, pkg_dir, sha256, pkg


# THE MODEL SYSTEM'S FOUR SETTINGS (Common Agent 0.39.0, 12.4.1), where the
# owner's instruction leaves them out: the environment file's `model` block,
# which is this host's configuration and never a package's.
#
#   model.name      MODEL_NAME, the model as the endpoint names it
#   model.harness   the model a harness wakes when the instruction names none
#                   (optional; model.name otherwise), reached through the
#                   gateway at model.endpoint in model.protocol unless it
#                   names a provider itself (harness_model, technical debt 619)
#   model.endpoint  MODEL_ENDPOINT, the base address: on this host and in our
#                   worker jobs the model gateway on loopback
#                   (http://127.0.0.1:8788, host/responses-bridge.mjs)
#   model.key       the NAME of the credential placed as MODEL_KEY, or "" for
#                   none, which a gateway on the agent's own host needs
#   model.protocol  MODEL_PROTOCOL, one of install.MODEL_PROTOCOLS
#   model.max_output_tokens  MODEL_MAX_OUTPUT_TOKENS, the answer budget, when
#                   the host sets one (optional; the shared caller's default
#                   otherwise)
#   model.gateway   {vertex_project, vertex_region, gemini_region,
#                   speech_project}: where a worker job's own gateway sends
#                   Claude's and Gemini's calls and for which project it passes
#                   Speech-to-Text v2 on, placed on the job as the bridge's
#                   settings when a gateway endpoint (MODEL_ENDPOINT, or a
#                   service's STT_ENDPOINT) is on loopback
#   model.gateway.settings  {VARIABLE: value}: values for service settings that
#                   point at the gateway (STT_ENDPOINT, STT_PROJECT), filled into
#                   any service that declares the variable where the
#                   instruction leaves it out
#
# The instruction wins key by key, so a deploy request that names its own
# model or endpoint gets it. An environment with no `model` block fills
# nothing, and a package with a model system is then refused by the
# instruction check, naming the missing setting.
MODEL_DEFAULT_KEYS = (("MODEL_NAME", "model.name", "DM_MODEL_NAME"),
                      ("MODEL_ENDPOINT", "model.endpoint", "DM_MODEL_ENDPOINT"),
                      ("MODEL_PROTOCOL", "model.protocol", "DM_MODEL_PROTOCOL"),
                      ("MODEL_MAX_OUTPUT_TOKENS", "model.max_output_tokens", "DM_MODEL_MAX_OUTPUT_TOKENS"))
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def host_model_defaults():
    """The host's values for the model system, as {setting: value}, and the
    credential name for MODEL_KEY ("" for none)."""
    values = {}
    for var, key, override in MODEL_DEFAULT_KEYS:
        v = _optional_env(key, override)
        if isinstance(v, str) and v.strip():
            values[var] = v.strip()
    cred = _optional_env("model.key", "DM_MODEL_KEY_CREDENTIAL")
    return values, (cred.strip() if isinstance(cred, str) else "")


def gateway_setting_defaults():
    """The host's bindings for declared service settings, as {variable: value}:
    the environment's `setting_bindings` (an address is bound at install and
    never filed: TTS_ENDPOINT, SPEECH_ENDPOINT, STT_ENDPOINT and the like),
    over the older `model.gateway.settings`; {} when the environment names
    neither. Only names shaped like a variable are taken."""
    out = {}
    for key in ("model.gateway.settings", "setting_bindings"):
        try:
            v = _am_env(key)
        except (RuntimeError, TypeError):
            continue
        if isinstance(v, dict):
            out.update({k: str(x) for k, x in v.items() if isinstance(k, str) and INSTALL.ENV_RE.match(k)
                        and isinstance(x, (str, int, float)) and str(x).strip()})
    return out


def with_gateway_settings(args, pkg):
    """Fill a service's declared gateway settings (STT_ENDPOINT, STT_PROJECT)
    the instruction left out, from model.gateway.settings, in place."""
    fills = gateway_setting_defaults()
    if not fills:
        return args
    settings = args.get("settings")
    if settings is None:
        settings = args["settings"] = {}
    if not isinstance(settings, dict):
        return args
    for s in pkg.get("systems", []):
        if s.get("kind") != "service":
            continue
        declared = {st["env"] for st in s.get("settings", []) if isinstance(st, dict) and st.get("env")}
        wanted = {k: v for k, v in fills.items() if k in declared}
        if not wanted:
            continue
        mine = settings.get(s["name"])
        if mine is None:
            mine = settings[s["name"]] = {}
        if isinstance(mine, dict):
            for k, v in wanted.items():
                if mine.get(k) in (None, ""):
                    mine[k] = v
    return args


def with_model_defaults(args, pkg):
    """Fill the model system's settings the instruction left out from this
    host's configuration (host_model_defaults), in place, and return args. A
    package with no model system is untouched. A setting the instruction gives
    is never replaced. A service's gateway settings are filled too
    (with_gateway_settings)."""
    with_gateway_settings(args, pkg)
    system = INSTALL.model_system(pkg)
    if not system:
        return args
    values, cred = host_model_defaults()
    settings = args.get("settings")
    if settings is None:
        settings = args["settings"] = {}
    if isinstance(settings, dict):
        mine = settings.get(system["name"])
        if mine is None:
            mine = settings[system["name"]] = {}
        if isinstance(mine, dict):
            for k, v in values.items():
                if mine.get(k) in (None, ""):
                    mine[k] = v
    creds = args.get("credentials")
    if cred and (creds is None or isinstance(creds, dict)) and not (creds or {}).get(system["name"]):
        args["credentials"] = {**(creds or {}), system["name"]: cred}
    return args


GATEWAY_ENDPOINT_VARS = ("MODEL_ENDPOINT", "STT_ENDPOINT")


def model_gateway_env(args, pkg, harness_vars=None):
    """The variables a worker job's own gateway reads, when one of the
    package's gateway settings (the model system's MODEL_ENDPOINT, or a
    service's STT_ENDPOINT) is on loopback: the container starts
    responses-bridge.mjs there (image/one-message.mjs) and it sends Claude's
    and Gemini's calls to Vertex, and Speech-to-Text v2 recognize to Google,
    in this project, signed in as the job's own service account. {} when no
    such setting points at loopback. `harness_vars` are what the job's harness
    is told for its model (keyless_vars): a harness whose model is the host's
    gateway names its MODEL_ENDPOINT there."""
    settings = args.get("settings") if isinstance(args.get("settings"), dict) else {}
    endpoint = ""
    sources = [settings.get(s["name"]) for s in pkg.get("systems", [])] + [harness_vars]
    for mine in sources:
        mine = mine if isinstance(mine, dict) else {}
        for var in GATEWAY_ENDPOINT_VARS:
            v = str(mine.get(var) or "")
            host = re.sub(r"^https?://", "", v).split("/")[0].rsplit(":", 1)[0]
            if v and host in LOOPBACK_HOSTS and not endpoint:
                endpoint = v
    if not endpoint:
        return {}
    project = _optional_env("model.gateway.vertex_project", "DM_MODEL_GATEWAY_PROJECT") or VERTEX_PROJECT
    region = _optional_env("model.gateway.vertex_region", "DM_MODEL_GATEWAY_REGION") or "global"
    gemini = _optional_env("model.gateway.gemini_region", "DM_MODEL_GATEWAY_GEMINI_REGION")
    speech = _optional_env("model.gateway.speech_project", "DM_MODEL_GATEWAY_SPEECH_PROJECT")
    port = endpoint.split("://", 1)[-1].split("/")[0].rsplit(":", 1)[1] if re.search(r"://[^/]+:\d+(/|$)", endpoint) else ""
    return {"BRIDGE_VERTEX_PROJECT": str(project), "BRIDGE_VERTEX_REGION": str(region),
            **({"BRIDGE_PORT": port} if port else {}),
            **({"BRIDGE_GEMINI_REGION": str(gemini)} if gemini else {}),
            **({"BRIDGE_SPEECH_PROJECT": str(speech)} if speech else {})}


def check_before_touching(args, pkg):
    """Steps 2 and the instruction: the host has what the install file
    names, and the instruction supplies every name, address and number the
    package needs and carries no value. Both before anything is created."""
    missing = INSTALL.check_host(pkg["install"])
    if missing:
        fail("host", "this host lacks what the package needs: " + "; ".join(missing)
             + ". Nothing was substituted; install it or choose another host.")
    with_model_defaults(args, pkg)
    refusals = INSTALL.check_instruction(args, pkg, store_has)
    if refusals:
        fail("instruction", "; ".join(refusals))
    # And what it charges, which is knowable from the package alone the moment
    # it is verified. Checked here so a malformed price refuses before the unix
    # user exists, rather than at the step that places it, where it would leave
    # a half-made agent somebody has to remove. The value is thrown away; this
    # is the refusal, and write_price computes it again when it places it.
    price_of(args.get("name", "this package"), pkg)


def install_dependencies(name, home, pkg_name, pkg):
    """Step 4. From each lockfile into the agent's own home, as the agent,
    with install-time scripts refused. The installer runs nothing from the
    package; npm runs nothing from it either.

    AND NOT INTO THE PACKAGE. npm reads its manifest and its lockfile out of
    the directory it runs in, so the obvious directory is the skill's own
    scripts folder, and that is where this ran until 2026-09-11. It left a
    node_modules inside the installed package, which is why the ledger skips
    one, and it is why the image builder refuses a package that carries one:
    a package shipping its own node_modules is a package whose
    dependencies nobody verified. An agent installed that way could never be
    turned into an image afterwards and nothing said so. So the two files npm
    needs are copied out to a directory named after the lockfile's digest
    under the agent's ~/.deps, npm runs there, and the package directory is
    left exactly as the copy that placed it wrote it. The scripts find the
    tree through AGENT_DEPS, which place_environment names and the brain
    sources before the harness runs.

    ~/.deps GOES FIRST. A tree is derived from a lockfile of the version being
    installed, so an update that dropped a dependency would otherwise leave
    the tree of a lockfile the package no longer carries, and a script asking
    for it by digest would still find it."""
    plan, problems = INSTALL.deps_plan(home, pkg["install"])
    if problems:
        fail("dependencies", "; ".join(problems))
    shutil.rmtree(INSTALL.deps_root(home), ignore_errors=True)
    done, installed = [], set()
    for dep in plan:
        rel = dep["lockfile"]
        src = os.path.dirname(os.path.join(home, pkg_name, rel))
        if not os.path.exists(os.path.join(src, "package.json")):
            fail("dependencies", f"{rel} has no package.json beside it; nothing installed for it")
        if dep["sha256"] not in installed:
            os.makedirs(dep["dir"], exist_ok=True)
            for f in ("package.json", os.path.basename(rel)):
                shutil.copyfile(os.path.join(src, f), os.path.join(dep["dir"], f))
            run(["chown", "-R", f"{name}:{name}", dep["dir"]], "dependencies")
            as_user(name, f"cd {json.dumps(dep['dir'])} && npm ci --ignore-scripts --omit=dev --no-audit --no-fund --loglevel=error",
                    "dependencies", 600)
            installed.add(dep["sha256"])
        done.append({"skill": dep.get("skill"), "lockfile": rel, "sha256": dep["sha256"]})
    return done


def place_environment(name, home, bindings, pkg):
    """Step 5 and 6. The credentials by name from the store, the settings
    and the ceilings from the instruction, and where this host keeps each
    binary the package names, into one file only the agent can read; the
    brain sources it before the harness runs."""
    values = {}
    for b in bindings:
        if b.get("credential"):
            values[b["credential"]] = store_read(b["credential"])
    binaries = INSTALL.find_binaries(pkg.get("install"))
    # Where install_dependencies put the trees, for the scripts that need one.
    # Named only when the package has a lockfile, so the file keeps saying what
    # was placed rather than pointing at a directory nothing made.
    deps = INSTALL.deps_root(home) if ((pkg.get("install") or {}).get("dependencies") or []) else None
    write_text(f"{home}/.config/fleet/env", INSTALL.env_file(bindings, values, binaries, deps=deps), 0o600, name)
    write_text(f"{home}/.config/fleet/ceilings.json",
               json.dumps(INSTALL.ceilings_doc(bindings), indent=2) + "\n", 0o600, name)
    return [".config/fleet/env", ".config/fleet/ceilings.json"]


def translate_for_harness(name, home, pkg_dir, pkg_name, pkg, harness, model, bindings):
    """Step 7. The instructions file the harness reads, the skills where it
    discovers them, its configuration with every mcp system named, and the
    brain that starts it. Returns the relative paths placed under the home."""
    table = INSTALL.HARNESSES[harness]
    placed = []
    text = TRANSLATE.render(pkg_dir, name, bindings)
    write_text(f"{home}/{table['instructions']}", text, 0o644, name)
    placed.append(table["instructions"])
    gateway = gateway_provider(model) if harness == "opencode" else None
    for rel, body in INSTALL.harness_files(harness, name, model, bindings, gateway=gateway).items():
        write_text(f"{home}/{rel}", body, 0o600, name)
        placed.append(rel)
    skills = sorted(d for d in os.listdir(os.path.join(home, pkg_name, "skills"))
                    if os.path.isdir(os.path.join(home, pkg_name, "skills", d)))
    links = INSTALL.lay_out_skills(home, pkg_name, skills, harness, link=True)
    run(["chown", "-R", "-h", f"{name}:{name}", f"{home}/{table['skills_dir']}"], "translate")
    return placed, links


def place_model_key(name, home, harness, model=None):
    """The model key this host lends every deployed harness, by name."""
    os.makedirs(f"{home}/.config/fleet", exist_ok=True)
    if harness == "opencode":
        if not os.path.isdir(f"{home}/.opencode/bin"):
            os.makedirs(f"{home}/.opencode", exist_ok=True)
            shutil.copytree("/home/opencode/.opencode/bin", f"{home}/.opencode/bin")
        prov = provider_of(model) or "google"
        _, rel, secret = PROVIDERS[prov]
        if not rel:
            # A keyless provider: the brain carries where to call, and the
            # host's service account is what pays. Nothing to place.
            run(["chown", "-R", f"{name}:{name}", home], "chown")
            return None
        keyfile = f"{home}/{rel}"
        os.makedirs(os.path.dirname(keyfile), exist_ok=True)
        store = f"{CREDENTIALS}/{secret}.secret"
        if os.path.exists(store):
            shutil.copy(store, keyfile)
        elif prov == "google" and os.path.exists("/home/opencode/.config/fleet/gemini.key"):
            shutil.copy("/home/opencode/.config/fleet/gemini.key", keyfile)
        elif prov == "google":
            # Said, never a bare FileNotFoundError reported as step "unexpected".
            fail("bind", f"the model {model} names google, and this host holds neither the "
                         f"store's {secret} nor /home/opencode/.config/fleet/gemini.key")
        else:
            fail("bind", f"the model names {prov} and the store holds no credential called {secret}")
    else:
        # Codex reaches Claude on Vertex through the host's responses-bridge
        # (owner, 2026-10-03); its config.toml names the
        # bridge and the host's service account pays. Nothing to place.
        os.makedirs(f"{home}/.codex", exist_ok=True)
        run(["chown", "-R", f"{name}:{name}", home], "chown")
        return None
    run(["chown", "-R", f"{name}:{name}", home], "chown")
    run(["chmod", "600", keyfile], "chown")
    return secret


def write_brain(name, harness, model=None):
    write_text(f"{BRAINS}/{name}.sh", brain_text(harness, model), 0o755)


def place_gateway_config(name, home, harness, model):
    """opencode's configuration in an installed agent's home, with the host's
    model gateway named as a provider when the model is one and taken out when
    it is not, and everything else in it (its MCP servers) kept. For a model
    change, where the rest of the configuration is not rendered again.
    Returns True when the file was written."""
    if harness != "opencode":
        return False
    path = f"{home}/.config/opencode/opencode.json"
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except FileNotFoundError:
        doc = None
    gateway = gateway_provider(model)
    if doc is None and not gateway:
        return False
    doc = doc if isinstance(doc, dict) else {"$schema": "https://opencode.ai/config.json"}
    providers = doc.get("provider") if isinstance(doc.get("provider"), dict) else {}
    if gateway:
        providers[GATEWAY_PROVIDER] = INSTALL.opencode_gateway_provider(gateway)
    else:
        providers.pop(GATEWAY_PROVIDER, None)
    if providers:
        doc["provider"] = providers
    else:
        doc.pop("provider", None)
    write_text(path, json.dumps(doc, indent=2) + "\n", 0o600, name)
    return True


ACTS_FOR_VALUES = ("person", "organization", "anyone")


def acts_for_readable(v):
    """An acts-for.json statement read as the adapter's actsForReadable reads
    it (Common Agent 6.2): {acts_for, organization_name?} or None.
    organization_name only beside organization, and a name, never an address
    or an account identifier (6.4 rule 3)."""
    if not isinstance(v, dict) or v.get("acts_for") not in ACTS_FOR_VALUES:
        return None
    on = v.get("organization_name")
    if on is None:
        return {"acts_for": v["acts_for"]}
    if v["acts_for"] != "organization" or not isinstance(on, str):
        return None
    t = on.strip()
    if not t or len(t) > 120 or re.search(r"@|://|^U[A-Z2-7]{55}$", t):
        return None
    return {"acts_for": "organization", "organization_name": t}


def acts_for_of(home):
    """Whom the agent acts for, as its adapter decides it at start: its own
    acts-for.json when that says something readable, else organization,
    because this deployment manager starts every adapter it installs with
    --acts-for organization (the pm2 config above)."""
    try:
        with open(f"{home}/.agentmesh/adapter/acts-for.json", encoding="utf-8") as f:
            own = acts_for_readable(json.load(f))
    except Exception:  # noqa: BLE001
        own = None
    return own or {"acts_for": "organization"}


def bind_descriptor(home, pkg_name, name, agent_key, handle, pkg_version,
                    interaction, harness, model, sha256=None):
    """Bind the builder's draft descriptor (Common Agent 0.28.0-draft 4.9,
    6.2, 6.6, 12.6 rule 6): fill the subject now that the agent has an
    identity, add what the install decides (acts_for, interaction, fleet, and
    agent_version where the draft leaves it empty), sign with the identity
    key, and install it where the adapter serves it. Returns a dict for the
    deploy report: the digest, which members the binding added to or changed
    in the draft, or why there is no descriptor.

    Every agent serves a bound, signed Descriptor, so an unsigned one is never
    installed: a signer that fails ends the act with the installed descriptor
    left as it was. `shape` was removed from the format in 0.28.0-draft and is
    never written, a draft's own included. What it said about how this deploy
    runs (memory starts clean, the model) is data use (6.9, 6.12): it is handed
    to the adapter in descriptor-binding.json, which the adapter carries onto
    the registration's data use while the descriptor it serves is the one whose
    digest is recorded there. The harness belongs to the deployment record."""
    # agent-descriptor.json, or descriptor.json in a package written before
    # Common Agent 0.30.0-draft renamed it.
    draft_path = INSTALL.package_file(f"{home}/{pkg_name}", INSTALL.DESCRIPTOR_FILES)
    if not draft_path:
        return {"absent": "the package carries no descriptor draft"}
    try:
        draft = json.load(open(draft_path))
    except Exception as e:  # noqa: BLE001
        return {"absent": f"draft unreadable, none installed: {e}"}
    if draft.get("format") != "agent-descriptor-v1":
        return {"absent": "draft is not agent-descriptor-v1, none installed"}

    desc = json.loads(json.dumps(draft))
    desc.pop("signatures", None)
    desc.pop("shape", None)
    desc["subject"] = {"id": agent_key, **({"handle": handle} if handle else {})}
    if not str(desc.get("agent_version", "")).strip():
        desc["agent_version"] = str(pkg_version)
    desc["interaction"] = interaction
    # Whom it acts for, decided by the install (Common Agent 6.2, 12.6 rule 4),
    # and the same value its adapter registers.
    acts = acts_for_of(home)
    desc["acts_for"] = acts["acts_for"]
    if acts.get("organization_name"):
        desc["organization_name"] = acts["organization_name"]
    else:
        desc.pop("organization_name", None)
    # One process answers the identity: a fact about the generated brains,
    # stated at the level of the identity (6.2), never inside a shape.
    if not isinstance(desc.get("fleet"), bool):
        desc["fleet"] = False
    # Where the agent's samples are (Common Agent 6.2, 7.7). The package says
    # only whether it has them (install.json `samples_ref: true`); the address
    # needs the handle and the mesh this deploy answers to, so it is filled
    # here, before the signature, and the signature covers it.
    samples = samples_ref_for(home, pkg_name, handle)
    if samples.get("address"):
        desc["samples_ref"] = samples["address"]

    sig = sign_with_identity(f"{home}/.agentmesh/adapter/identity.json",
                             DESCRIPTOR_TAG + "\n" + canonical(desc))
    if not sig:
        fail("descriptor", "the descriptor could not be signed with the agent's identity key, and an "
                           "unsigned descriptor is never installed (Common Agent 4.9, 6.6)",
             "the descriptor already installed, if any, is unchanged")
    desc["signatures"] = [{"tag": DESCRIPTOR_TAG, "by": agent_key,
                           "sig": sig, "alg": "ed25519"}]
    data = json.dumps(desc, indent=2, ensure_ascii=False) + "\n"
    dest = f"{home}/.agentmesh/adapter/descriptor.json"
    # Exactly these bytes: the digest below, and the one the adapter keys the
    # binding record by, are over them.
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        f.write(data)
    # Owned by whoever runs the adapter that serves it. For an agent on a node
    # that is the node's user, not the agent's: on 2026-09-23 five agents on
    # the platform's node could not read their own bound descriptor, adopted
    # the platform's one-sentence draft over it, and reached the canvas with no
    # ports.
    adapter_dir = os.path.realpath(f"{home}/.agentmesh/adapter")
    if os.path.islink(f"{home}/.agentmesh/adapter"):
        st = os.stat(adapter_dir)
        os.chown(dest, st.st_uid, st.st_gid)
    else:
        run(["chown", f"{name}:{name}", dest], "descriptor")
    os.chmod(dest, 0o600)
    # Which package this version was installed from, beside the descriptor,
    # so the adapter stamps every job it makes with it (package_digest).
    # Only the digest this deploy verified; nothing is written when unknown.
    if sha256:
        rec = f"{home}/.agentmesh/adapter/package-record.json"
        with open(rec, "w") as f:
            f.write(json.dumps({"format": "package-record-v1", "package": pkg_name,
                                "version": str(pkg_version), "sha256": sha256}) + "\n")
        st = os.stat(dest)
        os.chown(rec, st.st_uid, st.st_gid)
        os.chmod(rec, 0o600)
    # What the former shape said about how this deploy runs, carried to data
    # use (Common Agent 6.12): one cold boot per message means memory starts
    # clean, and the model the brain runs is a processor. The model is stated
    # outright, not left to the draft: what a caller needs to know is what this
    # deploy runs, and only the deploy knows that. Keyed by the descriptor's
    # digest, so the adapter carries it only while this is what it serves.
    digest = hashlib.sha256(data.encode("utf-8")).hexdigest()
    carried = {"memory": "starts-clean-each-job"}
    if model and str(model).strip():
        carried["processors"] = [{"service": str(model).strip()}]
    binding = f"{home}/.agentmesh/adapter/descriptor-binding.json"
    with open(binding, "w") as f:
        f.write(json.dumps({"format": "descriptor-binding-v1", "at": now_iso(),
                            "by": "deployment-manager", "digest": digest,
                            "changed": [], "carried": carried}) + "\n")
    st = os.stat(dest)
    os.chown(binding, st.st_uid, st.st_gid)
    os.chmod(binding, 0o600)
    # What a verifier will find when it lays the bound descriptor over the
    # draft: the members the binding added, and the ones it changed.
    added = sorted(k for k in desc if k not in draft)
    changed = sorted(k for k in desc if k in draft and desc[k] != draft[k])
    return {"digest": digest, "signed": True, "acts_for": desc["acts_for"],
            "carried": carried, "added": added, "changed": changed,
            **({"samples_ref": samples} if samples else {})}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def samples_ref_for(home, pkg_name, handle):
    """The platform's address of this agent's samples document, when the
    package asks for one: {"address": ...}, or {"none": why} when it asked and
    none can be named, or {} when it did not ask. The address is the mesh API's
    `/v1/agents/<handle>/samples` (docs/trials-plan.md), on the API origin of
    this deploy's environment (env/<AGENTMESH_ENV>.json urls.api), so a dev
    fleet names the dev API and prod names prod."""
    try:
        inst = read_json(INSTALL.package_file(f"{home}/{pkg_name}", INSTALL.INSTALL_FILES))
    except Exception:  # noqa: BLE001
        return {}
    if not (isinstance(inst, dict) and inst.get("samples_ref") is True):
        return {}
    if not handle:
        return {"none": "the agent has no handle yet, and the samples address is named by handle"}
    try:
        api = _am_env("urls.api", "DM_API_ORIGIN").rstrip("/")
    except RuntimeError as e:
        return {"none": f"no API origin for this environment: {e}"}
    if not api.startswith("https://"):
        return {"none": f"the API origin {api} is not https, and samples_ref is an https address"}
    return {"address": f"{api}/v1/agents/{urllib.parse.quote(handle, safe='@.+')}/samples"}


# ── the trial scope of the owner's allowance (Common Agent 7.5, 7.7) ────────
#
# The publisher pays for trial work out of the allowance's `trial` ceiling, and
# an agent that declares a trial with no trial ceiling refuses every trial on
# funds. A package suggests the number (install.json `trial_ceiling`); this
# writes it into the agent's allowance the way `agentmesh allowance set` does:
# the same document, the same tag, the same canonical bytes, signed with the
# agent's identity key, which is the key the adapter's own set signs with and
# the key bind_descriptor already signs the descriptor with. It never takes a
# ceiling away: a trial ceiling the owner already set is kept, every other
# ceiling is carried, and a document that does not verify is left alone,
# because re-signing it would launder whatever made it fail.
ALLOWANCE_TAG = "agentmesh-allowance-v1"
ADAPTER_SOURCE = os.environ.get("DM_ADAPTER_SOURCE", "/usr/lib/node_modules/mesh-adapter/mesh-adapter.mjs")


def adapter_knows_trial_scope(path=None):
    """Whether the installed adapter accepts a `trial` ceiling. One that does
    not reads the whole document as malformed and fails CLOSED, refusing every
    piece of work, so writing a trial ceiling before the adapter knows the
    scope would stop the agent rather than bound its trials. Read from the
    adapter's own shape check: the function, or a scope list it names, has to
    say "trial"."""
    try:
        with open(path or ADAPTER_SOURCE, encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return False
    m = re.search(r"function allowanceShapeValid\([^)]*\)\s*\{(.*?)\n\}", src, re.S)
    if m and re.search(r"""["']trial["']""", m.group(1)):
        return True
    return bool(re.search(r"""\[\s*["']task["']\s*,\s*["']context["']\s*,\s*["']day["']\s*,\s*["']trial["']\s*\]""", src))


def verify_with_key(public_key, message, sig):
    """Whether sig verifies over message under public_key, by the same signer
    script and library as every other signature here. False on any failure."""
    try:
        p = subprocess.run(["node", SIGN_JS, "--verify", public_key, sig],
                           capture_output=True, text=True, timeout=30, input=message,
                           env={**{k: v for k, v in os.environ.items() if not k.startswith("NODE_CHANNEL")}, "NODE_PATH": ADAPTER_MODULES})
        return p.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def allowance_shape_ok(doc, key):
    """EXT-8's document shape, as far as adding a ceiling needs it, and that
    it governs this agent under this agent's key."""
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool) and v >= 0  # noqa: E731
    cm = doc.get("cost_model") if isinstance(doc, dict) else None
    return (isinstance(doc, dict) and doc.get("v") == 1 and doc.get("agent") == key and doc.get("owner_key") == key
            and isinstance(cm, dict) and whole(cm.get("per_1k_tokens_micro")) and isinstance(cm.get("currency"), str)
            and isinstance(doc.get("ceilings"), list) and doc["ceilings"]
            and all(isinstance(c, dict) and whole(c.get("amount_micro")) for c in doc["ceilings"])
            and doc.get("on_exhausted") in ("refuse", "ask_owner") and isinstance(doc.get("sig"), str))


def write_trial_allowance(name, home, pkg):
    """Give the agent's allowance the trial ceiling its package suggests.
    Returns what happened, for the deploy record, or None when the package
    declares no trial. Never raises on the owner's document: every outcome
    that writes nothing says why, and an agent with no trial ceiling refuses
    trials on funds, which is the safe direction to fail in."""
    tc = ((pkg or {}).get("install") or {}).get("trial_ceiling")
    if not isinstance(tc, dict):
        return None
    amount, currency = tc.get("amount_micro"), tc.get("currency")
    if not (isinstance(amount, int) and not isinstance(amount, bool) and amount > 0 and isinstance(currency, str) and tc.get("per") == "day"):
        return {"written": False, "why": "the package's trial_ceiling is not a whole amount per day; trials refuse on funds"}
    adapter = os.path.realpath(f"{home}/.agentmesh/adapter")
    path = f"{home}/.agentmesh/adapter/allowance.json"
    try:
        ident = read_json(f"{adapter}/identity.json")
        key = ident["public_key"]
    except Exception:  # noqa: BLE001
        return {"written": False, "why": "the agent has no identity to sign its allowance with; trials refuse on funds"}
    if not adapter_knows_trial_scope():
        return {"written": False, "why": "the installed adapter does not know the allowance's trial scope yet, and would read a "
                                        "trial ceiling as a broken document and refuse all work; trials refuse on funds until it does"}
    prior = None
    if os.path.exists(path):
        try:
            prior = read_json(path)
        except Exception:  # noqa: BLE001
            return {"written": False, "why": "the agent's allowance does not read as JSON; left as it is for the owner"}
        body = {k: v for k, v in prior.items() if k != "sig"} if isinstance(prior, dict) else None
        if not (allowance_shape_ok(prior, key)
                and verify_with_key(key, ALLOWANCE_TAG + "\n" + canonical(body), prior["sig"])):
            return {"written": False, "why": "the agent's allowance does not verify; it is failing closed and is left for the owner "
                                            "to replace, never re-signed here"}
        if any(c.get("scope") == "trial" for c in prior["ceilings"]):
            mine = next(c for c in prior["ceilings"] if c.get("scope") == "trial")
            return {"written": False, "kept": True, "amount_micro": mine["amount_micro"],
                    "currency": prior["cost_model"]["currency"], "why": "a trial ceiling is already set, and an owner's number is kept"}
        if prior["cost_model"]["currency"] != currency:
            return {"written": False, "why": f"the allowance counts in {prior['cost_model']['currency']} and the suggestion is in "
                                            f"{currency}; an allowance has one currency, so the owner sets the trial ceiling"}
        doc = {**body, "ceilings": [*prior["ceilings"], {"scope": "trial", "amount_micro": amount}], "updated_at": now_iso()}
    else:
        per1k = tc.get("per_1k_tokens_micro")
        if not (isinstance(per1k, int) and not isinstance(per1k, bool) and per1k >= 0):
            return {"written": False, "why": "the agent has no allowance and the package suggests no cost model to meter trials "
                                            "with; trials refuse on funds until the owner runs agentmesh allowance set"}
        doc = {"v": 1, "agent": key, "owner_key": key,
               "cost_model": {"per_1k_tokens_micro": per1k, "currency": currency},
               "ceilings": [{"scope": "trial", "amount_micro": amount}],
               "on_exhausted": "refuse", "updated_at": now_iso()}
    sig = sign_with_identity(f"{adapter}/identity.json", ALLOWANCE_TAG + "\n" + canonical(doc))
    if not sig:
        return {"written": False, "why": "the signer did not answer; nothing was written, and trials refuse on funds"}
    # EXT-8 pins base64url, unpadded, where the signer answers standard base64.
    doc["sig"] = sig.replace("+", "-").replace("/", "_").rstrip("=")
    write_text(path, json.dumps(doc, indent=2, ensure_ascii=False) + "\n", 0o600)
    st = os.stat(adapter)
    try:
        os.chown(path, st.st_uid, st.st_gid)
    except (AttributeError, OSError):
        pass
    return {"written": True, "amount_micro": amount, "currency": currency, "per": "day",
            "added_to": "the owner's allowance" if prior else "a new allowance"}


def write_ledger(name, home, rels, withhold):
    """Step 10's ledger: every file placed under the home with its digest,
    and the brain outside it, kept where the agent cannot rewrite it."""
    os.makedirs(LEDGERS, exist_ok=True)
    files = INSTALL.ledger(home, rels, withhold=withhold)
    outside = INSTALL.ledger(BRAINS, [f"{name}.sh"])
    doc = {"agent": name, "root": home, "files": files,
           "outside": [{**e, "path": f"{BRAINS}/{e['path']}"} for e in outside],
           "written_at": now_iso()}
    doc["sha256"] = INSTALL.ledger_digest(doc["files"] + doc["outside"])
    path = f"{LEDGERS}/{name}.json"
    with open(path + ".tmp", "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(path + ".tmp", path)
    os.chmod(path, 0o644)
    return {"path": path, "files": len(doc["files"]) + len(doc["outside"]), "sha256": doc["sha256"]}


def read_ledger(name):
    p = f"{LEDGERS}/{name}.json"
    return json.load(open(p)) if os.path.exists(p) else None


def ledger_drift(name):
    doc = read_ledger(name)
    if not doc:
        return None
    found = INSTALL.drift(doc["files"], doc["root"])
    found += [{"path": e["path"], "state": d["state"]} for e in doc["outside"]
              for d in INSTALL.drift([{**e, "path": os.path.basename(e["path"])}], os.path.dirname(e["path"]))]
    return found


def supervisor_here():
    """Whether the fleet supervisor holds this host's agents, and the words for
    the record either way. Returns (holds, why).

    pm2 is asked, and pm2 rather than a file on disk because pm2 is what starts
    the supervisor and pm2 is what this procedure is about to ask for a second
    poller. A roster file says a supervisor was configured once; `pm2 jlist`
    says one is answering now, which is the question.

    AN UNREADABLE ANSWER COUNTS AS HELD. Both guesses are wrong somewhere, and
    these are the two ways to be wrong. Guess "no supervisor" and the deploy
    starts a second poller beside one that is already running: on 2026-09-11
    five attendants that installs had quietly reinstated raced the supervisor,
    took this host's load from 0.41 to 4.9, and a message went to one poller
    that the other never saw. That failure is silent. Guess "supervisor" and
    the deploy starts no attendant, which is said in this deploy's own result
    and again in every `status`, so it is a failure somebody can see."""
    try:
        p = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=60)
        rows = json.loads(p.stdout or "[]")
    except (OSError, ValueError, subprocess.SubprocessError):
        rows = None
    if not isinstance(rows, list):
        return True, (f"pm2 could not be asked for its process list, so a {SUPERVISOR_PROC} on this host "
                      f"could not be ruled out")
    for r in rows:
        if isinstance(r, dict) and r.get("name") == SUPERVISOR_PROC:
            state = (r.get("pm2_env") or {}).get("status", "unknown")
            if state == "online":
                return True, f"{SUPERVISOR_PROC} is online in pm2 and answers for every agent on this host"
            return False, f"{SUPERVISOR_PROC} is in pm2 but {state}, so it is answering for nobody"
    return False, f"there is no {SUPERVISOR_PROC} process in pm2 on this host"


def node_here():
    """Whether the adapter node holds this host's agents, and the words for
    the record. Returns (holds, why).

    The root on disk decides: a NODE_ROOT with an agents/ directory is a node
    an operator made (section 8 of the spec starts with exactly that folder),
    and DEPLOYMGR_NODE=1 says so before the first agent is moved. Nothing is
    asked of pm2 here, because the node may be stopped between two deploys and
    its agents are still its agents; whether it is RUNNING is what
    start_processes settles."""
    if os.environ.get("DEPLOYMGR_NODE") == "1":
        return True, f"DEPLOYMGR_NODE=1: agents on this host are folders under {NODE_ROOT}/agents"
    if os.path.isdir(os.path.join(NODE_ROOT, "agents")):
        return True, f"{NODE_ROOT}/agents exists, so the node holds this host's agents"
    return False, f"there is no node root at {NODE_ROOT}; each agent runs its own adapter"


def agent_procs(name):
    """The pm2 processes this host starts for one agent, and why.

    THE ADAPTER ALWAYS. It holds the mailbox and the agent's address. A Cloud
    Run job has neither and does not exist between executions, so wherever the
    work runs, something long-lived on this host holds the inbox.

    THE ATTENDANT ONLY WHERE NOTHING ELSE POLLS. One supervisor process
    replaced the per-agent attendant loops (runtime/fleet/supervisor.mjs), and
    on a host where it runs an attendant is a second reader of the same inbox.

    THE GENERATED CONFIG STILL DECLARES THE ATTENDANT EITHER WAY, and that is
    not an oversight left behind. runtime/fleet/roster.mjs builds the
    supervisor's roster out of the attendant entries in deploymgr-agents.config.js
    and out of nothing else, so an agent with no attendant entry is an agent
    the supervisor never watches and whose senders wait. The entry is the
    record of how this agent's work is run; STARTING it is the second poller.
    So the config keeps saying it and pm2 is not asked to run it."""
    held, why = supervisor_here()
    # On the node the agent has no adapter process of its own: the node is the
    # process, started once for every agent, and its name is what pm2 holds.
    on_node, _ = node_here()
    # The node that holds THIS agent, by its row: a host runs one node per
    # account (a node credential covers one account), so the process name is
    # the row's and the host-wide default stands only for an agent not yet
    # recorded on any node.
    row = next((e for e in load_list() if e.get("name") == name), None) or {}
    node_proc = row.get("node_proc") or NODE_PROC
    adapter = [node_proc] if (on_node or row.get("node_root")) else [f"{name}-adapter"]
    return (adapter if held else [*adapter, f"{name}-attendant"]), held, why


# ── reloading one agent instead of restarting its node ────────────────────
#
# Every install on a node used to restart the node, because a restart was the
# only way the node read a changed agent folder. On the dev fleet the
# platform's node holds 57 agents, and each restart took all of them off the
# mesh for about a minute: replies for every agent failed with "no agent named
# X on this node" until it was back, and the supervisor held them (technical
# debt 417). The adapter's `agent reload <name>` serves one agent again from
# its folder, keeps its mailbox, and touches no other agent on the node.
#
# DM_NODE_RELOAD=on uses it. Off, which is the default, every call this
# procedure makes is the call it has always made. On:
#   - an agent whose only process is a node that pm2 shows online is reloaded
#     on that node instead of the node being started (reload_target);
#   - a node that cannot be told (older than reload, not answering, or a
#     command that gave no answer) is started as before, and the answer says
#     why under processes.reload;
#   - an agent whose new files do not serve is NOT followed by a restart. Its
#     smoke check fails and the usual rollback runs: an update's old files are
#     put back and reloaded (serve_again), a new agent is paused through the
#     node;
#   - the watch after a reload allows the node no restart at all, where a
#     start of the node allows the one it causes;
#   - after a rollback the neighbours are watched first, and the node is
#     restarted only if they do not stay well without it (recovered).
# The executor passes its environment to every act, so the setting goes on the
# deploy-executor process.
RELOAD_SECONDS = int(os.environ.get("DM_RELOAD_SECONDS", "150"))


def node_reload_on():
    """Whether DM_NODE_RELOAD is on. Read at each call, never cached."""
    return os.environ.get("DM_NODE_RELOAD", "off").strip().lower() == "on"


def reload_target(name, procs):
    """The node to reload `name` on, or None and why not. `procs` is what this
    host would otherwise start for the agent (agent_procs). Only an agent whose
    one process is its node, online in pm2, is reloaded; anything else is
    started the way it always was. With the setting off this asks nothing."""
    if not node_reload_on():
        return None, "DM_NODE_RELOAD is off"
    row = next((e for e in load_list() if e.get("name") == name), None) or {}
    if not row.get("node_root"):
        return None, f"{name} runs no node of its own on this host's inventory, so its adapter is started"
    holder = {"root": row["node_root"], "user": row.get("node_user") or NODE_USER,
              "proc": row.get("node_proc") or NODE_PROC}
    if list(procs) != [holder["proc"]]:
        return None, f"this host starts {', '.join(procs)} for {name}, not its node alone, so pm2 starts them"
    st = node_proc_state(holder["proc"])
    if not st or st.get("status") != "online":
        return None, f"{holder['proc']} is {st.get('status') if st else 'not in pm2'}, so starting it serves {name}"
    return holder, None


def reload_on_node(name, holder):
    """Ask the running node to serve `name` again from its folder:
    `mesh-adapter agent reload <name> --json`, as the node's user against the
    node's root. Returns the adapter's one-line answer with the node named,
    always a dict with `ok`, never raising. `code` NOT_RELOADED means the node
    was told and the agent did not serve; every other refusal means the node
    could not be told."""
    cmd = (f"env MESH_ADAPTER_STATE={shlex.quote(holder['root'])} /usr/bin/mesh-adapter agent reload "
           f"{shlex.quote(name)} --json")
    said = {"node": holder["proc"]}
    try:
        p = subprocess.run(["su", "-", holder.get("user") or NODE_USER, "-c", cmd],
                           capture_output=True, text=True, timeout=RELOAD_SECONDS)
    except subprocess.TimeoutExpired:
        return {**said, "ok": False, "code": "TIMEOUT", "error": f"agent reload did not answer in {RELOAD_SECONDS}s"}
    except (OSError, subprocess.SubprocessError) as e:
        return {**said, "ok": False, "code": "NOT_RUN", "error": str(e)[:300]}
    lines = [ln for ln in (p.stdout or "").splitlines() if ln.strip().startswith("{")]
    try:
        doc = json.loads(lines[-1]) if lines else None
    except ValueError:
        doc = None
    if not isinstance(doc, dict) or "ok" not in doc:
        # An adapter without `agent reload` prints its usage and no JSON.
        return {**said, "ok": False, "code": "NO_ANSWER",
                "error": ((p.stderr or "") + (p.stdout or "")).strip()[-300:] or f"exit {p.returncode} and nothing said"}
    return {**said, **doc}


def reload_reached(said):
    """Whether the node was told: served again, or refused the agent itself."""
    return bool(said.get("ok")) or said.get("code") == "NOT_RELOADED"


def start_processes(name, step="pm2"):
    """Step 9's first half: start what this host starts for this agent, and
    report which processes and why, so a deploy that started one process where
    the reader expected two says so rather than leaving them to notice.

    With DM_NODE_RELOAD on, an agent on a running node is reloaded there
    instead, `started` is empty and `reloaded` carries the node's answer."""
    procs, held, why = agent_procs(name)
    attendant = f"not started: {why}" if held else f"started: {why}"
    node, why_not = reload_target(name, procs)
    if node:
        said = reload_on_node(name, node)
        if reload_reached(said):
            return {"started": [], "attendant": attendant, "reloaded": said}
        why_not = f"{node['proc']} could not be told to reload {name} ({said.get('code')}: {said.get('error')}), so it was started"
    run(["pm2", "start", CONF, "--only", ",".join(procs)], step, 90)
    return {"started": procs, "attendant": attendant,
            **({"reload": f"not used: {why_not}"} if node_reload_on() else {})}


def serve_again(name, processes):
    """After an agent's old files were put back: have what serves it read
    them, the way step 9 brought it up. A reload when it was reloaded (and a
    node restart if the node cannot be told), else the pm2 restart of what was
    started, exactly as before. Returns the words for the record."""
    if processes.get("reloaded"):
        procs = [processes["reloaded"].get("node") or NODE_PROC]
        node, _ = reload_target(name, procs)
        if node:
            said = reload_on_node(name, node)
            if said.get("ok"):
                return f"reloaded on {node['proc']}"
        subprocess.run(["pm2", "restart", *procs], capture_output=True)
        return f"{procs[0]} restarted, because it could not reload {name}"
    subprocess.run(["pm2", "restart", *processes["started"]], capture_output=True)
    return "processes restarted"


def restarts_allowed_of(*processes):
    """What the watch allows the node: no restart at all when every agent in
    it was reloaded; otherwise the guard's default (the one restart a start of
    the node causes)."""
    return 0 if processes and all(p.get("reloaded") for p in processes) else None


def check_served(name, processes, **kw):
    """Step 9's check after start_processes: start_and_smoke with the same
    arguments as always, and, when the agent was reloaded, the node's answer
    on whether it is served in place of reading the node's log."""
    if processes.get("reloaded"):
        return start_and_smoke(name, served=bool(processes["reloaded"].get("ok")), **kw)
    return start_and_smoke(name, **kw)


# THE QUESTION THE SMOKE CHECK ASKS THE BRAIN. Asked plainly ("Reply with one
# sentence: what is your job?"), a model with tools often went looking for its
# job first: it globbed and listed its home, ran env and ls /tmp, reached a
# path its harness would not allow, and ended the run with no final text, so
# a good install read as failed. On 2026-10-24 that failed every tone-* update
# on the dev fleet (and some on prod): 1 of 4 runs of the plain question
# answered on dev, 6 of 6 of this one did. The probe asks whether the brain
# answers, not what it can find, so it says not to look.
SMOKE_PROBE = "Without using any tools or reading any files, reply with one sentence: what is your job?"


def start_and_smoke(name, ask_model=True, served=None):
    """Step 9. Start (or restart) the two processes and check, smoke grade:
    the adapter listens, and the brain answers a direct probe. A reinstall of
    bytes that already passed does not ask the brain (`ask_model` False): the
    probe wakes a model, and the watch after it asks the agent without one.

    `served` is the node's own answer after a reload (DM_NODE_RELOAD), and is
    then what "listening" means: the log line is not read, because a reloaded
    agent's line from an earlier start is already in the log. An agent the
    node did not serve wakes no model."""
    if served is not None:
        if not served:
            return {"passed": False, "listening": False, "probe_reply": "",
                    "probe": "not run: the node did not serve the agent after the reload"}
        if not ask_model:
            return {"passed": True, "listening": True, "probe_reply": "",
                    "probe": "not run: a reinstall of bytes that already passed it; the watch's health probe wakes no model"}
        return brain_probe(name, True)
    listening = False
    # On the node the line is the node's, in its one log, and says which agent.
    # THE AGENT'S OWN NODE, not the host's default: an account has a node of
    # its own (node_for_owner), and reading the default node's log failed every
    # update of an agent on another node that had never had a namesake on the
    # default one (2026-09-23, fact-checker and pitch-writer on the platform's
    # node; site-reader passed only because v1's site-reader had once run on
    # the owner's).
    on_node, _ = node_here()
    mine = next((a for a in load_list() if a.get("name") == name), {}) or {}
    node_proc = mine.get("node_proc") or NODE_PROC
    log = f"{LOGS}/{node_proc}.log" if on_node else f"{LOGS}/{name}-adapter.log"
    mark = f"+ {name} served by this node" if on_node else "listening as"
    # Longer on the node: it restarts holding every agent on it, and with 28
    # agents on the platform's node the line for this one came 64 seconds
    # after the restart, four past the old one-minute window, so a good update
    # of repo-scanner was reported unheard and rolled back (2026-09-27).
    for _ in range(120 if on_node else 30):
        time.sleep(2)
        if os.path.exists(log) and mark in open(log, errors="ignore").read():
            listening = True
            break
    if not ask_model:
        return {"passed": listening, "listening": listening, "probe_reply": "",
                "probe": "not run: a reinstall of bytes that already passed it; the watch's health probe wakes no model"}
    return brain_probe(name, listening)


def brain_probe(name, listening):
    """The smoke check's second half: the brain answers a direct probe."""
    probe = ""
    try:
        probe = subprocess.run(
            ["su", "-", name, "-c",
             f"timeout 240 bash {BRAINS}/{name}.sh {shlex.quote(SMOKE_PROBE)}"],
            capture_output=True, text=True, timeout=260).stdout.strip()
    except subprocess.TimeoutExpired:
        pass
    return {"passed": listening and bool(probe), "listening": listening, "probe_reply": probe[:400]}


# ── the node lock ─────────────────────────────────────────────────────────
#
# A REMOVAL AND A NODE RESTART MUST NOT OVERLAP. On the dev fleet on
# 2026-10-24 node-fix-check was removed while another agent's deploy restarted
# mesh-node-platform: the node that came up had read its roster before the
# folder went, went on serving the removed agent, and its writers put the
# folder back. A second `agent remove` cleared it, and only because somebody
# looked. So every act that starts or restarts a node holds this host-wide
# lock from the start until its watch is over, and a removal holds it from
# before it waits for the node to settle until it has seen the folder stay
# gone. One process runs one act, but an act re-enters it (a deploy's
# rollback restarts the node inside the deploy's own hold), so it counts.
NODE_LOCK = os.environ.get("DM_NODE_LOCK", f"{FLEET}/deploymgr-node.lock")
# HOW LONG AN ACT WAITS FOR THE LOCK. deploy-executor.py adds this same
# number (the same variable, the same default; keep the two in step) to its
# DEPLOY_TIMEOUT, so an act that waits its full turn still has the build and
# the smoke and watch after it before the executor would kill it. A deploy or update takes the lock before
# anything is placed, so that refusal leaves nothing behind.
NODE_LOCK_SECONDS = int(os.environ.get("DM_NODE_LOCK_SECONDS", "600"))
# The wait of a put-back that runs after its act let go of the lock: short,
# because it is the end of a failing act and must not use up its time.
NODE_LOCK_SOFT_SECONDS = int(os.environ.get("DM_NODE_LOCK_SOFT_SECONDS", "60"))
_NODE_LOCK = {"fd": None, "depth": 0}


class NodeLockBusy(Exception):
    pass


def acquire_node_lock(why, soft=False):
    """Take (or re-enter) the host's node lock for `why`. Waits up to
    NODE_LOCK_SECONDS (NODE_LOCK_SOFT_SECONDS when soft) for another act to
    let go, then refuses at step "lock" (or, soft, raises NodeLockBusy for a
    caller that must not refuse, such as a rollback). Every acquire is
    matched by release_node_lock; out() lets go of whatever is still held,
    since an act's printed answer is its end."""
    if _NODE_LOCK["depth"] or fcntl is None:
        _NODE_LOCK["depth"] += 1
        return
    # Opened for reading: flock takes an exclusive lock on any descriptor, and
    # an act run as a user other than root can still open root's file.
    fd = os.open(NODE_LOCK, os.O_RDONLY | os.O_CREAT, 0o644)
    bound = NODE_LOCK_SOFT_SECONDS if soft else NODE_LOCK_SECONDS
    deadline = time.time() + bound
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            if time.time() >= deadline:
                os.close(fd)
                said = (f"another act held the node lock ({NODE_LOCK}) for more than {bound}s, so "
                        f"{why} did not start; nothing was changed by this act at this step")
                if soft:
                    raise NodeLockBusy(said)
                fail("lock", said)
            time.sleep(min(1.0, max(0.01, deadline - time.time())))
    _NODE_LOCK.update(fd=fd, depth=1)


def release_node_lock(all_of_it=False):
    if _NODE_LOCK["depth"] <= 0:
        return
    _NODE_LOCK["depth"] = 0 if all_of_it else _NODE_LOCK["depth"] - 1
    if _NODE_LOCK["depth"] == 0 and _NODE_LOCK["fd"] is not None:
        fd, _NODE_LOCK["fd"] = _NODE_LOCK["fd"], None
        if _NODE_LOCK.pop("handed", False):
            # The landing's lock, not this process's to let go: the landing
            # that handed it over still holds it, and lets go when it is done.
            return
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


# THE LOCK A LANDING HANDS EACH PLACEMENT. A batched landing (land, below)
# takes the node lock once and places each agent in a process of its own, so a
# refusal in one placement ends that agent's act and nobody else's. Each such
# process is given the landing's open lock file by number (DM_NODE_LOCK_FD,
# passed down with the descriptor itself). It is believed only when that
# descriptor is the node lock file and holds the lock: flock on a descriptor
# that shares the landing's open file succeeds at once, and on any other open
# file it would have to wait. So nothing else can pass for the landing.
NODE_LOCK_FD_VAR = "DM_NODE_LOCK_FD"


def take_handed_node_lock():
    """Hold the node lock the landing handed this process, or refuse at step
    "lock" without placing anything."""
    v = os.environ.get(NODE_LOCK_FD_VAR, "")
    why = f"no node lock was handed to this placement ({NODE_LOCK_FD_VAR} is not set)"
    if fcntl is None:
        why = "this host has no flock, so a landing cannot hand its node lock to a placement"
    elif v.isdigit():
        fd = int(v)
        try:
            st, want = os.fstat(fd), os.stat(NODE_LOCK)
            if (st.st_dev, st.st_ino) != (want.st_dev, want.st_ino):
                why = f"descriptor {fd} is not the node lock ({NODE_LOCK})"
            else:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                _NODE_LOCK.update(fd=fd, depth=1, handed=True)
                return
        except OSError as e:
            why = f"descriptor {fd} does not hold the node lock: {e}"
    fail("lock", f"{why}; a placement runs only inside the landing that holds the node lock, so nothing was placed")


@contextlib.contextmanager
def node_lock(why, soft=False):
    """The node lock, held for a block (acquire_node_lock)."""
    acquire_node_lock(why, soft)
    try:
        yield
    finally:
        release_node_lock()


def node_proc_state(proc):
    """The node process as pm2 has it: {status, pid, restarts, up_since}
    (seconds since the epoch), or None when pm2 does not hold it."""
    try:
        p = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=10)
        rows = json.loads(p.stdout or "[]")
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    for r in rows if isinstance(rows, list) else []:
        if isinstance(r, dict) and r.get("name") == proc:
            env = r.get("pm2_env") or {}
            up = env.get("pm_uptime")
            return {"status": env.get("status"), "pid": r.get("pid"), "restarts": env.get("restart_time"),
                    "up_since": up / 1000 if isinstance(up, (int, float)) else None}
    return None


# ── the install guard (guard.mjs) ─────────────────────────────────────────
#
# 2026-09-29: ride-maker, the thirtieth agent on mesh-node-platform, pushed the
# node's NATS CONNECT past the broker's max_control_line and every agent on the
# node was unreachable for eighteen minutes, while this procedure said
# "deployed" (docs/technical-debt.md item 93). So an install now asks two
# things of guard.mjs: before anything is placed, whether the node and the host
# would stay under 80% of every limit with it; and after, whether the node
# stayed well for two minutes. The measuring is guard.mjs's; what to do about
# the answer (refuse, or take the install back out) is here, where the install
# is.
GUARD = _beside("deploymgr-guard.mjs", "guard.mjs")
WATCH_SECONDS = int(os.environ.get("DM_WATCH_SECONDS", "120"))
RECOVERY_SECONDS = int(os.environ.get("DM_RECOVERY_SECONDS", "60"))


def guard_answer(argv, timeout):
    """One guard.mjs answer, parsed, or None and why there is none. Never
    refuses: what a missing answer means is the caller's to say."""
    if not GUARD:
        return None, ("the install guard (deploymgr-guard.mjs) is not beside this file, so the node and the host "
                      "could not be measured")
    try:
        p = subprocess.run(["node", GUARD, *argv], capture_output=True, text=True, timeout=timeout)
        lines = [ln for ln in (p.stdout or "").splitlines() if ln.strip()]
        res = json.loads(lines[-1]) if lines else None
    except subprocess.TimeoutExpired:
        return None, f"the install guard timed out after {timeout}s"
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return None, f"the install guard could not be run: {str(e)[:200]}"
    if not isinstance(res, dict):
        return None, f"the install guard gave no answer: {(p.stderr or '')[-300:]}"
    return res, ""


def guard(argv, step, timeout):
    """One guard.mjs answer, parsed. A guard that is missing or says nothing
    refuses the step: an install that could not be measured is not one this
    procedure may call safe. Used where nothing is placed yet (capacity); the
    watch, which runs after the install is in, uses guard_answer and treats no
    answer as a failed watch (watch_after)."""
    res, why = guard_answer(argv, timeout)
    if res is None:
        fail(step, why)
    return res


def unfinished_watch(why, during="watch"):
    """A watch that could not be completed, said as a failed one. Its reason
    is what an operator acts on."""
    return {"ok": False, "act": during, "unfinished": True, "reason": f"the {during} could not finish: {why}"}


def bytes_under(path):
    n = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                n += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return n


def holder_of(name, node=None):
    """The pm2 process that holds this agent's inbox, its log, and the node root
    when it is a node: what the guard measures and watches."""
    if node:
        return {"proc": node["proc"], "log": f"{LOGS}/{node['proc']}.log", "root": node["root"],
                "user": node.get("user") or NODE_USER}
    return {"proc": f"{name}-adapter", "log": f"{LOGS}/{name}-adapter.log", "root": None}


def capacity_check(name, pkg_dir, holder, update=False, also_adding=0):
    """Step 2's last refusal: would the node or the host pass 80% of a limit
    with this install on it? Made before anything is placed, so a refusal here
    leaves nothing behind.

    `also_adding` is set only by a batched landing: the new agents it placed on
    this node earlier in the same landing. Their folders are on the node, but
    the credential the node connects with is minted at its next start, so the
    guard is told to count them as well as this one."""
    argv = ["precheck", "--agent", name, "--package-bytes", str(bytes_under(pkg_dir)), "--fleet", FLEET,
            *(["--node-root", holder["root"]] if holder.get("root") else []), *(["--update", "1"] if update else []),
            *(["--also-adding", str(int(also_adding))] if also_adding else [])]
    res = guard(argv, "capacity", 180)
    if not res.get("ok"):
        fail("capacity", res.get("refusal") or res.get("error") or "the install guard refused without a reason",
             capacity=res)
    return {k: res.get(k) for k in ("adding", "node", "threshold", "checks") if k in res}


def watch_mark(holder):
    """Where the holder's pm2 restart count and log stand before this install
    starts anything, so the watch can tell what the install did.

    A mark the guard could not take comes back as an unfinished watch rather
    than a refusal: in a deploy the agent is already added to its node when
    this runs, and a refusal here would leave it served with nobody watching
    (watch_new_install counts it as a failed watch and takes the agent out)."""
    res, why = guard_answer(["mark", "--proc", holder["proc"], "--log", holder["log"]], 90)
    return res if res is not None else unfinished_watch(why, "mark")


def watch_after(name, holder, before, seconds=None, agent=True, restarts_allowed=None):
    """The two minutes before "deployed": the holder's restart count must not
    climb, its log must not say the connect failed, and the agent and three
    others on the node must answer a probe that wakes no model.

    `restarts_allowed` is how many restarts since the mark the guard accepts;
    None leaves the guard's default (one, the restart a start of the node
    causes). After a reload it is 0: nothing restarted the node on purpose."""
    seconds = WATCH_SECONDS if seconds is None else seconds
    argv = ["watch", "--proc", holder["proc"], "--log", holder["log"], "--seconds", str(seconds),
            "--agent", name if agent else "-"]
    if restarts_allowed is not None:
        argv += ["--restarts-allowed", str(int(restarts_allowed))]
    if holder.get("root"):
        argv += ["--node-root", holder["root"]]
    else:
        argv += ["--session-file", f"/home/{name}/.agentmesh/adapter/session_api.json"]
    if isinstance(before.get("restarts"), int):
        argv += ["--restarts-before", str(before["restarts"])]
    if isinstance(before.get("log_offset"), int):
        argv += ["--log-from", str(before["log_offset"])]
    # A WATCH THAT COULD NOT FINISH IS A FAILED WATCH. Until 2026-10-24 a guard
    # that ran past its limit refused the act from inside guard(), which ended
    # the procedure before watch_new_install could take the new agent back out:
    # on the dev fleet two egress-check installs were refused that way while
    # the starved node answered nothing, and the first one stayed on its node,
    # served and unpaused, until somebody removed it by hand. The answer that
    # never came is now a "no", so the rollback runs.
    if before.get("unfinished"):
        # No baseline was taken, so a restart the install caused cannot be told
        # from one before it. A watch that passed without one is not a pass.
        return unfinished_watch(f"no starting mark was taken ({before.get('reason')})")
    res, why = guard_answer(argv, seconds + 120)
    if res is None:
        return unfinished_watch(why)
    return res


def recovered(holder, restart=True):
    """After an install is taken back out: restart the node so it connects
    without it (unless the caller already restarted what it runs), then watch
    its neighbours for a minute. Returns that watch. An agent with its own
    adapter shared it with nobody, so there is nothing to confirm."""
    if not holder.get("root"):
        return {"ok": True, "act": "watch", "note": "the agent had its own adapter; no other agent shared it"}
    # Nothing here may raise past the rollback that called it: a recovery that
    # could not be watched is reported as not recovered, and the refusal after
    # it still says what was taken out.
    try:
        with node_lock("the recovery watch", soft=True):
            mark = watch_mark(holder)
            if restart and node_reload_on() and not mark.get("unfinished"):
                # With reload on, the agent taken out was paused through the
                # node, which stopped serving it and left the others running.
                # Restarting them all is what reload is there to avoid, so the
                # neighbours are watched first, allowed no restart, and the
                # node is restarted only if they do not stay well.
                first = watch_after("-", holder, {"restarts": mark.get("restarts"), "log_offset": mark.get("log_offset")},
                                    seconds=RECOVERY_SECONDS, agent=False, restarts_allowed=0)
                if first.get("ok"):
                    return {**first, "restarted": False,
                            "note": "the node was not restarted: its other agents answered and it held its connection without it"}
                mark = watch_mark(holder)
            if restart:
                try:
                    subprocess.run(["pm2", "restart", holder["proc"]], capture_output=True, text=True, timeout=90)
                except subprocess.TimeoutExpired:
                    return unfinished_watch(f"pm2 restart {holder['proc']} did not return in 90s", "recovery watch")
            if mark.get("unfinished"):
                return unfinished_watch(mark.get("reason"), "recovery watch")
            return watch_after("-", holder, {"restarts": mark.get("restarts"), "log_offset": mark.get("log_offset")},
                               seconds=RECOVERY_SECONDS, agent=False)
    except NodeLockBusy as e:
        return unfinished_watch(str(e), "recovery watch")


def rolled_back_state(what, recovery):
    """The sentence the record and the executor carry after a rollback."""
    if recovery.get("ok"):
        return f"rolled back: {what}; the node recovered (its neighbours answered and it held its connection for {RECOVERY_SECONDS} seconds)"
    return f"rolled back: {what}; the node has NOT recovered: {recovery.get('reason') or recovery.get('error')}"


def pause_new_agent(name, holder):
    """Take a NEW agent back out of its node by PAUSING it there, never by
    moving its folder away.

    Moving an agent's folder out of a running node is how the stray ride-maker
    key (UBGA5L...) was made: a writer still bound to the agent puts an empty
    folder back and the node mints a fresh identity for it (technical debt
    100). `agent remove` deletes the folder and has the same exposure. A pause
    leaves the folder, its identity and its mail where they are; the node
    stops serving it, and a node restarted without it (recovered() below)
    mints its credential without the agent's subjects. So the paused agent is
    the rollback, and it waits there to be removed once the adapter no longer
    re-keys a removed folder.

    The pause goes through the node (`mesh-adapter agent pause`, which writes
    paused.json and tells the running node). A node too unwell to be told still
    reads the file at its next start; if the command could not even write it,
    the same file is written here. An agent with its own adapter has that
    process deleted instead, which touches no folder. Returns what was done,
    in words."""
    if not holder.get("root"):
        subprocess.run(["pm2", "delete", holder["proc"]], capture_output=True, text=True)
        return f"{holder['proc']} was deleted from pm2"
    folder = f"{holder['root']}/agents/{name}"
    if not os.path.isdir(folder):
        return f"{name}'s folder was not at {folder}, so there was nothing to pause"
    user = holder.get("user") or NODE_USER
    said = ""
    try:
        p = subprocess.run(["su", "-", user, "-c",
                            f"env MESH_ADAPTER_STATE={holder['root']} /usr/bin/mesh-adapter agent pause {name}"],
                           capture_output=True, text=True, timeout=90)
        said = (p.stderr or p.stdout or "").strip()[-200:] if p.returncode != 0 else ""
    except (OSError, subprocess.SubprocessError) as e:
        said = str(e)[:200]
    paused = f"{folder}/paused.json"
    how = "through the node (mesh-adapter agent pause)"
    if not os.path.exists(paused):
        # The same file `agent pause` writes, so `agent resume` undoes it.
        with open(paused, "w") as f:
            json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": "deploymgr rollback"}, f, indent=2)
            f.write("\n")
        os.chmod(paused, 0o600)
        try:
            shutil.chown(paused, user, user)
        except (LookupError, OSError):
            pass
        how = f"by writing its paused.json, because the node's agent pause did not{': ' + said if said else ''}"
    return (f"{name} was paused on {holder['proc']} {how}; its folder and key stay where they are and nothing was "
            f"re-keyed; it awaits removal, which waits on the adapter no longer minting a key for a removed folder "
            f"(docs/technical-debt.md item 100)")


def watch_failure(what, watched):
    """The refusal's sentence: a node that did not stay well, or a watch that
    could not finish and so counts as one that failed."""
    if watched.get("unfinished"):
        return f"the watch after {what} could not finish, so it counts as failed: {watched.get('reason')}"
    return f"the node did not stay well after {what}: {watched.get('reason')}"


def watch_new_install(name, holder, before, restarts_allowed=None, **report):
    """Watch a NEW agent's node; on failure pause the agent on its node,
    confirm the node recovers, and refuse with "rolled back" and the reason.
    Returns the watch when it passed."""
    watched = watch_after(name, holder, before, restarts_allowed=restarts_allowed)
    if watched.get("ok"):
        return watched
    what = pause_new_agent(name, holder)
    recovery = recovered(holder)
    fail("watch", watch_failure(f"{name} was placed", watched),
         state=rolled_back_state(what, recovery), rolled_back=True, name=name,
         watch=watched, recovery=recovery, **report)


def watch_update(name, holder, before, put_old_back, version, common, restarts_allowed=None):
    """Watch the node after an update; on failure put the old version back
    (put_old_back restores and restarts, or reloads), confirm the node
    recovers, and refuse with "rolled back" and the reason. Returns the watch
    when it passed."""
    watched = watch_after(name, holder, before, restarts_allowed=restarts_allowed)
    if watched.get("ok"):
        return watched
    what = put_old_back()
    recovery = recovered(holder, restart=False)
    fail("watch", watch_failure(f"{name} {version} was placed", watched),
         state=rolled_back_state(what, recovery), act="update", restored=True, rolled_back=True,
         recovery=recovery, **{**common, "watch": watched})


def placement_of(args):
    """Where this deploy puts the agent's WORK: the owner's word when the
    instruction carries one, and this host's default when it does not.

    A HOST PLACEMENT HAS TO SAY WHY. Cloud Run being the default was not
    enough. Every refusal below used to end by offering `placement "host"` as
    the way past it, so the easiest thing to do with a container that would not
    build was to put the work on this machine, and that is exactly what
    happened: explainer-maker and process-runner were moved here to iterate on
    a bug, the reason lived in nobody's record, and they were still here
    thirty-six hours later running code the inventory did not know about
    (2026-09-12). A reason in the argfile does not stop anyone; it means the
    next person can ask "why is this on the VM" and the deploy record answers.
    """
    p = args.get("placement") or DEFAULT_PLACEMENT
    if p not in PLACEMENTS:
        fail("validate", f"placement must be one of {', '.join(PLACEMENTS)}, and this instruction says {p!r}")
    if p == "host":
        why = args.get("host_because")
        if not (isinstance(why, str) and why.strip()):
            fail("placement",
                 "a host placement puts this agent's work on this machine, where it stays until somebody "
                 "notices. Say why in host_because, in a sentence the next person can act on (\"the chromium "
                 "base will not build\", \"iterating on the command, back to cloud-run by Friday\"). The default "
                 "placement is cloud-run and needs no reason.")
        if args.get("cloud"):
            # An instruction that names a customer's project and then asks for
            # the work to run HERE is two instructions, and the customer would
            # be told their agent runs in their cloud while it ran on a VM of
            # ours beside fifteen others. Refused rather than resolved: which
            # half is the mistake is not this procedure's to guess.
            fail("placement",
                 f"this instruction carries a grant for project "
                 f"{(args['cloud'] or {}).get('project')!r} and also asks for placement \"host\", which puts "
                 f"the work on this machine and touches that project for nothing. Ask for cloud-run, which "
                 f"is what a grant is for, or send the instruction without the grant.")
    return p


def check_placement_before_touching(args):
    """The container half's refusals, made BEFORE the unix user exists.

    They are the same refusals image_step and container_step make for
    themselves, and making them twice is deliberate: those two are separately
    callable procedures and have to refuse on their own, and a placed deploy
    that discovered a missing bucket after useradd would have made a user and a
    home for an agent it then refused. Step 2 of the install is the host and the
    instruction checked before anything is created, and where the work runs is
    part of the instruction.

    A registry, a bucket, a region and a project are addresses, and no package
    carries one (12.6 rule 3). They come from the argfile, or from this host's
    environment when the argfile leaves them out.

    THE SUPERVISOR IS CHECKED HERE FOR A DIFFERENT REASON. A Cloud Run job has
    no address and does not exist between executions, so a message reaches it
    only because something on this host reads the inbox and dispatches it, and
    the only thing that does is the fleet supervisor. Without one, a placed
    deploy would leave an agent whose mail arrives at an adapter nobody drains:
    every part of it built, and no work done. That is refused, before anything
    exists, rather than deployed and explained afterwards."""
    # WHAT THESE REFUSALS NO LONGER SAY. Each one used to end by offering
    # `placement "host"`, which made putting the work on this machine the
    # documented way past a missing address. Naming the fix is the operator's
    # business; a host placement is still available and now has to say why
    # (placement_of), so it is a decision somebody records rather than the path
    # of least resistance printed in an error message.
    # THE CUSTOMER'S GRANT, READ AND GUARDED HERE, at step 2's place in the
    # order, so a pairing that names two customers is refused before this
    # deploy has made a unix user for an agent it is about to refuse. It is
    # read again by each container procedure, for the same reason every other
    # refusal in this function is made twice: those procedures are separately
    # callable and have to refuse on their own.
    enter_cloud(args, "deploy")
    held, why = supervisor_here()
    if not held:
        fail("placement",
             f"this deploy would put the work in Cloud Run and {why}. Nothing on this host would carry a "
             f"message to the job, so the adapter would hold the agent's mail and no work would be done. "
             f"Start the fleet supervisor on this host.")
    if not (args.get("registry") or REGISTRY):
        fail("placement", "registry must say where the image is published: put it in the argfile or in "
                          "DM_REGISTRY")
    if not (args.get("bucket") or BUCKET):
        fail("placement", "bucket must name the storage the job mounts: put it in the argfile or in "
                          "DM_BUCKET")
    if emitter() is None:
        fail("placement", "emit-image.mjs is not beside this file, and a package cannot be turned into an "
                          "image without it")


# ── deploy ────────────────────────────────────────────────────────────────

# The anchor of the Mesh Provided Agents: ours, and any account may use them on
# its own work (docs/agent-categories-plan.md). System (.system@), test
# (.test@) and demo (.demo@) agents are not under it and keep their doors.
PROVIDED_ANCHOR = ".platform@agentmesh.ai"


def opens_to_registered(interaction, handle):
    """Does this agent's door let in any registered sender by default?

    A service agent: yes, it is sent work by whoever runs a process or a
    solution. A Mesh Provided Agent (a `.platform@agentmesh.ai` handle): yes,
    whatever its interaction, because nobody attends its door to approve a
    stranger (the owner, 2026-09-28). Every other agent a person attends keeps
    the adapter's default, which holds a first message for its owner.

    The door still refuses anonymous senders, the per-sender limit still
    applies, and the platform refuses senders with no verified name before
    they reach any door (MESH_REQUIRE_NAMES)."""
    if interaction == "service":
        return True
    return isinstance(handle, str) and handle.lower().endswith(PROVIDED_ANCHOR)


def refuse_tenant_package(args):
    """A person's own agent runs only in the tenant project
    (docs/tenant-isolation-plan.md). This procedure places packages in the
    platform's project and nowhere else yet, so a package instruction that
    names a tenant is refused before anything is fetched or started, rather
    than installed beside the platform's own agents."""
    if args.get("tenant"):
        fail("validate", "this package is a person's own agent and runs only in the tenant project; "
                         "placing a package there is not built yet, so nothing was installed")


def deploy(argfile):
    """The whole deploy in one act, as the executor has always run it: prepare,
    place, start and watch under the node lock, then the work's placement.

    A batched landing (deploy-executor.py with DM_LAND_BATCH on) runs the same
    three halves in separate acts instead (prepare, land, finish below), so
    several agents land behind one node restart. This path is unchanged by it."""
    ctx = deploy_prepare(argfile)
    name, holder = ctx["name"], ctx["holder"]
    # The node lock, from before anything exists to the end of the watch: an
    # agent added to its node is served from that moment, so a lock refused
    # after `agent add` would leave it served and unwatched (node_lock).
    acquire_node_lock(f"the deploy of {name}")
    deploy_place(ctx)
    # Held (since before anything was placed) to the end of the watch and any
    # rollback in it, so no removal runs while this node is coming up.
    with node_lock(f"the deploy of {name}"):
        before = watch_mark(holder)
        processes = start_processes(name)
        smoke = check_served(name, processes)
        # 10, begun now: the work's placement runs in a process of its own
        # while the node is watched (start_work), and deploy_finish waits for
        # it. Any refusal from here on takes it down again first (on_fail).
        ctx["work"] = start_work_if_wanted(ctx, smoke)

        # 9b. The watch. Two minutes of the node holding its connection with this
        # agent on it, and the agent and three neighbours answering, before anything
        # says deployed; otherwise the agent is taken back out, its work if it
        # was placed meanwhile is taken down, and the node is confirmed well
        # without it.
        watched = watch_new_install(name, holder, before, restarts_allowed=restarts_allowed_of(processes),
                                    act="deploy", package=ctx["pkg_name"],
                                    version=ctx["pkg_version"], host=HOST, agent_key=ctx["agent_key"],
                                    handle=ctx["handle"], capacity=ctx["capacity"], smoke=smoke)

    release_node_lock()  # the hold taken before capacity_check
    ctx.update(processes=processes, smoke=smoke, watched=watched)
    deploy_finish(ctx)


def deploy_prepare(argfile):
    """Steps 1 and 2: the instruction read and checked, the spend ceiling, the
    package fetched and verified, the host and the placement checked. Nothing
    exists yet and the node is not touched. Returns what the later halves need."""
    # The argfile must be the brain's own: under its home, owned by it.
    if not argfile.startswith(f"{DM_HOME}/tmp/"):
        fail("validate", "argfile outside the deploymgr tmp dir")
    args = json.load(open(argfile))
    refuse_tenant_package(args)

    name = args.get("name", "")
    # The harness is what thinks when a message arrives. The argfile key was
    # "framework" until 2026-09-05; an executor that has not been updated
    # still writes it, so both are read and only "harness" is written.
    harness = args.get("harness") or args.get("framework") or ""
    url = args.get("package_url", "")
    interaction = args.get("interaction", "")
    admit = args.get("admit", [])
    token_name = args.get("boot_token", "")
    model = harness_model(args.get("model"), harness=harness)
    environment = args.get("environment", "")
    expected_sha = args.get("sha256", "")
    stack_bindings = read_stack_bindings(args)
    # Reachable from outside the mesh over A2A: the owner's instruction, a
    # boolean, placed as the door's a2a tier stance on the agent's own host.
    a2a = args.get("a2a", False)
    if not isinstance(a2a, bool):
        fail("validate", "a2a must be true or false")
    # Where the work goes. Read before anything is fetched, because it decides
    # what this deploy has to refuse and it is named in the result whatever it
    # is: an owner who did not say must still be able to read what happened.
    placement = placement_of(args)

    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if user_exists(name):
        fail("validate", f"user {name} already exists; remove it first")
    if harness not in HARNESS_CHOICES:
        fail("validate", f"harness must be one of {HARNESS_CHOICES}; this host can start no other")
    if interaction not in ("service", "interactive"):
        fail("validate", "interaction must be service or interactive")
    if not (isinstance(admit, list) and all(HANDLE_RE.match(h) for h in admit)):
        fail("validate", "admit must be a list of handles")
    if not TOKEN_NAME_RE.match(token_name):
        fail("validate", "boot_token must be a token NAME in the secret store, never a value")
    if not model:
        fail("validate", NO_MODEL)
    if not MODEL_RE.match(model):
        fail("validate", f"bad model {model!r}")
    # Optional; absent means unstated. A statement of where, never of quality.
    if environment and environment not in ("test", "staging", "production"):
        fail("validate", "environment must be test, staging, or production")
    # Optional; absent means the supervisor's default.
    jobs_at_once = jobs_at_once_of(args)
    token_file = f"{TOKENS}/{token_name}.token"
    if not os.path.exists(token_file):
        fail("validate", f"no boot token named {token_name} in the secret store")

    # The spend ceiling, checked before any work and before the token is spent.
    spend_check_and_record(load_list() + load_json_list(CONTAINERS))

    # 1. Fetch and verify. 2. The host and the instruction, before anything exists.
    staging, pkg_dir, sha256, pkg = fetch_and_verify(name, url, expected_sha)
    pkg_name, pkg_version = pkg["manifest"]["name"], pkg["manifest"].get("version", "unknown")
    check_before_touching(args, pkg)
    if placement == "cloud-run":
        check_placement_before_touching(args)
    # The node this agent will land on and the host under it, measured with the
    # agent on them, before the unix user exists (guard.mjs precheck).
    on_node_first, _ = node_here()
    holder = holder_of(name, node_for_owner(args.get("owner")) if on_node_first else None)
    return {"act": "deploy", "args": args, "name": name, "harness": harness, "url": url,
            "interaction": interaction, "admit": admit, "model": model, "environment": environment,
            "stack_bindings": stack_bindings, "a2a": a2a, "placement": placement, "jobs_at_once": jobs_at_once,
            "token_file": token_file, "staging": staging, "pkg_dir": pkg_dir, "sha256": sha256, "pkg": pkg,
            "pkg_name": pkg_name, "pkg_version": pkg_version, "holder": holder}


def deploy_place(ctx, also_adding=0):
    """Steps 2 (capacity) to 9's inventory row: the unix user, the package and
    its dependencies, the environment, the harness, the identity on its node,
    the descriptor, the price and the ledger. Runs under the node lock, which
    the caller holds. Starts nothing; the agent is served from the node's next
    start."""
    args, name, pkg, pkg_dir = ctx["args"], ctx["name"], ctx["pkg"], ctx["pkg_dir"]
    harness, model, interaction = ctx["harness"], ctx["model"], ctx["interaction"]
    admit, a2a, url, sha256 = ctx["admit"], ctx["a2a"], ctx["url"], ctx["sha256"]
    pkg_name, pkg_version = ctx["pkg_name"], ctx["pkg_version"]
    token_file, holder = ctx["token_file"], ctx["holder"]
    capacity = capacity_check(name, pkg_dir, holder, also_adding=also_adding)
    home = f"/home/{name}"
    bindings = INSTALL.plan_bindings(args, pkg, home)
    names = INSTALL.placed_names(bindings)

    # 3. The unix user, its home, and the declared directories.
    run(["useradd", "-m", "-s", "/bin/bash", name], "useradd")
    job_seconds = job_seconds_of(pkg)
    # The model is kept on the row, as update() keeps it: an update filed with
    # no proposal reads it from here, and without it fell back to a model
    # written in code, which on a host with no Google key stopped the update at
    # place_model_key (dev, 2026-10-05, quiz-maker 0.5.1). There is no such
    # model now; the host's model setting answers instead (harness_model).
    entry = {"name": name, "package": pkg_name, "version": pkg_version, "sha256": sha256, "url": url,
             "harness": harness, "model": model, "interaction": interaction, "admitted_at_start": admit,
             "exposed_a2a": a2a, "placement": ctx["placement"],
             **({"job_seconds": job_seconds} if job_seconds else {}),
             **({"wants_replies": True} if wants_replies_of(pkg) else {}),
             **({"run_spec": True} if run_spec_of(name, home, pkg) else {}),
             **({"jobs_at_once": ctx["jobs_at_once"]} if ctx["jobs_at_once"] else {}),
             "state": "installing", "deployed_at": now_iso(),
             **({"environment": ctx["environment"]} if ctx["environment"] else {})}
    CURRENT["entry"] = entry
    with inventory_lock():
        save_list(load_list() + [entry])
    directories = [d["name"] for d in (pkg["install"] or {}).get("directories", []) or []
                   if isinstance(d, dict) and d.get("name")] or ["records", "work"]
    for d in directories:
        os.makedirs(f"{home}/{d}", exist_ok=True)
    for b in bindings:
        if b["kind"] == "directory":
            os.makedirs(b["path"], exist_ok=True)

    # 4. The package, then its dependencies from the lockfiles.
    shutil.copytree(pkg_dir, f"{home}/{pkg_name}")
    run(["chown", "-R", f"{name}:{name}", home], "chown")
    dependencies = install_dependencies(name, home, pkg_name, pkg)

    # 5 and 6. Credentials by name, settings, ceilings: the environment.
    env_files = place_environment(name, home, bindings, pkg)

    # 7. The harness: model key, instructions, skills, configuration, brain.
    secret = place_model_key(name, home, harness, model)
    placed, links = translate_for_harness(name, home, pkg_dir, pkg_name, pkg, harness, model, bindings)
    write_brain(name, harness, model)
    write_run_spec(name, home, pkg)
    run(["chown", "-R", f"{name}:{name}", home], "chown")

    # 8. Identity: redeem the named token, then burn the name's file.
    #
    # On the node (docs/adapter-node-spec.md section 3) the agent is a folder
    # under NODE_ROOT/agents/<name>, made by `agent add`, which mints the
    # identity and redeems the token so the agent belongs to the account and
    # gets its handle; the running node picks the folder up and there is no
    # adapter process per agent. The home keeps a symlink at the path every
    # reader of identity.json by home already knows, so the descriptor and
    # the price written below land in the agent's folder. State commands for
    # this agent then run as the node's user against that folder, which is
    # exactly a one-agent state dir.
    token = open(token_file).read().strip()
    on_node, node_why = node_here()
    if on_node:
        # The node that holds THIS owner's agents (one node per account), not
        # the host's default: an agent added to another account's node would
        # fail that node's credential mint and answer nothing.
        node = node_for_owner(args.get("owner"))
        agent_dir = f"{node['root']}/agents/{name}"
        boot = as_user(node["user"], f"env MESH_ADAPTER_STATE={node['root']} "
                                     f"/usr/bin/mesh-adapter agent add {name} --token {token}", "agent add", 120)
        os.makedirs(f"{home}/.agentmesh", exist_ok=True)
        if not os.path.lexists(f"{home}/.agentmesh/adapter"):
            os.symlink(agent_dir, f"{home}/.agentmesh/adapter")
        state_cmd = f"env MESH_ADAPTER_STATE={agent_dir} /usr/bin/mesh-adapter"
        state_user = node["user"]
        entry["node_root"] = node["root"]
        entry["node_user"] = node["user"]
        entry["node_proc"] = node["proc"]
    else:
        boot = as_user(name, f"env MESH_CREDS_FILE={home}/.config/fleet/mesh.creds "
                             f"/usr/bin/mesh-adapter bootstrap {token}", "bootstrap", 120)
        state_cmd = f"env MESH_CREDS_FILE={home}/.config/fleet/mesh.creds /usr/bin/mesh-adapter"
        state_user = name
    os.remove(token_file)
    ident = json.load(open(f"{home}/.agentmesh/adapter/identity.json"))
    agent_key = ident["public_key"]
    handle = None
    m = re.search(r"named ([^\s]+)", boot)
    if m:
        handle = m.group(1)
    # How the subject's key came to exist and who holds the private half now
    # (8.3, over Section 4.1's two cases). The adapter made the keypair with
    # nkeys.createUser() inside the agent's own home on the machine that
    # answers, so it was GENERATED and not provisioned, and this procedure never
    # read the seed. Root on this host can read that file, which is a second
    # party able to speak as the subject: a record naming only the agent would
    # let a reader count one party where there are two, and counting them is the
    # whole reason the member exists.
    key_custody = {"minted": "generated", "held_by": [agent_key, f"root@{HOST}"]}

    # Admission, settled before first boot.
    for h in admit:
        as_user(state_user, f"{state_cmd} contacts allow {h}", "admit", 60)
    # Reach from outside the mesh: the a2a tier's default, allow or block.
    # The adapter projects it into the registration at boot, so the card and
    # the AgentDoc say what this door enforces.
    as_user(state_user, f"{state_cmd} contacts default a2a {'allow' if a2a else 'block'}", "expose", 60)
    # Work from anybody on the mesh, for an agent that runs on its own. Holding
    # a first message until the owner decides is for one person's agent
    # writing to another person's agent; an agent installed to do steps in
    # processes and solutions is sent work by whoever runs them, and holding
    # it stalled the explainer v2 run at its first step (the owner, 2026-09-23).
    # An agent a person attends keeps the adapter's default, unless it is a
    # Mesh Provided Agent (opens_to_registered).
    if opens_to_registered(interaction, handle):
        as_user(state_user, f"{state_cmd} contacts default registered allow", "admit", 60)

    # The descriptor, bound before first boot so the adapter registers
    # with the pointer and hands the registry the document immediately.
    descriptor = bind_descriptor(home, pkg_name, name, agent_key, handle,
                                 pkg_version, interaction, harness, model, sha256=sha256)

    # The declared price, placed before first boot for the same reason: the
    # SKU rides the registration, so a price written after the adapter is up
    # is a price nobody sees until the next restart.
    price = write_price(name, home, pkg)
    # The trial scope of the allowance, when the package offers a trial. Not
    # in the ledger: the allowance is the owner's document, changed by the
    # owner with `agentmesh allowance set`, and a change there is not drift.
    trial_allowance = write_trial_allowance(name, home, pkg)

    # The ledger of what was placed.
    ledger = write_ledger(name, home, [pkg_name, *placed, *env_files, ".agentmesh/adapter/descriptor.json",
                                       *([".agentmesh/adapter/price.json"] if price else [])],
                          withhold={".config/fleet/env"})

    # 9. Inventory + pm2 + the smoke check.
    entry.update({"agent_key": agent_key, "handle": handle, "secret_placed": secret,
                  "credentials_placed": names["credentials"], "settings_placed": names["settings"],
                  "ceilings": names["ceilings"], "dependencies": dependencies,
                  "descriptor": descriptor, "ledger": ledger, "skills_linked": links,
                  **({"price": price} if price else {}),
                  **({"trial_allowance": trial_allowance} if trial_allowance else {}),
                  "state": "running"})
    replace_row(entry)
    ctx.update(capacity=capacity, names=names, entry=entry, secret=secret, dependencies=dependencies,
               agent_key=agent_key, handle=handle, key_custody=key_custody, descriptor=descriptor,
               price=price, trial_allowance=trial_allowance, ledger=ledger)
    return ctx


def deploy_finish(ctx):
    """Step 10 and the answer: where the work runs, after the agent landed and
    its node was watched. `ctx` carries `processes`, `smoke` and `watched`."""
    args, name, entry = ctx["args"], ctx["name"], ctx["entry"]
    placement, names = ctx["placement"], ctx["names"]
    agent_key, handle = ctx["agent_key"], ctx["handle"]
    price, trial_allowance = ctx["price"], ctx["trial_allowance"]
    stack_bindings, environment = ctx["stack_bindings"], ctx["environment"]
    # 10. Where the work runs. On a host placement the answer is "the same
    # machine as the adapter", which is the boring case and is exactly why it
    # has to be said: an owner reading a page that says nothing cannot tell a
    # host install from a container whose location was never recorded.
    #
    # On the default placement the two container procedures run here, and the
    # inventory entry above is still the one fail() marks, so an image that will
    # not build leaves an agent whose state names the step it stopped at and a
    # `remove` that cleans it. Nothing falls back to running the work here.
    #
    # Where the placement was begun while the node was watched (start_work),
    # this waits for its answer instead of placing the work a second time, and
    # a refusal from it is this act's refusal, exactly as if it had run here.
    work = None
    if placement == "cloud-run":
        work = finish_work(ctx["work"]) if ctx.get("work") else place_in_cloud_run(args)
        runtime = work["runtime"]
    else:
        runtime = record_runtime(entry, {"key": agent_key, "handle": handle, "name": name}, kind="host")
    CURRENT["entry"] = None
    shutil.rmtree(ctx["staging"], ignore_errors=True)

    out({"ok": True, "act": "deploy", "name": name, "package": ctx["pkg_name"],
         "version": ctx["pkg_version"], "sha256": ctx["sha256"], "url": ctx["url"],
         "host": HOST, "harness": ctx["harness"], "interaction": ctx["interaction"],
         "egress": dict(EGRESS_OPEN),
         # The model the agent runs with as placed, which is not always the
         # one asked for (technical debt 456).
         **model_placed_of(work, ctx["model"]),
         # Where the work runs, and on a placed deploy the build and the job
         # that were made for it, including the job's own probe under `check`.
         # It is reported beside the smoke check below and not folded into it,
         # because the two observed different things on different machines and
         # a single passed/failed over both would be a grade nobody took.
         "placement": placement, **({"work": work} if work else {}),
         "processes": ctx["processes"],
         # The digest of the image this deploy started, where it started one
         # (8.3), so the deployment record names it beside the package it was
         # built from and a reader can compare the two. It is what the JOB
         # reports, never what the build handed over. A host placement names
         # none: that deploy started processes and no image, and an absent
         # member says its producer did not observe the thing rather than that
         # the thing was not required. WHICH MACHINE does the work is not this
         # member's to say, and `host` above is the adapter's host as it always
         # was; the two sides are stated separately by the runtime record.
         **({"image_digest": work["image_digest"]} if work else {}),
         "agent_key": agent_key, "handle": handle, "key_custody": ctx["key_custody"],
         "admitted_at_start": ctx["admit"], "exposed_a2a": ctx["a2a"],
         "secret_placed": ctx["secret"], "credentials_placed": names["credentials"],
         "settings_placed": names["settings"], "ceilings": names["ceilings"],
         # What the account's stack bound, per system, with the precedence step
         # that supplied it. Absent when this deploy was not filled from a stack.
         **({"bindings": stack_bindings} if stack_bindings else {}),
         "dependencies": ctx["dependencies"], "descriptor": ctx["descriptor"], "ledger": ctx["ledger"],
         # What this agent charges, as placed. Absent means the package
         # declared no price, which is FREE and is the default: a record that
         # said nothing either way would leave a reader unable to tell that
         # from a price the deploy dropped.
         **({"price": price} if price else {}),
         # The allowance's trial ceiling: written, kept as the owner set it, or
         # why not. Absent when the package offers no trial.
         **({"trial_allowance": trial_allowance} if trial_allowance else {}),
         **({"environment": environment} if environment else {}),
         # Which customer project this deploy acted in, under which account,
         # and every call it made there -- the build's and the job's together,
         # because one owner instruction ran through both. Absent where the
         # work runs on our own machines, which is every deploy but this route.
         **cloud_report(),
         "runtime": runtime,
         "smoke": ctx["smoke"],
         # The numbers the install was measured against, and the two minutes
         # watched after it (guard.mjs).
         "capacity": ctx["capacity"], "watch": ctx["watched"]})


# ── update ────────────────────────────────────────────────────────────────

def snapshot(name, home, doc):
    """Copy every ledgered file to a root-owned place before an update
    touches it, so a failed check can put the old version back."""
    root = f"{PREV}/{name}"
    shutil.rmtree(root, ignore_errors=True)
    for e in doc["files"]:
        src = os.path.join(home, e["path"])
        if os.path.exists(src):
            dst = os.path.join(root, "home", e["path"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    for e in doc["outside"]:
        if os.path.exists(e["path"]):
            dst = os.path.join(root, "outside", e["path"].lstrip("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(e["path"], dst)
    return root


def restore(name, home, doc, root, pkg_name):
    """Put the snapshot back: the new package tree goes, every old file
    returns to its path with the agent as owner, the brain returns."""
    shutil.rmtree(f"{home}/{pkg_name}", ignore_errors=True)
    # A file the new version placed where the old one had none does not come
    # back by being copied over, because the snapshot holds nothing to copy.
    # The price is such a file, and an agent restored to a version that asked
    # for nothing, still charging the price of the version that failed, is the
    # worst shape this can take.
    if ".agentmesh/adapter/price.json" not in {e["path"] for e in doc["files"]}:
        try:
            os.remove(f"{home}/.agentmesh/adapter/price.json")
        except FileNotFoundError:
            pass
    for e in doc["files"]:
        src = os.path.join(root, "home", e["path"])
        if os.path.exists(src):
            dst = os.path.join(home, e["path"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    for e in doc["outside"]:
        src = os.path.join(root, "outside", e["path"].lstrip("/"))
        if os.path.exists(src):
            shutil.copy2(src, e["path"])
    subprocess.run(["chown", "-R", f"{name}:{name}", home], capture_output=True)
    shutil.rmtree(root, ignore_errors=True)


def job_seconds_of(pkg):
    """The install file's job_seconds when it is a usable number, else None."""
    v = ((pkg or {}).get("install") or {}).get("job_seconds")
    return v if isinstance(v, int) and not isinstance(v, bool) and 60 <= v <= 7200 else None


# HOW MANY MESSAGES ONE AGENT MAY ANSWER AT ONCE, when the owner says.
#
# The fleet supervisor runs up to ten jobs for one agent at a time
# (runtime/fleet/supervisor.mjs JOBS_PER_AGENT), serialising only messages of
# the same thread. That is wrong for an agent whose jobs share state across
# threads: process-runner's jobs rewrite one run's state.json on the shared
# mount, and two of them at once gave "stale file handle" or lost a turn's
# events (2026-09-24). The supervisor already honours JOBS_AT_ONCE on the
# agent's attendant entry, through the roster; until now nothing a deploy
# wrote could put it there, so the only way to set it was a hand edit of a
# file this procedure rewrites on every inventory change.
#
# So it is the owner's word, recorded on the inventory row as `jobs_at_once`
# and written into the generated attendant entry as JOBS_AT_ONCE. It comes from
# the deploy or update instruction, or from `jobs-at-once <name> <n|default>`
# for an agent already installed, and an update that does not mention it keeps
# what the row has. It only LOWERS the supervisor's default: raising what one
# agent may spend at once is a different decision and nobody has asked for it.
JOBS_AT_ONCE_MOST = 10


def jobs_at_once_of(args):
    """The owner's jobs_at_once from an instruction: a whole number from 1 to
    JOBS_AT_ONCE_MOST, or None when the instruction leaves it out or says null.
    Anything else is refused, because a typo must not become a ceiling: nought
    would stop the agent dead and a word would silently mean the default."""
    v = (args or {}).get("jobs_at_once")
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= JOBS_AT_ONCE_MOST:
        fail("validate", f"jobs_at_once must be a whole number from 1 to {JOBS_AT_ONCE_MOST} "
                         f"(or null for the supervisor's default), and this instruction says {v!r}")
    return v


def apply_jobs_at_once(entry, args):
    """Put an update instruction's jobs_at_once on the inventory row. Absent
    keeps what the row has, because the owner set it for a reason the new
    version does not change; null takes it off, back to the default."""
    if "jobs_at_once" not in (args or {}):
        return entry.get("jobs_at_once")
    n = jobs_at_once_of(args)
    if n is None:
        entry.pop("jobs_at_once", None)
    else:
        entry["jobs_at_once"] = n
    return n


def machine_for(pkg):
    """How much machine one message gets, when the owner named none.

    Cloud Run's own default is 512Mi and one core. That is enough for a probe
    that answers one sentence and not enough for any real work, which is the
    worst shape a default can have: a job passes its smoke check, the agent
    looks deployed, and the first message that does something is killed with
    exit 137 and no explanation the sender can act on. Four agents were
    deployed that way and every one of them would have failed on its first
    real job (2026-09-11).

    A package that names a command for every job wakes nothing and usually
    needs little. A package that wakes a model runs a harness, usually a
    browser, and reads files, so it gets room. So does a package whose command
    drives a browser itself: the animation renderer names chromium, draws with
    three pages at once, and was killed for memory nine minutes into its first
    video at 1Gi (2026-09-23). The owner's own numbers always win; this only
    fills the silence."""
    install = (pkg or {}).get("install") or {}
    try:
        wakes = IMAGE.wakes_a_model(install)
    except Exception:  # noqa: BLE001
        wakes = True
    browser = any(isinstance(b, dict) and str(b.get("name", "")).lower() in BROWSERS
                  for b in install.get("binaries") or [])
    return ("4Gi", "2") if wakes or browser else ("1Gi", "1")


# The binary names that mean a package drives a browser of its own.
BROWSERS = {"chromium", "chrome", "google-chrome", "chromium-browser", "firefox"}


RUNS = f"{FLEET}/runs"


def run_spec_of(name, home, pkg):
    """The command the host runs for this package's job, with the four paths
    it can know at install already filled in (common-agent-spec 12.3).

    A host that has a command for a job runs it and never wakes a model to
    decide whether to. The rest of the placeholders belong to one message and
    are filled by the attendant.

    One command per package, for now. A message does not say which offering it
    is for, so a package naming a command on two jobs is refused rather than
    guessed at."""
    runs = ((pkg or {}).get("install") or {}).get("run") or {}
    if not isinstance(runs, dict) or not runs:
        return None
    if len(runs) > 1:
        fail("translate", f"{name}: the package names a command on more than one job "
                          f"({', '.join(sorted(runs))}); a message does not say which offering it is "
                          f"for, so the host cannot tell which to run")
    slug, spec = next(iter(runs.items()))
    pkg_name = pkg["manifest"]["name"]
    fixed = {"{home}": home, "{package}": pkg_name,
             "{records}": f"{home}/records", "{work}": f"{home}/work"}

    def fill(x):
        for k, v in fixed.items():
            x = x.replace(k, v)
        return x

    out = {"job": slug, "command": [fill(x) for x in spec["command"]],
           "reply": spec.get("reply", "stdout")}
    if spec.get("per_file"):
        out["per_file"] = [fill(x) for x in spec["per_file"]]
    if spec.get("message_file"):
        out["message_file"] = fill(spec["message_file"])
    if spec.get("escalate_when"):
        out["escalate_when"] = spec["escalate_when"]
    return out


def write_run_spec(name, home, pkg):
    """Place the command outside the agent's home, beside the brain, where the
    agent cannot rewrite what its own host will run. Returns the path, or None
    when the package names no command and removes any left by an older
    version."""
    spec = run_spec_of(name, home, pkg)
    path = f"{RUNS}/{name}.json"
    if not spec:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        return None
    os.makedirs(RUNS, exist_ok=True)
    write_text(path, json.dumps(spec, indent=2) + "\n", 0o644)
    return path


# ── what the agent charges (§19.1) ────────────────────────────────────────
#
# The agent's node reads one file, price.json in its adapter's state
# directory, and from it registers one SKU on its manifest and advertises the
# price on its storefront. Until now that file was placed BY HAND on the host
# after a deploy, which is the thing a package exists to stop: nothing said
# what an agent charged except the machine it was charging from, a rebuild
# lost it, and a reader of the inventory could not tell a free agent from one
# whose price somebody forgot to put back.
#
# So the package declares the amount, this side adds the two things a package
# is not allowed to know (who bills, and the address a buyer approves at), and
# the file is placed with everything else the install places.

# The fields each of the five price models names (§19.1). A field a model does
# not name is a shape error. Mirrored from the SDK, which is what actually
# validates this at daemon start: a price this misses is not quietly wrong, it
# stops the adapter from starting and the deploy's own smoke check reports it.
PRICE_FIELDS = {
    "free": {"model"},
    "flat": {"model", "currency", "amount_micro"},
    "per_unit": {"model", "currency", "meter", "per", "amount_micro", "included"},
    "package": {"model", "currency", "meter", "size", "amount_micro", "period", "included"},
    "tiered": {"model", "currency", "meter", "per", "period", "tiers", "included"},
}


def whole(v, least):
    return isinstance(v, int) and not isinstance(v, bool) and v >= least


def price_problem(sku):
    """What is wrong with a package's declared price, in words, or None when
    there is nothing wrong with it. Money is integer micro-units of a named
    currency and never a float (§19.3)."""
    if not isinstance(sku, dict):
        return "it is not an object"
    if not (isinstance(sku.get("sku"), str) and re.match(r"^[a-z0-9-]{1,64}$", sku["sku"])):
        return f"the sku id {sku.get('sku')!r} is not lowercase letters, digits and hyphens"
    covers = sku.get("covers")
    if not isinstance(covers, dict):
        return "it does not say what it covers"
    named = covers.get("offerings")
    if (covers.get("agent") is True) == isinstance(named, list):
        return "it covers the whole agent or a named list of offerings, and it has to be one or the other"
    if isinstance(named, list) and not (named and all(isinstance(o, str) and o for o in named)):
        return "the list of offerings it covers is empty or holds something that is not an offering id"
    p = sku.get("price")
    if not isinstance(p, dict):
        return "it carries no price"
    model = p.get("model")
    if model not in PRICE_FIELDS:
        return f"the price model {model!r} is not one of free, flat, per_unit, package, tiered"
    extra = [k for k in p if k not in PRICE_FIELDS[model]]
    if extra:
        return f"the {model} price carries {extra[0]!r}, which is not a field of that shape"
    if model == "free":
        return None
    if not (isinstance(p.get("currency"), str) and re.match(r"^[A-Z]{3}$", p["currency"])):
        return f"the currency {p.get('currency')!r} is not a three-letter code like USD"
    if model != "tiered" and not whole(p.get("amount_micro"), 0):
        return (f"the amount {p.get('amount_micro')!r} is not a whole number of micro-units; "
                f"no floating point goes near money, so $2.50 is written 2500000")
    if model == "flat":
        return None
    if not (isinstance(p.get("meter"), str) and p["meter"].strip()):
        return f"a {model} price has to name the meter it rates"
    if "per" in p and not whole(p["per"], 1):
        return "per is a whole number above zero"
    if "included" in p and not (isinstance(p["included"], dict)
                                and set(p["included"]) == {"quantity", "period"}
                                and whole(p["included"]["quantity"], 0)
                                and p["included"]["period"] in ("day", "month")):
        return "included is a whole quantity and a period of day or month, or an allowance that never resets"
    if model == "package" and not whole(p.get("size"), 1):
        return "a package price needs a whole size above zero"
    if model in ("package", "tiered") and p.get("period") not in ("day", "month"):
        return f"a {model} price needs a period of day or month to aggregate over"
    if model == "tiered":
        tiers = p.get("tiers")
        if not (isinstance(tiers, list) and tiers):
            return "a tiered price needs at least one tier"
        prev = 0
        for i, t in enumerate(tiers):
            if not (isinstance(t, dict) and whole(t.get("amount_micro"), 0)):
                return f"tier {i} needs a whole amount_micro of 0 or more"
            if i == len(tiers) - 1:
                if "up_to" in t:
                    return "the last tier is unbounded, so a buyer cannot run off the end of the price"
            elif not (whole(t.get("up_to"), 1) and t["up_to"] > prev):
                return f"tier {i} needs an up_to above the tier before it"
            else:
                prev = t["up_to"]
    return None


def price_of(name, pkg):
    """The SKU to place for this package, whole, or None when it declares no
    price. No price means no SKU means FREE, the default (§19.1), and that is
    what every package installed before this member meant.

    An absent price and a declared free price are different statements and
    both are kept: a storefront reader cannot tell an agent that decided to be
    free from one nobody has got round to pricing, so a package that says
    `{"model": "free"}` gets a file saying so.

    The provider is added HERE and never travels in a package: who bills for
    the work is this deployment's decision, and the address a buyer approves
    at would tie the package to one mesh."""
    sku = ((pkg or {}).get("install") or {}).get("price")
    if sku is None:
        return None
    problem = price_problem(sku)
    if problem:
        fail("price", f"{name}: the package declares a price this host will not place, because {problem}. "
                          f"A package with no price at all installs and is free; a malformed one is refused "
                          f"rather than placed, because the agent's node checks it again at start and would "
                          f"not come up.")
    return {"sku": sku["sku"], "covers": sku["covers"], "price": sku["price"],
            "provider": {"id": "internal", "checkout_url": CHECKOUT_URL}}


def write_price(name, home, pkg):
    """Place the declared price where the agent's own node reads it, and take
    away one a previous version left. Returns what was placed, for the deploy
    record, or None.

    Inside the home rather than beside the brain, unlike the run command: this
    is the agent's own declaration about its own work, served by the agent,
    and `agentmesh price set` on the host is how an operator changes it
    afterwards. It goes in the ledger with everything else placed, so a price
    changed by hand on a running agent shows up as drift rather than as
    nothing at all."""
    sku = price_of(name, pkg)
    path = f"{home}/.agentmesh/adapter/price.json"
    if not sku:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        return None
    write_text(path, json.dumps(sku, indent=2, ensure_ascii=False) + "\n", 0o600, owner=name)
    p = sku["price"]
    covers = "the whole agent" if sku["covers"].get("agent") else ", ".join(sku["covers"]["offerings"])
    return {"sku": sku["sku"], "model": p["model"], "covers": covers,
            **({"amount_micro": p["amount_micro"], "currency": p["currency"]} if "amount_micro" in p else {}),
            "checkout_url": CHECKOUT_URL}


def wants_replies_of(pkg):
    """True only when the install file says the agent reads replies to work it
    sent (a runner). Anything else, including a string, means no."""
    return ((pkg or {}).get("install") or {}).get("wants_replies") is True


def update(argfile):
    """The whole update in one act, as the executor has always run it. A
    batched landing runs the same halves in separate acts (see deploy)."""
    ctx = update_prepare(argfile)
    name, holder, entry = ctx["name"], ctx["holder"], ctx["entry"]
    home, pkg_name, pkg_version = ctx["home"], ctx["pkg_name"], ctx["pkg_version"]
    # The node lock, from before the new version is placed to the end of the
    # watch, so a refusal to wait places nothing (node_lock).
    acquire_node_lock(f"the update of {name}")
    update_place(ctx)

    # 9. Restart and check; a failed check restores the old version.
    #
    # Deleted and started, not restarted. pm2 keeps a running process's
    # environment across a restart even when the restart names a config file,
    # so a variable the new version needs never reaches it: 2026-09-10, a
    # package that gained a command had run_spec true in the inventory, the
    # command placed on disk, and an attendant running without RUN_SPEC, which
    # is silent and looks exactly like the feature not working. Deleting first
    # costs a few seconds of downtime and removes the whole class.
    #
    # BOTH are deleted and only what this host starts comes back. An update used
    # to name the attendant on the way in as well, which is how five of them
    # returned to a host whose work the supervisor had taken over; deleting the
    # name either way means an update also clears one an earlier install left.
    # Held (since before the new version was placed) to the end of the watch
    # and any rollback in it, so no removal runs while this node comes up.
    with node_lock(f"the update of {name}"):
        before = watch_mark(holder)
        for proc in (f"{name}-adapter", f"{name}-attendant"):
            subprocess.run(["pm2", "delete", proc], capture_output=True, text=True)
        processes = start_processes(name)
        smoke = check_served(name, processes, ask_model=not ctx["reinstall"])
        shutil.rmtree(ctx["staging"], ignore_errors=True)
        common = update_common(ctx, processes, smoke)
        if not smoke["passed"]:
            restore(name, home, ctx["old_ledger"], ctx["prev"], pkg_name)
            # The processes this host starts, and no other: restarting a name pm2
            # does not hold fails, and on a supervisor host the attendant is such a
            # name. The restore has to put back what was running, not what an older
            # copy of this procedure used to run. A reloaded agent is reloaded
            # again on the old files (serve_again).
            again = serve_again(name, processes)
            fail("check", f"the smoke check failed on {pkg_version}; {entry.get('version')} was restored from the snapshot",
                 state=f"restored to {entry.get('version')}; {again}", act="update", restored=True, **common)

        # The watch, as a deploy has it: two minutes of the node staying well with
        # the new version before anything says updated. Otherwise the old version
        # is put back exactly as a failed smoke check puts it back, and the node is
        # confirmed well again.
        def put_old_back():
            restore(name, home, ctx["old_ledger"], ctx["prev"], pkg_name)
            again = serve_again(name, processes)
            return (f"{entry.get('version')} was restored from the snapshot and restarted" if again == "processes restarted"
                    else f"{entry.get('version')} was restored from the snapshot and {again}")
        common["watch"] = watch_update(name, holder, before, put_old_back, pkg_version, common,
                                       restarts_allowed=restarts_allowed_of(processes))

    release_node_lock()  # the hold taken before capacity_check
    update_finish(ctx, common)


def update_prepare(argfile):
    """Steps 1 and 2 of an update: the instruction, the inventory row, the new
    version fetched and verified and checked against the running one. Nothing
    is placed and the node is not touched."""
    if not argfile.startswith(f"{DM_HOME}/tmp/"):
        fail("validate", "argfile outside the deploymgr tmp dir")
    args = json.load(open(argfile))
    name = args.get("name", "")
    url = args.get("package_url", "")
    expected_sha = args.get("sha256", "")
    stack_bindings = read_stack_bindings(args)
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    agents = load_list()
    entry = next((a for a in agents if a["name"] == name), None)
    if not entry:
        fail("validate", f"{name} is not in the deployment inventory")
    if entry.get("state", "running") != "running":
        fail("validate", f"{name} is {entry.get('state')}; remove it and deploy again rather than updating")
    # An agent whose WORK runs in a container gets a new version by being built
    # into a new IMAGE and a re-created job, and until 2026-09-14 this procedure
    # did neither: it refused, named the two commands, and left them to be run
    # by hand, which left the descriptor, the inventory and the AgentDoc naming
    # the old version while the job ran the new one. Now it composes them, the
    # way deploy does, after the host half below: one owner instruction, both
    # halves, one record. The row is read here so a failed container half can
    # put the host half back to the version the job is still running.
    in_container = next((e for e in load_json_list(CONTAINERS)
                         if e.get("name") == name and (e.get("state") or "running") == "running"), None)
    if not user_exists(name):
        fail("validate", f"user {name} does not exist; the inventory is stale")
    # An inventory entry written before the rename still says framework.
    harness = entry.get("harness") or entry.get("framework") or ""
    if harness not in HARNESS_CHOICES:
        fail("validate", f"{name} runs on {harness}, which this host cannot start")
    model = harness_model(args.get("model"), entry.get("model"), harness=harness)
    if not model:
        fail("validate", NO_MODEL)
    if not MODEL_RE.match(model):
        fail("validate", f"bad model {model!r}")
    # Refused here, before anything is fetched; applied with the other row
    # facts below.
    jobs_at_once_of(args)
    home = f"/home/{name}"
    old_ledger = read_ledger(name)
    if not old_ledger:
        fail("validate", f"{name} has no ledger; it was deployed before the ledger existed, so remove and deploy again")

    # 1 and 2. The new version, verified, and the host and instruction checked.
    staging, pkg_dir, sha256, pkg = fetch_and_verify(name, url, expected_sha)
    pkg_name, pkg_version = pkg["manifest"]["name"], pkg["manifest"].get("version", "unknown")
    if pkg_name != entry["package"]:
        fail("verify", f"the package is {pkg_name}; {name} runs {entry['package']}, and an update installs a new version of the same package")
    old_v, new_v = INSTALL.version_tuple(entry.get("version")), INSTALL.version_tuple(pkg_version)
    # THE SAME BYTES AGAIN is a reinstall, not a new version: the same version
    # AND the same digest the inventory holds. It places the package again and
    # watches the node, and it wakes no model and builds no image, because
    # those bytes already passed both. Anything else at the same version is
    # different bytes under an old number, and stays refused.
    reinstall = new_v is not None and new_v == old_v and bool(entry.get("sha256")) and sha256 == entry.get("sha256")
    if not reinstall and (old_v is None or new_v is None or new_v <= old_v):
        fail("version", f"the version must increase: {name} runs {entry.get('version')} and the package is {pkg_version}")
    # A version kept alongside (run configs phase 3) is retired before it can
    # become the current one: two jobs answering the same version would make
    # which one ran a question nobody could answer afterwards. An update
    # leaves every other version kept alongside exactly as it is.
    if in_container and any(a.get("version") == pkg_version for a in alongside_versions(in_container)):
        fail("version", f"{name} {pkg_version} is kept alongside {entry.get('version')}; retire it first "
                        f"(retire-version), then update")
    check_before_touching(args, pkg)
    # The node that holds this agent and the host, measured with the new
    # version on them (guard.mjs precheck). The agent is already on its node,
    # so the node usually does not grow.
    holder = holder_of(name, {"root": entry["node_root"], "proc": entry.get("node_proc") or NODE_PROC,
                              "user": entry.get("node_user") or NODE_USER}
                       if entry.get("node_root") else None)
    return {"act": "update", "args": args, "name": name, "url": url, "stack_bindings": stack_bindings,
            "entry": entry, "in_container": in_container, "harness": harness, "model": model, "home": home,
            "old_ledger": old_ledger, "staging": staging, "pkg_dir": pkg_dir, "sha256": sha256, "pkg": pkg,
            "pkg_name": pkg_name, "pkg_version": pkg_version, "reinstall": reinstall, "holder": holder}


def update_place(ctx, also_adding=0):
    """Steps 2 (capacity) to 8 of an update, under the node lock the caller
    holds: the old version snapshotted, the new one placed over it, the same
    subject re-bound. Restarts nothing."""
    args, name, entry, home = ctx["args"], ctx["name"], ctx["entry"], ctx["home"]
    pkg, pkg_dir, pkg_name, pkg_version = ctx["pkg"], ctx["pkg_dir"], ctx["pkg_name"], ctx["pkg_version"]
    harness, model, sha256 = ctx["harness"], ctx["model"], ctx["sha256"]
    capacity = capacity_check(name, pkg_dir, ctx["holder"], update=True, also_adding=also_adding)
    bindings = INSTALL.plan_bindings(args, pkg, home)
    names = INSTALL.placed_names(bindings)

    # What changed under the old version before this update touched it.
    drift_before = ledger_drift(name) or []

    # The old version, kept until the check passes.
    prev = snapshot(name, home, ctx["old_ledger"])
    old_desc = entry.get("descriptor") or {}

    # 3 through 7 against the new version.
    shutil.rmtree(f"{home}/{pkg_name}", ignore_errors=True)
    shutil.copytree(pkg_dir, f"{home}/{pkg_name}")
    directories = [d["name"] for d in (pkg["install"] or {}).get("directories", []) or []
                   if isinstance(d, dict) and d.get("name")] or ["records", "work"]
    for d in directories:
        os.makedirs(f"{home}/{d}", exist_ok=True)
    for b in bindings:
        if b["kind"] == "directory":
            os.makedirs(b["path"], exist_ok=True)
    run(["chown", "-R", f"{name}:{name}", home], "chown")
    dependencies = install_dependencies(name, home, pkg_name, pkg)
    env_files = place_environment(name, home, bindings, pkg)
    placed, links = translate_for_harness(name, home, pkg_dir, pkg_name, pkg, harness, model, bindings)
    # The model key the brain reads, placed again because an update may name a
    # model from another provider. Without this the brain read a key file that
    # was never written, the harness answered nothing, and the smoke check
    # failed on a package that was sound.
    place_model_key(name, home, harness, model)
    write_brain(name, harness, model)
    run_spec_path = write_run_spec(name, home, pkg)
    run(["chown", "-R", f"{name}:{name}", home], "chown")

    # 8. The same subject, re-bound to the new draft.
    ident = json.load(open(f"{home}/.agentmesh/adapter/identity.json"))
    # A row with no handle (one written before its name was bound) takes the
    # name the naming service answers for the key, so the bound Descriptor,
    # the deployment record and the conformance check after this update all
    # name the agent. No answer leaves it as it was.
    if not entry.get("handle"):
        named = naming_handle(ident["public_key"])
        if named:
            entry["handle"] = named
            entry["handle_changed_at"] = now_iso()
    descriptor = bind_descriptor(home, pkg_name, name, ident["public_key"], entry.get("handle"),
                                 pkg_version, entry["interaction"], harness, model, sha256=sha256)

    # This version's price, or none: a version that drops its price makes the
    # agent free again, and leaving the old file would have it go on charging
    # for a version that no longer asks. An operator who set a price by hand
    # on the running agent loses it here, which is the same trade every other
    # placed file makes, and the deploy record says what was placed.
    price = write_price(name, home, pkg)
    # A version that adds a trial gets the trial ceiling it suggests; one the
    # owner set is kept, and nothing is ever taken out of the allowance.
    trial_allowance = write_trial_allowance(name, home, pkg)

    # The new package's word on how long a job may take, for the attendant.
    job_seconds = job_seconds_of(pkg)
    if job_seconds:
        entry["job_seconds"] = job_seconds
    else:
        entry.pop("job_seconds", None)
    if wants_replies_of(pkg):
        entry["wants_replies"] = True
    else:
        entry.pop("wants_replies", None)
    # The command this version names, or none: a version that drops its command
    # must stop the attendant running the one the version before it named.
    if run_spec_path:
        entry["run_spec"] = True
    else:
        entry.pop("run_spec", None)
    # The owner's ceiling on jobs in flight, kept unless the instruction says.
    apply_jobs_at_once(entry, args)

    # Reach from outside the mesh, kept as it was unless the instruction says.
    if "a2a" in args:
        if not isinstance(args["a2a"], bool):
            fail("validate", "a2a must be true or false")
        # As whoever holds the agent's state: the node's user against the
        # agent's folder on the node, or the agent's own user against its home.
        # The home is a symlink into the node after the move and the agent's
        # user cannot read through it, so the old form failed there.
        if entry.get("node_root"):
            as_user(entry.get("node_user") or NODE_USER,
                    f"env MESH_ADAPTER_STATE={entry['node_root']}/agents/{name} "
                    f"/usr/bin/mesh-adapter contacts default a2a {'allow' if args['a2a'] else 'block'}", "expose", 60)
        else:
            as_user(name, f"env MESH_CREDS_FILE={home}/.config/fleet/mesh.creds "
                          f"/usr/bin/mesh-adapter contacts default a2a {'allow' if args['a2a'] else 'block'}", "expose", 60)
        entry["exposed_a2a"] = args["a2a"]
    ctx.update(capacity=capacity, names=names, drift_before=drift_before, prev=prev, old_desc=old_desc,
               dependencies=dependencies, env_files=env_files, placed=placed, links=links,
               agent_key=ident["public_key"], descriptor=descriptor, price=price, trial_allowance=trial_allowance)
    return ctx


def update_common(ctx, processes, smoke):
    """The members every answer of an update carries from step 9 on, success
    or refusal alike."""
    entry, names = ctx["entry"], ctx["names"]
    price, trial_allowance, stack_bindings = ctx["price"], ctx["trial_allowance"], ctx["stack_bindings"]
    return {"name": ctx["name"], "package": ctx["pkg_name"], "harness": ctx["harness"], "egress": dict(EGRESS_OPEN),
            "agent_key": ctx["agent_key"], "handle": entry.get("handle"),
            "previous": {"version": entry.get("version"), "sha256": entry.get("sha256"),
                         "descriptor": ctx["old_desc"]},
            "version": ctx["pkg_version"], "sha256": ctx["sha256"], "url": ctx["url"],
            "exposed_a2a": entry.get("exposed_a2a", False),
            **({"price": price} if price else {}),
            **({"trial_allowance": trial_allowance} if trial_allowance else {}),
            "descriptor": ctx["descriptor"], "credentials_placed": names["credentials"],
            "settings_placed": names["settings"], "ceilings": names["ceilings"],
            # What the account's stack bound for this version, per system.
            **({"bindings": stack_bindings} if stack_bindings else {}),
            "dependencies": ctx["dependencies"], "drift_before": ctx["drift_before"],
            "processes": processes, "smoke": smoke, "capacity": ctx["capacity"],
            **({"reinstall": True} if ctx["reinstall"] else {})}


def update_finish(ctx, common):
    """After the node was watched with the new version: the ledger, the
    inventory row, the container half where the work runs in a job, and the
    answer."""
    args, name, entry, home = ctx["args"], ctx["name"], ctx["entry"], ctx["home"]
    pkg_name, pkg_version, names = ctx["pkg_name"], ctx["pkg_version"], ctx["names"]
    harness, model, price = ctx["harness"], ctx["model"], ctx["price"]
    in_container, reinstall, prev = ctx["in_container"], ctx["reinstall"], ctx["prev"]
    processes = common["processes"]
    ledger = write_ledger(name, home, [pkg_name, *ctx["placed"], *ctx["env_files"], ".agentmesh/adapter/descriptor.json",
                                       *([".agentmesh/adapter/price.json"] if price else [])],
                          withhold={".config/fleet/env"})
    before = {k: entry.get(k) for k in ("version", "sha256", "url", "model", "credentials_placed", "settings_placed",
                                        "ceilings", "dependencies", "descriptor", "ledger", "skills_linked",
                                        "updated_at", "state", "price", "jobs_at_once")}
    entry.update({"version": pkg_version, "sha256": ctx["sha256"], "url": ctx["url"], "model": model,
                  "credentials_placed": names["credentials"], "settings_placed": names["settings"],
                  "ceilings": names["ceilings"], "dependencies": ctx["dependencies"],
                  "descriptor": ctx["descriptor"], "ledger": ledger, "skills_linked": ctx["links"],
                  "updated_at": now_iso(), "state": "running"})
    if price:
        entry["price"] = price
    else:
        entry.pop("price", None)
    # Read fresh under the lock rather than from the list read at the start:
    # with installs running side by side another act may have written a row
    # since then.
    replace_row(entry)

    # 10. Where the work runs. An agent whose work runs in Cloud Run gets its
    # new version as a new image and a re-created job, composed here the way
    # deploy composes them, so one instruction moves both halves. The host half
    # above is already on the new version. A container half that fails leaves
    # the job exactly as it was, because a build that will not build starts
    # nothing and a job update that fails changes nothing; so the host half is
    # put back to the version the job still runs, and the record says so,
    # rather than a host that says 0.2.0 over a job that runs 0.1.0.
    work = None
    # A reinstall placed the same bytes, so the image the job runs is already
    # built from them and is not built again. But an instruction that names
    # settings or credentials is applied: re-filing a version to change its
    # model (a proposed MODEL_NAME, Common Agent 12.4.1) is a reinstall, and
    # skipping the job left pitch-writer 2.13.0 on the environment's default
    # model on 2026-10-30. The job is then re-placed from the image it runs.
    reapply = reinstall_reapplies(reinstall, in_container, args)
    if in_container and (not reinstall or reapply):
        def put_back(step):
            restore(name, home, ctx["old_ledger"], prev, pkg_name)
            busy = ""
            try:
                with node_lock(f"putting {name}'s host half back", soft=True):
                    serve_again(name, processes)
            except NodeLockBusy as e:
                busy = f"; its processes were NOT restarted: {e}"
            for k, v in before.items():
                if v is None:
                    entry.pop(k, None)
                else:
                    entry[k] = v
            replace_row(entry)
            return (f"the container half failed at {step}; the host half was put back to {before.get('version')}, "
                    f"which is the version job {in_container.get('job')} still runs{busy}")
        CURRENT["on_fail"] = put_back
        if reapply:
            image_now = image_the_job_runs(in_container)
            work = container_step({**container_args_for_update(args, in_container, entry, harness, model), "image": image_now},
                                  count_against_ceiling=False)
        else:
            work = place_in_cloud_run(container_args_for_update(args, in_container, entry, harness, model))
        CURRENT["on_fail"] = None
    shutil.rmtree(prev, ignore_errors=True)
    # The runtime record names the package version, so an update that did not
    # re-state it would leave the owner's page naming the version before this
    # one. The helper reads where the work runs off the inventories rather
    # than assuming it, and the container half above has just rewritten the
    # container row when there is one.
    runtime = publish_runtime_for(name)
    out({"ok": True, "act": "update", "ledger": ledger, "restored": False, "runtime": runtime,
         # The model the agent runs with as placed (technical debt 456).
         **model_placed_of(work, model, in_container),
         **({"work": work} if work else {}), **common})


def reinstall_reapplies(reinstall, row, args):
    """Whether a reinstall of an agent whose work is in a job re-places the job:
    only when the instruction names settings or credentials to apply."""
    return bool(reinstall and row and (args.get("settings") or args.get("credentials")))


def image_the_job_runs(row):
    """The image a container row's job runs, by digest."""
    image = str(row.get("image") or "")
    digest = str(row.get("image_digest") or "")
    if "@" in image or not digest:
        return image
    return IMAGE.pinned(image, digest)


def container_args_for_update(args, row, entry, harness, model):
    """The argfile the container half reads, for an update. The owner's
    instruction carries what it carries (credentials by system, settings, the
    ceilings, admit, a2a); what it leaves out is read off the container row the
    deploy wrote and the inventory entry, never guessed: the registry the image
    was pushed to, the bucket, the region, the project, the interaction, the
    environment, the harness and the model. A hand-written argfile that names
    only the package is enough, because everything else is on this host."""
    filled = dict(args)
    image = str(row.get("image") or "")
    registry = image.split("@")[0].rsplit("/", 1)[0] if "/" in image else ""
    for k, v in (("registry", registry), ("bucket", row.get("bucket")), ("region", row.get("region")),
                 ("project", row.get("project")), ("interaction", row.get("interaction") or entry.get("interaction")),
                 ("environment", row.get("environment")), ("harness", harness), ("model", model)):
        if not filled.get(k) and v:
            filled[k] = v
    for k, v in placement_from_host().items():
        filled.setdefault(k, v)
    return filled


PLACEMENT_FILE = f"{FLEET}/deploymgr-placement.json"


def placement_from_host():
    """The four addresses the operator wrote down for this host: where images
    are published, which storage a job mounts, the project and the region. Read
    the same way the executor reads them, and only those four, so the file is
    not a way to smuggle anything else into an instruction."""
    try:
        with open(PLACEMENT_FILE, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(doc, dict):
        return {}
    return {k: str(doc[k]) for k in ("registry", "bucket", "project", "region")
            if isinstance(doc.get(k), str) and doc[k]}


# ── the image, and the container that runs it (12.7.1) ────────────────────
#
# The install above puts files on a host this procedure reaches, starts two
# processes there, and answers "what is deployed" by rehashing what it placed.
# An owner may instead run the agent on compute the installer never touches.
# The procedure does not become optional then. It SPLITS, and each side records
# the half it performed and records no part of the other:
#
#   image <argfile>      everything that happens before a running machine is
#                        involved: fetch and verify; satisfy each runtime and
#                        binary by putting it IN rather than probing for it;
#                        install the dependencies from each lockfile; make the
#                        home and the declared directories; translate for the
#                        harness. What those steps produce is an image, and this
#                        records its digest in a BUILD record. Nothing has
#                        started, nothing has an address and nobody has been
#                        given a key, so it produces no deployment record.
#   container <argfile>  the side that starts the agent: place the binding the
#                        owner's instruction decided, create the job with that
#                        image and the mount, run one message through it, and
#                        produce the ONE deployment record, naming the digest of
#                        the image it started.
#
# Neither needs root, and that is not a convenience. An installer that places no
# file on this host needs none of the powers placing one needs, so the sudoers
# line stays scoped to the four procedures that do.

def read_args(argfile):
    """The argfile must be the brain's own: under its home, written by it."""
    own = os.path.join(DM_HOME, "tmp").replace("\\", "/").rstrip("/") + "/"
    if not argfile.replace("\\", "/").startswith(own):
        fail("validate", "argfile outside the deploymgr tmp dir")
    return json.load(open(argfile, encoding="utf-8"))


def emitter():
    """Where emit-image.mjs is: installed beside this file on a host, or beside
    the deployment manager in the source tree. There is no second copy of that
    logic here on purpose, because a Dockerfile written in two places drifts and
    only one of the two ends up in the record."""
    for p in (os.environ.get("DM_EMIT_IMAGE"),
              os.path.join(_here, "deploymgr-emit-image.mjs"),
              os.path.join(_here, "..", "image", "emit-image.mjs")):
        if p and os.path.exists(p):
            return os.path.abspath(p)
    return None


def composite_emitter():
    """Where emit-composite.mjs is. It imports emit-image.mjs and ships
    composite.mjs and one-message.mjs into the image, so it is looked for in
    the image directory with those three beside it, never alone."""
    for p in (os.environ.get("DM_EMIT_COMPOSITE"),
              os.path.join(_here, "image", "emit-composite.mjs"),
              os.path.join(_here, "..", "image", "emit-composite.mjs")):
        if p and os.path.exists(p):
            return os.path.abspath(p)
    return None


def composite_plan(name, runner_dir, composite):
    """Fetch and verify every member package of a single-container edition
    and write the plan emit-composite.mjs reads. Returns the plan's path.

    `composite` is the instruction's: {"solution", "owner", "members": [{"name",
    "package_url", "sha256"?, "owner"}]}. Each member's install name is the
    name its own deploy used, which is what its folders on the mount and its
    job are named after. Whose each member is comes from the instruction and
    the emitter checks it; nothing here decides it."""
    members = composite.get("members") or []
    if not members:
        fail("validate", "a single-container edition names no member agents")
    if not composite.get("owner"):
        fail("validate", "a single-container edition names no owner, so nothing can say whose agents may share it")
    plan = {"solution": composite.get("solution"), "name": name, "owner": composite["owner"],
            "runner": {"dir": runner_dir}, "members": []}
    for m in members:
        if not NAME_RE.match(m.get("name", "")):
            fail("validate", f"bad member name {m.get('name')!r}")
        _, member_dir, _, _ = fetch_and_verify(f"{name}-m-{m['name']}", m.get("package_url", ""), m.get("sha256", ""))
        plan["members"].append({"dir": member_dir, "name": m["name"], "owner": m.get("owner")})
    path = os.path.join(STAGING, f"dm-{name}-composite-plan.json")
    write_text(path, json.dumps(plan, indent=2) + "\n", 0o600)
    return path


def composite_member_variables(composite, region, project):
    """What each member's own job carries now, read off Cloud Run, with its
    handle and key from this host's inventory, for the edition's job
    (image.composite_job_variables). A member with no job here is refused:
    an edition cannot give a member keys its own deploy never placed."""
    out, seconds = {}, []
    rows = {r.get("name"): r for r in load_json_list(CONTAINERS)}
    for m in composite.get("members") or []:
        where = {"job": IMAGE.job_name(m["name"]), "region": region, "project": project}
        if not job_exists(where):
            fail("composite", f"{m['name']} has no job here, so there is nothing to carry into the edition; deploy it first")
        current = IMAGE.job_variables(gcloud(IMAGE.describe_job_variables_argv(where), "composite", 180))
        who = agent_identity(m["name"]) or {}
        out[m["name"]] = {**current, "handle": who.get("handle"), "agent_id": who.get("key")}
        seconds.append((rows.get(m["name"]) or {}).get("job_seconds"))
    return IMAGE.composite_job_variables(out), seconds


def load_json_list(path):
    try:
        return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
    except Exception:  # noqa: BLE001
        return []


def save_json_list(path, rows):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with inventory_lock():
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
        os.replace(path + ".tmp", path)


# -- the one place this deployer starts gcloud -----------------------------
#
# EVERY gcloud call goes through here, and that is the whole of how an agent
# can be run inside a CUSTOMER's own project safely. An instruction may carry a
# grant (cloud.py): a project of theirs and a service account of theirs they
# have let this deployer impersonate. When it does, every call made for that
# instruction runs under that account, and when it does not, every call is the
# call this file made before any of this existed -- our project, our
# credentials, no flag.
#
# THERE ARE TWO DOORS AND THERE IS NO THIRD. gcloud() for the calls whose
# failure stops the act, gcloud_quiet() for the calls whose failure is part of
# the answer. Both build the argument vector the same way, so neither can miss
# the impersonation. Four call sites used to start gcloud directly -- the
# mount read, the build submit and follow, the probe execution, the job
# existence check and both halves of a removal -- and a call that skips this
# seam runs as US inside THEIR project, which is the exact failure this route
# exists to prevent. test_steps.py reads this file and refuses a third door.


def cloud_now():
    """The customer's project this act is acting inside, or None on our own."""
    return CURRENT.get("cloud") or None


def enter_cloud(args, act=None):
    """Read the customer's grant off this instruction, refuse a mixed-up one
    before anything is called, and make it the context every gcloud call in
    this act runs under. Returns the project id every call must name.

    THE GUARD IS THE FIRST THING AND IT COSTS NOTHING. A service account
    belongs to exactly one project and says which in its own address, so a
    pairing that disagrees is caught here, with no call to anybody, every
    time. One deployer service account holds grants from many customers, so
    the way a bug in any of this shows up is acting in one customer's project
    with another customer's account, and a project and an account that
    disagree is the shape that bug takes.

    SET ONCE, AT THE TOP. The alternative is a grant handed down as an
    argument through every procedure, and the failure that design has is a
    call site that forgets one; that call then runs as us inside their
    project. Set here, every call in the act is under their account or none of
    them are, and the promise is checkable by reading one file instead of
    auditing eight call sites.

    The action list carries over when the same grant is entered twice, because
    one owner instruction can run through two procedures -- a placed deploy
    builds an image and then creates a job -- and the list we owe the customer
    is of everything that instruction did in their project, not of whatever
    the last procedure did.
    """
    grant = args.get("cloud") or None
    prior = cloud_now()
    # Cleared FIRST, so a refusal about this instruction cannot report the
    # project of whatever ran before it. One process runs one act, so on a host
    # there is never a prior; the place there is one is a test file, which is
    # exactly where a customer's project would get into a refusal about someone
    # else's and nobody would notice.
    CURRENT["cloud"] = None
    if grant is None:
        return args.get("project") or PROJECT
    if CLOUD is None:
        fail("cloud", "this instruction asks this deployer to act inside a customer's own cloud project, and "
                      "deploymgr-cloud.py is not beside this file. That file holds the guard that refuses a "
                      "service account and a project that disagree, so without it nothing may be called in "
                      "anybody's project. Copy cloud.py to /opt/fleet/deploymgr-cloud.py.")
    # OUR side of the arrangement, checked in the same breath as theirs: a host
    # that does not know which account customers granted to would impersonate
    # from its own machine identity, which is the default compute account and is
    # not something any customer has agreed to. Refused here rather than left to
    # fail at the first call, where it would read as a revocation.
    ours = CLOUD.deployer_refusal(DEPLOYER_SA)
    if ours:
        fail("cloud", ours)
    bad = CLOUD.refusal(grant, args.get("project"))
    if bad:
        fail("cloud", bad)
    CURRENT["cloud"] = {"grant": grant, "act": act, "agent": args.get("name"), "deployer": DEPLOYER_SA,
                        "actions": prior["actions"] if prior and prior["grant"] == grant else []}
    # THEIR project and not the instruction's, which refusal() has just made
    # sure is either the same id or absent. Read off the grant so there is one
    # answer to "which project", in the same object as the account it pairs
    # with, rather than two members that could come apart later.
    return grant["project"]


def cloud_report(action=None):
    """The `cloud` member of whatever this act prints: which project we acted
    in, under which account, what the last call meant, whether sending the
    instruction again could work, and every call we made there.

    EMPTY ON OUR OWN MACHINES, so an act that named no customer prints exactly
    what it printed before any of this existed.

    `state` is the grant record's own word (pending, verified, revoked,
    unreachable) and is ABSENT where this act observed nothing about the
    grant, because the platform half keeps that record and a word written into
    it on no observation is worse than a word missing from it.
    """
    ctx = cloud_now()
    if not ctx:
        return {}
    grant, outcome = ctx["grant"], (action or {}).get("outcome", "ok")
    state = CLOUD.state_of(outcome)
    return {"cloud": {
        "provider": grant["provider"], "project": grant["project"],
        "service_account": grant["impersonate"],
        "outcome": outcome,
        **({"state": state} if state else {}),
        "retryable": CLOUD.retryable(outcome),
        **({"last_error": action["error"]} if action and action.get("error") else {}),
        "actions": list(ctx["actions"]),
    }}


def append_cloud_action(action):
    """One line per call, appended, in the file this host keeps for the
    customer.

    APPENDED AND NEVER REWRITTEN. Every other list this procedure keeps is a
    JSON array written whole, which is right for an inventory and wrong for a
    log: a whole-file write loses every line the writer did not know about,
    and being complete is the only thing this file is for. One line, one call,
    opened and closed each time, so a procedure killed mid-deploy still leaves
    behind the calls it had already made.

    Nothing here can fail an act. Our own bookkeeping becoming the customer's
    outage would be a worse trade than a line missing from a log that their
    audit log also holds.
    """
    try:
        os.makedirs(os.path.dirname(CLOUD_LOG), exist_ok=True)
        with open(CLOUD_LOG, "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(action, sort_keys=True) + "\n")
    except OSError:
        pass


def gcloud_argv(argv):
    """The argument vector this deployer actually runs. With no grant it is
    [gcloud, *argv] and nothing else -- byte for byte the call made before any
    of this existed, which is a promise test_steps.py keeps.

    The deployer account comes off the CONTEXT and not off the module, because
    the context is set by enter_cloud and enter_cloud is where it was checked.
    Reading it here instead would be a second reader of the same variable with
    no guard behind it.
    """
    ctx = cloud_now()
    return [GCLOUD, *CLOUD.flag(ctx["grant"] if ctx else None, ctx["deployer"] if ctx else None), *argv]


def _gcloud_call(argv, timeout, input_text=None):
    """Start gcloud, read what happened, and write the customer's log line
    where the call was made inside their project. Returns the finished
    process, that log line (None on our own project), and whether it timed out.

    The input goes down a pipe and is never logged: the one call that carries
    any is the one putting the owner's model key into their Secret Manager.
    """
    ctx = cloud_now()
    cmd = gcloud_argv(argv)
    at, t0, timed_out = now_iso(), time.time(), False
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input_text)
    except subprocess.TimeoutExpired:
        # Shaped as a finished process so both doors read one thing. The words
        # are the ones run() has always used for a timeout, because gcloud()
        # still refuses with them and a message that changed would be a
        # behaviour change on the path where no customer is involved.
        timed_out = True
        p = subprocess.CompletedProcess(cmd, 124, "", f"timed out after {timeout}s: {' '.join(cmd[:4])}")
    if not ctx:
        return p, None, timed_out
    outcome = CLOUD.outcome_of(ctx["grant"], p.returncode, p.stderr or p.stdout or "", timed_out)
    action = CLOUD.action(ctx["grant"], argv, outcome, at, time.time() - t0,
                          error=p.stderr or p.stdout or "", act=ctx.get("act"), agent=ctx.get("agent"))
    ctx["actions"].append(action)
    append_cloud_action(action)
    return p, action, timed_out


def gcloud(argv, step, timeout=600, input_text=None):
    """A call whose failure stops the act, refused with what it means.

    In our own project that is what gcloud said and nothing added. In a
    customer's it is what the failure MEANT first -- a revocation, an outage,
    or their own project refusing us a role -- and then what gcloud said,
    because a revocation and a 503 are the same exit code and the same red
    text, and the difference between them is whether anybody should try again.
    """
    p, action, timed_out = _gcloud_call(argv, timeout, input_text)
    if timed_out:
        fail(step, cloud_reason(action, p.stderr), **cloud_report(action))
    if p.returncode != 0:
        fail(step, cloud_reason(action, (p.stderr or p.stdout or "nonzero exit").strip()[:400]),
             **cloud_report(action))
    return p.stdout


def gcloud_quiet(argv, timeout=600):
    """The same seam, for the calls whose failure is an ANSWER and not a stop:
    reading a file the container may never have written, asking whether a job
    exists, deleting one that may already be gone.

    Returns the finished process AND the customer's log line, so a caller
    reporting a failure in their project can say whether they took the binding
    away rather than filing a revocation as an error.
    """
    p, action, _ = _gcloud_call(argv, timeout)
    return p, action


def cloud_reason(action, why):
    """A failed call said in a way that tells a revocation from an outage. On
    our own project, untouched."""
    ctx = cloud_now()
    if not (ctx and action):
        return why
    return f"{CLOUD.explain(action['outcome'], ctx['grant'])} gcloud said: {why}"


def gcs_read(uri, timeout=120):
    """What the container left on the mount, read back. A file that is not
    there comes back as None rather than as an empty answer: the check has to
    tell "it wrote nothing" from "it never got that far"."""
    p, _ = gcloud_quiet(["storage", "cat", uri], timeout)
    return p.stdout if p.returncode == 0 else None


def place_secrets_in_their_project(names, project, step="secret"):
    """The secrets the job will reference, put in the CUSTOMER's Secret
    Manager under the account they granted. Does nothing at all on our own
    project, where every one of these was placed by hand long ago and where a
    deploy creating secrets would be this procedure taking over a job the
    operator has always done.

    IN, NEVER OUT. The value goes from the owner's credential store on this
    host, down a pipe, into their project, and is never read back: nothing
    here calls `secrets versions access`, and the value is not in the result,
    not in the deployment record, not in the action log and not in any support
    tooling. What we keep is the NAME, which is the same thing the job carries
    and the same name the owner's store uses, so a credential has one name and
    not two to keep in step.

    CREATED ONLY WHERE IT IS MISSING, AND ALWAYS A NEW VERSION. The reference
    the job carries is `:latest` (image.secrets_flag), so a rotation is a
    version rather than five redeploys, and a deploy that deleted and recreated
    the secret would break every other job in their project already pointing at
    it.

    READABLE ON THE ONE SECRET AND NOWHERE ELSE. The container has to read the
    key at start, so something must let it. The cheap way is for the customer to
    grant `roles/secretmanager.secretAccessor` on their PROJECT, and that reaches
    every secret they have, including the ones they made years ago for something
    else. So the binding is written here instead, on the secret this call just
    placed, naming the account the container runs as. It is the difference
    between "we can read the key we gave you" and "we can read your secrets",
    and it is the only reason the published page can say the second sentence is
    false.
    """
    if not cloud_now():
        return []
    # Whoever the container runs as: the account they granted, or the second
    # account where the customer took the two-account split the permissions page
    # offers. Read from the grant rather than passed in, because the grant is the
    # one place that pairing is checked.
    reader = CLOUD.runs_as(cloud_now()["grant"])
    placed = []
    for name in names:
        if not store_has(name):
            fail(step, f"no credential named {name} in the store; place it there and name it")
        # Asked, not assumed. `secrets create` on one that exists is an error,
        # and an error here would refuse a second deploy of the same agent.
        p, _ = gcloud_quiet(IMAGE.secret_describe_argv(name, project), 120)
        if p.returncode != 0:
            gcloud(IMAGE.secret_create_argv(name, project), step, 300)
        gcloud(IMAGE.secret_version_argv(name, project), step, 300, input_text=store_read(name))
        gcloud(IMAGE.secret_accessor_argv(name, reader, project), step, 300)
        placed.append(name)
    return placed


def build_image(argfile):
    out(image_step(read_args(argfile)))


def image_step(args, alongside=False):
    """The build, from an instruction already read. It RETURNS its record
    rather than printing it, so the deploy that places an agent's work can run
    this half and then the next one inside a single act and print one result.
    Nothing else about it changes: every refusal below is still a fail(), which
    still stops the whole run at the step it names.

    `alongside` is set by the act that builds a version to keep beside the
    current one: the images list then keeps the current version's entry and
    replaces only an entry of the same version."""
    name = args.get("name", "")
    url = args.get("package_url", "")
    expected_sha = args.get("sha256", "")
    registry = args.get("registry") or REGISTRY
    # Whose project this build runs in, and under whose account. With no grant
    # it is the line it always was, the instruction's project or this host's.
    # With one it is the CUSTOMER's, every call below is made under the service
    # account they granted, and a grant naming a project its service account
    # does not belong to is refused here, before the package is even fetched.
    project = enter_cloud(args, "build")
    base = args.get("base") or ""

    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if not registry:
        fail("validate", "registry must say where the image is published; put it in the argfile or in DM_REGISTRY")
    if not IMAGE.REGISTRY_RE.match(registry):
        fail("validate", f"bad registry {registry!r}")
    if project and not IMAGE.PROJECT_RE.match(project):
        fail("validate", f"bad project {project!r}")
    if base and not (IMAGE.DIGEST_REF_RE.match(base) or IMAGE.TAG_REF_RE.match(base)):
        fail("validate", f"bad base image {base!r}")
    emit = emitter()
    if emit is None:
        fail("emit", "emit-image.mjs is not beside this file, and a package cannot be turned into an image without it")

    # 1. Fetch and verify, the same step and the same refusals as a host install.
    staging, pkg_dir, sha256, pkg = fetch_and_verify(name, url, expected_sha)
    pkg_name = pkg["manifest"]["name"]
    pkg_version = pkg["manifest"].get("version", "unknown")

    # 2. NOT check_host, and that is the whole point of the split. The runtimes
    # and binaries the install file names have to be on the machine that
    # answers, and this is not that machine: 12.7.1 has the installer satisfy
    # each one by putting it IN rather than probing for it. The emitted
    # Dockerfile checks every one inside the image and stops the build naming it
    # and what it is for, which is the honest equivalent of the escalation a
    # host install makes to a person. Nothing is substituted either way.
    ctx = os.path.join(STAGING, f"dm-{name}-ctx")
    shutil.rmtree(ctx, ignore_errors=True)
    composite = args.get("composite")
    if composite:
        # A SINGLE-CONTAINER EDITION of a solution: this package is its process
        # runner, and every member agent's package goes into the same image at
        # the version the solution runs. Each member is fetched and verified
        # exactly as its own image's build fetches it, and the emitter refuses
        # members of another owner that are not marked combinable.
        cmd = ["node", composite_emitter() or fail("emit", "emit-composite.mjs is not beside this file, so no edition can be built"),
               "--plan", composite_plan(name, pkg_dir, composite), "--out", ctx, "--force"]
    else:
        cmd = ["node", emit, "--package", pkg_dir, "--out", ctx, "--force"]
    if base:
        cmd += ["--base", base]
    if os.environ.get("DM_IMAGE_BASES"):
        cmd += ["--bases", os.environ["DM_IMAGE_BASES"]]
    emitted = json.loads(run(cmd, "emit", 300) or "{}")

    # 3. Each file's digest AS BUILT, taken before the build, from the bytes the
    # build is handed (12.7.1). It covers what the installer placed: the package
    # verbatim, the entrypoint, the lockfile checker and the job's command. The
    # dependency trees npm resolves during the build do not exist yet and are
    # covered by the lockfile digests the install file already names.
    files_as_built = INSTALL.ledger(ctx, IMAGE.build_context_files(ctx))
    # Read off the package while it is still on disk. The staging directory goes
    # at the end of this procedure, and a shape counted after it goes is a shape
    # of nothing that still looks like an answer.
    shape = IMAGE.build_shape(pkg, pkg_dir)

    image = IMAGE.image_reference(registry, pkg_name, pkg_version)
    # Submitted and then FOLLOWED, not waited on. A synchronous submit streams
    # the build log and prints no resource, and the digest of what was built is
    # in the resource; following also means a failed build is reported with its
    # own id, which is the only handle anyone has on its log.
    where = ["--project", project] if project else []
    submitted = json.loads(gcloud(["builds", "submit", ctx, "--tag", image, *where, *build_account_argv(project),
                                   "--async", "--quiet", "--format", "json"], "image", 1200) or "{}")
    build_id = submitted.get("id")
    if not build_id:
        fail("image", "the build was submitted and gcloud named no build id, so nothing can be followed or recorded")
    deadline = time.time() + BUILD_MINUTES * 60
    done = ("SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED", "EXPIRED", "INTERNAL_ERROR")
    while True:
        b = json.loads(gcloud(["builds", "describe", build_id, *where, "--format", "json"], "image", 300) or "{}")
        if b.get("status") in done:
            break
        if time.time() > deadline:
            fail("image", f"build {build_id} is still {b.get('status')} after {BUILD_MINUTES} minutes; "
                          f"nothing was recorded", state=f"build {build_id} is still running")
        time.sleep(BUILD_POLL_SECONDS)
    if b.get("status") != "SUCCESS":
        fail("image", f"build {build_id} ended {b.get('status')}: {str(b.get('statusDetail') or '')[:300]}. "
                      f"The build stops naming any runtime or binary the base image does not have, and nothing "
                      f"is installed into a package's image to make a check pass (12.4 rule 1).")
    digest = ((b.get("results") or {}).get("images") or [{}])[0].get("digest")
    if not IMAGE.DIGEST_RE.match(digest or ""):
        fail("image", f"build {build_id} reported {digest!r}, which is not a sha256 image digest, "
                      f"so nothing can be recorded")

    pinned = IMAGE.pinned(image, digest)
    entry = {"name": name, "package": pkg_name, "version": pkg_version, "sha256": sha256, "url": url,
             "image": image, "image_digest": digest, "pinned": pinned,
             "base": emitted.get("base"), "built_at": now_iso()}
    with inventory_lock():
        if alongside:
            entry["alongside"] = True
            kept = [e for e in load_json_list(IMAGES) if not (e.get("name") == name and e.get("version") == pkg_version)]
        else:
            kept = [e for e in load_json_list(IMAGES) if e.get("name") != name or e.get("alongside")]
        save_json_list(IMAGES, kept + [entry])
    shutil.rmtree(staging, ignore_errors=True)

    return {"ok": True, "act": "build", "name": name, "package": pkg_name, "version": pkg_version,
            "schema": pkg["manifest"].get("$schema"), "sha256": sha256, "url": url,
            "descriptor_sha256": (emitted.get("package") or {}).get("descriptor_sha256"),
            "install_sha256": (emitted.get("package") or {}).get("install_sha256"),
            "image": image, "image_digest": digest, "pinned": pinned,
            "base": emitted.get("base"), "files_as_built": files_as_built,
            # Whether this image wakes a model, where it will look for the harness
            # and which harness the base it was built on carries. None of it is a
            # credential and all of it decides what the container act must give:
            # a build that says needed is a deploy that must name a model and a
            # key, and one that says otherwise is a deploy that must name neither.
            "harness": emitted.get("harness"),
            "shape": shape,
            # Which customer project this was built in, under which account,
            # and every call it made there. Absent on our own machines.
            **cloud_report(),
            # Names, never values: what an owner's instruction still has to answer
            # before a container of this image can do any work at all.
            "needed_at_run_time": emitted.get("needed_at_run_time"),
            "checks": [{"kind": "unrun",
                        "what": "nothing in this image was run. The build refuses when a runtime or a binary the "
                                "install file names is not in the base, and installs each dependency from its own "
                                "lockfile with install-time scripts refused; nothing from the package was executed."}],
            "state": "an image was built and nothing was started, so this act has a build record and no deployment record"}


def container(argfile):
    out(container_step(read_args(argfile)))


def probe_container(name, spec, bucket, probe_text="status"):
    """One ordinary message through this agent's job, and what came back.
    Smoke grade and called that: it proves a container starts and answers one
    message, and nothing about whether the agent does its job. Shared by the
    deploy that creates the job and the model change that alters it, so the
    two say the same thing about the same check."""
    probe_id = f"deploy-check-{int(time.time())}"
    rel = f"jobs/{name}/{probe_id}"
    job_dir = f"{IMAGE.CONTAINER_MOUNT}/{rel}"
    probe_file = os.path.join(STAGING, f"dm-{name}-probe.json")
    write_text(probe_file, json.dumps(IMAGE.probe_message(probe_id, "deployment-manager", probe_text), indent=2) + "\n")
    gcloud(["storage", "cp", probe_file, f"gs://{bucket}/{rel}/message.json", "--quiet"], "check", 300)
    launched, _ = gcloud_quiet(IMAGE.execute_job_argv({**spec, "env": IMAGE.probe_env(name, job_dir)}),
                               int(spec.get("job_seconds") or 240) + 600)
    outcome_text = gcs_read(f"gs://{bucket}/{rel}/outcome.json")
    try:
        outcome = json.loads(outcome_text) if outcome_text else None
    except json.JSONDecodeError:
        outcome = None
    smoke = IMAGE.smoke_from_outcome(outcome, gcs_read(f"gs://{bucket}/{rel}/reply.txt") or "",
                                     launched.returncode == 0)
    if not smoke["passed"] and launched.returncode != 0:
        smoke["launcher"] = (launched.stderr or "").strip()[-400:]
    return smoke


def container_step(args, count_against_ceiling=True, alongside=None):
    """The side that starts the agent, from an instruction already read. Like
    image_step it RETURNS its record instead of printing it.

    count_against_ceiling is false for the callers that already counted
    themselves: the deploy that places an agent's work and the act that keeps
    a version alongside. One owner instruction has to cost one deploy however
    many procedures it runs through.

    `alongside` ({"version", "row"}) makes this a version kept BESIDE the
    current one (run configs phase 3): its own job and binding folder, the
    variables an operator set by hand on the current job carried over, the
    version added to the current row's `alongside` list instead of replacing
    the row, and no runtime record, because where the agent's work runs did
    not change. A smoke check that fails takes the new job down again."""
    name = args.get("name", "")
    along = (alongside or {}).get("version")
    binding_name = IMAGE.alongside_binding_name(name, along) if along else name
    url = args.get("package_url", "")
    expected_sha = args.get("sha256", "")
    image = args.get("image", "")
    bucket = args.get("bucket") or BUCKET
    region = args.get("region") or REGION
    # Whose project the job is created in, and under whose account. See
    # enter_cloud: with no grant this is the line it always was, and with one
    # it is the customer's project, refused here before anything is called if
    # the account they named does not belong to it.
    project = enter_cloud(args, "deploy")
    interaction = args.get("interaction", "")
    environment = args.get("environment", "")
    probe_text = args.get("probe") or "status"
    # Read the same way a host deploy reads it, off the same key of the same
    # argfile, and from this host's model setting when the owner named none
    # (harness_model). A container that wakes a model is under the owner's
    # instruction about which model in exactly the way a host install is; the
    # only difference is where the answer is written down afterwards. A
    # container that wakes no model may have none (the check where the model
    # is placed, below).
    model = harness_model(args.get("model"))
    # How much machine one message gets. Absent means the platform's own
    # default, which is what every container deployed before this ran on.
    memory = args.get("memory") or ""
    cpu = str(args.get("cpu") or "")

    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if model and not MODEL_RE.match(model):
        fail("validate", f"bad model {model!r}")
    if memory and not IMAGE.MEMORY_RE.match(memory):
        fail("validate", f"bad memory {memory!r}; it is a size like 2Gi or 512Mi")
    if cpu and not IMAGE.CPU_RE.match(cpu):
        fail("validate", f"bad cpu {cpu!r}; it is a whole number of cpus or a milli value like 500m")
    bad = IMAGE.check_started_image(image)
    if bad:
        fail("validate", bad)
    if not (bucket and IMAGE.BUCKET_RE.match(bucket)):
        fail("validate", "bucket must name the storage the job mounts; put it in the argfile or in DM_BUCKET")
    if not IMAGE.REGION_RE.match(region):
        fail("validate", f"bad region {region!r}")
    if project and not IMAGE.PROJECT_RE.match(project):
        fail("validate", f"bad project {project!r}")
    if interaction not in ("service", "interactive"):
        fail("validate", "interaction must be service or interactive")
    if environment and environment not in ("test", "staging", "production"):
        fail("validate", "environment must be test, staging, or production")

    # The same ceiling a host deploy is under. A container costs nothing between
    # messages, but it is still an agent that spends when one arrives, and both
    # limits fail closed rather than queueing.
    if count_against_ceiling:
        spend_check_and_record(load_list() + load_json_list(CONTAINERS))

    # 1. Fetch and verify. The deploy needs the package for the same reasons it
    # always did: to refuse an instruction that leaves out a ceiling, an address
    # or a credential name before anything is created, and to name the package
    # digest in the record.
    staging, pkg_dir, sha256, pkg = fetch_and_verify(name, url, expected_sha)
    pkg_name = pkg["manifest"]["name"]
    pkg_version = pkg["manifest"].get("version", "unknown")
    with_model_defaults(args, pkg)
    refusals = INSTALL.check_instruction(args, pkg, store_has)
    if refusals:
        fail("instruction", "; ".join(refusals))
    bindings = INSTALL.plan_bindings(args, pkg, IMAGE_HOME)
    names = INSTALL.placed_names(bindings)

    # 1b. The harness, when the package's work needs one. This is the half of
    # step 7 of the install that a container still has: on a host the procedure
    # copies the provider's key into the agent's home and writes the model into
    # a brain script, and here both go on the job as variables, because an
    # image is built once and copied everywhere and neither belongs in a layer
    # (12.6 rule 3). The image has the harness itself; the base carries it and
    # the build refuses when it does not.
    #
    # A package that names a command for every job and can never escalate gets
    # NEITHER. There is no model to wake, so a key on that job would be a
    # credential nobody uses, sitting where anyone who can read the job can
    # read it.
    harness = None
    secret = None
    if IMAGE.needs_model_key(pkg["install"]):
        if not model:
            fail("validate", NO_MODEL)
        prov = provider_of(model)
        if not prov:
            fail("bind", f"the model {model} names no provider this host lends a key for, and {pkg_name} wakes a "
                         f"model for its work. Name a model as <provider>/<model>, with the provider one of "
                         f"{', '.join(sorted(PROVIDERS))}.")
        key_env, _, secret = PROVIDERS[prov]
        if not secret:
            # Keyless (Claude on Vertex): the job's service account pays, and
            # the job is told only where to call.
            harness = {"model": model, "vars": keyless_vars(prov)}
        elif not store_has(secret):
            # The same refusal place_model_key makes on a host, and for the
            # same reason: nothing is swapped for another provider's key. A
            # container given no key wakes opencode anyway, the provider
            # refuses, and the sender reads "I could not finish this job",
            # which is what a model that ran and said nothing also reads as.
            fail("bind", f"the model names {prov} and the store holds no credential called {secret}; place it there "
                         f"and name it")
        else:
            # The NAME as well as the value: a container gets the name and Cloud
            # Run reads the secret itself at start, so the key never lands in
            # the job.
            harness = {"model": model, "key_env": key_env, "key": store_read(secret), "key_secret": secret}

    # 2. The binding: the owner's numbers and addresses, mounted and not baked.
    # An image is built once and copied everywhere, so a ceiling or an address
    # in a layer would be bound for every agent ever run from it (12.6 rule 3).
    # The entrypoint reads these three and refuses before any work runs when one
    # is missing, naming the system and never a value.
    docs = IMAGE.binding_documents(name, pkg["install"],
                                   INSTALL.ceilings_doc(bindings)["ceilings"],
                                   INSTALL.mcp_servers(bindings))
    bind_dir = os.path.join(STAGING, f"dm-{name}-binding")
    shutil.rmtree(bind_dir, ignore_errors=True)
    os.makedirs(bind_dir)
    for rel, text in docs.items():
        write_text(os.path.join(bind_dir, rel), text, 0o600)
        gcloud(["storage", "cp", os.path.join(bind_dir, rel),
                f"{IMAGE.binding_uri(bucket, binding_name)}/{rel}", "--quiet"], "bind", 300)

    # 3. The job: the image, the mount, and the variables for every message.
    # Creating it belongs here and not to whatever dispatches a message: which
    # image an agent is, is a deploy's decision.
    # Every named credential must EXIST before anything is created, and on this
    # arm that is all the deploy needs to know about it. The values are not
    # read: they ride as secret references (job_secret_refs) that Cloud Run
    # resolves at start under the job's own service account, so a container
    # deploy never holds the owner's credentials in this process at all.
    values = {}
    for b in bindings:
        if b.get("credential") and not store_has(b["credential"]):
            fail("bind", f"no credential named {b['credential']} in the store; place it there and name it")
    # The variables go in a file, mode 600, and the file goes when the call is
    # over. They include every credential the owner's store holds for this
    # agent, and a command line is in this host's own process list for as long
    # as the call runs.
    env_file = os.path.join(STAGING, f"dm-{name}-env.yaml")
    try:
        # The install file goes in because the directories it declares are
        # bound HERE and not in the image: 12.7.1 wants storage that outlives a
        # single run, and a container's filesystem is made fresh for every
        # message. On the job rather than on the execution, so every execution
        # of this agent looks in the same folder and a run started by one
        # message is there for the next one to find.
        secret_refs = IMAGE.job_secret_refs(bindings, harness)
        # THEIR SECRET MANAGER, where a customer project's job reads its keys
        # from. On our own project every one of these was placed by hand long
        # ago; theirs holds nothing, and a job created with --set-secrets
        # naming a secret that is not there starts, fails to resolve the
        # reference, and reads back as a container that answered nothing.
        place_secrets_in_their_project(sorted(set(secret_refs.values())), project)
        env = IMAGE.job_env(name, bindings, values, install=pkg["install"], harness=harness, secrets=True,
                            binding=binding_name)
        # The model gateway inside the job, when the model system's endpoint
        # is on loopback (model_gateway_env).
        env.update(model_gateway_env(args, pkg, (harness or {}).get("vars")))
        # A SINGLE-CONTAINER EDITION carries each member's own variables too,
        # under that member's prefix, read off the member's own job, and one
        # time limit for the whole run (image.composite_job_variables).
        composite = args.get("composite")
        composite_seconds = None
        if composite:
            members, member_seconds = composite_member_variables(composite, region, project)
            env = {**env, **members["env"]}
            secret_refs = {**secret_refs, **members["secrets"]}
            composite_seconds = IMAGE.composite_job_seconds(job_seconds_of(pkg), member_seconds, composite.get("run_seconds"))
            env["AGENT_JOB_SECONDS"] = str(composite_seconds)
        # What this deploy places, by name, for the row: the next update reads
        # it to tell a variable the package stopped declaring (ours, dropped)
        # from one an operator set by hand (theirs, kept). 2026-09-23.
        job_vars_placed = sorted(set(env) | set(secret_refs))
        where = {"job": IMAGE.job_name(name, along), "region": region, "project": project}
        exists = job_exists(where)
        carried_over, dropped = [], []
        if along:
            # A VERSION KEPT ALONGSIDE carries what an operator set by hand on
            # the CURRENT job (the process runner's publish token and account,
            # for one), read off that job exactly as an update reads its own,
            # and drops what this deploy manager placed there for the current
            # version: those are the current version's settings, and this
            # version's come from its own instruction above.
            cur = alongside.get("row") or {}
            cur_where = {"job": cur.get("job") or IMAGE.job_name(name), "region": cur.get("region") or region,
                         "project": cur.get("project") or project}
            full_env, full_refs, dropped = keep_what_the_job_carries(cur_where, env, secret_refs, cur)
            carried_over = sorted((set(full_env) - set(env)) | (set(full_refs) - set(secret_refs)))
            env, secret_refs = full_env, full_refs
        elif exists:
            # AN UPDATE keeps what the job already carries that is not the
            # package's. Both flags below replace every variable of their kind,
            # and on 2026-09-23 that wiped the process runner's hand-set publish
            # token and account, twice.
            row = next((r for r in load_json_list(CONTAINERS) if r.get("name") == name), None)
            full_env, full_refs, dropped = keep_what_the_job_carries(where, env, secret_refs, row)
            carried_over = sorted((set(full_env) - set(env)) | (set(full_refs) - set(secret_refs)))
            env, secret_refs = full_env, full_refs
        # Last, so a value the package or an operator set is kept (the process
        # runner's hand-set one among them), and not listed as placed, so no
        # later update drops it.
        if "MESH_API_BASE" not in env and "MESH_API_BASE" not in secret_refs:
            env["MESH_API_BASE"] = API_BASE
        write_text(env_file, IMAGE.env_yaml(env), 0o600)
        spec = {**where, "image": image,
                "bucket": bucket, "env": env, "env_file": env_file, "secrets": secret_refs,
                "memory": memory or machine_for(pkg)[0], "cpu": cpu or machine_for(pkg)[1],
                "job_seconds": composite_seconds or job_seconds_of(pkg) or 240,
                # In a customer's project the job runs AS the account they
                # granted, which is the account that owns the secrets this
                # deploy just placed, or as the second account where they asked
                # for the split (cloud.runs_as). On ours, absent, so the job
                # runs on the default compute account exactly as every job here
                # always has, unless the environment names the account our jobs
                # run as (gcp.jobs_sa; dev's workers account, env split 1.6).
                **({"service_account": CLOUD.runs_as(cloud_now()["grant"])} if cloud_now()
                   else {"service_account": jobs_account_for(name)} if jobs_account_for(name) else {}),
                **({"vpc": worker_vpc(name)} if worker_vpc(name) else {})}
        place_observe_rule(name, project)
        gcloud(IMAGE.create_job_argv(spec, exists=exists), "job", 900)
    except (KeyError, ValueError) as e:  # noqa: BLE001
        fail("job", str(e))
    finally:
        try:
            os.remove(env_file)
        except OSError:
            pass

    # What the job ACTUALLY names, read back rather than copied out of the
    # instruction. The record says what this deploy started, and an argfile
    # naming one digest and a job created with another is exactly the confusion
    # the digest is there to settle.
    started = gcloud(IMAGE.describe_job_argv(spec), "job", 180).strip()
    if "@" not in started:
        fail("job", f"the job names {started!r}, which carries no digest, so nothing can be recorded as started",
             state=f"the job {spec['job']} exists")
    image_digest = started.split("@", 1)[1]
    # The model the job runs with, from the variables it was created with
    # (the package's, and those kept from the job), never from the instruction.
    model_now = placed_model(env)

    # 4. The check: one ordinary message through the job it just created, and
    # what came back. Smoke grade and called that: it proves a container starts
    # and answers one message, and nothing about whether the agent does its job.
    smoke = probe_container(name, spec, bucket, probe_text)

    # Where each declared directory went, as an address a person can open. The
    # record names it because it is the one part of this deploy that outlives
    # every container it starts: remove the agent and these are what remain.
    directories = {d: IMAGE.directory_uri(bucket, name, d) for d in IMAGE.directory_names(pkg["install"])}

    if along:
        return alongside_placed(name, along, alongside.get("row") or {}, spec, bucket, binding_name, smoke, {
            "package": pkg_name, "version": pkg_version, "sha256": sha256, "url": url, "image": image,
            "image_digest": image_digest, "started": started, "harness": harness, "model": model, "secret": secret,
            "names": names, "job_vars_placed": job_vars_placed, "carried_over": carried_over, "dropped": dropped,
            "directories": directories, "docs": docs, "staging": staging, "interaction": interaction,
            "environment": environment, "region": region, "model_placed": model_now})
    entry = {"name": name, "package": pkg_name, "version": pkg_version, "sha256": sha256, "url": url,
             **where_the_work_runs(spec["job"], region, project),
             "bucket": bucket, "mount": IMAGE.CONTAINER_MOUNT, "binding": IMAGE.binding_uri(bucket, name),
             "directories": directories,
             "image": image, "image_digest": image_digest, "interaction": interaction,
             # The cap on one message's work, as the job was actually created
             # with it. A container always has one, from the package's
             # job_seconds or the default above, and an owner asking how long
             # their agent gets is asking about this number.
             "job_seconds": spec["job_seconds"],
             # The harness and the model only where there is one to name, so a
             # reader of the inventory can tell a container that thinks from
             # one that runs a program. `update` and `model` read these back.
             **({"harness": "opencode", "model": model, "secret_placed": secret} if harness else {}),
             # What the job runs with, read off its variables (placed_model);
             # null when it carries no model at all.
             "model_placed": model_now,
             "credentials_placed": names["credentials"], "settings_placed": names["settings"],
             # The variable names this deploy wrote on the job, and only those:
             # the next update drops one of these the package stopped declaring
             # and keeps every other name the job carries (2026-09-23).
             "job_vars_placed": job_vars_placed,
             "ceilings": names["ceilings"], "deployed_at": now_iso(), "state": "running",
             # THE GRANT, ON THE ROW, and this is what makes the removal
             # possible. `remove` is given a name and nothing else, so without
             # it a customer-project agent could be deployed and never taken
             # down: the job would keep existing in their project, costing them
             # money, with our inventory saying the agent was gone.
             **({"cloud": cloud_now()["grant"]} if cloud_now() else {}),
             **({"environment": environment} if environment else {})}
    with inventory_lock():
        save_json_list(CONTAINERS, [e for e in load_json_list(CONTAINERS) if e.get("name") != name] + [entry])
    shutil.rmtree(staging, ignore_errors=True)
    # THE CASE THE RUNTIME RECORD EXISTS FOR. Nothing about this deploy reaches
    # the owner's page any other way: the container holds no inbox, checks in
    # from nowhere, and is matched by nothing the control plane watches, so
    # without this the page shows the adapter's machine and calls it the place
    # the agent runs. The agent's key comes from the host install of the same
    # name, which is the side that holds the identity; a container deploy for a
    # name with no install has no subject to file this under, and says so
    # rather than inventing one.
    runtime = record_runtime(entry, agent_identity(name), kind="container")

    return {"ok": True, "act": "deploy", "name": name, "package": pkg_name, "version": pkg_version,
            "sha256": sha256, "url": url,
            # The one member that says this deploy started an image rather than
            # processes on a host (8.3), and it is what the job reports, never what
            # the instruction handed over.
            "image_digest": image_digest, "image": started,
            "host": f"cloud-run/{region}", "job": spec["job"], "bucket": bucket,
            "egress": dict(EGRESS_OPEN),
            "binding": IMAGE.binding_uri(bucket, name), "binding_dir": IMAGE.binding_dir(name),
            "binding_files": sorted(docs),
            # 12.7.1: each directory system bound to storage that outlives a single
            # run. The image carries none of them, and the record says where each
            # one is rather than that there are some.
            "directories": directories,
            "interaction": interaction, "admitted_at_start": [],
            # The harness and the model, and ABSENT where there is none of either.
            # A package that names a command for every job and can never escalate
            # wakes no model, so this deploy started no program to name and placed
            # no key to pay for one, and a record saying "harness: none" would be
            # claiming an observation about something that was never in the path.
            # Where there IS one, `secret_placed` is the model key by name and
            # goes into the record's secrets exactly as a host deploy's does.
            **({"harness": "opencode", "model": model, "secret_placed": secret} if harness else {}),
            # The model the job runs with, whatever was asked (technical debt
            # 456): read off the job's own variables, null when it has none.
            "model_placed": model_now,
            "credentials_placed": names["credentials"], "settings_placed": names["settings"],
            # By name and never by value: what an update found on the job and
            # left there because somebody else set it, and what it took off
            # because this side placed it and the package no longer asks.
            **({"job_vars_kept": carried_over} if carried_over else {}),
            **({"job_vars_dropped": dropped} if dropped else {}),
            "ceilings": names["ceilings"], "dependencies": [],
            # ABSENT on purpose, and each absence is a statement (8.3):
            #   key_custody   this deploy minted no subject and the image holds no
            #                 key, so it did not observe how the subject's key came
            #                 to exist or who holds it now.
            #   descriptor    nothing was bound: the bound Descriptor's signature
            #                 is made with the subject's own key, and there is no
            #                 subject here.
            #   ledger        in an image the files are layers, and the answer to
            #                 "what is deployed" is the image digest above, checked
            #                 against the build record's (12.7.1).
            **({"environment": environment} if environment else {}),
            # Which customer project this job was created in, under which
            # account, and every call this act made there. Absent on our own
            # machines, where there is no customer and nothing to disclose.
            **cloud_report(),
            "runtime": runtime,
            "check_folder": f"gs://{bucket}/{rel}", "smoke": smoke,
            "state": "the job exists and one message went through it"}


def place_in_cloud_run(args):
    """The default placement, composed out of the two procedures above.

    WHY COMPOSED AND NOT A FOURTH PROCEDURE. There is one owner instruction, a
    deploy, and one thing the owner asked for, an agent that works. A fourth
    entry point would make the default depend on the caller remembering to
    reach for it, and that is precisely the state this changes: `image` and
    `container` have existed for days, they are documented, and every deploy
    still landed the work on this host because `deploy` is the procedure a
    deploy asks for. A default that has to be chosen is not a default.

    WHAT THE HOST STILL HOLDS. The adapter, and therefore the mailbox, the
    address and the key: a Cloud Run job has none of those and does not exist
    between executions. The package's files stay in the home too, because the
    identity, the bound descriptor and the ledger are made from them and are
    the agent's standing record of what was installed. What MOVES is the work,
    which is the one part of an agent that needs a machine only while a message
    is being answered.

    THE ORDER IS THE HOST FIRST. The container half has no subject to file a
    runtime record under until the host install has minted one (agent_identity
    reads it out of the host inventory), and the image is built from the same
    package that install just verified.

    NOTHING IS SWALLOWED. Both halves refuse by calling fail(), which stops the
    whole act at the step it names; the agent installed a moment ago is still
    CURRENT["entry"], so a build that will not build leaves an inventory row
    reading "failed at image", an adapter holding the mail, and a `remove` that
    clears both halves. The work never quietly falls back to this host: a host
    placement is something an owner asks for."""
    build = image_step(args)
    # BY DIGEST, and by the digest this build reported rather than by the tag it
    # was pushed under: container_step refuses a tag for the reason the record
    # exists at all, which is that a tag can point somewhere else an hour later.
    started = container_step({**args, "image": build["pinned"]}, count_against_ceiling=False)
    return {"where": "cloud-run", "job": started["job"], "image": started["image"],
            "image_digest": started["image_digest"], "bucket": started["bucket"],
            "directories": started["directories"], "build": build,
            # The container half's, which carries the build's calls too: one
            # owner instruction ran through both procedures under one grant, and
            # the list we owe the customer is of everything that instruction did
            # in their project (enter_cloud).
            **({"cloud": started["cloud"]} if started.get("cloud") else {}),
            "runtime": started["runtime"], "check": started["smoke"],
            "model_placed": started.get("model_placed"),
            "state": started["state"]}


# ── the work placed while the node is watched ─────────────────────────────
#
# 2026-10-31: a new agent's install on the dev fleet took about four minutes
# from the approval to "deployed" (consonant-tally and letter-counter, Build an
# agent). Two of the four were the watch, and a minute and a half came after
# it: the image build, the job and the job's first message, one after the
# other, though none of them touches the node the watch is about and the watch
# reads nothing they make. So the work's placement (place_in_cloud_run,
# unchanged) now starts in a process of its own as soon as the smoke check has
# passed, runs while the node is watched, and the act waits for its answer
# where it used to run it (deploy_finish).
#
# The watch keeps its full length and its meaning: nothing says deployed before
# it passes, and an agent it takes back out has its work taken down with it
# (take_down_work, armed as fail()'s on_fail), so a rolled-back install leaves
# what it always left. A failed placement is the act's refusal, said as it
# always was, at the step it stopped.
#
# A process and not a thread, because every refusal in the placement is a
# fail() that prints an answer and exits: in a process of its own that answer
# is the work's, read back here. It is told nothing of the node lock (the
# lock's descriptor is not passed down), and its end is learnt from a lock it
# holds for its whole life, not by asking again and again.
#
#   DM_WORK_DURING_WATCH   on (the default): as above. off: the work is
#                          placed after the watch, as before.
#   DM_WORK_WAIT_SECONDS   the longest the act waits for the placement once
#                          the watch is over. Default the build's own limit
#                          (DM_BUILD_MINUTES) and the quarter hour the executor
#                          allows for the job and its first message.
#
# Never for an instruction into a customer's own project (a `cloud` grant):
# this act's answer lists every call made there from its own record of them
# (cloud_report), which a second process would not add to.
WORK_WAIT_SECONDS = int(os.environ.get("DM_WORK_WAIT_SECONDS") or BUILD_MINUTES * 60 + 900)


def work_during_watch_on():
    return (os.environ.get("DM_WORK_DURING_WATCH") or "on").strip().lower() in ("on", "1", "true", "yes")


def works_dir():
    return os.path.join(STATES, "work")


def start_work_if_wanted(ctx, smoke, arm=True):
    """Start placing this deploy's work now, or None when it waits for the
    watch as before: the placement is not Cloud Run, the switch is off, the
    instruction is for a customer's own project, the smoke check did not pass,
    or the process could not be started. `arm` makes any later refusal of this
    act take the work down first (on_fail); a landing, which acts for several
    agents, leaves that to each agent's finish."""
    args = ctx.get("args") or {}
    if (ctx.get("act", "deploy") != "deploy" or ctx.get("placement") != "cloud-run" or not work_during_watch_on()
            or args.get("cloud") or not (smoke or {}).get("passed") or fcntl is None):
        return None
    try:
        handle = start_work(ctx["name"], args)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print(f"the work's placement could not be started during the watch ({str(e)[:200]}); "
              f"it is placed after it", file=sys.stderr)
        return None
    if arm:
        CURRENT["on_fail"] = lambda step: take_down_work(ctx["name"], handle)
    return handle


def start_work(name, args):
    """place_in_cloud_run(args) in a process of its own (the `work` verb),
    started and not waited for. Its answer goes to <stem>.out; it holds
    <stem>.lock, locked here before it starts, until it ends."""
    os.makedirs(works_dir(), mode=0o700, exist_ok=True)
    stem = os.path.join(works_dir(), f"{name}-{os.getpid()}-{int(time.time() * 1000)}")
    write_text(f"{stem}.args.json", json.dumps(args), 0o600)
    lock_fd = os.open(f"{stem}.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        with open(f"{stem}.out", "w") as o, open(f"{stem}.err", "w") as e:
            p = subprocess.Popen([sys.executable or "python3", os.path.abspath(__file__), "work", f"{stem}.args.json"],
                                 stdin=subprocess.DEVNULL, stdout=o, stderr=e, start_new_session=True,
                                 close_fds=True, pass_fds=(lock_fd,))
    finally:
        os.close(lock_fd)
    return {"stem": stem, "pid": p.pid, "started_at": now_iso()}


def work(path):
    """The `work` verb: one placement begun by start_work. Its answer is
    printed like any act's, success or refusal."""
    real = os.path.realpath(path)
    if not (real.startswith(os.path.realpath(works_dir()) + os.sep) and real.endswith(".args.json")):
        fail("validate", f"{path} is not a placement begun by this procedure")
    with open(real, encoding="utf-8") as f:
        args = json.load(f)
    os.remove(real)
    out({"ok": True, "act": "work", "work": place_in_cloud_run(args)})


def lock_released(path, seconds):
    """True once nobody holds the lock at `path`, False if it is still held
    after `seconds`. The kernel says when, so nothing is asked twice."""
    try:
        fd = os.open(path, os.O_RDWR)
    except OSError:
        return True
    try:
        def too_long(*_):
            raise TimeoutError()
        old = signal.signal(signal.SIGALRM, too_long)
        signal.alarm(max(1, int(seconds)))
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            return True
        except TimeoutError:
            return False
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old)
    finally:
        os.close(fd)


def wait_work(handle, seconds=None):
    """The placement's one answer, once its process has ended. One that is
    still running after `seconds` is stopped, and its answer is a refusal that
    says so. The placement's files go either way."""
    seconds = WORK_WAIT_SECONDS if seconds is None else seconds
    stem = str((handle or {}).get("stem") or "")
    if not os.path.realpath(stem).startswith(os.path.realpath(works_dir()) + os.sep):
        return {"ok": False, "step": "work", "error": f"{stem!r} is not a placement begun by this procedure"}
    ended = lock_released(f"{stem}.lock", seconds)
    if not ended:
        try:
            os.killpg(int(handle["pid"]), signal.SIGTERM)
        except (OSError, KeyError, TypeError, ValueError):
            pass
    answer, err = None, ""
    try:
        lines = [ln for ln in open(f"{stem}.out", encoding="utf-8").read().splitlines() if ln.strip().startswith("{")]
        answer = json.loads(lines[-1]) if lines else None
    except (OSError, ValueError):
        answer = None
    try:
        err = open(f"{stem}.err", encoding="utf-8", errors="replace").read()[-300:]
    except OSError:
        pass
    for ext in (".out", ".err", ".lock", ".args.json"):
        try:
            os.remove(stem + ext)
        except OSError:
            pass
    if not ended:
        return {"ok": False, "step": "work",
                "error": f"placing the work in Cloud Run did not finish within {seconds} seconds and was stopped",
                "state": "an image build or a job it began may exist"}
    if not isinstance(answer, dict):
        return {"ok": False, "step": "work", "error": f"placing the work in Cloud Run gave no answer: {err}"}
    return answer


def finish_work(handle):
    """deploy_finish's half of a placement begun during the watch: what it
    placed, or this act's refusal with the step, the words and the state the
    placement gave."""
    CURRENT["on_fail"] = None
    done = wait_work(handle)
    if done.get("ok") and isinstance(done.get("work"), dict):
        return done["work"]
    extra = {k: v for k, v in done.items() if k not in ("ok", "step", "error", "state", "act")}
    state = done.get("state")
    fail(done.get("step") or "work", done.get("error") or "placing the work in Cloud Run gave no reason",
         state=None if state == "nothing created" else state, **extra)


def take_down_work(name, handle):
    """A refusal after the placement began: wait for it, then take down what
    it placed (take_down_container: the job, its binding, its egress rule, its
    row) and withdraw the runtime record it filed, so the agent taken back out
    has no work anywhere, as before. Returns the words fail() puts first in
    the refusal's state."""
    done = wait_work(handle)
    if not done.get("ok"):
        return (f"the work's placement, begun during the watch, stopped at {done.get('step') or 'work'}: "
                f"{str(done.get('error') or '')[:200]}")
    row = next((r for r in load_json_list(CONTAINERS) if r.get("name") == name), None)
    if row is None:
        return "the work's placement, begun during the watch, finished and left no row, so nothing was taken down"
    # What take_down_container always names and leaves on purpose (the job
    # folders and the agent's own directories) is not something left over.
    left = [ln for ln in take_down_container(name, row)
            if not ln.startswith("job folders of messages") and " directory at " not in ln]
    forget_runtime((agent_identity(name) or {}).get("key"))
    said = f"the job {row.get('job')}, placed while the node was watched, was taken down again"
    return f"{said}, except: {'; '.join(left)}" if left else said


def model_placed_of(work, model, container_row=None):
    """What a host deploy or update says its agent runs with (technical debt
    456), as a dict to spread into the result: the container job's model, read
    off the job, where this act placed the work in one; the container row's
    record of it where the work runs in a container this act did not touch (a
    reinstall of the same bytes), and nothing at all where that row predates
    the record, because an absent member says it was not observed; else the
    model this procedure wrote into the brain script on the host, which is
    what AGENT_MODEL is there."""
    if work and "model_placed" in work:
        return {"model_placed": work["model_placed"]}
    if container_row:
        return {"model_placed": container_row["model_placed"]} if "model_placed" in container_row else {}
    return {"model_placed": {"model": model, "variable": IMAGE.MODEL_VAR}}


# ── versions kept alongside the current one (run configs phase 3) ─────────
#
# docs/run-config-plan.md, Phase 3, and Common Agent 12.7 (Install alongside,
# Retire a version). An agent is one subject: one key, one handle, one inbox.
# A version kept alongside is a second Cloud Run job of the same agent, reached
# by a job that names that version in its run context (the supervisor reads
# it). Nothing here mints a subject or binds a Descriptor: the bound
# Descriptor stays the current version's, which is what the agent declares to
# everyone. What the adapter needs to stamp a job made by such a version
# honestly is alongside.json, beside package-record.json, which only this
# procedure writes.

ALONGSIDE_RECORD = "alongside.json"


def alongside_versions(row):
    """The versions kept alongside on a container row, running ones only."""
    return [a for a in (row or {}).get("alongside") or []
            if isinstance(a, dict) and a.get("version") and (a.get("state") or "running") == "running"]


def write_alongside_record(name, versions, package=None, home=None):
    """alongside.json in the agent's adapter state folder: which versions this
    agent keeps beside its current one, each with the package digest it was
    installed from. The adapter believes a reply's `ran` version only when it
    is listed here. Owned like package-record.json, by whoever runs the adapter
    that serves the agent. Removed when no version is kept. Returns where it
    went, or why it could not be written (an act never fails over it: without
    the file the adapter stamps the current version, which is the old
    behaviour and says so)."""
    home = home or f"/home/{name}"
    dest = f"{home}/.agentmesh/adapter/{ALONGSIDE_RECORD}"
    try:
        if not versions:
            if os.path.exists(dest):
                os.remove(dest)
            return {"path": dest, "versions": []}
        doc = {"format": "alongside-record-v1", **({"package": package} if package else {}),
               "versions": [{"version": str(v["version"]), "sha256": v.get("sha256")} for v in versions]}
        with open(dest, "w") as f:
            f.write(json.dumps(doc) + "\n")
        desc = f"{home}/.agentmesh/adapter/descriptor.json"
        if os.path.exists(desc):
            st = os.stat(desc)
            os.chown(dest, st.st_uid, st.st_gid)
        os.chmod(dest, 0o600)
        return {"path": dest, "versions": [v["version"] for v in doc["versions"]]}
    except OSError as e:
        return {"path": dest, "error": str(e)[:200]}


def alongside_placed(name, version, row, spec, bucket, binding_name, smoke, f):
    """The end of container_step for a version kept alongside: a failed smoke
    check takes the new job and its binding down again and refuses; a passed
    one adds the version to the current row and to alongside.json."""
    if not smoke.get("passed"):
        gcloud_quiet(["run", "jobs", "delete", spec["job"], "--region", spec["region"],
                      *(["--project", spec["project"]] if spec.get("project") else []), "--quiet"], 600)
        gcloud_quiet(["storage", "rm", "--recursive", IMAGE.binding_uri(bucket, binding_name), "--quiet"], 600)
        shutil.rmtree(f["staging"], ignore_errors=True)
        fail("check", f"the smoke check failed on {f['package']} {version} kept alongside: "
                      f"{str(smoke.get('observed') or smoke.get('launcher') or '')[:300]}",
             state=f"the job {spec['job']} and its binding were taken down again; the current version is untouched",
             smoke=smoke)
    entry = {"version": f["version"], "package": f["package"], "sha256": f["sha256"], "url": f["url"],
             "job": spec["job"], "region": f["region"], **({"project": spec["project"]} if spec.get("project") else {}),
             "image": f["image"], "image_digest": f["image_digest"],
             "binding": IMAGE.binding_uri(bucket, binding_name), "job_seconds": spec["job_seconds"],
             **({"harness": "opencode", "model": f["model"], "secret_placed": f["secret"]} if f["harness"] else {}),
             "model_placed": f.get("model_placed"),
             "credentials_placed": f["names"]["credentials"], "settings_placed": f["names"]["settings"],
             "job_vars_placed": f["job_vars_placed"], "ceilings": f["names"]["ceilings"],
             "installed_at": now_iso(), "state": "running"}
    with inventory_lock():
        rows = load_json_list(CONTAINERS)
        current = None
        for r in rows:
            if r.get("name") == name and (r.get("state") or "running") == "running":
                r["alongside"] = [a for a in r.get("alongside") or [] if a.get("version") != f["version"]] + [entry]
                current = r
        save_json_list(CONTAINERS, rows)
    shutil.rmtree(f["staging"], ignore_errors=True)
    agent = agent_identity(name) or {}
    record = write_alongside_record(name, alongside_versions(current), package=f["package"])
    return {"ok": True, "act": "alongside", "name": name, "package": f["package"], "version": f["version"],
            "current_version": (current or row).get("version"),
            "sha256": f["sha256"], "url": f["url"],
            **({"agent_key": agent["key"], "handle": agent.get("handle")} if agent.get("key") else {}),
            "image_digest": f["image_digest"], "image": f["started"],
            "host": f"cloud-run/{f['region']}", "job": spec["job"], "bucket": bucket,
            "egress": dict(EGRESS_OPEN),
            "binding": IMAGE.binding_uri(bucket, binding_name), "binding_files": sorted(f["docs"]),
            "directories": f["directories"], "interaction": f["interaction"],
            **({"harness": "opencode", "model": f["model"], "secret_placed": f["secret"]} if f["harness"] else {}),
            "model_placed": f.get("model_placed"),
            "credentials_placed": f["names"]["credentials"], "settings_placed": f["names"]["settings"],
            **({"job_vars_kept": f["carried_over"]} if f["carried_over"] else {}),
            **({"job_vars_dropped": f["dropped"]} if f["dropped"] else {}),
            "ceilings": f["names"]["ceilings"], "dependencies": [],
            **({"environment": f["environment"]} if f["environment"] else {}),
            **cloud_report(),
            "alongside_record": record,
            "smoke": smoke,
            "state": f"version {f['version']} is kept alongside {(current or row).get('version')}: the job "
                     f"{spec['job']} exists and one message went through it. A job reaches it by naming "
                     f"{f['version']} in its run context; every other job is answered by the current version."}


def alongside(argfile):
    """Keep another version of an installed container agent beside its current
    one (Common Agent 12.7, Install alongside). The argfile is an update's:
    name, package_url, sha256, and the credentials, settings, addresses and
    ceilings by role for THAT version, plus optionally model. Everything a
    container half needs that the instruction leaves out is read off the
    current row, as an update reads it."""
    if not argfile.startswith(f"{DM_HOME}/tmp/"):
        fail("validate", "argfile outside the deploymgr tmp dir")
    args = read_args(argfile)
    name = args.get("name", "")
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    entry = next((a for a in load_list() if a.get("name") == name), None)
    if not entry:
        fail("validate", f"{name} is not installed on this host, so there is no agent to keep another version of")
    row = next((e for e in load_json_list(CONTAINERS)
                if e.get("name") == name and (e.get("state") or "running") == "running"), None)
    if not row or row.get("runs_on") != "cloud-run" or not row.get("job"):
        fail("validate", f"{name}'s work does not run in a container. Only an agent whose work runs in a container "
                         f"can keep a second version: a host-run agent has one home and one brain")
    # The version, read before anything is built, so a refusal costs nothing.
    staging, _pkg_dir, _sha, pkg = fetch_and_verify(name, args.get("package_url", ""), args.get("sha256", ""))
    shutil.rmtree(staging, ignore_errors=True)
    pkg_name, version = pkg["manifest"]["name"], str(pkg["manifest"].get("version", ""))
    if pkg_name != (entry.get("package") or row.get("package")):
        fail("verify", f"the package is {pkg_name}; {name} runs {entry.get('package') or row.get('package')}, and a "
                       f"version kept alongside is a version of the same package")
    if not IMAGE.VERSION_RE.match(version):
        fail("verify", f"the package's version {version!r} is not a version this procedure can name a job after")
    if version == str(row.get("version")):
        fail("version", f"{name} {version} is the current version; a version kept alongside is a different one")
    if any(a.get("version") == version for a in alongside_versions(row)):
        fail("version", f"{name} {version} is already kept alongside {row.get('version')}")
    job = IMAGE.job_name(name, version)
    if not IMAGE.JOB_NAME_RE.match(job):
        fail("validate", f"the job name {job} would be longer than Cloud Run allows")
    # One deploy against the day's ceiling. Not against the agents ceiling:
    # this is the same agent, and the names it counts do not grow.
    spend_check_and_record([])
    harness = entry.get("harness") or entry.get("framework") or "opencode"
    model = harness_model(args.get("model"), row.get("model"), entry.get("model"), harness=harness)
    filled = container_args_for_update(args, row, entry, harness, model)
    build = image_step(filled, alongside=True)
    started = container_step({**filled, "image": build["pinned"]}, count_against_ceiling=False,
                             alongside={"version": version, "row": row})
    out({**started, "build": {"image": build["image"], "image_digest": build["image_digest"],
                              "pinned": build["pinned"], "base": build.get("base")}})


def retire_version(argfile):
    """Take one version kept alongside out (Common Agent 12.7, Retire a
    version): its job and its binding folder go, it comes off the row and out
    of alongside.json. Never the current version, which only an update or a
    removal changes. The image stays, as every update keeps the image it
    replaced, and the record says so under `remaining`."""
    if not argfile.startswith(f"{DM_HOME}/tmp/"):
        fail("validate", "argfile outside the deploymgr tmp dir")
    args = read_args(argfile)
    name = args.get("name", "")
    version = str(args.get("version") or "")
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if not IMAGE.VERSION_RE.match(version):
        fail("validate", f"bad version {version!r}")
    rows = load_json_list(CONTAINERS)
    row = next((e for e in rows if e.get("name") == name and (e.get("state") or "running") == "running"), None)
    if not row:
        fail("validate", f"{name} has no container row on this host, so it keeps no version alongside")
    if version == str(row.get("version")):
        fail("validate", f"{version} is {name}'s current version. Only an update or a removal changes it; "
                         f"retiring takes out a version kept alongside")
    held = next((a for a in alongside_versions(row) if a.get("version") == version), None)
    if not held:
        fail("validate", f"{name} keeps no version {version} alongside {row.get('version')}")
    enter_cloud({"cloud": row.get("cloud"), "project": row.get("project"), "name": name}, "remove")
    removed, remaining = [], []
    spec = {"job": held.get("job") or IMAGE.job_name(name, version), "region": held.get("region") or row.get("region") or REGION,
            "project": held.get("project") or row.get("project")}
    p, action = gcloud_quiet(["run", "jobs", "delete", spec["job"], "--region", spec["region"],
                              *(["--project", spec["project"]] if spec.get("project") else []), "--quiet"], 600)
    if p.returncode == 0:
        removed.append(f"the cloud run job {spec['job']}")
    else:
        remaining.append(f"cloud run job {spec['job']} not deleted: {cloud_reason(action, (p.stderr or '').strip()[:200])}")
    if held.get("binding"):
        d, action = gcloud_quiet(["storage", "rm", "--recursive", held["binding"], "--quiet"], 600)
        if d.returncode == 0:
            removed.append(f"its binding at {held['binding']}")
        else:
            remaining.append(f"the binding at {held['binding']} was not removed: {cloud_reason(action, (d.stderr or '').strip()[:200])}")
    if held.get("image_digest") or held.get("image"):
        # The row's image is already pinned by digest (image@sha256:...); say it once.
        image = str(held.get("image") or "")
        shown = image if "@" in image else f"{image}@{held.get('image_digest') or ''}".strip("@")
        remaining.append(f"the image {shown} is kept, as every update keeps the image it replaced")
    remaining.append("job folders of messages this version answered remain on the mount; they are the record of work "
                     "that was done")
    row["alongside"] = [a for a in row.get("alongside") or [] if a.get("version") != version]
    if not row["alongside"]:
        row.pop("alongside", None)
    # Read again under the lock and only this agent's row replaced, so a row
    # another act wrote during the calls above is kept.
    with inventory_lock():
        save_json_list(CONTAINERS, [row if e.get("name") == name and (e.get("state") or "running") == "running" else e
                                    for e in load_json_list(CONTAINERS)])
    with inventory_lock():
        save_json_list(IMAGES, [e for e in load_json_list(IMAGES)
                                if not (e.get("name") == name and e.get("version") == version and e.get("alongside"))])
    record = write_alongside_record(name, alongside_versions(row), package=row.get("package"))
    removed.append(f"version {version} from alongside.json")
    agent = agent_identity(name) or {}
    out({"ok": True, "act": "retire-version", "name": name, "package": row.get("package"), "version": version,
         "current_version": row.get("version"),
         **({"agent_key": agent["key"], "handle": agent.get("handle")} if agent.get("key") else {}),
         "host": f"cloud-run/{spec['region']}", "was": held, "removed": removed, "remaining": remaining,
         "alongside_record": record, **cloud_report(),
         "state": f"{name} {version} is no longer kept; {row.get('version')} answers every job"})


def job_exists(spec):
    p, _ = gcloud_quiet(IMAGE.describe_job_argv(spec), 180)
    return p.returncode == 0


def placed_on_job(row):
    """The variable names this deploy manager wrote on an agent's job last
    time, read off its container row.

    A row written since 2026-09-23 says so in `job_vars_placed`. An older row
    does not, and for it the names are the ones this side has always placed:
    the agent's name, the binding, the model, every provider's key and each
    setting the row lists (keep_what_the_job_carries adds the directories and
    the credential references, which it recognises on the job itself). What is
    left over is what an operator set by hand, which is the part an update
    must not take away."""
    if not row:
        return set()
    if isinstance(row.get("job_vars_placed"), list):
        return set(row["job_vars_placed"])
    return {"AGENT_NAME", IMAGE.BINDING_DIR_VAR, IMAGE.MODEL_VAR,
            *provider_var_names(), *(row.get("settings_placed") or [])}


def store_credential_names():
    """The credential NAMES in this deploy manager's own store (the
    <name>.secret files), never a value. Empty when the store cannot be read."""
    try:
        return {f[:-7] for f in os.listdir(CREDENTIALS) if f.endswith(".secret")}
    except OSError:
        return set()


def keep_what_the_job_carries(spec, env, refs, row):
    """The variables and references an update writes: the package's own, and
    every one the job already carries that the package does not set and this
    deploy manager did not place. Returns (env, refs, dropped).

    WHY. --env-vars-file and --set-secrets each replace every variable of their
    kind on the job, so an update that sent only the package's list wiped
    whatever an operator had set by hand. On 2026-09-23 that was the process
    runner's MESH_API_TOKEN (a reference to process-runner-publish-token),
    MESH_ACCOUNT, MESH_API_BASE and AGENT_HANDLE, wiped twice by the update to
    0.10.2, and run pages went blank until they were put back.

    The read goes through gcloud() and not gcloud_quiet(): the job exists, so
    a read that fails is a reason to stop, and carrying on would be the wipe."""
    current = IMAGE.job_variables(gcloud(IMAGE.describe_job_variables_argv(spec), "job", 180))
    before = placed_on_job(row)
    # A reference to a credential in this deploy manager's OWN store is one this
    # side placed, whatever the row says: nobody sets those by hand, and the
    # hand-set references this function exists to keep (the process runner's
    # publish token) are not in the store. Found 2026-09-28: publisher 0.2.0
    # stopped declaring draft-host-writer, the update of the day left the
    # reference on the job, its row then listed nothing, and 0.2.1 kept it as
    # somebody's hand-set variable.
    store = store_credential_names()
    before |= {n for n, ref in current["secrets"].items() if ref.split(":", 1)[0] in store}
    if row and not isinstance(row.get("job_vars_placed"), list):
        # An older row: directories and credential references are recognised
        # by shape, since the row never listed the variable names.
        before |= {n for n in current["env"] if n.startswith("AGENT_DIRECTORY_")}
        ours = set(row.get("credentials_placed") or []) | {s for _, _, s in PROVIDERS.values() if s}
        before |= {n for n, ref in current["secrets"].items() if ref.split(":", 1)[0] in ours}
    return IMAGE.carry_forward(env, refs, current, before)


def placed_model(env):
    """The model a container job actually runs with, read off the variables it
    was created with (technical debt 456): AGENT_MODEL when the job carries
    it, else the one install setting whose name ends in MODEL and whose value
    names a model (a script package reads its model from one, as
    presentation-reader's DECK_MODEL). Returns {"model", "variable"} or None.

    WHY. The deploy request's args.model is what was ASKED. A package that
    wakes no model through the harness never has it placed, and a job keeps a
    model somebody set on it by hand, so on dev on 2026-10-07 scene-writer's
    request said claude-sonnet-5-5 while its job ran gemini-3.8-flash, and a
    builder told the owner the wrong model wrote a script. The record now says
    what was placed, from the job's own variables."""
    env = env or {}
    value = env.get(IMAGE.MODEL_VAR)
    if isinstance(value, str) and MODEL_RE.match(value):
        return {"model": value, "variable": IMAGE.MODEL_VAR}
    # A bare model name counts too: presentation-reader's DECK_MODEL is
    # "gemini-3.8-flash" on dev, its provider fixed by the package.
    named = sorted(k for k, v in env.items()
                   if re.search(r"(^|_)MODEL$", k) and isinstance(v, str) and MODEL_RE.match(v))
    if len(named) == 1:
        return {"model": env[named[0]], "variable": named[0]}
    return None


def where_the_work_runs(job, region, project):
    """The members of the container row that SWITCH an agent, kept in one place
    because they are the switch.

    runtime/fleet/roster.mjs containerFromDeploy reads exactly these off the row
    and gives up on any row missing one: `runs_on` has to be the words
    "cloud-run", the job and the region are both required and neither is
    inferred from the other, and the project is carried when there is one. A row
    it gives up on is not an error anybody sees; it is an agent whose work
    quietly stays on this host while a job sits there unused, which is how a day
    went the first time a container was deployed. Writing these four is the
    whole of how an agent's work is moved."""
    return {"runs_on": "cloud-run", "job": job, "region": region, "project": project}


# ── remove ────────────────────────────────────────────────────────────────

def remove_container(name, entry):
    """An agent whose work runs somewhere this procedure does not reach and
    that has no install on this host: the container half is taken down and the
    record is printed here."""
    remaining = take_down_container(name, entry)
    # The job is gone, so the owner's page must stop naming it. Where the host
    # install of this name is still there the work is back on this machine and
    # the record says so; where it is not, there is nothing left to state.
    runtime = publish_runtime_for(name)
    out({"ok": True, "act": "remove", "name": name, "was": entry,
         "credentials_removed": list(entry.get("credentials_placed") or []),
         "runtime": runtime,
         **cloud_report(),
         "remaining": remaining})


def take_down_container(name, entry):
    """The job goes, the binding goes, and what could not be removed is named.
    Returns the `remaining` lines rather than printing them, because a PLACED
    agent has both halves and one `remove` has to take down both and report
    once. The honest part is the same as a host removal's: `remaining` is empty
    only when the removal was complete, and nothing here pretends to have
    reached the executions that already ran."""
    remaining = []
    # WHOSE PROJECT THIS REMOVAL IS IN, read off the row and not off a request.
    # `remove` is given a name and nothing else, so the only place the grant
    # can come from is the row the deploy wrote; it is re-read through the same
    # guard, because a hand-edited inventory is exactly the mixed-up context
    # that guard is for. A row with no grant removes from our project, which is
    # every removal this procedure has ever done.
    enter_cloud({"cloud": entry.get("cloud"), "project": entry.get("project"), "name": name}, "remove")
    spec = {"job": entry.get("job") or IMAGE.job_name(name), "region": entry.get("region") or REGION,
            "project": entry.get("project")}
    p, action = gcloud_quiet(["run", "jobs", "delete", spec["job"], "--region", spec["region"],
                              *(["--project", spec["project"]] if spec.get("project") else []), "--quiet"], 600)
    if p.returncode != 0:
        remaining.append(f"cloud run job {spec['job']} not deleted: "
                         f"{cloud_reason(action, (p.stderr or '').strip()[:200])}")
    binding = entry.get("binding")
    if binding:
        d, action = gcloud_quiet(["storage", "rm", "--recursive", binding, "--quiet"], 600)
        if d.returncode != 0:
            remaining.append(f"the binding at {binding} was not removed: "
                             f"{cloud_reason(action, (d.stderr or '').strip()[:200])}")
    # Every version kept alongside goes with the agent: a removed agent whose
    # older job still existed would be one nobody can reach and somebody pays
    # to keep (run configs phase 3).
    for held in alongside_versions(entry):
        job = held.get("job") or IMAGE.job_name(name, held["version"])
        p, action = gcloud_quiet(["run", "jobs", "delete", job, "--region", held.get("region") or spec["region"],
                                  *(["--project", spec["project"]] if spec.get("project") else []), "--quiet"], 600)
        if p.returncode != 0:
            remaining.append(f"cloud run job {job} (version {held['version']}, kept alongside) not deleted: "
                             f"{cloud_reason(action, (p.stderr or '').strip()[:200])}")
        if held.get("binding"):
            d, action = gcloud_quiet(["storage", "rm", "--recursive", held["binding"], "--quiet"], 600)
            if d.returncode != 0:
                remaining.append(f"the binding at {held['binding']} was not removed: "
                                 f"{cloud_reason(action, (d.stderr or '').strip()[:200])}")
    # Its own egress rule goes with it (the observe phase's, egress step 3).
    if not entry.get("cloud"):
        left = remove_observe_rule(name, spec.get("project"))
        if left:
            remaining.append(left)
    with inventory_lock():
        save_json_list(CONTAINERS, [e for e in load_json_list(CONTAINERS) if e.get("name") != name])
    # The credentials were placed as variables ON the job, so they go with it,
    # and the job folders of messages already answered stay on the bucket
    # because they are the record of work that was done.
    remaining.append("job folders of messages already answered remain on the mount; they are the record of "
                     "work that was done, not part of the install")
    # The directories are the point of binding them at all: they outlive every
    # container, and a removal that deleted them would delete the agent's own
    # records on the way out. Named, and left where they are, for a person to
    # decide about.
    for role, uri in sorted((entry.get("directories") or {}).items()):
        remaining.append(f"the {role} directory at {uri} was not removed; it is what this agent wrote and it "
                         f"outlives the install")
    return remaining


# How long a removal waits, in all, for a node that has just (re)started to
# settle; how long it watches the folder stay gone each round; the bound on
# one `agent remove`. THE MOST A REMOVAL HOLDS THE NODE LOCK is the settle
# budget, shared by every wait for it, plus REMOVE_ROUNDS times (the remove
# command and one watch), plus one last watch after a restart: 120 + 3 x
# (60 + 30) + 30 = 420 seconds by default, plus a few ten-second pm2 reads.
# That is inside NODE_LOCK_SECONDS (600), so a deploy waiting behind a removal
# gets the lock rather than a refusal.
NODE_SETTLE_SECONDS = int(os.environ.get("DM_NODE_SETTLE_SECONDS", "60"))
NODE_SETTLE_MOST = int(os.environ.get("DM_NODE_SETTLE_MOST", "120"))
REMOVE_VERIFY_SECONDS = int(os.environ.get("DM_REMOVE_VERIFY_SECONDS", "30"))
REMOVE_COMMAND_SECONDS = 60
REMOVE_ROUNDS = 3
REMOVE_POLL = float(os.environ.get("DM_REMOVE_POLL", "2"))


def node_settled(proc, until):
    """Wait until the node process is online and has been up NODE_SETTLE_SECONDS,
    at most until the time `until`. A node that has only just started has its
    roster in memory and may not have read the folder this removal deletes;
    removed under it, the folder is put back. A node pm2 does not hold, or holds
    stopped or errored, serves nothing and has nothing to race, so that is
    answered at once. Returns what was seen."""
    start = time.time()
    while True:
        st = node_proc_state(proc)
        if not st or st.get("status") in ("stopped", "errored"):
            return {"settled": True, "waited_seconds": round(time.time() - start, 1),
                    "node": f"{proc} is {st.get('status') if st else 'not in pm2'}, so it serves nothing"}
        up = (time.time() - st["up_since"]) if st.get("up_since") else None
        if st.get("status") == "online" and up is not None and up >= NODE_SETTLE_SECONDS:
            return {"settled": True, "waited_seconds": round(time.time() - start, 1)}
        if time.time() >= until:
            return {"settled": False, "waited_seconds": round(time.time() - start, 1), "node": st}
        time.sleep(REMOVE_POLL)


def remove_from_node(name, entry, remaining):
    """Take one agent off its node and see that it stays off.

    Under the node lock (no act of this procedure starts or restarts the node
    meanwhile), after the node has settled, `mesh-adapter agent remove`; then
    the folder is watched for REMOVE_VERIFY_SECONDS. A folder that comes back
    is removed again, up to REMOVE_ROUNDS times. A node that restarts in the
    watch (pm2 restarted it, the removal made it, or something outside this
    procedure did) is a reason to settle and look again, not a failure by
    itself: what decides is the folder, looked at last after the node settled.
    Appends to `remaining` what is left, and returns {rounds, verified, said, ...}."""
    root = entry["node_root"]
    user = entry.get("node_user") or NODE_USER
    proc = entry.get("node_proc") or NODE_PROC
    folder = f"{root}/agents/{name}"
    retried = []
    rounds = 0
    with node_lock(f"the removal of {name}"):
        until = time.time() + NODE_SETTLE_MOST
        settle = node_settled(proc, until)
        for rounds in range(1, REMOVE_ROUNDS + 1):
            if rounds == 1 or os.path.exists(folder):
                try:
                    p = subprocess.run(["su", "-", user, "-c",
                                        f"env MESH_ADAPTER_STATE={root} /usr/bin/mesh-adapter agent remove {name}"],
                                       capture_output=True, text=True, timeout=REMOVE_COMMAND_SECONDS)
                    said = (p.stderr or p.stdout).strip()[:200] if p.returncode != 0 else ""
                except subprocess.TimeoutExpired:
                    said = f"agent remove did not return in {REMOVE_COMMAND_SECONDS}s"
                if said and rounds == 1:
                    remaining.append(f"the node did not remove {name}: {said}")
            before = node_proc_state(proc)
            back = restarted = False
            end = time.time() + REMOVE_VERIFY_SECONDS
            while True:
                if os.path.exists(folder):
                    back = True
                    break
                now = node_proc_state(proc)
                if before and now and (now.get("pid") != before.get("pid") or now.get("restarts") != before.get("restarts")):
                    restarted = True
                    break
                if time.time() >= end:
                    break
                time.sleep(REMOVE_POLL)
            if not back and not restarted:
                break
            retried.append({"round": rounds, "folder_came_back": back, "node_restarted": restarted})
            if restarted:
                node_settled(proc, until)
        if retried and retried[-1]["node_restarted"] and rounds == REMOVE_ROUNDS:
            # The rounds ended on a restart, perhaps after the settle budget was
            # spent: one more fixed watch of the folder, so a node that came up
            # holding the agent has the time to put its folder back.
            end = time.time() + REMOVE_VERIFY_SECONDS
            while not os.path.exists(folder) and time.time() < end:
                time.sleep(REMOVE_POLL)
        verified = not os.path.exists(folder)
    said = ""
    if not verified:
        said = (f"{name}'s folder on {proc} came back after {rounds} removals, so the node may still serve it "
                f"({folder})")
        remaining.insert(0, said)
    return {"rounds": rounds, "verified": verified, "said": said, "settle": settle,
            "verify_seconds": REMOVE_VERIFY_SECONDS, **({"retried": retried} if retried else {})}


def remove(name):
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    agents = load_list()
    entry = next((a for a in agents if a["name"] == name), None)
    if not entry:
        contained = next((e for e in load_json_list(CONTAINERS) if e.get("name") == name), None)
        if contained:
            remove_container(name, contained)
        fail("validate", f"{name} is not in the deployment inventory")
    remaining = []
    # The node lock first, before anything is taken down: a removal refused at
    # the lock after its Cloud Run job was gone would say nothing was changed
    # when half of it had been. remove_from_node re-enters it.
    acquire_node_lock(f"the removal of {name}")
    # A PLACED agent is in both inventories: its adapter is here and its work is
    # in a job. Both halves go in one act, because an owner who removed an agent
    # and was left with a Cloud Run job still costing them money did not remove
    # the agent, whatever the record said.
    contained = next((e for e in load_json_list(CONTAINERS) if e.get("name") == name), None)
    if contained:
        remaining += take_down_container(name, contained)
    # Deleted by name either way, so a removal also clears an attendant an
    # earlier install left behind. Only its absence is reported differently: on
    # a host the supervisor holds, this deploy never started one, and naming it
    # under `remaining` would be raising an alarm about the thing working.
    held, _ = supervisor_here()
    # An agent on the node has no adapter process of its own: the node lets
    # go of it (deregister, detach) and its folder goes with it. The node keeps
    # running for the others.
    node_removal = None
    if entry.get("node_root"):
        node_removal = remove_from_node(name, entry, remaining)
    for proc in ([f"{name}-attendant"] if entry.get("node_root") else [f"{name}-adapter", f"{name}-attendant"]):
        p = subprocess.run(["pm2", "delete", proc], capture_output=True, text=True)
        if p.returncode != 0 and entry.get("state") == "running" and not (held and proc.endswith("-attendant")):
            remaining.append(f"pm2 process {proc} not deleted")
    save_list([a for a in agents if a["name"] != name])
    for path in (f"{BRAINS}/{name}.sh", f"{LEDGERS}/{name}.json"):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError:
            remaining.append(f"{path} not removed")
    shutil.rmtree(f"{PREV}/{name}", ignore_errors=True)
    # The placed credentials live only in the home's environment file, which
    # goes with the home; they are named here so the record can say so.
    credentials_removed = list(entry.get("credentials_placed") or [])
    p = subprocess.run(["userdel", "-r", name], capture_output=True, text=True)
    if p.returncode != 0:
        remaining.append(f"user {name} not fully removed: {p.stderr.strip()[:200]}")
        if credentials_removed:
            remaining.append("the placed credentials may remain in the home's environment file")
    remaining.append("mesh credential destroyed with the home directory; "
                     "server-side revocation is not available on this mesh, so the "
                     "credential is dead by deletion, not by revocation")
    # The agent is gone from this host, so the runtime record goes with it.
    # Retracted rather than left saying "removed": the owner's page falls back
    # to what it showed before any of this existed, which is the behaviour every
    # agent without a record already has.
    runtime = forget_runtime(entry.get("agent_key"), removed=True)
    # A node that kept the folder is a removal that did not happen where it
    # matters most, whatever else went: said as a refusal, so nobody reads
    # "removed" over an agent its node still serves.
    still_served = bool(node_removal) and not node_removal["verified"]
    out({"ok": not still_served, "act": "remove", "name": name, "was": entry,
         **({"step": "verify", "error": node_removal["said"],
             "state": f"removed from this host except its folder on {entry.get('node_proc') or NODE_PROC}, which "
                      f"came back; run remove {name} again once the node is steady"} if still_served else {}),
         **({"node_removal": node_removal} if node_removal else {}),
         # The other half of a placed agent, where there was one, so the record
         # of the removal names the job it took down and not only the home.
         **({"work_was": contained} if contained else {}),
         # Where the work was in a customer's project, what this removal did
         # there. A removal is the act they are most entitled to see a list of.
         **cloud_report(),
         "credentials_removed": credentials_removed, "runtime": runtime, "remaining": remaining})


# ── status ────────────────────────────────────────────────────────────────

def status():
    agents = load_list()
    p = subprocess.run(["pm2", "jlist"], capture_output=True, text=True)
    procs = {}
    try:
        for row in json.loads(p.stdout or "[]"):
            procs[row.get("name", "")] = row.get("pm2_env", {}).get("status", "unknown")
    except json.JSONDecodeError:
        pass
    # Whether an absent attendant is a fault or the arrangement. On a host the
    # supervisor holds there is no attendant per agent by design, and a column
    # of "not running" would have every reader of this inventory chasing a
    # process the deploy deliberately did not start.
    held, why = supervisor_here()
    for a in agents:
        # An agent on the node is held by the node process, so that is the
        # process whose state answers for its adapter.
        a["adapter"] = (procs.get(a.get("node_proc") or NODE_PROC, "not running") if a.get("node_root")
                        else procs.get(f"{a['name']}-adapter", "not running"))
        a["attendant"] = procs.get(f"{a['name']}-attendant") or (f"not started: {why}" if held else "not running")
        # What is deployed, answered by rehashing what was placed: every
        # difference is listed, and an agent with no ledger says so.
        d = ledger_drift(a["name"]) if INSTALL else None
        a["drift"] = d if d is not None else "no ledger (deployed before the ledger existed)"
    # The agents whose work runs somewhere else. Their drift is not a rehash of
    # placed files, because there are none on this host: the answer is the image
    # digest the job names, which is reported as it stands and compared against
    # the build record by whoever reads both (12.7.1).
    containers = load_json_list(CONTAINERS)
    for c in containers:
        c["drift"] = "not applicable: the files are layers, and the image digest is the answer"
    out({"ok": True, "act": "status", "agents": agents,
         "containers": containers, "images": load_json_list(IMAGES)})


# ── the running package, for a record of an act that changes no version ──

def running_package(entry, home=None):
    """What an installed agent runs, from its inventory row: the package, its
    version and digest, where it came from, and the agent's key and handle. A
    reconfigure (model, jobs at once, rebind) changes no version, so its record
    names the package already running, and an attest names what it re-hashed.
    The key is read from the agent's own identity file where the row does not
    carry it; nothing is filled in that neither holds."""
    home = home or f"/home/{entry['name']}"
    key = entry.get("agent_key")
    if not key:
        try:
            key = json.load(open(f"{home}/.agentmesh/adapter/identity.json")).get("public_key")
        except Exception:  # noqa: BLE001
            key = None
    return {k: v for k, v in (("package", entry.get("package")), ("version", entry.get("version")),
                              ("sha256", entry.get("sha256")), ("url", entry.get("url")),
                              ("agent_key", key), ("handle", entry.get("handle"))) if v}


def attest(name):
    """Attest what an installed agent runs, without installing anything: the
    package digest the inventory names, its ledger re-hashed (every placed file
    against the digest it was placed with), and, where its work runs in a
    container, the image digest the job runs. For an agent deployed before the
    deploy of every version left a signed record (an update used to leave
    none), so its running version can carry one without being redeployed.

    It changes nothing: no file, no process, no inventory row. A ledger that
    no longer matches is reported as drift and the attest is refused, because
    a record would then name a package that is not what runs."""
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    entry = next((a for a in load_list() if a["name"] == name), None)
    if not entry:
        fail("validate", f"{name} is not in the deployment inventory")
    if entry.get("state", "running") != "running":
        fail("validate", f"{name} is {entry.get('state')}, not running, so there is nothing running to attest")
    pkg = running_package(entry)
    # A row written before rows carried the handle: the name the naming
    # service answers for the key, read and not written back (attest changes
    # nothing).
    if pkg.get("agent_key") and not pkg.get("handle"):
        h = naming_handle(pkg["agent_key"])
        if h:
            pkg["handle"] = h
    if not re.fullmatch(r"[0-9a-f]{64}", str(pkg.get("sha256") or "")):
        fail("validate", f"{name} has no package digest in the inventory, so no record can name one")
    if not pkg.get("agent_key"):
        fail("validate", f"{name} has no identity on this host, so no record can name its key")
    drift = ledger_drift(name)
    if drift is None:
        fail("ledger", f"{name} has no ledger (deployed before the ledger existed), so what runs cannot be re-hashed")
    # The package's own files, and the brain, are what the digest stands for:
    # one of them changed means the package named is not what runs, and no
    # record is made. A file the install wrote beside them (the bound
    # Descriptor, which the adapter may file again, or an environment file) is
    # reported in the record and does not stop it.
    pkg_dir = f"{entry.get('package') or ''}/"
    in_package = [d for d in drift if d["path"].startswith(pkg_dir) or d["path"].startswith(f"{BRAINS}/")]
    if in_package:
        fail("ledger", f"{name} no longer matches its ledger: {len(in_package)} file(s) of the package or its "
                       f"brain differ from what was placed", state="nothing changed", act="attest",
             drift=in_package[:50], **pkg)
    row = next((c for c in load_json_list(CONTAINERS) if c.get("name") == name), None)
    image = row.get("image_digest") if row and row.get("sha256") == pkg["sha256"] else None
    doc = read_ledger(name) or {}
    out({"ok": True, "act": "attest", "name": name, **pkg,
         "host": HOST, "harness": entry.get("harness") or entry.get("framework") or "",
         **({"image_digest": image} if image else {}),
         **({"environment": entry["environment"]} if entry.get("environment") else {}),
         "deployed_at": entry.get("updated_at") or entry.get("deployed_at"),
         "ledger": {"path": f"{LEDGERS}/{name}.json", "sha256": doc.get("sha256"),
                    "files": len(doc.get("files") or []) + len(doc.get("outside") or []),
                    "drift": drift[:50]}})


# ── jobs at once ──────────────────────────────────────────────────────────

def set_jobs_at_once(name, word):
    """How many messages an installed agent may answer at once, changed without
    redeploying it. `word` is a whole number from 1 to JOBS_AT_ONCE_MOST, or
    `default` to take the owner's number off and leave the supervisor's.

    It changes the inventory row and nothing else, and the generated pm2
    config is rewritten with it. The fleet supervisor watches both files and
    rebuilds its roster when either moves, so the new ceiling holds from its
    next job without a restart; a job already running finishes. Nothing is
    restarted here because nothing that runs reads the value: the attendant
    entry is the roster's record, and on a host the supervisor holds no
    attendant is started for this agent."""
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if word == "default":
        n = None
    else:
        n = jobs_at_once_of({"jobs_at_once": int(word) if re.fullmatch(r"[0-9]{1,3}", str(word)) else word})
    agents = load_list()
    entry = next((a for a in agents if a["name"] == name), None)
    if not entry:
        fail("validate", f"{name} is not in the deployment inventory")
    was = entry.get("jobs_at_once")
    apply_jobs_at_once(entry, {"jobs_at_once": n})
    # In place, so the other rows keep their order and the roster reads the
    # same list with one fact changed.
    save_list(agents)
    out({"ok": True, "act": "jobs-at-once", "name": name, "was": was, "now": n, **running_package(entry),
         "written": [LIST, CONF],
         "applies": "the fleet supervisor rebuilds its roster from these files within thirty seconds and holds "
                    "this agent to the new number from its next job; nothing was restarted"})


# ── model ─────────────────────────────────────────────────────────────────

def set_model(name, model, harness=None):
    """The model an installed agent runs, changed without repackaging it.

    Until 2026-09-10 the only way to change an agent's model was an update,
    which demands a new package version, so an agent deployed before the brain
    carried a model at all could not be corrected without a version it did not
    need. This procedure changes the four things the model actually touches:
    the provider key placed in the home, the brain that names the model to the
    harness, the bound descriptor that tells a caller what it runs, and the
    inventory. It installs no files and cannot change what the agent does."""
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    if not MODEL_RE.match(model):
        fail("validate", f"bad model {model!r}")
    agents = load_list()
    entry = next((a for a in agents if a["name"] == name), None)
    if not entry:
        fail("validate", f"{name} is not in the deployment inventory")
    # Agents deployed before the harness was recorded have none in the
    # inventory. The owner states it and it is validated, never guessed from
    # what is on disk.
    harness = harness or entry.get("harness") or entry.get("framework") or ""
    if harness not in HARNESS_CHOICES:
        fail("validate", f"{name} has no recorded harness; name one of {', '.join(HARNESS_CHOICES)}")
    home = f"/home/{name}"
    if not os.path.isdir(home):
        fail("validate", f"{name} has no home at {home}")
    was = entry.get("model")

    # A gateway model is checked against this host's gateway before anything
    # changes (gateway_provider refuses a host that cannot reach one).
    gateway_provider(model)
    secret = place_model_key(name, home, harness, model)
    write_brain(name, harness, model)
    place_gateway_config(name, home, harness, model)

    # The caller-facing record, re-bound so it states the model that runs.
    descriptor = {"absent": "no identity, so nothing to bind"}
    ident_path = f"{home}/.agentmesh/adapter/identity.json"
    if os.path.exists(ident_path):
        ident = json.load(open(ident_path))
        pkg_name = entry.get("package") or ""
        if pkg_name and os.path.isdir(f"{home}/{pkg_name}"):
            descriptor = bind_descriptor(home, pkg_name, name, ident["public_key"],
                                         entry.get("handle"), entry.get("version"),
                                         entry.get("interaction") or "service",
                                         harness, model, sha256=entry.get("sha256"))
    entry["harness"] = harness
    entry["model"] = model
    entry["credential_for_model"] = secret
    entry["model_set_at"] = now_iso()
    if descriptor.get("digest"):
        entry["descriptor"] = descriptor
    save_list([a for a in agents if a["name"] != name] + [entry])
    ledger = reledger_brain(name)

    # THE CONTAINER HALF, where the work runs in a job. Until 2026-09-14 this
    # procedure changed the host half only, so an agent whose work ran on
    # Cloud Run kept thinking with the old model while its descriptor and its
    # inventory named the new one, and the only way to change what the job
    # actually ran was an update with a package version it did not need.
    row = next((r for r in load_json_list(CONTAINERS) if r.get("name") == name), None)
    container = set_container_model(name, model, row) if row else None

    # The processes this host starts for this agent, and no others: pm2 refuses
    # to restart a name it does not hold, and on a host the supervisor holds,
    # the attendant is such a name. Naming it would turn a model change into a
    # procedure that fails at its last step having already done everything.
    procs, _, _ = agent_procs(name)
    # Under the node lock, for the restart and the check after it (node_lock).
    with node_lock(f"the model change of {name}"):
        # With DM_NODE_RELOAD on, the agent is reloaded on its running node,
        # which re-registers it with the descriptor that names the new model,
        # and no other agent on the node is restarted for it.
        node, _ = reload_target(name, procs)
        said = reload_on_node(name, node) if node else None
        processes = {"started": [], "reloaded": said} if said and reload_reached(said) else {"started": procs}
        if not processes.get("reloaded"):
            run(["pm2", "restart", *procs], "pm2", 90)
        # The check is of the side that thinks: the host's brain where the work
        # runs here, and one message through the job where it runs in a container.
        smoke = container["check"] if container else check_served(name, processes)
    # The runtime record names the model the agent runs, so this act changes
    # something an owner reads and has to re-state it. Where the work runs is
    # untouched, and the helper reads that off the inventories.
    runtime = publish_runtime_for(name)
    out({"ok": True, "act": "model", "name": name, "was": was, "now": model, **running_package(entry, home),
         "harness": harness, "credential": secret, "descriptor": descriptor,
         "ledger": ledger, "runtime": runtime, "check": smoke,
         **({"container": container} if container else {})})


def set_container_model(name, model, row):
    """The model a container agent's job wakes, changed on the job itself.

    The job carries the model and the key the same way a host carries them
    (image.job_env): AGENT_MODEL as a variable, and the provider's key as a
    secret reference Cloud Run resolves at start. So a model change is an
    update of those two on the job, the old provider's reference taken off
    when the provider changed, so no job carries a credential nobody uses.
    Nothing is rebuilt: the image has the harness, and which model the
    harness wakes was never in a layer (12.6 rule 3). The container row is
    rewritten to say what the job now runs, and one message goes through it."""
    if row.get("cloud"):
        fail("validate", f"{name}'s job runs in a customer's project; change its model through an update, "
                         "which acts there under their grant")
    if not (row.get("job") and row.get("region")):
        fail("validate", f"{name}'s container row names no job and region, so there is nothing to change")
    prov = provider_of(model)
    if not prov:
        fail("bind", f"the model {model} names no provider this host lends a key for. Name a model as "
                     f"<provider>/<model>, with the provider one of {', '.join(sorted(PROVIDERS))}.")
    key_env, _, secret = PROVIDERS[prov]
    if secret and not store_has(secret):
        fail("bind", f"the model names {prov} and the store holds no credential called {secret}; place it there "
                     f"and name it")
    was = row.get("model")
    was_prov = provider_of(was)
    changed = bool(was_prov and was_prov != prov)
    # What the old provider put on the job and the new one does not: its key
    # reference, or a keyless provider's location variables.
    removed = PROVIDERS[was_prov][0] if changed else None
    # The gateway's MODEL_ENDPOINT and MODEL_PROTOCOL are never taken off: a
    # package's own model system may have placed the same two names.
    unset = sorted(set(keyless_vars(was_prov)) - set(keyless_vars(prov))
                   - set(keyless_vars(GATEWAY_PROVIDER))) if changed else []
    here = {IMAGE.MODEL_VAR: model, **keyless_vars(prov)}
    if prov == GATEWAY_PROVIDER:
        # The job's own gateway, started where MODEL_ENDPOINT is on loopback.
        here.update(model_gateway_env({}, {"systems": []}, keyless_vars(prov)))
    spec = {"job": row["job"], "region": row["region"], "project": row.get("project") or PROJECT,
            "job_seconds": row.get("job_seconds") or 240}
    gcloud(["run", "jobs", "update", spec["job"], "--region", spec["region"],
            *(["--project", spec["project"]] if spec.get("project") else []),
            "--update-env-vars=" + ",".join(f"{k}={v}" for k, v in here.items()),
            *([f"--update-secrets={key_env}={secret}:latest"] if secret else []),
            *([f"--remove-secrets={removed}"] if removed else []),
            *([f"--remove-env-vars={','.join(unset)}"] if unset else []),
            "--quiet", "--format", "value(metadata.name)"], "job", 600)
    row = {**row, "model": model, "secret_placed": secret, "model_set_at": now_iso(),
           "model_placed": {"model": model, "variable": IMAGE.MODEL_VAR}}
    # The names this side placed on the job change with the provider, and the
    # next update reads them to tell ours from an operator's (2026-09-23).
    if isinstance(row.get("job_vars_placed"), list):
        row["job_vars_placed"] = sorted((set(row["job_vars_placed"]) - {removed} - set(unset))
                                        | set(here) | ({key_env} if key_env else set()))
    with inventory_lock():
        save_json_list(CONTAINERS, [r for r in load_json_list(CONTAINERS) if r.get("name") != name] + [row])
    check = probe_container(name, spec, row.get("bucket") or BUCKET)
    return {"job": spec["job"], "region": spec["region"], "was": was, "now": model,
            "secret": secret, **({"removed": removed} if removed else {}), "check": check}


def rebind(name):
    """Bind an installed agent's descriptor again from its own package, as the
    install did: same subject, same version, same model. Installs nothing
    else. For a descriptor that was replaced after the install (2026-09-23:
    the platform's one-sentence draft over five agents' bound descriptors).
    It also gives the row the name the naming service answers for the key,
    for an agent named again after a move (follow_handle)."""
    if not NAME_RE.match(name):
        fail("validate", f"bad agent name {name!r}")
    entry = next((a for a in load_list() if a["name"] == name), None)
    if not entry:
        fail("validate", f"{name} is not in the deployment inventory")
    home = f"/home/{name}"
    ident_path = f"{home}/.agentmesh/adapter/identity.json"
    pkg_name = entry.get("package") or ""
    if not (os.path.exists(ident_path) and pkg_name and os.path.isdir(f"{home}/{pkg_name}")):
        fail("validate", f"{name} has no identity or no installed package to bind from")
    ident = json.load(open(ident_path))
    # The name the naming service answers for this key now. An agent moved to
    # another account is named again under the account it went to (the rename
    # batch, services agent-moves.ts), and the inventory row, which the
    # supervisor hands the agent as its own name, follows here, recorded.
    handle_change = follow_handle(name, ident["public_key"])
    if handle_change:
        entry["handle"] = handle_change["to"]
    harness = entry.get("harness") or entry.get("framework") or ""
    descriptor = bind_descriptor(home, pkg_name, name, ident["public_key"], entry.get("handle"),
                                 entry.get("version"), entry.get("interaction") or "service",
                                 harness, entry.get("model"), sha256=entry.get("sha256"))
    out({"ok": "absent" not in descriptor, "act": "rebind", "name": name, "descriptor": descriptor,
         **running_package(entry, home),
         **({"handle": handle_change} if handle_change else {})})


NAMING_URL = _am_env("urls.naming", "DM_NAMING_URL")


def follow_handle(name, key):
    """Give the inventory row of `name` the handle the naming service answers
    for `key`, when that differs. Returns {from, to} for a change, else None.
    No answer changes nothing."""
    named = naming_handle(key)
    agents = load_list()
    row = next((a for a in agents if a["name"] == name), None)
    if not named or row is None or row.get("agent_key") not in (None, key) or row.get("handle") == named:
        return None
    change = {"from": row.get("handle"), "to": named}
    row["handle"] = named
    row["handle_changed_at"] = now_iso()
    save_list(agents)
    return change


def naming_handle(key):
    """The handle the naming service answers for an agent key, or None when it
    answers nothing or cannot be reached (then the inventory is left as it is)."""
    try:
        with urllib.request.urlopen(f"{NAMING_URL}/api/resolve?agent_id={key}", timeout=15) as r:
            doc = json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 — no answer is not a change
        return None
    h = (doc.get("card") or {}).get("handle") or doc.get("handle")
    return h.strip() if isinstance(h, str) and h.strip() else None


def reledger_brain(name):
    """The brain is the only placed file this procedure rewrites, so only its
    digest is recomputed. An agent with no ledger keeps none."""
    doc = read_ledger(name)
    if not doc:
        return {"absent": "no ledger (deployed before the ledger existed)"}
    outside = INSTALL.ledger(BRAINS, [f"{name}.sh"])
    doc["outside"] = [{**e, "path": f"{BRAINS}/{e['path']}"} for e in outside]
    doc["written_at"] = now_iso()
    doc["sha256"] = INSTALL.ledger_digest(doc["files"] + doc["outside"])
    path = f"{LEDGERS}/{name}.json"
    with open(path + ".tmp", "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(path + ".tmp", path)
    os.chmod(path, 0o644)
    return {"path": path, "files": len(doc["files"]) + len(doc["outside"]), "sha256": doc["sha256"]}


# The procedures that put files on THIS host, start processes on it, or delete
# a user from it. They are the ones the sudoers line covers and the ones that
# refuse to run any other way. `image` and `container` are not here because
# neither touches this host: one writes a build context to a temp directory and
# hands it to a builder, the other writes to a bucket and asks a platform for a
# job. Giving them root would be power nothing in them uses.
# `runtime` is here for one reason: the bearer it posts with is a root-owned
# file in the fleet's secret store. It makes and unmakes nothing.
# ── a batched landing (deploy-executor.py with DM_LAND_BATCH on) ─────────
#
# The executor used to run each approved deploy or update whole, one after the
# other, and each one restarted its agent's node for itself. With batching on,
# the same procedure runs as three acts, so several agents land behind one
# restart of their node:
#
#   prepare <deploy|update> <argfile>  steps 1 and 2 (deploy_prepare and
#                                      update_prepare): the checks and the
#                                      fetch. It touches no node, so the
#                                      executor runs several side by side.
#   land <state> [<state> ...]         under the node lock, once for the lot:
#                                      each agent placed in a process of its
#                                      own (place), so a refusal stops that
#                                      agent and no other; then one start of
#                                      each node, a smoke check of each agent,
#                                      the full watch once and a short probe
#                                      of every other agent.
#   finish <state>                     the rest of each act, side by side: the
#                                      image and the job where the work runs in
#                                      Cloud Run, and the one answer the whole
#                                      act always printed, success or refusal,
#                                      with the same members.
#
# What the next act needs is kept between them in a state file under STATES,
# which only root can write: it names a package that was already verified, so
# it must not be something the brain could swap. A deploy into a customer's own
# project (an instruction with a `cloud` grant) never runs this way.

STATES = os.environ.get("DM_STATES", f"{FLEET}/deploymgr-states")
# How long each agent after the first is watched in a batched landing. The
# first agent gets the full WATCH_SECONDS; every other one gets this, which is
# enough for its own probe and three neighbours' (guard.mjs watch).
LAND_PROBE_SECONDS = int(os.environ.get("DM_LAND_PROBE_SECONDS", "10"))
# The longest one agent's placement may take inside a landing.
PLACE_SECONDS = int(os.environ.get("DM_PLACE_SECONDS", "900"))


def state_path_for(argfile):
    return os.path.join(STATES, os.path.basename(argfile))


def write_state(path, ctx):
    """Keep what the next act needs. The package facts are left out and read
    again from the verified package folder (with_package)."""
    os.makedirs(STATES, mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in ctx.items() if k != "pkg"}, f)
    os.replace(tmp, path)


def load_state(path):
    """(state, None), or (None, why) when the file is not a landing state."""
    real = os.path.realpath(path)
    if not (real.startswith(os.path.realpath(STATES) + os.sep) and real.endswith(".json")):
        return None, f"{path} is not a landing state under {STATES}"
    try:
        with open(real, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        return None, f"the landing state {path} could not be read: {e}"
    if not (isinstance(doc, dict) and doc.get("act") in ("deploy", "update") and doc.get("name")):
        return None, f"the landing state {path} names no deploy or update"
    return doc, None


def read_state(path):
    doc, why = load_state(path)
    if doc is None:
        fail("validate", why)
    return doc


def with_package(ctx):
    """The package facts, read again from the folder the prepare verified."""
    if INSTALL is None:
        fail("verify", "the installer module is missing beside steps.py; a package cannot be verified without it")
    if not os.path.isdir(ctx.get("pkg_dir") or ""):
        fail("verify", f"the verified package is no longer at {ctx.get('pkg_dir')}")
    ctx["pkg"] = INSTALL.read_package(ctx["pkg_dir"])
    return ctx


def prepare(verb, argfile):
    """The first act of a batched deploy or update."""
    if verb not in ("deploy", "update"):
        fail("usage", "prepare deploy <argfile> | prepare update <argfile>")
    if not argfile.startswith(f"{DM_HOME}/tmp/"):
        fail("validate", "argfile outside the deploymgr tmp dir")
    with open(argfile, encoding="utf-8") as f:
        grant = json.load(f).get("cloud")
    if grant:
        fail("validate", "an instruction for a customer's own project runs whole (deploy or update), never in a "
                         "batched landing; nothing was done")
    ctx = deploy_prepare(argfile) if verb == "deploy" else update_prepare(argfile)
    path = state_path_for(argfile)
    write_state(path, ctx)
    out({"ok": True, "act": "prepare", "phase": "prepared", "verb": verb, "name": ctx["name"],
         "node": ctx["holder"]["proc"], "state": path})


def place(path):
    """One agent's placement inside a landing, under the lock the landing
    handed down. A refusal here is that act's answer, printed as always."""
    take_handed_node_lock()
    ctx = with_package(read_state(path))
    also = os.environ.get("DM_ALSO_ADDING", "")
    also = int(also) if also.isdigit() else 0
    if ctx["act"] == "deploy":
        deploy_place(ctx, also_adding=also)
    else:
        update_place(ctx, also_adding=also)
    ctx["phase"] = "placed"
    write_state(path, ctx)
    out({"ok": True, "act": "place", "phase": "placed", "name": ctx["name"]})


def run_placement(path, ctx, fd, also):
    """Run place for one state in a process of its own, handing it the lock.
    Returns its one answer, or a refusal that says it gave none."""
    env = {**os.environ, "DM_ALSO_ADDING": str(also)}
    if fd is not None:
        env[NODE_LOCK_FD_VAR] = str(fd)
    if ctx["act"] == "deploy":
        left = f"the user and home may exist; run remove {ctx['name']} to clean"
    else:
        left = (f"{ctx['entry'].get('version')} may be partly replaced by {ctx.get('pkg_version')}; "
                f"its snapshot is in {PREV}/{ctx['name']}")
    try:
        p = subprocess.run([sys.executable or "python3", os.path.abspath(__file__), "place", path],
                           capture_output=True, text=True, timeout=PLACE_SECONDS, env=env,
                           **({"pass_fds": (fd,)} if fd is not None else {}))
        lines = [ln for ln in (p.stdout or "").strip().splitlines() if ln.strip().startswith("{")]
        if lines:
            return json.loads(lines[-1])
        return {"ok": False, "step": "place", "error": f"the placement gave no answer: {(p.stderr or '')[-400:]}",
                "state": left}
    except subprocess.TimeoutExpired:
        return {"ok": False, "step": "place", "error": f"the placement did not finish within {PLACE_SECONDS}s",
                "state": left}
    except (OSError, ValueError) as e:
        return {"ok": False, "step": "place", "error": f"the placement could not be run: {str(e)[:300]}",
                "state": left}


def land(paths):
    """The second act: place each agent, then start each node once, smoke
    check every agent, and watch. Each agent's outcome goes into its own
    state, for its finish to print."""
    loaded = []
    for p in paths:
        ctx, why = load_state(p)
        if ctx is not None:
            loaded.append((p, ctx))
    if not loaded:
        fail("validate", "no landing state to land")
    acquire_node_lock(f"the landing of {', '.join(c['name'] for _, c in loaded)}")
    fd = _NODE_LOCK["fd"]
    said, placed, joining = {}, [], {}
    for p, ctx in loaded:
        root = (ctx.get("holder") or {}).get("root")
        answer = run_placement(p, ctx, fd, joining.get(root, 0) if root else 0)
        after, _why = load_state(p)
        if answer.get("ok") and answer.get("phase") == "placed" and after and after.get("phase") == "placed":
            placed.append((p, after))
            said[ctx["name"]] = "placed"
            if after["act"] == "deploy" and root:
                joining[root] = joining.get(root, 0) + 1
        else:
            ctx["outcome"] = answer
            write_state(p, ctx)
            said[ctx["name"]] = f"refused at {answer.get('step', '?')}"
    groups = {}
    for p, ctx in placed:
        groups.setdefault(ctx["holder"]["proc"], []).append((p, ctx))
    for group in groups.values():
        try:
            land_on_node(group)
        except Exception as e:  # noqa: BLE001 - each agent still gets an answer from its finish
            for p, ctx in group:
                if not ctx.get("landing"):
                    ctx["land_error"] = f"the landing stopped: {repr(e)[:300]}"
                    write_state(p, ctx)
        for p, ctx in group:
            lg = ctx.get("landing") or {}
            said[ctx["name"]] = ("rolled back" if lg.get("rolled_back") else "smoke check failed" if lg.get("check_failed")
                                 else f"refused at {lg['failed']['step']}" if lg.get("failed")
                                 else "landed" if lg else "not finished")
    out({"ok": True, "act": "land", "agents": said})


def land_on_node(group):
    """One node's share of a landing: every agent in `group` is placed on the
    node that `holder` names. One start of the node, a smoke check of each
    agent, then the watch: the full one for the first agent and a short one
    for each other, every one against the mark taken before the start. With
    DM_NODE_RELOAD on, each agent is reloaded on the running node instead and
    the node is started only for agents it could not reload."""
    holder = group[0][1]["holder"]
    names = [c["name"] for _, c in group]
    before = watch_mark(holder)
    for _, c in group:
        if c["act"] == "update":
            # As an update alone does: deleted, then started (update()).
            for proc in (f"{c['name']}-adapter", f"{c['name']}-attendant"):
                subprocess.run(["pm2", "delete", proc], capture_output=True, text=True)
    procs_of = {n: agent_procs(n) for n in names}
    # With DM_NODE_RELOAD on, each agent its running node can reload is
    # reloaded there, one after another, and the node is not started for it.
    # Only the rest are started, behind one start as before. With it off,
    # nothing here is reloaded and the start is the one it always was.
    reloaded, reload_why = {}, {}
    if node_reload_on():
        for n in names:
            node, why_not = reload_target(n, procs_of[n][0])
            if node:
                said = reload_on_node(n, node)
                if reload_reached(said):
                    reloaded[n] = said
                    continue
                why_not = f"{node['proc']} could not be told to reload {n} ({said.get('code')}: {said.get('error')}), so it was started"
            reload_why[n] = why_not
    every = []
    for n in names:
        if n not in reloaded:
            every += [p for p in procs_of[n][0] if p not in every]
    # Whether anything restarted the node on purpose since the mark: the watch
    # allows that one restart, and none when every agent was reloaded.
    node_started = bool(every)
    if every:
        cmd = ["pm2", "start", CONF, "--only", ",".join(every)]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            bad = None if p.returncode == 0 else (p.stderr or p.stdout or "nonzero exit").strip()[:400]
        except subprocess.TimeoutExpired:
            bad = f"timed out after 90s: {' '.join(cmd[:4])}"
        if bad:
            for path, c in group:
                if c["name"] in reloaded:
                    continue  # already served by its node; it lands with the rest
                c["landing"] = {"failed": {"step": "pm2", "error": bad}}
                write_state(path, c)
            group = [(p, c) for p, c in group if c["name"] in reloaded]
            if not group:
                return
            names = [c["name"] for _, c in group]
    attendant_of = {n: f"not started: {procs_of[n][2]}" if procs_of[n][1] else f"started: {procs_of[n][2]}" for n in names}
    processes = {n: ({"started": [], "attendant": attendant_of[n], "reloaded": reloaded[n]} if n in reloaded else
                     {"started": procs_of[n][0], "attendant": attendant_of[n],
                      **({"reload": f"not used: {reload_why[n]}"} if node_reload_on() else {})})
                 for n in names}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=len(group)) as pool:
        smokes = dict(zip(names, pool.map(lambda c: check_served(c["name"], processes[c["name"]],
                                                                 ask_model=not c.get("reinstall")),
                                          [c for _, c in group])))
    together = {n: [m for m in names if m != n] for n in names}
    # An update whose smoke check failed gets its old version back before
    # anything is watched, as it does alone, and the node is started again
    # once for all of them (a reloaded one is reloaded on its old files); the
    # watch below then counts from that start.
    failed = [(p, c) for p, c in group if c["act"] == "update" and not smokes[c["name"]]["passed"]]
    for p, c in failed:
        restore(c["name"], c["home"], c["old_ledger"], c["prev"], c["pkg_name"])
        c["landing"] = {"processes": processes[c["name"]], "smoke": smokes[c["name"]], "check_failed": True}
    if failed:
        before = watch_mark(holder)
        again = []
        for _, c in failed:
            if processes[c["name"]].get("reloaded"):
                if not serve_again(c["name"], processes[c["name"]]).startswith("reloaded"):
                    node_started = True
                continue
            again += [p for p in processes[c["name"]]["started"] if p not in again]
        if again:
            subprocess.run(["pm2", "restart", *again], capture_output=True)
            node_started = True
        for p, c in failed:
            write_state(p, c)
    # The work of each new agent whose smoke check passed is begun now, in a
    # process of its own, and placed while the node is watched (start_work).
    # Its finish waits for it, and takes it down if the watch takes the agent
    # back out.
    for _, c in group:
        if c["act"] == "deploy" and not c.get("landing"):
            c["work"] = start_work_if_wanted(c, smokes[c["name"]], arm=False)
    live = [(p, c) for p, c in group if not c.get("landing")]
    for i, (p, c) in enumerate(live):
        if c.get("landing"):
            continue  # taken back out with the first agent's watch
        n = c["name"]
        watched = watch_after(n, holder, before, seconds=None if i == 0 else LAND_PROBE_SECONDS,
                              restarts_allowed=None if node_started else 0)
        c["landing"] = {"processes": processes[n], "smoke": smokes[n], "watched": watched,
                        **({"with": together[n]} if together[n] else {})}
        if not watched.get("ok"):
            # The first watch is the node's: if it fails, nobody can say which
            # agent did it, so every agent still in this landing goes back out.
            # A later probe names one agent, and only that one goes.
            out_now = [(q, d) for q, d in live[i:] if d is c or not d.get("landing")] if i == 0 else [(p, c)]
            for q, d in out_now:
                if d is not c:
                    d["landing"] = {"processes": processes[d["name"]], "smoke": smokes[d["name"]], "watched": watched,
                                    **({"with": together[d["name"]]} if together[d["name"]] else {})}
            take_back(out_now, holder, processes)
            before = watch_mark(holder)
    for p, c in live:
        write_state(p, c)


def take_back(items, holder, processes):
    """Take agents of a landing back out after a failed watch, as each would
    be taken out alone: a new agent paused on its node, an update's old version
    restored; then the node started once without them and its neighbours
    watched (recovered)."""
    whats = {}
    for _, c in items:
        if c["act"] == "deploy":
            whats[c["name"]] = pause_new_agent(c["name"], holder)
        else:
            restore(c["name"], c["home"], c["old_ledger"], c["prev"], c["pkg_name"])
            if processes[c["name"]].get("reloaded"):
                # Reloaded on its old files; the recovery below then restarts
                # the node only if its other agents do not stay well.
                whats[c["name"]] = (f"{c['entry'].get('version')} was restored from the snapshot and "
                                    f"{serve_again(c['name'], processes[c['name']])}")
            else:
                whats[c["name"]] = f"{c['entry'].get('version')} was restored from the snapshot and restarted"
    if holder.get("root"):
        recovery = recovered(holder, restart=True)
    else:
        for _, c in items:
            if c["act"] == "update":
                subprocess.run(["pm2", "restart", *processes[c["name"]]["started"]], capture_output=True)
        recovery = recovered(holder, restart=False)
    for _, c in items:
        c["landing"]["rolled_back"] = {"what": whats[c["name"]], "recovery": recovery}


def finish(path):
    """The third act: the answer the whole deploy or update always printed."""
    ctx = read_state(path)
    try:
        os.remove(path)
    except OSError:
        pass
    if ctx.get("outcome"):
        out(ctx["outcome"])
    name, act = ctx["name"], ctx["act"]
    if ctx.get("phase") != "placed":
        fail("land", f"{name} was prepared and never placed: {ctx.get('land_error') or 'its landing never reached it'}")
    landing = ctx.get("landing")
    if act == "deploy":
        # The row fail() marks, exactly as when the deploy runs whole.
        CURRENT["entry"] = ctx["entry"]
        # Work begun during the watch is taken down by any refusal below, and
        # waited for by deploy_finish (start_work).
        if ctx.get("work"):
            CURRENT["on_fail"] = lambda step: take_down_work(name, ctx["work"])
    if not landing:
        why = ctx.get("land_error") or "the landing gave no answer for it"
        if act == "deploy":
            fail("land", f"{name} was placed and its landing stopped before it was started and watched: {why}")
        restore(name, ctx["home"], ctx["old_ledger"], ctx["prev"], ctx["pkg_name"])
        fail("land", f"{name} {ctx['pkg_version']} was placed and its landing stopped before it was started and "
                     f"watched: {why}", state=f"{ctx['entry'].get('version')} was restored from the snapshot; its "
                                          f"processes were not restarted", act="update", restored=True, name=name)
    if landing.get("failed"):
        fail(landing["failed"]["step"], landing["failed"]["error"])
    processes, smoke, watched = landing["processes"], landing["smoke"], landing.get("watched")
    with_others = f" (it landed in one start of the node with {', '.join(landing['with'])})" if landing.get("with") else ""
    rb = landing.get("rolled_back")
    if act == "deploy":
        if rb:
            fail("watch", watch_failure(f"{name} was placed", watched) + with_others,
                 state=rolled_back_state(rb["what"], rb["recovery"]), rolled_back=True, name=name, watch=watched,
                 recovery=rb["recovery"], act="deploy", package=ctx["pkg_name"], version=ctx["pkg_version"],
                 host=HOST, agent_key=ctx["agent_key"], handle=ctx["handle"], capacity=ctx["capacity"], smoke=smoke)
        ctx.update(processes=processes, smoke=smoke, watched=watched)
        deploy_finish(ctx)
    shutil.rmtree(ctx["staging"], ignore_errors=True)
    common = update_common(ctx, processes, smoke)
    old = ctx["entry"].get("version")
    if landing.get("check_failed"):
        fail("check", f"the smoke check failed on {ctx['pkg_version']}; {old} was restored from the snapshot",
             state=f"restored to {old}; processes restarted", act="update", restored=True, **common)
    if rb:
        fail("watch", watch_failure(f"{name} {ctx['pkg_version']} was placed", watched) + with_others,
             state=rolled_back_state(rb["what"], rb["recovery"]), act="update", restored=True, rolled_back=True,
             recovery=rb["recovery"], **{**common, "watch": watched})
    common["watch"] = watched
    update_finish(ctx, common)


AS_ROOT = ("deploy", "update", "alongside", "retire-version", "remove", "model", "status", "runtime", "jobs-at-once",
           "attest", "prepare", "land", "place", "finish", "work")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd in AS_ROOT:
        if pwd is None or getattr(os, "geteuid", None) is None:
            fail("preflight", "this procedure makes and unmakes unix users, and this is not a POSIX host")
        if os.geteuid() != 0:
            fail("preflight", "must run as root (via the sudoers entry)")
    if cmd == "deploy" and len(sys.argv) == 3:
        deploy(sys.argv[2])
    elif cmd == "update" and len(sys.argv) == 3:
        update(sys.argv[2])
    elif cmd == "alongside" and len(sys.argv) == 3:
        alongside(sys.argv[2])
    elif cmd == "retire-version" and len(sys.argv) == 3:
        retire_version(sys.argv[2])
    elif cmd == "image" and len(sys.argv) == 3:
        build_image(sys.argv[2])
    elif cmd == "container" and len(sys.argv) == 3:
        container(sys.argv[2])
    elif cmd == "remove" and len(sys.argv) == 3:
        remove(sys.argv[2])
    elif cmd == "model" and len(sys.argv) in (4, 5):
        set_model(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) == 5 else None)
    elif cmd == "status" and len(sys.argv) == 2:
        status()
    elif cmd == "runtime" and len(sys.argv) == 3:
        # State where one agent's work runs, without deploying anything. Every
        # agent installed before this record existed has none, and a post that
        # failed while the control plane was down has one on disk and nowhere
        # else; this is how both are settled, by hand, for one agent at a time.
        if not NAME_RE.match(sys.argv[2]):
            fail("validate", f"bad agent name {sys.argv[2]!r}")
        out({"ok": True, "act": "runtime", "name": sys.argv[2],
             "runtime": publish_runtime_for(sys.argv[2])})
    elif cmd == "attest" and len(sys.argv) == 3:
        attest(sys.argv[2])
    elif cmd == "rebind" and len(sys.argv) == 3:
        rebind(sys.argv[2])
    elif cmd == "jobs-at-once" and len(sys.argv) == 4:
        set_jobs_at_once(sys.argv[2], sys.argv[3])
    elif cmd == "prepare" and len(sys.argv) == 4:
        prepare(sys.argv[2], sys.argv[3])
    elif cmd == "land" and len(sys.argv) >= 3:
        land(sys.argv[2:])
    elif cmd == "place" and len(sys.argv) == 3:
        place(sys.argv[2])
    elif cmd == "finish" and len(sys.argv) == 3:
        finish(sys.argv[2])
    elif cmd == "work" and len(sys.argv) == 3:
        work(sys.argv[2])
    else:
        fail("usage", "deploy <argfile> | update <argfile> | alongside <argfile> | retire-version <argfile> | "
                      "image <argfile> | container <argfile> | "
                      "model <name> <model> [harness] | jobs-at-once <name> <n|default> | remove <name> | "
                      "runtime <name> | rebind <name> | attest <name> | status | "
                      "prepare <deploy|update> <argfile> | land <state> ... | finish <state>")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — every failure must come out as JSON
        fail("unexpected", repr(e))
