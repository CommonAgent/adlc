// A system's address is settled at Requirements, as the agent's own files are later held to it
// (reaches.mjs). The fixtures are the two specs of a real build (hn-digest 0.1.0 on Product
// Factory's cloud machine, 2026-11-11): the first gave the Hacker News API two address settings
// and no address, was approved, and was held only at the agent's files; the revision carries
// the address and passes.
//
//   node --test test/system-address.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { specProblems, systemAddressProblems } from "../scripts/spec-check.mjs";

const AT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hn-digest-run");
const first = JSON.parse(readFileSync(join(AT, "first-spec.json"), "utf8"));
const revised = JSON.parse(readFileSync(join(AT, "revised-spec.json"), "utf8"));

test("the run's first spec is held at Requirements: a keyless service's address is no setting", () => {
  assert.deepEqual(systemAddressProblems(first), [
    "system news lists its address as the setting NEWS_API_ADDRESS, and a service that takes no key carries its address in `address`, with no setting for it; put the address in `address` and take the setting out",
    "system news lists its address as the setting NEWS_ITEM_PAGE_ADDRESS, and a service that takes no key carries its address in `address`, with no setting for it; put the address in `address` and take the setting out",
  ]);
  assert.ok(specProblems(first).some((p) => /^system news lists its address as the setting NEWS_API_ADDRESS/.test(p)), "specProblems carries it, so the spec writer and the ADLC plugin's Requirements check both hold it");
});

test("the run's revised spec names the address, and passes", () => {
  assert.deepEqual(systemAddressProblems(revised), []);
});

test("a keyless service with no address and no fetching is named; one that fetches what it is handed is not", () => {
  const sys = (s) => ({ systems: [{ name: "pages", reach: "read", why: "To read the page.", ...s }] });
  assert.match(systemAddressProblems(sys({}))[0], /^system pages is reached over the network and the spec gives no `address` for it/);
  assert.deepEqual(systemAddressProblems(sys({ why: "It fetches each page a story links to." })), []);
  assert.deepEqual(systemAddressProblems(sys({ reach: "none" })), []);
});

test("a service that takes a credential may have its address installed as a setting", () => {
  const spec = { systems: [{ name: "code-host", reach: "read", why: "To read pull requests on GitHub.", credential: { name: "code-host-token", env: "CODE_HOST_TOKEN" }, settings: [{ env: "CODE_HOST_ADDRESS", purpose: "The base address of the GitHub API." }] }] };
  assert.deepEqual(systemAddressProblems(spec), []);
});
