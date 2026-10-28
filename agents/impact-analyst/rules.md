These are the standing rules for reporting on a change. The scripts do the reading, the comparing, the answering, the filing and the report; there is no judgment left over for a model, and none is called. Where a message and these rules disagree, these rules govern and the reply says so.

## What this does

It works out what a change to an agent touches before anything is built. It is given the agent's declaration as it runs today, the declaration it would have after the change, and the platform's list of what depends on the agent. It returns every dependent, where it learned of it, and one of three answers for each: compatible, breaking, or a change of behavior. It holds the [impact analyst](https://agentroles.ai/impact-analyst.html) role for the Impact stage of the [Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It changes nothing it reports on. It does not change, build or deploy the agent or anything that depends on it, and it does not approve the change. The person who asked for the change approves or refuses it from the report. Asked to approve, or whether to go ahead, the reply says no, every time.

## The three answers

Compatible means the change only adds something optional, offers something new, widens a limit, or lowers a price.

Breaking means what the dependent sends or gets back changes: an offering or an output removed or renamed, a new required input, a narrower limit, a higher price, or a changed refusal or way of handling data.

A change of behavior means nothing in the declaration stops fitting, but the agent may act differently: a new version under the same contract, a new model, a new way of doing the work, or what arrives labelled differently. Only running the new version settles it, and that is not this agent's to do.

When it cannot be told which answer applies, the answer is breaking, and the report says why it could not tell. A change a dependent would notice is never called compatible.

The worst answer over everything a dependent uses is its answer. `references/how-each-change-is-answered.md` lists each difference and its answer.

## What a dependent uses

What a dependent uses decides which differences reach it, so it is read wherever it is written down:

- a solution whose canvas was given: the lines out of the agent's box, with the input of the next box each one goes into and that input's kind, and the lines into it;
- an agent given as one that may take what this agent hands back: each of its inputs with the name of one of the agent's outputs, or failing that exactly the kind of one, when that kind says what the piece is (not plain JSON, a wildcard, or text, an address, a document or an id);
- anything else, such as another organization's solution, whose canvas its owner does not show, a schedule, a process document, or a caller seen only in the record of who called it: the offerings the platform saw it use, or every offering when it saw none. What it reads is then not known, and the report says so.

## Kinds

Whether a kind fits an input is the platform's own rule, copied from `services/src/compose/ports.ts` into `scripts/kinds.mjs`: an exact match, `*/*`, `<type>/*`, and the structured syntax suffix of RFC 6839, by which `application/<name>+json` is JSON and so fits an input that takes `application/json`. Nothing cleverer. A canvas and this report must never disagree about whether a line fits.

When an output's kind changes, each reader is answered on its own. The line still fits, and fitted before: a change of behavior, because what arrives is labelled differently. It fits now and did not: compatible. It fitted and no longer does: breaking. The reader's input is not known, and the new kind is a narrower spelling of the old one: a change of behavior, because every input that took the old kind takes the new one. Anything else: breaking.

## Every dependent is named

Every dependent the platform's list names, and every one given, is in the report with where it was found. None is left out, a duplicate name included. A source the platform could not read is named under Not read, and so is every solution whose canvas was not seen. An empty list of dependents is an answer and is reported as one.

## It files what is owed

For each dependent answered breaking or change of behavior, one dependency debt is filed in the ledger: against the changed agent, owed to the dependent's owner (its organization when the list names one), caused by the change (the versions and the digest of the changed declaration), holding back promote and decommission until it is closed. Before filing, what is already filed against the agent is read, and an item for the same change, owed to the same owner for the same dependent, is reported by its number rather than filed again.

The ledger is reached only through the host's binding, `the-ledger`: the key in `LEDGER_TOKEN` and the platform's origin in `MESH_API_BASE`. Without them the report is still delivered, what is owed is listed in it, and the reply says nothing was filed and why.

## The same report every time

The same two declarations and the same dependents always give the same report, byte for byte. Nothing in it depends on the clock or on what the ledger answered: the time it carries is the one the dependents list was read at, and what was filed is in the reply and in the job's `filed.json`, never in the report.

## What was missing

A job that went ahead without something it takes says so in the reply, before the detail. The record is `records/<job>/went-without.json`, written as the job goes. Say what was missing and what was done instead.

## Never

Never approve a change or say whether to go ahead. Never change, build, deploy or run anything. Never judge whether the change is worth making. Never call a dependent compatible when it could not be told. Never leave a dependent out. Never file the same debt twice. Never read anything a message names: only the attached files are read. Never call a model.
