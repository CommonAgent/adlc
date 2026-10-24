#!/usr/bin/env python3
"""The image half of the install, as plain functions.

The install procedure in install.py assumes the installer reaches the machine:
it makes a home there, puts files in it, and can rehash them afterwards. An
owner may instead run the agent on compute the installer never touches, and
the Common Agent Specification 12.7.1 says the procedure does not become
optional when that happens: it SPLITS. Everything that happens before a
running machine is involved becomes an image, and the installer records its
digest in a BUILD record, because building an image deploys nothing. The side
that starts the agent produces the one deployment record and names the digest
of the image it started.

This file is the reading, planning and argument-building half of both sides,
with no root, no network and no side effect. steps.py runs the two procedures
(`image` and `container`) and stops at the first refusal.

What lives here:
  - what a build record says about the package it was built from (8.2);
  - the three files a container is given at run time, which carry the owner's
    numbers and addresses and so may not be baked (12.6 rule 3);
  - where each directory the install file declares is bound, which is on the
    mount and never in the image (12.7.1);
  - the gcloud argument vectors for creating the job, for executing it once as
    a check, and for reading back the image the job actually names.

WHY THE BINDING IS MOUNTED AND NOT BAKED. An image is built once and copied
everywhere, so anything in a layer is bound for every agent ever run from it.
The ceiling numbers, the mcp addresses and every credential are the owner's,
per install, and 12.6 rule 3 keeps all three out of a package and therefore
out of anything emitted from one. The entrypoint reads them from the directory
in AGENT_BINDING_DIR and refuses before any work runs when one is missing.

WHY THE DIRECTORIES ARE BOUND AT START AND NOT MADE AT BUILD. A container
keeps nothing between messages: its filesystem is made fresh for every
execution. 12.7.1 binds each directory system to storage that outlives a single
run, and an image's own filesystem is not that. A records directory baked into
the image was worse than none, because it looked like one: the process runner
writes each run under records/runs/<run id>/ and rebuilds the run from it on
the next message, so every execution started with an empty directory and the
second message of a conversation found no run and answered as though the first
had never happened. The job carries one variable per declared directory,
pointing at a folder per agent on the mount, and the entrypoint makes each one
before any work runs.

Deployed beside steps.py as /opt/fleet/deploymgr-image.py.
"""
import json
import os
import re

# The mount both sides of the container path already agree on: the bucket at
# /mesh, which is where the first proven Cloud Run execution mounted it and
# what runtime/fleet's CONTAINER_MOUNT defaults to. One name in two files
# would drift; this one is stated here and passed to the job.
MOUNT_NAME = "state"
CONTAINER_MOUNT = "/mesh"
# Where the binding for one agent sits under the mount. It is a directory per
# agent because one bucket serves the whole fleet and two agents' ceilings are
# not the same numbers.
BINDINGS_PREFIX = "bindings"
# Where the directories the install file declares sit under the mount, one
# folder per agent. 12.7.1 binds each directory system to storage that outlives a
# single run, and a container's own filesystem outlives nothing: it is made
# fresh for every message. Per agent for the same reason the binding is: one
# bucket serves the whole fleet and two agents' records are not one agent's.
# The same path on every execution, because the job carries the variable and
# every execution of a job carries what the job carries, which is what lets a
# second message find the run the first one started.
STATE_PREFIX = "state"
# The image's own default, which the job overrides so the binding can be a
# mount rather than a layer. one-message.mjs reads AGENT_BINDING_DIR.
BINDING_DIR_VAR = "AGENT_BINDING_DIR"
# Which model the container's harness wakes. The harness script in the base
# image reads it, the way the brain script on a host reads the model the
# deployment manager wrote into it. Not in the image: an image is built once
# and copied everywhere, and the model is one owner's instruction.
MODEL_VAR = "AGENT_MODEL"

# A container image reference that names a DIGEST. A tag moves, and a
# deployment record that named a tag would be saying nothing about what it
# started: 12.7.1 requires the digest of the image it started and never one it
# was handed for an image it did not start.
DIGEST_REF_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,200}@sha256:[0-9a-f]{64}$")
TAG_REF_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,200}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$")
# How much machine one message gets, when the owner's instruction says. Left
# out of the job when it does not, so a container that ran on the platform's
# default keeps running on it and nothing is resized behind anyone's back.
MEMORY_RE = re.compile(r"^[0-9]{1,5}(Mi|Gi)$")
CPU_RE = re.compile(r"^(?:[0-9]{1,2}|[0-9]{2,5}m)$")
REGION_RE = re.compile(r"^[a-z]+-[a-z]+[0-9]$")
PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
REGISTRY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*(?:\.[a-z0-9._-]+)*(?:/[a-z0-9][a-z0-9._-]*)*$")


