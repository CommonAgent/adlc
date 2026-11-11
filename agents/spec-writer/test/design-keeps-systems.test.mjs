// The Design keeps what the spec and the record settle: the settings, the
// model system, the public service the record binds to itself, and the
// spending limit as a ceiling.
//   node --test test/design-keeps-systems.test.mjs
//
// No model and no network: the stand-in model is the fixture's prose writer.
// In build b_6e496a709479 (hn-digest, 2026-11-11) the spec listed two counts
// of kind integer, set by either, and the public Hacker News API at its
// address; the architecture record named text-reasoning and asked for the
// Hacker News API, which the owner granted, with a limit of 1 USD per day.
// The Design wrote no settings, no systems, no ceilings and no run config,
// and the code critic and the security reviewer refused the code that read
// them. The record here is the one the solution architect writes for that
// case after "egress-1: yes" (its test/hn-digest.test.mjs holds the two
// equal). What is pinned: a value kind a person or a job sets is a
// run-config preference; every system the record names is declared,
// text-reasoning as kind model with its protocols and hacker-news as a
// service with its address as a setting's default; the cost limit is the
// model system's ceiling in Common Agent's shape; a service the record does
// not name is still taken out and asked; the files are the ones the security
// reviewer's test reviews; and the package maker takes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readingOf } from "../scripts/asked.mjs";
import { MODEL_PROTOCOLS, ceilingOf, structureOf } from "../scripts/structure.mjs";
import { designFromSpec } from "../scripts/draft.mjs";
import { agentFilesOf } from "../scripts/files.mjs";
import { reachProblems } from "../scripts/reaches.mjs";
import { checkBuilds } from "../scripts/builds.mjs";
import { proseFor } from "./as-built-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "hn-digest");
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");
const HN = "https://hacker-news.firebaseio.com/v0";
const RECORD = readFileSync(join(FIX, "architecture-record.md"), "utf8");

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

const askedWith = (record) => {
  const dir = mkdtempSync(join(tmpdir(), "spec-keeps-"));
  const at = join(dir, "architecture-record.md");
  writeFileSync(at, record);
  return readingOf({ text: "Design the agent from the approved spec.", files: [{ path: at, media_type: "text/markdown" }] });
};

const prose = async (req) => ({ text: JSON.stringify(proseFor(req.body.contents[0].parts.map((p) => p.text).join("\n\n"))) });
const design = (record = RECORD) => designFromSpec({ spec: SPEC(), asked: askedWith(record), call: prose, table: null });

test("a spec's integer settings, set by a person or a job, are run-config preferences with their default, range and step", () => {
  const { draft } = structureOf(SPEC());
  assert.deepEqual(draft.run_config.settings, [
    { name: "stories_to_read", kind: "preference", label: "Stories to read", about: "How many top stories to read from Hacker News.", default: 30, min: 10, max: 100, step: 1, job_may_set: true },
    { name: "digest_size", kind: "preference", label: "Digest size", about: "How many stories to put in the digest.", default: 5, min: 1, max: 10, step: 1, job_may_set: true },
  ]);
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
});

test("a spending limit in words is a ceiling: its currency, per task or day, and its number", () => {
  assert.deepEqual(ceilingOf("1 USD per day, across every job"), { unit: "USD", per: "day", suggested: 1 });
  assert.deepEqual(ceilingOf("at most 2 USD a day"), { unit: "USD", per: "day", suggested: 2 });
  assert.deepEqual(ceilingOf("$0.50 per job"), { unit: "USD", per: "task", suggested: 0.5 });
  assert.equal(ceilingOf("whatever the owner thinks is fair"), null);
});

test("the record's header gives the Design the public binding and the cost limit", () => {
  const a = askedWith(RECORD).architecture;
  assert.deepEqual(a.systems, ["text-reasoning", "hacker-news"]);
  assert.deepEqual(a.bindings["hacker-news"].production, { public: true, product: "itself", address: HN, key: "none", access: "read", approved: "egress-1" });
  assert.equal(a.cost_limit, "1 USD per day, across every job");
});

test("the hn-digest case: the files declare hacker-news with its address setting, text-reasoning with its ceiling, and the two settings", async () => {
  const out = await design();
  assert.deepEqual(out.spec.systems.map((s) => [s.name, s.kind]), [["hacker-news", "service"], ["text-reasoning", "model"]]);
  const hn = out.spec.systems[0];
  assert.equal(hn.access, "read");
  assert.deepEqual(hn.settings, [{ env: "HACKER_NEWS_ADDRESS", purpose: "where public Hacker News API answers, its base address", default: HN }]);
  assert.match(hn.needs, /hacker-news\.firebaseio\.com/);
  assert.deepEqual(reachProblems(out.spec), []);
  assert.equal(out.blanks.some((b) => b.key === "architecture"), false, "nothing goes back to the architect");
  assert.deepEqual(out.findings.filter((f) => /declares the system|names the system/.test(f)), []);
  assert.deepEqual(out.spec.run_config.settings.map((s) => s.name), ["stories_to_read", "digest_size"]);
  const files = agentFilesOf(out.spec);
  const runtime = JSON.parse(files["agent-runtime-requirements.json"]);
  assert.deepEqual(runtime.systems, [
    { name: "hacker-news", kind: "service", settings: [{ env: "HACKER_NEWS_ADDRESS", purpose: "where public Hacker News API answers, its base address" }] },
    { name: "text-reasoning", kind: "model", protocols: MODEL_PROTOCOLS, spends: { unit: "USD" } },
  ]);
  // Common Agent Section 12.4, item 4: the spending system, per what, the
  // side that applies it, and the number the owner's instruction may adopt.
  assert.deepEqual(runtime.ceilings, [{ system: "text-reasoning", per: "day", enforced_by: "runtime", suggested: 1 }]);
  const desc = JSON.parse(files["agent-descriptor.json"]);
  assert.deepEqual(desc.systems.map((s) => s.name), ["hacker-news", "text-reasoning"]);
  assert.deepEqual(desc.run_config.settings.map((s) => s.name), ["stories_to_read", "digest_size"]);
  // These are the files the security reviewer's test reviews.
  for (const f of ["agent-descriptor.json", "agent-runtime-requirements.json"]) assert.equal(files[f], readFileSync(join(FIX, f), "utf8"), f);
});

test("a service the record does not name is still taken out of the files and asked of the architect", async () => {
  const without = RECORD.replace("systems: [text-reasoning, hacker-news]", "systems: [text-reasoning]").replace(/\n  hacker-news:\n(?: {4}.+\n)+/, "\n");
  const out = await design(without);
  assert.deepEqual(out.spec.systems.map((s) => s.name), ["text-reasoning"]);
  assert.match(out.blanks.find((b) => b.key === "architecture")?.question ?? "", /public-hacker-news-api, which the architecture record does not name/);
});

test("the package maker takes the hn-digest files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-keeps-build-"));
  try {
    const out = await design();
    const built = checkBuilds({ spec: out.spec, env: { BUILD_PY }, keep: join(dir, "agent") });
    assert.equal(built.checked, true, "the builder ran");
    assert.deepEqual(built.problems, []);
    assert.equal(built.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
