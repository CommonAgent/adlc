// The Design keeps what the spec and the record settle: the settings, the
// model system and an outside service the owner granted.
//   node --test test/design-keeps-systems.test.mjs
//
// No model and no network: the stand-in model is the fixture's prose writer.
// In build b_6e496a709479 (hn-digest, 2026-11-11) the spec listed two counts
// of kind integer, set by either, and the public Hacker News API at its
// address; the architecture record named text-reasoning as its one system and
// granted the Hacker News API as egress. The Design wrote no settings, no
// systems and no run config, and the code critic and the security reviewer
// refused the code that read them. What is pinned: a value kind a person or a
// job sets is a run-config preference with its default and range; a model
// system the record names is declared as kind model with its protocols; and
// a service the record's egress grants is declared with its address setting,
// while one it only asks about is still taken out and asked; and the package
// maker takes the files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { grantedEgressIn, readingOf } from "../scripts/asked.mjs";
import { renderRecord } from "../scripts/architecture-record.mjs";
import { MODEL_PROTOCOLS, structureOf, withGrantedServices } from "../scripts/structure.mjs";
import { designFromSpec } from "../scripts/draft.mjs";
import { agentFilesOf } from "../scripts/files.mjs";
import { reachProblems } from "../scripts/reaches.mjs";
import { checkBuilds } from "../scripts/builds.mjs";
import { proseFor } from "./as-built-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");
const HN = "https://hacker-news.firebaseio.com/v0";

/** The parts of spec-v1 that hn-digest's spec carried and the Design reads. */
const SPEC = () => ({
  format: "spec-v1",
  product: { name: "hn-digest", version: "0.1.0", kind: "agent" },
  purpose: "Reads the top stories on Hacker News and writes a short digest of them.",
  features: [{
    id: "F1", name: "Write the digest", offering: "write-the-digest",
    inputs: [], outputs: [{ name: "digest", kind: "text/markdown" }],
    requirements: [{ id: "F1.R1", shall: "The agent shall write one sentence for each story in the digest.", kind: "behavior", priority: "must", source: "said", verify: "test" }],
    acceptance: [{ id: "F1.A1", gherkin: "Scenario: a digest\n  Given the top stories\n  When the digest is written\n  Then it has one sentence per story", checks: ["F1.R1"] }],
  }],
  interfaces: [],
  constraints: [{ id: "C1", kind: "limit", shall: "The agent shall use a model to write the sentences with a spending ceiling of 1 USD per day.", priority: "must", source: "said", verify: "inspection" }],
  systems: [{ name: "public Hacker News API", reach: "read", why: "To read the current top stories. It needs no key.", address: HN }],
  settings: [
    { name: "stories_to_read", kind: "integer", default: 30, min: 10, max: 100, set_by: "either", about: "How many top stories to read from Hacker News." },
    { name: "digest_size", kind: "integer", default: 5, min: 1, max: 10, set_by: "either", about: "How many stories to put in the digest." },
  ],
  price: "free",
  open: [],
});

const PLATFORM = { product: "platform", provided_by: "platform" };

/** The record the solution architect wrote for hn-digest, after the owner
 *  answered "egress-1: yes" and "limit-cost: 1 USD per day, across every
 *  job". `granted` false is the record before the answer. */
const RECORD = ({ granted = true } = {}) => renderRecord({
  title: "a daily Hacker News digest",
  statement: "An agent that reads the top stories on Hacker News and writes a short digest.",
  environments: ["dev", "test", "production"],
  kind: { kind: "plugin-on-harness", why: "A short program with one judgment." },
  done: granted,
  questions: granted ? [] : [{ key: "egress-1", question: "May this agent reach public Hacker News API on the network in dev, test and production?" }],
  systems: [{ name: "text-reasoning", plain: "text reasoning", capability: "text", access: "trigger", why: "Writing each sentence is a judgment.", bindings: { dev: PLATFORM, test: PLATFORM, production: PLATFORM } }],
  limits: { cost: { limit: "1 USD per day, across every job", why: "The person set it in an answer" } },
  egress_policy: { dev: "open", test: "open", production: "open" },
  egress: [{ destination: "public Hacker News API", why: "To read the current top stories", granted }],
  decisions: [{ decided: "The agent may reach public Hacker News API", why: "The person granted it in an answer (egress-1: yes)" }],
});

const askedWith = (record) => {
  const dir = mkdtempSync(join(tmpdir(), "spec-keeps-"));
  const at = join(dir, "architecture-record.md");
  writeFileSync(at, record);
  return readingOf({ text: "Design the agent from the approved spec.", files: [{ path: at, media_type: "text/markdown" }] });
};

const prose = async (req) => ({ text: JSON.stringify(proseFor(req.body.contents[0].parts.map((p) => p.text).join("\n\n"))) });

