// The generators on the Hacker News digest: from its approved spec, the
// builder's architecture facts and its prose, the record is finished once the
// person approves the one service, and the agent's files name the record's
// systems, carry no address, and hold every prose key.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filesFrom, recordFrom, statementOf } from "../kit/generate.mjs";

const AT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hn-digest");
const read = (name) => JSON.parse(readFileSync(join(AT, name), "utf8"));
const spec = read("spec.json");
const named = read("architecture.json");
const prose = read("prose.json");

test("the first record asks the person about the one public service, and is not finished", async () => {
  const r = await recordFrom({ spec, named });
  assert.equal(r.done, false);
  assert.deepEqual(r.questions.map((q) => q.key), ["egress-1"]);
  assert.match(r.open, /egress-1/);
  assert.deepEqual(r.forbidden, []);
});

test("the person's yes, read against the record that asked it, binds the service to itself", async () => {
  const first = await recordFrom({ spec, named });
  const r = await recordFrom({ spec, named, answers: { "egress-1": "yes" }, earlier: first.text });
  assert.equal(r.done, true);
  assert.deepEqual(r.questions, []);
  assert.equal(r.open, "");
  assert.match(r.text, /^systems: \[text-reasoning, hacker-news\]$/m);
  assert.match(r.text, /hacker-news:\n {4}dev: itself at https:\/\/hacker-news\.firebaseio\.com\/v0, no key, read, approved by the owner in egress-1/);
});

test("the agent's files take the record's systems, and the address is a setting with no value", async () => {
  const first = await recordFrom({ spec, named });
  const rec = await recordFrom({ spec, named, answers: { "egress-1": "yes" }, earlier: first.text });
  const r = filesFrom({ spec, recordText: rec.text, prose });
  assert.deepEqual(r.empty, []);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.misshapen, []);
  const runtime = JSON.parse(r.files["agent-runtime-requirements.json"]);
  assert.deepEqual(runtime.systems.map((s) => s.name).sort(), ["hacker-news", "text-reasoning"]);
  const hn = runtime.systems.find((s) => s.name === "hacker-news");
  // Common Agent 12.4, item 3: the install supplies the address; the package carries none (12.6, rule 3).
  assert.deepEqual(hn.settings, [{ env: "HACKER_NEWS_ADDRESS", purpose: hn.settings[0].purpose }]);
  assert.equal(runtime.systems.find((s) => s.name === "text-reasoning").kind, "model");
  const descriptor = JSON.parse(r.files["agent-descriptor.json"]);
  assert.equal(descriptor.refusals, prose.refuses.join("\n"));
  assert.ok(r.files["skills/topic-digest/SKILL.md"].includes(prose["job:topic-digest.good"]));
  assert.ok(r.files["agent-descriptor.json"].includes(prose["job:topic-digest.does"]));
});

test("a key the spec fixes, a key the files lack and a list given as a string are each named", () => {
  const r = filesFrom({ spec, prose: { "job:topic-digest.inputs:topic.about": "x", "system:nowhere.needs": "x", refuses: "one sentence" } });
  assert.deepEqual(r.refused, ["job:topic-digest.inputs:topic.about"]);
  assert.deepEqual(r.unknown, ["system:nowhere.needs"]);
  assert.deepEqual(r.misshapen, ["refuses"]);
  assert.deepEqual(r.laidOut["system:nowhere.needs"], "x");
  assert.ok(r.empty.includes("description"));
});

test("with no words of the person's kept, the statement is the purpose and each quoted phrase once", () => {
  const s = statementOf(spec).split("\n");
  assert.equal(s[0], spec.purpose);
  assert.equal(new Set(s.map((l) => l.toLowerCase())).size, s.length);
  assert.ok(s.includes("spending ceiling of 1 USD per day"));
  assert.equal(statementOf(spec, "  build me a digest  "), "build me a digest");
});
