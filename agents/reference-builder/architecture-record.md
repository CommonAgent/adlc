---
record: architecture-record-v1
statement: "Name: reference-builder. From the ADLC One-Builder Plan, step 5: a reference builder, the plugin run headless. Its one offering takes a person's request for an agent and runs the ADLC plugin through a coding harness with no person at the ke"
environments: [dev, test, production]
kind: plugin-on-harness
done: yes
questions: 0
systems: []
standing_assets: [https://schemas.agentmesh.ai/brand/v1, https://schemas.agentmesh.ai/style-guide/v1]
cost_limit: "None of its own: it spends nothing itself, and what the harness spends is the harness's."
bindings: none
---

# Architecture record: Headless ADLC build

This record is finished: every system is named and bound in each environment, and every decision has its reason.

## Statement

> Name: reference-builder.
>
> From the ADLC One-Builder Plan, step 5: a reference builder, the plugin run headless. Its one offering takes a person's request for an agent and runs the ADLC plugin through a coding harness with no person at the keyboard: it starts a build folder with /adlc:start, then runs the plugin's check until it passes or a person is needed. At each person gate it stops, and the question is its reply; it resumes the same build with the person's answer. The person's approval is theirs: it approves the spec only when the person says approve for that build. It is a harness, not a second author: it writes nothing the plugin does not.
>
> It refuses to write a build's files itself, and it refuses a message about a build it does not keep. When the message has no words, it asks for the request. When the harness cannot be run, it stops and says so, and writes nothing.
>
> It reaches no system of its own. It runs one program, the coding-harness command installed on the host with the ADLC plugin, which takes a prompt and a session to resume; the model is the harness's. It is free.
>
> ## The person asked for changes (2026-11-12)
>
> The reference builder is out of date with the ADLC plugin's two phases. Make it version 0.2.0:
> 1. After each run it reads the build folder's own check, which now names the phase the build is in, the spec or the build. Its reply says where the build is in those words: the spec still has things missing, the spec waits for the person's approval, the build has things missing (and how many), or the build has passed. It never says the build has passed when the check does not.
> 2. It offers the person the approval of the spec only when the check says the spec waits for the person.
> 3. Once the spec is approved, it asks the harness to carry on with the build until the check says the build has passed, not stage by stage.
> 4. The person's words are theirs: when it hands the harness a person's message for a build, it first adds those words to the build folder's said.md, under a heading with the time, so the check can find the words an answer quotes. The prompts it writes itself are not the person's, so it runs the harness with ADLC_NOT_THE_PERSON=1.
> Everything else stays as it is.

## Systems

This agent reaches no system outside its own folder.

## Bindings

Nothing to bind.

## Dependencies

None.

## Kind

**plugin-on-harness**: One job a harness runs, whose script starts or resumes the coding harness on a build folder and reads the folder's own check.

## Components

- **the harness** (`harness`), the harness: Starts the skill's script once per job, hands it the job's input and settings, and sends back what it writes as the reply.
  - **build-an-agent** (`skill-build-an-agent`), a skill: Takes the person's words and moves one build to the person's next decision or to the end.
    - **scripts/build-an-agent.mjs** (`script-build-an-agent`), a script: Starts or resumes the harness on a build folder, keeps the person's words in the folder's said.md before handing them on, passes the person's approval through only on their word, and reads the folder's check for the phase it is in.
      - **build keeper** (`builds`), a part: Keeps each build's folder and harness session under its id.
      - **said keeper** (`said-keeper`), a part: Adds the person's message for a build to the folder's said.md under a heading with the time, and puts said.md back as it was when the harness cannot be run.
      - **harness runner** (`harness-runner`), a part: Runs the coding harness headless with the plugin, always with ADLC_NOT_THE_PERSON=1, and reads its answer.
      - **phase reader** (`gate-reader`), a part: Reads the build folder's own check for the phase it is in and what it still has missing, and says so in the check's words.

## Connectors

- `caller` to `harness`: a job message, which the host hands to the harness; it carries the person's words.
- `harness` to `script-build-an-agent`: by command: node scripts/build-an-agent.mjs, started once per job, with the job's input as flags (the job's run, Common Agent Section 12.3); it carries request.
- `script-build-an-agent` to `caller`: written to the script's standard output, which the harness hands back as the job's reply; it carries reply (`text/markdown`).

## Runtime and deployment

Runs once per job: the harness starts the skill's script as a command, and the process ends when the reply is written. It has no service of its own, opens no port and keeps no process between jobs.

- dev: no system to bind.
- test: no system to bind.
- production: no system to bind.

## Data flow

1. `caller` to `harness`, the person's words: The person sends a request, or an answer naming a build.
2. `harness` to `builds`, the person's words: The harness runs the skill with the message, and the build keeper finds or starts the build.
3. `builds` to `said-keeper`, the person's answer: An answer for a build is added to its said.md first.
4. `said-keeper` to `harness-runner`, the prompt: The harness runner hands the coding harness the prompt in the build's session.
5. `harness-runner` to `gate-reader`, what the harness said: After the run, the phase reader reads the folder's own check.
6. `gate-reader` to `caller`, the reply: The skill answers with where the build is, in the check's words, and the person's question.

