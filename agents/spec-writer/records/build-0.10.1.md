# spec-writer 0.10.1: the Design declares the record's systems, the settings and the ceiling

Date: 2026-11-11.

## Why

In build b_6e496a709479 (hn-digest) the approved spec listed two counts,
`stories_to_read` and `digest_size`, of kind `integer` and set by either, and
the public Hacker News API at its address. The architecture record named one
system, `text-reasoning`, and asked for the Hacker News API as egress, which
the owner granted ("egress-1: yes"), with a limit of 1 USD per day. The
Design wrote agent-runtime-requirements.json with no systems and no
ceilings, and an agent-descriptor.json with no run config. The code critic
and the security reviewer then refused the code, which read the model
settings and the two counts with nothing declaring them and carried the
Hacker News address written into it.

Jeff decided how a keyless public service is recorded: it is a system of the
record, bound to the service itself (architecture standard 1.1.0, section
2), and the Design declares exactly the record's systems.

## What changed (from 0.10.0)

- scripts/structure.mjs:
  - a setting a person or a job sets (`set_by` person or either) whose kind
    the install does not place (address, environment, credential) is a
    run-config preference, with its default, range, values and step;
  - every system the record names is declared: a model system as kind model
    with its protocols, and a public service bound to itself as a service
    whose address setting (`HACKER_NEWS_ADDRESS`) has the binding's address
    as its default, matched to the spec's service by the host of its
    address, even where the spec lists neither. A job then says
    intelligence called and cost metered;
  - a service with a fixed address and no address setting in the spec gets
    one named for it;
  - the record's `cost_limit` is the model system's ceiling (Common Agent
    Section 12.4, item 4): `spends` in the limit's currency, and
    `ceilings[]` naming the system, per task or day, with the number as
    `suggested` (`ceilingOf`).
- scripts/files.mjs: a model system's ceiling says `enforced_by: runtime`,
  as the package maker derives it.
- scripts/asked.mjs: the reading of a record carries its `cost_limit`.
- scripts/architecture-record.mjs: the solution architect's copy, with the
  public binding and the `cost_limit` header field.
- references/what-a-good-spec-carries.md: the spec part names the six kinds
  a setting may have; the Design part says what the structure declares.
- rules.md, README.md and the descriptor say the same.
- test/design-keeps-systems.test.mjs: seven tests on the hn-digest case,
  from the record the solution architect writes for it
  (test/fixtures/hn-digest), whose files the security reviewer's test
  reviews.

322 tests, 321 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
