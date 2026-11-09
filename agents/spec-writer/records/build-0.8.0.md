# spec-writer 0.8.0: keep what the given names, and declare what it reaches

Date: 2026-11-09.

## Why

A round trip on 2026-11-09 reverse engineered a working agent (hn-reader),
rebuilt it from the as-built record with Product Factory, and ran the
original's tests against the rebuild: 0 of 21. Three of the losses started in
this writer's draft:

- The first draft put the count setting inside the job, where the files drop
  it, declared no runtime though its one command ran node, and had no price
  (one Ask for changes fixed it).
- It sketched the output as `{stories, read}`, a shape the record never
  stated, and the test writer and the code writer built that shape.
- It declared the two services the agent reaches with no address setting and
  a reason that said "request", so the scripts read the address from a
  variable nobody declared, the security reviewer refused the package at
  Code, and nothing at Code could change the spec. The instruction had told
  the model that a public read's address is a constant in the script, which
  Common Agent 12.6 rule 2 and the repository's address check forbid.

## What changed (from 0.7.3)

- scripts/reaches.mjs (new): every service reached over the network, other
  than a model system, draft-host or a product bound with a credential, has
  an address setting (a variable ending `_ADDRESS`, `_URL`, `_BASE`,
  `_ENDPOINT` or `_HOST`, the security reviewer's own pattern) whose
  `default` is the real address and whose host its `needs` names, or says in
  its `needs` that it fetches what it is handed. checkDraft runs it.
- scripts/given.mjs (new): reads, by rule, what the given names (words in the
  as-built rendering, a Settings or Egress section, as-built JSON parts, a
  JSON Schema, an agent's own files) and checks the draft keeps every setting,
  the runtime, the price, each reached address, each schema's properties and
  constants, each quoted word or pattern and each exported function. An
  output of a JSON kind whose shape the given does not state is a finding if
  sketched, and after the last go a blank, `shape of <output>`. After the last
  go code also moves a job's `run_config` to the spec and adds the runtime
  and price the given names.
- scripts/check-spec.mjs: an address setting's `default` is the one place an
  address may sit in a system; the finding for an address elsewhere says so.
- scripts/draft.mjs: the instruction says where an address goes and to keep
  what the given names; askForSpec holds the draft to the given and fits it;
  the findings that still stand are written into blanks.json.
- scripts/ask.mjs: the reply says those findings, and names each address
  setting the install supplies with its default (the install file never
  carries the default).
- rules.md, references/what-a-good-spec-carries.md, README.md and the
  draft-the-spec skill say the same. plugin.json and three SKILL.md files
  list the two new scripts.

## What stays

Its name, price, offerings, inputs, outputs and records. A spec that
shipped before is measured by checkSpec as before; the new rules hold new
drafts.

## Tests

test/given.test.mjs (11) and test/reaches.test.mjs (12), model-free with
small synthetic drafts. Four fixtures changed to say what the new rules ask:
the run-reply drafts declare node, the architecture draft declares the
record's setting, and two tests read the new wording. 262 tests, 261 pass,
1 skipped (as before).

The harness wrote the change; the spec-writer, test-writer and code-writer
were not used on themselves.
