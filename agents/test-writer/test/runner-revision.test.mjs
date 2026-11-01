// A revision sent by the process runner (AgentMesh technical debt 665).
//   node --test test/runner-revision.test.mjs
//
// Under the process runner (new-agent v3), Send back to Test is the deviation
// wrong-test. The test writer's work message opens "run <id> phase
// write-the-suite: here is work" and carries, as its last line, "why this
// phase runs again: deviation [wrong-test]: <the code step's words and the
// person's>", with the suite it delivered before attached. On dev (build
// ab_f1dd30a94724129ad5, run r-20261101-991b) that was read as an ordinary
// ask: a new test file was written and the test the conflict named was left
// as it was.
//
// What is pinned: the runner's line makes the message a revision, the same as
// a first line "Revise the suite"; only the words of that line, to the end of
// the message, are read for the files named, so the work message's own lines
// name nothing; and a revision changes the named files in place: a file the
// answer writes under a new name is a finding, is never delivered, and an
// answer that revises no named file is refused in words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { askForSuite, namedForRevision, revisionDelivery, staticFindings } from "../scripts/write-suite.mjs";
import { isRevision, revisionAsked, runJob } from "../scripts/job.mjs";

const fileFor = (script, names) => {
  const name = script.split("/").pop();
  const fn = name.replace(/\.mjs$/, "").replace(/-(.)/g, (_, c) => c.toUpperCase());
  const tests = names.map((n, i) => `test("${n}", () => { assert.equal(${fn}(${i}), ${i}); });`).join("\n");
  return { path: `test/${name.replace(/\.mjs$/, "")}.test.mjs`, text: `// ${name}: what it decides.\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${fn} } from "../scripts/${name}";\n${tests}\n` };
};
const COUNT = fileFor("scripts/count-words.mjs", ["a successful job replies with a single sentence naming the count", "counts words split by any run of spaces"]);
const SAY = fileFor("scripts/say.mjs", ["says the total on a line of its own", "says nothing for an empty sentence"]);
const STANDARD = { path: "test/worked-values.test.mjs", text: "// worked values\nimport { test } from \"node:test\";\n" };
const SUITE = [COUNT, SAY, STANDARD];
const DECLARED = { name: "word-runner", version: "0.1.0", scripts: ["scripts/count-words.mjs", "scripts/say.mjs"], jobs: [] };
const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");
const failing = async () => ({ tests: 1, pass: 0, fail: 1, status: 1, fails: true });

/** The work message the process runner sends a phase a deviation reopened, as 0.30.0 writes it. */
const RUNNER_MESSAGE = [
  "run r-20261101-991b phase write-the-suite: here is work",
  "process: make a new agent (agentmesh/new-agent v3), owned by platform@agentmesh.ai.",
  "wanted: the tests the scripts will be held to (your offering write-a-suite).",
  "done when you deliver:",
  "  - suite: every test file, and the reference data the tests read",
  "inputs:",
  "  [approved-spec] agent-descriptor.json, plugin.json",
  "  your last delivery: test/count-words.test.mjs, test/say.test.mjs",
  "constraints:",
  "  - the suite is written from the spec and never from the scripts",
  "Reply to this message when the work is delivered. Quote its first line if you write a new message instead.",
  "why this phase runs again: deviation [wrong-test]: What the code step said (records/conflict.md):",
  "# Conflict",
  "",
  "test/count-words.test.mjs, \"a successful job replies with a single sentence naming the count\", line 14,",
  "expects the reply to be the bare number; the spec says the reply is one sentence.",
  "",
  "What the person said:",
  "The test is wrong.",
].join("\n");

test("the process runner's line naming a deviation makes the message a revision; its work message alone does not", () => {
  assert.equal(isRevision(RUNNER_MESSAGE), true);
  assert.equal(isRevision(RUNNER_MESSAGE.split("\nwhy this phase runs again")[0]), false);
  assert.equal(isRevision("Revise the suite.\n\ncount-words.test.mjs is wrong."), true, "the first-line form still holds");
  assert.equal(isRevision("Write a suite.\nThe words why this phase runs again: deviation [x]: in the middle of a line are not the runner's."), false);
});

test("what a runner revision asks is the deviation's words, to the end, under a first line saying it is a revision", () => {
  const asked = revisionAsked(RUNNER_MESSAGE);
  assert.match(asked, /^Revise the suite\./);
  assert.match(asked, /What the code step said \(records\/conflict\.md\):/);
  assert.match(asked, /The test is wrong\./);
  assert.doesNotMatch(asked, /your last delivery/, "the work message's own lines are not the request");
  assert.equal(revisionAsked("Revise the suite.\n\nsay.test.mjs is wrong."), "Revise the suite.\n\nsay.test.mjs is wrong.", "the first-line form is read as it is");
});

