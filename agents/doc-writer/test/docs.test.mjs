// The writer and the check, held to the doc writer role's own test
// (agentroles.ai/doc-writer.html §4): a package with three declared jobs and
// records from two of them. The documentation covers all three, traces every
// line to the declaration or a record, and says the third has no record to
// write from; a line about behaviour the package does not declare fails.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, sortGiven, resolvePath, rangeOf } from "../scripts/given.mjs";
import { writeDocs, offeringOf } from "../scripts/write-docs.mjs";
import { checkDocs } from "../scripts/check-docs.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const NOW = "2026-10-27T12:00:00.000Z";

const file = (name, value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { name, text, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) };
};
const fixture = (name) => file(name, readFileSync(join(FIX, name), "utf8"));

const THREE = {
  format: "agent-descriptor-v1",
  agent_version: "1.2.0",
  does: "Turns a list of names into greetings, counts them, and files them.",
  offerings: [
    { id: "greet", name: "Greet", does: "Writes one greeting per name.", inputs: [{ name: "names", kind: "text", required: true }],
      outputs: [{ name: "greetings", kind: "text/markdown", when: "per_task", about: "Markdown: one `## <name>` per greeting." }],
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" } },
    { id: "count", name: "Count", does: "Counts the names.", inputs: [{ name: "names", kind: "text", required: true }],
      outputs: [{ name: "count", kind: "identifier", when: "per_task" }],
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" } },
    { id: "file-them", name: "File them", does: "Files the greetings.", inputs: [{ name: "greetings", kind: "text/markdown", required: true, given_by: "agent" }],
      outputs: [{ name: "receipt", kind: "application/vnd.example.receipt+json", when: "per_task" }],
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" } },
  ],
  refusals: "Greeting anybody not on the list. Only the names given are greeted.\nSending a greeting. Filing is not sending, and nothing leaves the folder.",
  escalates: [],
  records: [{ name: "the greetings per job", when: "per_task", file: "*/greetings.json" }],
  systems: [],
};
const GREET_RECORD = { offering: "greet", names: ["Ada", "Lin"], greetings: ["Hello, Ada.", "Hello, Lin."] };
const COUNT_RECORD = { skill: "count", names: ["Ada", "Lin"], count: 2 };

function three() {
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("greetings.json", GREET_RECORD), file("count-job.json", COUNT_RECORD)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  return { sources, leftOut, markdown };
}

test("the role's test: three jobs, records from two, every line traced, the third said to have none", () => {
  const { sources, leftOut, markdown } = three();
  const r = checkDocs({ markdown, sources, leftOut });
  assert.deepEqual(r.findings, []);
  assert.ok(r.ok);
  for (const name of ["### Greet", "### Count", "### File them"]) assert.ok(markdown.includes(`\n${name}\n`), name);
  assert.match(markdown, /^- No record of a job of `file-them` was given, so there is no example of it\. \[given\]$/m);
  assert.doesNotMatch(markdown, /No record of a job of `greet`/);
  assert.doesNotMatch(markdown, /No record of a job of `count`/);
  assert.match(markdown, /^From `greetings\.json`: \[S2: json L1-L\d+\]$/m);
  assert.match(markdown, /^- `greetings\.json` is the record declared as: the greetings per job\. \[S1: records\[0\]\]$/m);
  // Every non-structural line carries a mark.
  const body = markdown.split("## Sources")[0].split("\n").slice(9);
  let fenced = false;
  for (const l of body) {
    if (/^(`{3,})/.test(l)) { fenced = !fenced; continue; }
    if (fenced || !l.trim() || l.startsWith("#")) continue;
    assert.match(l, /\[(S\d+: .+|given)\]$/, l);
  }
});

test("a line about behaviour the package does not declare fails the check", () => {
  const { sources, leftOut, markdown } = three();
  const bad = markdown.replace("## What it will not do\n", "## What it will not do\n\n- It also emails every greeting. [S1: does]\n");
  const r = checkDocs({ markdown: bad, sources, leftOut });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => /no template gives this line/.test(f.why)));
});

test("a changed word, an unmarked line, a false silence and a dropped job each fail", () => {
  const { sources, leftOut, markdown } = three();
  const cases = {
    changed: markdown.replace("**names** (text, required).", "**names** (text, optional)."),
    unmarked: markdown.replace("## What it will not do\n", "## What it will not do\n\n- Greets politely.\n"),
    silence: markdown.replace("## Not documented\n", "## Not documented\n\n- The agent descriptor says nothing about what the agent does. [S1: does absent]\n"),
    dropped: markdown.replace(/### File them[\s\S]*?(?=## What it will not do)/, ""),
    example: markdown.replace('"Hello, Ada."', '"Hi, Ada."'),
    given: markdown.replace("## Not documented\n", "## Not documented\n\n- No AgentDoc was given, so its identity and where to send it work are not documented here. [given]\n- No record of a job of `greet` was given, so there is no example of it. [given]\n"),
  };
  for (const [name, md] of Object.entries(cases)) {
    assert.notEqual(md, markdown, `${name} changed nothing`);
    const r = checkDocs({ markdown: md, sources, leftOut });
    assert.equal(r.ok, false, name);
  }
});

test("a real agent: quiz-maker's descriptor, runtime requirements, AgentDoc and run record", () => {
  const { sources, leftOut } = sortGiven([
    fixture("quiz-maker.agentdoc.json"), fixture("quiz-maker.record.json"),
    fixture("quiz-maker.agent-runtime-requirements.json"), fixture("quiz-maker.agent-descriptor.json"),
  ]);
  assert.deepEqual(sources.map((s) => s.kind), ["descriptor", "runtime", "agentdoc", "record"]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  const r = checkDocs({ markdown, sources, leftOut });
  assert.deepEqual(r.findings, []);
  assert.match(markdown, /^# quiz-maker$/m);
  assert.match(markdown, /^agent: quiz-maker\.platform@agentmesh\.ai$/m);
  assert.match(markdown, /^Send it work at `quiz-maker\.platform@agentmesh\.ai`, over agentmesh\. \[S3: sections\.access\]$/m);
  assert.match(markdown, /^- Each job costs 2\.00 USD, a flat price\. \[S2: price\.price\]$/m);
  assert.match(markdown, /^- In the 30 days this record covers it ran 28 jobs: 28 completed and 0 failed, taking 88 seconds each on average\. \[S4: \.\]$/m);
  assert.match(markdown, /^- The AgentDoc says `handling\.retention` was not stated\. \[S3: not_stated\[7\]\]$/m);
  assert.match(markdown, /^- No verdict was given, so nothing here says whether it passed a conformance check\. \[given\]$/m);
  // Each of the six refusals, as the descriptor words it.
  for (let k = 0; k < 6; k++) assert.ok(markdown.includes(`[S1: refusals/${k}]`), `refusal ${k}`);
});

test("the AgentDoc alone is a declaration, read from its own sections", () => {
  const { sources, leftOut } = sortGiven([fixture("quiz-maker.agentdoc.json")]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  const r = checkDocs({ markdown, sources, leftOut });
  assert.deepEqual(r.findings, []);
  assert.match(markdown, /\[S1: sections\.sells\.offerings\[0\]\.inputs\[0\]\]/);
  assert.match(markdown, /No agent descriptor was given/);
  assert.match(markdown, /No runtime requirements were given/);
});

test("a silence is said, and an empty list is a statement and not a silence", () => {
  const d = { ...THREE, escalates: undefined, systems: [] };
  delete d.escalates;
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.ok(checkDocs({ markdown, sources, leftOut }).ok);
  assert.match(markdown, /^- The agent descriptor says nothing about when it hands work back to a person\. \[S1: escalates absent\]$/m);
  assert.match(markdown, /^- It declares that it reaches no system\. \[S1: systems\]$/m);
  assert.match(markdown, /^- No records were given, so nothing here says how it has run\. \[given\]$/m);
});

test("a verdict is documented case by case, and its signature is said to be unchecked", () => {
  const verdict = {
    record: "v1", role: "agent-evaluator", act: "evaluate", subject: { handle: "greeter.example" },
    cases: [{ id: "refusal-1", kind: "refusal", source: "refusals", verdict: "pass" }, { id: "offering-greet", kind: "offering", source: "offerings", verdict: "flagged" }],
    summary: { pass: 1, fail: 0, inconclusive: 0, flagged_for_review: 1 }, conforms: true, produced_at: "2026-10-20T10:00:00Z", by: "UKEY", signatures: [{ tag: "agent-eval-record-v1" }],
  };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("verdict.json", verdict)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- The verdict of 2026-10-20T10:00:00Z: 1 passed, 0 failed, 0 inconclusive and 1 flagged for review\. \[S2: \.\]$/m);
  assert.match(markdown, /^- It says the agent conforms\. \[S2: \.\]$/m);
  assert.match(markdown, /^- It carries 1 signature, which this documentation does not check\. \[S2: \.\]$/m);
  assert.match(markdown, /^ {2}- `refusal-1` \(refusal\): pass\. \[S2: cases\[0\]\]$/m);
  // Dropping the verdict's lines is a finding.
  const dropped = markdown.replace(/## Verdicts[\s\S]*?(?=## )/, "");
  assert.equal(checkDocs({ markdown: dropped, sources, leftOut }).ok, false);
});

test("a record that looks like it holds a credential is named and never quoted", () => {
  const leaky = { offering: "greet", note: "-----BEGIN NATS USER JWT----- eyJ..." };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("greet-job.json", leaky)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.ok(checkDocs({ markdown, sources, leftOut }).ok);
  assert.doesNotMatch(markdown, /BEGIN NATS/);
  assert.match(markdown, /^- `greet-job\.json` is not quoted, because a line in it looks like a credential\. \[given\]$/m);
  assert.match(markdown, /No record of a job of `greet` was given/);
});

test("a build record's heading goes under Versions, and a second descriptor is left out and said", () => {
  const build = "# greeter 1.2.0: the count job\n\n## What changed\n\nCount was added.\n";
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("build-1.2.0.md", build), file("old-descriptor.json", { ...THREE, agent_version: "1.1.0" })]);
  assert.equal(leftOut.length, 1);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- `build-1\.2\.0\.md`: greeter 1\.2\.0: the count job \[S2: L1\]$/m);
  assert.match(markdown, /^- `old-descriptor\.json` was left out: it is a second agent descriptor, and only the first one given is documented\. \[given\]$/m);
});

test("records are matched to jobs by field, by name, by a quoted id, or by there being one job", () => {
  const offs = THREE.offerings;
  const rec = (name, json) => ({ kind: "record", name, json, text: JSON.stringify(json) });
  assert.equal(offeringOf(rec("x.json", { skill: "count" }), offs), 1);
  assert.equal(offeringOf(rec("file-them-run.json", {}), offs), 2);
  assert.equal(offeringOf(rec("x.json", { said: "hello" }), offs), -1);
  assert.equal(offeringOf(rec("x.json", { said: "greet" }), offs), 0);
  assert.equal(offeringOf({ kind: "record", name: "x.json", json: { a: 1 }, text: '{"job":"x","id":"greet"}' }, offs), 0);
  assert.equal(offeringOf(rec("x.json", { a: 1 }), [offs[0]]), 0);
});

test("places resolve, and ranges are lines", () => {
  assert.deepEqual(resolvePath(THREE, "offerings[2].inputs[0].given_by"), { found: true, value: "agent" });
  assert.deepEqual(resolvePath(THREE, "refusals/1"), { found: true, value: "Sending a greeting. Filing is not sending, and nothing leaves the folder." });
  assert.equal(resolvePath(THREE, "offerings[3]").found, false);
  assert.equal(resolvePath(THREE, "nope.x").found, false);
  assert.deepEqual(rangeOf({ text: "a\nb\nc\n" }, "L2-L3").lines, ["b", "c"]);
  assert.equal(rangeOf({ text: "a\n" }, "L3"), null);
});
