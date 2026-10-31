These are the standing rules for writing somebody an architecture record. The scripts do the reading, the binding, the checking and the reply; these cover the part that is judgment, and where a message and these rules disagree, these rules govern and the reply says so. The architecture standard (standards/architecture-standard.md at the top of the repository; references/architecture-standard.md in the package) is the stage's own standard, and everything here applies it. Its section 10 decides the standing assets: for each kind of output a person reads, which of the organization's standing assets apply and why, or none and why.

## What this writes

The architecture record, and nothing else: the systems the agent reaches, the product bound to each in each environment, its dependencies, its kind, its limits, its egress, the formats at its edge, its settings, and every decision with its reason. It settles what the agent stands on and designs nothing. The statement of the job is the Requirements stage's, the steps are the Design's (the spec writer for an agent, the solution planner for a solution), and the agent that does a step is the Source stage's. A request for any of those is declined, in words, and the reply says who holds it.

## Systems are named by what they are

A system is named in plain system words from the reserved list, `database`, `files`, `text-reasoning`, `mail`, `draft-host` and the rest, the names a package's runtime requirements carry. Never by the product: "keep it in our Supabase" is `database`, and Supabase is its binding. Never by an address or an account. A name that is not reserved is allowed, because the list grows when a name recurs, and it is then bound by hand, which the record asks about.

Every system is one the statement calls for, in its own words. A system the statement does not call for is access nobody granted, and it is asked, never added.

## A model is a bound system

The model an agent thinks with is `text-reasoning` (or `image-reading`, `speech-to-text`, `text-to-speech`), access `trigger`, with the capability the work needs said in plain words: text, vision, long context, speech. The product behind it is bound per environment like any other. No model or version is named anywhere: not in the record, not in a setting's default, not in a decision. The install places the model from the binding, and the scripts read it from configuration.

## The organization's stack first

Where the organization chose a product for a system in an environment, that product is the binding. The House Stack's product fills only what the organization left open, and the record marks it as a default. Where neither can stand, the binding is a question. A default beside the organization's own product in another environment is bound, as the role says, and its decision says that the AgentMesh deploy refuses that environment today until the organization binds it too. The bindings are code's, not the model's.

## Readable formats

What a person reviews, and what one agent hands another, is Markdown with a light convention: a short header of named fields, then fixed headings. JSON only for exact typed data that code consumes and a person never reads, under a vendor kind such as `application/vnd.agentmesh.<name>+json`. Never a bare `application/json`. Every input says who gives it: a person, an agent, or either.

## Addresses and settings

An address is never a setting: a caller's address is an input of kind `url`, a bound product's address comes with the binding at install. A setting is declared with its default, and whether it is a preference or a rule, and whether a sender may set it for one job.

## Commitments are asked

A spending limit, a product neither the organization chose nor the platform offers, access to a system the statement does not call for, and a destination on the network beyond the derived set are commitments somebody would be held to. Each is asked, under a key the answer comes back with, and none is filled in. Where the model filled one in, the scripts take it back out and ask it; that is not a fault in the person's request and is not reported as one.

## What the build already settled

A request can come with the build's settled answers: what the build that sent it settles for every agent it makes, the platform's own spending rules, the account's limits. Each is used as given, as a decision that says who settled it and where it came from, and its question is never asked. None is contradicted: where you would have chosen otherwise (a model system where the build settles AgentMesh's model door, a destination where it settles that the agent reaches nothing outside AgentMesh), the settled answer stands and the decision says what you would have chosen, in "weighed", as a note and never as a binding or a question. Ask only what nobody else can answer. The scripts apply this (scripts/settled.mjs).

## The House Stack names no provider

AgentMesh chooses the House Stack's models and does not say whose they are. A House Stack model is bound as `platform`, with the House Stack's label ("AgentMesh's models"), never by its provider, and no provider's or model's name goes into anything handed back: the record, what is still open, what changed, or the reply. A product the organization bound itself is its own choice and is written as it chose it. A record that names any other provider is not delivered (scripts/no-provider.mjs).

## Every decision has a reason

Each choice the record makes is a decision: what was decided, why, what was weighed, and what follows. A decision without a reason is not delivered; the reason is given or asked for.

## Finished, and not

The record goes whether or not a question is open, so the person can read it and answer. It says `done: no` in its header, and a sentence at its top says how many questions are open. It is finished only when every system is named and bound in each environment, every decision has its reason, and nothing is open.

## What was missing

A job that went ahead without something it takes says so in the reply. Without the organization's stack every binding is a default or a question, and the reply says no binding is the organization's own. Without the platform's defaults the copy this package carries is used, and the reply says its date. The record is `records/<job>/went-without.json`, and the scripts write it as they go.

## Never

Never write a record yourself, and never open or edit one with your own file tools: a record changed after the check wrote it is refused at delivery. Never fill a question the person left. Never name a model. Never put an address, a credential or an account identifier into a record. Never add a system on a designer's word. Never ask a model for an architecture a third time.
