# watcher 0.1.0: the reference agent for Monitor and Cost

Date: 2026-10-28.

## Why

The owner approved filling every lifecycle stage except Retract, Rollback and
Eval (relayed by the coordinator, 2026-10-27). Monitor (17) and Cost (20)
name the watcher role (agentroles.ai/watcher.html, v0.1.0-draft), and no
agent held it, though the Lifeguards family names one. The Cost half's
reading, the platform's spend report, was built the day before
(AgentMesh #679); the Monitor half and the agent were not.

## What was decided

- One agent for both stages, because the role is one role: two standing
  reports off records the platform already keeps, for the same reader.
- It lives in CommonAgent/adlc with the other lifecycle agents and the
  incident recorder, the Lifeguard it hands to. It reaches the platform only
  over HTTP and the mesh, so nothing of it belongs in the AgentMesh
  repository, where lifecycle agents arrive by moving the adlc pin.
- Alive and answering are two answers. Alive is the registry's presence, from
  the public storefront. Answering is an answer to the worker interface's
  `status` exchange, sent as the watcher with `agentmesh messages send
  --wait`: the lightest request that passes the agent's door and its work
  loop, which a fleet host answers from state with no model and no job. The
  lighter requests a node answers itself (the registry's probe, the
  diagnostic echo, `describe`) prove only what presence proves.
- Limits are checked only against what was declared and what the platform
  recorded: `job_seconds` in the AgentDoc against the 30-day average and a
  job running now; the registered allowance's ceilings against the spend
  report and the platform's crossing marks. Rate is said to be not checked,
  because no readable record carries it.
- The agents watched are the owner's setting (WATCH_AGENTS). A message may
  narrow a watch and never widen it, and the watcher never lists an
  account's agents (the role's own rule).
- It cannot spend. The spend report is read with a token carrying only
  `credits:read`, a scope split out of `credits` in AgentMesh for this agent
  (the `credits` scope can also buy credits). The reply says so when the key
  it is given can do more than read.
- It re-adds the spend report's job lines and says the totals do not
  reconcile when they do not, whatever the report says.
- Every open alert seen as a failure (not alive, not answering, outside a
  limit) is raised to the incident recorder in its own input shape: the two
  lines `agent:` and `time:`, and a JSON-lines file named with `platform` so
  the recorder reads it as the platform's activity record. A test hands the
  alarm to the recorder's own reader. An agent the watcher could not ask
  keeps an open alert and is not raised, because the gap is the watcher's.
- An alert stays open across watches (`open-alerts.json`, standing): one
  raised and unchanged is reported as still open and not raised again, so a
  scheduled watch does not file the same failure as a new incident each run.
- From the review of PR 27: a crossing the report measured and the platform
  also marked is one reason, not two; a crossing's alarm is dated when the
  watcher read it; the send's words are read when no node runs here (and the
  questions then go one at a time); a hold or refusal nested under `payload`
  is read as one; an amount the report leaves out is zero; a 409 for one name
  costs only that name's spend; a watch of more than 50 agents is refused.
- No model, and specific kinds throughout: `text/markdown` for the report,
  vendor `+json` kinds for the record and the working pieces, and
  `application/x-ndjson` for the alarm. Free: it calls no model.

## Tests

34 pass. The role's own check (three named agents, one quiet, one over its
ceiling: the quiet one named as not answering, the crossed ceiling named, the
spend figures equal to the records', both alarms raised and nothing else
sent); an alarm read by the incident recorder's own reader with every line
inside its window; the pieces as declared; no agent named; a message that
narrows and cannot widen; an agent held at its door; an agent that is down;
a stranger on the list and a key that can do more than read; the real dev
spend report reconciled with its untraced amount named; and each decision on
its own (the watch list, the window, every shape a send prints, presence,
an answer that is not the worker interface, time against the average and a
running job, money against the allowance and the crossing marks, an agent
not asked, a report whose totals do not add up, the alarm's shape, and a
raise read as sent, held or refused). The parts agree, every kind is
specific, no model is named, and the platform reads are GETs only.

## Who held each step

The harness (Claude Code) wrote the spec, the scripts and the tests on the
owner's approval relayed by the coordinator; packaging, the deploy request and
the install go through the package maker, the platform account's deploy queue
and the deployment manager, on dev first.
