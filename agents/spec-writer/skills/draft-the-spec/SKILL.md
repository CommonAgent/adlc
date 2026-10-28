---
name: draft-the-spec
description: once the request is recorded, to write the spec it describes
---

# Draft the spec

Part of spec-writer. once the request is recorded, to write the spec it describes

## When to use this

once the request is recorded, to write the spec it describes

## What a good result looks like

A draft that carries what the reference says a good spec carries, and a list of the blanks it could not fill, each with the question it would ask. Every input and output has a specific kind: Markdown (`text/markdown`, its convention sketched in its about) for what agents hand each other or a person reviews, a vendor JSON kind for exact typed data only code reads, and never a bare `application/json`; and every input says who gives it (`given_by`: person, agent or either). A job that calls a model declares the capability as a bound system (`text-reasoning`, `image-reading` and the like, access `trigger`) and names no model or version anywhere.

## When it comes back empty

If the service will not answer, or answers with something that is not a spec, nothing is written and the reply says which of those happened. A draft that still carries findings after a second go is delivered as it is, with every finding said out loud.

## How to do it

Nothing in this folder is run on its own; the write-a-spec skill names the one command that does the whole job, and this skill only explains what that command does for this step.

draft.mjs builds one request carrying, in this order: the instruction, the request as it arrived, what came with it by name, what each text attachment says, anything named and not there, the person's answers to earlier questions, a spec they attached with the instruction to revise it rather than rewrite it, the architecture record when one came (with the rule that the draft declares exactly its systems, its kind, its formats and its settings), the reference, and one whole spec that produced an agent which runs today. It sends that to the text-reasoning service as the model TEXT_MODEL names, reads the answer whether it arrived fenced or bare, and checks the draft with check-spec.mjs. Where the check finds something the same request goes once more with the findings appended, and never a third time. The check is check-spec.mjs's checkDraft: what a good spec carries, and the format rules (no bare application/json, a convention on every Markdown piece, given_by on every input, no model named anywhere), with a piece an attached earlier spec already sent as bare JSON left as it was. It writes records/<job>/draft.json, records/<job>/blanks.json and records/<job>/calls.json.

The draft is held to the architecture record's systems both ways: a system the record does not name is taken out of the draft after the second go and asked of the solution architect under the key architecture, and a system the record names that the draft leaves out is a finding. Without a record, a new draft says it chose its systems itself, which is the Architecture stage's decision.

The blanks are checked against the draft itself rather than taken on the model's word: a model that forgets to report a blank produces a draft that looks complete, and an invented name would then reach the mesh. An empty systems list is an answer; an absent one is a blank.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/draft.mjs
- scripts/check-spec.mjs
- scripts/asked.mjs
- scripts/agent-folder.mjs
- scripts/architecture-record.mjs
- scripts/can-use.mjs

## References

- references/what-a-good-spec-carries.md
- references/a-spec-that-works.json
- references/standing-asset-schemas.json
