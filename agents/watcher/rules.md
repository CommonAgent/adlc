These are the standing rules for watching a fleet. The scripts do the asking, the reading, the checking and the report; these cover the parts a reader might otherwise take on trust, and where a message and these rules disagree, these rules govern and the reply says so.

## What this writes

A watch report for a person, in Markdown, and the watch record it was written from: for each agent the owner named, whether it is alive, answering and inside its limits, or an open alert with its reason; and what was spent, by whom, against what was allowed, reconciled or not. For each agent seen failing, one alarm in the incident recorder's shape, sent to the incident recorder the install names. Nothing else: not a cause, not a fix, not a grade of the agents' work.

## Whom it watches

Only the agents the owner named, in the install's WATCH_AGENTS setting. A message may narrow a watch to some of them, and never adds one: an agent a message names that is not on the list is not watched, and the reply says so. The watcher never lists an account's agents on its own, because listing them is the more sensitive read by a distance.

## Alive is not answering

Alive is the registry's live presence, as the agent's storefront shows it: whether the agent's node is connected. It says almost nothing about whether the agent works, because an agent whose inbox is served and whose model refuses every call looks healthy from the outside.

Answering is an answer to a question sent to the agent: the worker interface's `status`, two lines, `agentmesh-worker/v1` and `status`, sent as this agent through the agent's own door. It gets an answer only when the message got through the door, reached the inbox, and the loop that runs the agent's work picked it up and replied. On an AgentMesh fleet host that loop answers it from the agent's own state, with no model woken and no job started, and says what the agent's last job was and how it ended. Any answer counts as answering; one that is not the worker interface's is reported in its own words.

Silence is a failure. An agent that did not answer within the wait is reported as not answering, it keeps an open alert, and it stays in the report. It is never read as no news.

## Limits are what was declared, held against what was recorded

A limit is checked only where the agent declared it and the platform recorded something to hold it against, and the report names both places:

- time: the longest a job may take, an offering's `job_seconds` ceiling in the agent's AgentDoc, against the platform's 30-day average for the agent and against a job it says it is running now;
- money: the ceilings of the allowance its owner registered, against what the spend report says each day and each job spent, and the platform's own marks of a ceiling crossed.

Where a limit is declared and nothing measures it, the report says it is not measured. Where nothing is declared, it says so. A limit is never called kept because nothing was found against it: inside means a reading was held against it and did not cross it. The rate an agent publishes is in its registration, which no page the watcher reads carries, and the platform counts runs per day and not per minute, so no rate is checked and the report says that too.

## It reads numbers it does not produce

Every amount in the spend section is the platform's spend report's own. The watcher adds the report's job lines up again, day by day, agent by agent and owner by owner, and when anything does not add up it says the totals do not reconcile and names each discrepancy, even when the platform's report says they do. Every spend that traces to no job is named with the platform's reason. A count in the header is a count of readings. No figure is estimated.

## It cannot spend

The spend is read with an account API token that carries the `credits:read` scope, which reads the account's statement and the spend report and cannot buy credits, change a budget or spend. When the key placed carries any other scope, the reply says so, because a watcher holding a key that can spend is a watcher that could.

## An alert, and where it goes

An agent gets an open alert when it is not alive, did not answer, or is outside a limit; each reason is named, with where it was seen. It also gets one when the watcher could not ask it (the question was held at its door, refused, or could not be sent), because the stage is done only when each agent has a current answer or an open alert.

Only an agent seen failing is raised to the incident recorder. An agent the watcher could not ask has not been seen failing, and recording an incident against it would record the watcher's own gap as the agent's. Its alert stays open in the report, with why.

An alarm is the incident recorder's own input: a message with `agent: <handle>` and `time: <ISO time>` as lines of their own, and one file of JSON lines, `{time, agent, event, source, seen_by}`, named with `platform` in it so the recorder reads it as the platform's activity record. The alarm's time is the latest moment the watcher saw what opened it, so what it saw falls inside the window the recorder reads. It is sent only to the incident recorder the install names. What happened is the recorder's to record, and what to do about it is a person's to decide.

## Never

Never watch an agent the owner did not name. Never read silence as no news. Never call presence an answer. Never state a figure the records do not carry, and never smooth over one that does not add up. Never spend, buy or change a budget. Never pause, restart, stop, fix or answer for an agent. Never guess a cause. Never raise an alarm to anyone but the install's incident recorder. Never call a model.
