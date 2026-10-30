// Platform bounds enforcement and bound attribution.
//
// What is worth pinning: the platform bound checker identifies whether a bound
// is held by the platform, by runtime enforcement, by package code only, or
// by none; open egress is attributed to none; ceilings are verified against
// platform enforcement capabilities; missing required arguments exit 2.
// Nothing here touches a network or calls a model.
// Run: node --test test/platform.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boundHeldBy, platformEnforces } from "../scripts/platform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "scripts", "platform.mjs");

test("a bound with open egress is reported as enforced by none", () => {
  const held = boundHeldBy({
    act: "Reaching an address outside the package's declared systems",
    kind: "egress",
    egress: "open",
  });
  assert.match(held, /enforced by none/);
});

test("a bound held by package code alone is stated as such", () => {
  const held = boundHeldBy({
    act: "Writing only to weather-service",
    kind: "access",
    enforcedBy: "package",
  });
  assert.match(held, /package/);
});

test("a platform enforced ceiling is recognized as runtime enforced", () => {
  assert.equal(platformEnforces("task"), true);
  const held = boundHeldBy({
    act: "weather-service spending",
    kind: "ceiling",
    enforcedBy: "runtime",
  });
  assert.match(held, /platform|runtime/);
});

test("platform script process contract exits 2 when required variables or arguments are missing", () => {
  const res = spawnSync(process.execPath, [scriptPath], {
    env: {},
    encoding: "utf8",
  });
  assert.equal(res.status, 2);
});
