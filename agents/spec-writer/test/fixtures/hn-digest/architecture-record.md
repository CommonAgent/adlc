---
record: architecture-record-v1
statement: "An agent that reads the top stories on Hacker News each morning and writes a short digest of them."
environments: [dev, test, production]
kind: plugin-on-harness
done: yes
questions: 0
systems: [text-reasoning, hacker-news]
standing_assets: [https://schemas.agentmesh.ai/brand/v1, https://schemas.agentmesh.ai/style-guide/v1]
cost_limit: "1 USD per day, across every job"
bindings:
  text-reasoning:
    dev: platform (platform)
    test: platform (platform)
    production: platform (platform)
  hacker-news:
    dev: itself at https://hacker-news.firebaseio.com/v0, no key, read, approved by the owner in egress-1
    test: itself at https://hacker-news.firebaseio.com/v0, no key, read, approved by the owner in egress-1
    production: itself at https://hacker-news.firebaseio.com/v0, no key, read, approved by the owner in egress-1
---

# Architecture record: a daily Hacker News digest

This record is finished: every system is named and bound in each environment, and every decision has its reason.

## Statement

> An agent that reads the top stories on Hacker News each morning and writes a short digest of them.

## Systems

- `text-reasoning` (text reasoning), trigger, for text: one plain sentence for each story: Writing a sentence that says what each story is about is a judgment, which is what a text model is for.
- `hacker-news` (public Hacker News API), read, a public service with no key, which the owner approved: To read the current top stories. It needs no key.

## Bindings

| System | dev | test | production |
|---|---|---|---|
| text-reasoning | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default | platform (AgentMesh's models), platform default |
| hacker-news | the service itself at https://hacker-news.firebaseio.com/v0, no key, approved by the owner | the service itself at https://hacker-news.firebaseio.com/v0, no key, approved by the owner | the service itself at https://hacker-news.firebaseio.com/v0, no key, approved by the owner |

## Dependencies

None.

## Kind

**plugin-on-harness**: A short program with one judgment in it: read the top stories, write a sentence for each, hand back the digest. A harness reading skills carries it.

## Limits

- **Cost**: 1 USD per day, across every job. The person set it in an answer.
- **Speed**: a digest within 300 seconds. One read of the top stories and one model call.
- **Data**: holds the stories only for the job and keeps nothing between jobs. Nothing in the statement asks for a history.
- **Trust**: takes jobs only from its owner. The digest is for the owner.

## Egress

- dev: the target runs the agent open (it enforces no allowlist today).
- test: the target runs the agent open (it enforces no allowlist today).
- production: the target runs the agent open (it enforces no allowlist today).
- None beyond the derived set (its systems, the network, the registrar, the model it is given).

## Formats

- It hands back the digest as `text/markdown`; a header `read_at, stories`, then `## Digest` with one bullet per story. A person reads it.

## Standing assets

- **the digest** (`text/markdown`, written copy): the style guide (`https://schemas.agentmesh.ai/style-guide/v1`), because written copy a person reads speaks for the organization, and the style guide says its voice, its spelling and the words it uses and avoids; the brand profile (`https://schemas.agentmesh.ai/brand/v1`), because written copy that speaks for the organization names it, and the brand profile says how its name is written, how it is first mentioned and the words it never says.
- The Design declares exactly these as `can_use`, each with what it reads, what it does with it and what it does `without` it: `https://schemas.agentmesh.ai/brand/v1`, `https://schemas.agentmesh.ai/style-guide/v1`.

## Settings

- `stories_to_read` ("Stories to read"), a preference with the default 30, from 10 to 100 in steps of 1, which a sender may set for one job: How many top stories to read from Hacker News. How far down the list to read is the owner's habit; thirty is a morning's front page.
- `digest_size` ("Digest size"), a preference with the default 5, from 1 to 10 in steps of 1, which a sender may set for one job: How many stories to put in the digest. Five stories is a short read.

## Decisions

### Decision 1. Bind text-reasoning to platform (AgentMesh's models) in dev, test and production

Why: The organization chose no product for text-reasoning, so the House Stack's product fills each as a platform default: AgentMesh chooses the model and keeps it current. Every harness AgentMesh deploys uses it unless its owner names another model, and the key sits on the machine that deploys it.

Weighed: Another product behind text-reasoning: a model provider of the organization's own, bound on its stack with its own key.

What follows: The install places the model from this binding in the four settings MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, and the scripts read them on every call through the shared model caller and name no model, so changing the model is a setting and not a rebuild.

### Decision 2. Bind hacker-news to the service itself in dev, test and production

Why: It is a public service that takes no key and has no product behind it, so nobody chooses one; the owner approved reaching it (egress-1).

What follows: The Design declares the service with its address as a setting whose default is the address the binding names; the scripts read the setting and hold no address of their own (Common Agent Section 12.6, rule 2).

### Decision 3. Hand the digest back as Markdown

Why: A person reads it; JSON would be a page of brackets.

Weighed: JSON with a vendor kind, which only code would read.

What follows: The convention is a header and one fixed heading.

### Decision 4. Limit what the agent spends to 1 USD per day, across every job

Why: The person set the limit in an answer (limit-cost: 1 USD per day, across every job).

What follows: The limit is the package's ceiling for its text-reasoning spend, within the organization's own.

### Decision 5. The agent may reach public Hacker News API

Why: The person granted it in an answer (egress-1: yes).

What follows: Public Hacker News API is the system hacker-news, bound to the service itself at the address the owner approved, with no key; the Design declares that address as a setting whose default it is, and the scripts hold no address of their own.

## Questions

None. Every system is named and bound in each environment, and every decision has its reason.
