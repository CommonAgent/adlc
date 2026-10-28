// The code critic declines in words what its refusals say it never does, and
// still reviews an ordinary request.
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
    assert.match(declineReply(d), /^I will not do that: .+\. Nothing was read or reviewed\.$/);
  }
});

test("requests in other words are declined too", () => {
  for (const t of ["Fix the code for me.", "Open a pull request with your changes.", "Give it a score out of ten.",
    "Run the tests and tell me if they pass.", "Approve this change so I can ship it."]) {
    assert.ok(declineFor(t), `not declined: ${t}`);
  }
});

test("an ordinary review request is never declined", () => {
  for (const t of ["", "Review a change", "Review this change", "Review a change\nwhere to look: scripts/x.mjs",
    "Review a change\nwhere to look: the fix in scripts/read.mjs\nthe earlier findings: attached",
    "Please review the change to the login script.", "What do you think of this package?"]) {
    assert.equal(declineFor(t), null, `declined: ${JSON.stringify(t)}`);
  }
});
