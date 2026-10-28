// The parts, one at a time: the descriptor checks, the form a page fills,
// how a piece is read, the verdict, and the package's own files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { descriptorChecks, exampleProblems, oneSentence, personOfferings } from "../scripts/descriptor-checks.mjs";
import { fillForm, takes } from "../scripts/form.mjs";
import { judgePiece } from "../scripts/readable.mjs";
import { readHeader, trialFindings, verdictOf, writeReport } from "../scripts/report.mjs";
import { settingsFor } from "../scripts/run-config.mjs";
import { changeSteps, holdsDeliverable, jobOf } from "../scripts/trial.mjs";
import { fromText } from "../scripts/read-request.mjs";
import { badDescriptor, goodDescriptor } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const read = (p) => readFileSync(join(PKG, p), "utf8");
const sha = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

test("a Descriptor a person can use passes every descriptor check", () => {
  const r = descriptorChecks(goodDescriptor());
  assert.deepEqual(r.checks.map((c) => [c.check, c.result]), [["summary", "pass"], ["example", "pass"], ["inputs-to-controls", "pass"], ["options-settings", "pass"], ["presentation", "pass"]]);
  assert.deepEqual(r.findings, []);
});

test("a Descriptor a person cannot use fails each check, every finding labelled descriptor and fixed by design", () => {
  const r = descriptorChecks(badDescriptor());
  assert.ok(r.checks.every((c) => c.result === "fail"), JSON.stringify(r.checks));
  assert.ok(r.findings.every((f) => f.label === "descriptor" && f.fixed_by === "design"));
  const what = r.findings.map((f) => `${f.check}: ${f.what}`).join("\n");
  assert.match(what, /summary: the Descriptor has no summary/);
  assert.match(what, /example: it declares no example/);
  assert.match(what, /inputs-to-controls: a person is asked for application\/json data, and nothing says another agent gives it/);
  assert.match(what, /inputs-to-controls: the input is an option of the job, not its material/);
  assert.match(what, /options-settings: the setting does not declare label, value_labels for "m1", "m2"/);
  assert.match(what, /presentation: it declares no presentation \(its kind is application\/json\)/);
});

test("only offerings a person starts are checked and run; an absent started_by counts as a person's", () => {
  const d = goodDescriptor();
  d.offerings.push({ ...d.offerings[0], id: "for-agents", started_by: ["agent"] }, { ...d.offerings[0], id: "unsaid", started_by: undefined });
  assert.deepEqual(personOfferings(d).map((o) => o.id), ["write-a-note", "unsaid"]);
});

test("an example must give every required input and one of each group", () => {
  const o = { inputs: [{ name: "a", kind: "text", required: true }, { name: "x", kind: "url", one_of: "src" }, { name: "y", kind: "document", one_of: "src" }] };
  assert.deepEqual(exampleProblems(o, { inputs: { a: "hi", x: "https://e.com" }, good_result: "ok" }), []);
  assert.deepEqual(exampleProblems(o, { inputs: { b: "hi" } }), [
    "its example does not say what a good result looks like (good_result)",
    "its example gives \"b\", which is not one of its inputs",
    "its example gives no value for the required input \"a\"",
    "its example gives none of the \"src\" inputs, one of which is needed",
  ]);
});

test("one sentence of at most 200 characters", () => {
  assert.equal(oneSentence("Makes a quiz from a page, e.g. an article."), true);
  assert.equal(oneSentence("Makes a quiz. Then grades it."), false);
  assert.equal(oneSentence("x".repeat(201)), false);
});

test("the form is filled and sent the way a page sends it", async () => {
  const o = goodDescriptor().offerings[0];
  const f = await fillForm(o, o.example, {});
  assert.equal(f.ok, true, f.problems.join("; "));
  assert.equal(f.message.text, "Engineers new to the team\n\npage: https://example.com/a.html");
  const named = await fillForm(o, o.example, { nameJob: true });
  assert.equal(named.message.text, "Write a note.\n\npage: https://example.com/a.html\naudience: Engineers new to the team");
  const bad = await fillForm(o, { inputs: { page: "not an address", voice: "calm" }, good_result: "x" }, {});
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join("\n"), /gives "voice", and the offering has no input of that name/);
  assert.match(bad.problems.join("\n"), /"page" takes an address, and the example gives "not an address"/);
});

