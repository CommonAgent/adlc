// The Descriptor from the agent itself, through the entryway's exchange 2: the
// digest is checked against the bytes, and the spec names it. And the scripts
// run under the names a fleet host copies them to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { descriptorOfAgent, registryExchange, sha256 } from "../entryway.mjs";
import { evalOfAgent } from "../eval-gen.mjs";
import { derive } from "../derive-test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESCRIPTOR = { format: "agent-descriptor-v1", agent_version: "2.0.0", does: "Reads a page.", refusals: "Does not refund.",
  offerings: [{ id: "read-it", steps: [{ id: "fetch" }, { id: "../no" }] }], signatures: [{ sig: "x" }] };
const bytes = Buffer.from(JSON.stringify(DESCRIPTOR));
const honest = async () => ({ bytes, digest: sha256(bytes) });

test("exchange 2's bytes are taken with their digest, and the spec cites it", async () => {
  const got = await descriptorOfAgent("reader.o@e.com", { exchange: honest });
  assert.equal(got.digest, sha256(bytes));
  assert.equal(got.descriptor.agent_version, "2.0.0");
  const spec = await evalOfAgent("reader.o@e.com", { exchange: honest });
  assert.equal(spec.descriptor_sha256, sha256(bytes));
  assert.equal(spec.agent, "reader");
  assert.deepEqual(spec.cases.map((c) => c.id), ["refuse-1", "skill-fetch", "skill-read-it"]);
  assert.match(spec.derived_from, /through its entryway/);
});

test("a digest that is not the bytes', no digest, no bytes, or bytes that are not a Descriptor are refused", async () => {
  await assert.rejects(descriptorOfAgent("a.b@c.de", { exchange: async () => ({ bytes, digest: `sha256:${"0".repeat(64)}` }) }), /have the digest sha256:/);
  await assert.rejects(descriptorOfAgent("a.b@c.de", { exchange: async () => ({ bytes }) }), /without the digest/);
  await assert.rejects(descriptorOfAgent("a.b@c.de", { exchange: async () => ({ bytes: "", digest: "x" }) }), /no Descriptor, which does not conform/);
  const notJson = Buffer.from("not json");
  await assert.rejects(descriptorOfAgent("a.b@c.de", { exchange: async () => ({ bytes: notJson, digest: sha256(notJson) }) }), /is not JSON/);
});

test("the default exchange asks the registry for the agent's key, then its Descriptor, and checks the digest it is sent", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.endsWith("/a/reader.o%40e.com")) return { json: async () => ({ agent_id: "UKEY" }) };
    return { ok: true, arrayBuffer: async () => bytes, headers: { get: (h) => (h === "x-descriptor-sha256" ? sha256(bytes) : null) } };
  };
  const got = await registryExchange("reader.o@e.com", { base: "http://registry.test", fetchImpl });
  assert.deepEqual(asked, ["http://registry.test/a/reader.o%40e.com", "http://registry.test/v1/agents/UKEY/descriptor"]);
  assert.equal(got.digest, sha256(bytes));
  await assert.rejects(registryExchange("x.y@z.io", { base: "http://registry.test", fetchImpl: async () => ({ json: async () => ({}) }) }), /is not registered/);
});

test("derive-test reads a named agent's Descriptor through the exchange, and says so", async () => {
  const [spec, why] = await derive(null, "derive the test for reader.o@e.com", {
    agent: async (handle, into) => {
      const { fromAgent } = await import("../derive-test.mjs");
      return fromAgent(handle, into, { exchange: honest });
    },
  });
  assert.equal(why, null);
  assert.equal(spec.descriptor_sha256, sha256(bytes));
  assert.match(spec.derived_from, /reader\.o@e\.com \(version 2\.0\.0\)/);
});

test("on a fleet host, copied flat as agenteval-<name>, each script finds the others and runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "fleet-"));
  try {
    for (const f of ["eval-gen", "eval-run", "derive-test", "pyjson", "entryway"]) copyFileSync(join(HERE, "..", `${f}.mjs`), join(dir, `agenteval-${f.replace(/^eval-/, "")}.mjs`));
    const gen = spawnSync("node", [join(dir, "agenteval-gen.mjs"), join(HERE, "..", "..", "publisher")], { encoding: "utf8" });
    assert.equal(gen.status, 0, gen.stderr);
    assert.equal(JSON.parse(gen.stdout).agent, "publisher");
    const shown = spawnSync("node", [join(dir, "agenteval-derive-test.mjs"), "--prompt", "derive-test please"], { encoding: "utf8" });
    assert.equal(shown.status, 1, shown.stderr);
    assert.match(shown.stdout, /Attach the agent's package/);
    const ran = spawnSync("node", [join(dir, "agenteval-run.mjs")], { encoding: "utf8" });
    assert.match(ran.stdout, /usage: eval-run\.mjs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
