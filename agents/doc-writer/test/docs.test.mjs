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
  const bad = markdown.replace("## What it does\n", "## What it does\n\n- It also emails every greeting. [S1: does]\n");
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
  assert.match(markdown, /^- Send it work at `quiz-maker\.platform@agentmesh\.ai`, over agentmesh\. \[S3: sections\.access\]$/m);
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

test("a line holds only at the kind of place it is about, and the signed AgentDoc is read through its doc", () => {
  const { sources, leftOut, markdown } = three();
  // A true rendering of a real place, but put where it means something else.
  const moved = markdown.replace("## What it will not do\n", "## What it will not do\n\n- **names** (text, required). [S1: offerings[2].outputs[0]]\n");
  assert.equal(checkDocs({ markdown: moved, sources, leftOut }).ok, false);
  const doc = JSON.parse(readFileSync(join(FIX, "quiz-maker.agentdoc.json"), "utf8"));
  const signed = { format: "agentdoc-signed-v1", subject: doc.subject.id, doc, read: [], by: "UKEY", at: doc.assembled_at, sig: "x" };
  const s = sortGiven([file("agentdoc.signed.json", signed)]);
  assert.equal(s.sources[0].kind, "agentdoc");
  const w = writeDocs({ sources: s.sources, leftOut: s.leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown: w.markdown, sources: s.sources, leftOut: s.leftOut }).findings, []);
  assert.match(w.markdown, /^# quiz-maker$/m);
});

// The review of PR 18 found each of these; each is held here.
test("review: a text record that ends with a newline is quoted and passes, counted the same way by both", () => {
  const log = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("count.log", log), file("greet.log", "hello\n")]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^From `count\.log`, lines 1 to 40 of 45: \[S2: L1-L40\]$/m);
  assert.match(markdown, /^From `greet\.log`: \[S3: L1-L1\]$/m);
});

test("review: refusals given as a list are each held, and dropping one is a finding", () => {
  const d = { ...THREE, refusals: ["Greeting strangers.", "Sending anything."] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.ok(checkDocs({ markdown, sources, leftOut }).ok);
  const dropped = markdown.replace(/^- Sending anything\. \[S1: refusals\[1\]\]\n/m, "");
  assert.notEqual(dropped, markdown);
  assert.equal(checkDocs({ markdown: dropped, sources, leftOut }).ok, false);
});

test("review: a job's line moved under another job, or a line under the wrong section, fails", () => {
  const { sources, leftOut, markdown } = three();
  const line = "- **names** (text, required). [S1: offerings[1].inputs[0]]\n";
  assert.ok(markdown.includes(line));
  const moved = markdown.replace(line, "").replace("#### What to give it\n\n", `#### What to give it\n\n${line}`);
  assert.equal(checkDocs({ markdown: moved, sources, leftOut }).ok, false);
  const doesLine = "Turns a list of names into greetings, counts them, and files them. [S1: does]";
  const wrong = markdown.replace(`- ${doesLine}\n`, "").replace("## What it will not do\n\n", `## What it will not do\n\n- ${doesLine}\n`);
  assert.equal(checkDocs({ markdown: wrong, sources, leftOut }).ok, false);
  // A record shown under a job it is not a record of.
  const swapped = markdown.replace("### Greet\n", "### Greet-x\n");
  assert.equal(checkDocs({ markdown: swapped, sources, leftOut }).ok, false);
});

test("review: a json range on a text record is a finding, not a crash", () => {
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("greet.txt", "hello\n")]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  const bad = markdown.replace("[S2: L1-L1]", "[S2: json L1-L1]");
  assert.notEqual(bad, markdown);
  let r;
  assert.doesNotThrow(() => { r = checkDocs({ markdown: bad, sources, leftOut }); });
  assert.equal(r.ok, false);
});

test("review: a description with its own bullet and heading lines passes", () => {
  const d = { ...THREE, does: "Makes greetings.\n- from a list\n# and files them" };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- - from a list \[S1: does\/1\]$/m);
});

