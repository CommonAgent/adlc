---
record: architecture-record-v1
statement: "An agent that reads the customer list and emails each customer a short reminder before their renewal. It may spend at most 5 USD a day."
environments: [dev, test, production]
kind: plugin-on-harness
done: yes
questions: 0
systems: [database, mail, text-reasoning]
standing_assets: [https://schemas.agentmesh.ai/brand/v1, https://schemas.agentmesh.ai/style-guide/v1]
bindings:
  database:
    dev: supabase (customer)
    test: supabase (customer)
    production: supabase (customer)
  mail:
    dev: resend (customer)
    test: resend (customer)
    production: resend (customer)
  text-reasoning:
    dev: platform (platform)
    test: platform (platform)
    production: platform (platform)
---

# Architecture record: renewal reminders by email

This record is finished: every system is named and bound in each environment, and every decision has its reason.

## Statement

> An agent that reads the customer list and emails each customer a short reminder before their renewal. It may spend at most 5 USD a day.

## Systems

- `database` (the customer list), read: The customers and their renewal dates are kept there.
- `mail` (a mail sender), write: Each reminder goes to a customer by email.
- `text-reasoning` (text reasoning), trigger, for text: a short, plain reminder in the customer's own terms: Writing each reminder so it reads as a person wrote it is a judgment.

## Bindings

| System | dev | test | production |
|---|---|---|---|
| database | supabase, the organization's choice | supabase, the organization's choice | supabase, the organization's choice |
| mail | resend, the organization's choice | resend, the organization's choice | resend, the organization's choice |
| text-reasoning | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default |

## Dependencies

None.

## Kind

**plugin-on-harness**: A short program with one judgment: read, write each reminder, send. A harness reading skills carries it.

## Limits

- **Cost**: at most 5 USD a day. The statement says so.
- **Speed**: a whole list sent within 600 seconds. A list of a few hundred customers is one pass.
- **Data**: reads names, emails and renewal dates; keeps nothing between runs; never sends the list anywhere but the mail sender. Customer data stays in the organization's own database.
- **Trust**: takes the run only from its owner. Sending email to customers is the organization's voice.

## Egress

- dev: the target runs the agent open (it enforces no allowlist today).
- test: the target runs the agent open (it enforces no allowlist today).
- production: the target runs the agent open (it enforces no allowlist today).
- None beyond the derived set (its systems, the network, the registrar, the model it is given).

## Formats

- It hands back the run's account as `text/markdown`; a header `sent, skipped`, then `## Sent` and `## Skipped` with one bullet per customer and why. A person reads what went out.
- It takes which customers to remind as `text`, given by a person. The owner says which renewals are due, in words.

## Standing assets

- **the run's account** (`text/markdown`, written copy): the style guide (`https://schemas.agentmesh.ai/style-guide/v1`), because written copy a person reads speaks for the organization, and the style guide says its voice, its spelling and the words it uses and avoids; the brand profile (`https://schemas.agentmesh.ai/brand/v1`), because written copy that speaks for the organization names it, and the brand profile says how its name is written, how it is first mentioned and the words it never says.
- The Design declares exactly these as `can_use`, each with what it reads, what it does with it and what it does `without` it: `https://schemas.agentmesh.ai/brand/v1`, `https://schemas.agentmesh.ai/style-guide/v1`.

## Settings

- `days-before` ("Days before renewal"), a preference with the default 14, from 1 to 60 in steps of 1: How many days before a renewal the reminder goes. How far ahead of a renewal a reminder goes is the organization's habit; two weeks is common.

## Decisions

### Decision 1. Bind database to supabase in dev, and supabase in test and production

Why: The person named supabase for dev in an answer. The organization chose supabase for test and production (the organization's stack, bound since 2026-10-20).

Weighed: Another product behind database: Supabase and Firestore, which the organization can choose on its stack.

What follows: The install places the credential and address this binding names; the package names neither.

### Decision 2. Bind mail to resend in dev, test and production

Why: The organization chose resend for dev, test and production (the organization's stack, bound since 2026-10-20).

Weighed: Another product behind mail: Resend and Amazon SES, which the organization can choose on its stack.

What follows: The install places the credential and address this binding names; the package names neither.

### Decision 3. Bind text-reasoning to platform (AgentMesh's models) in dev, test and production

Why: The organization chose no product for text-reasoning, so the House Stack's product fills each as a platform default: AgentMesh chooses the model and keeps it current. Every harness AgentMesh deploys uses it unless its owner names another model, and the key sits on the machine that deploys it.

Weighed: Another product behind text-reasoning: a model provider of the organization's own, bound on its stack with its own key.

What follows: The install places the model from this binding in the four settings MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, and the scripts read them on every call through the shared model caller and name no model, so changing the model is a setting and not a rebuild.

### Decision 4. Report each run as Markdown

Why: A person reads it.

Weighed: A vendor JSON kind, which only code reads.

What follows: Its headings are fixed so a test can hold them.

## Questions

None. Every system is named and bound in each environment, and every decision has its reason.