def binary_var(name):
    return "BINARY_" + re.sub(r"[^A-Z0-9]", "_", name.upper())


def directory_var(name):
    """The variable the job names a directory system in, spelled the way the
    entrypoint reads it. Not AGENT_DIR_<NAME>: AGENT_DIR is already the
    directory the image build put the entrypoint in, and two names a grep
    cannot tell apart is how the wrong one gets read."""
    return "AGENT_DIRECTORY_" + re.sub(r"[^A-Z0-9]", "_", name.upper())


def wakes_a_model(install):
    """Whether a container of this package will ever wake a model, which is
    the same question as whether the deploy has to give it one.

    Two ways it will. A package that names no command for its job (12.3 `run`)
    has nothing else to run: its work is a model reading and writing, and
    explainer-critic is that package. And a package that names one AND can say
    the turn needs judgment runs the command first and wakes the model when it
    says so, so the model and its key have to be there for the message that
    says it and not only for the ones that do not.

    Read off the install file, which is the same file the emitter reads to
    pick a base with a harness in it and the same one the entrypoint reads to
    decide which of the two to do. A deploy that answered this differently
    from the image would be a container carrying a key it never uses, or a
    harness with no key, and the second reads to a sender as an agent that had
    nothing to say."""
    runs = (install or {}).get("run") or {}
    if not runs:
        return True
    return any(bool((spec or {}).get("escalate_when")) for spec in runs.values())


def needs_model_key(install):
    """Whether the deploy has to give a container a model and its key.

    A package that wakes a model does (wakes_a_model). So does one whose
    scripts call a model themselves, which a job says with `calls_model: true`
    in its run entry: the explainer writers name a command for every job and
    never escalate, so wakes_a_model said no, the deploy gave them no key, and
    every job refused with "GOOGLE_GENERATIVE_AI_API_KEY is absent"
    (2026-09-23). Such a package gets the key and the model name and no
    harness: its image stays the plain one, since nothing in it wakes one."""
    if wakes_a_model(install):
        return True
    runs = (install or {}).get("run") or {}
    return any(bool((spec or {}).get("calls_model")) for spec in runs.values())


def directory_names(install):
    """The directories the install file declares, in the order it declares
    them. A package that declares none gets none: the fleet's host install
    falls back to records and work, and that fallback belongs to a host, where
    a directory nobody asked for costs an empty folder. Here it would be a
    variable pointing at a bucket prefix the package never named."""
    return [d["name"] for d in (install or {}).get("directories", []) or []
            if isinstance(d, dict) and d.get("name")]


# ── 1. the image reference ────────────────────────────────────────────────

def image_reference(registry, package_name, version):
    """Where this package's image is published. The operator's registry, the
    package's own name, and the package's version as the tag: an image is
    built from one version of one package, so naming it anything else would
    make two facts out of one."""
    return f"{registry.rstrip('/')}/{package_name}:{version}"


def pinned(reference, digest):
    """The same image named by digest. The tag says which version a person
    asked for; the digest is what a record may say was started."""
    return f"{reference.split(':')[0] if '@' not in reference else reference.split('@')[0]}@{digest}"


def check_started_image(reference):
    """A reference a deploy may start. Refuses a tag, and says why: the record
    this deploy produces names the digest of what it started, and a tag can
    point somewhere else an hour later, so a record built on one would be a
    claim nobody can check."""
    if not isinstance(reference, str) or not reference.strip():
        return "image must be the container image this deploy starts, by digest"
    if DIGEST_REF_RE.match(reference):
        return None
    if TAG_REF_RE.match(reference):
        return (f"image {reference} names a tag and not a digest. A tag moves, and the deployment record "
                f"names the digest of the image it started (12.7.1), so name the image as "
                f"repository@sha256:<digest>; the build record of the image carries it.")
    return f"image {reference!r} is not a container image reference"


# ── 2. the build record's account of the package ──────────────────────────

