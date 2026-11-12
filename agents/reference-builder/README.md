# Reference builder

This agent is the reference builder of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html): the
ADLC plugin for Claude Code (`plugin/` in this repository), run headless. One
builder writes an agent from its spec through its code, in two phases (the
spec, which the person approves, then the build), and the plugin's check
decides. This agent is the harness around that builder, with no
person at the keyboard. It is not a second author: it writes none of a build's
files.

## What it does

Its one offering, `build-an-agent`, takes the person's words and moves one
build:

- A request starts a build folder through the coding harness with
  `/adlc:start`, and the harness carries the build as far as it can.
- At each decision that is the person's, the harness's question is the reply,
  with the build's id (`b-` and eight characters) and its phase.
- A message that names the build (`b-abc12345: yes, to the author`) resumes
  the same harness session with the person's words. The words go into the
  build folder's `said.md` first, so the check can find the words an answer
  quotes; the harness runs with `ADLC_NOT_THE_PERSON=1`, so the agent's own
  prompts are never kept as the person's.
- `b-abc12345: approve` is the person's approval of the spec, offered only when
  the check says the spec waits for the person. The agent runs the folder's
  own approval (`node .adlc/approve.mjs`) on that word and no other, then the
  harness carries on with the build until the check says it has passed.
- It refuses a message about a build it does not keep, asks for the request
  when a message has no words, and says so when the harness cannot be run.

After each run the build folder's own check says where the build is, and the
reply says it in the check's words: the spec still has things missing, the
spec waits for the person's approval, the build has things missing (and how
many), or the build has passed. It never says the build has passed when the
check does not.

## What it needs

- Node 22 or later. The script uses only node's own modules.
- The `coding-harness` command on the host, declared as a binary in its
  runtime requirements and installed with the ADLC plugin. It takes
  `--prompt-file <file>` and, to resume, `--session <id>`, and answers with
  JSON carrying `result` and `session_id`. A wrapper around a coding assistant
  run headless with the plugin's folder is enough. The model is the harness's,
  reached through the four model settings it inherits.

## How it was built

Through the plugin itself: `request.md`, `spec.json` (approved),
`architecture.json` and `answers.json`, then the generators for
`architecture-record.md` and the agent's own files from `prose.json`, the
standard checks under `test/`, the scenario tests, and the script. Version
0.2.0 was revised the same way: the person's changes added to `request.md`,
the spec revised and approved, then the build, which passed the plugin's
two-phase check, including the Common Agent packer.
`plugin/test/reference-builder.test.mjs` holds the files to what the
generators write from those sources.

## Running the tests

```sh
node --test test/*.test.mjs
```

## Replacing it

This is a reference implementation. Any harness that runs a coding assistant
with the ADLC plugin and passes the person's words through can take its place.
