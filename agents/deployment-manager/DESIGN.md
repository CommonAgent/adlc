# The Deployment Manager

The first implementation of `role-deployment-manager` (agentroles.ai §11):
an agent that turns an Agent Package into a running mesh agent on this
host, keeps it current, accounts for what is deployed, and removes agents
cleanly, on the owner's instruction only.

The words are the specification's: chapter 12.1 defines host, harness,
package, agent, and bare agent, and this document uses them in that sense. The
owner instructs a deploy; this agent installs the package; the result is an
agent.

It was built from two hand-run deploys, recorded in
`docs/deploy-walk-redline.md`, and then made to follow the Common Agent
Specification's chapter 12 (12.7) in its order. Every contract clause the
role publishes is enforced here structurally rather than by the model's
good behaviour.

## The pieces

- **`AGENTS.md`** — the brain's instructions. The agent runs four
  commands and nothing else, refuses secrets in requests, and never calls
  a smoke check a conformance check. This is what the harness reads.
- **`steps.py`** → deployed as `/opt/fleet/deploymgr-steps.py`. The fixed
  procedures, run as root through one sudoers line. Validates every
  parameter, prints one JSON object, and STOPS at the first failed step
  reporting the state it left, never improvising past it. It edits its own
  inventory (`deploymgr-agents.json`) and its own pm2 config
  (`deploymgr-agents.config.js`); it never touches the hand-managed
  `ecosystem.config.js`.
- **`install.py`** → `/opt/fleet/deploymgr-install.py`. The reading and
  checking half of the install, as plain functions with no root and no
  side effects: read a package and refuse one that does not hold
  together; check the host; check the instruction; plan the bindings;
  render the environment; the per-harness table; the ledger. `steps.py`
  loads it from beside itself. This is what the tests run.
- **`translate.py`** → `/opt/fleet/deploymgr-translate.py`. Flattens a
  package into the instructions file a CLI harness reads, saying where
  each system is bound on this host and which ceilings are binding.
- **`image.py`** → `/opt/fleet/deploymgr-image.py`. The image half, as plain
  functions: the three files a container is given at run time, the variables
  the job carries, the gcloud argument vectors, and what a build record says
  about the package it was built from. No root, no network, no side effect.
- **`record.py`** → `/opt/fleet/deploymgr-record.py`. Builds and signs the
  record of one act: an `agent-build-record-v1` for an image, an
  `agent-deployment-record-v1` for a deploy, update, remove, or refusal.
  Names only.
- **`cloud.py`** → `/opt/fleet/deploymgr-cloud.py`. Acting inside a
  CUSTOMER's own Google Cloud project: the guard that refuses a service
  account and a project that disagree, the impersonation flag, the reading
  of whether a failed call was a revocation or an outage, and the shape of
  one line of the action log. No root, no network, no side effect, so the
  guard can be exercised with no cloud available.
- **`service.mjs`** → `/opt/fleet/deploymgr-service.mjs`. The container path
  (docs/container-agents-plan.md): a container agent from a repository folder,
  built in Cloud Build from its own Dockerfile at a pinned commit, keyed into
  its own secret, run as an always-on Cloud Run service as its own account,
  named before it starts; update by a new commit, retire of everything. Signs
  its own build and deployment records (same tags, same signature form as
  `record.py`). Tested by `test/service.test.mjs` (`node --test`).
- **`test_install.py`** and **`test_image.py`**, run with
  `python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"`.
  Build the explainer and process-runner examples with the agent builder and
  run the installer's and the image half's functions against them. CI runs
  them.

Also beside these: `../agentbuilder/plugin-1.0.0.schema.json`, the pinned
Agent Plugins schema, installed on the host as
`/opt/fleet/deploymgr-plugin.schema.json` so a manifest can be verified
offline.

## The install, in the chapter's order