test("review: a price, a job time, an input or an output no template can show is shown as written", () => {
  const d = JSON.parse(JSON.stringify(THREE));
  d.offerings[0].outputs[0] = { name: "report", kind: "text/markdown" };
  d.offerings[0].inputs[0] = { name: "names" };
  const rt = { format: "agent-runtime-requirements-v1", price: { sku: "default", covers: { offerings: ["greet"] }, price: { model: "metered", per: "call" } }, job_seconds: "600" };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d), file("agent-runtime-requirements.json", rt)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- As written at `price\.price`: `\{"model":"metered","per":"call"\}` \[S2: price\.price\]$/m);
  assert.match(markdown, /^- As written at `job_seconds`: `"600"` \[S2: job_seconds\]$/m);
  assert.match(markdown, /^- As written at `offerings\[0\]\.outputs\[0\]`: .* \[S1: offerings\[0\]\.outputs\[0\]\]$/m);
  assert.doesNotMatch(markdown, /says nothing about its price/);
});

test("review: a short job id does not claim a longer job's record", () => {
  const offs = [{ id: "make", steps: [] }, { id: "make-a-quiz", steps: [] }];
  const rec = (name) => ({ kind: "record", name, json: {}, text: "{}" });
  assert.equal(offeringOf(rec("make-a-quiz.json"), offs), 1);
  assert.equal(offeringOf(rec("make.json"), offs), 0);
  assert.equal(offeringOf(rec("remake.json"), offs), -1);
});

test("review: a declared record without `when` gets no hand-made line, and the job still passes", () => {
  const d = { ...THREE, records: [{ name: "the greetings per job", file: "*/greetings.json" }] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d), file("greetings.json", GREET_RECORD)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.doesNotMatch(markdown, /is the record declared as/);
});

// The second review of PR 18 found each of these; each is held here.
test("review 2: a place filled in a shape nothing reads is shown as written, never called silent", () => {
  const d = { ...THREE, escalates: "When unsure it asks the owner.", refusals: { a: "no" }, does: ["one", "two"] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- As written at `escalates`: `"When unsure it asks the owner\."` \[S1: escalates\]$/m);
  assert.doesNotMatch(markdown, /says nothing about/);
});

test("review 2: a verdict no template reads is shown as written", () => {
  const verdict = { record: "v1", act: "evaluate", summary: { pass: 3, fail: 0 } };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("verdict.json", verdict)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^- As written at `\.`: .* \[S2: \.\]$/m);
});

test("review 2: an input moved under What comes back, or parts out of order, fails", () => {
  const { sources, leftOut, markdown } = three();
  const line = "- **names** (text, required). [S1: offerings[0].inputs[0]]\n";
  const moved = markdown.replace(line, "").replace("#### What comes back\n\n", `#### What comes back\n\n${line}`);
  assert.notEqual(moved, markdown);
  assert.equal(checkDocs({ markdown: moved, sources, leftOut }).ok, false);
  const twice = markdown.replace("#### What comes back\n", "#### What comes back\n\n#### What to give it\n");
  assert.equal(checkDocs({ markdown: twice, sources, leftOut }).ok, false);
});

test("review 2: a descriptor saved with a byte-order mark is still the descriptor", () => {
  const { sources } = sortGiven([file("agent-descriptor.json", "\uFEFF" + JSON.stringify(THREE))]);
  assert.equal(sources[0].kind, "descriptor");
});

test("review 2: a record line of four backticks does not close the example early", () => {
  const md = "notes\n````\ninner\n````\n";
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", THREE), file("greet-notes.txt", md)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^`{5}text$/m);
});

test("review 2: a name, handle or job name over several lines never breaks a heading", () => {
  const doc = JSON.parse(readFileSync(join(FIX, "quiz-maker.agentdoc.json"), "utf8"));
  doc.sections.identity.name = "Quiz maker\nbeta";
  const d = JSON.parse(JSON.stringify(THREE));
  d.offerings[0].name = "Greet\nthem";
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d), file("agentdoc.json", doc)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^# The agent$/m);
  assert.match(markdown, /^### greet$/m);
});