def build_shape(pkg, pkg_dir=None):
    """What was built (8.2's `shape`), read off the two authored files and the
    skills beside them.

    Spelled exactly as the agent builder's own build record spells it, counts
    and all, and counting the same things. A package built once and compiled
    into an image later has TWO build records, one per thing made (12.8), and a
    reader asking whether they describe the same package has to be comparing
    like with like rather than translating between two producers' vocabularies:
    `skills` is every skill folder and not only the offered ones, because a
    step has a skill too."""
    descriptor = pkg.get("descriptor") or {}
    install = pkg.get("install") or {}
    skills = []
    if pkg_dir and os.path.isdir(os.path.join(pkg_dir, "skills")):
        skills = [d for d in os.listdir(os.path.join(pkg_dir, "skills"))
                  if os.path.isdir(os.path.join(pkg_dir, "skills", d))]
    return {
        "skills": len(skills) if pkg_dir else len(descriptor.get("offerings") or []),
        "systems": len(install.get("systems") or []),
        "refuses": len([r for r in str(descriptor.get("refusals") or "").split("\n") if r.strip()]),
        "records": len(descriptor.get("records") or []),
    }


def build_context_files(ctx_dir):
    """Every file the build context puts INTO the image, as relative paths for
    the ledger. 12.7.1: an installer must record each file's digest as built,
    beside the image digest, so a reader can ask what is inside a layer
    without starting it.

    What this covers and what it does not, plainly. It covers what the
    installer placed: the package verbatim, the entrypoint, the lockfile
    checker and the job's command. It does not cover the dependency trees npm
    resolves during the build, which do not exist yet when this runs; those
    are covered by the lockfile digests the install file already names, and by
    the image digest over the whole thing."""
    rels = sorted(d for d in os.listdir(ctx_dir) if d != "build-inputs.json")
    return rels


# ── 3. the three files a container is given ───────────────────────────────

def mcp_document(servers):
    """The addresses the owner's instruction gave, by system name, for the file
    the entrypoint reads. On a host the installer writes these into the
    harness's own configuration at install; an image is built before any
    address exists, so the same fact arrives mounted instead."""
    return {"servers": {s["name"]: {k: v for k, v in s.items() if k != "name"} for s in servers}}


def binaries_document(install, name):
    """The binding's word on where a declared binary is, which for an image
    this deploy built is NOTHING, and the file says so rather than saying it
    with an empty value.

    WHY THERE ARE NO LINES IN IT. On a host the installer probes and writes
    BINARY_<NAME>=<path>, because the host is the machine the scripts run on.
    A container's filesystem is the image's, and this deploy did not open it;
    the image's own build recorded where each binary is, at build time, in the
    file beside the entrypoint. A line here with an empty value would override
    that answer with nothing, and a script would then guess a path, which is
    the failure BINARY_<NAME> exists to prevent. So the names are listed as
    comments, which the entrypoint does not read as settings, and an owner who
    genuinely needs to point one somewhere else writes the line by hand."""
    lines = [f"# Placed by the deployment manager for {name}. Where each binary the package",
             "# declares is INSIDE the image was recorded by the image's own build, beside",
             "# the entrypoint, because that is a fact about the image and not about this",
             "# binding. Nothing here overrides it: a BINARY_<NAME> line with an empty value",
             "# would replace the build's answer with nothing and a script would guess a path.",
             "# To point one somewhere else, write the line yourself.",
             "# The binaries this package declares:"]
    for b in (install or {}).get("binaries", []) or []:
        if isinstance(b, dict) and b.get("name"):
            lines.append(f"#   {binary_var(b['name'])}  {b['name']}"
                         + (f": {b['purpose']}" if b.get("purpose") else ""))
    if len(lines) == 7:
        lines.append("#   (none)")
    return "\n".join(lines) + "\n"


def binding_documents(name, install, ceilings, servers):
    """The three files under AGENT_BINDING_DIR, as {relative path: text}.

    `ceilings` is install.ceilings_doc(bindings)["ceilings"] and `servers` is
    install.mcp_servers(bindings), so the numbers and the addresses come from
    the same instruction a host install reads and are spelled once."""
    return {
        "ceilings.json": json.dumps({"ceilings": ceilings}, indent=2) + "\n",
        "mcp.json": json.dumps(mcp_document(servers), indent=2) + "\n",
        "binaries.env": binaries_document(install, name),
    }


def binding_dir(name, mount=CONTAINER_MOUNT):
    return f"{mount}/{BINDINGS_PREFIX}/{name}"


def binding_uri(bucket, name):
    return f"gs://{bucket}/{BINDINGS_PREFIX}/{name}"


def directory_path(name, directory, mount=CONTAINER_MOUNT):
    """Where one directory system of one agent is, inside the container."""
    return f"{mount}/{STATE_PREFIX}/{name}/{directory}"


