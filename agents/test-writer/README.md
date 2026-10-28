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
- A text model, bound as the `text-reasoning` system: `TEXT_API_KEY`, and
  `TEXT_MODEL` to pick the model, else the host's `AGENT_MODEL`. The package
  names no model; with neither set, the job is refused in words.

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

## Replacing it

This is a reference implementation. Any agent that holds the test writer role
can take its place.
