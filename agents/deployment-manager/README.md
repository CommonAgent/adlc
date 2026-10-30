# Deployment manager

This agent holds the [deployment manager](https://agentroles.ai/deployment-manager.html)
role for the Deploy, Update, Rollback, Reconfigure and Decommission stages of
the [Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).
A deploy includes the agent's configuration: its credentials are placed by
name and its ceilings are set before it starts. On AgentMesh it runs under its
older name, deploymgr.

It turns an Agent Package into a running agent, keeps it current, accounts for
what is deployed, and removes agents cleanly, and it does each of these only on
the owner's instruction. It is the one agent in the lifecycle that changes the
live world, so all of that authority sits in one place with one audit trail.
It refuses a package that does not verify: it hashes the archive before it
opens it, checks the manifest against the pinned schema and every part against
its digest, and binds credentials by name, never by value. Every act ends in a
signed deployment record.

The agent itself is a model working under `AGENTS.md`, allowed to run a short
list of fixed procedures and nothing else. The procedures are the contract.
[`DESIGN.md`](DESIGN.md) walks through the install step by step and maps each
of the role's clauses to the code that enforces it.

## The package files it reads

A package's draft Descriptor is `agent-descriptor.json` and its runtime
requirements are `agent-runtime-requirements.json`, pointed at from
`plugin.json` under `descriptor` and `runtime_requirements` (Common Agent
0.30.0-draft). A package built before then uses `descriptor.json`,
`install.json`, the pointer `install` and the format `agent-install-v1`, and
it still installs and updates exactly as before. Where both names are present,
the current one is read. The bound Descriptor the agent serves from its own
home (`.agentmesh/adapter/descriptor.json`) is not a package file and keeps
its name.

## The parts

- `steps.py`, run as root through one sudoers line: deploy, update, remove,
  model and status on the fleet host, and the image and container paths.
- `install.py`, `translate.py`, `image.py`, `record.py`, `cloud.py` and
  `runtime.py`: the reading, checking, image, record and cloud halves, as plain
  functions with no side effects, which is what most of the tests exercise.
- `service.mjs` and `guard.mjs`: the container path (an agent run as its own
  Cloud Run service) and the guard that checks a placement before anything
  starts.
- `deploy-executor.py`: the loop that collects deploy requests the owner has
  approved and hands each one to the procedures.
- `host/`: the agent's descriptor and listing, its brain, and the placement
  templates for a platform project and a tenant project.

## Records and the conformance check after every deploy

Every act that puts a version in place ends in a signed deployment record
naming the package digest: a deploy, an update (including a reinstall of the
same version with new settings), and a version kept alongside. A reconfigure
that installs nothing (`model`, `jobs-at-once`, `rebind`) is recorded as act
`reconfigure`, naming the package already running. The executor files a
deploy's or an update's record with the request it carried out.

After a deploy or an update that worked, the executor runs the Conformance
Checker (agentevaluator, on the same host) against the agent it put in place,
in a process of its own and one at a time: the cases are derived from the
installed package, the verdict is signed by the checker and filed with the
registry, and it names the package digest the deploy verified. It runs in
every environment but prod unless `DM_CONFORMANCE` (`on` or `off`) says
otherwise; its log is `~deploymgr/records/conformance.log`.

An agent that already runs can be given both without being redeployed:

```sh
python3 /opt/fleet/deploy-executor.py backfill [--records-only | --checks-only] [name ...]
```

For each running agent in the inventory, `deploymgr-steps.py attest <name>`
re-hashes the install against its ledger and installs nothing (a changed file
of the package or its brain refuses it); its answer is signed as an `attest`
record and filed on the deploy request that filed that package
(`POST /v1/deploy-requests/record`), and the check runs as it does after a
deploy.

## The order and speed of installs

The executor serves approved requests oldest approval first (`decided_at`).

By default it runs each request whole before it starts the next, as it always
has. Each host package install builds an image, places a Cloud Run job and
restarts the agent's platform node, so a queue of twenty takes well over an
hour. Two settings on the executor change that:

| Setting | Default | What it does |
|---|---|---|
| `DM_INSTALL_WORKERS` | `1` | How many requests may work at once on the parts that do not touch the node: the checks and the fetch, the image build, the Cloud Run job and its probe. |
| `DM_LAND_BATCH` | `off` | `on`: installs that are ready to land wait for each other and land together behind one node restart. |
| `DM_LAND_BATCH_SECONDS` | `60` | How long the first ready install waits for others while more are still being prepared. |
| `DM_LAND_BATCH_MOST` | `5` | The most agents in one landing. |

`DM_INSTALL_WORKERS=1` with `DM_LAND_BATCH` off is the old behaviour exactly:
the executor calls `deploymgr-steps.py deploy` or `update` once per request.

With either set, a host package install runs as three acts of
`deploymgr-steps.py`:

1. `prepare` checks the instruction and fetches and verifies the package.
   It touches no node, so several run at once.
2. `land` holds the host's node lock and takes every install that is ready.
   It places each agent in a process of its own, so a refusal stops that agent
   and no other. Then it starts each node once, smoke checks every agent,
   watches the node for the full two minutes once, and probes each other agent
   briefly. An agent that fails its probe is taken back out the way it would
   be alone, and the rest land. If the node itself does not stay well, nobody
   can tell which agent caused it, so every agent in that landing is taken
   back out. There is one landing at a time.
3. `finish` builds the image, places the job and prints the act's one answer.
   Several run at once.

Two requests for the same agent never run at once, and the later one starts
only after the earlier one's outcome is posted. Container agents, a person's
own packages and version acts run whole, one at a time. Each request keeps its
own outcome, its signed record, its conformance check and its answer to a
run, exactly as before. The guard is told how many new agents were placed on
the node earlier in the same landing, because the node's credential does not
carry them until it restarts.

## The audit gate

The deployment manager installs a package only with a current audit pass
for that exact package digest, wherever the environment requires one. It
applies to a new install, an update, a person's own package and a version
kept alongside. Retiring a version installs nothing, so it is not checked.
A container agent from a repository has no package digest, so it is not
covered.

The gate is required when any of these holds:

- the environment file says `audit_gate.required: true` (prod);
- its switch, `AUDIT_GATE`, is on;
- the control plane marks the request `audit_gate.required`, which it does
  when its own gate is on.

Nothing on a request can turn off a gate the environment requires.

`deploy-executor.py` checks the pass itself, from the signed report's own
bytes. It reads `GET /v1/audits/<digest>`, then fetches the report that the
audit names and requires all of the following:

- its bytes hash to the report digest;
- it is for this package digest;
- it is signed by an auditor key that the environment pins (or that the
  control plane pins, when the host's environment file names none), and the
  signature verifies;
- its verdict is `pass` or `pass_with_findings`;
- it has not expired.

A refusal places nothing: no token, no argfile and no procedure. It is
recorded and signed like any other refusal (`step: audit-gate`). Its
sentence names the digest and what is missing, and it points to the audit
report, or says that no report exists. `test_audit_gate.py` covers each
case.

## What it needs

- A fleet host: Linux with Python 3.11 or later, Node 22 or later, pm2, the
  mesh-adapter installed globally, a coding harness for the brain (Codex), and
  the sudoers rule in [`../../host/sudoers.d`](../../host/sudoers.d).
- For the image and container paths, Google Cloud: a project, an Artifact
  Registry or Container Registry, Cloud Build and Cloud Run, and the service
  accounts named in `host/deploymgr-*.json.tmpl`.
- An environment file (see [`../../env`](../../env)) for the control plane's
  addresses.

## What runs only inside AgentMesh today

This agent cannot run outside an AgentMesh fleet host as it stands.

- It installs onto the fleet layout under `/opt/fleet` and wakes agents through
  the AgentMesh fleet supervisor. It turns packages into images with the image
  tools in [`../image`](../image) (`emit-image.mjs`, `emit-composite.mjs` and
  `wake-host.mjs`), which need nothing from AgentMesh.
- It reports to the AgentMesh control plane (`urls.app`) with the deploy
  executor's token.
- The tests that build real packages read them from `ADLC_PACKAGES`, a folder
  laid out as `<family>/<name>/` (each an agent's own files) such as the AgentMesh repository's
  `packages/`, and are skipped without it.
- The tenant image carries the AgentMesh fleet supervisor, so the four
  `tenant-package` tests that build it need `ADLC_FLEET_SUPERVISOR`, the path
  to that supervisor, and are skipped without it.

```sh
AGENTMESH_ENV=example python3 -m unittest discover -p "test_*.py"
AGENTMESH_ENV=example node --test "test/*.test.mjs"
```

## Replacing it

This is a reference implementation. Any deployment manager that holds the role
can take its place. What it must keep is the gate: it installs only what
arrives as a valid Agent Package, and it refuses the rest.