def directory_uri(bucket, name, directory):
    """The same place, as the address a person can open. The container sees a
    path and the record names a bucket, and they are one directory."""
    return f"gs://{bucket}/{STATE_PREFIX}/{name}/{directory}"


def directory_env(name, install, mount=CONTAINER_MOUNT):
    """One variable per declared directory, which is how the entrypoint learns
    where each one is bound. Nothing here creates them: the side that can see
    the storage is the container, and its entrypoint makes each one before any
    work runs. What this settles is WHERE, and it settles it once, on the job,
    so two executions of the same agent look in the same place."""
    return {directory_var(d): directory_path(name, d, mount) for d in directory_names(install)}


# ── 4. what the job is given ──────────────────────────────────────────────

def job_env(name, bindings, values, mount=CONTAINER_MOUNT, install=None, harness=None, secrets=False, binding=None):
    """The variables the job carries for every message: the agent's installed
    name, where its binding is mounted, where each directory system is bound,
    each credential and setting under the variable the install file names, and,
    when the container wakes a model, which model and the key that pays for it.

    THE MODEL AND ITS KEY ARE HERE AND NOT IN THE IMAGE, and they are the same
    two facts a host deploy places. On a host the deployment manager writes the
    model into a brain script and copies the provider's key out of the owner's
    store into the agent's home; both are per install, and an image is built
    once and copied everywhere, so either one in a layer would be bound for
    every agent ever run from it (12.6 rule 3). `harness` is
    {"model", "key_env", "key"} and the caller is the side that reads the
    store; nothing here reads one.

    The directories are ON THE JOB and not on the execution, and that is the
    whole of the fix: a variable on the job is carried by every execution of
    it, so the second message of a conversation looks where the first one
    wrote. A path baked into the image instead pointed inside the container,
    which is made fresh for every message, and the process runner answered the
    second message as though the run in the first had never been started.

    The per-message variables (MESH_JOB_DIR, MESH_MESSAGE_FILE,
    MESH_REPLY_FILE) are NOT here. They belong to one message and are set on
    the execution by whatever dispatches it; a job carrying one would answer
    every message into the same folder.

    `binding` names the binding folder when it is not the agent's own: a
    version installed alongside reads alongside_binding_name's."""
    env = {"AGENT_NAME": name, BINDING_DIR_VAR: binding_dir(binding or name, mount),
           **directory_env(name, install, mount)}
    if harness:
        env[MODEL_VAR] = harness["model"]
        # A keyless provider (Claude on Vertex) is told where to call, and the
        # job's own service account pays; there is no key to carry.
        env.update(harness.get("vars") or {})
        if harness.get("key_env") and not secrets:
            env[harness["key_env"]] = harness["key"]
    for b in bindings:
        # The credential only. NOT `continue`: a binding can carry a credential
        # AND settings, as draft-host does, and skipping the rest of this
        # iteration dropped DRAFT_HOST_BUCKET, _PREFIX and _URL off the job.
        # A container would have started, found no bucket, and refused every
        # explainer with a message about a missing setting nobody had removed.
        if b.get("credential") and b.get("env") and not secrets:
            if b["credential"] not in values:
                raise KeyError(b["credential"])
            env[b["env"]] = values[b["credential"]]
        for k, v in (b.get("settings") or {}).items():
            env[k] = v
    return env


def job_secret_refs(bindings, harness=None):
    """Which of the job's variables are filled from the secret store at start
    rather than written into the job, as {variable: secret name}.

    WHY THIS EXISTS. Every credential used to be a plain value on the job, put
    there by --env-vars-file. The file kept them off the command line, which was
    the point at the time, but the job itself is readable: anyone holding
    run.jobs.get on this project could read the model key, the speech key and
    the draft host's service-account private key straight out of the job's
    spec, with no audit trail and nothing expiring. Five jobs carried six
    credentials that way (2026-09-12).

    A reference is read by Cloud Run as the job starts, under the job's own
    service account, so the value never appears in the spec, a rotation is a new
    secret version rather than five redeploys, and reads are logged. The secret
    is named by the SAME name the owner's store uses, so there is one name for a
    credential and not two to keep in step."""
    refs = {}
    if harness and harness.get("key_secret"):
        refs[harness["key_env"]] = harness["key_secret"]
    for b in bindings:
        if b.get("credential") and b.get("env"):
            refs[b["env"]] = b["credential"]
    return refs


