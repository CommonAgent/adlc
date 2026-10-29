# Installing the three host agents

The package maker, the deployment manager and the conformance checker are the
lifecycle's own tools. Every package goes through them: the package maker packs
it, the deployment manager installs it, the conformance checker proves it. They
are not packages themselves, and the deployment manager cannot install the
deployment manager, so a new fleet host gets them through this one bootstrap.

On the host they keep their older unix names: `agentbuilder` (package maker),
`deploymgr` (deployment manager) and `agentevaluator` (conformance checker).

This bootstrap is written for an AgentMesh fleet host: a Linux machine with
pm2, the mesh-adapter installed globally at `/usr/bin/mesh-adapter`, and the
AgentMesh fleet supervisor (`roster.mjs` and the attendants under `/opt/fleet`),
which wakes each agent's brain per message. The supervisor is not in this
repository. On another platform, use these files as the list of what each agent
needs and wire them to your own host.

## What is here

| File | Installed as |
|---|---|
| `install-on-host.sh` | run once on the fleet host, as root, from the staged folder |
| `ecosystem.config.js.tmpl` | `/opt/fleet/ecosystem.config.js`, only on a host that has none |
| `responses-bridge.mjs` | `/opt/fleet/responses-bridge.mjs`: lets the Codex brains reach Claude on Vertex AI as the machine's own service account, on loopback, with no key; and is the model gateway agents reach through `MODEL_ENDPOINT` (see [The model settings](#the-model-settings)) |
| `follow-names.mjs` | `/opt/fleet/follow-names.mjs`: binds each agent's descriptor to its key and name and signs it |
| `sudoers.d/` | `/etc/sudoers.d/`: the one rule each for the package maker's pack and the deployment manager's procedures |

Each agent's own host files are in its folder under `agents/<role>/host/`: the
brain template, the descriptor, the listing and the public line.

## Running it

1. Render every template for your environment with
   `AGENTMESH_ENV=<name> node env/render.mjs <file>.tmpl`, using LF line
   endings. Start from `env/example.json`.
2. Stage one folder the way `install-on-host.sh` reads it:
   - `brains/agentbuilder.sh`, `brains/deploymgr.sh`, `brains/agentevaluator.sh`
     from each agent's `host/*.sh.tmpl`;
   - `agents/<unix name>/{listing,public,descriptor}.json` from each agent's
     `host/agent/`;
   - `agentbuilder-pack-as-node.sh`, `ecosystem.config.js`,
     `responses-bridge.mjs`, `follow-names.mjs` and `install-on-host.sh`;
   - `tokens.json`, `{ "<unix name>": "<agent key>" }`, mode 600: one single-use
     agent key per agent, minted for the account the agents act for. Never
     print them.
3. Copy the agents' code flat into `/opt/fleet` under each agent's prefix, as
   the brains and sudoers rules expect: `agentbuilder-build.py`,
   `agentbuilder-pack.py`, `agentbuilder-request.py` and the rest from
   `agents/package-maker`; `deploymgr-steps.py`, `deploymgr-install.py` and the
   rest from `agents/deployment-manager` (its `DESIGN.md` lists each one);
   `agenteval-gen.py`, `agenteval-run.py` and the rest from
   `agents/conformance-checker`.
4. Copy the staged folder to the host, unpack it in `/tmp/ops-agents`, and run
   `sudo bash /tmp/ops-agents/install-on-host.sh /tmp/ops-agents`. It removes
   `tokens.json` when it is done; remove the folder after.
5. Check: a message to each agent's handle is answered.

The script is safe to run again. An agent whose node folder already holds an
identity is not added twice, and a file already in place is kept beside a
backup when it changes.

## The environment

`env/` at the repository root holds the reader every agent and template uses.
`AGENTMESH_ENV` names the environment (`env/<name>.json`), and a missing or
null value stops the read rather than guessing. `env/example.json` lists the
keys these agents read. The package maker's brain and pack script set no
required coder, so the builder packs scripts from any code writer; an operator
who wants only one writer's scripts packed sets `REQUIRED_CODER` (one or more
public keys) in those two scripts, and the builder then checks every script
against that writer's signed delivery manifest.

