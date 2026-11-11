# spec-writer 0.10.1: the Design keeps the settings, the model system and a granted service

Date: 2026-11-11.

## Why

In build b_6e496a709479 (hn-digest) the approved spec listed two counts,
`stories_to_read` and `digest_size`, of kind `integer` and set by either, and
the public Hacker News API at its address. The architecture record named one
system, `text-reasoning`, and asked the Hacker News API as egress, which the
owner granted ("egress-1: yes"). The Design wrote agent-runtime-requirements.json
with no systems and an agent-descriptor.json with no run config. The code
critic and the security reviewer then refused the code, which read the model
settings and the two counts with nothing declaring them and carried the
Hacker News address written into it. Three gaps, each in the Design:

1. `isRunConfig` took only the kinds run-config, preference and rule, so a
   setting of kind integer was dropped.
2. `systemsOf` built systems only from the spec's systems, so a model system
   the record names and the spec does not list was never declared.
3. `fitToArchitecture` dropped every system the record does not name, and
   the architect records a keyless public service as egress, not as a
   system.

## What changed (from 0.10.0)

- scripts/structure.mjs: a setting a person or a job sets (`set_by` person
  or either) whose kind the install does not place (address, environment,
  credential) is a run-config preference, with its default, range, values
  and step. Each model system the record names is declared as kind model
  with its protocols where the spec lists none, and a job then says
  intelligence called and cost metered. A service with a fixed address and
  no address setting in the spec gets one named for it
  (`PUBLIC_HACKER_NEWS_API_ADDRESS`), with the address as its default.
  `withGrantedServices` adds to the record's systems each service of the
  spec that a destination the record's egress grants names.
- scripts/asked.mjs: `grantedEgressIn` reads the destinations the record's
  Egress section marks "(granted by the person)", and the reading of a
  record carries them as `egress_granted`.
- scripts/draft.mjs: `designFromSpec` holds the files to the record with its
  granted services, and the notes say which were kept and why.
- references/what-a-good-spec-carries.md: the spec part names the six kinds
  a setting may have; the Design part says what the structure now declares.
- rules.md and README.md say the same.
- test/design-keeps-systems.test.mjs: six tests, on the hn-digest case.

321 tests, 320 pass, 1 skipped. The standards' 168 pass. Written by the
harness (Claude Code) directly; no model was run.
