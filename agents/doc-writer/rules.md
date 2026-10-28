These are the standing rules for documenting an agent. The scripts do the reading, the writing, the checking and the reply; these cover the part a reader might otherwise take on trust, and where a message and these rules disagree, these rules govern and the reply says so.

## What this writes

The documentation a person reads to use or maintain an agent, as Markdown, and nothing else. Not the AgentDoc: that is gathered and signed by the documenter from the agent's records, and this agent reads it as one of its sources. Not a review: whether the agent's work is good is the agent critic's question and whether it keeps its promises is the conformance checker's. Not a change to anything: the files it documents are read and never written.

## Where every line comes from

From the files attached to the job and nowhere else: the agent descriptor, the runtime requirements, the AgentDoc, verdicts and records. Each is told apart by what is in it, numbered as a source, and listed with its digest at the end of the documentation.

Every line that says something about the agent is one template from scripts/templates.mjs filled from one place in one source, and it ends with that place's mark. The template is the only text that is not the source's own. A value is shown as the source has it, or as one of a few fixed words for a fixed value: `required` for `true`, "with each job" for `per_task`, 2.00 for 2000000 micro-units.

Where a place is filled in a shape no template reads (a price model it has no words for, a job time written as text), the line shows the value as written, `As written at <place>: <value>`, rather than dropping it or calling it a silence. A line also has to stand under the heading its place belongs to, and under the job it is about.

There is no model here, because of how lines are checked. The documentation is written for a person, but a person reading it has to be able to check any line against its source, and a sentence a model wrote is a sentence the check would have to take on trust. The templates are the writing, and they are written once, here, where they can be read.

## Silences show

Where a source could speak and does not, the line says so, and every such line is gathered under Not documented: a job with no `does`, a descriptor with no `escalates`, no runtime requirements given, no verdict given, a job with no record to show as its example, and each item the AgentDoc itself says was not stated. A silence is never filled from what agents like this one usually do.

A list a source declares empty is not a silence. `"systems": []` says the agent reaches nothing, and the documentation says that.

## Examples are records

An example is a record of a real job, shown as its own lines, up to forty of them, with the file it came from. A record is a job's when it names the job (a field `offering`, `skill`, `job` or `step`, its file name, or the job's id in quotes), or when the agent offers one job. No example is ever written: a job with no record says it has none.

A record with a line that looks like a credential is not quoted at all, and is named under Not documented.

## The check stands between the writer and the reader

The check reads the documentation as text and does not trust the writer. It re-derives each line from the place its mark names; it passes a silence only where the place is empty; it passes a line about what was given only where the inventory bears it out; it passes an example only where its lines are the record's lines. Then it checks what the role asks: every job documented, every input and output listed, every refusal shown, every verdict and every not-stated item carried, and every job with an example or a line saying it has none.

Any finding stops the delivery, and the reply names the findings. Nothing is changed to make documentation pass.

## Never

Never edit the documentation after the writing step wrote it; a sentence that is wanted becomes a template in templates.mjs, where the check can hold it. Never fetch a source from an address. Never call a model. Never fill a silence. Never describe a job, a refusal or a system the declaration does not name. Never quote a record that looks like it holds a credential. Never sign or publish the documentation.
