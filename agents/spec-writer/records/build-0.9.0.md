# spec-writer 0.9.0: Requirements hands back the spec, and the agent's files are made from it

Date: 2026-11-09.

## Why

Until now the spec writer's spec was the agent's own declaration files
(agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the
SKILL.md files). That is a descriptor, not a spec: a spec is the analysis of
the product's functional requirements and capabilities. Because there was no
real spec, every detail with no place in a descriptor was lost before Test.
In a round trip on hn-reader the as-built record captured the runner's stop
pattern, the page-metadata sources, the refusal wording and the output schema
exactly, and none of them reached the tests or the code. Over eight rounds of
Ask for changes the model also redrafted the whole draft each time and ignored
the words that named a change five times, and the last draft stopped at
Package because an output's about carried an address.

The standard changed first (stages.json 1.6.0, standards/spec.schema.json
spec-v1, lifecycle API 0.4.8). This build is the reference implementation of
it.

## What changed (from 0.8.2)

- The job hands back the spec first: out/spec.json, valid against
  standards/spec.schema.json, and out/spec.md, the same spec readable by a
  person (scripts/spec-v1.mjs: a validator with no dependencies, in the
  pattern of standards/lifecycle-api-check.mjs, and the Markdown).
- scripts/seed.mjs seeds the spec from an as-built record (agents/
  reverse-engineer 0.2.0) with no model: each behavior a feature (as_built:
  B<n>) unless the person dropped it or called it a bug; each quote a wording
  or pattern requirement with the quote in exact; each rule a requirement of
  its kind with its values in exact; each refusal and error handling a
  requirement in its words; each constant with its value; each interface
  kept, a function with its module and signature, a command with its flags, a
  file with its schema from schemas/; each address the code reaches a system
  with an address setting, each address it only writes down a system with
  reach none; the record's settings, with an open question for each default
  it withholds. A feature keeps the id the person approved it under.
- scripts/spec.mjs writes the spec: the model answers a seeded spec with a
  fill by id (the shall lines, the purpose, Gherkin scenarios and open
  questions), and code keeps every value it seeded; without a record it
  drafts the whole spec from the person's words. Two goes at most, with the
  findings on the second, inside SPEC_SECONDS (300).
- scripts/spec-check.mjs: schema valid, unique ids, every feature with
  requirements and a Gherkin scenario (Scenario, Given, When, Then) that
  checks ids it has, every quote, rule value, refusal and interface of the
  record byte for byte, no exact value nothing given states, and the name,
  price and access the person's. After the last go, code writes a scenario
  for a feature still without one, moves an invented value to open, and takes
  back a name, a price or a system nobody gave.
- scripts/revise.mjs: a revision is edits addressed by id to what the
  person's words name, applied by code; every other part stays byte for byte,
  checked by rule. A keyed name, version or price is set by code with no
  model, and words that name nothing in the spec leave it as it was.
- The Design: draft.mjs runs the spec and then the agent's own files in one
  run, so the job's commands do not change. The drafting request carries the
  spec in place of the as-built record (scripts/design.mjs), and its given is
  the spec (scripts/given.mjs, givenOfSpec). Every fit of 0.8.x stays (scripts
  named, the packaged command path, address settings, runtime, price). New:
  no address anywhere in the files but an address setting's default (a
  finding while the model has the draft, then each written as its host), the
  spec's address setting names and defaults, each host only written down
  named in a service's needs, and the name, version and price the spec's.
- scripts/json-in.mjs holds the JSON reader both drafting steps use.
- scripts/asked.mjs reads a spec-v1 attachment as the spec, and a revision
  with none attached takes the newest spec an earlier job wrote.
- scripts/pieces.mjs files out/spec.json and out/spec.md, each only while it
  is byte for byte what the drafting step wrote; a container agent's draft
  moves from out/spec.json to out/agent/spec.json.
- scripts/ask.mjs: the reply opens with the spec (its product, features,
  requirements, scenarios and interfaces kept), says what a revision changed,
  and then the agent's own files; its JSON adds `spec`, the counts.
- The descriptor: write-a-spec's outputs now open with the spec
  (application/vnd.agentmesh.spec+json) and the spec, readable
  (text/markdown); job_seconds is 900; spec.schema.json is pinned and
  carried. The reference, the rules, the README and the skills say the spec
  comes first.
- Tests on a small synthetic as-built record (test/fixtures/as-built):
  test/spec.test.mjs, test/revise.test.mjs and test/design.test.mjs.

## On the round trip's own record

With no model (a stand-in answering an empty fill), the seeding and the
checks over the real hn-reader record of 2026-11-09: 12 features, 96
requirements (12 behavior, 25 pattern, 19 wording, 13 interface, 9 limit, 8
order, 6 refusal, 2 default, 2 error), 2 constraints, 27 interfaces all kept,
3 systems (the Hacker News API, the pages the stories link to, and
news.ycombinator.com with reach none), 2 settings, 2 open questions (the
price and the default of count). All 94 things the record fixes (42 quotes,
19 rule values, 6 refusals, 27 interfaces) are in the spec byte for byte,
and the checks find nothing once code wrote the 12 scenarios the stand-in
did not. The Design's fits over the draft that stopped at Package take its
two addresses out, name its address setting as the spec does, and leave no
address in any of the files.

Replaying that round trip's seven Ask for changes messages against this spec,
with a stand-in that answers no edits: "Price: free" (rounds 2 and 3) is set
by code; the words of rounds 5 and 7, which are about the job's command and
settings in the agent's files, name nothing in the spec, so it stays byte for
byte with no model call and the words go to the files; rounds 4, 6 and 8 name
one interface or system each, and only that part could change.

297 tests, 296 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
