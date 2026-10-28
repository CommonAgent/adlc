// Reading the request decides what the person actually asked for, before
// anything else is spent on it.
//
// What is worth pinning: the description comes from a request file (found by
// a name containing "request" or by its shape) or, with no file, from the plain
// message itself; the earlier plan and the change ride along when given; an
// empty description, one over 2000 characters, a change over 500, or a file
// that is not JSON is refused with a reply opening "I cannot" that says which;
// and a first line of `run <run id> phase <phase>: stop that` is a stop notice,
// answered with one sentence naming the run and the phase, with nothing read.
// Nothing here touches a file system or a network: the message and the files
// are plain values handed in as { name, text }.
// Run: node --test test/request.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRequest, wordsOf } from "../scripts/request.mjs";

const file = (name, body) => ({ name, text: typeof body === "string" ? body : JSON.stringify(body) });

test("a request file supplies the description, the earlier plan and the change", () => {
  const earlier = { format: "build-plan-v1", title: "Old plan" };
  const r = readRequest({
    text: "",
    files: [file("request.json", { description: "Read a page and summarise it", plan: earlier, change: "make it weekly" })],
  });
  assert.equal(r.ok, true);
  assert.equal(r.description, "Read a page and summarise it");
  assert.deepEqual(r.earlier, earlier);
  assert.equal(r.change, "make it weekly");
});

test("a file with an ordinary name is still found by the shape of what it holds", () => {
  const r = readRequest({ text: "", files: [file("upload-1.json", { description: "Sort my receipts" })] });
  assert.equal(r.ok, true);
  assert.equal(r.description, "Sort my receipts");
});

test("a plain message with no file is the description itself", () => {
  const r = readRequest({ text: "Summarise my inbox every morning", files: [] });
  assert.equal(r.ok, true);
  assert.equal(r.description, "Summarise my inbox every morning");
});

test("an empty or blank description is refused with a reply that opens I cannot and says it is empty", () => {
  for (const r of [
    readRequest({ text: "", files: [] }),
    readRequest({ text: "  \n ", files: [] }),
    readRequest({ text: "", files: [file("request.json", { description: "" })] }),
  ]) {
    assert.equal(r.ok, false);
    assert.match(r.reply, /^I cannot/);
    assert.match(r.reply, /empty/i);
  }
});

test("a description of 2000 characters is read and one of 2001 is refused with the limit named", () => {
  assert.equal(readRequest({ text: "a".repeat(2000), files: [] }).ok, true);
  for (const r of [
    readRequest({ text: "a".repeat(2001), files: [] }),
    readRequest({ text: "", files: [file("request.json", { description: "a".repeat(2001) })] }),
  ]) {
    assert.equal(r.ok, false);
    assert.match(r.reply, /^I cannot/);
    assert.match(r.reply, /2000/);
  }
});

test("a change of 500 characters is read and one of 501 is refused", () => {
  const body = (change) => ({ description: "Do a thing", plan: { title: "p" }, change });
  assert.equal(readRequest({ text: "", files: [file("request.json", body("c".repeat(500)))] }).ok, true);
  const r = readRequest({ text: "", files: [file("request.json", body("c".repeat(501)))] });
  assert.equal(r.ok, false);
  assert.match(r.reply, /^I cannot/);
  assert.match(r.reply, /500|change/i);
});

test("a request file that is not JSON is refused and the reply says so", () => {
  const r = readRequest({ text: "Please plan something", files: [file("request.json", "{ not json")] });
  assert.equal(r.ok, false);
  assert.match(r.reply, /^I cannot/);
  assert.match(r.reply, /JSON/);
});

test("a description that is not text is refused rather than coerced", () => {
  const r = readRequest({ text: "", files: [file("request.json", { description: 42 })] });
  assert.equal(r.ok, false);
  assert.match(r.reply, /^I cannot/);
});

test("a stop notice on the first line is answered with one sentence naming the run and the phase, and nothing is read", () => {
  const r = readRequest({
    text: "run r-12 phase draft: stop that\nplease also plan my week",
    files: [file("request.json", "{ this would be refused as not JSON if it were read")],
  });
  assert.equal(r.ok, false);
  assert.equal(r.stopped, true);
  assert.ok(!r.description, "no description is taken from a stopped job");
  assert.match(r.reply, /r-12/);
  assert.match(r.reply, /draft/);
  assert.equal(r.reply.includes("\n"), false, "one sentence");
  assert.doesNotMatch(r.reply, /JSON/, "the file was not even opened");
});

test("a stop notice that is not on the first line, or is not the exact form, is only content", () => {
  const later = readRequest({ text: "Plan my week\nrun r-12 phase draft: stop that", files: [] });
  assert.equal(later.ok, true);
  assert.equal(later.stopped, undefined);
  const inexact = readRequest({ text: "run r-12 phase draft: stop", files: [] });
  assert.equal(inexact.ok, true);
});

test("a page's message: the job's name on the first line, then what you want done as a name: value line", () => {
  const r = readRequest({ text: "Make a plan\nwhat you want done: Read my bakery's site\nand write a short brief" });
  assert.equal(r.ok, true);
  assert.equal(r.description, "Read my bakery's site\nand write a short brief");
  assert.equal(wordsOf("Plan a newsletter"), "Plan a newsletter");
});