| Step (chapter 12.7) | Where it lives |
|---|---|
| Fetch by name and version, verify the digest and the manifest | `fetch_and_verify`: hash before extract, no path escapes and no links in the archive, then `install.read_package`, which checks the manifest against the pinned schema, each pointed file against its digest, the descriptor is a draft, the two role sets are equal, every spending system has a ceiling entry, every lockfile hashes, no value and no hidden character anywhere. |
| Check every runtime and binary | `install.check_host`, before the user exists. A missing one stops the deploy naming what and what for; nothing is substituted. |
| Create the home and the declared directories | `useradd`, the install file's `directories[]`, and `~/work/<role>` per directory role. |
| Install dependencies from each lockfile, executing nothing | `install_dependencies`: `npm ci --ignore-scripts --omit=dev` as the agent, in `~/.deps/<the lockfile's digest>/` and never in the package. A node_modules inside the installed package is what the image builder refuses, so an agent installed that way could never be turned into an image afterwards. Two skills naming the same lockfile share one tree; the scripts find theirs through `AGENT_DEPS` and the digest of the lockfile they carry. |
| Bind each system; credentials by name; refuse a value | `install.check_instruction` before anything exists (names, settings, addresses, ceilings present; no value anywhere), then `place_environment`: each credential read from `/home/deploymgr/secrets/credentials/<name>.secret` into `~/.config/fleet/env`, mode 600, which the brain sources. |
| Set each ceiling; stop when a spending system has none | The instruction's `ceilings` map, refused when a required one is missing; placed as `CEILING_<ROLE>`, `_PER`, `_UNIT` and `~/.config/fleet/ceilings.json`. |
| Translate for the harness | `translate_for_harness`: the instructions file, the skills linked where the harness discovers them, the harness configuration with every mcp role, the brain. The per-harness residue is `install.HARNESSES`. |
| Mint the subject, bind the descriptor | `bootstrap` with the named token, then `bind_descriptor`, which reports which members the binding added and changed. |
| Start and check, grade stated | pm2, then `start_and_smoke`: smoke, and called that. |
| Provide and record the egress | Nothing here restricts it yet. A host agent is a Unix user whose outbound traffic nothing filters, and a Cloud Run job or a platform container service runs with no VPC setting, so each record says `"egress": {"policy": "open", "enforced_by": "none"}` (`steps.EGRESS_OPEN`, `service.mjs` `egressOf`). A tenant agent runs on the tenant network, whose firewall the host describes in `DM_TENANT_EGRESS` (`deploymgr-tenant.json`); its record carries that description, and leaves `egress` out when the host gives none, rather than guessing. The enforcement that turns the open records into allowlists is the egress proxy phase. |
| Produce the record | `record.py`, with the package digest, the bound descriptor's digest, credentials and settings by name, ceilings, the egress, dependencies, the ledger, and the checks. |
| The ledger | `write_ledger` to `/opt/fleet/deploymgr-ledgers/<name>.json`, root-owned so the agent cannot rewrite it; `status` rehashes and reports every difference as `drift`. |

**Update** (`update <argfile>`) runs the same steps against a new version
of the same package under the same subject: the version must increase;
every ledgered file is snapshotted to `/opt/fleet/deploymgr-prev/<name>/`
first; a failed smoke check restores the snapshot and restarts, and the
result and the record say `restored: true`. Drift found before the update
is reported in its record.

**Remove** names the credentials it removed and lists what remains.

## When the installer never reaches the machine (12.7.1)

The install above assumes the installer can put files on the host and rehash
them afterwards. An owner may instead run the agent on compute the installer
never touches, and the procedure then splits in two. Each side records the
half it performed and records no part of the other.

| | `image <argfile>` | `container <argfile>` |
|---|---|---|
| Does | fetch and verify; resolve a base from the operator's catalogue; emit the build context; build the image | check the instruction; place the binding; bind each declared directory to the mount; create the Cloud Run job with the image and the mount; run one message through it |
| Satisfies runtimes and binaries | by putting them IN: the base is chosen for what it provides, and the emitted Dockerfile stops the build naming anything missing. Nothing is substituted | not its business; the image settled it |
| Root | no | no |
| Produces | an `agent-build-record-v1` with the image digest and each file's digest as built | the ONE `agent-deployment-record-v1`, naming the digest of the image it started |

The emitter is `../image/emit-image.mjs`, installed beside this file as
`/opt/fleet/deploymgr-emit-image.mjs`; the base catalogue is
`../image/bases/catalogue.json`, the operator's list of bases and what each
one provides.

**The binding is mounted, never baked.** An image is built once and copied
everywhere, so a ceiling number or an mcp address in a layer is bound for
every agent ever run from it, which is what 12.6 rule 3 forbids. So
`container` writes `ceilings.json`, `mcp.json` and `binaries.env` to
`gs://<bucket>/bindings/<name>/`, and the job carries
`AGENT_BINDING_DIR=/mesh/bindings/<name>`. The entrypoint refuses a message
before any work runs when one of those is missing, naming the role and never
a value. Credentials and settings go on the job as variables, through
`--env-vars-file` and never a command line.

