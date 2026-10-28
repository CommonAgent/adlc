// The review step and the check of what it said.
//   node --test test/review.test.mjs
//
// What is worth pinning: the model is handed every declaration, script and
// test with line numbers, changed files first, the house-rule findings it
// must not repeat, and the person's words as where to look; it is asked for
// findings in blocks and never for a grade or a fix; an unreadable answer is
// asked for once more with what was wrong, and never a third time; with no
// model configured nothing is called and the reason is kept. Then every
// finding without a real place, a claim or a consequence, or that grades,
// fixes or repeats, is dropped with its reason.
//
// Nothing here calls a model: the call is handed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseFiles, findingsFrom, numbered, review, reviewPrompt, TRIES } from "../scripts/review.mjs";
import { checkFindings, placeOf } from "../scripts/check-findings.mjs";
import { badPackage, readOf } from "./helpers.mjs";

const pkg = () => readOf(badPackage());
const env = { TEXT_MODEL: "some-model", TEXT_API_KEY: "k" };

test("files go numbered, declarations first, changed files ahead of the rest", () => {
  const { read, texts } = pkg();
  assert.match(numbered("a.mjs", "x\ny"), /^=== a\.mjs \(2 lines\) ===\n1\| x\n2\| y\n$/);
  const all = chooseFiles(read, texts);
  assert.equal(all.sent[0], "agent-descriptor.json");
  read.change = { scope: "diff", files: [{ path: "scripts/think.mjs", lines: [2] }] };
  assert.equal(chooseFiles(read, texts).sent[0], "scripts/think.mjs");
  const tight = chooseFiles(read, texts, 400);
  assert.ok(tight.left.length > 0 && tight.sent.length + tight.left.length === all.sent.length);
});

test("the ask carries the house-rule findings, the person's words, and the form, and asks for no grade and no fix", () => {
  const { read, texts } = pkg();
  read.asked = "look at the pieces";
  const p = reviewPrompt({ read, texts, sent: ["scripts/make.mjs"], houseFindings: [{ place: { file: "scripts/make.mjs", line: 4 }, claim: "names a model" }] });
  assert.match(p, /scripts\/make\.mjs:4 names a model/);
  assert.match(p, /look at the pieces/);
  assert.match(p, /<<<FINDING>>>\nplace:/);
  assert.match(p, /never grade the work as a whole/);
  assert.match(p, /Never include code to fix anything/);
  assert.match(p, /4\| export const MODEL/);
});

test("findings are read out of blocks, and an answer with neither blocks nor NONE is refused", () => {
  const got = findingsFrom("```\n<<<FINDING>>>\nplace: scripts/make.mjs:6\nrule: claims-match-code\nclaim: reads STORE_TOKEN\n  unbound.\nconsequence: fails on every host.\n<<<END>>>\n```");
  assert.deepEqual(got, [{ place_text: "scripts/make.mjs:6", rule: "claims-match-code", claim: "reads STORE_TOKEN unbound.", consequence: "fails on every host." }]);
  assert.deepEqual(findingsFrom("<<<NONE>>>"), { none: true });
  assert.throws(() => findingsFrom("The code looks good overall."), /no <<<FINDING>>> block/);
});

test("an unreadable answer is asked for once more, with what was wrong, and never a third time", async () => {
  const { read, texts } = pkg();
  const asks = [];
  const call = async (prompt) => { asks.push(prompt); return { model: "some-model", text: "Looks fine to me." }; };
  const out = await review({ read, texts, sent: ["scripts/make.mjs"] }, { env, call });
  assert.equal(asks.length, TRIES);
  assert.match(asks[1], /Your last answer could not be used: it held no <<<FINDING>>> block/);
  assert.match(out.error, /after 2 goes/);
  assert.equal(out.calls.length, 2);
});

test("with no model configured nothing is called and the reason is kept", async () => {
  const { read, texts } = pkg();
  let called = false;
  const out = await review({ read, texts, sent: [] }, { env: {}, call: async () => { called = true; } });
  assert.equal(called, false);
  assert.match(out.error, /no model is configured/);
  assert.deepEqual(out.calls, []);
});

test("a finding needs a real place, a claim and a consequence, and must not grade, fix or repeat", () => {
  const { read } = pkg();
  const house = [{ source: "house rule", rule: "model-in-code", place: { file: "scripts/make.mjs", line: 4 }, claim: "names a model" }];
  const answered = [
    { place_text: "scripts/think.mjs:2", rule: "general", claim: "think returns a constant.", consequence: "Every job gets the same answer." },
    { place_text: "", rule: "general", claim: "x", consequence: "y" },
    { place_text: "scripts/nowhere.mjs:1", rule: "general", claim: "x", consequence: "y" },
    { place_text: "scripts/think.mjs:99", rule: "general", claim: "x", consequence: "y" },
    { place_text: "scripts/think.mjs", rule: "general", claim: "x", consequence: "y" },
    { place_text: "scripts/think.mjs:1", rule: "general", claim: "", consequence: "y" },
    { place_text: "scripts/think.mjs:1", rule: "general", claim: "x", consequence: "" },
    { place_text: "scripts/read.mjs:2", rule: "general", claim: "The code is well-written overall.", consequence: "Easy to read." },
    { place_text: "scripts/read.mjs:3", rule: "general", claim: "Wrong call.", consequence: "Use ```callModel(y)``` instead." },
    { place_text: "`scripts/make.mjs` line 5", rule: "model-in-code", claim: "names a model again", consequence: "same" },
  ];
  const out = checkFindings(answered, read, house);
  assert.deepEqual(out.kept.map((f) => `${f.place.file}:${f.place.line}`), ["scripts/think.mjs:2"]);
  assert.deepEqual(out.dropped.map((d) => d.why), [
    "it names no place",
    "it names scripts/nowhere.mjs, which is not a file of this package",
    "scripts/think.mjs has 3 lines and it names line 99",
    "it names a file and no line",
    "it makes no claim",
    "it says no consequence",
    "it grades the work rather than naming something wrong",
    "it writes the fix, which is not this role's",
    "the house-rule check already found it",
  ]);
  assert.deepEqual(placeOf("`a/b.mjs:12-14`"), { file: "a/b.mjs", line: 12 });
});

test("with a diff, a finding off the changed lines is kept apart", () => {
  const { read } = pkg();
  read.change = { scope: "diff", files: [{ path: "scripts/think.mjs", lines: [2] }] };
  const out = checkFindings([
    { place_text: "scripts/think.mjs:2", rule: "general", claim: "a", consequence: "b" },
    { place_text: "scripts/read.mjs:2", rule: "general", claim: "c", consequence: "d" },
  ], read, []);
  assert.equal(out.kept.length, 1);
  assert.equal(out.outside_the_change[0].place.file, "scripts/read.mjs");
});
