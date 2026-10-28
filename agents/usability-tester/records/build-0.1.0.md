# usability-tester 0.1.0: the reference agent for the Usability stage

Date: 2026-10-28.

## Why

Agents passed Conformance, Acceptance and the audit, and a person still could
not use them: twelve boxes of JSON on one page, a free-text voice field, job
names refused, results nobody could read. Nothing in the lifecycle asked
whether a person can call the agent, understand it, use what it returns and
get the job done. The owner approved a Usability stage in the Prove phase,
after Conformance, and a reference agent for it with no page of its own; the
App's own walk is a separate add-on on top.

## What changed

- A new agent, the usability tester. It reads the agent's Descriptor the way
  a page does and checks the summary, an example for every offering a person
  starts (Common Agent 6.13.8, proposed), a control for every input a person
  gives, options as settings with choices and defaults, and a presentation
  for every output.
- It runs each example through the calls the platform's agent page makes, as
  a fresh test account (or the install's own), answers once when the agent
  asks, reads every piece against its declared kind and presentation, asks
  for one change and checks a new version comes back. A change with a price
  is never asked.
- It hands back a Markdown usability report: a YAML header an auditor reads
  (bound to the package digest the tested agent's own delivery manifest
  names), the four answers for each offering, the descriptor checks, each
  finding labelled descriptor (fixed by design) or agent (fixed by code), a
  person's judgment, and what was not checked.
- A change to a report that only adds a person's judgment writes it in and
  runs nothing again; any other change tests again.
- It calls no model. Its own Descriptor declares its example.

## Tests

`node --test test/*.test.mjs`: the whole job against a platform served from
memory (a usable agent, one that asks first, a refused and a silent change,
a known-bad agent with an example from the request, no example at all, a
refused run, a page delivered as Markdown, a person's judgment, the change
paths and the run config), and the parts one at a time. The package maker
builds it with no format, option or standing finding.

## Who held each step

The harness (Claude Code) wrote the agent and its tests on the owner's
instruction of 2026-10-28. spec-writer, test-writer and code-writer were not
used.
