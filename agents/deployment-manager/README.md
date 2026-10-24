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
  laid out as `<family>/<name>/spec.json` such as the AgentMesh repository's
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
