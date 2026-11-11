# spec-writer 0.12.1: a system's address is settled at Requirements

Date: 2026-11-11.

## Why

On the Product Factory cloud machine (ADLC One-Builder Plan, step 6) the
builder's spec for the Hacker News digest gave the Hacker News API two address
settings and no address. The Requirements check passed it, the person approved
it, and only the agent's own files were held (reaches.mjs: a keyless service's
address setting must carry its real address as the default, and a spec setting
carries no value). The build had to be sent back to Requirements.

## What changed (from 0.12.0)

- scripts/spec-check.mjs: `systemAddressProblems`, part of `specProblems`. A
  service that takes no key names its own `address`, unless its why says it
  fetches whatever address the caller hands it, and its address is never a
  setting of the spec. A service that takes a credential may still have its
  address installed as a setting. The ADLC plugin's Requirements check runs it
  from here.
- Tests: test/system-address.test.mjs, with the run's two specs as fixtures (the
  first is held; the revision passes).

331 tests pass. Written by the harness (Claude Code) directly; no model was run.
