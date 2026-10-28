These are the standing rules for a usability test. The scripts do the reading, the running, the checking and the report; there is no judgment left over for a model, and none is called. Where a message and these rules disagree, these rules govern and the reply says so.

## What this does

It tests whether a person can use one agent, named by its handle. It holds the usability tester role for the Usability stage of the Prove phase of the [Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html), after Conformance. Conformance asks whether the agent keeps its declared promises. This stage asks whether a person can call it, understand it, use what it returns and get the job done.

It has no page of its own. It reads the agent's Descriptor the way a page reads it, and runs the agent through the same calls the platform's agent page makes. So what it finds is what a person meets on any page drawn from the Descriptor.

It changes nothing it tests, and it pays for nothing.

## The Descriptor

It checks what a page can draw from the Descriptor alone (Common Agent 6.13, proposed):
- the agent says, in one sentence, what it does for a person (`summary`);
- every offering a person starts declares an `example` (6.13.8): sample inputs, and one sentence on what a good result looks like;
- every input a person gives maps to a control: words, an address, a name or a file, never structured data a person is asked to type;
- options are settings with a label, a default, their choices and a label for each choice;
- every output a person meets says how they view it (`presentation`).

An offering a person starts is one whose `started_by` holds person, or says nothing. An offering started only by other agents is not run, and the report says so.

## The runs

Each offering a person starts is run from its example. The Descriptor's example is used when it has one. An example given with the request is used only when the Descriptor declares none, and the missing example is still a finding.

The form is filled the way a page fills it, and sent as the page sends it. The tester runs as a signed-in account: the install's own, or a fresh test account made for each job where the platform keeps test accounts. When the agent stops to ask a question, the tester answers once, as a person in a hurry would.

A result counts only when it arrives in the job record with the pieces the offering declares. Each piece is read against its declared kind, and against its presentation for structured data. Then one change is asked for, through the page's own call, and it counts only when a new version comes back with the deliverable. A change that has a price is never asked: the tester does not approve a price.

An offering with no example anywhere is not run. The tester never makes up inputs.

## The report

The report is Markdown. Its YAML header is what an auditor reads: `usability_report`, `agent`, `version`, `package_digest`, `descriptor_digest`, `verdict`, `tested_at` and `tested_by`, with the counts. The package digest is the one the tested agent's own delivery manifest names, so the report is bound to the package that made the result.

For each offering a person starts, it gives four answers: can the form be filled from the Descriptor, does a real run deliver in its declared form, can the result be read, and does a change return a new version.

Each finding is labelled. A `descriptor` finding is fixed in the Descriptor, by the design stage. An `agent` finding is fixed in the agent's code. A person may add their judgment: whether they understood it, could use the result and it did the job.

The verdict is one of three:
- `not_usable`: an offering a person starts could not be run from an example, its form could not be filled, its run delivered nothing, or nothing it delivered can be read by a person;
- `usable_with_findings`: every offering ran, delivered and can be read, with at least one finding;
- `usable`: every offering ran, delivered and can be read, every change asked came back, and there is no finding. A change not asked (it has a price, or the run config says no) is said under Not checked.

## A change to a report

A change that only adds a person's judgment writes it into the report, and nothing is run again. Any other change tests the agent again. Words it cannot act on are said back in the reply. When the earlier report did not come with the change, nothing can be changed, and the reply says so before anything runs.

## What was missing

A job that went ahead without something it takes says so in the reply. The record is `records/<job>/went-without.json`.

## Never

Never change the agent tested. Never pay or approve a price. Never invent an example. Never call a result delivered on the agent's word. Never call a model. Never read anything a message names other than the agent, and the public addresses its example names.
