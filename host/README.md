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
| `responses-bridge.mjs` | `/opt/fleet/responses-bridge.mjs`: lets the Codex brains reach Claude on Vertex AI as the machine's own service account, on loopback, with no key |
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
