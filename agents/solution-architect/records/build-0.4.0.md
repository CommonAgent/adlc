# solution-architect 0.4.0: an approved public service is a system bound to itself

Date: 2026-11-11.

## Why

In build b_6e496a709479 (hn-digest) this agent asked for the public Hacker
News API as egress, and the owner answered "egress-1: yes". The record still
named only `text-reasoning`, so the Design, which declares exactly the
record's systems, dropped the service, and the script carried the address
written into it. Jeff decided that a keyless public service the owner
approves is a system of the record, bound to the service itself
(architecture standard 1.1.0, section 2).

## What changed (from 0.3.1)

- scripts/name.mjs: the model says, for a destination that is one public
  service at one fixed address with no key, its `service`: a system name, the
  access and the address. A system made from an approved destination needs
  no quote of the statement of its own.
- scripts/standard.mjs: that address is kept out of the scrub and is the one
  address the checks let through. The egress question names it. A yes makes
  the destination a system (`hacker-news`, read, public) and takes it out of
  the egress; a no leaves it out; a later round keeps a system the earlier
  record bound to itself.
- scripts/bind.mjs: a public system is bound to the service itself in every
  environment, with its address, no key, its access and the approval, and
  one decision says why.
- scripts/architecture-record.mjs: the header writes and reads that binding
  (`itself at <address>, no key, read, approved by the owner in egress-1`)
  and a new field, `cost_limit`, the spending limit in the words it was set
  in. The Systems and Bindings sections say the same. The spec writer's copy
  is the same file.
- scripts/check-record.mjs: the delivery check and what changed let a public
  service's address through, and nothing else.
- The descriptor, pieces.mjs, rules.md, README.md and the reference record
  name `cost_limit`. standards-pins.json pins architecture-standard.md 1.1.0.
- test/hn-digest.test.mjs: four tests on the case, with the model's answer
  replayed (test/fixtures/hn-digest.answer.json). The finished record is the
  spec writer's test fixture, byte for byte.

133 tests, 132 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
