# solution-architect 0.3.0: the build's settled answers, and no provider named

Date: 2026-10-31.

## Why

Technical debt 641. Wiring the architect into AgentMesh's Build an agent as
the Architecture stage, ahead of the spec writer, found three things in
0.2.0 that stood in the way:

1. It always left a question open. It asked `limit-cost` whenever the
   person's words stated no spending limit, and Build an agent's fields
   never state one, though the platform already holds the answer: AgentMesh's
   model door counts every call against the account's daily model allowance.
2. It contradicted the build's settled answers. The build settles that a
   person's agent reaches nothing outside AgentMesh and a model only through
   AgentMesh's model door, naming no model system; the record bound
   text-reasoning to the House Stack, which the spec writer would then have
   declared (its check makes the package's systems the record's).
3. It named the House Stack's model provider in its bindings header and
   table, its decision and the reply, from the platform's vocabulary. The
   lifecycle API would have handed that back to the person, and AgentMesh
   never says which provider stands behind the House Stack.

## What changed

- A new optional input on both offerings, `the build's settled answers`
  (`application/vnd.agentmesh.settled-answers+json`, given by an agent):
  `{settled_answers, by, answers: [{key, answer, from, why}]}` with the keys
  kind, reaches (nothing-outside-agentmesh), model (model-door), limit-cost,
  attended and environments. scripts/settled.mjs reads it (asked.mjs tells it
  apart by what is in it), tells the model what was settled (name.mjs), and
  applies it in code after the model's answer: each settled answer becomes a
  decision that says who settled it and where it came from, its question is
  dropped, and where the architect would have chosen otherwise (a model
  system, a destination, a question about a person reviewing in between) it
  is a note under the decision's "weighed", never a binding or a question.
  Any other key is kept in named.json and changes nothing. A question the
  settled answers do not answer is still asked.
- scripts/no-provider.mjs: a House Stack product on a model system is bound
  as `platform` with the House Stack's label ("AgentMesh's models"), whatever
  the attached vocabulary names; a model system's other products are no
  longer listed by provider; provider and model words are taken out of the
  model's prose, the quoted statement, what changed and the reply; and
  check-record refuses a record or what is still open that names one, in
  words that do not repeat it. A product the organization bound itself is its
  own choice and stays.
- references/house-stack.json writes the House Stack's product on the four
  model systems as `platform`, and references/a-record-that-works.md and the
  README no longer show a provider (the example also says the four model
  settings, not TEXT_MODEL).
- standards/architecture-standard.md: section 3 says a House Stack model is
  named as `platform`, never by provider; section 7 points to a new section
  11, answers a build has already settled. Re-pinned in standards-pins.json
  (this is the only agent that pins it).
- Descriptor: the input, three will-nots, the refusals, the name-the-systems
  step and the records' names; plugin.json and each SKILL.md list the two new
  scripts; rules.md says both rules.

## Tests

test/settled-answers.test.mjs (11) and test/no-provider-name.test.mjs (8),
written first and failing against 0.2.0 (21 of 128 failed, counting the
changed expectations in bind.test.mjs and job.test.mjs). 128 tests, 127 pass,
1 skipped. The provider test reads everything handed back with its own word
list, not the scripts'.

## Who held each step

The harness (Claude Code) stood in for the spec, test and code steps, the
tests first, inside each agent's checks: the package maker packs it
(build.py, no findings), the test writer's check-suite finds the suite fails
against empty stand-ins for the 14 scripts, and blanking settled.mjs or
no-provider.mjs fails the suite (8 and 2 tests).
