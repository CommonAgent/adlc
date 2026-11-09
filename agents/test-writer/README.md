# Test writer

This agent holds the [test writer](https://agentroles.ai/test-writer.html) role
for the Test stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It writes the test suite a package's scripts will have to pass, from the spec
and before any script exists. Then it proves the suite asserts something: run
against empty stand-ins for every script, the suite must fail. Its second job
runs a finished package's suite with each script blanked in turn, and names
every break the suite did not notice.

Writing the suite first, by something that will not write the code, is what
turns the Code stage into a stage with an input, an output and a check the code
writer does not control.

## Written from the spec

The spec is what Requirements hands back (spec-v1,
[standards/spec.schema.json](../../standards/spec.schema.json)): each feature
with its requirements and the exact words, patterns and numbers each fixes,
acceptance scenarios in Gherkin, the interfaces that must be kept, and the
constraints. The job command finds it among the attachments by its format,
under whatever name it came, and the writing step gives it to the model whole,
in a section of its own, ahead of what the agent's own files declare. The
agent's own files still come (from Design): they name the scripts, the command
lines and the records the tests run.

Three checks hold the suite to the spec, with no model, and go back to the
model once, as findings (`scripts/spec-rules.mjs`):

- every acceptance scenario has a test named with its id in square brackets,
  `[F1.A1] ...` (Product Factory maps tests to features by the F number);
- every entry of `exact` of a requirement whose verify is `test` is carried
  by a test named for its feature: words and patterns byte for byte, a number
  as the number;
- every kept file or message with a schema is held by a test, with
  `checkKept` or `keptProblems`.

A fifth standard file, `test/kept-interfaces.test.mjs`, is made from the spec
by code (`scripts/kept-interfaces.mjs`, from the master copy in references/),
for every interface with `keep: true`: a function is exported under that name
from that module, async as its signature says; a command accepts its flags;
and what a job writes to a kept file is held to its JSON Schema. Its tests are
named by interface id, `[I4] ...`. What it cannot check (an http interface, a
function with no module) is said beside the suite. In a revision, the spec's
id for a scenario names a test the way its name does.

A build before stages.json 1.6.0 sends no spec. The suite is then written from
the agent's own files alone, as before, and the reply says the job went without
the spec.

## Test cases for a process

Its third offering, `write-test-cases`, is for a build whose artifact is a
process. Given an Agent Processes 0.9.0 document (https://agentprocesses.ai/spec.html),
it writes the test cases section 21 describes, one file each
(`<name>.test.txt`: `TEST:`, `carried:`, `answer:`, `stand-in:`, `expect:`),
named and pinned to the document's digest, which the code writes so the
model never gets it wrong. Its rule: every phase a person signs (`never` or
`supervised`) is answered approve, changes and reject at least once across
the suite, and every way back is taken at least once, by a `changes:` answer
naming the way's key in square brackets. `scripts/check-cases.mjs` refuses a
suite that misses one, by name, and is run over every suite before it goes
(`node scripts/check-cases.mjs --process <document> <folder>`). The job
command (`scripts/job.mjs`) sends a message here when what came with it is a
process document, found by content, and no agent's files.
`scripts/process-check.mjs` is [standards/process-check.mjs](../../standards/process-check.mjs)
byte for byte.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model: the system of kind `model` named
  `text-reasoning`, reached through the shared caller
  (`scripts/model-caller.mjs`) and the four settings the install places:
  `MODEL_NAME`, `MODEL_ENDPOINT`, `MODEL_KEY` (empty for a gateway on the
  host) and `MODEL_PROTOCOL` (`anthropic-messages`, `openai-chat` or `gemini`, the three
  formats the shared caller speaks), read on every run. The
  package names no model and no address of its own. With a setting missing the job is refused in words.

## Running it

```sh
node --test test/*.test.mjs                                   # 246 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`references/` holds an example suite and the spec it tests, which the model
reads as the shape of a good suite, and `delivered-formats.test.mjs`, the
standard format check copied into every suite this writes: each delivered
piece must be what its declared kind says (Markdown with its convention's
headings, a JSON kind with its declared shape, HTML, an address, a signed
binary), and the model's tests call its `checkDelivered(jobDir)` on every job
folder they fill.

`records-per-job.test.mjs` is the second standard file copied into every
suite: every job of an agent shares one records folder, so a record the
declaration keeps per job (a `file` pattern such as `*/went-without.json`)
goes under a folder named after the job folder, and the model's tests run two
jobs with one records folder and call its
`checkRecordsPerJob(records, [jobDir1, jobDir2])` (technical debt 639).

`worked-values.test.mjs` is the third: every expected value a rule in the
spec decides is a constant at the top of its file,
`worked(value, () => computation, what)`, the literal and a computation over
the same input in the test itself. Before the suite is delivered every worked
value is checked against its own computation, and one that disagrees goes
back to the model with both values named (technical debt 646).

`printed-reply.test.mjs` is the fourth, and runs on its own: it runs each
job's command the way the host does, with an empty message, and reads the
reply the way the host does, `stdout` or `json:<member>` of the one JSON
object printed. A reply that is empty there is a job the host records as
stopped and tells the sender was cut short, so the suite fails at the code
step instead of at Conformance (technical debt 657). Its reading is held to
the host's (agents/image/one-message.mjs) by test/printed-reply.test.mjs.

`kept-interfaces.test.mjs` is the master copy of the fifth, which is not
copied whole: its `KEPT` line is filled with the spec's kept interfaces, so
the same spec always gives the same file, and a spec that keeps none gives
none.

## Replacing it

This is a reference implementation. Any agent that holds the test writer role
can take its place.
