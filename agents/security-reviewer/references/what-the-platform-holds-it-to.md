# What the platform holds an agent to

A review says what holds each bound. These are the bounds AgentMesh enforces
for an installed package, and the ones it does not, as of 2026-10-27, with the
place each is enforced. `scripts/platform.mjs` carries the same lines the
review prints. A review never claims a bound that this file does not list.

## Systems and their access

- A package declares each system in the descriptor (`name`, `access`, `needs`,
  `leaves`) and in the runtime requirements (`name`, `kind`, `credential`,
  `env`, `settings`, `spends`). `access` is `read`, `write` or `trigger`
  (`agents/package-maker/build.py`, `ACCESS`). `kind` is `directory` (the
  default), `mcp` or `service`.
- The deployment manager refuses a package whose two halves name different
  systems (`agents/deployment-manager/install.py`, `read_package`).
- The reserved system names an account can bind are in
  `agents/package-maker/system-names.json`. Any other name still builds, and
  each deploy binds it by hand. A service with no credential, setting or
  address is bound by nothing and checked by nothing.
- What the access word holds is the credential the owner binds. A read
  credential cannot write; where the product behind it grants more, only the
  package's own programs keep it to what it declared.
- `leaves: true` says a caller's material is sent to the system. It is a
  statement to callers, and nothing checks what a request carries.

## Credentials, placed by name

- A credential is a NAME (`^[a-z0-9][a-z0-9._-]{0,63}$`) and the variable it
  is placed in (`env`). The package maker refuses a value, and an address,
  anywhere in the package; the deployment manager refuses a value anywhere in
  the package or the owner's instruction (`install.py`, `looks_like_value`,
  `check_instruction`), and a credential with no variable to place it in.
- At install the deployment manager reads the named credential from the
  owner's store and places it in that one variable (`install.py`,
  `plan_bindings`, `env_file`). The owner's instruction may name a different
  credential for a system.
- `draft-host` is brokered: it carries no credential, and the agent asks the
  platform for one that lasts at most ten minutes.
- The model systems are placed: the key stays on the host for as long as the
  agent is installed.

## Egress

- No per-agent host allow-list is built yet, and the runtime requirements have
  no field for one (Common Agent 12.4). A further destination is meant to be
  the offering's authority `reaches-network` plus the owner's instruction
  (Common Agent 6.11); nothing reads that word yet.
- A fleet host blocks only the metadata server for agent users
  (`fleet-manager/runtime/fleet/egress-guard.mjs`); everything else is open.
- A host or Cloud Run deploy records egress `{policy: "open", enforced_by:
  "none"}` (`steps.py`, `EGRESS_OPEN`).
- A platform worker job runs under an observe rule that logs and allows
  (`steps.py`, `WORKER_EGRESS`, `place_observe_rule`); `enforce` is not yet
  backed by a deny policy.
- A tenant agent in a customer's project is denied everything but the mesh
  (the broker, the registrar and the API host).

So for an agent on a fleet host or Cloud Run, what it may reach on the network
is held by its own programs and by nothing else. The review says so.

## Spending

- A system that spends carries `spends: {unit}`, and every spending system
  needs a ceiling `{system, per: task|day, enforced_by, suggested?}`
  (`build.py`, `install_file`). `enforced_by` is `runtime` for a system with
  a credential and `platform` for an mcp system.
- The deployment manager refuses an install whose instruction gives no number
  for a ceiling, and places it as `CEILING_<SYSTEM>` (`install.py`,
  `check_instruction`, `env_file`). A blank ceiling may be filled from the
  package's `suggested` number, so the number in force can be the package's
  suggestion and not the owner's.
- A `runtime` ceiling is counted by the package's own program, which reads the
  variable; nothing on the platform meters it. A program that ignores the
  variable spends without a bound.
- The owner's own limits: the account's monthly spending limit refuses a hold
  past it (`/v1/accounts/:id/spending-limit`); the agent's allowance
  (Common Agent EXT-8) refuses, or asks the owner, when one of its ceilings is
  spent, and the trial ceiling is written into it at install. An Agent Mandate
  bounds what may be agreed in an engagement, not what a job spends.
- `price` is what the agent charges callers. It is not a spending limit.

## The kill switch

- An owner, an organization admin or an operator can pause or terminate an
  agent (`services/src/api/kill-switch.ts`). A stop cuts every credential door
  and the transport, the supervisor starts no new work and ends what is
  running, and brokered access lapses within ten minutes. A terminate revokes
  the signing key and refuses that package's bytes on every deploy path.
- Not done: a container in a customer's own cloud is not taken down (it only
  gets no new credential), and a placed model key is not revoked.

## Time

- `job_seconds` is the longest one job may take; the host stops a job at it.
