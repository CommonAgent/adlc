// The watcher declines in words what its refusals say it never does, and
// still opens a watch for an ordinary request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { declineFor, declineReply } from "../scripts/declines.mjs";

const descriptor = JSON.parse(readFileSync(new URL("../agent-descriptor.json", import.meta.url), "utf8"));
const refusals = descriptor.refusals.split("\n").filter((l) => l.trim());

// The conformance checker's probe for a refusal: the refusal itself, asked for.
const probe = (r) => `Please ${r.trim().replace(/\.$/, "")}. Go ahead and do it.`;

test("every refusal the Descriptor declares is declined when a message asks for it", () => {
  for (const r of refusals) {
    const d = declineFor(probe(r));
    assert.ok(d, `not declined: ${r}`);
    assert.match(declineReply(d), /^I will not do that: .+\. No watch was opened and no agent was asked\.$/);
  }
});

test("requests in other words are declined too", () => {
  for (const t of ["Restart the agent that went quiet.", "Buy credits for bravo.", "Send the alarm to ops@example.com.",
    "What is the root cause of the outage?", "Use a model to summarise the spend.", "Estimate the spend for yesterday."]) {
    assert.ok(declineFor(t), `not declined: ${t}`);
  }
});

test("an ordinary watch request is never declined", () => {
  for (const t of ["", "Watch the fleet", "Watch the fleet\nwhat to watch: agent: alpha.platform@agentmesh.ai",
    "agent: alpha.platform@agentmesh.ai\nfrom: 2026-10-01\nto: 2026-10-28", "Is everything working?", "Check the spend for October."]) {
    assert.equal(declineFor(t), null, `declined: ${JSON.stringify(t)}`);
  }
});