test("a spec's integer settings, set by a person or a job, are run-config preferences with their default, range and step", () => {
  const { draft } = structureOf(SPEC());
  assert.deepEqual(draft.run_config.settings, [
    { name: "stories_to_read", kind: "preference", label: "Stories to read", about: "How many top stories to read from Hacker News.", default: 30, min: 10, max: 100, step: 1, job_may_set: true },
    { name: "digest_size", kind: "preference", label: "Digest size", about: "How many stories to put in the digest.", default: 5, min: 1, max: 10, step: 1, job_may_set: true },
  ]);
  const desc = JSON.parse(agentFilesOf(draft)["agent-descriptor.json"]);
  assert.deepEqual(desc.run_config.settings.map((s) => s.name), ["stories_to_read", "digest_size"]);
  // What the install places is not a run config, whatever its value type.
  const spec = SPEC();
  spec.settings.push({ name: "BATCH", kind: "integer", default: 2, set_by: "install", about: "x" }, { name: "HN_ADDRESS", kind: "address", default: HN, set_by: "either", about: "x" });
  assert.deepEqual(structureOf(spec).draft.run_config.settings.map((s) => s.name), ["stories_to_read", "digest_size"]);
});

test("a model system the record names is declared as kind model with its protocols, though the spec lists none", () => {
  const without = structureOf(SPEC()).draft;
  assert.equal(without.systems.some((s) => s.kind === "model"), false, "no record, no model system");
  assert.equal(without.jobs[0].how.intelligence, "none");
  const { draft } = structureOf(SPEC(), { architecture: { systems: ["text-reasoning"] } });
  assert.deepEqual(draft.systems.find((s) => s.name === "text-reasoning"), { name: "text-reasoning", kind: "model", access: "trigger", protocols: MODEL_PROTOCOLS, needs: "" });
  assert.deepEqual(draft.jobs[0].how, { control: "script", intelligence: "called", cost: "metered", contract: "full" });
  const runtime = JSON.parse(agentFilesOf(draft)["agent-runtime-requirements.json"]);
  assert.deepEqual(runtime.systems.find((s) => s.name === "text-reasoning"), { name: "text-reasoning", kind: "model", protocols: MODEL_PROTOCOLS });
});

test("the destinations a record's egress grants are read from its body, and one only asked is not", () => {
  assert.deepEqual(grantedEgressIn(RECORD()), ["public Hacker News API"]);
  assert.deepEqual(grantedEgressIn(RECORD({ granted: false })), []);
  assert.deepEqual(askedWith(RECORD()).architecture.egress_granted, ["public Hacker News API"]);
  const held = withGrantedServices({ systems: ["text-reasoning"], egress_granted: ["public Hacker News API"] }, SPEC());
  assert.deepEqual(held.systems, ["text-reasoning", "public-hacker-news-api"]);
  assert.deepEqual(held.granted_services, ["public-hacker-news-api"]);
});

test("the hn-digest case: the granted Hacker News API survives the Design as a declared service with its address setting, beside text-reasoning", async () => {
  const out = await designFromSpec({ spec: SPEC(), asked: askedWith(RECORD()), call: prose, table: null });
  assert.deepEqual(out.spec.systems.map((s) => [s.name, s.kind]), [["public-hacker-news-api", "service"], ["text-reasoning", "model"]]);
  const hn = out.spec.systems[0];
  assert.deepEqual(hn.settings, [{ env: "PUBLIC_HACKER_NEWS_API_ADDRESS", purpose: "where public Hacker News API answers, its base address", default: HN }]);
  assert.match(hn.needs, /hacker-news\.firebaseio\.com/);
  assert.deepEqual(reachProblems(out.spec), []);
  assert.equal(out.blanks.some((b) => b.key === "architecture"), false, "nothing goes back to the architect");
  assert.deepEqual(out.findings.filter((f) => /architecture record/.test(f)), []);
  assert.deepEqual(out.spec.run_config.settings.map((s) => s.name), ["stories_to_read", "digest_size"]);
  assert.match(out.notes, /public-hacker-news-api is declared because the architecture record's egress grants it/);
  // The install file carries the setting's variable and purpose, and the
  // address only in the spec and the draft's default.
  const runtime = JSON.parse(agentFilesOf(out.spec)["agent-runtime-requirements.json"]);
  assert.deepEqual(runtime.systems.map((s) => s.name), ["public-hacker-news-api", "text-reasoning"]);
  assert.deepEqual(runtime.systems[0].settings, [{ env: "PUBLIC_HACKER_NEWS_API_ADDRESS", purpose: "where public Hacker News API answers, its base address" }]);
});

test("a service the record only asks about is still taken out of the files and asked of the architect", async () => {
  const out = await designFromSpec({ spec: SPEC(), asked: askedWith(RECORD({ granted: false })), call: prose, table: null });
  assert.deepEqual(out.spec.systems.map((s) => s.name), ["text-reasoning"]);
  assert.match(out.blanks.find((b) => b.key === "architecture")?.question ?? "", /public-hacker-news-api, which the architecture record does not name/);
});

test("the package maker takes the hn-digest files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-keeps-build-"));
  try {
    const out = await designFromSpec({ spec: SPEC(), asked: askedWith(RECORD()), call: prose, table: null });
    const built = checkBuilds({ spec: out.spec, env: { BUILD_PY }, keep: join(dir, "agent") });
    assert.equal(built.checked, true, "the builder ran");
    assert.deepEqual(built.problems, []);
    assert.equal(built.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