**The harness is in the base; the model and its key are on the job.** A
package declares what a host must have and never carries the harness that runs
it (12.9), so the emitter installs none and writes `AGENT_HARNESS_BIN` into
the image. Until 2026-09-11 no base had a program at that path, so every
package whose work is a model reading and writing built cleanly and then
refused its first message. The operator's catalogue now says which bases carry
a harness and where, `emit-image.mjs` resolves a package that wakes a model
onto one of those and refuses when there is none, and the emitted Dockerfile
checks the path the same way it checks every declared binary. Which model the
agent thinks with and whose key pays for it are the owner's instruction, read
off the same argfile key and the same credential store a host deploy reads,
and they go on the job as `AGENT_MODEL` and the provider's variable rather
than into a layer (12.6 rule 3). The harness script in the base refuses the
message naming the model when either is absent, so a container with no key
says so instead of answering nothing.

**The directories are bound at start, never made at build.** A container keeps
nothing between messages: its filesystem is made fresh for every execution.
12.7.1 binds each directory role to storage that outlives a single run, and an
image's own filesystem is not that. So the emitter leaves `{records}` and
`{work}` as placeholders in `run.json` instead of filling them, the image
makes no directory of either name, and `container` puts one variable per
declared directory on the job:
`AGENT_DIRECTORY_RECORDS=/mesh/state/<name>/records`. Per agent, because one
bucket serves the whole fleet; on the job and not on the execution, because
every execution of a job carries what the job carries, which is what lets the
second message of a conversation find the run the first one started. The
entrypoint makes each directory before any work runs and refuses the message
when one is unbound. A directory of the same name inside the image would be
worse than none: the records written to it look filed and go with the
container. `remove` names them under `remaining` and leaves them where they
are.

**What each record leaves out, and why.** An absent member means its producer
did not observe the thing; it never means the thing was not required. A
container deploy carries no `key_custody` (it minted no subject and the image
holds no key), no `descriptor` (the bound Descriptor is signed with the
subject's own key, and there is no subject), no `ledger` (the files are
layers, and the image digest is the answer), and no `exposed_a2a` (the door
belongs to whatever holds the key). A host deploy carries no `image_digest`,
because it started processes and no image.

## How the role's clauses map to code

| Role clause (§11.2) | Where it lives |
|---|---|
| Only on instruction | The brain acts on owner messages; the procedures have no timer and no peer trigger. |
| Secrets named, never carried | `boot_token`, the model key and every service credential are NAMES resolved from a store; `check_instruction` refuses a value before it is used; the record carries names only. |
| Checks graded, grade stated | `record.py` writes `checks[].kind = "smoke"`; AGENTS.md forbids the word "verified" and forbids calling smoke a conformance check. |
| Declarations part of the deploy | `interaction` and `admit` are required deploy parameters; the adapter is started `--unattended` iff service, and admission is applied before first boot. |
| Procedure, not improvisation | `steps.py` fails closed at the first bad step and returns the state; a failure after the home exists leaves an inventory entry naming the step so `remove` can clean it; the brain is told not to work around it. |
| Least power, no driving | The agent runs only the four procedures; it holds no path to operate a deployed agent. |
| A record per act | `record.py`, run after every deploy, update, removal and refusal. |
| Honest removal | `remove` returns a `remaining` list and `credentials_removed`; the mesh has no server-side revocation, so the record states the credential dies by deletion. |

## The one privilege it needs

A single sudoers line lets the `deploymgr` user run the four procedures
as root and nothing else:

    deploymgr ALL=(root) NOPASSWD: /opt/fleet/deploymgr-steps.py deploy *, \
      /opt/fleet/deploymgr-steps.py update *, \
      /opt/fleet/deploymgr-steps.py remove *, /opt/fleet/deploymgr-steps.py status

`steps.py` re-validates every argument itself; the wildcard is a
convenience, not the security boundary.

## When the agent runs in the customer's own cloud project

`docs/customer-cloud-grant-contract.md` is the agreed shape. The customer
makes a service account in their project, grants this deployer's service
account `roles/iam.serviceAccountTokenCreator` on it, and the instruction
then carries

    cloud: { provider: "gcp", project: "<theirs>", impersonate: "<their SA>" }