def secrets_flag(refs):
    """gcloud's --set-secrets, one variable per entry, newest version at start.

    `:latest` on purpose: a rotation should reach the fleet by adding a version,
    and a job pinned to version 3 would keep paying with the key somebody
    retired. The cost is that a bad version reaches every agent at once, which
    is the same exposure the store already had.

    A reference that already names its version is sent as it is. Those are the
    ones an operator put on the job by hand and an update carries forward
    (carry_forward), and a version they chose is theirs to change, not ours. A
    secret's name cannot hold a colon, so the colon is a safe test."""
    return ",".join(f"{var}={name}" if ":" in name else f"{var}={name}:latest"
                    for var, name in sorted(refs.items()))


def job_variables(described):
    """The variables a job carries now, out of `gcloud run jobs describe
    --format=json`, as {"env": {name: value}, "secrets": {name: "secret:version"}}.

    WHY THIS IS READ. --env-vars-file and --set-secrets each REPLACE every
    variable of their kind on the job. On 2026-09-23 the process runner's job
    carried four variables an operator had set by hand so the runner could
    publish its runs to the platform (MESH_API_TOKEN as a reference to
    process-runner-publish-token, MESH_ACCOUNT, MESH_API_BASE and
    AGENT_HANDLE), and the update to 0.10.2 wiped all four, twice, and run
    pages went blank. An update has to know what is there before it writes.

    Refuses (ValueError) on a document it cannot read rather than answering
    "nothing": an empty answer here is exactly the wipe this exists to stop."""
    try:
        doc = json.loads(described) if isinstance(described, str) else described
        containers = doc["spec"]["template"]["spec"]["template"]["spec"]["containers"]
    except (ValueError, TypeError, KeyError) as e:
        raise ValueError(f"could not read the job's current variables ({e}); nothing was changed") from e
    env, secrets = {}, {}
    for e in (containers[0].get("env") or []) if containers else []:
        name = e.get("name")
        if not name:
            continue
        ref = (e.get("valueFrom") or {}).get("secretKeyRef")
        if ref and ref.get("name"):
            secrets[name] = f"{ref['name']}:{ref.get('key') or 'latest'}"
        else:
            env[name] = e.get("value", "")
    return {"env": env, "secrets": secrets}


def carry_forward(env, refs, current, placed_before):
    """What an update writes: the package's own variables and references, and
    every variable the job already carries that the package does not set and
    this deploy manager did not place. Returns (env, refs, dropped).

    The package wins on any name it sets, in either kind, so a name that moves
    from a plain value to a reference (or back) is not sent twice. A name the
    package does not set is kept UNLESS it is in placed_before, the names this
    deploy manager wrote on the job last time. Those were the package's, and a
    package version that stopped declaring one means it is no longer wanted,
    the same intent as the old provider's key coming off in a model change.
    Everything else was put there by somebody else, by hand, for a reason this
    side cannot see, and is not ours to take away (2026-09-23)."""
    ours = set(env) | set(refs)
    placed_before = set(placed_before or ())
    env, refs, dropped = dict(env), dict(refs), []
    for kind, into in (("env", env), ("secrets", refs)):
        for name, value in (current.get(kind) or {}).items():
            if name in ours:
                continue
            if name in placed_before:
                dropped.append(name)
                continue
            into[name] = value
    return env, refs, sorted(set(dropped))


def env_yaml(env):
    """The job's variables as gcloud's --env-vars-file reads them.

    A FILE and never a command line. These values are every credential the
    owner's store holds for this agent, and a command line is visible in this
    host's own process list for as long as the call runs: the dispatcher pays
    that price for a short-lived per-job credential, and a deploy placing a
    durable one should not. It also ends the escaping question, because a
    value in a file is not parsed by whatever ran the command.

    JSON scalars, which are valid YAML, so a value carrying a colon, a hash or
    a leading dash is what it is rather than what a YAML reader makes of it."""
    return "".join(f"{json.dumps(str(k))}: {json.dumps(str(v))}\n" for k, v in env.items())


def env_list(env):
    """gcloud's plain list form, for the three per-message paths an execution
    is given. A value carrying the separator or a newline is refused rather
    than sent: the alternative is a variable that arrives cut in half and a
    container that refuses for a reason nobody can see from here."""
    for k, v in env.items():
        if "," in str(v):
            raise ValueError(f"{k} contains a comma, which is the separator here; nothing was started")
        if re.search(r"[\r\n]", str(v)):
            raise ValueError(f"{k} contains a newline, which cannot go on a command line; nothing was started")
    return ",".join(f"{k}={v}" for k, v in env.items())