test("review 2: a record's own field marked under a job is not an example, and fails", () => {
  const { sources, leftOut, markdown } = three();
  const bad = markdown.replace("#### Examples\n\n", "#### Examples\n\n- greet [S2: offering]\n");
  assert.notEqual(bad, markdown);
  assert.equal(checkDocs({ markdown: bad, sources, leftOut }).ok, false);
});

test("a record named for what only one job hands back is that job's example", () => {
  const offs = THREE.offerings;
  const rec = (name) => ({ kind: "record", name, json: {}, text: "{}" });
  assert.equal(offeringOf(rec("receipt.json"), offs), 2);
  assert.equal(offeringOf(rec("count.json"), offs), 1);
  assert.equal(offeringOf(rec("names.json"), offs), -1);
});

// The third review of PR 18 found each of these; each is held here.
test("review 3: a credential in the declaration is never shown, and the withholding is said", () => {
  const d = { ...THREE, systems: [{ name: "payments", access: "write", credential: "sk-live-0123456789abcdefghij" }, { name: "odd" }] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d)]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.doesNotMatch(markdown, /sk-live/);
  assert.match(markdown, /^- \*\*payments\*\*, which it writes\. \[S1: systems\[0\]\]$/m);
  const secret = { ...THREE, systems: [{ name: "x", token: "abcdefghijklmnop" }] };
  const s2 = sortGiven([file("agent-descriptor.json", secret)]);
  const w2 = writeDocs({ sources: s2.sources, leftOut: s2.leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown: w2.markdown, sources: s2.sources, leftOut: s2.leftOut }).findings, []);
  assert.doesNotMatch(w2.markdown, /abcdefghijklmnop/);
  assert.match(w2.markdown, /^- A value at `systems\[0\]` in the agent descriptor is not shown, because it looks like a credential\. \[S1: systems\[0\] withheld\]$/m);
  // A false withholding is a finding.
  const bad = w2.markdown.replace("[S1: systems[0] withheld]", "[S1: does withheld]").replace("A value at `systems[0]`", "A value at `does`");
  assert.equal(checkDocs({ markdown: bad, sources: s2.sources, leftOut: s2.leftOut }).ok, false);
});

test("review 3: an empty record is said to be empty and is no job's example", () => {
  const one = { ...THREE, offerings: [THREE.offerings[0]] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", one), file("run.log", "")]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /`run\.log` was given and is empty/);
  assert.match(markdown, /No record of a job of `greet` was given/);
});

test("review 3: odd offerings, inherited names, digit file names, backticks, a mark in the words, a carriage return", () => {
  const d = { ...THREE, does: "Cites like [S1: x] inline\rand more", offerings: [null, { id: "x", name: "X", steps: {}, inputs: [], outputs: [] }], refusals: [{ a: "``b``" }] };
  const { sources, leftOut } = sortGiven([file("agent-descriptor.json", d), file("x.json", { a: 1 })]);
  const { markdown } = writeDocs({ sources, leftOut, now: NOW });
  assert.deepEqual(checkDocs({ markdown, sources, leftOut }).findings, []);
  assert.match(markdown, /^### Job 1$/m);
  assert.match(markdown, /^- Cites like \[S1: x\] inline \[S1: does\/0\]$/m);
  assert.match(markdown, /^- As written at `refusals\[0\]`: ```\{"a":"``b``"\}``` \[S1: refusals\[0\]\]$/m);
  assert.equal(resolvePath({}, "constructor").found, false);
  const rec = { ...THREE, records: [{ name: "the run", when: "per_task", file: "*/2026-*-run.json" }], offerings: [THREE.offerings[0]] };
  const s3 = sortGiven([file("agent-descriptor.json", rec), { ...file("2026-10-27-run.json", { x: 1 }), original: "2026-10-27-run.json" }]);
  const w3 = writeDocs({ sources: s3.sources, leftOut: s3.leftOut, now: NOW });
  assert.match(w3.markdown, /`2026-10-27-run\.json` is the record declared as: the run\./);
  assert.ok(checkDocs({ markdown: w3.markdown, sources: s3.sources, leftOut: s3.leftOut }).ok);
});
