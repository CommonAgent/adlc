# What a person meets, and how each answer is read

A page drawn from a Descriptor is the only thing most people see of an agent. The tester reads the Descriptor as such a page does, and runs the agent with the calls such a page makes. Each answer below says where it is read and what makes it yes or no.

## The page's calls

The platform's agent page (AgentMesh `app-next`, `src/runtime.ts` and `src/run-view.ts`) makes these calls, and the tester makes the same ones, as a signed-in account:

| What a person does | The call |
|---|---|
| Opens the agent's page | `GET /a/<handle>`, then `GET /v1/agents/<key>/descriptor` |
| Presses Run | `POST /v1/accounts/<id>/try` with `{to, text, offering, files}` |
| Waits for the result | `GET /v1/accounts/<id>/jobs/<job>`, until it is delivered, refused or answered |
| Answers the agent's question | `POST /v1/accounts/<id>/try` with `{job, text}` |
| Opens a piece | `GET /v1/accounts/<id>/artifacts/<id>` |
| Asks for a change | `POST /v1/accounts/<id>/jobs/<job>/revise` with `{text, steps}` |

The message a page sends is built the same way: the one input of words is the message itself, every other value is a line of its own (`<input name>: <value>`), and each file goes under its input's name.

## The descriptor checks

| Check | Passes when | A finding means |
|---|---|---|
| summary | `summary` is one sentence of at most 200 characters | the page shows `does`, written for programs, first |
| example | every offering has an `example` that gives every required input and one of each `one_of` group, with a `good_result` | a person sees an empty form, and nobody outside the builders can run it as a person would |
| inputs-to-controls | each input a person gives is words, an address, a name or a file, has an `about`, and is not an option | a person is asked to type structured data, or to guess |
| options-settings | each setting has a `label` and a `default`, its `allowed` values and their `value_labels` where it has choices, and a `range` for a number | a person types into a box where they should pick |
| presentation | each output a person meets declares a `presentation` from its list | a page shows structured data as it is |

All five are `descriptor` findings, fixed by design.

## The four answers

**Form.** Yes when the example fills the form: every value has a field, every required input and each `one_of` group has a value, an address is an address, and each file can be had and hashes to the example's digest. A file in the package comes from an attached package or file with that digest. A file at a public address is fetched with no credentials.

**Delivers.** Yes when the job record comes back delivered, and what came back holds the offering's deliverable: an output it declares that is not working out. A refusal, an answer in words, an empty delivery or no result within the wait is no. Each declared output that is not delivered, and each piece delivered as another kind than declared, is an `agent` finding.

**Readable.** Yes when at least one delivered piece can be read by a person as it comes:
- Markdown or text: words, not JSON or an HTML page, with no leftovers of code;
- an HTML page: a page with something on it to read;
- an address: one address on its first line;
- a picture, a sound or a film: bytes of the kind declared;
- structured data: only with a `presentation` a page draws, such as quiz, facts or table, and bytes that fit it.

Structured data with no presentation is for another agent, not a person. When that is all an offering delivers, the finding is `descriptor`. How well the words read is a person's judgment, which the report leaves to a person.

**Change.** Yes when the change is taken and a new version comes back with the deliverable. An offering that declares no revisions and no steps offers a person no way to ask, which is a `descriptor` finding. A change with a price is not asked.

## Where the report is bound

The report's `package_digest` is the one the tested agent's own signed delivery manifest names, in the job record. The report itself is delivered under the tester's signed job manifest, which lists its digest. An auditor checks both: the manifest's signature, and the header's package digest against the version it audits.
