# doc-writer 0.1.0: the documentation, written from the agent's own records

Date: 2026-10-27.

## Why

The Docs stage has two artifacts: the AgentDoc, which the documenter gathers
and signs, and the documentation for people, which nothing wrote. The owner
approved filling every lifecycle stage except Retract, Rollback and Eval
(relayed by the coordinator, 2026-10-27), and this is the Docs stage's second
half. The role is published at agentroles.ai/doc-writer.html (v0.1.0-draft).

## What was decided

- Its own agent, not a second offering of the documenter: one agent owns one
  artifact, the AgentDoc is gathered and the documentation is written, and
  they are two roles with two checks. The README says why in full.
- No model. Every line is a template filled from one place in one source, and
  the check re-derives every line from its mark, so "nothing was authored"
  holds line by line. A model's sentence is one the check would have to trust.
- Inputs are told apart by their content, since the mesh often hands a
  descriptor over as plain JSON. Kinds are specific (vendor `+json` kinds and
  `text/markdown`), never bare `application/json`, and every input says who
  gives it.
- Free: it calls no model and reaches nothing, as the incident recorder.

## What it does

- Read what was given: sorts the files into the descriptor, the runtime
  requirements, the AgentDoc, verdicts and records; numbers them; digests them.
- Write the documentation: the fixed sections, a `### <job>` per job with what
  to give it, what comes back, how it is done, its steps and examples from its
  records, and every silence under Not documented.
- Check every line: re-derives each line, holds silences and inventory lines
  against the sources, compares examples line for line, and checks coverage
  (every job, input, output, refusal, verdict and not-stated item, and every
  job with an example or a line saying it has none). Any finding stops the
  delivery.
- Hand it over: the documentation and its trace as pieces, and the reply.

## Tests

39 pass: the role's own test (three jobs, records from two), six kinds of
doctored documentation each refused, quiz-maker's real descriptor, runtime
requirements, AgentDoc and run record, the AgentDoc alone, silences against
empty lists, a verdict, a record with a credential, a build record and a
second descriptor, a line placed where it means something else, the signed AgentDoc, record matching, places and ranges, the run command from
the builder's layout, the parts, and one test for each of the nine findings of
the review of PR 18 (a text record ending in a newline, refusals as a list, a
line under the wrong job or section, a json range on text, bullet lines in a
description, values no template reads, a short id claiming a longer job's
record, a declared record without `when`, and digests from the bytes read),
and one for each finding of the second review (values in a shape nothing reads
shown as written, a verdict no template reads, a line under the wrong part of
a job, a byte-order mark, a four-backtick line in a record, names over several
lines, a record's field marked under a job, and a job folder used again), and
for the third (a credential in the declaration withheld and said, an empty
record, odd offerings, inherited property names, file names that start with
digits, backticks in a value, a mark inside the source's words, and a
carriage return).

## Who held each step

The harness (Claude Code) wrote the spec, the scripts and the tests on the
owner's approval relayed by the coordinator; packaging, the deploy request and
the install go through the package maker, the platform account's deploy queue
and the deployment manager, on dev first.
