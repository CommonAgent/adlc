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
  `TEXT_MODEL` to pick the model. The default is Claude on Google Vertex AI.

## Running it

```sh
node --test test/*.test.mjs                                   # 55 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`references/` holds an example suite and the spec it tests, which the model
reads as the shape of a good suite.

## Replacing it

This is a reference implementation. Any agent that holds the test writer role
can take its place.
