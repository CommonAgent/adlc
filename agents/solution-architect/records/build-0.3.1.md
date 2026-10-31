# solution-architect 0.3.1: a spending limit the build settled is never said to be asked

Date: 2026-10-31.

## Why

The dev proof of 0.3.0 (build-0.3.0.md, On dev) delivered a finished record
with the build's spending limit, and its reply still said "took out a
spending limit the statement did not state, and asked for it". The model had
filled a limit in, code took it out to ask it, and then the build's settled
limit was used. Nothing was asked, so the reply said something untrue.

## What changed

name.mjs: where the build settled `limit-cost`, the note says the limit was
taken out "and used the one <who> settled".

## Tests

test/settled-answers.test.mjs gains one test, written first and failing.
129 tests, 128 pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the test
first.

## On dev

- Packed by the package maker on the dev fleet host from adlc 15a731c:
  sha256 18b0af381f87eafe9eaa4078773e85273be52d36c254e4dadf6c42bb2b8045fb.
- Installed by the deployment manager from deploy request
  dr_vKwp1dTTwWFNQQy_UbkaOeNe, approved by the platform account, with the
  same settings; deployed 2026-10-31 10:51 MT, the watch probe answered.
- Proof, the same Build an agent request as 0.3.0's, as platform@ through
  the account's try door: answered in about four minutes with the record,
  `done: yes`, `questions: 0`, `systems: []`, `bindings: none`, the cost limit
  the build settled with its source, decisions for nothing outside AgentMesh,
  the model door, the limit and nobody attending, and no provider or model
  word in the reply, the record or the job manifest. 43 gateway calls (its
  harness's included), $0.37.
