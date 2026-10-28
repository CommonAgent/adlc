// The incident recorder declines in words what its refusals say it never
// does, and still records an ordinary request.
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
    assert.match(declineReply(d), /^I will not do that: .+\. No record was read and no incident was recorded\.$/);
  }
});

test("requests in other words are declined too", () => {
  for (const t of ["What caused the outage?", "Suggest a fix for the agent.", "Ping the agent to see if it is up.",
    "Fetch the logs from the platform yourself.", "Assume the agent was fine during the gap."]) {
    assert.ok(declineFor(t), `not declined: ${t}`);
  }
});

test("an ordinary request to record an incident is never declined", () => {
  for (const t of ["", "Record an incident", "agent: bravo.platform@agentmesh.ai\ntime: 2026-10-28T13:57:11Z",
    "Record an incident\nagent handle: bravo.platform@agentmesh.ai\nfailure time: 2026-10-28T13:57:11Z",
    "Record what happened to bravo.platform@agentmesh.ai at 13:57 UTC today."]) {
    assert.equal(declineFor(t), null, `declined: ${JSON.stringify(t)}`);
  }
});
