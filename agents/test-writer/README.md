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
node --test test/*.test.mjs                                   # 72 tests
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

## Replacing it

This is a reference implementation. Any agent that holds the test writer role
can take its place.
