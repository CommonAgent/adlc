# Review of brand-reader 0.2.0

- package: brand-reader 0.2.0
- change: the whole package (no diff came)
- findings: 3
- open: 2
- reviewed_by: code-critic 0.1.0
- reviewed_at: 2026-10-27T22:00:00.000Z

## Findings

### F1. scripts/choose-roles.mjs names the model gemini-2.5-flash.

- Place: `scripts/choose-roles.mjs:52`
- Rule: model-in-code (no model name or version in code; scripts read the configured model through the shared caller)
- Claim: scripts/choose-roles.mjs names the model gemini-2.5-flash.
- Consequence: This script runs gemini-2.5-flash whatever the install configured, so changing the model is a new version rather than a setting, and the day gemini-2.5-flash is retired the job fails (Brand reader answered 404 that way). Read the model from TEXT_MODEL or AGENT_MODEL through the shared caller.
- Found by: the house-rule check
- Answer: open

### F2. 6 pieces are declared as a bare application/json: "brand profile", "fetched", "statements", "observations", "roles" (lines 26, 61, 79, 86).

- Place: `agent-descriptor.json:26`
- Rule: kind-mismatch (every delivered piece matches its declared kind)
- Claim: 6 pieces are declared as a bare application/json: "brand profile", "fetched", "statements", "observations", "roles" (lines 26, 61, 79, 86).
- Consequence: The kind says only that the bytes parse, not what is inside, so the next agent, the person reviewing it and the App cannot tell what they hold. Content a person reads, or one agent hands another, is text/markdown with a convention; exact typed data is application/vnd.agentmesh.<name>+json with its shape sketched in the about.
- Found by: the house-rule check
- Answer: The brand profile is read by code downstream and keeps its JSON; it becomes application/vnd.agentmesh.brand-profile+json in 0.3.0, and the step records in the same release.

### F3. The roles step treats a model that answered 404 the same as a model that chose no role.

- Place: `scripts/choose-roles.mjs:405`
- Rule: general (general code quality)
- Claim: When the call fails, the error's body is read and the roles are set to none, the same value a model gives when the page has no accent.
- Consequence: A profile with no primary and no accent reads as a site that declares none, so an owner adopts a draft that lost two values to an outage and nothing in the profile says the model was never reached.
- Found by: the review
- Answer: open

## Not reviewed

- Read as context and not reviewed: records/build-0.2.0.md, references/brand-profile.md, references/what-counts.md, scripts/package-lock.json, scripts/package.json.
- The Code stage's account did not come, so the code was not held to what its writer says it did.

## How to answer

Answer each finding by a change or a reason. For a reason, write it after `Answer:` in place of `open`. For a change, change the code. Then send this document back with the package, and the next review says which findings are answered and which are still open. The review is done when `open` is 0. Whether to accept a finding is yours to decide; nothing here changes the code.
