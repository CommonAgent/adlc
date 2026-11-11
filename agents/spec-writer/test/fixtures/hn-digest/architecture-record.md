---
record: architecture-record-v1
statement: "An agent that reads the current top stories on Hacker News, keeps the ones about a topic the caller names, writes one sentence about each, and hands back a short Markdown digest."
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

# Architecture record: a Hacker News digest on a topic

This record is finished: every system is named and bound in each environment, and every decision has its reason.

## Statement

> An agent that reads the current top stories on Hacker News, keeps the ones about a topic the caller names, writes one sentence about each, and hands back a short Markdown digest.

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

**plugin-on-harness**: A short program with one judgment in it: read the top stories, keep those on the topic, write a sentence for each, hand back the digest. A harness reading skills carries it.

## Components

- **the harness** (`harness`), the harness: Starts the skill's script once per job, hands it the job's input and settings, and sends back what it writes as the reply.
  - **topic-digest** (`skill-topic-digest`), a skill: Writes a digest of the current top Hacker News stories on the topic the caller names.
    - **scripts/topic-digest.mjs** (`script-topic-digest`), a script: Runs the job in order: reads the top stories, keeps those on the topic, has a sentence written for each, and writes the digest.
      - **Hacker News client** (`hacker-news-client`), a part: Reads the ids of the current top stories, then each story's item, a bounded number at a time. It reaches `hacker-news`.
      - **topic filter** (`topic-filter`), a part: Keeps the stories whose titles are on the caller's topic, up to stories_in_digest.
      - **sentence writer** (`sentence-writer`), a part: Has the model write one plain sentence about each kept story, through the shared model caller. It reaches `text-reasoning`.
      - **digest writer** (`digest-writer`), a part: Puts the stories and their sentences together as the Markdown digest.
- **text reasoning** (`text-reasoning`), an outside system: The model behind the shared caller, for text: one plain sentence for each story.
- **public Hacker News API** (`hacker-news`), an outside system: To read the current top stories. It needs no key.

## Connectors

- `caller` to `harness`: a job message, which the host hands to the harness; it carries the topic.
- `harness` to `script-topic-digest`: by command: node scripts/topic-digest.mjs, started once per job, with the job's input and the settings stories_to_read and stories_in_digest as flags (the job's run, Common Agent Section 12.3); it carries the topic and the two settings.
- `sentence-writer` to `text-reasoning`, trigger: through the shared model caller (scripts/model-caller.mjs) and its four settings, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every call (Common Agent Section 12.4.1); it carries each kept story's title and one sentence per story.
- `hacker-news-client` to `hacker-news`, read: over HTTPS, with no key, at the address its binding names, read from a setting and never written into a script (Common Agent Section 12.6, rule 2); it carries the top story ids and each story's item.
- `script-topic-digest` to `caller`: written to the script's standard output, which the harness hands back as the job's reply; it carries the digest (`text/markdown`).

## Runtime and deployment

Runs once per job: the harness starts the skill's script as a command, and the process ends when the reply is written. It has no service of its own, opens no port and keeps no process between jobs.