# ── a single-container edition of a solution ──────────────────────────────
#
# The edition is a process runner whose image also carries every member
# agent's package (fleet-manager/image/emit-composite.mjs), and whose
# entrypoint runs a member's job in the same container when the runner sends
# to it (composite.mjs). Each member still needs what its own job carries:
# its credentials, its model, where its directories and its binding are. Those
# go on the edition's job under the member's own prefix, and composite.mjs
# hands each member its own and nobody else's, so two members that name the
# same variable never meet and the runner never sees a member's key.

# The longest one task may run on Cloud Run, which is the ceiling on the one
# time limit that covers a whole run inside the edition.
COMPOSITE_MAX_SECONDS = 24 * 60 * 60


def member_prefix(name):
    """The prefix one member's variables carry on the edition's job. Spelled
    the same way composite.mjs's memberPrefix spells it."""
    return "MEMBER__" + re.sub(r"[^A-Z0-9]", "_", str(name).upper()) + "__"


def composite_job_variables(members):
    """The members' variables for the edition's job, as {"env", "secrets"}.

    `members` is {install name: {"env": {...}, "secrets": {...}, "handle":
    str, "agent_id": str}}, where env and secrets are what that member's own
    job carries now (job_variables of its describe). Every one goes under the
    member's prefix, unchanged, so each member reads the same folders, binding
    and keys in the edition as in its own container. The handle and key are
    added the same way: they are the deployment's to bind and are never baked
    into the image."""
    env, secrets = {}, {}
    for name in sorted(members):
        m = members[name] or {}
        p = member_prefix(name)
        for k, v in sorted((m.get("env") or {}).items()):
            env[p + k] = v
        for k, v in sorted((m.get("secrets") or {}).items()):
            secrets[p + k] = v
        if m.get("handle"):
            env[p + "MESH_SELF_HANDLE"] = m["handle"]
        if m.get("agent_id"):
            env[p + "AGENT_ID"] = m["agent_id"]
    return {"env": env, "secrets": secrets}


def composite_job_seconds(runner_seconds, member_seconds, requested=None):
    """The one time limit for a whole run inside the edition. What the
    instruction asked for when it asked, else the runner's own cap plus each
    member's once, which is what the same run takes with nothing waiting
    between containers. Never above what one task may run."""
    if requested:
        n = int(requested)
        if n <= 0:
            raise ValueError("the edition's time limit must be a whole number of seconds above nought")
        return min(n, COMPOSITE_MAX_SECONDS)
    total = int(runner_seconds or 240) + sum(int(s or 240) for s in member_seconds)
    return min(total, COMPOSITE_MAX_SECONDS)


def job_name(name, version=None):
    """One job per agent, named after it. `-worker` because the container is
    the worker half: the agent's address, its registration and its mailbox
    stay with whatever holds the key, and this is only what answers one
    message.

    A version installed ALONGSIDE the current one (run configs phase 3,
    docs/run-config-plan.md) is a second job of the same agent, named with
    its version: presentation-reader 0.3.2 beside the current one is
    presentation-reader-v0-3-2-worker. Same agent, same key, same inbox; only
    the job that answers a message naming that version differs."""
    if version is None:
        return f"{name}-worker"
    return f"{name}-v{version_slug(version)}-worker"


VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]{1,40})?$")
# Cloud Run's own limit on a job's name: 63 characters, lowercase letters,
# digits and hyphens, starting with a letter and not ending in a hyphen.
JOB_NAME_RE = re.compile(r"^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$")


def version_slug(version):
    """A package version as it may stand in a job or folder name: lowercase,
    every character that is not a letter or a digit a hyphen. 0.3.2 is 0-3-2.
    Refuses (ValueError) what is not a version, so a name is never built from
    whatever text arrived."""
    v = str(version or "")
    if not VERSION_RE.match(v):
        raise ValueError(f"{v!r} is not a package version")
    return re.sub(r"[^a-z0-9]+", "-", v.lower()).strip("-")


def alongside_binding_name(name, version):
    """The folder a version installed alongside reads its binding from:
    bindings/<name>--v<slug>, beside the current version's bindings/<name>.
    Each version is bound from its own instruction, so they never share one.
    The agent's DIRECTORIES are shared: they are the agent's, not a version's."""
    return f"{name}--v{version_slug(version)}"


