import { test } from "node:test";
import assert from "node:assert/strict";
import { stopNotice, stoppedReply } from "../scripts/stop.mjs";

test("a stop notice names the job", () => {
  assert.deepEqual(stopNotice("halt j-123456: stop now"), { job: "j-123456" });
  assert.equal(stopNotice("read the news"), null);
  assert.equal(stoppedReply({ job: "j-123456" }), "Nothing was running for j-123456, so nothing was done.");
});