- dev: `text-reasoning` on platform (AgentMesh's models), a platform default; `hacker-news` on the service itself at https://hacker-news.firebaseio.com/v0, no key, read.
- test: `text-reasoning` on platform (AgentMesh's models), a platform default; `hacker-news` on the service itself at https://hacker-news.firebaseio.com/v0, no key, read.
- production: `text-reasoning` on platform (AgentMesh's models), a platform default; `hacker-news` on the service itself at https://hacker-news.firebaseio.com/v0, no key, read.

## Data flow

1. `caller` to `harness`, the topic: The caller names the topic in the job.
2. `harness` to `script-topic-digest`, the topic and the two settings: The harness starts the script with the topic, stories_to_read and stories_in_digest as flags.
3. `hacker-news` to `hacker-news-client`, the top story ids: The client reads the ids of the current top stories and keeps the first stories_to_read.
4. `hacker-news` to `hacker-news-client`, each story's item: The client reads each story's item, its title, link and score, a bounded number at a time.
5. `hacker-news-client` to `topic-filter`, the stories: The filter keeps the stories whose titles are on the topic.
6. `topic-filter` to `sentence-writer`, the kept stories: The writer is handed at most stories_in_digest stories.
7. `sentence-writer` to `text-reasoning`, each kept story's title: The writer asks the model for one plain sentence about each story.
8. `text-reasoning` to `sentence-writer`, one sentence per story: The model answers with the sentence and nothing else.
9. `sentence-writer` to `digest-writer`, the stories and their sentences: The digest writer is handed each story with its sentence.
10. `digest-writer` to `caller`, the digest: The digest goes back as the job's reply, through the harness.

## Drivers

- **Cost** (`cost`): 1 USD per day, across every job. The person set it in an answer (limit-cost: 1 USD per day, across every job). Cited by decisions 1 and 2.
- **Speed** (`speed`): a digest within 300 seconds. One read of the top stories, up to 100 item reads and at most ten short model calls. Cited by decisions 1, 3 and 4.
- **Data** (`data`): holds the stories only for the job and keeps nothing between jobs. Nothing in the statement asks for a history. Cited by decisions 2 and 4.
- **Trust** (`trust`): takes jobs only from its owner, and reads story titles as data, never as instructions. The digest is for the owner, and a title can carry words written to steer a model. Cited by decision 3.
- **Readability** (`readable`): a person reads the digest. From the statement: "hands back a short Markdown digest". Cited by decision 5.

## Egress

- dev: the target runs the agent open (it enforces no allowlist today).
- test: the target runs the agent open (it enforces no allowlist today).
- production: the target runs the agent open (it enforces no allowlist today).
- None beyond the derived set (its systems, the network, the registrar, the model it is given).

## Formats

- It takes the topic as `text`, given by a person or an agent. The material the job is about: which stories to keep.
- It hands back the digest as `text/markdown`; a header `topic, read_at, stories`, then `## Digest` with one bullet per story. A person reads it.

## Standing assets

- **the digest** (`text/markdown`, written copy): the style guide (`https://schemas.agentmesh.ai/style-guide/v1`), because written copy a person reads speaks for the organization, and the style guide says its voice, its spelling and the words it uses and avoids; the brand profile (`https://schemas.agentmesh.ai/brand/v1`), because written copy that speaks for the organization names it, and the brand profile says how its name is written, how it is first mentioned and the words it never says.
- The Design declares exactly these as `can_use`, each with what it reads, what it does with it and what it does `without` it: `https://schemas.agentmesh.ai/brand/v1`, `https://schemas.agentmesh.ai/style-guide/v1`.

## Settings

- `stories_to_read` ("Stories to read"), a preference with the default 30, from 10 to 100 in steps of 1, which a sender may set for one job: How many top stories to read from Hacker News. How far down the list to read is the owner's habit; thirty is a morning's front page.
- `stories_in_digest` ("Stories in the digest"), a preference with the default 5, from 1 to 10 in steps of 1, which a sender may set for one job: How many stories to put in the digest. Five stories is a short read.

## Decisions

Decisions 1 to 5 choose the agent's structure. Decisions 6 to 8 are rulings: the standard's rules applied, and the answers a person or the build gave.

### Decision 1. Code controls the job, and the model writes only the sentences

Context: The job is the same steps every time: read the top stories, keep those on the topic, write a sentence for each, put the digest together.

Drivers: `cost` (1 USD per day, across every job); `speed` (a digest within 300 seconds).

Why: A program that calls the model once for each kept story bounds the spend by stories_in_digest and lets every step be tested.

Alternatives:

- A model-driven agent that decides which stories to read, which to keep and how to word the digest: not chosen, because its spend and its steps would not be bounded, and its choices could not be held to a test.

Consequences:

- The job's how is control script, intelligence called and contract full.
- Only the sentence writer calls the model, through the shared model caller.

### Decision 2. Run as a package on a harness, once per job

Context: The agent answers one job at a time, a few times a day, and keeps nothing between jobs.

Drivers: `cost` (1 USD per day, across every job); `data` (holds the stories only for the job and keeps nothing between jobs).

Why: A script the harness starts per job holds nothing between jobs and spends nothing while idle.

Alternatives:

- A long-running service that answers on the network itself: not chosen, because it would hold a process, a port and a deploy of its own for a job that runs a few times a day.

Consequences:

- Nothing runs, and nothing is spent, between jobs.
- The harness starts scripts/topic-digest.mjs with the topic and the settings as flags.

### Decision 3. Read the story items in parallel, a bounded number at a time

Context: Reading up to 100 items one after another is the slowest step of the job.

Drivers: `speed` (a digest within 300 seconds); `trust` (takes jobs only from its owner, and reads story titles as data, never as instructions).

Why: A bounded number of reads in flight keeps the job well inside its time and never floods a public service that takes no key.

Alternatives:

- Read each item one at a time: not chosen, because a hundred round trips one after another can outrun the job's time.
- Read every item at once: not chosen, because a hundred requests at once is hard on a public service, and they fail together.

Consequences:

- The client holds the bound as a constant a test can see.
- A story whose item cannot be read is left out of the digest, and the digest says so.

### Decision 4. Answer with the digest in the reply, and store nothing

Context: The caller wants today's digest when it asks.

Drivers: `data` (holds the stories only for the job and keeps nothing between jobs); `speed` (a digest within 300 seconds).

Why: The digest is small and read once, so the reply carries it whole.

Alternatives:

- Store each digest and send back a link to it: not chosen, because it needs a files system the statement never calls for, and keeps a history nobody asked for.

Consequences:

- The record names no files or database system.
- Each job reads the stories afresh.

### Decision 5. Hand the digest back as Markdown

Context: A person reads the digest, and the next agent may hand it on.

Drivers: `readable` (a person reads the digest).

Why: A person reads it; JSON would be a page of brackets.

Alternatives:

- JSON with a vendor kind: not chosen, because only code would read it.

Consequences:

- The convention is a header and one fixed heading.

### Decision 6. Bind text-reasoning to platform (AgentMesh's models) in dev, test and production

Why: The organization chose no product for text-reasoning, so the House Stack's product fills each as a platform default: AgentMesh chooses the model and keeps it current. Every harness AgentMesh deploys uses it unless its owner names another model, and the key sits on the machine that deploys it.

Weighed: Another product behind text-reasoning: a model provider of the organization's own, bound on its stack with its own key.

What follows: The install places the model from this binding in the four settings MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, and the scripts read them on every call through the shared model caller and name no model, so changing the model is a setting and not a rebuild.

### Decision 7. Bind hacker-news to the service itself in dev, test and production

Why: It is a public service that takes no key and has no product behind it, so nobody chooses one; the owner approved reaching it (egress-1).

What follows: The Design declares the service with its address as a setting whose default is the address the binding names; the scripts read the setting and hold no address of their own (Common Agent Section 12.6, rule 2).

### Decision 8. The agent may reach public Hacker News API

Why: The person granted it in an answer (egress-1: yes).

What follows: Public Hacker News API is the system hacker-news, bound to the service itself at the address the owner approved, with no key; the Design declares that address as a setting whose default it is, and the scripts hold no address of their own.

## Questions

None. Every system is named and bound in each environment, and every decision has its reason.
