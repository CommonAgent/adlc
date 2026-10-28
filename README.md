# The Agent Development Lifecycle

The Agent Development Lifecycle (ADLC) is the ordinary software lifecycle,
written for work that agents do. It runs from deciding what an agent should do,
through writing, testing, packaging, deploying and proving it, to updating it
and finally retiring it. Each stage names the role that holds it, what the
stage is given, what it hands back, and how anyone can tell the stage is
finished. Every handoff is a written artifact, so the next stage can start the
moment the last one ends.

The lifecycle is published at [agenticdevelopment.ai](https://agenticdevelopment.ai).
This repository holds working agents for its roles.

## The lifecycle is yours to customize

The ADLC is a reference, not a mandate. Use it as it stands, or shape it to
your organization:

- add stages your work needs, such as a legal review or a load test;
- drop stages you do not need;
- fill any role with your own agent, a vendor's agent, or a person;
- run the stages in your own order, under your own processes.

The roles are written down separately at [agentroles.ai](https://agentroles.ai),
so an agent you build can hold a role here as fully as the agents in this
repository do. The processes that run the lifecycle, such as making a new agent
or retiring one, are published at [agentprocesses.ai](https://agentprocesses.ai).

## The one requirement

Whatever lifecycle you run, it ends in a valid Agent Package. A package is the
declaration of what the agent does and refuses, its parts, a manifest and a
digest, in the open format defined at
[commonagent.net/package.html](https://commonagent.net/package.html). The
package is the shared gate: a platform that installs agents checks the package,
not the path that produced it. Build your agent any way you like, and hand over
a package that validates.

## The agents in this repository

These are AgentMesh's own role agents, published as reference
implementations. Each one holds a role on agentroles.ai. Each one can be
replaced by any agent that holds the same role.

| Stage | Role | Folder | Runs on its own? |
|---|---|---|---|
| Architecture and Design (architecture) | [solution architect](https://agentroles.ai/solution-architect.html) | None | There is no reference agent for this role. A person or any agent that holds the role can do it. |
| Requirements, Architecture and Design (design) | [spec writer](https://agentroles.ai/spec-writer.html) | [agents/spec-writer](agents/spec-writer) | Yes, with a model key |
| Requirements, Architecture and Design (design) | [solution planner](https://agentroles.ai/solution-planner.html) | [agents/solution-planner](agents/solution-planner) | Yes, with a model key |
| Impact | [impact analyst](https://agentroles.ai/impact-analyst.html) | [agents/impact-analyst](agents/impact-analyst) | Yes; filing what is owed needs the platform's ledger |
| Source | [catalog](https://agentroles.ai/catalog.html) | [agents/catalog](agents/catalog) | The matching logic does; the agent runs inside the AgentMesh services |
| Test | [test writer](https://agentroles.ai/test-writer.html) | [agents/test-writer](agents/test-writer) | Yes, with a model key |
| Code | [code writer](https://agentroles.ai/code-writer.html) | [agents/code-writer](agents/code-writer) | Yes, with a coding harness |
| Review | [code critic](https://agentroles.ai/code-critic.html) | [agents/code-critic](agents/code-critic) | Yes, with a model key |
| Package, Release | [package maker](https://agentroles.ai/package-maker.html) | [agents/package-maker](agents/package-maker) | The builder does; packing a run's work needs a fleet host |
| Deploy, Update, Rollback, Reconfigure, Decommission | [deployment manager](https://agentroles.ai/deployment-manager.html) | [agents/deployment-manager](agents/deployment-manager) | No, it needs an AgentMesh fleet host |
| Conformance | [conformance checker](https://agentroles.ai/conformance-checker.html) | [agents/conformance-checker](agents/conformance-checker) | The checks do; the agent needs a fleet host |
| Docs | [documenter](https://agentroles.ai/documenter.html) | [agents/documenter](agents/documenter) | No, it runs inside the AgentMesh services |
| Docs (the documentation) | [doc writer](https://agentroles.ai/doc-writer.html) | [agents/doc-writer](agents/doc-writer) | Yes, as a built package |
| Publish | [publisher](https://agentroles.ai/publisher.html) | [agents/publisher](agents/publisher) | Yes, with a place to publish to |
| Incident response | [incident recorder](https://agentroles.ai/incident-recorder.html) | [agents/incident-recorder](agents/incident-recorder) | Yes, as a built package |

The Architecture and Design stage has two parts, and the architecture comes
first. The solution architect, or a person, names the systems the agent
reaches and the product bound to each one in each environment, and records
every decision with its reason. The spec writer and the solution planner then
design within those systems.

[agents/image](agents/image) is not an agent. It holds the tools the deployment
manager uses to turn an Agent Package into a container image's build context,
and they run with node alone.

Each folder's README says what the agent needs and states plainly anything that
only runs inside AgentMesh today.

## Layout

- `agents/<role>/` holds one agent. The packages written for the lifecycle
  (spec writer, solution planner, test writer, code writer, code critic,
  publisher) are
  package sources: the agent's own files (`agent-descriptor.json`,
  `agent-runtime-requirements.json`, `plugin.json` and `skills/<slug>/SKILL.md`,
  the layout Common Agent 13.2 says a package is authored in), the scripts,
  their tests and their reference files. The package maker turns a source like
  this into an Agent Package.
- `agents/<role>/host/` holds what a fleet host needs to run that agent: its
  descriptor, its listing and the brain the fleet supervisor wakes per message.
- `agents/image/` holds the image tools: the emitter that turns a package into
  a build context, the entrypoint that answers one message in a container, the
  wake host a container agent sleeps behind, and the base image contexts.
- `host/` holds the one-time bootstrap that installs the package maker, the
  deployment manager and the conformance checker on a fleet host.
- `env/` holds the environment reader the agents and host templates use, with
  an example environment to copy.

## Running the tests

Node 22 or later, and Python 3.11 or later for the package maker and the
deployment manager. From the repository root:

```sh
export AGENTMESH_ENV=example
for a in spec-writer solution-planner test-writer code-writer code-critic publisher incident-recorder doc-writer impact-analyst; do
  (cd agents/$a && node --test test/*.test.mjs)
done
node --test agents/conformance-checker/test/*.test.mjs
(cd agents/deployment-manager && python3 -m unittest discover -p "test_*.py" && node --test "test/*.test.mjs")
node --test "agents/image/test/*.test.mjs"
(cd agents/catalog && npm install && npm test)
```

CI runs the same set on every push. Some suites of the package maker, the
deployment manager and the image tools build real packages from the AgentMesh
repository; their READMEs say which, and `ADLC_PACKAGES` points them at a
folder of packages when you have one.

## Notes in the code

The code keeps its working notes. Comments cite AgentMesh design documents
(`docs/...`), technical debt items by number, and dated decisions by the owner.
Those documents live in the AgentMesh repository and are not published here;
the code and its tests are the authority.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