def create_job_argv(spec, exists=False):
    """`gcloud run jobs create` (or `update`) for this agent: the image it
    starts, the bucket mounted where the message and the binding are, the
    variables for every message, and a task timeout that trails the package's
    own cap on one job.

    max-retries is 0 on purpose. A retried task is a message answered twice,
    and the sender cannot tell two answers from one.

    HOW MUCH MACHINE, only where the instruction said. Cloud Run's own default
    is half a gigabyte and one cpu, which is enough for a container that runs a
    program and not enough for one that starts a browser: chromium opening a
    page at two window sizes is killed there, and a killed task reads back as a
    container that answered nothing. Nothing in a package says how much machine
    it wants and nothing should: it is a fact about the compute the owner is
    paying for, so it arrives in the instruction beside the region and the
    bucket. Left off the command line entirely when the instruction did not say,
    so a job that has been running on the default is not resized by a redeploy
    that never mentioned it."""
    cap = int(spec.get("job_seconds") or 240)
    return [
        "run", "jobs", "update" if exists else "create", spec["job"],
        "--image", spec["image"],
        "--region", spec["region"],
        *(["--project", spec["project"]] if spec.get("project") else []),
        # gcsfuse volumes need the second generation execution environment;
        # naming it here means a job created on a project whose default is
        # gen1 still gets the mount rather than failing at first execution.
        "--execution-environment", "gen2",
        f"--add-volume=name={MOUNT_NAME},type=cloud-storage,bucket={spec['bucket']}",
        f"--add-volume-mount=volume={MOUNT_NAME},mount-path={spec.get('mount') or CONTAINER_MOUNT}",
        f"--env-vars-file={spec['env_file']}",
        *([f"--set-secrets={secrets_flag(spec['secrets'])}"] if spec.get("secrets") else []),
        # AN UPDATE THAT LEAVES NO SECRET CLEARS THEM. --set-secrets replaces
        # every reference, but a job with none left gets no flag at all, and
        # then gcloud keeps whatever the job carried: publisher 0.2.0 stopped
        # declaring draft-host-writer on 2026-09-28 and its job kept the
        # reference. By here the references are the package's own plus every
        # one somebody placed by hand (carry_forward), so an empty set means
        # nothing is meant to remain.
        *(["--clear-secrets"] if exists and not spec.get("secrets") else []),
        # WHO THE JOB RUNS AS, and only where the instruction said. Left off,
        # Cloud Run uses the project's default compute service account, which
        # is what every job on our own project has always used.
        #
        # A job in a CUSTOMER's project names the account they granted us
        # instead, and that is the difference between one published role and
        # two. The secrets this deploy places are created by that account, so
        # that account can already read them; the default compute account is a
        # separate principal that would need its own accessor binding, and it
        # is also the account with Editor on everything else in their project,
        # which is the last thing an agent's container should be.
        *(["--service-account", spec["service_account"]] if spec.get("service_account") else []),
        *(["--memory", spec["memory"]] if spec.get("memory") else []),
        *(["--cpu", spec["cpu"]] if spec.get("cpu") else []),
        "--max-retries", "0",
        "--task-timeout", f"{cap + 120}s",
        "--quiet", "--format", "value(metadata.name)",
    ]


def execute_job_argv(spec):
    """One execution, with the three variables that belong to one message.
    `--wait` so the check is over when this returns; the container's own exit
    code does not come back through gcloud and does not need to, because the
    entrypoint writes outcome.json on the mount."""
    return [
        "run", "jobs", "execute", spec["job"],
        "--region", spec["region"],
        *(["--project", spec["project"]] if spec.get("project") else []),
        "--wait", "--quiet",
        f"--update-env-vars={env_list(spec['env'])}",
        "--format", "value(metadata.name)",
    ]


def describe_job_argv(spec):
    """Read back the image the job actually names. The deployment record says
    what this deploy STARTED, which is what the runtime reports, never what
    the instruction handed it: an argfile naming one digest and a job created
    with another is exactly the confusion the digest exists to settle."""
    return [
        "run", "jobs", "describe", spec["job"],
        "--region", spec["region"],
        *(["--project", spec["project"]] if spec.get("project") else []),
        "--format", "value(spec.template.spec.template.spec.containers[0].image)",
    ]


def describe_job_variables_argv(spec):
    """Read the whole job as JSON, for the variables it carries now
    (job_variables). The image read above asks for one field; this one needs
    the list of variables with each one's kind, which only the full document
    says."""
    return [
        "run", "jobs", "describe", spec["job"],
        "--region", spec["region"],
        *(["--project", spec["project"]] if spec.get("project") else []),
        "--format=json",
    ]