on `deploy`, `image` and `container`. `remove` takes a name and nothing
else, so the grant is written onto the container inventory row and read
back from there; without that an agent could be put into a customer's
project and never taken out of it.

Four things hold this together and each one is tested:

- **One seam.** `gcloud()` and `gcloud_quiet()` in `steps.py` are the only
  two ways this file starts gcloud, and `gcloud_argv` is the only place
  the program is named. The impersonation flag goes on there, so every
  call for an instruction runs under the customer's account or none of
  them do. A call that skipped the seam would run as US inside THEIR
  project, which is the failure this route exists to prevent, so
  `test_steps.py` reads `steps.py` and refuses a third door.
- **The guard.** The impersonated account must belong to the project it is
  asked to act in (`…@<project>.iam.gserviceaccount.com`). A pairing that
  disagrees is refused before any call is made, with both projects named.
  One deployer service account holds grants from many customers, so acting
  in the wrong one is the shape a bug here takes.
- **Two hops, ours in the middle.** The flag carries a chain,
  `--impersonate-service-account=<ours>,<theirs>`, where the LAST account
  is the identity acted as. Ours is `MESH_CLOUD_DEPLOYER_SA`, the account
  named on the published permission page and the one the customer's
  binding grants to; this host's own identity is the project's default
  compute account, and asking a customer to grant to that would be asking
  them to grant to everything else on the box. A host with no
  `MESH_CLOUD_DEPLOYER_SA` refuses the instruction rather than falling
  back to its own identity.
- **Their secrets stay theirs.** Each secret the job references is created
  in the customer's Secret Manager under the impersonated account and
  given a new version, with the value arriving on stdin and never on a
  command line. Nothing reads it back. The job is created with
  `--service-account` naming the account they granted, so the account that
  owns the secret is the account that reads it — or naming
  `cloud.runs_as` where the customer asked for the two-account split
  `docs/customer-cloud-permissions.md` offers. That second account has to
  be in the same project too, and is refused by the same guard.
- **Readable on the one secret.** Right after the version is added, the
  deploy binds `roles/secretmanager.secretAccessor` on THAT SECRET for the
  account the container runs as. The cheap alternative is that role on the
  customer's project, which reaches every secret they have; this is the
  only reason the published page may say we cannot reach a secret we did
  not create. Written every deploy, because the call is idempotent and the
  runtime account changes the day somebody takes the split.
- **A revocation is not an outage.** A failed impersonation is the
  customer taking the grant back: it is refused calmly, names the role
  that would restore it, and is not retryable. A timeout or a 5xx is an
  outage and is. The act's result carries `cloud` with the outcome, the
  grant record's `state`, `retryable`, and the action log, and `record.py`
  copies it into the signed record.

With no `cloud` in the instruction, nothing above happens: our project,
our credentials, no flag, no log, no `cloud` member in the result.

Every call made in a customer project is also appended to
`/opt/fleet/deploymgr-cloud-actions.jsonl`, one line each — the command
without its arguments, the project, the account, the time, how long it
took and how it went. Their own Cloud Audit Logs show the same calls; the
point is that ours agrees and is offered rather than requested.

## Installing on the host

Copy each file to its `/opt/fleet/deploymgr-*` name (`steps.py`,
`install.py`, `translate.py`, `image.py`, `record.py`, `cloud.py`,
`sign.mjs`), the
pinned schema to `/opt/fleet/deploymgr-plugin.schema.json`, and, for the
image half, `../image/emit-image.mjs` to
`/opt/fleet/deploymgr-emit-image.mjs` with its `bases/catalogue.json`
beside it (or named in `DM_IMAGE_BASES`); make the credential store
`/home/deploymgr/secrets/credentials/` (owned by deploymgr, mode 700)
beside the boot-token store; add the `update` line to sudoers. The image
half needs no sudoers line, because it places no file on this host; it
needs `DM_REGISTRY`, `DM_PROJECT`, `DM_REGION` and `DM_BUCKET` in the
deploymgr user's environment, or those four in each argfile. Nothing else
changes.