test("only the file the deviation's words name is revised, not every file the work message lists", () => {
  assert.deepEqual(namedForRevision(SUITE, RUNNER_MESSAGE), ["test/count-words.test.mjs", "test/say.test.mjs"], "read whole, the work message names both");
  assert.deepEqual(namedForRevision(SUITE, revisionAsked(RUNNER_MESSAGE)), ["test/count-words.test.mjs"]);
});

const SPEC = JSON.stringify({ name: "word-runner", version: "0.1.0", jobs: [{ slug: "count", scripts: ["scripts/count-words.mjs"] }] });
function fakeSpawn(answers, ran = []) {
  return (bin, argv, opts) => {
    const script = basename(argv[0]);
    ran.push({ script, env: opts.env, asked: opts.env.ASKED_TEXT ? readFileSync(opts.env.ASKED_TEXT, "utf8") : null });
    const a = answers[script] ?? { ok: true, code: 0 };
    return { status: a.code ?? 0, stdout: `${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("a runner revision with its last delivery attached hands the writing step the suite and the deviation's words as a revision", () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-runner-revise-"));
  try {
    const spec = join(dir, "spec.json"); writeFileSync(spec, SPEC);
    const one = join(dir, "0-abcdefgh-count-words.test.mjs"); writeFileSync(one, COUNT.text);
    const two = join(dir, "1-ijklmnop-say.test.mjs"); writeFileSync(two, SAY.text);
    const manifest = join(dir, "2-qrstuvwx-job-manifest.json"); writeFileSync(manifest, "{}");
    const text = join(dir, "text.txt"); writeFileSync(text, RUNNER_MESSAGE);
    const ran = [];
    runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }, { path: one }, { path: two }, { path: manifest }], textFile: text, spawn: fakeSpawn({ "reply.mjs": { ok: true, code: 0, reply: "Revised." } }, ran) });
    const w = ran.find((r) => r.script === "write-suite.mjs");
    assert.ok(w, "the writing step ran");
    assert.equal(w.env.REVISE, "1");
    assert.ok(w.env.EXISTING, "the suite as it stands is handed over");
    assert.match(w.asked, /^Revise the suite\./);
    assert.match(w.asked, /a successful job replies with a single sentence naming the count/);
    assert.doesNotMatch(w.asked, /your last delivery/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("in a revision a file under a new name is a finding: the named test is changed in its own file", () => {
  const revised = { ...COUNT, text: COUNT.text.replace("naming the count", "naming the count, as one sentence") };
  const fresh = { path: "test/reply.test.mjs", text: SAY.text.replace(/say/g, "reply") };
  const out = staticFindings([revised, fresh], DECLARED, { existing: SUITE, revise: ["test/count-words.test.mjs"] });
  assert.ok(out.some((f) => /test\/reply\.test\.mjs is a new file/.test(f) && /test\/count-words\.test\.mjs/.test(f)), out.join(" | "));
  const ok = staticFindings([revised], DECLARED, { existing: SUITE, revise: ["test/count-words.test.mjs"] });
  assert.ok(!ok.some((f) => /new file/.test(f)), ok.join(" | "));
  const adding = staticFindings([fresh], DECLARED, { existing: SUITE });
  assert.ok(!adding.some((f) => /new file/.test(f)), "adding to a suite may still use new names");
});

test("a revision asks once more when its answer wrote a new file, and delivers the named file revised in place", async () => {
  const revised = { ...COUNT, text: COUNT.text.replace("naming the count", "naming the count, as one sentence") };
  const fresh = { path: "test/reply.test.mjs", text: SAY.text.replace(/say/g, "reply") };
  const answers = [answer([fresh]), answer([revised])];
  const out = await askForSuite({ call: async () => answers.shift(), run: failing, declared: DECLARED, spec: { name: "word-runner" }, existing: SUITE, revise: ["test/count-words.test.mjs"] });
  assert.equal(out.calls, 2);
  assert.deepEqual(out.files.map((f) => f.path), ["test/count-words.test.mjs"]);
});

test("what a revision delivers is the named files and the standard checks, never a file under a new name", () => {
  const revised = { ...COUNT, text: COUNT.text.replace("naming the count", "naming the count, as one sentence") };
  const fresh = { path: "test/reply.test.mjs", text: SAY.text };
  const got = revisionDelivery([revised, fresh, STANDARD], ["test/count-words.test.mjs"]);
  assert.deepEqual(got.files.map((f) => f.path), ["test/count-words.test.mjs", "test/worked-values.test.mjs"]);
  assert.deepEqual(got.dropped, ["test/reply.test.mjs"]);
  assert.deepEqual(got.revised, ["test/count-words.test.mjs"]);
  const none = revisionDelivery([fresh, STANDARD], ["test/count-words.test.mjs"]);
  assert.deepEqual(none.revised, [], "nothing named was revised");
});