def secret_describe_argv(name, project=None):
    """Ask whether a project already holds this secret. Its failure is an
    ANSWER and not a stop: on our own project every one of these was placed by
    hand long ago, and in a customer's project the first deploy places them
    all, so both "there" and "not there" are ordinary."""
    return ["secrets", "describe", name,
            *(["--project", project] if project else []),
            "--format", "value(name)"]


def secret_create_argv(name, project=None):
    """Create the secret itself, holding no version yet.

    Automatic replication, because the thing in it is an api key of a few
    dozen bytes that every region reads and no law locates. A customer who
    needs it pinned to a region has a requirement this deploy cannot guess,
    and guessing would put their key somewhere they did not choose.
    """
    return ["secrets", "create", name,
            *(["--project", project] if project else []),
            "--replication-policy", "automatic",
            "--quiet", "--format", "value(name)"]


def secret_version_argv(name, project=None):
    """Add a version, with the value arriving on STDIN.

    `--data-file=-` and never a file and never a command line. The value is
    the owner's model key: a command line is in this host's own process list
    for as long as the call runs, and a temp file is a file somebody has to
    remember to delete on the path where the deploy fails. A pipe closes when
    the call ends, whatever happened.

    A VERSION AND NOT A REPLACEMENT. The reference is `:latest`
    (secrets_flag), so a rotation is a new version; a deploy that deleted and
    recreated the secret would break every other job in that project already
    pointing at it.
    """
    return ["secrets", "versions", "add", name,
            *(["--project", project] if project else []),
            "--data-file=-", "--quiet", "--format", "value(name)"]


def secret_accessor_argv(name, member, project=None):
    """Let the account the agent's container runs as read THIS secret, and no
    other.

    THE ALTERNATIVE IS A PROJECT-WIDE BINDING, and this exists to not ask for
    one. `roles/secretmanager.secretAccessor` granted on a project reaches every
    secret in it, including ones the customer made years ago for something else
    and never mentioned to us. Granted on one secret, it reaches that secret.
    The published permission page is allowed to say we cannot reach what we did
    not create only because of this call.

    ON THE SECRET WE JUST PLACED, and made every deploy rather than only on the
    one that creates it. The call is idempotent, the container cannot start
    without it, and the account it names can change between deploys: the page
    offers a two-account split where the deploy account holds everything except
    the power to read a secret value and a second account holds only that. A
    binding written once, at creation, would leave the second account unable to
    read the key the day somebody took the split.
    """
    return ["secrets", "add-iam-policy-binding", name,
            *(["--project", project] if project else []),
            "--member", f"serviceAccount:{member}",
            "--role", "roles/secretmanager.secretAccessor",
            "--quiet", "--format", "value(etag)"]


def probe_message(message_id, sender, text):
    """The one message the check sends. An ordinary message and nothing
    special: the entrypoint refuses a room turn and a worker-interface
    exchange, and a check that sent one would be checking the refusal."""
    return {"id": message_id, "from": sender, "handle": None, "text": text,
            "in_reply_to": None, "files": [], "kind": "message"}


def probe_env(name, job_dir):
    """What one execution is told, on top of what the job already carries.
    MESH_REPLY_FILE is named rather than left to its default so the file this
    check reads back is the file this check asked for."""
    return {"MESH_JOB_DIR": job_dir,
            "MESH_MESSAGE_FILE": f"{job_dir}/message.json",
            "MESH_REPLY_FILE": f"{job_dir}/reply.txt",
            "AGENT_NAME": name}


# ── 5. the check's verdict ────────────────────────────────────────────────

def smoke_from_outcome(outcome, reply, launched):
    """What the check observed, in the grade the role is allowed to state. A
    smoke check proves the container started and answered one message, and
    nothing more; it is not a conformance check and never called one.

    An absent outcome.json is not the same as a failed one: the entrypoint
    writes it last, so its absence means the execution never got that far,
    which is either a refusal before any work ran or an execution that never
    started. Both say so rather than reporting a silent pass."""
    if not outcome:
        return {"passed": False, "started": bool(launched),
                "why": ("the execution left no outcome.json on the mount: it was refused before any work ran, "
                        "or it never started"),
                "reply": ""}
    return {"passed": outcome.get("status") == "answered" and bool(reply.strip()),
            "started": True, "status": outcome.get("status"), "by": outcome.get("by"),
            "exit_code": outcome.get("exit_code"), "pieces": outcome.get("pieces") or [],
            "reply": reply.strip()[:400]}