For a customer's own project (route D), one more variable and it is NOT a
`DM_` one: `MESH_CLOUD_DEPLOYER_SA`, the same spelling the platform half
uses, holding the account customers grant to
(`agentmesh-deployer@langbench-1528148150979.iam.gserviceaccount.com` on
this mesh). It is read from the environment and never from an argfile,
because an instruction that could name the impersonator could point this
deployer at an identity nobody published. Set it where the environment
survives `sudo` for the deploy, update and remove commands; unset, an
instruction carrying a `cloud` block is refused with the variable named,
and an instruction without one is unaffected.

## Platform-agents bar

This agent runs on the fleet VM, not the platform, so most of the
platform-agents checklist (docs/platform-agents.md) is scoped differently,
but the load-bearing ones apply: it retains nothing a deploy did not
create, it fails absent (a down procedure is a refusal, not a guess), it
carries an ordinary mesh identity, it holds no money, and every act is on
the record. Bounded spend and screening are the open items before it is
exposed beyond the owner.

## Status

Proven live end to end 2026-08-30 (commit b2db648), under the earlier
shape of the procedure. A test agent (questionnaire-responder on Codex)
was deployed through `deploy`, answered over the mesh from its bound
library, produced a §11.3 record, and was removed through `remove` leaving
nothing behind.

Done since:
- **The brain is live.** `deploymgr.platform@agentmesh.ai` runs on the
  fleet, a Codex-backed agent that reads a deploy request off the mesh and
  runs the procedures itself.
- **Signing works.** Records are signed with the deployment manager's
  identity key through the adapter's own bundled nkeys.js.
- **Spend guard.** Two fail-closed ceilings before a deploy does any work:
  concurrent deployed agents (`DEPLOYMGR_MAX_AGENTS`, default 10) and a
  rolling 24h deploy rate (`DEPLOYMGR_MAX_DEPLOYS_PER_DAY`, default 20).
- **The chapter's install (2026-09-05).** The ten steps above, `update`
  with restore, honest `remove`, `status` with drift, and refusal records.
  Installed on the fleet host the same day and proven with a test package
  carrying a service role, a setting and a ceiling: deploy, drift after a
  hand edit, update under the same subject, a refused repeat, and a clean
  remove, four signed records (docs/install-proof-walk.md). The same
  evening the explainer's own package went through twice: dependencies
  from a real lockfile, chromium found and named to the agent, two real
  credentials placed by name, and the package's scripts run under that
  environment (browser sweep, a clip with the voice key under the ceiling,
  prefix-only staging). Not exercised: the restore on a failed update
  check (honesty list 56).
- **The split install (2026-09-11).** `image` and `container` walked end to
  end with the process-runner package: the package fetched and verified over
  HTTP, the base resolved from the catalogue, the image built on Cloud Build
  (`gcr.io/langbench-1528148150979/deploymgr/process-runner@sha256:58eea467…`),
  a build record naming that digest and 30 files as built, the three binding
  files placed on `gs://example-agent-state/bindings/process-runner-probe/`,
  the Cloud Run job `process-runner-probe-worker` created with the image by
  digest and the bucket mounted at `/mesh`, and one execution answering a
  probe message by running the package's own command with no model woken.
  Not exercised: a package with a credential, a setting, an mcp address or a
  ceiling through this path; `remove` against a container.
- **A harness in a container (2026-09-11).** explainer-critic, the first
  package containerised whose work is a model reading and writing. Two harness
  bases built and catalogued; the package resolved onto the chromium one with
  no base named; the image built and the Cloud Run job created with the model
  on it and the provider's key from the owner's store. One real message went
  through: chromium played the staged draft at both window sizes inside the
  container, twelve screenshots and a play log and a checklist landed in the
  records directory on the mount, and the review came back as the job's one
  piece. Not exercised: `container` itself was not the thing that ran, because
  it runs on the fleet host; its pure half (the binding documents, the job
  variables, the gcloud argument vectors) produced every artefact and the
  calls made were the ones those functions emit.

What stands in for screening today:
- **Access screening is real.** Only callers the owner admitted reach the
  agent at all (the admission roster; a stranger's first message is held).
- **Request validation is real.** `steps.py` refuses malformed parameters,
  a secret value anywhere in a request, and any package URL that is not on
  an allowed host.
- **Injection is contained.** Even a prompt-injected brain can only `sudo`
  the four procedures (the sudoers scope); everything else it does is as
  the unprivileged `deploymgr` user.
- **Content screening (Model Armor) is NOT wired**, and is not configured
  on any fleet agent today.
