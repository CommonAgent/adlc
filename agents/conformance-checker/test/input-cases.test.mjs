// The three input cases (input-cases.mjs), made from a descriptor and judged
// from what came back. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkableOfferings, classifyAnswer, inputCases, judgeCase, NONSENSE } from "../input-cases.mjs";

const factChecker = {
  offerings: [{
    id: "check-facts", name: "Check facts", how: { control: "script" },
    inputs: [
      { name: "facts", kind: "application/json", required: true },
      { name: "site-read", kind: "application/json", required: true },
    ],
  }],
};
const allOptional = { offerings: [{ id: "write-facts", name: "Write facts", inputs: [{ name: "site-read", kind: "application/json", required: false }] }] };
const textOnly = { offerings: [{ id: "chat", inputs: [{ name: "text", kind: "text", required: true }] }] };

test("the cases apply to an offering that needs an input beyond free text", () => {
  assert.equal(checkableOfferings(factChecker).length, 1);
  assert.equal(checkableOfferings(allOptional).length, 0, "an offering whose inputs are all optional needs nothing");
  assert.equal(checkableOfferings(textOnly).length, 0, "free text is a conversation, not a format");
  assert.equal(checkableOfferings({ offerings: [{ ...factChecker.offerings[0], how: { control: "model" } }] }).length, 0, "a model reads words itself");
});

test("three cases: a plain sentence, a near miss naming what it leaves out, nonsense", () => {
  const [plain, near, nonsense] = inputCases(factChecker.offerings[0]);
  assert.equal(plain.text, "Please check facts for me.");
  assert.deepEqual(JSON.parse(near.text), { "site-read": { example: true } });
  assert.equal(near.missing, "facts");
  assert.equal(nonsense.text, NONSENSE);
  const single = inputCases({ id: "o", inputs: [{ name: "pdf", kind: "application/pdf", required: true }] })[1];
  assert.deepEqual(JSON.parse(single.text), { pdf_x: "example" }, "the only needed input is misspelt rather than left out");
});

test("judging: the standard reply passes inside the window; anything else, late or silent fails", () => {
  const [plain, near, nonsense] = inputCases(factChecker.offerings[0]);
  const std = { text: "fact-checker could not use this message: ...", error: { code: "INPUT_NOT_UNDERSTOOD", details: { missing: ["facts"] } } };
  assert.equal(judgeCase(near, std, 900).pass, true);
  assert.equal(judgeCase(nonsense, std, 900).pass, true);
  assert.equal(judgeCase(plain, { text: "I read this as: check the facts. Working on it." }, 900).pass, true);
  assert.equal(judgeCase(nonsense, { text: "I read this as: x. Working on it." }, 900).pass, false, "nonsense is never read as work");
  assert.equal(judgeCase(near, { ...std, error: { code: "INPUT_NOT_UNDERSTOOD", details: { missing: ["other"] } } }, 900).pass, false);
  assert.equal(judgeCase(nonsense, std, 20_000).pass, false);
  assert.equal(judgeCase(nonsense, null, 12_000).pass, false);
  assert.equal(classifyAnswer({ text: "Here are your facts" }), "OTHER");
});

test("a text group is satisfied by words; a url near miss holds no address; a mixed agent gets the named case only", async () => {
  const { allScripted } = await import("../input-cases.mjs");
  const quiz = { offerings: [{ id: "make-a-quiz", name: "Make a quiz", how: { control: "script" }, inputs: [
    { name: "page address", kind: "url", one_of: "source" }, { name: "notes", kind: "text", one_of: "source" }] }] };
  assert.equal(checkableOfferings(quiz).length, 0, "notes in the group: any words fit");
  const site = { id: "read-site", name: "Read a site", how: { control: "script" }, inputs: [{ name: "url", kind: "url", required: true }] };
  const near = JSON.parse(inputCases(site)[1].text);
  assert.deepEqual(near, { url_x: "example" });
  assert.equal(inputCases(site, { mixed: true }).length, 1);
  assert.equal(allScripted({ offerings: [site, { id: "talk", how: { control: "model" } }] }), false);
  assert.equal(allScripted({ offerings: [site] }), true);
});