## The model settings

A package carries no model address and no way of signing in (Common Agent
0.39.0, Section 12.4.1, and 12.6 rule 2). The host places four settings for
every agent that calls a model, and the agent reads them on every call
through its copy of the shared model caller (`agents/package-maker/shared/model-caller.mjs`):

| Setting | What it holds |
|---|---|
| `MODEL_NAME` | which model, sent exactly as written |
| `MODEL_ENDPOINT` | the base address; the caller adds the path its format names (`/v1/messages`, `/chat/completions`, `/models/<name>:generateContent`) |
| `MODEL_KEY` | the credential; empty when the endpoint needs none |
| `MODEL_PROTOCOL` | the request format: `anthropic-messages`, `openai-chat` or `gemini` |

For one version the caller also reads `TEXT_MODEL` in place of `MODEL_NAME`
and `TEXT_API_KEY` in place of `MODEL_KEY`. There is no older name for the
endpoint: an agent with no `MODEL_ENDPOINT` refuses, naming it.

`env/example.json` carries them under `model`. The values there are the ones
for Claude on Vertex AI through this host's gateway:

- `MODEL_ENDPOINT` `http://127.0.0.1:8788`, the responses bridge;
- `MODEL_PROTOCOL` `anthropic-messages`;
- `MODEL_KEY` empty;
- `MODEL_NAME` the Claude model's id, as Vertex names it.

The bridge is the gateway on the host's side that 12.4.1 asks for where a
provider signs in with a short-lived token. It serves `POST /v1/messages`
beside the Codex brains' `/v1/responses`. It holds the machine's Google identity (the metadata server on a Google Cloud
machine, or `RIG_GCLOUD auth print-access-token` on a workstation), keeps the
token fresh, and passes each Messages API request to Vertex in the project and
region it is started with: the model moves from the body into Vertex's
address, the version becomes Vertex's, and a streamed request is streamed back.
Vertex's status and answer come back unchanged, and a key the agent sends is
never passed on. It listens on loopback only. No agent fetches a Google token
or knows where Vertex is.

Where the work runs decides what `MODEL_ENDPOINT` points at:

- **On this host**, the pm2 app `responses-bridge` that `ecosystem.config.js`
  starts, at `http://127.0.0.1:8788`.
- **In a job's container**, a bridge started in that container, as the rig
  starts one beside Codex: `node responses-bridge.mjs` with
  `BRIDGE_VERTEX_PROJECT` and `BRIDGE_VERTEX_REGION`, signed in as the job's
  service account. The image tools do not start one yet.
- **In a tenant container**, the tenant host already serves a model door on
  `http://127.0.0.1:8790` that speaks `anthropic-messages` and carries each call
  to the platform's model gateway, so `MODEL_ENDPOINT` points there and no
  bridge is needed.

A host that reaches a model service directly sets `MODEL_ENDPOINT` to that
service's root, `MODEL_PROTOCOL` to the format it speaks, and `MODEL_KEY` to
its key.

## Which account a build runs as

Left alone, an image build runs as the project's default build account, which
on a project made since 2024 is its default compute account, usually an
Editor; and submitting a build as an account means the host may act as it.
Three settings name narrower accounts instead, each an account of the
project the build runs in:

- `gcp.build_sa` in the environment file (or `DM_BUILD_SA`): package image
  builds. It needs to write images to the deployment manager's registry, read
  the base images, write logs, and read and write the project's
  `<project>_cloudbuild` bucket, where the source is staged and the log kept.
- `DM_PLATFORM_BUILDER` in /opt/fleet/deploymgr-platform.json: the platform's
  own container images, built from a repository.
- `DM_ROLE_CHECK_BUILDER` in the same file (or `EVAL_BUILD_SA`): the
  evaluator's role check, which runs the agent's own code and so gets an
  account that may read images and write logs, never one that writes images.

The host's own account needs Service Account User on each one it names.
