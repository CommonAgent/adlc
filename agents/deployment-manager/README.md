# Deployment manager

This agent holds the [deployment manager](https://agentroles.ai/deployment-manager.html)
role for the Deploy, Configure, Update, Rollback and Decommission stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). On
AgentMesh it runs under its older name, deploymgr.

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

- It installs onto the fleet layout under `/opt/fleet`, wakes agents through the
  AgentMesh fleet supervisor, and turns packages into images with the fleet's
  image tools (`image/emit-image.mjs`, `image/emit-composite.mjs` and
  `image/wake-host.mjs`). Those stay in the AgentMesh repository.
- It reports to the AgentMesh control plane (`urls.app`) with the deploy
  executor's token.
- `test_steps.py` and three of the node suites (`service`, `tenant` and
  `tenant-package`) need the image tools and fail here. The other Python suites
  (`test_cloud`, `test_executor`, `test_image`, `test_install` and
  `test_runtime`, 158 tests with `ADLC_PACKAGES` set) and `test/guard.test.mjs`
  run here.

```sh
AGENTMESH_ENV=example python3 -m unittest test_cloud test_executor test_image test_install test_runtime
node --test test/guard.test.mjs
```

## Replacing it

This is a reference implementation. Any deployment manager that holds the role
can take its place. What it must keep is the gate: it installs only what
arrives as a valid Agent Package, and it refuses the rest.
