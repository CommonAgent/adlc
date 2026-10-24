# The records this agent must leave

This is the contract. The agent leaves the following behind, on
every run.

- the incident record per job: facts, sources, and identified record gaps — at `*/incident.json`
- the structured timeline per job: chronological events and gap intervals — at `*/timeline.json`
- the raw record inventory per job: platform and agent record files examined with digests — at `*/inventory.json`
- standing index of incidents recorded by this agent across all runs (kept across tasks) — at `incidents.json`
- the signed job manifest of each delivery, listing each piece by the step that made it. The adapter signs it from pieces.json and keeps it beside the reply.
- what this job did not have and did anyway: each thing that was missing, what was done instead, and the reason where it is known — at `*/went-without.json`

An agent that leaves less than this does not do this job,
whatever else it does well.
