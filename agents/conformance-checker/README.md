# Conformance checker

This agent holds the [conformance checker](https://agentroles.ai/conformance-checker.html)
role for the Conformance stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). On
AgentMesh it runs under its older name, agentevaluator.

It says whether a running agent does what its package says. It never writes a
test from its own opinion: every case is derived from the package's own
declarations (its offerings, its refusals, the records it promises, any trial
it declares), run against the agent, and reported as a signed verdict. An agent
conforms only when nothing failed, nothing was inconclusive and every promised
record was found. It does not grade how good the work is; that is flagged for a
person. For a container agent, which has no package to derive cases from, it
runs the conformance check published with the role the agent claims.

## The parts

- `eval-gen.mjs` derives the cases from a package:
  `node eval-gen.mjs <package folder>`. It runs anywhere with node. It
  reads the draft Descriptor from `agent-descriptor.json`, or from
  `descriptor.json` in a package built before Common Agent 0.30.0-draft. With
  `--agent <handle>` it reads the agent's own Descriptor through the Common
  Agent entryway instead (exchange 2, Sections 4.4 and 4.9, in
  `entryway.mjs`): the bytes and their digest, the digest checked against the
  bytes, and the spec names it as `descriptor_sha256`.
- `eval-run.mjs` sends the cases to the agent through one transport function
  (the mesh adapter by default; another can be passed in), audits its records
  and signs the verdict: `conforms`, `does-not-conform` or `inconclusive`.
  A refusal whose words say the request is declined must be declined; one
  whose words say the request is handled as ordinary input (the link treated
  as words, the instruction reversed and not obeyed) must be answered, and a
  refusal about fetching carries a link to the reserved example page whose
  words must not come back. A reply in which the host says the job was not
  run is the host's, so it judges nothing.
  When the spec carries `package_sha256` and `package_version`, as the
  deployment manager's spec does after each deploy, the verdict names the
  package's digest, which binds it to that version, and a spec derived from
  the agent's own Descriptor names that Descriptor's digest the same way.
- `derive-test.mjs` answers the `derive-test` offering: the cases a package
  gives rise to, shown and never run (with no package, from the Descriptor the
  registry serves for a named agent). The brain hands it any request that
  names `derive-test`, without waking a model.
- `role-check.mjs` runs a role's own conformance check against a container
  agent's image, in Cloud Build.
- `input-cases.mjs`, `input-check.mjs`, `trial-cases.mjs` and `trial-check.mjs`
  derive and send the input and trial cases.
- `sign.mjs` and `submit-record.mjs` sign the verdict and file it.
- `pyjson.mjs` writes JSON as these scripts always have (they were Python
  until 2026-11-11), so a record, a spec or a reply is byte for byte what it
  was, and takes the canonical form a signature covers.
- `process-verdict.mjs` is the process kind (`check-a-process`): an installed
  process's document checked against Agent Processes (§17.1) and every test
  case of the suite the package maker signed read back as the platform's test
  runs, into one agent-eval-record-v1 with `kind: "process"`, filed with the
  registry under `process.<team>.<slug>`. The cases are the process's own,
  never the checker's. The brain hands it the message first, as the ops node's
  user (`host/agenteval-process-as-node.sh.tmpl`), and no model is woken.
- `AGENTS.md` is the instructions the agent's harness reads.
- `host/` holds the agent's descriptor, listing and brain.

## What it needs

- Node 22 or later. (Building a package to check with the package maker still
  needs Python, as below; the checker does not.)
- To run cases against a live agent: the mesh-adapter installed globally (for
  its libraries and the agent's identity), mesh credentials for the evaluator,
  and the agent's handle and records folder.
- For role checks: Google Cloud Build in a project you name.

## Running it

```sh
python3 ../package-maker/build.py ../publisher /tmp/pkg
node eval-gen.mjs /tmp/pkg/publisher            # the cases it would run
node --test test/*.test.mjs
```

## What runs only inside AgentMesh today

Deriving cases and the tests run anywhere. Running them needs a mesh: the
mesh-adapter's libraries at `/usr/lib/node_modules/mesh-adapter`, the fleet
layout under `/opt/fleet`, and the AgentMesh registry the verdict is filed
with.

## Replacing it

This is a reference implementation. Any agent that holds the conformance
checker role can take its place, and the role's rule stays the same: the cases
come from the package, never from the checker.