test("a file in the package comes from what the job was given, and only when its digest matches", async () => {
  const bytes = Buffer.from("{\"pages\":[]}");
  const o = { id: "x", name: "X", inputs: [{ name: "site-read", kind: "application/vnd.example.site-read+json", required: true, given_by: "either" }] };
  const ex = { inputs: { "site-read": { file: "examples/read.json", digest: sha(bytes), media_type: "application/vnd.example.site-read+json" } }, good_result: "x" };
  const ok = await fillForm(o, ex, { attached: [{ name: "examples/read.json", bytes }] });
  assert.equal(ok.ok, true, ok.problems.join("; "));
  assert.equal(ok.message.files[0].name, "site-read.json");
  const none = await fillForm(o, ex, { attached: [] });
  assert.match(none.problems[0], /is in the agent's package, and no package or file with its digest came with this job/);
  const url = { inputs: { "site-read": { url: "https://e.com/r.json", digest: sha(Buffer.from("other")) } }, good_result: "x" };
  const wrong = await fillForm(o, url, { fetchFile: async () => ({ ok: true, bytes }) });
  assert.match(wrong.problems[0], /hashes to sha256:[0-9a-f]{64}, not the sha256:/);
});

test("which files an input takes", () => {
  assert.equal(takes({ kind: "document", accepts: ["application/pdf"] }, "application/pdf"), true);
  assert.equal(takes({ kind: "document", accepts: ["application/pdf"] }, "text/markdown"), false);
  assert.equal(takes({ kind: "application/json" }, "application/vnd.x+json"), true);
  assert.equal(takes({ kind: "url" }, "text/html"), false);
});

test("a piece is read against its declared kind and presentation", () => {
  const md = judgePiece({ name: "note", kind: "text/markdown" }, { name: "note", media_type: "text/markdown" }, Buffer.from("# Title\n\nSome words a person reads easily, and more of them."));
  assert.equal(md.readable, true);
  const json = judgePiece({ name: "note", kind: "text/markdown" }, { name: "note", media_type: "text/markdown" }, Buffer.from("{\"a\":1}"));
  assert.equal(json.matches, false);
  const leftover = judgePiece({ name: "note", kind: "text/markdown" }, { name: "note", media_type: "text/markdown" }, Buffer.from("# Title\n\nThe author is: undefined\n\nMore words here for a person."));
  assert.equal(leftover.readable, false);
  assert.match(leftover.problems[0], /leftovers of code/);
  const data = judgePiece({ name: "facts", kind: "application/json" }, { name: "facts", media_type: "application/json" }, Buffer.from("[{\"fact\":\"x\"}]"));
  assert.equal(data.for_a_person, false);
  const facts = judgePiece({ name: "facts", kind: "application/vnd.x.facts+json", presentation: "facts" }, { name: "facts", media_type: "application/vnd.x.facts+json" }, Buffer.from("{\"facts\":[{\"fact\":\"x\"}]}"));
  assert.equal(facts.readable, true);
  const png = judgePiece({ name: "p", kind: "image/png" }, { name: "p", media_type: "image/png" }, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
  assert.equal(png.readable, true);
  const notPng = judgePiece({ name: "p", kind: "image/png" }, { name: "p", media_type: "image/png" }, Buffer.from("GIF89a"));
  assert.equal(notPng.matches, false);
  const kind = judgePiece({ name: "n", kind: "text/markdown" }, { name: "n", media_type: "text/plain" }, Buffer.from("Words enough to read here, plainly."));
  assert.equal(kind.matches, false);
  const vtt = judgePiece({ name: "c", kind: "text/vtt" }, { name: "c", media_type: "text/vtt" }, Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nHi"));
  assert.equal(vtt.readable, true);
});

test("what came back holds the deliverable, and a change redoes the steps that made it", () => {
  const o = { id: "o", outputs: [{ name: "quiz" }, { name: "notes", working: true }], steps: [{ id: "s1" }, { id: "s2" }] };
  assert.equal(holdsDeliverable(o, [{ name: "notes" }]), false);
  assert.equal(holdsDeliverable(o, [{ name: "quiz" }]), true);
  assert.deepEqual(changeSteps(o, [{ step: "s2" }]), ["s2"]);
  assert.deepEqual(changeSteps({ ...o, revisions: { steps: [{ id: "s1" }] } }, [{ step: "s2" }]), ["s1"]);
  assert.deepEqual(changeSteps({ id: "o" }, []), ["o"]);
  assert.equal(jobOf({ job: { job: "ctx:1" } }), "ctx:1");
  assert.equal(jobOf({ job_id: "J" }), "J");
});

test("the verdict: stopped anywhere is not usable; findings alone are usable with findings", () => {
  const yes = { answers: { form: "yes", delivers: "yes", readable: "yes", change: "yes" } };
  assert.equal(verdictOf([yes], []), "usable");
  assert.equal(verdictOf([yes], [{}]), "usable_with_findings");
  assert.equal(verdictOf([{ answers: { ...yes.answers, readable: "no" } }], []), "not_usable");
  assert.equal(verdictOf([{ answers: { form: "not run", delivers: "not run", readable: "not run", change: "not run" } }], []), "not_usable");
  const t = trialFindings({ id: "o", example: {}, form: { ok: true }, run: { state: "delivered", delivers: true, readable: true, pieces: [], missing: [] }, change: { not: "x", declared: false } });
  assert.equal(t.answers.change, "not offered");
  assert.equal(t.findings[0].label, "descriptor");
});

test("the header an auditor reads round-trips", () => {
  const r = writeReport({ handle: "a.b@c.com", name: "A", version: "1.0.0", package_digest: `sha256:${"b".repeat(64)}`, descriptor_digest: `sha256:${"c".repeat(64)}`, tested_at: "2026-10-28T12:00:00Z", tested_by: "usability-tester 0.1.0", checks: { checks: [], findings: [] }, trials: [], judgment: null, not_checked: [] });
  const h = readHeader(r.text);
  assert.deepEqual([h.usability_report, h.agent, h.version, h.package_digest, h.verdict, h.tested_at], ["v1", "a.b@c.com", "1.0.0", `sha256:${"b".repeat(64)}`, "usable", "2026-10-28T12:00:00Z"]);
});

test("the message: the agent, the offering, the change and a person's judgment", () => {
  const a = fromText("agent: quiz-maker.platform@agentmesh.ai\noffering: make-a-quiz.\nchange: Fewer questions.\nunderstood: yes\ncould use: no\ndid the job: yes\nnote: Clear enough.");
  assert.deepEqual(a, { handle: "quiz-maker.platform@agentmesh.ai", offering: "make-a-quiz", change: "Fewer questions.", judgment: { understood: true, could_use: false, did_the_job: true, note: "Clear enough." } });
  assert.equal(fromText("quiz-maker.platform@agentmesh.ai").handle, "quiz-maker.platform@agentmesh.ai");
  assert.equal(fromText("hello").judgment, null);
});

test("the declared settings: defaults, and a value outside them refused", () => {
  const decl = JSON.parse(read("agent-descriptor.json")).run_config.settings;
  assert.deepEqual(settingsFor(decl, {}).values, { wait_minutes: 15, ask_for_a_change: "yes" });
  assert.match(settingsFor(decl, { wait_minutes: 90 }).refused, /^not_allowed/);
  assert.match(settingsFor(decl, { model: "x" }).refused, /^not_declared/);
});

test("the package: one version, its own example, every script listed, and each skill's scripts on its page", () => {
  const d = JSON.parse(read("agent-descriptor.json"));
  const plugin = JSON.parse(read("plugin.json"));
  assert.equal(d.agent_version, plugin.version);
  assert.equal(d.does, plugin.description);
  assert.ok(existsSync(join(PKG, "records", `build-${d.agent_version}.md`)), "a build record for this version");
  const o = d.offerings[0];
  assert.deepEqual(exampleProblems(o, o.example), []);
  assert.deepEqual(descriptorChecks(d).findings, []);
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  const listed = new Set(Object.values(skills).flatMap((s) => s.scripts));
  for (const f of readdirSync(join(PKG, "scripts"))) assert.ok(listed.has(`scripts/${f}`), `scripts/${f} is in a skill`);
  for (const [slug, s] of Object.entries(skills)) {
    const page = read(`skills/${slug}/SKILL.md`);
    for (const sc of s.scripts) assert.ok(page.includes(`- ${sc}`), `${slug} lists ${sc}`);
    // Each skill carries every script its scripts import.
    for (const sc of s.scripts) {
      for (const m of read(sc).matchAll(/from "\.\/([\w.-]+\.mjs)"/g)) assert.ok(s.scripts.includes(`scripts/${m[1]}`), `${slug}: ${sc} imports ${m[1]}`);
    }
  }
  const ids = [o.id, ...o.steps.map((s) => s.id)].sort();
  assert.deepEqual(Object.keys(skills).sort(), ids);
  const same = ["went-without.mjs", "retry.mjs", "tar.mjs"];
  for (const f of same) assert.equal(read(`scripts/${f}`), readFileSync(join(PKG, "..", "agent-auditor", "scripts", f), "utf8"), `${f} is the auditor's copy`);
});

test("no model is named in the code, and none is called", () => {
  for (const f of readdirSync(join(PKG, "scripts"))) {
    const t = read(`scripts/${f}`);
    assert.doesNotMatch(t, /\b(gpt-|claude-|gemini-|haiku|sonnet|opus|llama|mistral)\w*/i, f);
  }
});