## Drivers

- **Cost** (`cost`): None of its own: it spends nothing itself, and what the harness spends is the harness's. The person set it in an answer (limit-cost: None of its own: it spends nothing itself, and what the harness spends is the harness's.).
- **Speed** (`speed`): One harness run per message, up to the harness's own limit. Each message moves the build to the person's next decision or to the end. Cited by decision 4.
- **Data** (`data`): Only the build folders it keeps, under its work folder. It writes nothing the plugin does not.
- **Trust** (`trust`): The person's approval passes through only on their own word. The person's approval is theirs. Cited by decisions 2 and 3.
- **Integrity** (`one-author`): The harness and the plugin are the only authors of a build's files. From the statement: "It is a harness, not a second author: it writes nothing the plugin does not". Cited by decisions 1 and 3.
- **Integrity** (`the-persons-words`): Only the person's words are kept as theirs, so the check can find the words an answer quotes. From the statement: "The person's words are theirs". Cited by decision 5.

## Egress

- dev: the target runs the agent open (it enforces no allowlist today).
- test: the target runs the agent open (it enforces no allowlist today).
- production: the target runs the agent open (it enforces no allowlist today).
- None beyond the derived set (its systems, the network, the registrar, the model it is given).

## Formats

- It takes request as `text/plain`, given by a person. The person's words.
- It hands back reply as `text/markdown`; A short header with `build`, `phase` (spec, build or none) and `where` (where the build is, in the words of its own check), then `## What the build did` with what the harness said, then what the person may reply. A person reads it.

## Standing assets

- **reply** (`text/markdown`, written copy): the style guide (`https://schemas.agentmesh.ai/style-guide/v1`), because written copy a person reads speaks for the organization, and the style guide says its voice, its spelling and the words it uses and avoids; the brand profile (`https://schemas.agentmesh.ai/brand/v1`), because written copy that speaks for the organization names it, and the brand profile says how its name is written, how it is first mentioned and the words it never says.
- The Design declares exactly these as `can_use`, each with what it reads, what it does with it and what it does `without` it: `https://schemas.agentmesh.ai/brand/v1`, `https://schemas.agentmesh.ai/style-guide/v1`.

## Settings

No setting beyond the bindings' own.

## Decisions

Decisions 1 to 5 choose the agent's structure.

### Decision 1. Drive the coding harness and never write a build's files

Context: One builder writes an agent through the plugin; a second author here would be the separate-author line the plan retires.

Drivers: `one-author` (The harness and the plugin are the only authors of a build's files).

Why: The plugin's check holds what the harness writes; anything this agent wrote would be held by nothing.

Alternatives:

- Write the spec and the files from the request itself: not chosen, because It would be a second author outside the check.

Consequences:

- Every file in a build comes from the harness through the plugin.

### Decision 2. Pass the person's approval through only when their message says approve for the build

Context: The plugin keeps approval as the person's command, which the harness may not run.

Drivers: `trust` (The person's approval passes through only on their own word).

Why: With no person at the keyboard, the person's own word in their message is the approval.

Alternatives:

- Let the harness approve when the check passes: not chosen, because The approval would not be the person's.

Consequences:

- A build waits in the spec phase until the person says approve.
- The approval is offered in the reply only when the check says the spec waits for the person.

### Decision 3. Read the phase and what is missing from the build folder's own check, and say it in the check's words

Context: The plugin works in two phases, the spec and the build, and its check names the phase and what each still needs.

Drivers: `trust` (The person's approval passes through only on their own word); `one-author` (The harness and the plugin are the only authors of a build's files).

Why: The check is the judge of a build; a reply that judged for itself could say a build passed when it has not.

Alternatives:

- Read the harness's own words for where the build is: not chosen, because The harness can say it is done when the check does not.

Consequences:

- The reply says the build has passed only when the check says so.
- When the check does not answer, the reply says it could not tell.

### Decision 4. Once the spec is approved, ask the harness to carry on until the check says the build has passed

Context: In the build phase the builder writes everything in any order and the check judges it together.

Drivers: `speed` (One harness run per message, up to the harness's own limit).

Why: One run carries the build to its end or to something only the person can decide.

Alternatives:

- Ask the harness for one stage at a time: not chosen, because The build has no stages any more, only gates judged together.

Consequences:

- A message after the approval usually ends with the build passed, or with the person's question.

### Decision 5. Keep the person's words in said.md itself, and run the harness with ADLC_NOT_THE_PERSON=1

Context: The plugin keeps what is typed at the harness in said.md as the person's, unless the program typing says it is not the person.

Drivers: `the-persons-words` (Only the person's words are kept as theirs, so the check can find the words an answer quotes).

Why: The prompts this agent writes are not the person's, so the plugin must not keep them; the person's own answers are added by the agent before it hands them on.

Alternatives:

- Let the plugin keep every prompt: not chosen, because The agent's own prompts would read as the person's words.

Consequences:

- An answer the builder writes for the person can be checked against what they really said.
- When the harness cannot be run, said.md is put back as it was.

## Questions

None. Every system is named and bound in each environment, and every decision has its reason.
