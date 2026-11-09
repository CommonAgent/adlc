// The echo agent's own test, as its repository has it: it reads a reply
// through the shared matcher at the repository's top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchReply } from "../../../lib/match-reply.mjs";
import { echo } from "../scripts/echo.mjs";

test("an echo is matched to the greeting it answers", () => {
  assert.equal(matchReply(echo("hello")), "greeting");
});

test("an echo of nothing matches nothing", () => {
  assert.equal(matchReply(echo("")), null);
});
